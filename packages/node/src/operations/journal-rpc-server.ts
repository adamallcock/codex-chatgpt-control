import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, opendir, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { OperationJournal, type LoadedOperationJournalV1 } from "./journal.js";
import { assertOperationEventShape, assertOperationId, assertOperationStateShape } from "./state-machine.js";
import type { OperationJournalAuthority } from "./journal-authority.js";
import {
  JOURNAL_RPC_DESCRIPTOR_VERSION, JOURNAL_RPC_DIGEST, JOURNAL_RPC_METHODS, JOURNAL_RPC_UUID,
  assertJournalRpcPlatform, assertPrivateDirectory, exactRecord, isMissing, openRpcValue, publishPrivateFile, readPrivateFile,
  rpcError, rpcSleep, rpcTimeout, sealRpcValue,
  type JournalRpcDescriptor, type JournalRpcMethod
} from "./journal-rpc-protocol.js";

export type JournalRpcServerOptions = {
  stateRoot: string;
  /** A new session directory; existing directories are never reused or overwritten. */
  directory: string;
  pollIntervalMs?: number;
  maxConcurrent?: number;
  maxPendingEntries?: number;
  maxRecentRequests?: number;
  callTimeoutMs?: number;
};
export type JournalRpcServer = { descriptorPath: string; close(): Promise<void> };
const SAFE_JOURNAL_CODES = new Set([
  "operation_receipt_expired", "operation_compacted", "creation_event_required", "duplicate_operation_created", "journal_corrupt",
  "revision_conflict", "operation_not_found", "operation_binding_mismatch", "operation_request_mismatch", "operation_tombstoned",
  "journal_quota_exceeded", "journal_lock_timeout", "lock_timeout", "journal_snapshot_corrupt",
  "journal_record_corrupt", "journal_state_corrupt", "journal_quota_counter_corrupt", "journal_scan_limit",
  "operation_handle_mismatch", "operation_handle_ahead", "operation_handle_state_mismatch", "operation_handle_target_mismatch",
  "invalid_operation_handle", "invalid_operation_request", "invalid_expected_revision", "invalid_operation_event",
  "invalid_evidence_domain", "invalid_evidence_material", "evidence_material_too_large"
]);
// Only these native failures prove the requested event was not persisted.
// Errors from quota repair, sync, close or lock release may follow a write.
const PREWRITE_REJECTION_CODES = new Set([
  "revision_conflict", "operation_request_mismatch", "operation_binding_mismatch",
  "invalid_expected_revision", "invalid_operation_event", "creation_event_required",
  "duplicate_operation_created", "operation_receipt_expired", "operation_compacted",
  "journal_quota_exceeded", "journal_lock_timeout", "journal_rpc_protocol_error"
]);
const LIVE_ID_TTL_MS = 60_000;
const MAX_RECENT_IDS = 4096;

export async function startJournalRpcServer(options: JournalRpcServerOptions): Promise<JournalRpcServer> {
  // Refuse unsupported filesystem authority before opening the journal,
  // creating session directories or generating any connection secret.
  assertJournalRpcPlatform();
  const directory = options.directory;
  if (!isAbsolute(directory) || resolve(directory) !== directory || !isAbsolute(options.stateRoot)) {
    throw rpcError("journal_rpc_protocol_error");
  }
  const pollMs = boundedInteger(options.pollIntervalMs ?? 10, 1, 1000);
  const maxConcurrent = boundedInteger(options.maxConcurrent ?? 4, 1, 8);
  const maxEntries = boundedInteger(options.maxPendingEntries ?? 128, 1, 128);
  const callTimeoutMs = rpcTimeout(options.callTimeoutMs);
  const maxRecentRequests = boundedInteger(options.maxRecentRequests ?? MAX_RECENT_IDS, 1, MAX_RECENT_IDS);
  const journal = await OperationJournal.open({ stateRoot: options.stateRoot });
  await mkdir(directory, { mode: 0o700 });
  await assertPrivateDirectory(directory);
  const requestDirectory = join(directory, "requests");
  const responseDirectory = join(directory, "responses");
  await mkdir(requestDirectory, { mode: 0o700 });
  await mkdir(responseDirectory, { mode: 0o700 });
  const descriptor: JournalRpcDescriptor = {
    schemaVersion: JOURNAL_RPC_DESCRIPTOR_VERSION,
    transport: "file", directory, instanceId: randomUUID(), token: randomBytes(32).toString("base64url")
  };
  const descriptorPath = join(directory, "connection.json");
  await publishPrivateFile(directory, "connection.json", JSON.stringify(descriptor));
  const inFlight = new Set<Promise<void>>();
  const recent = new Map<string, number>();
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const loop = (async () => {
    while (!closing) {
      try {
        await assertPrivateDirectory(directory);
        await assertPrivateDirectory(requestDirectory);
        await assertPrivateDirectory(responseDirectory);
        const now = Date.now();
        for (const [id, expires] of recent) {
          if (expires > now) break;
          recent.delete(id);
          await unlink(join(responseDirectory, `${id}.response.json`)).catch(() => undefined);
          await unlink(join(requestDirectory, `${id}.request.json`)).catch(() => undefined);
        }
        if (inFlight.size < maxConcurrent) {
          const names = await boundedEntries(requestDirectory, maxEntries);
          for (const name of names) {
            if (closing || inFlight.size >= maxConcurrent) break;
            const id = requestId(name);
            if (id === undefined || recent.has(id)) continue;
            let payload: unknown;
            try {
              payload = openRpcValue(descriptor, id, "request", await readPrivateFile(join(requestDirectory, name)));
            } catch (error) {
              if (!isMissing(error)) {
                // Invalid/partial files never authorize an operation. They are
                // retained for the request's owner to remove; no private data is logged.
              }
              continue;
            }
            if (recent.size >= maxRecentRequests) break;
            try {
              exactRecord(payload, ["method", "args", "issuedAt", "expiresAt"]);
              const issued = payload.issuedAt;
              const expires = payload.expiresAt;
              if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires)
                || (issued as number) > Date.now() + 1000 || (expires as number) <= Date.now()
                || (expires as number) <= (issued as number) || (expires as number) - (issued as number) > 30_000
                || !JOURNAL_RPC_METHODS.has(payload.method as JournalRpcMethod) || !Array.isArray(payload.args)) {
                throw rpcError("journal_rpc_protocol_error");
              }
              recent.set(id, Date.now() + LIVE_ID_TTL_MS);
              await unlink(join(requestDirectory, name));
              const method = payload.method as JournalRpcMethod;
              const args = payload.args;
              const deadline = Math.min(expires as number, Date.now() + callTimeoutMs);
              let task: Promise<void>;
              task = execute(method, args, id, deadline).finally(() => { inFlight.delete(task); });
              inFlight.add(task);
            } catch {
              // Authenticated but malformed requests still cannot mutate.
              recent.set(id, Date.now() + LIVE_ID_TTL_MS);
              await unlink(join(requestDirectory, name)).catch(() => undefined);
              await respond(id, { ok: false, error: { code: "journal_rpc_protocol_error" } });
            }
          }
        }
      } catch {
        // Missing/replaced/oversized mailbox evidence is unavailable, never permission to truncate a scan.
      }
      if (!closing) await rpcSleep(pollMs);
    }
  })();

  async function respond(id: string, value: unknown): Promise<void> {
    try {
      await publishPrivateFile(responseDirectory, `${id}.response.json`, sealRpcValue(descriptor, id, "response", value));
    } catch {
      // A lost response is explicitly indeterminate for mutation calls. Never overwrite another response.
    }
  }

  async function execute(method: JournalRpcMethod, args: unknown[], id: string, deadline: number): Promise<void> {
    if (Date.now() >= deadline) {
      await respond(id, { ok: false, error: { code: "journal_rpc_unavailable" } });
      return;
    }
    let responded = false;
    const timer = setTimeout(() => {
      if (responded) return;
      responded = true;
      void respond(id, { ok: false, error: { code: mutation(method)
        ? "journal_rpc_outcome_indeterminate" : "journal_rpc_unavailable" } });
    }, Math.max(1, deadline - Date.now()));
    try {
      const result = await invokeJournal(journal, method, args);
      if (!responded) {
        responded = true;
        await respond(id, { ok: true, result });
      }
    } catch (error) {
      if (!responded) {
        responded = true;
        const observed = safeJournalCode(error);
        const code = mutation(method) && !PREWRITE_REJECTION_CODES.has(observed)
          ? "journal_rpc_outcome_indeterminate" : observed;
        await respond(id, { ok: false, error: { code } });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    descriptorPath,
    close: () => closePromise ??= (async () => {
      closing = true;
      // Invalidates discovery while allowing admitted work to release real process locks.
      await unlink(descriptorPath).catch(() => undefined);
      await loop;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const settled = await Promise.race([
          Promise.allSettled([...inFlight]).then(() => true),
          new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), callTimeoutMs); })
        ]);
        if (!settled) throw rpcError("journal_rpc_outcome_indeterminate");
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    })()
  };
}

async function invokeJournal(journal: OperationJournalAuthority, method: JournalRpcMethod, args: unknown[]): Promise<unknown> {
  switch (method) {
    case "create":
      requireCount(args, 1); assertOperationEventShape(args[0]);
      if (args[0].type !== "operation_created") throw rpcError("journal_rpc_protocol_error");
      return publicLoaded(await journal.create(args[0]));
    case "append":
      requireCount(args, 3); assertOperationId(args[0] as string); assertOperationEventShape(args[2]);
      if (!Number.isSafeInteger(args[1]) || (args[1] as number) < 0) throw rpcError("journal_rpc_protocol_error");
      return publicLoaded(await journal.append(args[0] as string, args[1] as number, args[2]));
    case "load":
      if (args.length !== 1 && args.length !== 2) throw rpcError("journal_rpc_protocol_error");
      assertOperationId(args[0] as string);
      if (args[1] !== undefined && (typeof args[1] !== "string" || !JOURNAL_RPC_DIGEST.test(args[1]))) throw rpcError("journal_rpc_protocol_error");
      return publicLoaded(await journal.load(args[0] as string, args[1] as string | undefined));
    case "handleFromState":
      requireCount(args, 1); assertOperationStateShape(args[0]);
      return journal.handleFromState(args[0]);
    case "validateHandle":
      requireCount(args, 2); assertOperationStateShape(args[1]);
      return journal.validateHandle(args[0] as Parameters<OperationJournalAuthority["validateHandle"]>[0], args[1]);
    case "submitRequestDigest":
      requireCount(args, 2);
      return journal.submitRequestDigest(...args as Parameters<OperationJournalAuthority["submitRequestDigest"]>);
    case "controlRequestDigest":
      requireCount(args, 1);
      return journal.controlRequestDigest(...args as Parameters<OperationJournalAuthority["controlRequestDigest"]>);
    case "evidenceDigest":
      requireCount(args, 2);
      if (typeof args[0] !== "string") throw rpcError("journal_rpc_protocol_error");
      return journal.evidenceDigest(args[0], args[1]);
  }
}
function requireCount(args: unknown[], count: number): void {
  if (args.length !== count) throw rpcError("journal_rpc_protocol_error");
}
function safeJournalCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    && (SAFE_JOURNAL_CODES.has(error.code) || error.code === "journal_rpc_protocol_error")) return error.code;
  return "journal_rpc_request_rejected";
}
function mutation(method: JournalRpcMethod): boolean { return method === "create" || method === "append"; }
function boundedInteger(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw rpcError("journal_rpc_limit_exceeded");
  return value;
}
function requestId(name: string): string | undefined {
  const id = name.replace(/\.request\.json$/u, "");
  return `${id}.request.json` === name && JOURNAL_RPC_UUID.test(id) ? id : undefined;
}
async function boundedEntries(directory: string, max: number): Promise<string[]> {
  const names: string[] = [];
  const entries = await opendir(directory);
  let count = 0;
  for await (const entry of entries) {
    count += 1;
    if (count > max) throw rpcError("journal_rpc_limit_exceeded");
    if (!entry.isFile() || entry.name.startsWith(".pending-")) continue;
    names.push(entry.name);
  }
  return names;
}

function publicLoaded(value: LoadedOperationJournalV1): LoadedOperationJournalV1 {
  // Journal parsing metadata is private; transmit only the declared authority result.
  return { state: value.state, envelopes: value.envelopes, committedBytes: value.committedBytes,
    partialTailBytes: value.partialTailBytes,
    ...(value.lastEventDigest === undefined ? {} : { lastEventDigest: value.lastEventDigest }) };
}
