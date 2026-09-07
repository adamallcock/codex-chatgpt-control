import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { OperationJournalError, type LoadedOperationJournalV1 } from "./journal.js";
import type { OperationJournalAuthority } from "./journal-authority.js";
import { assertOperationEventShape, assertOperationStateShape } from "./state-machine.js";
import { OPERATION_EVENT_SCHEMA_VERSION, OPERATION_HANDLE_SCHEMA_VERSION, type OperationHandleV1, type OperationStateV1 } from "./types.js";
import {
  JOURNAL_RPC_DESCRIPTOR_VERSION, JOURNAL_RPC_DIGEST, assertJournalRpcPlatform, assertPrivateDirectory, exactRecord,
  isMissing, openRpcValue, publishPrivateFile, readPrivateFile, rpcError, rpcSleep, rpcTimeout,
  sealRpcValue, validateDescriptor, type JournalRpcDescriptor, type JournalRpcMethod
} from "./journal-rpc-protocol.js";

export type { JournalRpcDescriptor } from "./journal-rpc-protocol.js";
export type JournalRpcClientOptions = Pick<JournalRpcDescriptor, "directory" | "instanceId" | "token"> & { timeoutMs?: number };
const SAFE_REMOTE_CODES = new Set([
  "operation_receipt_expired", "operation_compacted", "creation_event_required", "duplicate_operation_created", "journal_corrupt",
  "revision_conflict", "operation_not_found", "operation_binding_mismatch", "operation_request_mismatch", "operation_tombstoned",
  "journal_quota_exceeded", "journal_lock_timeout", "lock_timeout", "journal_snapshot_corrupt",
  "journal_record_corrupt", "journal_state_corrupt", "journal_quota_counter_corrupt", "journal_scan_limit",
  "operation_handle_mismatch", "operation_handle_ahead", "operation_handle_state_mismatch", "operation_handle_target_mismatch",
  "invalid_operation_handle", "invalid_operation_request", "invalid_expected_revision", "invalid_operation_event",
  "invalid_evidence_domain", "invalid_evidence_material", "evidence_material_too_large",
  "journal_rpc_protocol_error", "journal_rpc_unavailable", "journal_rpc_outcome_indeterminate", "journal_rpc_request_rejected"
]);

export async function readJournalRpcDescriptor(descriptorPath: string): Promise<JournalRpcDescriptor> {
  assertJournalRpcPlatform();
  try {
    await assertPrivateDirectory(dirname(descriptorPath));
    const descriptor = validateDescriptor(JSON.parse(await readPrivateFile(descriptorPath, 4096)));
    await assertPrivateDirectory(descriptor.directory);
    await assertPrivateDirectory(join(descriptor.directory, "requests"));
    await assertPrivateDirectory(join(descriptor.directory, "responses"));
    return descriptor;
  } catch {
    throw rpcError("journal_rpc_unavailable");
  }
}

export async function createJournalRpcClientFromDescriptor(
  descriptorPath: string,
  options: { timeoutMs?: number } = {}
): Promise<OperationJournalAuthority> {
  return createJournalRpcClient({ ...await readJournalRpcDescriptor(descriptorPath), ...options });
}

/** Explicit private-filesystem transport. There is no subprocess or network fallback. */
export function createJournalRpcClient(options: JournalRpcClientOptions): OperationJournalAuthority {
  assertJournalRpcPlatform();
  const descriptor = validateDescriptor({
    schemaVersion: JOURNAL_RPC_DESCRIPTOR_VERSION, transport: "file",
    directory: options.directory, instanceId: options.instanceId, token: options.token
  });
  const timeoutMs = rpcTimeout(options.timeoutMs);
  const requests = join(descriptor.directory, "requests");
  const responses = join(descriptor.directory, "responses");

  // Backpressure precedes serialization/publication, including concurrent digest
  // requests for large file manifests. Waiting calls never create mailbox files.
  let active = 0;
  type Waiter = { deadlineAt: number; resolve(): void; reject(error: OperationJournalError): void; timer: ReturnType<typeof setTimeout> };
  const waiting: Waiter[] = [];
  async function acquire(deadlineAt: number): Promise<void> {
    if (Date.now() >= deadlineAt) throw rpcError("journal_rpc_unavailable");
    if (active < 4) { active += 1; return; }
    if (waiting.length >= 1024) throw rpcError("journal_rpc_limit_exceeded");
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        deadlineAt, resolve, reject,
        timer: setTimeout(() => {
          const index = waiting.indexOf(waiter);
          if (index < 0) return;
          waiting.splice(index, 1);
          reject(rpcError("journal_rpc_unavailable"));
        }, Math.max(1, deadlineAt - Date.now()))
      };
      waiting.push(waiter);
    });
  }
  function release(): void {
    while (waiting.length > 0) {
      const next = waiting.shift()!;
      clearTimeout(next.timer);
      // The release microtask may run before an overdue queue timer.
      if (Date.now() >= next.deadlineAt) { next.reject(rpcError("journal_rpc_unavailable")); continue; }
      next.resolve();
      return;
    }
    active -= 1;
  }

  async function call(method: JournalRpcMethod, args: unknown[]): Promise<unknown> {
    const issuedAt = Date.now();
    const expiresAt = issuedAt + timeoutMs;
    await acquire(expiresAt);
    try { return await dispatch(method, args, issuedAt, expiresAt); } finally { release(); }
  }

  async function dispatch(method: JournalRpcMethod, args: unknown[], issuedAt: number, expiresAt: number): Promise<unknown> {
    const id = randomUUID();
    let published = false;
    let remoteError: OperationJournalError | undefined;
    try {
      if (Date.now() >= expiresAt) throw rpcError("journal_rpc_unavailable");
      const request = sealRpcValue(descriptor, id, "request", { method, args, issuedAt, expiresAt });
      await assertPrivateDirectory(descriptor.directory);
      await assertPrivateDirectory(requests);
      await assertPrivateDirectory(responses);
      if (Date.now() >= expiresAt) throw rpcError("journal_rpc_unavailable");
      // Once publication is attempted, a filesystem error cannot prove that
      // the final link was never visible to the authority.
      published = true;
      await publishPrivateFile(requests, `${id}.request.json`, request);
      do {
        try {
          const wire = await readPrivateFile(join(responses, `${id}.response.json`));
          const value = openRpcValue(descriptor, id, "response", wire);
          if (typeof value !== "object" || value === null || !("ok" in value)) throw rpcError("journal_rpc_protocol_error");
          const record = value as Record<string, unknown>;
          if (record.ok === true) {
            exactRecord(record, ["ok", "result"]);
            return record.result;
          }
          exactRecord(record, ["ok", "error"]);
          exactRecord(record.error, ["code"]);
          if (record.ok !== false || typeof record.error.code !== "string" || !SAFE_REMOTE_CODES.has(record.error.code)) {
            throw rpcError("journal_rpc_protocol_error");
          }
          remoteError = rpcError(record.error.code);
          throw remoteError;
        } catch (error) {
          if (!isMissing(error) && !(error instanceof OperationJournalError && error.code === "journal_rpc_file_pending")) throw error;
        }
        if (Date.now() >= expiresAt) break;
        await rpcSleep(Math.min(10, expiresAt - Date.now()));
      } while (Date.now() <= expiresAt);
      throw rpcError("journal_rpc_unavailable");
    } catch (error) {
      if (remoteError !== undefined) throw remoteError;
      if (published && (method === "create" || method === "append")) throw rpcError("journal_rpc_outcome_indeterminate");
      if (error instanceof OperationJournalError) throw error;
      throw rpcError("journal_rpc_unavailable");
    } finally {
      // Unclaimed expired requests cannot execute later. Admitted mutations
      // may still finish; their timeout is indeterminate and never auto-retried.
      await unlink(join(requests, `${id}.request.json`)).catch(() => undefined);
      await unlink(join(responses, `${id}.response.json`)).catch(() => undefined);
    }
  }

  async function checked<T>(method: JournalRpcMethod, args: unknown[], validate: (value: unknown) => T): Promise<T> {
    const value = await call(method, args);
    try { return validate(value); }
    catch { throw rpcError(method === "create" || method === "append" ? "journal_rpc_outcome_indeterminate" : "journal_rpc_protocol_error"); }
  }
  return {
    create: async event => checked("create", [event], value => loaded(value, event.operationId, event.requestDigest)),
    append: async (operationId, revision, event) => checked("append", [operationId, revision, event], value => loaded(value, operationId)),
    load: async (operationId, digest) => checked("load", [operationId, digest], value => loaded(value, operationId, digest)),
    submitRequestDigest: async (request, files) => checked("submitRequestDigest", [request, files], digest),
    controlRequestDigest: async request => checked("controlRequestDigest", [request], digest),
    evidenceDigest: async (domain, material) => checked("evidenceDigest", [domain, material], digest),
    handleFromState: async state => checked("handleFromState", [state], value => handle(value, state)),
    validateHandle: async (candidate, state) => checked("validateHandle", [candidate, state], result => {
      exactRecord(result, ["stale", "current"]);
      if (typeof result.stale !== "boolean" || result.stale !== (candidate.revision < state.revision)) throw rpcError("journal_rpc_protocol_error");
      return { stale: result.stale, current: handle(result.current, state) };
    })
  };
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !JOURNAL_RPC_DIGEST.test(value)) throw rpcError("journal_rpc_protocol_error");
  return value;
}
function handle(value: unknown, state: OperationStateV1): OperationHandleV1 {
  const required = ["schemaVersion", "operationId", "requestDigest", "surface", "revision", "phase", "mutationBoundary"];
  const hasTarget = typeof value === "object" && value !== null && Object.hasOwn(value, "targetBindingDigest");
  exactRecord(value, hasTarget ? [...required, "targetBindingDigest"] : required);
  if (value.schemaVersion !== OPERATION_HANDLE_SCHEMA_VERSION || value.operationId !== state.operationId
    || value.requestDigest !== state.requestDigest || value.surface !== state.surface || value.revision !== state.revision
    || value.phase !== state.phase || value.mutationBoundary !== state.mutationBoundary
    || (state.target !== undefined && !hasTarget)) throw rpcError("journal_rpc_protocol_error");
  digest(value.requestDigest);
  if (hasTarget) digest(value.targetBindingDigest);
  return value as unknown as OperationHandleV1;
}
function loaded(value: unknown, operationId: string, expectedDigest?: string): LoadedOperationJournalV1 {
  const keys = ["state", "envelopes", "committedBytes", "partialTailBytes"];
  const hasLast = typeof value === "object" && value !== null && Object.hasOwn(value, "lastEventDigest");
  exactRecord(value, hasLast ? [...keys, "lastEventDigest"] : keys);
  assertOperationStateShape(value.state);
  if (value.state.operationId !== operationId || (expectedDigest !== undefined && value.state.requestDigest !== expectedDigest)
    || !Array.isArray(value.envelopes) || value.envelopes.length > 32_768
    || !Number.isSafeInteger(value.committedBytes) || (value.committedBytes as number) < 0
    || !Number.isSafeInteger(value.partialTailBytes) || (value.partialTailBytes as number) < 0) throw rpcError("journal_rpc_protocol_error");
  for (const envelope of value.envelopes) {
    exactRecord(envelope, ["schemaVersion", "revision", "previousEventDigest", "eventDigest", "event"]);
    if (envelope.schemaVersion !== OPERATION_EVENT_SCHEMA_VERSION || !Number.isSafeInteger(envelope.revision)
      || (envelope.revision as number) < 1) throw rpcError("journal_rpc_protocol_error");
    digest(envelope.previousEventDigest); digest(envelope.eventDigest); assertOperationEventShape(envelope.event);
  }
  if (hasLast) digest(value.lastEventDigest);
  return value as unknown as LoadedOperationJournalV1;
}
