import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, readdir, readlink, realpath, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { opendirMock, lstatPaths, openedPaths } = vi.hoisted(() => ({
  opendirMock: vi.fn(),
  lstatPaths: [] as string[],
  openedPaths: new WeakMap<object, string>()
}));

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  opendirMock.mockImplementation((...args: Parameters<typeof actual.opendir>) => actual.opendir(...args));
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (typeof args[0] === "string") openedPaths.set(handle, args[0]);
      return handle;
    },
    lstat: (...args: Parameters<typeof actual.lstat>) => {
      const path = args[0];
      if (typeof path === "string") lstatPaths.push(path);
      return actual.lstat(...args);
    },
    opendir: (...args: Parameters<typeof actual.opendir>) => opendirMock(...args)
  };
});

import {
  commitOperationOutput,
  deriveOperationOutputKey,
  type ArtifactOutputCommitOptions
} from "../../src/operations/artifact-output.js";

const TEMP_SCAN_CAP = 65_536;

type SyntheticDirectoryEntry = { name: string };

function syntheticDirectory(
  names: readonly string[],
  onRead?: (index: number) => void,
  onClose?: () => void
): unknown {
  let cursor = 0;
  const handle: {
    next: () => Promise<IteratorResult<SyntheticDirectoryEntry>>;
    return: () => Promise<IteratorResult<SyntheticDirectoryEntry>>;
    close: () => Promise<void>;
    [Symbol.asyncIterator]: () => unknown;
  } = {
    async next() {
      const index = cursor++;
      onRead?.(index);
      const name = names[index];
      return name === undefined
        ? { done: true, value: undefined }
        : { done: false, value: { name } };
    },
    async return() {
      return { done: true, value: undefined };
    },
    async close() {
      onClose?.();
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
  return handle;
}

async function makeRoot(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `chatgpt-operation-output-${label}-`));
}

async function directoryEntriesIfPresent(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readUtf8IfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function* bytes(...chunks: string[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield Buffer.from(chunk, "utf8");
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function options(root: string, source: AsyncIterable<Uint8Array>, overrides: Partial<ArtifactOutputCommitOptions> = {}): ArtifactOutputCommitOptions {
  return {
    outputDirectory: root,
    source,
    operationId: "opaque-operation-id-7f0d",
    artifactIdentity: "source-identity-digest:abc123",
    extensionHint: ".txt",
    ...overrides
  };
}

describe("operation artifact output", () => {
  it("derives a deterministic single safe component without leaking opaque identities", () => {
    const input = {
      operationId: "/private/account/operation-123",
      artifactIdentity: "my-secret-file-name-and-directory",
      mimeTypeHint: "text/plain"
    };
    const key = deriveOperationOutputKey(input);
    expect(key).toBe(deriveOperationOutputKey(input));
    expect(key).toMatch(/^artifact-[0-9a-f]{48}\.txt$/);
    expect(key).not.toContain("private");
    expect(key).not.toContain("secret");
    expect(key).not.toContain("/");
    expect(key).not.toContain("\\");
    expect(key.length).toBeLessThanOrEqual(128);
    expect(() => deriveOperationOutputKey({ ...input, extensionHint: "../private" })).toThrow(/extension/i);
    expect(() => deriveOperationOutputKey({ ...input, extensionHint: "/tmp/x" })).toThrow(/extension/i);
    expect(deriveOperationOutputKey({ ...input, mimeTypeHint: "image/png" })).toMatch(/\.png$/);
  });

  it("streams a zero-byte artifact, hashes it, and commits with a restrictive mode", async () => {
    const root = await makeRoot("zero");
    const result = await commitOperationOutput(options(root, bytes()));
    expect(result).toMatchObject({
      status: "committed",
      reason: "created",
      bytes: 0,
      sha256: sha256("")
    });
    expect(result).not.toHaveProperty("path");
    expect(JSON.stringify(result)).not.toContain(root);
    const outputPath = join(root, result.outputKey);
    expect(await readFile(outputPath)).toEqual(Buffer.alloc(0));
    if (process.platform !== "win32") {
      const mode = (await stat(outputPath)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("streams chunks without an all-buffer API and commits the expected digest", async () => {
    const root = await makeRoot("stream");
    const seen: number[] = [];
    async function* source(): AsyncGenerator<Uint8Array> {
      for (const chunk of ["first-", "second-", "third"]) {
        const value = Buffer.from(chunk);
        seen.push(value.byteLength);
        yield value;
      }
    }
    const result = await commitOperationOutput(options(root, source()));
    const content = Buffer.from("first-second-third");
    expect(result).toMatchObject({ status: "committed", reason: "created", bytes: content.byteLength, sha256: sha256(content) });
    expect(Math.max(...seen)).toBeLessThan(content.byteLength);
    expect(await readFile(join(root, result.outputKey))).toEqual(content);
  });

  it("reconciles an identical existing final without overwriting it", async () => {
    const root = await makeRoot("reconcile");
    const first = await commitOperationOutput(options(root, bytes("same")));
    const second = await commitOperationOutput(options(root, bytes("same")));
    expect(first.status).toBe("committed");
    expect(second).toMatchObject({
      outputKey: first.outputKey,
      status: "reconciled",
      reason: "already_present",
      bytes: 4,
      sha256: sha256("same")
    });
    expect((await readdir(root)).filter(name => name.includes("partial-")).length).toBe(0);
  });

  it("returns a collision for different existing bytes and never clobbers them", async () => {
    const root = await makeRoot("collision");
    const first = await commitOperationOutput(options(root, bytes("original")));
    const second = await commitOperationOutput(options(root, bytes("replacement")));
    expect(second).toMatchObject({ status: "collision", reason: "existing_mismatch", outputKey: first.outputKey });
    expect(await readFile(join(root, first.outputKey), "utf8")).toBe("original");
  });

  it("rejects symlink and non-regular final targets without following or replacing them", async () => {
    const root = await makeRoot("target-security");
    const key = deriveOperationOutputKey({ operationId: "opaque-operation-id-7f0d", artifactIdentity: "source-identity-digest:abc123", extensionHint: ".txt" });
    const outside = join(await makeRoot("outside"), "outside.txt");
    await writeFile(outside, "outside");
    if (process.platform !== "win32") {
      await symlink(outside, join(root, key));
      const symlinkResult = await commitOperationOutput(options(root, bytes("safe")));
      expect(symlinkResult).toMatchObject({ status: "blocked", reason: "existing_target_not_regular" });
      expect(await readlink(join(root, key))).toBe(outside);
    }
    const directoryOptions = options(root, bytes("safe"), { artifactIdentity: "directory-target" });
    const directoryKey = deriveOperationOutputKey({ operationId: directoryOptions.operationId, artifactIdentity: directoryOptions.artifactIdentity, extensionHint: ".txt" });
    await mkdir(join(root, directoryKey));
    const directoryResult = await commitOperationOutput(directoryOptions);
    expect(directoryResult).toMatchObject({ status: "blocked", reason: "existing_target_not_regular" });
  });

  it("rejects a symlink destination directory", async () => {
    if (process.platform === "win32") return;
    const real = await makeRoot("destination-real");
    const parent = await makeRoot("destination-link");
    const linked = join(parent, "linked");
    await symlink(real, linked);
    const result = await commitOperationOutput(options(linked, bytes("safe")));
    expect(result).toMatchObject({ status: "blocked", reason: "destination_invalid" });
    expect((await readdir(real)).length).toBe(0);
  });

  it("enforces a byte cap before writing an over-limit chunk and cleans its owned temp", async () => {
    const root = await makeRoot("limit");
    let yielded = 0;
    async function* source(): AsyncGenerator<Uint8Array> {
      yielded += 1;
      yield Buffer.from("abc");
      yielded += 1;
      yield Buffer.from("def");
    }
    const result = await commitOperationOutput(options(root, source(), { maxBytes: 5 }));
    expect(result).toMatchObject({ status: "blocked", reason: "byte_limit_exceeded", bytes: 3, sha256: sha256("abc") });
    expect(yielded).toBe(2);
    expect((await readdir(root)).filter(name => name.includes("partial-")).length).toBe(0);
  });

  it("preserves an unverified crash leftover as an ambiguity blocker", async () => {
    const root = await makeRoot("leftover");
    const key = deriveOperationOutputKey({ operationId: "opaque-operation-id-7f0d", artifactIdentity: "source-identity-digest:abc123", extensionHint: ".txt" });
    const leftover = join(root, `.${key}.partial-00000000000000000000000000000000.tmp`);
    await writeFile(leftover, "partial");
    const result = await commitOperationOutput(options(root, bytes("payload")));
    expect(result).toMatchObject({ status: "blocked", reason: "ambiguous_temp", bytes: 0, sha256: sha256("") });
    expect(await readFile(leftover, "utf8")).toBe("partial");
  });

  it("allows a synthetic output scan at the exact hard entry cap and closes it", async () => {
    const root = await makeRoot("temp-scan-cap");
    const names = Array.from({ length: TEMP_SCAN_CAP }, (_, index) => `unrelated-${index}`);
    let closeCalls = 0;
    opendirMock.mockImplementationOnce(async () => syntheticDirectory(names, undefined, () => { closeCalls += 1; }));

    let sourceStarted = false;
    async function* source(): AsyncGenerator<Uint8Array> {
      sourceStarted = true;
      yield Buffer.from("bounded");
    }
    const result = await commitOperationOutput(options(root, source(), { artifactIdentity: "temp-scan-cap" }));
    expect(result).toMatchObject({ status: "committed", reason: "created" });
    expect(sourceStarted).toBe(true);
    expect(closeCalls).toBe(1);
  });

  it("fails closed at cap plus one without inspecting the final target", async () => {
    const root = await makeRoot("temp-scan-overflow");
    const names = Array.from({ length: TEMP_SCAN_CAP + 1 }, (_, index) => `unrelated-${index}`);
    opendirMock.mockImplementationOnce(async () => syntheticDirectory(names));
    lstatPaths.length = 0;
    const base = options(root, bytes("must-not-start"), { artifactIdentity: "temp-scan-overflow" });
    const finalPath = join(root, deriveOperationOutputKey({
      operationId: base.operationId,
      artifactIdentity: base.artifactIdentity,
      ...(base.extensionHint === undefined ? {} : { extensionHint: base.extensionHint })
    }));

    const result = await commitOperationOutput(base);
    expect(result).toMatchObject({ status: "blocked", reason: "ambiguous_temp", bytes: 0 });
    expect(lstatPaths).not.toContain(finalPath);
  });

  it("honors deadline and cancellation checks while enumerating a directory", async () => {
    const deadlineRoot = await makeRoot("temp-scan-deadline");
    let now = 0;
    opendirMock.mockImplementationOnce(async () => syntheticDirectory(
      ["first-unrelated", "second-unrelated"],
      index => { if (index === 1) now = 10; }
    ));
    const deadline = await commitOperationOutput(options(deadlineRoot, bytes("must-not-start"), {
      artifactIdentity: "temp-scan-deadline",
      timeoutMs: 5,
      now: () => now
    }));
    expect(deadline).toMatchObject({ status: "blocked", reason: "operation_timeout", bytes: 0 });

    const cancellationRoot = await makeRoot("temp-scan-cancellation");
    const controller = new AbortController();
    let closeCalls = 0;
    opendirMock.mockImplementationOnce(async () => syntheticDirectory(
      ["first-unrelated", "second-unrelated"],
      index => { if (index === 1) controller.abort(); },
      () => { closeCalls += 1; }
    ));
    const cancelled = await commitOperationOutput(options(cancellationRoot, bytes("must-not-start"), {
      artifactIdentity: "temp-scan-cancellation",
      signal: controller.signal
    }));
    expect(cancelled).toMatchObject({ status: "blocked", reason: "source_aborted", bytes: 0 });
    expect(closeCalls).toBe(1);
  });

  it("reconciles a verified crash leftover using an exact durable receipt", async () => {
    const root = await makeRoot("leftover-recovery");
    const payload = Buffer.from("receipt-bound-payload");
    const base = options(root, bytes("unused"));
    const key = deriveOperationOutputKey({ operationId: base.operationId, artifactIdentity: base.artifactIdentity, extensionHint: ".txt" });
    const leftover = join(root, `.${key}.partial-00000000000000000000000000000000.tmp`);
    await writeFile(leftover, payload, { mode: 0o600 });

    const recovered = await commitOperationOutput({
      ...base,
      expected: { bytes: payload.byteLength, sha256: sha256(payload) }
    });
    expect(recovered).toMatchObject({ status: "committed", reason: "recovered_after_crash", bytes: payload.byteLength, sha256: sha256(payload) });
    expect(await readFile(join(root, key))).toEqual(payload);
    expect((await readdir(root)).filter(name => name.includes("partial-")).length).toBe(0);
  });

  it("reconciles an expected final without consuming the source again", async () => {
    const root = await makeRoot("receipt-final");
    const payload = Buffer.from("already-durable");
    const first = await commitOperationOutput(options(root, bytes(payload.toString("utf8"))));
    let sourceStarted = false;
    async function* shouldNotRead(): AsyncGenerator<Uint8Array> {
      sourceStarted = true;
      yield Buffer.from("wrong");
    }
    const reconciled = await commitOperationOutput(options(root, shouldNotRead(), {
      expected: { bytes: payload.byteLength, sha256: sha256(payload) }
    }));
    expect(reconciled).toMatchObject({ outputKey: first.outputKey, status: "reconciled", reason: "already_present" });
    expect(sourceStarted).toBe(false);
  });

  it("blocks a source that disagrees with its durable transfer receipt", async () => {
    const root = await makeRoot("source-mismatch");
    const result = await commitOperationOutput(options(root, bytes("actual"), {
      expected: { bytes: 8, sha256: sha256("expected") }
    }));
    expect(result).toMatchObject({ status: "blocked", reason: "source_mismatch", bytes: 6, sha256: sha256("actual") });
    expect((await readdir(root)).filter(name => name.startsWith("artifact-")).length).toBe(0);
  });

  it("syncs the directory even when operation-owned temp cleanup is pending", async () => {
    const root = await makeRoot("cleanup-durability");
    const points: string[] = [];
    const committed = await commitOperationOutput(options(root, bytes("durable"), {
      hooks: {
        faultInjector: point => {
          points.push(point);
          if (point === "before_temp_cleanup") throw new Error("injected cleanup failure");
        }
      }
    }));
    expect(committed).toMatchObject({ status: "committed", reason: "temp_cleanup_pending" });
    expect(points).toContain("before_directory_sync");
    expect(points).toContain("after_directory_sync");

    const recovered = await commitOperationOutput(options(root, bytes("unused"), {
      expected: { bytes: 7, sha256: sha256("durable") }
    }));
    expect(recovered).toMatchObject({ status: "reconciled", reason: "already_present" });
  });

  it("returns typed redacted outcomes for source cancellation and malformed chunks", async () => {
    const root = await makeRoot("source-errors");
    const controller = new AbortController();
    controller.abort();
    const aborted = await commitOperationOutput(options(root, bytes("never"), { signal: controller.signal }));
    expect(aborted).toMatchObject({ status: "blocked", reason: "source_aborted" });

    const malformed = await commitOperationOutput(options(root, (async function*(): AsyncGenerator<Uint8Array> {
      yield "not-bytes" as unknown as Uint8Array;
    })(), { artifactIdentity: "malformed" }));
    expect(malformed).toMatchObject({ status: "blocked", reason: "source_invalid" });
    expect(JSON.stringify(malformed)).not.toContain(root);
  });

  it("classifies write, fsync, post-link, and directory durability faults", async () => {
    const root = await makeRoot("faults");
    const failAt = async (point: string, identity: string) => commitOperationOutput(options(root, bytes("fault"), {
      artifactIdentity: identity,
      hooks: { faultInjector: current => { if (current === point) throw new Error("injected private fault"); } }
    }));
    expect(await failAt("before_write", "write")).toMatchObject({ status: "blocked", reason: "write_failed" });
    expect(await failAt("before_file_sync", "sync")).toMatchObject({ status: "blocked", reason: "file_sync_failed" });
    const afterLink = await failAt("after_final_link", "after-link");
    expect(afterLink).toMatchObject({ status: "blocked", reason: "commit_indeterminate" });
    const afterLinkRecovery = await commitOperationOutput(options(root, bytes("fault"), { artifactIdentity: "after-link" }));
    expect(afterLinkRecovery.status).toBe("reconciled");
    const directoryFault = await failAt("before_directory_sync", "directory");
    expect(directoryFault).toMatchObject({ status: "blocked", reason: "commit_indeterminate" });
    const directoryRecovery = await commitOperationOutput(options(root, bytes("fault"), { artifactIdentity: "directory" }));
    expect(directoryRecovery.status).toBe("reconciled");
  });

  it("supports deterministic entropy and remains safe under concurrent exclusive races", async () => {
    const root = await makeRoot("race");
    const deterministic = () => new Uint8Array(16);
    const [left, right] = await Promise.all([
      commitOperationOutput(options(root, bytes("race"), { artifactIdentity: "race", hooks: { entropy: deterministic } })),
      commitOperationOutput(options(root, bytes("race"), { artifactIdentity: "race", hooks: { entropy: deterministic } }))
    ]);
    expect([left.status, right.status]).toContain("committed");
    expect([left.status, right.status].every(status => ["committed", "reconciled", "blocked"].includes(status))).toBe(true);
    const key = left.outputKey;
    expect(await readFile(join(root, key), "utf8")).toBe("race");
  });

  it("does not accumulate hidden partials across repeated successful outputs", async () => {
    const root = await makeRoot("success-cleanup-stress");
    for (let index = 0; index < 32; index += 1) {
      const result = await commitOperationOutput(options(root, bytes(`payload-${index}`), {
        artifactIdentity: `success-cleanup-stress-${index}`
      }));
      expect(result.status).toBe("committed");
      expect(result.reason).toBe("created");
    }
    expect((await readdir(root)).filter(name => name.includes("partial-")).length).toBe(0);
  });

  it("rejects relative destinations and invalid limits before touching source state", async () => {
    await expect(commitOperationOutput(options("relative-output", bytes("private")))).rejects.toMatchObject({
      code: "output_directory_not_absolute"
    });
    await expect(commitOperationOutput(options(await makeRoot("invalid-limit"), bytes("private"), { maxBytes: -1 }))).rejects.toMatchObject({
      code: "invalid_artifact_byte_limit"
    });
  });

  it("snapshots only own data properties and never invokes hostile accessors or proxies", () => {
    let getterRuns = 0;
    const accessor = {
      artifactIdentity: "artifact",
      extensionHint: ".txt",
      get operationId() {
        getterRuns += 1;
        throw new Error("private accessor value");
      }
    } as unknown as Parameters<typeof deriveOperationOutputKey>[0];
    expect(() => deriveOperationOutputKey(accessor)).toThrow(/accessor|invalid/i);
    expect(getterRuns).toBe(0);

    const extra = { operationId: "operation", artifactIdentity: "artifact", unexpected: "secret" } as unknown as Parameters<typeof deriveOperationOutputKey>[0];
    expect(() => deriveOperationOutputKey(extra)).toThrow(/unsupported|invalid/i);

    const hostile = new Proxy({ operationId: "operation", artifactIdentity: "artifact" }, {
      ownKeys() {
        throw new Error("private proxy payload");
      }
    });
    expect(() => deriveOperationOutputKey(hostile)).toThrow(/invalid/i);
  });

  it("rejects spoofed abort signals before touching the source", async () => {
    const root = await makeRoot("spoofed-signal");
    let started = false;
    async function* source(): AsyncGenerator<Uint8Array> {
      started = true;
      yield Buffer.from("private");
    }
    const spoof = { aborted: false, addEventListener() {}, removeEventListener() {} } as unknown as AbortSignal;
    await expect(commitOperationOutput(options(root, source(), { signal: spoof }))).rejects.toMatchObject({ code: "invalid_commit_options" });
    expect(started).toBe(false);
  });

  it("enforces UTF-8 identity, graph, and maximum artifact bounds", async () => {
    expect(() => deriveOperationOutputKey({ operationId: "é".repeat(2049), artifactIdentity: "artifact" })).toThrow(/identity/i);
    const root = await makeRoot("bounds");
    const tooLongDirectory = `${root}/${"é".repeat(2049)}`;
    await expect(commitOperationOutput(options(tooLongDirectory, bytes("private")))).rejects.toMatchObject({ code: "invalid_commit_options" });
    await expect(commitOperationOutput(options(root, bytes("private"), { maxBytes: 512 * 1024 * 1024 + 1 }))).rejects.toMatchObject({ code: "invalid_artifact_byte_limit" });

    const source = bytes("bounded");
    let cursor: Record<string, unknown> = source as unknown as Record<string, unknown>;
    for (let index = 0; index < 20; index += 1) {
      const next: Record<string, unknown> = {};
      Object.defineProperty(cursor, "nested", { value: next, enumerable: true });
      cursor = next;
    }
    await expect(commitOperationOutput(options(root, source))).rejects.toMatchObject({ code: "invalid_output_options" });
  });

  it("returns redacted bounded outcomes for hostile and backward clocks", async () => {
    const root = await makeRoot("clock");
    let started = false;
    async function* source(): AsyncGenerator<Uint8Array> {
      started = true;
      yield Buffer.from("private");
    }
    const throwingClock = () => {
      throw new Error("private clock secret");
    };
    const thrown = await commitOperationOutput(options(root, source(), { now: throwingClock }));
    expect(thrown).toMatchObject({ status: "blocked", reason: "clock_invalid" });
    expect(started).toBe(false);
    let calls = 0;
    const backward = () => (calls++ === 0 ? 100 : 99);
    const movedBack = await commitOperationOutput(options(root, source(), { now: backward }));
    expect(movedBack).toMatchObject({ status: "blocked", reason: "clock_invalid" });
    expect(JSON.stringify(movedBack)).not.toContain("private");
  });

  it("awaits a delayed source before reporting its crossed deadline and never produces a final", async () => {
    const root = await makeRoot("deadline");
    let now = 0;
    let markDelayed!: () => void;
    let releaseDelayed!: () => void;
    const delayedStarted = new Promise<void>(resolve => { markDelayed = resolve; });
    const delayedRelease = new Promise<void>(resolve => { releaseDelayed = resolve; });
    async function* delayed(): AsyncGenerator<Uint8Array> {
      yield Buffer.from("prefix");
      markDelayed();
      await delayedRelease;
      now = 10;
    }
    const pending = commitOperationOutput(options(root, delayed(), { timeoutMs: 5, now: () => now }));
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await delayedStarted;
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseDelayed();
    const timedOut = await pending;
    expect(timedOut.status).toBe("blocked");
    expect(timedOut.reason).toBe("operation_timeout");
    expect((await readdir(root)).some(name => name === timedOut.outputKey)).toBe(false);

    async function* leaking(): AsyncGenerator<Uint8Array> {
      throw new Error("https://private.example/?token=secret-content");
    }
    const failed = await commitOperationOutput(options(root, leaking(), { artifactIdentity: "leak" }));
    expect(failed).toMatchObject({ status: "blocked", reason: "source_read_failed" });
    expect(JSON.stringify(failed)).not.toContain("private.example");
    expect(JSON.stringify(failed)).not.toContain("secret-content");
  });

  it("refuses a destination replacement between preflight and write and leaves no final outside the bound directory", async () => {
    const root = await makeRoot("toctou");
    const moved = `${root}-moved`;
    const result = await commitOperationOutput(options(root, bytes("private"), {
      hooks: {
        faultInjector: async point => {
          if (point !== "before_write") return;
          await rename(root, moved);
          await mkdir(root);
        }
      }
    }));
    expect(result.status).toBe("blocked");
    expect(result.reason).not.toBe("created");
    expect((await directoryEntriesIfPresent(root)).some(name => name === result.outputKey)).toBe(false);
    expect((await directoryEntriesIfPresent(moved)).some(name => name === result.outputKey)).toBe(false);
  });

  it("copies from the retained source handle when the temp pathname is replaced before commit", async () => {
    const root = await makeRoot("temp-replacement");
    let replaced = false;
    let replacedTempName: string | undefined;
    const result = await commitOperationOutput(options(root, bytes("trusted-source"), {
      artifactIdentity: "temp-replacement",
      hooks: {
        faultInjector: async point => {
          if (point !== "before_final_link" || replaced) return;
          replaced = true;
          const tempName = (await readdir(root)).find(name => name.includes("partial-"));
          if (tempName === undefined) throw new Error("temporary source was not created");
          replacedTempName = tempName;
          const tempPath = join(root, tempName);
          const replacement = join(root, "attacker-replacement");
          await writeFile(replacement, "attacker-bytes");
          await rename(replacement, tempPath);
        }
      }
    }));
    expect(result.status).toBe("blocked");
    expect(replacedTempName).toBeDefined();
    if (result.reason === "temp_cleanup_ambiguous") {
      expect(await readFile(join(root, result.outputKey), "utf8")).toBe("trusted-source");
      expect(await readFile(join(root, replacedTempName!), "utf8")).toBe("attacker-bytes");
    } else {
      // Windows refuses replacement of the retained open temp handle. The
      // mutation must still fail closed, and attacker bytes must never appear
      // at the final pathname.
      expect(result.reason).toBe("commit_indeterminate");
      expect(await readUtf8IfPresent(join(root, result.outputKey))).not.toBe("attacker-bytes");
    }
  });

  it("fails closed when the destination directory is replaced after source validation", async () => {
    const root = await makeRoot("directory-replacement-before-commit");
    const moved = `${root}-moved`;
    const result = await commitOperationOutput(options(root, bytes("trusted-source"), {
      artifactIdentity: "directory-replacement-before-commit",
      hooks: {
        faultInjector: async point => {
          if (point !== "before_final_link") return;
          await rename(root, moved);
          await mkdir(root);
        }
      }
    }));
    expect(result).toMatchObject({ status: "blocked", reason: "commit_indeterminate" });
    expect((await directoryEntriesIfPresent(root)).some(name => name === result.outputKey)).toBe(false);
    expect((await directoryEntriesIfPresent(moved)).some(name => name === result.outputKey)).toBe(false);
  });

  it("does not report committed when the final pathname is replaced after copying", async () => {
    if (process.platform === "win32") return;
    const root = await makeRoot("final-replacement-after-copy");
    const artifactIdentity = "final-replacement-after-copy";
    const finalPath = join(root, deriveOperationOutputKey({
      operationId: "opaque-operation-id-7f0d",
      artifactIdentity,
      extensionHint: ".txt"
    }));
    let replaced = false;
    const result = await commitOperationOutput(options(root, bytes("trusted-bytes"), {
      artifactIdentity,
      hooks: {
        faultInjector: async point => {
          if (point !== "after_final_link" || replaced) return;
          replaced = true;
          const replacement = join(root, "attacker-final");
          await writeFile(replacement, "attacker-bytes");
          await rename(replacement, finalPath);
        }
      }
    }));
    expect(result).toMatchObject({ status: "blocked", reason: "commit_indeterminate" });
    expect(replaced).toBe(true);
    expect(await readFile(finalPath, "utf8")).toBe("attacker-bytes");
  });

  it("does not report committed when the final pathname is replaced during copying", async () => {
    if (process.platform === "win32") return;
    const root = await makeRoot("final-replacement-during-copy");
    const canonicalRoot = await realpath(root);
    const artifactIdentity = "final-replacement-during-copy";
    const finalPath = join(root, deriveOperationOutputKey({
      operationId: "opaque-operation-id-7f0d",
      artifactIdentity,
      extensionHint: ".txt"
    }));
    const probe = await open(join(root, "probe"), "w+");
    const prototype = Object.getPrototypeOf(probe) as {
      write: (...args: unknown[]) => Promise<unknown>;
    };
    await probe.close();
    const originalWrite = prototype.write;
    let sourceHandle: unknown;
    let replaced = false;
    prototype.write = async function(this: unknown, ...args: unknown[]): Promise<unknown> {
      if (dirname(openedPaths.get(this as object) ?? "") !== canonicalRoot) {
        return Reflect.apply(originalWrite as (...inner: unknown[]) => unknown, this, args);
      }
      if (sourceHandle === undefined) {
        sourceHandle = this;
      } else if (this !== sourceHandle && !replaced) {
        replaced = true;
        const replacement = join(root, "attacker-during-copy");
        await writeFile(replacement, "attacker-bytes");
        await rename(replacement, finalPath);
      }
      return Reflect.apply(originalWrite as (...inner: unknown[]) => unknown, this, args);
    };
    try {
      const payload = Buffer.alloc(128 * 1024, 0x61);
      const result = await commitOperationOutput(options(root, (async function*(): AsyncGenerator<Uint8Array> {
        yield payload;
      })(), { artifactIdentity }));
      expect(result).toMatchObject({ status: "blocked", reason: "commit_indeterminate" });
      expect(replaced).toBe(true);
      expect(await readFile(finalPath, "utf8")).toBe("attacker-bytes");
    } finally {
      prototype.write = originalWrite;
    }
  });

  it("marks a partial destination indeterminate and treats it as a collision on replay", async () => {
    const root = await makeRoot("partial-destination-copy");
    const canonicalRoot = await realpath(root);
    const finalPath = join(canonicalRoot, deriveOperationOutputKey({
      operationId: "opaque-operation-id-7f0d",
      artifactIdentity: "partial-destination-copy",
      extensionHint: ".txt"
    }));
    const unrelatedPath = join(await makeRoot("unrelated-partial-copy-write"), "unrelated.txt");
    const unrelatedHandle = await open(unrelatedPath, "w+");
    const probe = await open(join(root, "probe"), "w+");
    const prototype = Object.getPrototypeOf(probe) as {
      write: (...args: unknown[]) => Promise<unknown>;
    };
    await probe.close();
    const originalWrite = prototype.write;
    let writeCalls = 0;
    prototype.write = async function(this: unknown, ...args: unknown[]): Promise<unknown> {
      const path = openedPaths.get(this as object);
      if (dirname(path ?? "") !== canonicalRoot) {
        return Reflect.apply(originalWrite as (...inner: unknown[]) => unknown, this, args);
      }
      writeCalls += 1;
      // Fault the destination after its first 64 KiB, independently of
      // unrelated writes or short writes while populating the source.
      if (path === finalPath && typeof args[3] === "number" && args[3] >= 64 * 1024) {
        throw new Error("injected destination copy failure");
      }
      return Reflect.apply(originalWrite as (...inner: unknown[]) => unknown, this, args);
    };
    try {
      for (const chunk of ["unrelated-", "writes-", "stay-safe"]) {
        await unrelatedHandle.write(Buffer.from(chunk));
      }
      expect(writeCalls).toBe(0);
      expect(await readFile(unrelatedPath, "utf8")).toBe("unrelated-writes-stay-safe");
      const payload = Buffer.concat([Buffer.alloc(64 * 1024, 0x61), Buffer.alloc(64 * 1024, 0x62)]);
      const result = await commitOperationOutput(options(root, (async function*(): AsyncGenerator<Uint8Array> {
        yield payload;
      })(), { artifactIdentity: "partial-destination-copy" }));
      expect(result).toMatchObject({ status: "blocked", reason: "commit_indeterminate" });
      expect(writeCalls).toBeGreaterThanOrEqual(3);
      expect((await stat(join(root, result.outputKey))).size).toBe(64 * 1024);

      const replay = await commitOperationOutput(options(root, bytes("replacement"), {
        artifactIdentity: "partial-destination-copy",
        expected: { bytes: payload.byteLength, sha256: sha256(payload) }
      }));
      expect(replay).toMatchObject({ status: "collision", reason: "existing_mismatch", outputKey: result.outputKey });
      expect((await stat(join(root, result.outputKey))).size).toBe(64 * 1024);
    } finally {
      prototype.write = originalWrite;
      await unrelatedHandle.close();
    }
  });

  it("reports a post-write fsync fault without claiming a final and preserves exact replay", async () => {
    const root = await makeRoot("write-ambiguity");
    const faulted = await commitOperationOutput(options(root, bytes("written"), {
      artifactIdentity: "post-write",
      hooks: { faultInjector: point => { if (point === "before_file_sync") throw new Error("private fsync fault"); } }
    }));
    expect(faulted).toMatchObject({ status: "blocked", reason: "file_sync_failed", bytes: 7, sha256: sha256("written") });
    expect((await readdir(root)).some(name => name === faulted.outputKey)).toBe(false);
    expect((await readdir(root)).filter(name => name.includes("partial-")).length).toBe(1);

    let sourceStarted = false;
    async function* nonRepeatable(): AsyncGenerator<Uint8Array> {
      sourceStarted = true;
      yield Buffer.from("different");
    }
    const committed = await commitOperationOutput(options(root, nonRepeatable(), {
      artifactIdentity: "post-write",
      expected: { bytes: 7, sha256: sha256("written") }
    }));
    expect(committed).toMatchObject({ status: "committed", reason: "recovered_after_crash" });
    expect(sourceStarted).toBe(false);
    const replay = await commitOperationOutput(options(root, bytes("different"), {
      artifactIdentity: "post-write",
      expected: { bytes: 7, sha256: sha256("written") }
    }));
    expect(replay).toMatchObject({ status: "reconciled", reason: "already_present", outputKey: committed.outputKey });
  });

  it("does not retain a partial after-write prefix as a complete receipt", async () => {
    const root = await makeRoot("partial-after-write");
    const faulted = await commitOperationOutput(options(root, (async function*(): AsyncGenerator<Uint8Array> {
      yield Buffer.from("prefix");
      yield Buffer.from("suffix");
    })(), {
      artifactIdentity: "partial-after-write",
      hooks: { faultInjector: point => { if (point === "after_write") throw new Error("private prefix fault"); } }
    }));
    expect(faulted).toMatchObject({ status: "blocked", reason: "write_failed", bytes: 6, sha256: sha256("prefix") });
    expect((await readdir(root)).filter(name => name.includes("partial-")).length).toBe(0);

    let sourceStarted = false;
    async function* nonRepeatable(): AsyncGenerator<Uint8Array> {
      sourceStarted = true;
      yield Buffer.from("different");
    }
    const replay = await commitOperationOutput(options(root, nonRepeatable(), {
      artifactIdentity: "partial-after-write",
      expected: { bytes: 6, sha256: sha256("prefix") }
    }));
    expect(replay).toMatchObject({ status: "blocked", reason: "source_mismatch", outputKey: faulted.outputKey });
    expect(sourceStarted).toBe(true);
    expect((await readdir(root)).some(name => name === replay.outputKey)).toBe(false);
  });

  it("copies a source chunk before an async hook can mutate caller-owned memory", async () => {
    const root = await makeRoot("chunk-copy");
    const chunk = Buffer.from("stable-bytes");
    const expected = Buffer.from(chunk);
    const result = await commitOperationOutput(options(root, (async function*(): AsyncGenerator<Uint8Array> {
      yield chunk;
    })(), {
      artifactIdentity: "chunk-copy",
      hooks: {
        faultInjector: async point => {
          if (point !== "before_write") return;
          chunk.fill(0x78);
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
      }
    }));
    expect(result).toMatchObject({ status: "committed", reason: "created", bytes: expected.byteLength, sha256: sha256(expected) });
    expect(await readFile(join(root, result.outputKey))).toEqual(expected);
  });

  it("awaits timed-out hook settlement before returning and leaves no late mutation", async () => {
    const root = await makeRoot("hook-settlement");
    let now = 0;
    let hookDone = false;
    let markHookStarted!: () => void;
    let releaseHook!: () => void;
    const hookStarted = new Promise<void>(resolve => { markHookStarted = resolve; });
    const hookRelease = new Promise<void>(resolve => { releaseHook = resolve; });
    const pending = commitOperationOutput(options(root, bytes("hook"), {
      artifactIdentity: "hook-settlement",
      timeoutMs: 5,
      now: () => now,
      hooks: {
        faultInjector: async point => {
          if (point !== "before_write") return;
          markHookStarted();
          await hookRelease;
          now = 10;
          hookDone = true;
        }
      }
    }));
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await hookStarted;
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseHook();
    const result = await pending;
    expect(hookDone).toBe(true);
    expect(result).toMatchObject({ status: "blocked", reason: "operation_timeout" });
    expect((await readdir(root)).some(name => name === result.outputKey)).toBe(false);
  });

  it("does not return while a delayed filesystem write is still settling", async () => {
    const root = await makeRoot("write-settlement");
    const canonicalRoot = await realpath(root);
    const unrelatedPath = join(await makeRoot("unrelated-delayed-write"), "unrelated.txt");
    const unrelatedHandle = await open(unrelatedPath, "w+");
    const probe = await open(join(root, "probe"), "w+");
    const prototype = Object.getPrototypeOf(probe) as {
      write: (...args: unknown[]) => Promise<unknown>;
    };
    await probe.close();
    const originalWrite = prototype.write;
    let now = 0;
    let writeSettled = false;
    let markWriteStarted!: () => void;
    let releaseWrite: () => void = () => undefined;
    const writeStarted = new Promise<void>(resolve => { markWriteStarted = resolve; });
    let writeRelease = Promise.resolve();
    prototype.write = async function(this: unknown, ...args: unknown[]): Promise<unknown> {
      if (dirname(openedPaths.get(this as object) ?? "") !== canonicalRoot) {
        return Reflect.apply(originalWrite as (...inner: unknown[]) => unknown, this, args);
      }
      markWriteStarted();
      await writeRelease;
      now = 10;
      writeSettled = true;
      return Reflect.apply(originalWrite as (...inner: unknown[]) => unknown, this, args);
    };
    try {
      await unrelatedHandle.write(Buffer.from("unrelated"));
      expect(now).toBe(0);
      expect(writeSettled).toBe(false);
      expect(await readFile(unrelatedPath, "utf8")).toBe("unrelated");
      writeRelease = new Promise<void>(resolve => { releaseWrite = resolve; });
      const pending = commitOperationOutput(options(root, bytes("write"), {
        artifactIdentity: "write-settlement",
        timeoutMs: 5,
        now: () => now
      }));
      let settled = false;
      void pending.then(() => { settled = true; }, () => { settled = true; });
      await writeStarted;
      await Promise.resolve();
      expect(settled).toBe(false);
      releaseWrite();
      const result = await pending;
      expect(writeSettled).toBe(true);
      expect(result).toMatchObject({ status: "blocked", reason: "commit_indeterminate" });
      expect((await readdir(root)).some(name => name === result.outputKey)).toBe(false);
    } finally {
      releaseWrite();
      prototype.write = originalWrite;
      await unrelatedHandle.close();
    }
  });

  it("closes and awaits a source iterator after a delayed source outcome", async () => {
    const root = await makeRoot("iterator-close");
    let nextCalls = 0;
    let closed = false;
    let now = 0;
    let markSecondStarted!: () => void;
    let releaseSecond!: () => void;
    let markCloseStarted!: () => void;
    let releaseClose!: () => void;
    const secondStarted = new Promise<void>(resolve => { markSecondStarted = resolve; });
    const secondRelease = new Promise<void>(resolve => { releaseSecond = resolve; });
    const closeStarted = new Promise<void>(resolve => { markCloseStarted = resolve; });
    const closeRelease = new Promise<void>(resolve => { releaseClose = resolve; });
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            nextCalls += 1;
            if (nextCalls === 1) return { done: false, value: Buffer.from("first") };
            markSecondStarted();
            await secondRelease;
            now = 10;
            return { done: false, value: Buffer.from("late") };
          },
          async return(): Promise<IteratorResult<Uint8Array>> {
            markCloseStarted();
            await closeRelease;
            closed = true;
            return { done: true, value: undefined };
          }
        };
      }
    };
    const pending = commitOperationOutput(options(root, source, {
      artifactIdentity: "iterator-close",
      timeoutMs: 5,
      now: () => now
    }));
    let settled = false;
    void pending.then(
      () => { settled = true; },
      () => { settled = true; }
    );

    await secondStarted;
    expect(nextCalls).toBe(2);
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseSecond();
    await closeStarted;
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseClose();
    const result = await pending;
    expect(closed).toBe(true);
    expect(result).toMatchObject({ status: "blocked", reason: "operation_timeout" });
    expect((await readdir(root)).some(name => name === result.outputKey)).toBe(false);
  });

  it("hard-bounds a never-settling next and quarantines the provider", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot("never-next");
      let nextStarted!: () => void;
      const started = new Promise<void>(resolve => { nextStarted = resolve; });
      let returnCalled = 0;
      const source: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return {
            next: async (): Promise<IteratorResult<Uint8Array>> => {
              nextStarted();
              return await new Promise<IteratorResult<Uint8Array>>(() => undefined);
            },
            return: async (): Promise<IteratorResult<Uint8Array>> => {
              returnCalled += 1;
              return await new Promise<IteratorResult<Uint8Array>>(() => undefined);
            }
          };
        }
      };
      const pending = commitOperationOutput(options(root, source, {
        artifactIdentity: "never-next",
        timeoutMs: 5,
        now: () => 0
      }));
      await started;
      let settled = false;
      void pending.then(() => { settled = true; }, () => { settled = true; });
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(5);
      const result = await pending;
      expect(result).toMatchObject({ status: "blocked", reason: "commit_indeterminate" });
      expect(returnCalled).toBe(1);
      expect((await readdir(root)).some(name => name === result.outputKey)).toBe(false);
      expect((await readdir(root)).filter(name => name.includes("partial-")).length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the default provider-read bound without caller timing options", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot("default-never-next");
      let nextStarted!: () => void;
      const started = new Promise<void>(resolve => { nextStarted = resolve; });
      let resolveNext!: (value: IteratorResult<Uint8Array>) => void;
      let nextCalls = 0;
      let returnCalls = 0;
      const source: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return {
            next: async (): Promise<IteratorResult<Uint8Array>> => {
              nextCalls += 1;
              nextStarted();
              return await new Promise<IteratorResult<Uint8Array>>(resolve => { resolveNext = resolve; });
            },
            return: async (): Promise<IteratorResult<Uint8Array>> => {
              returnCalls += 1;
              return { done: true, value: undefined };
            }
          };
        }
      };
      const pending = commitOperationOutput(options(root, source, { artifactIdentity: "default-never-next" }));
      await started;
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await pending;
      expect(result).toMatchObject({ status: "blocked", reason: "commit_indeterminate" });
      expect(nextCalls).toBe(1);
      expect(returnCalls).toBe(1);
      resolveNext({ done: true, value: undefined });
      await vi.advanceTimersByTimeAsync(0);
      expect(nextCalls).toBe(1);
      expect((await readdir(root)).some(name => name === result.outputKey)).toBe(false);
      expect((await readdir(root)).filter(name => name.includes("partial-")).length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hard-bounds a never-settling return without waiting on provider cleanup", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot("never-return");
      let returnCalled = 0;
      let markReturnStarted!: () => void;
      const returnStarted = new Promise<void>(resolve => { markReturnStarted = resolve; });
      const source: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return {
            next: async (): Promise<IteratorResult<Uint8Array>> => ({ done: false, value: "invalid" as unknown as Uint8Array }),
            return: async (): Promise<IteratorResult<Uint8Array>> => {
              returnCalled += 1;
              markReturnStarted();
              return await new Promise<IteratorResult<Uint8Array>>(() => undefined);
            }
          };
        }
      };
      const pending = commitOperationOutput(options(root, source, {
        artifactIdentity: "never-return",
        timeoutMs: 5,
        now: () => 0
      }));
      // Let the invalid chunk reach the cleanup boundary, then advance the
      // configured deadline. No wall-clock sleep is used to prove settlement.
      await returnStarted;
      expect(returnCalled).toBe(1);
      await vi.advanceTimersByTimeAsync(5);
      const result = await pending;
      expect(result).toMatchObject({ status: "blocked", reason: "commit_indeterminate" });
      expect((await readdir(root)).some(name => name === result.outputKey)).toBe(false);
      expect((await readdir(root)).filter(name => name.includes("partial-")).length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an oversized provider chunk before accepting it", async () => {
    const root = await makeRoot("oversized-chunk");
    const oversized = new Uint8Array((8 * 1024 * 1024) + 1);
    let yielded = false;
    const result = await commitOperationOutput(options(root, (async function*(): AsyncGenerator<Uint8Array> {
      yielded = true;
      yield oversized;
    })(), { artifactIdentity: "oversized-chunk", maxBytes: 512 * 1024 * 1024 }));
    expect(yielded).toBe(true);
    expect(result).toMatchObject({ status: "blocked", reason: "source_invalid", bytes: 0 });
    expect((await readdir(root)).some(name => name === result.outputKey)).toBe(false);
  });

  it("bounds an unbounded stream of empty chunks while allowing an immediate empty artifact", async () => {
    const root = await makeRoot("empty-chunk-stream");
    let nextCalls = 0;
    let returnCalls = 0;
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: async (): Promise<IteratorResult<Uint8Array>> => {
            nextCalls += 1;
            return { done: false, value: new Uint8Array(0) };
          },
          return: async (): Promise<IteratorResult<Uint8Array>> => {
            returnCalls += 1;
            return { done: true, value: undefined };
          }
        };
      }
    };
    const result = await commitOperationOutput(options(root, source, { artifactIdentity: "empty-chunk-stream" }));
    expect(result).toMatchObject({ status: "blocked", reason: "source_invalid", bytes: 0 });
    expect(nextCalls).toBe(65_537);
    expect(returnCalls).toBe(1);
    expect((await readdir(root)).filter(name => name.includes("partial-")).length).toBe(0);

    const immediate = await commitOperationOutput(options(root, bytes(), { artifactIdentity: "immediate-empty" }));
    expect(immediate).toMatchObject({ status: "committed", bytes: 0 });
  });
});
