import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createChatGPT } from "../../src/client.js";
import { OperationJournal, OperationJournalError } from "../../src/operations/journal.js";
import * as rpc from "../../src/operations/journal-rpc-client.js";
import { startJournalRpcServer } from "../../src/operations/journal-rpc-server.js";
import { OPERATION_REQUEST_SCHEMA_VERSION } from "../../src/operations/types.js";

describe("explicit journal service integration", () => {
  it.skipIf(process.platform === "win32")("inspects through the POSIX remote authority without opening a journal in the browser host", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "journal-client-")));
    const server = await startJournalRpcServer({ stateRoot: join(root, "state"), directory: join(root, "connection") });
    const authority = await rpc.createJournalRpcClientFromDescriptor(server.descriptorPath);
    const request = { schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION, operationId: "45454545-4545-4545-8545-454545454545", surface: "chat" as const, target: { type: "new" as const }, prompt: "synthetic service test" };
    const requestDigest = await authority.submitRequestDigest(request, []);
    const loaded = await authority.create({ type: "operation_created", operationId: request.operationId, requestDigest, surface: "chat", createdAt: new Date().toISOString() });
    const handle = await authority.handleFromState(loaded.state);
    const localOpening = vi.spyOn(OperationJournal, "open").mockRejectedValue(new Error("browser host cannot open journals"));
    const browser = { tabs: { selected: vi.fn(() => { throw new Error("inspect cannot use browser"); }) } };
    try {
      const client = createChatGPT({ browser, operations: { journalService: { descriptorPath: server.descriptorPath } } });
      const inspected = await client.operations.inspect(handle);
      expect(inspected.state).toEqual(loaded.state);
      expect(localOpening).not.toHaveBeenCalled();
      expect(browser.tabs.selected).not.toHaveBeenCalled();
    } finally { localOpening.mockRestore(); await server.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("rejects conflicting state ownership before connecting or touching the browser", async () => {
    const connection = vi.spyOn(rpc, "createJournalRpcClientFromDescriptor");
    const client = createChatGPT({ operations: { stateRoot: "/private/unused-state", journalService: { descriptorPath: "/private/unused-descriptor" } } });
    try {
      const result = await client.ask({ operationId: "46464646-4646-4646-8646-464646464646", prompt: "synthetic" });
      expect(result).toMatchObject({ ok: false, status: "error" });
      expect(result.error?.message).toContain("journal service configuration conflict");
      expect(connection).not.toHaveBeenCalled();
    } finally { connection.mockRestore(); }
  });

  it.each(["chat", "work"] as const)("reports unavailable or uncertain authority safely for %s", async surface => {
    for (const code of ["journal_rpc_unavailable", "journal_rpc_outcome_indeterminate", "journal_rpc_unsupported_platform"]) {
      const connection = vi.spyOn(rpc, "createJournalRpcClientFromDescriptor").mockRejectedValue(new OperationJournalError(code, "private descriptor token and path"));
      const browser = { tabs: { create: vi.fn(() => { throw new Error("browser must not be used"); }) } };
      const client = createChatGPT({ browser, operations: { journalService: { descriptorPath: "/private/unused-descriptor" } } });
      const args = { operationId: "47474747-4747-4747-8747-474747474747", prompt: "synthetic" };
      try {
        const result = surface === "chat" ? await client.ask(args) : await client.work.start(args);
        expect(result).toMatchObject({ ok: false, status: code.endsWith("indeterminate") ? "partial" : "blocked", blocker: { code, resumable: false }, error: { recoverable: false } });
        expect(result.blocker?.remediation?.[0]?.instruction).toContain(code === "journal_rpc_unsupported_platform" ? "ordinary Node browser host" : "same operation identity");
        expect(JSON.stringify(result)).not.toContain("private descriptor token");
        expect(browser.tabs.create).not.toHaveBeenCalled();
        expect(connection).toHaveBeenCalledOnce();
      } finally { connection.mockRestore(); }
    }
  });
});
