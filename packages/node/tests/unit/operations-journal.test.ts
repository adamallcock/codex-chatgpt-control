import { hostname, tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  appendFile,
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const { opendirMock } = vi.hoisted(() => ({ opendirMock: vi.fn() }));

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  opendirMock.mockImplementation((...args: Parameters<typeof actual.opendir>) => actual.opendir(...args));
  return {
    ...actual,
    opendir: (...args: Parameters<typeof actual.opendir>) => opendirMock(...args)
  };
});
import { hmacDigest, operationRequestDigest } from "../../src/operations/canonical.js";
import {
  OperationJournal,
  OperationJournalError,
  type OperationJournalClock,
  type OperationJournalEntropy
} from "../../src/operations/journal.js";
import { OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION, OPERATION_RECEIPT_SCHEMA_VERSION, OPERATION_REQUEST_SCHEMA_VERSION, OPERATION_SUBMISSION_WITNESS_SCHEMA_VERSION, type OperationEventV1, type OperationPhase, type MutationBoundary, type OperationTargetBindingV1 } from "../../src/operations/types.js";
import { TURN_OWNERSHIP_SCHEMA_VERSION, type OwnershipBaseline, type OwnershipTargetEvidence } from "../../src/operations/turn-ownership.js";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_OPERATION_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_ACTION_ID = "44444444-4444-4444-8444-444444444444";
const THIRD_ACTION_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_DIGEST = `hmac-sha256:${"a".repeat(64)}`;
const OTHER_REQUEST_DIGEST = `hmac-sha256:${"b".repeat(64)}`;
const THIRD_REQUEST_DIGEST = `hmac-sha256:${"c".repeat(64)}`;
const AT = "2026-08-16T12:00:00.000Z";
const EVIDENCE_DIGEST = `hmac-sha256:${"e".repeat(64)}`;
const TARGET: OperationTargetBindingV1 = {
  providerId: "codex-chrome",
  browserId: "extension",
  tabId: "tab-1",
  coordinationScope: "process",
  canonicalThreadUrl: "https://chatgpt.com/c/example",
  conversationId: "example",
  evidenceProfile: {
    providerIdentity: "required",
    stableTabId: "required",
    stableConversationId: "required",
    stableUserTurnId: "required",
    authoritativeTabClaim: "unavailable",
    replacementTabRecovery: true
  }
};

const NEW_PENDING_TARGET: OperationTargetBindingV1 = {
  providerId: "codex-chrome",
  browserId: "extension",
  tabId: "tab-new",
  coordinationScope: "process",
  evidenceProfile: {
    providerIdentity: "required",
    stableTabId: "required",
    stableConversationId: "unavailable",
    stableUserTurnId: "unavailable",
    authoritativeTabClaim: "unavailable",
    replacementTabRecovery: false
  },
  targetLifecycle: "new_pending",
  newTargetAnchorDigest: EVIDENCE_DIGEST,
  blankTaskEvidenceDigest: EVIDENCE_DIGEST
};

describe("operation journal", () => {
  it.each([
    undefined,
    { pid: 0, env: {}, kill: () => true, getuid: (): number => 0 },
    { pid: 1, env: {}, getuid: (): number => 0 },
    { pid: 1, env: {}, kill: () => { throw new Error("host details"); }, getuid: (): number => 0 },
    ...(process.platform === "win32" ? [] : [
      { pid: 1, env: {}, kill: () => true },
      { pid: 1, env: {}, kill: () => true, getuid: (): number => -1 }
    ])
  ])("blocks unsupported host capabilities before writing state (%#)", async runtime => {
    const parent = await mkdtemp(join(tmpdir(), "journal-host-"));
    const root = join(parent, "must-not-exist");
    let opening: Promise<OperationJournal>;
    vi.stubGlobal("process", runtime);
    try { opening = OperationJournal.open({ stateRoot: root }); }
    finally { vi.unstubAllGlobals(); }
    try {
      await expect(opening!).rejects.toMatchObject({ code: "journal_runtime_unavailable" });
      await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("creates restrictive keyed state with opaque paths and reloads the hash chain", async () => {
    const root = await testRoot("basic");
    const journal = await OperationJournal.open({ stateRoot: root });
    const first = await journal.create(created());
    const second = await journal.append(OPERATION_ID, 1, statusIntent(ACTION_ID));
    const loaded = await journal.load(OPERATION_ID, REQUEST_DIGEST);

    expect(first.state.revision).toBe(1);
    expect(second.state.revision).toBe(2);
    expect(loaded.state).toEqual(second.state);
    expect(loaded.envelopes[1]?.previousEventDigest).toBe(loaded.envelopes[0]?.eventDigest);
    expect(loaded.envelopes.every(envelope => /^hmac-sha256:[0-9a-f]{64}$/.test(envelope.eventDigest))).toBe(true);

    const [logName] = await readdir(join(root, "logs"));
    expect(logName).toMatch(/^[0-9a-f]{64}\.jsonl$/);
    expect(logName).not.toContain(OPERATION_ID);
    if (process.platform !== "win32") {
      expect((await stat(root)).mode & 0o777).toBe(0o700);
      expect((await stat(join(root, "journal.key"))).mode & 0o777).toBe(0o600);
      expect((await stat(join(root, "logs", logName!))).mode & 0o777).toBe(0o600);
    }
    expect((await readFile(join(root, "journal.key"))).byteLength).toBe(32);
  });

  it("treats same-ID/same-digest creation as idempotent and rejects identity drift", async () => {
    const journal = await OperationJournal.open({ stateRoot: await testRoot("identity") });
    const first = await journal.create(created());
    const resumed = await journal.create(created());

    expect(resumed.state).toEqual(first.state);
    await expect(journal.create(created(OPERATION_ID, OTHER_REQUEST_DIGEST))).rejects.toMatchObject({
      code: "operation_request_mismatch"
    });
  });

  it("atomically establishes one key domain for concurrent first openers", async () => {
    const root = await testRoot("concurrent-key");
    const journals = await Promise.all(Array.from({ length: 8 }, () => OperationJournal.open({ stateRoot: root })));
    const createdStates = await Promise.all(journals.map(journal => journal.create(created())));

    expect(createdStates.every(result => result.state.requestDigest === REQUEST_DIGEST)).toBe(true);
    expect(await readdir(join(root, "logs"))).toHaveLength(1);
    expect((await readFile(join(root, "journal.key"))).byteLength).toBe(32);
  });

  it("uses deterministic clock and entropy seams for identity, lock records, and atomic temp names", async () => {
    const root = await testRoot("deterministic-seams");
    const uuidValues = Array.from({ length: 12 }, (_, index) => testUuid(index + 1));
    const calls: string[] = [];
    const entropy: OperationJournalEntropy = {
      randomBytes: size => {
        calls.push(`bytes:${size}`);
        return Buffer.alloc(size, 0x5a);
      },
      randomUUID: () => {
        const value = uuidValues.shift();
        if (value === undefined) throw new Error("test entropy exhausted");
        calls.push(value);
        return value;
      }
    };
    const clock: OperationJournalClock = {
      now: () => Date.parse(AT),
      sleep: () => undefined
    };
    let lockRecord: Record<string, unknown> | undefined;
    const journal = await OperationJournal.open({
      stateRoot: root,
      clock,
      entropy,
      faultInjector: async point => {
        if (point !== "after_lock_acquired" || lockRecord !== undefined) return;
        const [lockName] = await readdir(join(root, "locks"));
        lockRecord = JSON.parse(await readFile(join(root, "locks", lockName!), "utf8")) as Record<string, unknown>;
      }
    });
    await journal.create(created());
    await journal.refreshSnapshot(OPERATION_ID);

    expect(lockRecord).toMatchObject({
      schemaVersion: "chatgpt.browser_control.operation_lock.v1",
      token: testUuid(4),
      createdAt: AT
    });
    expect(calls).toEqual([
      "bytes:32",
      ...Array.from({ length: 12 }, (_, index) => testUuid(index + 1))
    ]);
    expect(uuidValues).toEqual([]);
  });

  it("fails closed on a deterministic temporary-name collision without deleting the pre-existing file", async () => {
    const root = await testRoot("deterministic-temp-collision");
    const entropy = deterministicEntropy();
    const journal = await OperationJournal.open({
      stateRoot: root,
      entropy,
      clock: { now: () => Date.parse(AT), sleep: () => undefined }
    });
    await journal.create(created());
    const [logName] = await readdir(join(root, "logs"));
    const stem = logName!.replace(/\.jsonl$/, "");
    const temporaryPath = join(
      root,
      "snapshots",
      `.${stem}.snapshot.json-99999999-9999-4999-8999-999999999999.tmp`
    );
    await writeFile(temporaryPath, "pre-existing temporary state\n", { mode: 0o600 });

    const error = await journal.refreshSnapshot(OPERATION_ID).catch(reason => reason as OperationJournalError);
    expect(error).toMatchObject({
      code: "journal_temp_conflict",
      message: "A temporary operation state file already exists."
    });
    expect(await readFile(temporaryPath, "utf8")).toBe("pre-existing temporary state\n");
    await unlink(temporaryPath);
  });

  it("times out deterministically and redacts lock owner details", async () => {
    const root = await testRoot("deterministic-lock-timeout");
    let now = Date.parse(AT);
    const clock: OperationJournalClock = {
      now: () => now,
      sleep: milliseconds => { now += milliseconds; }
    };
    const entropy = deterministicEntropy();
    const journal = await OperationJournal.open({ stateRoot: root, clock, entropy, lockTimeoutMs: 20 });
    await journal.create(created());
    const logPath = await onlyLog(root);
    const stem = basename(logPath).replace(/\.jsonl$/, "");
    const lockPath = join(root, "locks", `${stem}.lock`);
    await writeFile(lockPath, `${JSON.stringify({
      schemaVersion: "chatgpt.browser_control.operation_lock.v1",
      token: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      pid: process.pid,
      hostname: hostname(),
      createdAt: AT
    })}\n`, { mode: 0o600 });

    const error = await journal.load(OPERATION_ID).catch(reason => reason as OperationJournalError);
    expect(error).toMatchObject({
      code: "journal_lock_timeout",
      message: "Timed out waiting for the operation journal lock."
    });
    expect(error).toBeInstanceOf(OperationJournalError);
    if (!(error instanceof OperationJournalError)) throw new Error("expected journal lock timeout");
    expect(error.message).not.toContain(root);
    expect(error.message).not.toContain(hostname());
    expect(error.message).not.toContain(String(process.pid));
  });

  it.each([
    ["constant", (value: number, _milliseconds: number) => value],
    ["backwards", (value: number, milliseconds: number) => value - milliseconds]
  ])("bounds lock retries when the injected wall clock moves %s", async (_label, advance) => {
    const root = await testRoot(`bounded-${_label}-clock`);
    let now = Date.parse(AT);
    let sleeps = 0;
    const clock: OperationJournalClock = {
      now: () => now,
      sleep: milliseconds => {
        sleeps += 1;
        now = advance(now, milliseconds);
      }
    };
    const journal = await OperationJournal.open({
      stateRoot: root,
      clock,
      entropy: deterministicEntropy(),
      lockTimeoutMs: 20
    });
    await journal.create(created());
    const logPath = await onlyLog(root);
    const stem = basename(logPath).replace(/\.jsonl$/, "");
    await writeFile(join(root, "locks", `${stem}.lock`), `${JSON.stringify({
      schemaVersion: "chatgpt.browser_control.operation_lock.v1",
      token: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      pid: process.pid,
      hostname: hostname(),
      createdAt: AT
    })}\n`, { mode: 0o600 });

    await expect(journal.load(OPERATION_ID)).rejects.toMatchObject({ code: "journal_lock_timeout" });
    expect(sleeps).toBe(2);
  });

  it("rejects malformed injected entropy or clock values without secure fallback", async () => {
    const malformedEntropyRoot = await testRoot("malformed-entropy");
    const malformedEntropy: OperationJournalEntropy = {
      randomBytes: () => new Uint8Array(31),
      randomUUID: () => "not-a-uuid"
    };
    const entropyError = await OperationJournal.open({
      stateRoot: malformedEntropyRoot,
      entropy: malformedEntropy
    }).catch(reason => reason as OperationJournalError);
    expect(entropyError).toMatchObject({
      code: "invalid_journal_entropy",
      message: "Operation journal entropy returned key bytes with an invalid length."
    });
    expect(entropyError).toBeInstanceOf(OperationJournalError);
    if (!(entropyError instanceof OperationJournalError)) throw new Error("expected journal entropy failure");
    expect(entropyError.message).not.toContain("not-a-uuid");

    const zeroEntropyRoot = await testRoot("zero-entropy");
    const zeroEntropy: OperationJournalEntropy = {
      randomBytes: size => new Uint8Array(size),
      randomUUID: () => "11111111-1111-4111-8111-111111111111"
    };
    const zeroError = await OperationJournal.open({ stateRoot: zeroEntropyRoot, entropy: zeroEntropy })
      .catch(reason => reason as OperationJournalError);
    expect(zeroError).toMatchObject({
      code: "invalid_journal_entropy",
      message: "Operation journal entropy returned an invalid key."
    });

    const malformedClockRoot = await testRoot("malformed-clock");
    const clockError = await OperationJournal.open({
      stateRoot: malformedClockRoot,
      entropy: deterministicEntropy(),
      clock: { now: () => Number.NaN, sleep: () => undefined }
    }).catch(reason => reason as OperationJournalError);
    expect(clockError).toMatchObject({
      code: "invalid_journal_clock",
      message: "Operation journal clock returned an invalid timestamp."
    });
  });

  it("rejects an all-zero persisted journal key without replacing its identity domain", async () => {
    const root = await testRoot("persisted-zero-key");
    await OperationJournal.open({ stateRoot: root });
    const keyPath = join(root, "journal.key");
    await writeFile(keyPath, Buffer.alloc(32), { mode: 0o600 });

    await expect(OperationJournal.open({ stateRoot: root })).rejects.toMatchObject({
      code: "invalid_journal_key",
      message: "Operation journal key is invalid."
    });
    expect(await readFile(keyPath)).toEqual(Buffer.alloc(32));
  });

  it("keeps request identity stable within one state root without exposing the key", async () => {
    const root = await testRoot("request-identity");
    const first = await OperationJournal.open({ stateRoot: root });
    const reopened = await OperationJournal.open({ stateRoot: root });
    const different = await OperationJournal.open({ stateRoot: await testRoot("request-identity-other") });
    const request = {
      schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
      operationId: OPERATION_ID,
      surface: "chat" as const,
      prompt: "private prompt",
      target: { type: "new" as const }
    };
    const digest = first.submitRequestDigest(request, []);
    expect(reopened.submitRequestDigest(request, [])).toBe(digest);
    expect(different.submitRequestDigest(request, [])).not.toBe(digest);
    expect(digest).not.toContain("private prompt");

    const evidence = first.evidenceDigest("assistant-turn", { text: "private response", ordinal: 1 });
    expect(reopened.evidenceDigest("assistant-turn", { ordinal: 1, text: "private response" })).toBe(evidence);
    expect(different.evidenceDigest("assistant-turn", { text: "private response", ordinal: 1 })).not.toBe(evidence);
    expect(evidence).not.toContain("private response");
    expect(() => first.evidenceDigest("../unsafe", {})).toThrow(/domain/i);
    expect(() => first.evidenceDigest("assistant-turn", { value: Number.NaN })).toThrow(/canonical JSON/i);
  });

  it("uses expected revision compare-and-swap for concurrent writers", async () => {
    const journal = await OperationJournal.open({ stateRoot: await testRoot("cas") });
    await journal.create(created());

    const attempts = await Promise.allSettled([
      journal.append(OPERATION_ID, 1, statusIntent(ACTION_ID)),
      journal.append(OPERATION_ID, 1, statusIntent(SECOND_ACTION_ID))
    ]);
    expect(attempts.filter(attempt => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find(attempt => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "revision_conflict" } });
    expect((await journal.load(OPERATION_ID)).state.revision).toBe(2);
  });

  it("ignores then truncates only a partial final append", async () => {
    const root = await testRoot("partial");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    const logPath = await onlyLog(root);
    await appendFile(logPath, "{\"partial\":", "utf8");

    const observed = await journal.load(OPERATION_ID);
    expect(observed.state.revision).toBe(1);
    expect(observed.partialTailBytes).toBeGreaterThan(0);

    const repaired = await journal.append(OPERATION_ID, 1, statusIntent(ACTION_ID));
    expect(repaired.state.revision).toBe(2);
    expect(repaired.partialTailBytes).toBe(0);
    expect((await readFile(logPath, "utf8")).endsWith("\n")).toBe(true);
  });

  it("recovers an existing partial first record without getting stuck in exclusive-create conflict", async () => {
    const root = await testRoot("partial-first-record");
    let interrupt = true;
    const interrupted = await OperationJournal.open({
      stateRoot: root,
      faultInjector: point => {
        if (point === "after_record_written" && interrupt) {
          interrupt = false;
          throw new Error("simulated first-record tear");
        }
      }
    });
    await expect(interrupted.create(created())).rejects.toThrow("simulated first-record tear");
    const logPath = await onlyLog(root);
    await writeFile(logPath, '{"schemaVersion":', { mode: 0o600 });

    const recovered = await OperationJournal.open({ stateRoot: root });
    const createdState = await recovered.create(created());

    expect(createdState.state.revision).toBe(1);
    expect(createdState.partialTailBytes).toBe(0);
    expect((await readFile(logPath, "utf8")).endsWith("\n")).toBe(true);
  });

  it("fails closed on committed corruption and unknown schemas", async () => {
    const root = await testRoot("corrupt");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    const logPath = await onlyLog(root);
    const record = JSON.parse((await readFile(logPath, "utf8")).trim()) as Record<string, unknown>;
    record.eventDigest = `hmac-sha256:${"f".repeat(64)}`;
    await writeFile(logPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    await expect(journal.load(OPERATION_ID)).rejects.toMatchObject({ code: "journal_corrupt" });

    record.schemaVersion = "chatgpt.browser_control.operation_event.v999";
    await writeFile(logPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    await expect(journal.load(OPERATION_ID)).rejects.toMatchObject({ code: "journal_corrupt" });
  });

  it("rejects authenticated envelopes with forward or private extra fields before digest evaluation", async () => {
    const root = await testRoot("envelope-extra-field");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    const logPath = await onlyLog(root);
    const record = JSON.parse((await readFile(logPath, "utf8")).trim()) as Record<string, unknown>;
    record.rawPrompt = "must never be accepted";
    await writeFile(logPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });

    await expect(journal.load(OPERATION_ID)).rejects.toThrow(/unexpected fields/);
  });

  it("refuses to replace a missing key when durable logs exist", async () => {
    const root = await testRoot("missing-key");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    await unlink(join(root, "journal.key"));

    await expect(OperationJournal.open({ stateRoot: root })).rejects.toMatchObject({
      code: "journal_key_missing_with_state"
    });
  });

  it("blocks a new operation at quota without deleting existing evidence", async () => {
    const root = await testRoot("quota");
    const initial = await OperationJournal.open({ stateRoot: root });
    await initial.create(created());
    const existingSize = (await stat(await onlyLog(root))).size;
    const constrained = await OperationJournal.open({ stateRoot: root, maxStateBytes: existingSize + 1 });

    await expect(constrained.create(created(SECOND_OPERATION_ID))).rejects.toMatchObject({
      code: "journal_quota_exceeded"
    });
    expect((await constrained.load(OPERATION_ID)).state.requestDigest).toBe(REQUEST_DIGEST);
    expect(await readdir(join(root, "logs"))).toHaveLength(1);
  });

  it("serializes quota admission across different operation locks", async () => {
    const probeRoot = await testRoot("quota-race-probe");
    const probe = await OperationJournal.open({ stateRoot: probeRoot });
    await probe.create(created());
    const oneOperationBytes = await durableStateBytes(probeRoot);

    const root = await testRoot("quota-race");
    const first = await OperationJournal.open({ stateRoot: root, maxStateBytes: oneOperationBytes });
    const second = await OperationJournal.open({ stateRoot: root, maxStateBytes: oneOperationBytes });
    const attempts = await Promise.allSettled([
      first.create(created()),
      second.create(created(SECOND_OPERATION_ID, OTHER_REQUEST_DIGEST))
    ]);

    expect(attempts.filter(attempt => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(attempt => attempt.status === "rejected")).toHaveLength(1);
    expect(attempts.find(attempt => attempt.status === "rejected")).toMatchObject({
      reason: { code: "journal_quota_exceeded" }
    });
    expect(await readdir(join(root, "logs"))).toHaveLength(1);
  });

  it("keeps an authenticated quota counter exact across append, snapshot, compaction, prune, and purge", async () => {
    const root = await testRoot("quota-counter-lifecycle");
    const journal = await OperationJournal.open({ stateRoot: root });

    await expectQuotaCounterMatchesState(root);
    await writeCompleted(journal);
    await expectQuotaCounterMatchesState(root);
    await journal.refreshSnapshot(OPERATION_ID);
    await expectQuotaCounterMatchesState(root);
    await journal.compactCompleted(OPERATION_ID);
    await expectQuotaCounterMatchesState(root);
    await journal.pruneReceipt(OPERATION_ID);
    await expectQuotaCounterMatchesState(root);
    await journal.purgeTombstone(OPERATION_ID, { acknowledge: true });
    const finalCounter = await expectQuotaCounterMatchesState(root);

    expect(finalCounter.totalBytes).toBe(0);
    expect(finalCounter.entryCount).toBe(0);
    expect(finalCounter.dirty).toBe(false);
    expect(finalCounter.counterDigest).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    if (process.platform !== "win32") {
      expect((await stat(join(root, "quota-state.json"))).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects quota-counter tampering instead of silently trusting or replacing it", async () => {
    const root = await testRoot("quota-counter-tamper");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    const path = join(root, "quota-state.json");
    const counter = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    counter.totalBytes = Number(counter.totalBytes) + 1;
    await writeFile(path, `${JSON.stringify(counter)}\n`, { mode: 0o600 });

    await expect(OperationJournal.open({ stateRoot: root })).rejects.toMatchObject({
      code: "journal_quota_counter_corrupt"
    });
  });

  it("rebuilds an authenticated dirty counter before the next admission", async () => {
    const root = await testRoot("quota-counter-dirty-recovery");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    const path = join(root, "quota-state.json");
    const counter = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const material: Record<string, unknown> = {
      ...counter,
      revision: Number(counter.revision) + 1,
      dirty: true
    };
    delete material.counterDigest;
    const key = await readFile(join(root, "journal.key"));
    const dirty = {
      ...material,
      counterDigest: hmacDigest(
        key,
        "codex-chatgpt-control/operation-quota-state/v1",
        material
      )
    };
    await writeFile(path, `${JSON.stringify(dirty)}\n`, { mode: 0o600 });

    const resumed = await OperationJournal.open({ stateRoot: root });
    await resumed.create(created(SECOND_OPERATION_ID, OTHER_REQUEST_DIGEST));
    const repaired = await expectQuotaCounterMatchesState(root);
    expect(repaired.dirty).toBe(false);
    expect(repaired.revision).toBeGreaterThan(Number(counter.revision));
  });

  it("fails closed on a quota directory entry flood without materializing it", async () => {
    const root = await testRoot("quota-entry-flood");
    try {
      const journal = await OperationJournal.open({ stateRoot: root });
      // Change the real directory fingerprint, then stream cap-plus-one
      // synthetic ignored entries through opendir. This exercises the exact
      // production scan boundary without allocating or deleting 65,537 files.
      await writeFile(join(root, "logs", ".DS_Store"), "", { mode: 0o600 });
      let yielded = 0;
      let closed = 0;
      opendirMock.mockImplementationOnce(async () => syntheticDirectoryEntries(
        65_537,
        () => { yielded += 1; },
        () => { closed += 1; }
      ));

      await expect(journal.create(created(SECOND_OPERATION_ID))).rejects.toMatchObject({
        code: "journal_scan_limit"
      });
      expect(yielded).toBe(65_537);
      expect(closed).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never persists raw prompt, response, path, or display-name data", async () => {
    const root = await testRoot("privacy");
    const journal = await OperationJournal.open({ stateRoot: root });
    const sensitive = {
      prompt: "private prompt alpha beta",
      displayName: "tax-return-secret.pdf",
      path: "/example/user/Private/tax-return-secret.pdf",
      response: "private response gamma delta"
    };
    const requestDigest = operationRequestDigest(Buffer.alloc(32, 0x11), {
      operationId: OPERATION_ID,
      surface: "chat",
      target: { type: "new" },
      prompt: sensitive.prompt,
      files: [{ displayName: sensitive.displayName, bytes: 8, contentSha256: "d".repeat(64) }]
    });
    await journal.create(created(OPERATION_ID, requestDigest));

    const corpus = (await Promise.all((await readdir(root, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(async entry => readFile(join(entry.parentPath, entry.name)))))
      .map(bytes => bytes.toString("utf8"))
      .join("\n");
    for (const privateValue of Object.values(sensitive)) expect(corpus).not.toContain(privateValue);
  });

  it("rejects runtime-only extra fields before they enter a checksummed event", async () => {
    const root = await testRoot("privacy-shape");
    const journal = await OperationJournal.open({ stateRoot: root });
    const unsafe = { ...created(), rawPrompt: "private prompt must not be journaled" } as unknown as Extract<OperationEventV1, { type: "operation_created" }>;

    await expect(journal.create(unsafe)).rejects.toMatchObject({ code: "invalid_operation_event" });
    expect(await readdir(join(root, "logs"))).toEqual([]);
    const corpus = (await Promise.all((await readdir(root, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(async entry => readFile(join(entry.parentPath, entry.name), "utf8"))))
      .join("\n");
    expect(corpus).not.toContain("private prompt must not be journaled");
  });

  it("recovers a dead-owner lock and rejects symlinked operation logs", async () => {
    const root = await testRoot("filesystem-safety");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    const logPath = await onlyLog(root);
    const stem = basename(logPath).replace(/\.jsonl$/, "");
    const lockPath = join(root, "locks", `${stem}.lock`);
    await writeFile(lockPath, `${JSON.stringify({
      schemaVersion: "chatgpt.browser_control.operation_lock.v1",
      token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      pid: 2_147_483_647,
      hostname: hostname(),
      createdAt: AT
    })}\n`, { mode: 0o600 });
    expect((await journal.load(OPERATION_ID)).state.revision).toBe(1);

    if (process.platform !== "win32") {
      const target = join(root, "target.jsonl");
      await writeFile(target, "not a journal\n", { mode: 0o600 });
      await unlink(logPath);
      await symlink(target, logPath);
      await expect(journal.load(OPERATION_ID)).rejects.toMatchObject({ code: "unsafe_journal_entry" });
    }
  });

  it("never lets a competing reclaimer move the canonical lock without the recovery guard", async () => {
    const root = await testRoot("filesystem-reclaim-election");
    const journal = await OperationJournal.open({ stateRoot: root, lockTimeoutMs: 25 });
    await journal.create(created());
    const logPath = await onlyLog(root);
    const stem = basename(logPath).replace(/\.jsonl$/, "");
    const lockPath = join(root, "locks", `${stem}.lock`);
    const abandonedToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await writeFile(lockPath, `${JSON.stringify({
      schemaVersion: "chatgpt.browser_control.operation_lock.v1",
      token: abandonedToken,
      pid: 2_147_483_647,
      hostname: hostname(),
      createdAt: AT
    })}\n`, { mode: 0o600 });

    // Model another live process that already won the exclusive recovery
    // election.  This contender must wait/fail without renaming the canonical
    // path that the elected process is responsible for re-checking.
    const guardPath = `${lockPath}.reclaim`;
    await writeFile(guardPath, `${JSON.stringify({
      schemaVersion: "chatgpt.browser_control.operation_lock.v1",
      token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      pid: process.pid,
      hostname: hostname(),
      createdAt: AT
    })}\n`, { mode: 0o600 });

    await expect(journal.load(OPERATION_ID)).rejects.toMatchObject({ code: "journal_lock_timeout" });
    expect(await readFile(lockPath, "utf8")).toContain(abandonedToken);

    await unlink(guardPath);
    expect((await journal.load(OPERATION_ID)).state.revision).toBe(1);
    expect(await readdir(join(root, "locks"))).toEqual([]);
  });

  it("fails closed instead of age-reclaiming an abandoned recovery guard", async () => {
    const root = await testRoot("filesystem-abandoned-reclaim-guard");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    const logPath = await onlyLog(root);
    const stem = basename(logPath).replace(/\.jsonl$/, "");
    const lockPath = join(root, "locks", `${stem}.lock`);
    await writeFile(lockPath, `${JSON.stringify({
      schemaVersion: "chatgpt.browser_control.operation_lock.v1",
      token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      pid: 2_147_483_647,
      hostname: hostname(),
      createdAt: AT
    })}\n`, { mode: 0o600 });
    await writeFile(`${lockPath}.reclaim`, `${JSON.stringify({
      schemaVersion: "chatgpt.browser_control.operation_lock.v1",
      token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      pid: 2_147_483_646,
      hostname: hostname(),
      createdAt: AT
    })}\n`, { mode: 0o600 });

    await expect(journal.load(OPERATION_ID)).rejects.toMatchObject({
      code: "journal_lock_recovery_abandoned"
    });
    expect(await readFile(lockPath, "utf8")).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("rejects insecure existing roots", async () => {
    if (process.platform === "win32") return;
    const root = await testRoot("insecure");
    await chmod(root, 0o755);
    const error = await OperationJournal.open({ stateRoot: root }).catch(reason => reason as OperationJournalError);
    expect(error).toMatchObject({
      code: "unsafe_state_permissions",
      message: "Operation state path permissions must be 700 or stricter."
    });
    expect(error).toBeInstanceOf(OperationJournalError);
    if (!(error instanceof OperationJournalError)) throw new Error("expected unsafe journal root failure");
    expect(error.message).not.toContain(root);
  });

  it("releases its lock when fault injection throws after a durable record write", async () => {
    const root = await testRoot("fault");
    const journal = await OperationJournal.open({
      stateRoot: root,
      faultInjector: point => {
        if (point === "after_record_synced") throw new Error("simulated process interruption");
      }
    });
    await expect(journal.create(created())).rejects.toThrow("simulated process interruption");

    const recovered = await OperationJournal.open({ stateRoot: root });
    expect((await recovered.load(OPERATION_ID)).state.revision).toBe(1);
    expect(await readdir(join(root, "locks"))).toEqual([]);
  });

  it("durably adopts a complete record observed after a pre-fsync interruption", async () => {
    const root = await testRoot("pre-fsync-recovery");
    let interrupt = true;
    const journal = await OperationJournal.open({
      stateRoot: root,
      faultInjector: point => {
        if (point === "after_record_written" && interrupt) {
          interrupt = false;
          throw new Error("simulated interruption before record fsync");
        }
      }
    });
    await expect(journal.create(created())).rejects.toThrow("simulated interruption before record fsync");

    const recovered = await OperationJournal.open({ stateRoot: root });
    const loaded = await recovered.load(OPERATION_ID, REQUEST_DIGEST);
    expect(loaded.state.revision).toBe(1);
    expect(loaded.partialTailBytes).toBe(0);
    expect(await readdir(join(root, "locks"))).toEqual([]);
  });

  it("materializes an authenticated snapshot and compacts only a completed receipt", async () => {
    const root = await testRoot("compaction");
    const journal = await OperationJournal.open({ stateRoot: root });
    await writeCompleted(journal);

    const snapshot = await journal.refreshSnapshot(OPERATION_ID);
    expect(snapshot.state.phase).toBe("completed");
    expect(snapshot.lastEventDigest).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect((await readdir(join(root, "snapshots"))).length).toBe(1);

    const compacted = await journal.compactCompleted(OPERATION_ID);
    expect(compacted.status).toBe("compacted");
    expect(compacted.deletedLogBytes).toBeGreaterThan(0);
    expect(await readdir(join(root, "logs"))).toEqual([]);
    expect(await readdir(join(root, "terminals"))).toHaveLength(1);

    const loaded = await journal.load(OPERATION_ID, REQUEST_DIGEST);
    expect(loaded.state.phase).toBe("completed");
    expect(loaded.state.receipt?.assistantTurnId).toBe("assistant-turn-1");
    expect(loaded.envelopes).toEqual([]);
    expect((await journal.compactCompleted(OPERATION_ID)).status).toBe("already_compacted");
  });

  it("preserves every sequential Work ownership baseline and witness across terminal compaction", async () => {
    const root = await testRoot("sequential-work-compaction");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());

    const ownershipBaselineEvent = (
      actionId: string,
      redactCanonicalUrl = false
    ): Extract<OperationEventV1, { type: "ownership_baseline" }> => {
      const originalBaseline = makeOwnershipBaseline(TARGET);
      const baseline = redactCanonicalUrl
        ? {
            ...originalBaseline,
            target: {
              ...originalBaseline.target,
              canonicalThreadUrl: { status: "unavailable" as const, reason: "redacted" as const }
            }
          }
        : originalBaseline;
      return {
        type: "ownership_baseline",
        baseline: {
          schemaVersion: OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION,
          operationId: OPERATION_ID,
          requestDigest: REQUEST_DIGEST,
          targetBindingDigest: EVIDENCE_DIGEST,
          actionId,
          baseline,
          observedAt: AT
        }
      };
    };
    const witnessEvent = (
      actionId: string,
      actionKind: "send" | "work_steer",
      postSendDeltaDigest: string,
      operationUserEvidenceDigest: string,
      userTurnId: string
    ): Extract<OperationEventV1, { type: "submission_witness" }> => ({
      type: "submission_witness",
      witness: {
        schemaVersion: OPERATION_SUBMISSION_WITNESS_SCHEMA_VERSION,
        actionId,
        actionKind,
        targetBindingDigest: EVIDENCE_DIGEST,
        baselineSnapshotDigest: EVIDENCE_DIGEST,
        postSendDeltaDigest,
        operationUserEvidenceDigest,
        userTurnId,
        observedAt: AT
      }
    });

    const events: OperationEventV1[] = [
      { type: "target_bound", target: TARGET, observedAt: AT },
      phaseEvent("prepared", "ready", "none", undefined, EVIDENCE_DIGEST),
      {
        type: "action_intent",
        action: {
          actionId: ACTION_ID,
          kind: "send",
          repeatPolicy: "observe_only_after_intent",
          requestDigest: REQUEST_DIGEST,
          targetDigest: EVIDENCE_DIGEST
        },
        intentAt: AT
      },
      ownershipBaselineEvent(ACTION_ID),
      phaseEvent("ready", "send_pending", "send_may_have_occurred", ACTION_ID),
      witnessEvent(ACTION_ID, "send", OTHER_REQUEST_DIGEST, EVIDENCE_DIGEST, "user-send"),
      { type: "action_receipt", actionId: ACTION_ID, outcome: "satisfied", evidenceDigest: EVIDENCE_DIGEST, observedAt: AT },
      phaseEvent("send_pending", "submitted", "send_may_have_occurred", ACTION_ID, EVIDENCE_DIGEST),
      phaseEvent("submitted", "generating", "send_may_have_occurred", ACTION_ID, EVIDENCE_DIGEST),
      {
        type: "action_intent",
        action: {
          actionId: SECOND_ACTION_ID,
          kind: "work_steer",
          repeatPolicy: "observe_only_after_intent",
          requestDigest: OTHER_REQUEST_DIGEST,
          parentActionId: ACTION_ID,
          targetDigest: EVIDENCE_DIGEST
        },
        intentAt: AT
      },
      ownershipBaselineEvent(SECOND_ACTION_ID, true),
      witnessEvent(SECOND_ACTION_ID, "work_steer", OTHER_REQUEST_DIGEST, OTHER_REQUEST_DIGEST, "user-work-1"),
      { type: "action_receipt", actionId: SECOND_ACTION_ID, outcome: "satisfied", evidenceDigest: OTHER_REQUEST_DIGEST, observedAt: AT },
      {
        type: "action_intent",
        action: {
          actionId: THIRD_ACTION_ID,
          kind: "work_steer",
          repeatPolicy: "observe_only_after_intent",
          requestDigest: THIRD_REQUEST_DIGEST,
          parentActionId: ACTION_ID,
          targetDigest: EVIDENCE_DIGEST
        },
        intentAt: AT
      },
      ownershipBaselineEvent(THIRD_ACTION_ID, true),
      witnessEvent(THIRD_ACTION_ID, "work_steer", THIRD_REQUEST_DIGEST, THIRD_REQUEST_DIGEST, "user-work-2"),
      { type: "action_receipt", actionId: THIRD_ACTION_ID, outcome: "satisfied", evidenceDigest: THIRD_REQUEST_DIGEST, observedAt: AT },
      phaseEvent("generating", "capturing", "control_may_have_occurred", THIRD_ACTION_ID, THIRD_REQUEST_DIGEST),
      {
        type: "receipt_completed",
        observedAt: AT,
        receipt: {
          schemaVersion: OPERATION_RECEIPT_SCHEMA_VERSION,
          operationId: OPERATION_ID,
          requestDigest: REQUEST_DIGEST,
          targetBindingDigest: EVIDENCE_DIGEST,
          userTurnId: "user-work-2",
          userTurnEvidenceDigest: THIRD_REQUEST_DIGEST,
          assistantTurnId: "assistant-work-2",
          ownershipEvidenceDigest: THIRD_REQUEST_DIGEST,
          responseDigest: THIRD_REQUEST_DIGEST,
          responseBytes: 14,
          finishReason: "stop",
          contentAvailable: true,
          artifacts: [],
          completedAt: AT
        }
      }
    ];
    let revision = 1;
    for (const event of events) {
      await journal.append(OPERATION_ID, revision, event);
      revision += 1;
    }

    const before = (await journal.load(OPERATION_ID, REQUEST_DIGEST)).state;
    expect(Object.keys(before.ownershipBaselines ?? {})).toEqual([ACTION_ID, SECOND_ACTION_ID, THIRD_ACTION_ID]);
    expect(Object.keys(before.submissionWitnesses ?? {})).toEqual([ACTION_ID, SECOND_ACTION_ID, THIRD_ACTION_ID]);
    expect(before.ownershipBaseline).toEqual(before.ownershipBaselines?.[ACTION_ID]);
    expect(before.submissionWitness).toEqual(before.submissionWitnesses?.[ACTION_ID]);

    expect((await journal.compactCompleted(OPERATION_ID)).status).toBe("compacted");
    const reloaded = await OperationJournal.open({ stateRoot: root });
    const after = (await reloaded.load(OPERATION_ID, REQUEST_DIGEST)).state;
    expect(after.actions[SECOND_ACTION_ID]).toMatchObject({ kind: "work_steer", outcome: "satisfied" });
    expect(after.actions[THIRD_ACTION_ID]).toMatchObject({ kind: "work_steer", outcome: "satisfied" });
    expect(Object.keys(after.ownershipBaselines ?? {})).toEqual([ACTION_ID, SECOND_ACTION_ID, THIRD_ACTION_ID]);
    expect(Object.keys(after.submissionWitnesses ?? {})).toEqual([ACTION_ID, SECOND_ACTION_ID, THIRD_ACTION_ID]);
    expect(after.submissionWitnesses?.[SECOND_ACTION_ID]?.userTurnId).toBe("user-work-1");
    expect(after.submissionWitnesses?.[THIRD_ACTION_ID]?.userTurnId).toBe("user-work-2");
    expect(after.ownershipBaselines?.[SECOND_ACTION_ID]?.baseline.target.canonicalThreadUrl).toEqual({
      status: "unavailable",
      reason: "redacted"
    });
    expect(after.ownershipBaselines?.[THIRD_ACTION_ID]?.baseline.target.canonicalThreadUrl).toEqual({
      status: "unavailable",
      reason: "redacted"
    });
    expect(after.ownershipBaseline).toEqual(after.ownershipBaselines?.[ACTION_ID]);
    expect(after.submissionWitness).toEqual(after.submissionWitnesses?.[ACTION_ID]);
  });

  it("preserves new-target establishment, stable anchor digest, and evidence across reload and compaction", async () => {
    const root = await testRoot("new-establishment-compaction");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    const events: OperationEventV1[] = [
      { type: "target_bound", target: NEW_PENDING_TARGET, observedAt: AT },
      phaseEvent("prepared", "ready", "none", undefined, EVIDENCE_DIGEST),
      {
        type: "action_intent",
        action: {
          actionId: ACTION_ID,
          kind: "send",
          repeatPolicy: "observe_only_after_intent",
          requestDigest: REQUEST_DIGEST,
          targetDigest: EVIDENCE_DIGEST
        },
        intentAt: AT
      },
      {
        type: "ownership_baseline",
        baseline: {
          schemaVersion: OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION,
          operationId: OPERATION_ID,
          requestDigest: REQUEST_DIGEST,
          targetBindingDigest: EVIDENCE_DIGEST,
          actionId: ACTION_ID,
          baseline: makeOwnershipBaseline(NEW_PENDING_TARGET),
          observedAt: AT
        }
      },
      phaseEvent("ready", "send_pending", "send_may_have_occurred", ACTION_ID),
      { type: "action_receipt", actionId: ACTION_ID, outcome: "satisfied", evidenceDigest: EVIDENCE_DIGEST, observedAt: AT },
      newTargetEstablishedEvent(),
      {
        type: "submission_witness",
        witness: {
          schemaVersion: OPERATION_SUBMISSION_WITNESS_SCHEMA_VERSION,
          actionId: ACTION_ID,
          actionKind: "send",
          targetBindingDigest: EVIDENCE_DIGEST,
          baselineSnapshotDigest: EVIDENCE_DIGEST,
          postSendDeltaDigest: OTHER_REQUEST_DIGEST,
          operationUserEvidenceDigest: EVIDENCE_DIGEST,
          userTurnId: "user-new",
          observedAt: AT
        }
      },
      phaseEvent("send_pending", "submitted", "send_may_have_occurred", ACTION_ID, EVIDENCE_DIGEST),
      phaseEvent("submitted", "generating", "send_may_have_occurred", ACTION_ID, EVIDENCE_DIGEST),
      phaseEvent("generating", "capturing", "send_may_have_occurred", ACTION_ID, EVIDENCE_DIGEST),
      {
        type: "receipt_completed",
        observedAt: AT,
        receipt: {
          schemaVersion: OPERATION_RECEIPT_SCHEMA_VERSION,
          operationId: OPERATION_ID,
          requestDigest: REQUEST_DIGEST,
          targetBindingDigest: EVIDENCE_DIGEST,
          userTurnId: "user-new",
          userTurnEvidenceDigest: EVIDENCE_DIGEST,
          assistantTurnId: "assistant-new",
          ownershipEvidenceDigest: EVIDENCE_DIGEST,
          responseDigest: EVIDENCE_DIGEST,
          responseBytes: 12,
          finishReason: "stop",
          contentAvailable: true,
          artifacts: [],
          completedAt: AT
        }
      }
    ];
    let revision = 1;
    let beforeCompaction;
    for (const event of events) {
      beforeCompaction = await journal.append(OPERATION_ID, revision, event);
      revision += 1;
    }
    const stableDigest = journal.handleFromState(beforeCompaction!.state).targetBindingDigest;
    const snapshot = await journal.refreshSnapshot(OPERATION_ID);
    expect(snapshot.state.target?.targetLifecycle).toBe("new_established");
    expect(journal.handleFromState(snapshot.state).targetBindingDigest).toBe(stableDigest);

    await journal.compactCompleted(OPERATION_ID);
    const reloaded = await OperationJournal.open({ stateRoot: root });
    const loaded = await reloaded.load(OPERATION_ID, REQUEST_DIGEST);
    expect(loaded.state.target?.targetLifecycle).toBe("new_established");
    expect(loaded.state.target?.targetEstablishment?.userTurnId).toBe("user-new");
    expect(loaded.state.submissionWitness?.postSendDeltaDigest).toBe(OTHER_REQUEST_DIGEST);
    expect(reloaded.handleFromState(loaded.state).targetBindingDigest).toBe(stableDigest);
  });

  it("rejects compaction for unresolved or non-terminal operations and preserves the log", async () => {
    const root = await testRoot("ineligible-compaction");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    await expect(journal.compactCompleted(OPERATION_ID)).rejects.toMatchObject({ code: "operation_not_compactable" });
    expect(await readdir(join(root, "logs"))).toHaveLength(1);

    await journal.append(OPERATION_ID, 1, phaseEvent("prepared", "uncertain", "none"));
    await expect(journal.compactCompleted(OPERATION_ID)).rejects.toMatchObject({ code: "operation_not_compactable" });
    expect(await readdir(join(root, "terminals"))).toEqual([]);
  });

  it("falls back to the authoritative log when a snapshot cache is corrupt and rebuilds it", async () => {
    const root = await testRoot("snapshot-corruption");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    await journal.refreshSnapshot(OPERATION_ID);
    const snapshotPath = join(root, "snapshots", (await readdir(join(root, "snapshots")))[0]!);
    await writeFile(snapshotPath, "corrupted-cache\n", { mode: 0o600 });

    await expect(journal.readSnapshot(OPERATION_ID)).rejects.toMatchObject({ code: "journal_snapshot_corrupt" });
    expect((await journal.load(OPERATION_ID)).state.phase).toBe("prepared");
    const rebuilt = await journal.refreshSnapshot(OPERATION_ID);
    expect((await journal.readSnapshot(OPERATION_ID)).lastEventDigest).toBe(rebuilt.lastEventDigest);
  });

  it("reconciles crash residue with a durable terminal and fails closed on terminal corruption", async () => {
    const root = await testRoot("terminal-crash-ordering");
    let interrupt = true;
    const journal = await OperationJournal.open({
      stateRoot: root,
      faultInjector: point => {
        if (point === "after_terminal_synced" && interrupt) {
          interrupt = false;
          throw new Error("simulated crash after terminal durability");
        }
      }
    });
    await writeCompleted(journal);
    await expect(journal.compactCompleted(OPERATION_ID)).rejects.toThrow("simulated crash");
    expect(await readdir(join(root, "logs"))).toHaveLength(1);
    expect((await journal.load(OPERATION_ID)).state.phase).toBe("completed");

    const resumed = await journal.compactCompleted(OPERATION_ID);
    expect(resumed.status).toBe("already_compacted");
    expect(resumed.deletedLogBytes).toBeGreaterThan(0);
    expect(await readdir(join(root, "logs"))).toEqual([]);

    const terminalPath = join(root, "terminals", (await readdir(join(root, "terminals")))[0]!);
    const terminal = JSON.parse(await readFile(terminalPath, "utf8")) as Record<string, unknown>;
    terminal.requestDigest = OTHER_REQUEST_DIGEST;
    await writeFile(terminalPath, `${JSON.stringify(terminal)}\n`, { mode: 0o600 });
    await expect(journal.load(OPERATION_ID)).rejects.toMatchObject({ code: "journal_terminal_corrupt" });
  });

  it("prunes a completed receipt to an expiry tombstone and requires explicit purge acknowledgement", async () => {
    const root = await testRoot("prune-purge");
    const journal = await OperationJournal.open({ stateRoot: root });
    await writeCompleted(journal);
    await journal.refreshSnapshot(OPERATION_ID);

    const pruned = await journal.pruneReceipt(OPERATION_ID);
    expect(pruned.status).toBe("pruned");
    expect(await readdir(join(root, "terminals"))).toEqual([]);
    expect(await readdir(join(root, "tombstones"))).toHaveLength(1);
    expect((await journal.pruneReceipt(OPERATION_ID)).status).toBe("already_pruned");
    await expect(journal.load(OPERATION_ID, REQUEST_DIGEST)).rejects.toMatchObject({ code: "operation_receipt_expired" });
    await expect(journal.create(created())).rejects.toMatchObject({ code: "operation_receipt_expired" });
    await expect(journal.purgeTombstone(OPERATION_ID, { acknowledge: false })).rejects.toMatchObject({ code: "journal_purge_ack_required" });

    const purged = await journal.purgeTombstone(OPERATION_ID, { acknowledge: true });
    expect(purged.deleted).toHaveLength(1);
    await expect(journal.load(OPERATION_ID)).rejects.toMatchObject({ code: "operation_not_found" });
  });

  it("accounts for cache and terminal state in quota without deleting evidence", async () => {
    const root = await testRoot("quota-all-state");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    await journal.refreshSnapshot(OPERATION_ID);
    const stateBytes = await durableStateBytes(root);
    const constrained = await OperationJournal.open({ stateRoot: root, maxStateBytes: stateBytes });
    await expect(constrained.create(created(SECOND_OPERATION_ID))).rejects.toMatchObject({ code: "journal_quota_exceeded" });
    expect(await readdir(join(root, "logs"))).toHaveLength(1);
    expect(await readdir(join(root, "snapshots"))).toHaveLength(1);
  });

  it("refuses key replacement when only non-log durable state remains", async () => {
    const root = await testRoot("missing-key-cache");
    const journal = await OperationJournal.open({ stateRoot: root });
    await journal.create(created());
    await journal.refreshSnapshot(OPERATION_ID);
    await unlink(join(root, "journal.key"));
    await expect(OperationJournal.open({ stateRoot: root })).rejects.toMatchObject({ code: "journal_key_missing_with_state" });
  });

  it("finishes pruning safely after a crash leaves tombstone and terminal together", async () => {
    const root = await testRoot("prune-crash-ordering");
    let interrupt = true;
    const journal = await OperationJournal.open({
      stateRoot: root,
      faultInjector: point => {
        if (point === "after_tombstone_synced" && interrupt) {
          interrupt = false;
          throw new Error("simulated crash after tombstone durability");
        }
      }
    });
    await writeCompleted(journal);
    await journal.refreshSnapshot(OPERATION_ID);
    await journal.compactCompleted(OPERATION_ID);
    await expect(journal.pruneReceipt(OPERATION_ID)).rejects.toThrow("simulated crash");
    expect(await readdir(join(root, "tombstones"))).toHaveLength(1);
    expect(await readdir(join(root, "terminals"))).toHaveLength(1);
    const resumed = await journal.pruneReceipt(OPERATION_ID);
    expect(resumed.status).toBe("already_pruned");
    expect(await readdir(join(root, "terminals"))).toEqual([]);
  });
});

function created(
  operationId = OPERATION_ID,
  requestDigest = REQUEST_DIGEST
): Extract<OperationEventV1, { type: "operation_created" }> {
  return {
    type: "operation_created",
    operationId,
    requestDigest,
    surface: "chat",
    createdAt: AT
  };
}

function statusIntent(actionId: string): Extract<OperationEventV1, { type: "action_intent" }> {
  return {
    type: "action_intent",
    action: {
      actionId,
      kind: "status_read",
      repeatPolicy: "read_only",
      requestDigest: REQUEST_DIGEST
    },
    intentAt: AT
  };
}

async function testRoot(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `chatgpt-operation-journal-${label}-`));
}

function syntheticDirectoryEntries(
  count: number,
  onRead: () => void,
  onClose: () => void
): unknown {
  let cursor = 0;
  return {
    async next() {
      if (cursor >= count) return { done: true, value: undefined };
      cursor += 1;
      onRead();
      return { done: false, value: { name: ".DS_Store" } };
    },
    async return() {
      return { done: true, value: undefined };
    },
    async close() {
      onClose();
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}

async function onlyLog(root: string): Promise<string> {
  const logs = await readdir(join(root, "logs"));
  expect(logs).toHaveLength(1);
  return join(root, "logs", logs[0]!);
}

async function writeCompleted(journal: OperationJournal): Promise<void> {
  await journal.create(created());
  const events: OperationEventV1[] = [
    { type: "target_bound", target: TARGET, observedAt: AT },
    phaseEvent("prepared", "ready", "none", undefined, EVIDENCE_DIGEST),
    {
      type: "action_intent",
      action: {
        actionId: ACTION_ID,
        kind: "send",
        repeatPolicy: "observe_only_after_intent",
        requestDigest: REQUEST_DIGEST,
        targetDigest: EVIDENCE_DIGEST
      },
      intentAt: AT
    },
    {
      type: "ownership_baseline",
      baseline: {
        schemaVersion: OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION,
        operationId: OPERATION_ID,
        requestDigest: REQUEST_DIGEST,
        targetBindingDigest: EVIDENCE_DIGEST,
        actionId: ACTION_ID,
        baseline: makeOwnershipBaseline(TARGET),
        observedAt: AT
      }
    },
    phaseEvent("ready", "send_pending", "send_may_have_occurred", ACTION_ID),
    { type: "action_receipt", actionId: ACTION_ID, outcome: "satisfied", evidenceDigest: EVIDENCE_DIGEST, observedAt: AT },
    {
      type: "submission_witness",
      witness: {
        schemaVersion: OPERATION_SUBMISSION_WITNESS_SCHEMA_VERSION,
        actionId: ACTION_ID,
        actionKind: "send",
        targetBindingDigest: EVIDENCE_DIGEST,
        baselineSnapshotDigest: EVIDENCE_DIGEST,
        postSendDeltaDigest: EVIDENCE_DIGEST,
        operationUserEvidenceDigest: EVIDENCE_DIGEST,
        userTurnId: "user-turn-1",
        observedAt: AT
      }
    },
    phaseEvent("send_pending", "submitted", "send_may_have_occurred", ACTION_ID, EVIDENCE_DIGEST),
    phaseEvent("submitted", "generating", "send_may_have_occurred", ACTION_ID, EVIDENCE_DIGEST),
    phaseEvent("generating", "capturing", "send_may_have_occurred", ACTION_ID, EVIDENCE_DIGEST),
    {
      type: "receipt_completed",
      observedAt: AT,
      receipt: {
        schemaVersion: OPERATION_RECEIPT_SCHEMA_VERSION,
        operationId: OPERATION_ID,
        requestDigest: REQUEST_DIGEST,
        targetBindingDigest: EVIDENCE_DIGEST,
        userTurnId: "user-turn-1",
        userTurnEvidenceDigest: EVIDENCE_DIGEST,
        assistantTurnId: "assistant-turn-1",
        ownershipEvidenceDigest: EVIDENCE_DIGEST,
        responseDigest: EVIDENCE_DIGEST,
        responseBytes: 12,
        finishReason: "stop",
        contentAvailable: true,
        artifacts: [],
        completedAt: AT
      }
    }
  ];
  let revision = 1;
  for (const event of events) {
    await journal.append(OPERATION_ID, revision, event);
    revision += 1;
  }
}

function phaseEvent(
  from: OperationPhase,
  to: OperationPhase,
  mutationBoundary: MutationBoundary,
  causeActionId?: string,
  evidenceDigest?: string
): Extract<OperationEventV1, { type: "phase_changed" }> {
  const event: Extract<OperationEventV1, { type: "phase_changed" }> = {
    type: "phase_changed",
    from,
    to,
    mutationBoundary,
    observedAt: AT
  };
  if (causeActionId !== undefined) event.causeActionId = causeActionId;
  if (evidenceDigest !== undefined) event.evidenceDigest = evidenceDigest;
  return event;
}

function newTargetEstablishedEvent(): Extract<OperationEventV1, { type: "target_established" }> {
  return {
    type: "target_established",
    establishment: {
      targetBindingDigest: EVIDENCE_DIGEST,
      anchorDigest: EVIDENCE_DIGEST,
      causalSendActionId: ACTION_ID,
      conversationId: "conversation-new",
      canonicalThreadUrl: "https://chatgpt.com/c/conversation-new",
      userTurnId: "user-new",
      userTurnEvidenceDigest: EVIDENCE_DIGEST,
      postSendDeltaDigest: OTHER_REQUEST_DIGEST,
      evidenceDigest: EVIDENCE_DIGEST,
      observedAt: AT
    }
  };
}

function makeOwnershipBaseline(binding: OperationTargetBindingV1): OwnershipBaseline {
  const available = (value: string) => ({ status: "available" as const, value });
  const unavailable = (reason: "not_exposed" | "not_observed" | "redacted" = "not_observed") => ({
    status: "unavailable" as const,
    reason
  });
  const targetEvidence: OwnershipTargetEvidence = {
    provider: available(binding.providerId),
    browser: available(binding.browserId),
    tab: available(binding.tabId),
    thread: binding.conversationId === undefined ? unavailable() : available("thread-1"),
    conversation: binding.conversationId === undefined ? unavailable() : available(binding.conversationId),
    canonicalThreadUrl: binding.canonicalThreadUrl === undefined ? unavailable() : available(binding.canonicalThreadUrl),
    authoritativeTabClaim: unavailable("not_exposed"),
    coordinationScope: binding.coordinationScope
  };
  return {
    schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
    snapshotDigest: EVIDENCE_DIGEST,
    target: targetEvidence,
    userTurns: [],
    assistantTurns: [],
    completeness: "complete"
  };
}

async function durableStateBytes(root: string): Promise<number> {
  let total = 0;
  for (const directory of ["logs", "terminals", "snapshots", "tombstones"]) {
    for (const entry of await readdir(join(root, directory))) {
      total += (await stat(join(root, directory, entry))).size;
    }
  }
  return total;
}

async function expectQuotaCounterMatchesState(root: string): Promise<{
  revision: number;
  totalBytes: number;
  entryCount: number;
  dirty: boolean;
  counterDigest: string;
}> {
  const counter = JSON.parse(await readFile(join(root, "quota-state.json"), "utf8")) as {
    revision: number;
    totalBytes: number;
    entryCount: number;
    dirty: boolean;
    counterDigest: string;
  };
  let entryCount = 0;
  for (const directory of ["logs", "terminals", "snapshots", "tombstones"]) {
    entryCount += (await readdir(join(root, directory))).filter(entry => entry !== ".DS_Store").length;
  }
  expect(counter.totalBytes).toBe(await durableStateBytes(root));
  expect(counter.entryCount).toBe(entryCount);
  expect(counter.dirty).toBe(false);
  return counter;
}

function deterministicEntropy(): OperationJournalEntropy {
  return {
    randomBytes: size => Buffer.alloc(size, 0x42),
    randomUUID: () => "99999999-9999-4999-8999-999999999999"
  };
}

function testUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}
