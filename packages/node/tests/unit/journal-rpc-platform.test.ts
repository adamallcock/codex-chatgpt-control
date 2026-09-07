import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationJournal } from "../../src/operations/journal.js";
import { createJournalRpcClient, createJournalRpcClientFromDescriptor, readJournalRpcDescriptor } from "../../src/operations/journal-rpc-client.js";
import { startJournalRpcServer } from "../../src/operations/journal-rpc-server.js";
import { assertJournalRpcPlatform, assertPrivateDirectory, publishPrivateFile, readPrivateFile } from "../../src/operations/journal-rpc-protocol.js";

vi.mock("node:os", async importOriginal => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, platform: vi.fn(actual.platform) };
});
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), lstat: vi.fn(actual.lstat), mkdir: vi.fn(actual.mkdir), link: vi.fn(actual.link), unlink: vi.fn(actual.unlink) };
});
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

afterEach(() => vi.restoreAllMocks());

describe("journal RPC platform authority", () => {
  it("refuses Windows before journal, descriptor, filesystem or secret access", async () => {
    const directory = join(os.tmpdir(), "synthetic-unopened-journal-session");
    vi.spyOn(os, "platform").mockReturnValue("win32");
    const io = [vi.spyOn(fs, "open"), vi.spyOn(fs, "lstat"), vi.spyOn(fs, "mkdir"), vi.spyOn(fs, "link"), vi.spyOn(fs, "unlink")];
    const journal = vi.spyOn(OperationJournal, "open");
    const entropy = vi.spyOn(crypto, "randomBytes");
    const expected = { code: "journal_rpc_unsupported_platform" };

    expect(() => assertJournalRpcPlatform()).toThrowError(/journal_rpc_unsupported_platform/u);
    expect(() => createJournalRpcClient({ directory, instanceId: "invalid", token: "invalid" })).toThrowError(/journal_rpc_unsupported_platform/u);
    await expect(startJournalRpcServer({ directory, stateRoot: join(directory, "state") })).rejects.toMatchObject(expected);
    await expect(readJournalRpcDescriptor(join(directory, "connection.json"))).rejects.toMatchObject(expected);
    await expect(createJournalRpcClientFromDescriptor(join(directory, "connection.json"))).rejects.toMatchObject(expected);
    await expect(assertPrivateDirectory(directory)).rejects.toMatchObject(expected);
    await expect(readPrivateFile(join(directory, "connection.json"))).rejects.toMatchObject(expected);
    await expect(publishPrivateFile(directory, "connection.json", "must not be written")).rejects.toMatchObject(expected);

    expect(journal).not.toHaveBeenCalled();
    expect(entropy).not.toHaveBeenCalled();
    for (const call of io) expect(call).not.toHaveBeenCalled();
  });

  it.each(["darwin", "linux"] as const)("leaves POSIX security checks available on %s", platform => {
    vi.spyOn(os, "platform").mockReturnValue(platform);
    expect(() => assertJournalRpcPlatform()).not.toThrow();
  });
});
