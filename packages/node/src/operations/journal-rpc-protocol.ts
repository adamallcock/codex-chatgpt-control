import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, link, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { platform, userInfo } from "node:os";
import { canonicalJson } from "./canonical.js";
import { OperationJournalError } from "./journal.js";

export const JOURNAL_RPC_DESCRIPTOR_VERSION = "chatgpt.journal_rpc.descriptor.v1" as const;
export const JOURNAL_RPC_VERSION = "chatgpt.journal_rpc.v1" as const;
export const JOURNAL_RPC_MAX_WIRE_BYTES = 24 * 1024 * 1024;
export const JOURNAL_RPC_MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
export const JOURNAL_RPC_MAX_TIMEOUT_MS = 30_000;
export const JOURNAL_RPC_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const JOURNAL_RPC_DIGEST = /^hmac-sha256:[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const WIRE_KEYS = ["version", "instanceId", "requestId", "direction", "nonce", "body", "tag"];

export type JournalRpcDescriptor = {
  schemaVersion: typeof JOURNAL_RPC_DESCRIPTOR_VERSION;
  transport: "file";
  directory: string;
  instanceId: string;
  token: string;
};
export type JournalRpcDirection = "request" | "response";
export type JournalRpcMethod = "create" | "append" | "load" | "submitRequestDigest" |
  "controlRequestDigest" | "evidenceDigest" | "handleFromState" | "validateHandle";
export const JOURNAL_RPC_METHODS = new Set<JournalRpcMethod>([
  "create", "append", "load", "submitRequestDigest", "controlRequestDigest", "evidenceDigest", "handleFromState", "validateHandle"
]);

export function rpcError(code: string): OperationJournalError {
  return new OperationJournalError(code, `Journal authority request failed (${code}).`);
}

/** POSIX ownership/mode checks cannot establish private Windows ACLs. */
export function assertJournalRpcPlatform(): void {
  if (platform() === "win32") throw rpcError("journal_rpc_unsupported_platform");
}

export function exactRecord(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw rpcError("journal_rpc_protocol_error");
  }
}

export function validateDescriptor(value: unknown): JournalRpcDescriptor {
  exactRecord(value, ["schemaVersion", "transport", "directory", "instanceId", "token"]);
  if (value.schemaVersion !== JOURNAL_RPC_DESCRIPTOR_VERSION || value.transport !== "file"
    || typeof value.directory !== "string" || !isAbsolute(value.directory) || resolve(value.directory) !== value.directory
    || typeof value.instanceId !== "string" || !JOURNAL_RPC_UUID.test(value.instanceId)
    || typeof value.token !== "string" || !TOKEN.test(value.token)
    || Buffer.from(value.token, "base64url").toString("base64url") !== value.token) {
    throw rpcError("journal_rpc_protocol_error");
  }
  return value as unknown as JournalRpcDescriptor;
}

export function rpcTimeout(value: number | undefined): number {
  const timeout = value ?? JOURNAL_RPC_MAX_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > JOURNAL_RPC_MAX_TIMEOUT_MS) {
    throw rpcError("journal_rpc_limit_exceeded");
  }
  return timeout;
}

export function sealRpcValue(
  descriptor: JournalRpcDescriptor,
  requestId: string,
  direction: JournalRpcDirection,
  value: unknown
): string {
  const plaintext = canonicalJson(value);
  if (Buffer.byteLength(plaintext) > JOURNAL_RPC_MAX_PLAINTEXT_BYTES) throw rpcError("journal_rpc_limit_exceeded");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", directionKey(descriptor.token, direction), nonce);
  cipher.setAAD(aad(descriptor.instanceId, requestId, direction));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const wire = JSON.stringify({
    version: JOURNAL_RPC_VERSION,
    instanceId: descriptor.instanceId,
    requestId,
    direction,
    nonce: nonce.toString("base64"),
    body: body.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  });
  if (Buffer.byteLength(wire) > JOURNAL_RPC_MAX_WIRE_BYTES) throw rpcError("journal_rpc_limit_exceeded");
  return wire;
}

export function openRpcValue(
  descriptor: JournalRpcDescriptor,
  requestId: string,
  direction: JournalRpcDirection,
  wire: string
): unknown {
  try {
    if (Buffer.byteLength(wire) > JOURNAL_RPC_MAX_WIRE_BYTES) throw new Error();
    const envelope: unknown = JSON.parse(wire);
    exactRecord(envelope, WIRE_KEYS);
    if (envelope.version !== JOURNAL_RPC_VERSION || envelope.instanceId !== descriptor.instanceId
      || envelope.requestId !== requestId || envelope.direction !== direction) throw new Error();
    const nonce = base64(envelope.nonce, 12);
    const tag = base64(envelope.tag, 16);
    const body = base64(envelope.body);
    const decipher = createDecipheriv("aes-256-gcm", directionKey(descriptor.token, direction), nonce);
    decipher.setAAD(aad(descriptor.instanceId, requestId, direction));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
    if (plaintext.length > JOURNAL_RPC_MAX_PLAINTEXT_BYTES) throw new Error();
    const text = plaintext.toString("utf8");
    const value = decodeCanonical(JSON.parse(text));
    // Reject lossy UTF-8, ambiguous tags, noncanonical numbers and encodings.
    if (canonicalJson(value) !== text) throw new Error();
    return value;
  } catch {
    throw rpcError("journal_rpc_authentication_failed");
  }
}

function directionKey(token: string, direction: JournalRpcDirection): Buffer {
  return createHmac("sha256", Buffer.from(token, "base64url"))
    .update(`chatgpt/journal-rpc/${direction}/v1`).digest();
}
function aad(instanceId: string, requestId: string, direction: JournalRpcDirection): Buffer {
  return Buffer.from(`${JOURNAL_RPC_VERSION}\0${instanceId}\0${requestId}\0${direction}`);
}
function base64(value: unknown, length?: number): Buffer {
  if (typeof value !== "string" || value.length > JOURNAL_RPC_MAX_WIRE_BYTES) throw new Error();
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || (length !== undefined && bytes.length !== length)) throw new Error();
  return bytes;
}
function decodeCanonical(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  budget.nodes += 1;
  if (depth > 32 || budget.nodes > 100_000) throw new Error();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    if (value.length > 32_768) throw new Error();
    return value.map(item => decodeCanonical(item, depth + 1, budget));
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > 32_768) throw new Error();
  if (keys.length === 1 && record.$undefined === true) return undefined;
  if (keys.length === 1 && typeof record.$date === "string") {
    const date = new Date(record.$date);
    if (date.toISOString() !== record.$date) throw new Error();
    return date;
  }
  if (keys.length === 1 && typeof record.$bytes === "string") return new Uint8Array(base64(record.$bytes));
  const decoded: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (["$undefined", "$date", "$bytes"].includes(key)) throw new Error();
    decoded[key] = decodeCanonical(record[key], depth + 1, budget);
  }
  return decoded;
}

export async function assertPrivateDirectory(directory: string): Promise<void> {
  assertJournalRpcPlatform();
  const info = await lstat(directory);
  const uid = userInfo().uid;
  if (!isAbsolute(directory) || resolve(directory) !== directory || await realpath(directory) !== directory
    || !info.isDirectory() || info.isSymbolicLink() || uid < 0 || info.uid !== uid || (info.mode & 0o077) !== 0) {
    throw rpcError("journal_rpc_unavailable");
  }
}

export async function readPrivateFile(path: string, maxBytes = JOURNAL_RPC_MAX_WIRE_BYTES): Promise<string> {
  assertJournalRpcPlatform();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (info.nlink === 2) throw rpcError("journal_rpc_file_pending");
    if (!info.isFile() || info.nlink !== 1 || info.uid !== userInfo().uid || (info.mode & 0o077) !== 0
      || info.size < 0 || info.size > maxBytes) throw rpcError("journal_rpc_limit_exceeded");
    // A bounded buffer avoids reading an unbounded concurrently growing file.
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await file.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    const after = await file.stat();
    if (offset !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs
      || after.ctimeMs !== info.ctimeMs || after.nlink !== 1) throw rpcError("journal_rpc_protocol_error");
    return bytes.subarray(0, offset).toString("utf8");
  } finally {
    await file.close();
  }
}

/** Exclusive final publication; readers can never observe a partial body. */
export async function publishPrivateFile(directory: string, name: string, body: string): Promise<void> {
  assertJournalRpcPlatform();
  if (!/^[a-zA-Z0-9.-]+$/u.test(name)) throw rpcError("journal_rpc_protocol_error");
  await assertPrivateDirectory(directory);
  const finalPath = join(directory, name);
  const temporary = join(directory, `.pending-${randomBytes(16).toString("hex")}`);
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try {
      await file.writeFile(body, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await link(temporary, finalPath);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
export const rpcSleep = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));
