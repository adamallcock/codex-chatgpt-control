import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationJournal, OperationJournalError } from "../../src/operations/journal.js";
import { createJournalRpcClient, createJournalRpcClientFromDescriptor, readJournalRpcDescriptor } from "../../src/operations/journal-rpc-client.js";
import { startJournalRpcServer, type JournalRpcServer } from "../../src/operations/journal-rpc-server.js";
import { openRpcValue, publishPrivateFile, rpcSleep, sealRpcValue } from "../../src/operations/journal-rpc-protocol.js";
import * as journalRpcProtocol from "../../src/operations/journal-rpc-protocol.js";
import { OPERATION_REQUEST_SCHEMA_VERSION, type OperationEventV1, type OperationSubmitRequestV1 } from "../../src/operations/types.js";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const DIGEST = `hmac-sha256:${"a".repeat(64)}`;
const AT = "2026-09-06T00:00:00.000Z";
const servers: JournalRpcServer[] = [];
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) await server.close().catch(() => undefined);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(extra: Partial<Parameters<typeof startJournalRpcServer>[0]> = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "journal-rpc-test-")));
  roots.push(base);
  const stateRoot = join(base, "journal");
  const directory = join(base, "session");
  const server = await startJournalRpcServer({ stateRoot, directory, ...extra });
  servers.push(server);
  const descriptor = await readJournalRpcDescriptor(server.descriptorPath);
  const client = await createJournalRpcClientFromDescriptor(server.descriptorPath, { timeoutMs: 1000 });
  return { base, stateRoot, directory, server, descriptor, client };
}
function created(): Extract<OperationEventV1, { type: "operation_created" }> {
  return { type: "operation_created", operationId: OPERATION_ID, requestDigest: DIGEST, surface: "chat", createdAt: AT };
}
function observed(): OperationEventV1 {
  return { type: "blocker_observed", blocker: { code: "selector_drift", messageDigest: DIGEST, recoverable: true, observedAt: AT } };
}

// This transport requires POSIX ownership/mode authority. Windows exercises
// the explicit pre-I/O rejection in journal-rpc-platform.test.ts instead.
describe.skipIf(process.platform === "win32")("POSIX private filesystem journal authority RPC", () => {
  it("uses the real durable journal for create, append, load and handle validation", async () => {
    const { client, stateRoot, server, descriptor } = await fixture();
    const initial = await client.create(created());
    expect(initial.state.revision).toBe(1);
    const handle = await client.handleFromState(initial.state);
    const appended = await client.append(OPERATION_ID, 1, observed());
    expect(appended.state.revision).toBe(2);
    expect((await client.load(OPERATION_ID, DIGEST)).state).toEqual(appended.state);
    expect(await client.validateHandle(handle, appended.state)).toMatchObject({ stale: true, current: { revision: 2 } });
    const native = await OperationJournal.open({ stateRoot });
    expect((await native.load(OPERATION_ID)).state).toEqual(appended.state);
    expect((await stat(server.descriptorPath)).mode & 0o777).toBe(0o600);
    expect((await stat(descriptor.directory)).mode & 0o777).toBe(0o700);
    const onDisk = await readFile(server.descriptorPath, "utf8");
    expect(onDisk).not.toContain("journal.key");
  });

  it("preserves typed evidence and request digests without exporting the journal key", async () => {
    const { client, stateRoot } = await fixture();
    const native = await OperationJournal.open({ stateRoot });
    const material = { missing: undefined, date: new Date(AT), bytes: new Uint8Array([0, 128, 255]), list: [undefined, "private prompt"] };
    expect(await client.evidenceDigest("rpc-test", material)).toBe(native.evidenceDigest("rpc-test", material));
    const request: OperationSubmitRequestV1 = {
      schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION, operationId: OPERATION_ID,
      surface: "chat", target: { type: "new" }, prompt: "private prompt"
    };
    expect(await client.submitRequestDigest(request, [])).toBe(native.submitRequestDigest(request, []));
  });

  it("keeps concurrent clients under compare-and-swap and returns real journal errors", async () => {
    const { client, descriptor } = await fixture();
    const second = createJournalRpcClient({ ...descriptor, timeoutMs: 1000 });
    await client.create(created());
    const results = await Promise.allSettled([
      client.append(OPERATION_ID, 1, observed()), second.append(OPERATION_ID, 1, observed())
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(OperationJournalError);
    expect(rejected.reason.code).toBe("revision_conflict");
    expect((await client.load(OPERATION_ID)).state.revision).toBe(2);
  });

  it("rejects unauthenticated requests without admitting any journal mutation", async () => {
    const { stateRoot, descriptor } = await fixture();
    const wrong = createJournalRpcClient({ ...descriptor, token: "A".repeat(43), timeoutMs: 70 });
    await expect(wrong.create(created())).rejects.toMatchObject({ code: "journal_rpc_outcome_indeterminate" });
    expect(await readdir(join(stateRoot, "logs"))).toEqual([]);
  });

  it("rejects exposed, symlinked and ancestor-symlink descriptor paths", async () => {
    const { base, server } = await fixture();
    await chmod(server.descriptorPath, 0o644);
    await expect(readJournalRpcDescriptor(server.descriptorPath)).rejects.toMatchObject({ code: "journal_rpc_unavailable" });
    await chmod(server.descriptorPath, 0o600);
    await symlink(server.descriptorPath, join(base, "descriptor-link.json"));
    await expect(readJournalRpcDescriptor(join(base, "descriptor-link.json"))).rejects.toMatchObject({ code: "journal_rpc_unavailable" });
    await symlink(join(base, "session"), join(base, "session-link"));
    await expect(readJournalRpcDescriptor(join(base, "session-link", "connection.json"))).rejects.toMatchObject({ code: "journal_rpc_unavailable" });
  });

  it("reconnects explicitly after restart while retaining the same durable key domain", async () => {
    const { client, base, stateRoot, server, descriptor } = await fixture();
    await client.create(created());
    const oldDigest = await client.evidenceDigest("rpc-test", "evidence");
    await server.close();
    const restarted = await startJournalRpcServer({ stateRoot, directory: join(base, "session-2") });
    servers.push(restarted);
    const fresh = await createJournalRpcClientFromDescriptor(restarted.descriptorPath, { timeoutMs: 1000 });
    expect((await fresh.load(OPERATION_ID)).state.revision).toBe(1);
    expect(await fresh.evidenceDigest("rpc-test", "evidence")).toBe(oldDigest);
    const stale = createJournalRpcClient({ ...descriptor, timeoutMs: 50 });
    await expect(stale.load(OPERATION_ID)).rejects.toMatchObject({ code: "journal_rpc_unavailable" });
  });

  it("reports an indeterminate append after a lost response and never appends twice", async () => {
    const { client, descriptor, stateRoot } = await fixture();
    await client.create(created());
    const nativeAppend = OperationJournal.prototype.append;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const append = vi.spyOn(OperationJournal.prototype, "append").mockImplementation(async function (this: OperationJournal, ...args) {
      const result = await nativeAppend.apply(this, args);
      await held;
      return result;
    });
    const fast = createJournalRpcClient({ ...descriptor, timeoutMs: 70 });
    await expect(fast.append(OPERATION_ID, 1, observed())).rejects.toMatchObject({ code: "journal_rpc_outcome_indeterminate" });
    expect(append).toHaveBeenCalledTimes(1);
    release();
    const native = await OperationJournal.open({ stateRoot });
    expect((await native.load(OPERATION_ID)).state.revision).toBe(2);
  });

  it("treats a post-persistence journal error as an indeterminate write", async () => {
    const { client, stateRoot } = await fixture();
    await client.create(created());
    const nativeAppend = OperationJournal.prototype.append;
    const append = vi.spyOn(OperationJournal.prototype, "append").mockImplementation(async function (this: OperationJournal, ...args) {
      await nativeAppend.apply(this, args);
      throw new OperationJournalError("journal_quota_counter_corrupt", "private failure detail");
    });
    await expect(client.append(OPERATION_ID, 1, observed())).rejects.toMatchObject({
      code: "journal_rpc_outcome_indeterminate",
      message: "Journal authority request failed (journal_rpc_outcome_indeterminate)."
    });
    expect(append).toHaveBeenCalledTimes(1);
    const native = await OperationJournal.open({ stateRoot });
    expect((await native.load(OPERATION_ID)).state.revision).toBe(2);
  });

  it("applies publication backpressure for manifests larger than the mailbox budget", async () => {
    const { descriptor } = await fixture({ maxPendingEntries: 8 });
    const client = createJournalRpcClient({ ...descriptor, timeoutMs: 5000 });
    const values = await Promise.all(Array.from({ length: 160 }, (_, index) => client.evidenceDigest("rpc-test", index)));
    expect(new Set(values).size).toBe(160);
  });

  it("expires a queued write within its original deadline and never publishes it later", async () => {
    const { descriptor, directory, stateRoot } = await fixture();
    const client = createJournalRpcClient({ ...descriptor, timeoutMs: 100 });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const publication = vi.spyOn(journalRpcProtocol, "publishPrivateFile").mockImplementation(async () => { await held; });
    const active = Array.from({ length: 4 }, (_, index) => Promise.resolve(client.evidenceDigest("rpc-test", index)).catch(error => error.code));
    try {
      await vi.waitFor(() => expect(publication).toHaveBeenCalledTimes(4));
      await expect(client.create(created())).rejects.toMatchObject({ code: "journal_rpc_unavailable" });
      expect(publication).toHaveBeenCalledTimes(4);
    } finally {
      release();
      await Promise.all(active);
    }
    await rpcSleep(20);
    expect(publication).toHaveBeenCalledTimes(4);
    expect(await readdir(join(directory, "requests"))).toEqual([]);
    expect(await readdir(join(stateRoot, "logs"))).toEqual([]);
  });

  it("limits active work and fails closed on oversized mailbox scans", async () => {
    const { client, directory, descriptor } = await fixture({ maxConcurrent: 1, maxPendingEntries: 2 });
    const native = OperationJournal.prototype.evidenceDigest;
    let active = 0;
    let maximum = 0;
    const spy = vi.spyOn(OperationJournal.prototype, "evidenceDigest").mockImplementation(function (this: OperationJournal, ...args) {
      active += 1; maximum = Math.max(maximum, active);
      const result = native.apply(this, args); active -= 1; return result;
    });
    await Promise.all([client.evidenceDigest("rpc-test", 1), client.evidenceDigest("rpc-test", 2)]);
    expect(maximum).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 3; index += 1) await writeFile(join(directory, "requests", `unrelated-${index}`), "x", { mode: 0o600 });
    const fast = createJournalRpcClient({ ...descriptor, timeoutMs: 70 });
    await expect(fast.evidenceDigest("rpc-test", 3)).rejects.toMatchObject({ code: "journal_rpc_unavailable" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("rejects authenticated method substitution and stale requests", async () => {
    const { directory, descriptor } = await fixture();
    for (const method of ["deleteAll", "create"]) {
      const id = randomUUID();
      const value = { method, args: [created()], issuedAt: Date.now() - 60_000, expiresAt: Date.now() - 30_000 };
      await publishPrivateFile(join(directory, "requests"), `${id}.request.json`, sealRpcValue(descriptor, id, "request", value));
      await rpcSleep(30);
      const response = openRpcValue(descriptor, id, "response", await readFile(join(directory, "responses", `${id}.response.json`), "utf8"));
      expect(response).toEqual({ ok: false, error: { code: "journal_rpc_protocol_error" } });
    }
  });

  it("caps authenticated malformed requests as well as valid request history", async () => {
    const { directory, descriptor } = await fixture({ maxRecentRequests: 2 });
    const create = vi.spyOn(OperationJournal.prototype, "create");
    for (let index = 0; index < 3; index += 1) {
      const id = randomUUID();
      await publishPrivateFile(join(directory, "requests"), `${id}.request.json`,
        sealRpcValue(descriptor, id, "request", { malformed: true }));
      await rpcSleep(20);
    }
    expect(await readdir(join(directory, "responses"))).toHaveLength(2);
    expect(await readdir(join(directory, "requests"))).toHaveLength(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects repeated authenticated request IDs without executing again", async () => {
    const { directory, descriptor } = await fixture();
    const create = vi.spyOn(OperationJournal.prototype, "create");
    const id = randomUUID();
    const value = { method: "create", args: [created()], issuedAt: Date.now(), expiresAt: Date.now() + 1000 };
    const wire = sealRpcValue(descriptor, id, "request", value);
    await publishPrivateFile(join(directory, "requests"), `${id}.request.json`, wire);
    await vi.waitFor(async () => expect(await readdir(join(directory, "responses"))).toHaveLength(1));
    await publishPrivateFile(join(directory, "requests"), `${id}.request.json`, wire);
    await rpcSleep(30);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects a response bound to a different operation", async () => {
    const { client } = await fixture();
    await client.create(created());
    const nativeLoad = OperationJournal.prototype.load;
    vi.spyOn(OperationJournal.prototype, "load").mockImplementation(async function (this: OperationJournal, ...args) {
      const value = await nativeLoad.apply(this, args);
      return { ...value, state: { ...value.state, operationId: randomUUID() } };
    });
    await expect(client.load(OPERATION_ID)).rejects.toMatchObject({ code: "journal_rpc_protocol_error" });
  });

  it("rejects getters/functions before any mailbox publication", async () => {
    const { client, directory } = await fixture();
    const getter = vi.fn(() => "private");
    const material = Object.defineProperty({}, "secret", { get: getter, enumerable: true });
    await expect(client.evidenceDigest("rpc-test", material)).rejects.toMatchObject({ code: "journal_rpc_unavailable" });
    await expect(client.evidenceDigest("rpc-test", { callback: () => undefined })).rejects.toMatchObject({ code: "journal_rpc_unavailable" });
    expect(getter).not.toHaveBeenCalled();
    expect(await readdir(join(directory, "requests"))).toEqual([]);
  });
});

// Encryption and protocol validation do not depend on filesystem authority.
it("encrypts payloads and rejects tampering, instance and direction substitution on every platform", () => {
  const descriptor = {
    schemaVersion: "chatgpt.journal_rpc.descriptor.v1" as const, transport: "file" as const,
    directory: join(tmpdir(), "synthetic-unopened-journal-session"), instanceId: randomUUID(), token: randomBytes(32).toString("base64url")
  };
  const id = randomUUID();
  const wire = sealRpcValue(descriptor, id, "request", { secret: "private-prompt-never-on-disk" });
  expect(wire).not.toContain("private-prompt-never-on-disk");
  expect(wire).not.toContain(descriptor.token);
  expect(openRpcValue(descriptor, id, "request", wire)).toEqual({ secret: "private-prompt-never-on-disk" });
  const changed = JSON.parse(wire);
  changed.body = `${changed.body[0] === "A" ? "B" : "A"}${changed.body.slice(1)}`;
  expect(() => openRpcValue(descriptor, id, "request", JSON.stringify(changed))).toThrowError(/journal_rpc_authentication_failed/u);
  expect(() => openRpcValue(descriptor, id, "response", wire)).toThrowError(/journal_rpc_authentication_failed/u);
  expect(() => openRpcValue({ ...descriptor, instanceId: randomUUID() }, id, "request", wire)).toThrowError(/journal_rpc_authentication_failed/u);
});
