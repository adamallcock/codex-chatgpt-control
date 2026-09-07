import { resolve } from "node:path";
import {
  commitOperationOutput,
  deriveOperationOutputKey,
  type ArtifactOutputResult
} from "./artifact-output.js";
import { copyProviderChunk } from "./artifact-stream.js";

/**
 * The transfer coordinator is deliberately provider agnostic.  A provider
 * supplies one already-authorized, exact artifact stream; this module owns
 * the local effect, its durable intent, and its collision/recovery rules.
 *
 * The absolute destination is kept in the active call only.  It is included
 * in the keyed destination evidence supplied by the caller, but is never
 * copied into an intent, receipt, lookup, or error.
 */

export const ARTIFACT_TRANSFER_SCHEMA_VERSION = "chatgpt.browser_control.artifact_transfer.v1" as const;
export const ARTIFACT_TRANSFER_INTENT_SCHEMA_VERSION = "chatgpt.browser_control.artifact_transfer_intent.v1" as const;
export const ARTIFACT_TRANSFER_RECEIPT_SCHEMA_VERSION = "chatgpt.browser_control.artifact_transfer_receipt.v1" as const;
const SCHEMA_VERSION = ARTIFACT_TRANSFER_SCHEMA_VERSION;
const INTENT_SCHEMA_VERSION = ARTIFACT_TRANSFER_INTENT_SCHEMA_VERSION;
const RECEIPT_SCHEMA_VERSION = ARTIFACT_TRANSFER_RECEIPT_SCHEMA_VERSION;
const DIGEST_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OUTPUT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const MAX_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_STRING_BYTES = 4096;
const MAX_MAX_STRING_BYTES = 16 * 1024;
const DEFAULT_MAX_COUNT = 256;
const MAX_MAX_COUNT = 1024;
const DEFAULT_MAX_DEPTH = 8;
const MAX_MAX_DEPTH = 32;
const MAX_GRAPH_NODES = 1024;
const MAX_DEADLINE_AT = Date.UTC(2100, 0, 1);
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const PROVIDER_OPEN_TIMEOUT_MS = 30_000;
const PROVIDER_CLEANUP_TIMEOUT_MS = 30_000;

export type ArtifactTransferKind = "file" | "image" | "other";
export type ArtifactTransferOutcome = "satisfied" | "not_satisfied" | "uncertain";
export type ArtifactTransferStatus = "transferred" | "partial" | "blocked";
export type ArtifactTransferPersistence = "not_attempted" | "durable" | "indeterminate";

export type ArtifactTransferLimits = Readonly<{
  maxBytes?: number;
  maxStringBytes?: number;
  maxCount?: number;
  maxDepth?: number;
}>;

/**
 * No provider labels, filenames, bytes, URLs, or paths cross this callback.
 * The callback must return the one exact source selected by the operation's
 * assistant-turn/artifact identity.
 */
export type ArtifactTransferSourceRequest = Readonly<{
  operationId: string;
  requestDigest: string;
  targetBindingDigest: string;
  assistantTurnId: string;
  sourceIdentityDigest: string;
  kind: ArtifactTransferKind;
  ordinal: number;
  transferActionId: string;
  destinationIdentityDigest: string;
}>;

export type ArtifactTransferOpenSource = (
  request: ArtifactTransferSourceRequest
) => Promise<AsyncIterable<Uint8Array>>;

export type ArtifactTransferLookup = Readonly<{
  operationId: string;
  requestDigest: string;
  targetBindingDigest: string;
  assistantTurnId: string;
  sourceIdentityDigest: string;
  kind: ArtifactTransferKind;
  ordinal: number;
  transferActionId: string;
  destinationIdentityDigest: string;
}>;

export type ArtifactTransferIntentV1 = Readonly<{
  schemaVersion: typeof INTENT_SCHEMA_VERSION;
  operationId: string;
  requestDigest: string;
  targetBindingDigest: string;
  assistantTurnId: string;
  sourceIdentityDigest: string;
  kind: ArtifactTransferKind;
  ordinal: number;
  transferActionId: string;
  destinationIdentityDigest: string;
  actionKind: "local_output_commit";
  repeatPolicy: "reconcile_local_effect";
  intentAt: string;
}>;

export type ArtifactTransferReceiptV1 = Readonly<{
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  operationId: string;
  requestDigest: string;
  targetBindingDigest: string;
  assistantTurnId: string;
  sourceIdentityDigest: string;
  kind: ArtifactTransferKind;
  ordinal: number;
  transferActionId: string;
  destinationIdentityDigest: string;
  outputKey?: string;
  bytes?: number;
  sha256?: string;
  status: ArtifactTransferStatus;
  blockerCode?: string;
  observedAt: string;
}>;

export type ArtifactTransferDurableState = Readonly<{
  intent?: ArtifactTransferIntentV1;
  receipt?: ArtifactTransferReceiptV1;
}>;

/**
 * Journal-like ports are intentionally narrower than OperationJournal.  An
 * adapter can translate these records into action_intent/action_receipt
 * events while retaining the journal's expected-revision/CAS semantics.
 * Every port argument is path-free and already identity-bound.
 */
export type ArtifactTransferJournalPort = Readonly<{
  readActionState: (lookup: ArtifactTransferLookup) => Promise<unknown>;
  persistIntent: (intent: ArtifactTransferIntentV1) => Promise<void>;
  persistReceipt: (receipt: ArtifactTransferReceiptV1) => Promise<void>;
}>;

export type ArtifactTransferEvidenceDigest = (domain: string, material: unknown) => string | Promise<string>;

export type ArtifactTransferOptions = Readonly<{
  operationId: string;
  requestDigest: string;
  targetBindingDigest: string;
  assistantTurnId: string;
  sourceIdentityDigest: string;
  kind: ArtifactTransferKind;
  ordinal: number;
  transferActionId: string;
  /** Request-only absolute destination. Never retained by durable records. */
  outputDirectory: string;
  evidenceDigest: ArtifactTransferEvidenceDigest;
  openSource: ArtifactTransferOpenSource;
  journal: ArtifactTransferJournalPort;
  signal?: AbortSignal;
  deadlineAt?: number;
  /** Testable clock; its output is used only for deadline/timestamp checks. */
  now?: () => number;
  limits?: ArtifactTransferLimits;
  extensionHint?: string;
  mimeTypeHint?: string;
}>;

export type ArtifactTransferResult = Readonly<{
  schemaVersion: typeof SCHEMA_VERSION;
  outcome: ArtifactTransferOutcome;
  replayed: boolean;
  /** Whether the intent write is known to have reached durable journal state. */
  intentPersistence: ArtifactTransferPersistence;
  /** Whether the receipt write is known to have reached durable journal state. */
  receiptPersistence: ArtifactTransferPersistence;
  receipt?: ArtifactTransferReceiptV1;
  blockerCode?: string;
}>;

export class ArtifactTransferError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ArtifactTransferError";
  }
}

type PreparedTransfer = Readonly<{
  operationId: string;
  requestDigest: string;
  targetBindingDigest: string;
  assistantTurnId: string;
  sourceIdentityDigest: string;
  kind: ArtifactTransferKind;
  ordinal: number;
  transferActionId: string;
  outputDirectory: string;
  destinationIdentityDigest: string;
  outputKey: string;
  extensionHint?: string;
  mimeTypeHint?: string;
  maxBytes: number;
  maxCount: number;
  maxDepth: number;
  signal?: AbortSignal;
  deadlineAt?: number;
  now: () => number;
  clockFaulted: () => boolean;
  openSource: ArtifactTransferOpenSource;
  readActionState: ArtifactTransferJournalPort["readActionState"];
  persistIntent: ArtifactTransferJournalPort["persistIntent"];
  persistReceipt: ArtifactTransferJournalPort["persistReceipt"];
  lookup: ArtifactTransferLookup;
}>;

type InFlight = Readonly<{
  identity: string;
  promise: Promise<ArtifactTransferResult>;
}>;

const inFlight = new Map<string, InFlight>();

type ProviderBoundary = "timeout" | "aborted";

class ProviderBoundaryError extends Error {
  constructor(readonly boundary: ProviderBoundary) {
    super(boundary === "timeout" ? "The artifact provider exceeded its operation deadline." : "The artifact provider was aborted.");
    this.name = "ProviderBoundaryError";
  }
}

type ProviderBoundaryWait = Readonly<{
  promise: Promise<ProviderBoundary>;
  cancel: () => void;
}>;

type ProviderSettlement<T> =
  | Readonly<{ kind: "value"; value: T }>
  | Readonly<{ kind: "error"; error: unknown }>;

function armProviderBoundary(prepared: PreparedTransfer, fallbackTimeoutMs?: number): ProviderBoundaryWait | undefined {
  const signal = prepared.signal;
  let remaining: number | undefined;
  if (prepared.deadlineAt !== undefined) {
    const baseline = prepared.now();
    if (prepared.clockFaulted()) {
      throw new ArtifactTransferError("operation_clock_invalid", "Operation clock became invalid.");
    }
    remaining = prepared.deadlineAt - baseline;
  } else if (fallbackTimeoutMs !== undefined) {
    remaining = fallbackTimeoutMs;
  }
  if (signal === undefined && remaining === undefined) return undefined;

  let resolveBoundary!: (boundary: ProviderBoundary) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const promise = new Promise<ProviderBoundary>(resolve => {
    resolveBoundary = resolve;
  });
  const listener = () => trigger("aborted");
  const removeListener = () => {
    if (signal === undefined) return;
    try { signal.removeEventListener("abort", listener); } catch { /* fail closed through the boundary */ }
  };
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  function trigger(boundary: ProviderBoundary): void {
    if (cancelled) return;
    cancelled = true;
    clearTimer();
    removeListener();
    resolveBoundary(boundary);
  }
  const schedule = (delay: number): void => {
    if (cancelled) return;
    timer = setTimeout(() => {
      if (delay > MAX_TIMER_DELAY_MS) schedule(delay - MAX_TIMER_DELAY_MS);
      else trigger("timeout");
    }, Math.min(delay, MAX_TIMER_DELAY_MS));
  };

  if (signal !== undefined) {
    if (isSignalAborted(signal)) {
      trigger("aborted");
      return { promise, cancel: () => undefined };
    }
    try {
      signal.addEventListener("abort", listener, { once: true });
    } catch {
      trigger("aborted");
      return { promise, cancel: () => undefined };
    }
    if (isSignalAborted(signal)) trigger("aborted");
  }
  if (!cancelled && remaining !== undefined) {
    if (!Number.isFinite(remaining) || remaining <= 0) trigger("timeout");
    else schedule(remaining);
  }
  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      clearTimer();
      removeListener();
    }
  };
}

function observeLateProviderValue<T>(value: T, onLateValue: ((value: T) => void | Promise<void>) | undefined): void {
  if (onLateValue === undefined) return;
  try {
    void Promise.resolve().then(() => onLateValue(value)).catch(() => undefined);
  } catch {
    // A late provider capability is already outside the operation authority;
    // cleanup failures remain redacted and cannot alter the durable outcome.
  }
}

async function awaitProviderOperation<T>(
  prepared: PreparedTransfer,
  operation: () => T | PromiseLike<T>,
  fallbackTimeoutMs: number | undefined,
  onLateValue?: (value: T) => void | Promise<void>
): Promise<T> {
  const providerPromise = Promise.resolve().then(operation);
  let valueSettled = false;
  let valueForLate!: T;
  let boundaryTriggered = false;
  let lateObserved = false;
  const settled: Promise<ProviderSettlement<T>> = providerPromise.then(
    value => {
      valueSettled = true;
      valueForLate = value;
      if (boundaryTriggered && !lateObserved) {
        lateObserved = true;
        observeLateProviderValue(value, onLateValue);
      }
      return { kind: "value" as const, value };
    },
    error => ({ kind: "error" as const, error })
  );
  let boundary: ProviderBoundaryWait | undefined;
  try {
    boundary = armProviderBoundary(prepared, fallbackTimeoutMs);
  } catch (error) {
    if (onLateValue !== undefined) {
      void providerPromise.then(
        value => observeLateProviderValue(value, onLateValue),
        () => undefined
      );
    }
    throw error;
  }
  let outcome: ProviderSettlement<T> | ProviderBoundary;
  try {
    outcome = boundary === undefined
      ? await settled
      : await Promise.race([settled, boundary.promise]);
  } finally {
    boundary?.cancel();
  }
  if (outcome === "timeout" || outcome === "aborted") {
    boundaryTriggered = true;
    if (valueSettled && !lateObserved) {
      lateObserved = true;
      observeLateProviderValue(valueForLate, onLateValue);
    } else if (!valueSettled && onLateValue !== undefined) {
      void providerPromise.then(
        value => {
          if (lateObserved) return;
          lateObserved = true;
          observeLateProviderValue(value, onLateValue);
        },
        () => undefined
      );
    }
    throw new ProviderBoundaryError(outcome);
  }
  if (outcome.kind === "error") throw outcome.error;
  if (prepared.clockFaulted()) throw new ArtifactTransferError("operation_clock_invalid", "Operation clock became invalid.");
  return outcome.value;
}

/**
 * Transfer one exact operation-owned artifact.  This function is safe to
 * invoke repeatedly with the same action identity: completed receipts are
 * replayed without provider access, and concurrent identical calls share one
 * source/commit attempt.
 */
export async function transferOperationArtifact(options: ArtifactTransferOptions): Promise<ArtifactTransferResult> {
  const prepared = await prepare(options);
  const initialProgress = freshProgress();
  if (isCancelledOrExpired(prepared)) {
    if (prepared.clockFaulted()) return uncertainResult(initialProgress, "operation_state_corrupt");
    return preIntentAbortResult(prepared, initialProgress);
  }

  const flightKey = `${prepared.operationId}\0${prepared.transferActionId}`;
  const identity = transferIdentity(prepared);
  const existing = inFlight.get(flightKey);
  if (existing !== undefined) {
    if (existing.identity !== identity) return conflictResult(initialProgress);
    return existing.promise;
  }

  const promise = runTransfer(prepared);
  inFlight.set(flightKey, { identity, promise });
  try {
    return await promise;
  } finally {
    const current = inFlight.get(flightKey);
    if (current?.promise === promise) inFlight.delete(flightKey);
  }
}

/** Short additive alias for callers that prefer the noun-first operation name. */
export const transferArtifact = transferOperationArtifact;

async function runTransfer(prepared: PreparedTransfer): Promise<ArtifactTransferResult> {
  const progress: TransferProgress = {
    intentPersistence: "not_attempted",
    receiptPersistence: "not_attempted"
  };

  try {
    let durable: ArtifactTransferDurableState | undefined;
    try {
      durable = validateDurableState(await prepared.readActionState(prepared.lookup), prepared);
    } catch (error) {
      if (error instanceof ArtifactTransferError && error.code === "operation_request_mismatch") {
        return failureResult(error.code, progress);
      }
      // A receipt without its causal intent, malformed records, and unknown
      // journal fields are corruption, not an invitation to retry the source.
      return failureResult("operation_state_corrupt", progress);
    }

    if (durable !== undefined) {
      progress.intentPersistence = "durable";
      if (durable.receipt !== undefined) {
        progress.receiptPersistence = "durable";
        return await reconcileDurableReceipt(prepared, durable.receipt, progress);
      }
      // An intent without an exact receipt is evidence that the source handoff
      // may already have occurred.  There is no safe source retry.  The local
      // output primitive can only prove a leftover when an exact receipt gives
      // it bytes+hash. Close the durable action with an explicit partial
      // receipt so the parent operation can complete truthfully without ever
      // reopening the provider source.
      if (durable.intent !== undefined) {
        progress.intentAt = durable.intent.intentAt;
        return await persistUncertainReceipt(prepared, "artifact_transfer_partial", progress);
      }
      return failureResult("operation_state_corrupt", progress);
    }

    const expiredBeforeIntent = isCancelledOrExpired(prepared);
    if (prepared.clockFaulted()) return uncertainResult(progress, "operation_state_corrupt");
    if (expiredBeforeIntent) {
      return preIntentAbortResult(prepared, progress);
    }

    const intent = makeIntent(prepared);
    progress.intentAt = intent.intentAt;
    const intentResolution = await persistIntentAndConverge(prepared, intent);
    progress.intentPersistence = intentResolution.persistence;
    if (intentResolution.blockerCode === "operation_request_mismatch") {
      return failureResult(intentResolution.blockerCode, progress);
    }
    if (intentResolution.persistence === "indeterminate") {
      return uncertainResult(progress, intentResolution.blockerCode ?? "operation_state_corrupt");
    }
    if (intentResolution.durableState?.receipt !== undefined) {
      progress.receiptPersistence = "durable";
      return await reconcileDurableReceipt(prepared, intentResolution.durableState.receipt, progress);
    }
    if (intentResolution.durableState?.intent !== undefined) {
      progress.intentAt = intentResolution.durableState.intent.intentAt;
    }
    if (prepared.clockFaulted()) return uncertainResult(progress, "operation_state_corrupt");

    const expiredAfterIntent = isCancelledOrExpired(prepared);
    if (prepared.clockFaulted()) return uncertainResult(progress, "operation_state_corrupt");
    if (expiredAfterIntent) {
      return await persistUncertainReceipt(prepared, cancellationCode(prepared), progress);
    }

    let source: AsyncIterable<Uint8Array>;
    try {
      const raw = await awaitProviderOperation(
        prepared,
        () => prepared.openSource(sourceRequest(prepared)),
        PROVIDER_OPEN_TIMEOUT_MS,
        value => closeArtifactSourceBestEffort(value)
      );
      source = safeSource(raw, prepared.maxBytes);
    } catch {
      return await persistUncertainReceipt(prepared, "artifact_transfer_partial", progress);
    }

    let output: ArtifactOutputResult | undefined;
    let outputFailed = false;
    try {
      output = await commitOperationOutput(commitOptions(prepared, source));
    } catch {
      outputFailed = true;
    }
    // `artifact-output` may reject the destination during preflight without
    // ever requesting a source chunk. Explicitly close the one-shot provider
    // capability so its file handle and request temp are released on every
    // branch, including that zero-read path.
    const sourceClosed = await closeArtifactSource(source, prepared);
    if (outputFailed || output === undefined) {
      return await persistUncertainReceipt(prepared, "output_commit_indeterminate", progress);
    }
    if (!sourceClosed) {
      return await persistUncertainReceipt(prepared, "artifact_transfer_partial", progress);
    }

    const mapped = mapOutput(prepared, output, progress);
    return await persistResultReceipt(prepared, mapped.receipt, mapped.outcome, progress);
  } catch (error) {
    // In particular, a testable/provider clock can fail after intent or after
    // a local output commit.  Do not throw, retry, or claim a write was lost;
    // the only truthful result at this boundary is uncertain.
    if (error instanceof ArtifactTransferError && error.code === "operation_request_mismatch") {
      return failureResult(error.code, progress);
    }
    return uncertainResult(progress, "operation_state_corrupt");
  }
}

type TransferProgress = {
  intentPersistence: ArtifactTransferPersistence;
  receiptPersistence: ArtifactTransferPersistence;
  intentAt?: string;
};

function freshProgress(): TransferProgress {
  return {
    intentPersistence: "not_attempted",
    receiptPersistence: "not_attempted"
  };
}

type IntentPersistenceResolution = Readonly<{
  persistence: ArtifactTransferPersistence;
  durableState?: ArtifactTransferDurableState;
  blockerCode?: string;
}>;

async function persistIntentAndConverge(
  prepared: PreparedTransfer,
  intent: ArtifactTransferIntentV1
): Promise<IntentPersistenceResolution> {
  try {
    await prepared.persistIntent(intent);
    return { persistence: "durable" };
  } catch {
    // A journal adapter may have committed the record before reporting an
    // error.  Re-read and require the exact intent before calling it durable.
    let afterFailure: ArtifactTransferDurableState | undefined;
    try {
      afterFailure = validateDurableState(await prepared.readActionState(prepared.lookup), prepared);
    } catch (error) {
      return {
        persistence: "indeterminate",
        blockerCode: error instanceof ArtifactTransferError && error.code === "operation_request_mismatch"
          ? "operation_request_mismatch"
          : "operation_state_corrupt"
      };
    }
    if (afterFailure?.intent !== undefined && sameIntent(afterFailure.intent, intent)) {
      return { persistence: "durable", durableState: afterFailure };
    }
    // Undefined state is not proof that the failed write did not commit.
    // Treat every non-converged write as an uncertain boundary.
    return { persistence: "indeterminate", blockerCode: "operation_state_corrupt" };
  }
}

async function reconcileDurableReceipt(
  prepared: PreparedTransfer,
  receipt: ArtifactTransferReceiptV1,
  progress: TransferProgress
): Promise<ArtifactTransferResult> {
  if (receipt.status !== "transferred" || receipt.bytes === undefined || receipt.sha256 === undefined || receipt.outputKey === undefined) {
    return resultFromReceipt(receipt, "uncertain", true, progress);
  }

  // The source callback is intentionally not called.  Passing a guard stream
  // lets artifact-output inspect/reconcile an exact final or verified temp;
  // if neither exists, the guard prevents a blind source retry.
  let output: ArtifactOutputResult;
  try {
    output = await commitOperationOutput(commitOptions(prepared, noSourceRetry(), {
      bytes: receipt.bytes,
      sha256: receipt.sha256
    }));
  } catch {
    return resultFromReceipt(receipt, "uncertain", true, progress);
  }

  if (output.status === "reconciled" || output.status === "committed") {
    // Replay must be byte-for-byte receipt stable.  The local primitive only
    // proves the persisted receipt's expected output; it must not rewrite its
    // observedAt or any other durable field while replaying.
    return resultFromReceipt(receipt, "satisfied", true, progress);
  }
  if (output.status === "collision") return resultFromReceipt(receipt, "not_satisfied", true, progress, "output_collision");
  return resultFromReceipt(receipt, "uncertain", true, progress, "output_commit_indeterminate");
}

async function persistUncertainReceipt(
  prepared: PreparedTransfer,
  blockerCode: string,
  progress: TransferProgress
): Promise<ArtifactTransferResult> {
  let observedAt: string;
  try {
    observedAt = preparedTimestamp(prepared, progress.intentAt);
  } catch {
    return uncertainResult(progress, "operation_state_corrupt");
  }
  const receipt: ArtifactTransferReceiptV1 = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    operationId: prepared.operationId,
    requestDigest: prepared.requestDigest,
    targetBindingDigest: prepared.targetBindingDigest,
    assistantTurnId: prepared.assistantTurnId,
    sourceIdentityDigest: prepared.sourceIdentityDigest,
    kind: prepared.kind,
    ordinal: prepared.ordinal,
    transferActionId: prepared.transferActionId,
    destinationIdentityDigest: prepared.destinationIdentityDigest,
    outputKey: prepared.outputKey,
    status: "partial",
    blockerCode,
    observedAt
  };
  return await persistResultReceipt(prepared, receipt, "uncertain", progress);
}

function uncertainResult(
  progress: TransferProgress,
  blockerCode: string,
  receipt?: ArtifactTransferReceiptV1
): ArtifactTransferResult {
  return freezeRecord({
    schemaVersion: SCHEMA_VERSION,
    outcome: "uncertain",
    replayed: false,
    intentPersistence: progress.intentPersistence,
    receiptPersistence: progress.receiptPersistence,
    ...(receipt === undefined ? {} : { receipt: freezeRecord({ ...receipt }) }),
    blockerCode
  });
}

async function persistResultReceipt(
  prepared: PreparedTransfer,
  receipt: ArtifactTransferReceiptV1,
  outcome: ArtifactTransferOutcome,
  progress: TransferProgress
): Promise<ArtifactTransferResult> {
  // Durable records are scalar, path-free snapshots.  Freeze the exact
  // record before handing it to an adapter or returning it so neither side
  // can mutate the authority after validation.
  receipt = freezeRecord({ ...receipt });
  try {
    await prepared.persistReceipt(receipt);
    progress.receiptPersistence = "durable";
    return resultFromReceipt(receipt, outcome, false, progress);
  } catch {
    // As with intent, a receipt adapter can commit and then throw.  Only an
    // exact read-back makes the persistence durable; otherwise expose the
    // receipt candidate but keep the write indeterminate and never retry the
    // provider/source.
    let afterFailure: ArtifactTransferDurableState | undefined;
    try {
      afterFailure = validateDurableState(await prepared.readActionState(prepared.lookup), prepared);
    } catch {
      progress.receiptPersistence = "indeterminate";
      return uncertainResult(progress, "operation_state_corrupt", receipt);
    }
    if (afterFailure?.receipt !== undefined && sameReceipt(afterFailure.receipt, receipt)) {
      progress.receiptPersistence = "durable";
      return resultFromReceipt(afterFailure.receipt, outcome, false, progress);
    }
    progress.receiptPersistence = "indeterminate";
    return uncertainResult(progress, "operation_state_corrupt", receipt);
  }
}

function mapOutput(
  prepared: PreparedTransfer,
  output: ArtifactOutputResult,
  progress: TransferProgress
): Readonly<{ receipt: ArtifactTransferReceiptV1; outcome: ArtifactTransferOutcome }> {
  const observedAt = preparedTimestamp(prepared, progress.intentAt);
  if (output.status === "committed" || output.status === "reconciled") {
    return {
      outcome: "satisfied",
      receipt: freezeRecord({
        schemaVersion: RECEIPT_SCHEMA_VERSION,
        operationId: prepared.operationId,
        requestDigest: prepared.requestDigest,
        targetBindingDigest: prepared.targetBindingDigest,
        assistantTurnId: prepared.assistantTurnId,
        sourceIdentityDigest: prepared.sourceIdentityDigest,
        kind: prepared.kind,
        ordinal: prepared.ordinal,
        transferActionId: prepared.transferActionId,
        destinationIdentityDigest: prepared.destinationIdentityDigest,
        outputKey: output.outputKey,
        bytes: output.bytes,
        sha256: output.sha256,
        status: "transferred",
        observedAt
      })
    };
  }
  const blockerCode = output.status === "collision"
    ? "output_collision"
    : output.reason === "commit_indeterminate" || output.reason.startsWith("temp_")
      ? "output_commit_indeterminate"
      : output.reason === "destination_invalid"
        ? "output_commit_indeterminate"
        : "artifact_transfer_partial";
  // The output primitive reports a zero/empty digest for preflight and other
  // boundaries where no stream prefix was observed.  Do not turn those
  // placeholders into durable transfer facts.  Stream-side failures retain
  // only the prefix that the primitive actually hashed.
  const observedPrefix = new Set<ArtifactOutputResult["reason"]>([
    "source_aborted", "source_invalid", "source_mismatch", "source_read_failed",
    "byte_limit_exceeded", "write_failed", "file_sync_failed"
  ]).has(output.reason)
    ? { bytes: output.bytes, sha256: output.sha256 }
    : {};
  return {
    outcome: output.status === "collision" ? "not_satisfied" : "uncertain",
    receipt: freezeRecord({
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      operationId: prepared.operationId,
      requestDigest: prepared.requestDigest,
      targetBindingDigest: prepared.targetBindingDigest,
      assistantTurnId: prepared.assistantTurnId,
      sourceIdentityDigest: prepared.sourceIdentityDigest,
      kind: prepared.kind,
      ordinal: prepared.ordinal,
      transferActionId: prepared.transferActionId,
      destinationIdentityDigest: prepared.destinationIdentityDigest,
      outputKey: output.outputKey,
      ...observedPrefix,
      status: output.status === "collision" ? "blocked" : "partial",
      blockerCode,
      observedAt
    })
  };
}

function resultFromReceipt(
  receipt: ArtifactTransferReceiptV1,
  outcome: ArtifactTransferOutcome,
  replayed: boolean,
  progress: TransferProgress,
  overrideBlocker?: string
): ArtifactTransferResult {
  return freezeRecord({
    schemaVersion: SCHEMA_VERSION,
    outcome,
    replayed,
    intentPersistence: progress.intentPersistence,
    receiptPersistence: progress.receiptPersistence,
    receipt,
    ...(overrideBlocker === undefined && receipt.blockerCode === undefined ? {} : {
      blockerCode: overrideBlocker ?? receipt.blockerCode
    })
  });
}

function failureResult(blockerCode: string, progress: TransferProgress): ArtifactTransferResult {
  return freezeRecord({
    schemaVersion: SCHEMA_VERSION,
    outcome: "not_satisfied",
    replayed: false,
    intentPersistence: progress.intentPersistence,
    receiptPersistence: progress.receiptPersistence,
    blockerCode
  });
}

function conflictResult(progress: TransferProgress): ArtifactTransferResult {
  return failureResult("operation_request_mismatch", progress);
}

function preIntentAbortResult(prepared: PreparedTransfer, progress: TransferProgress): ArtifactTransferResult {
  return failureResult(cancellationCode(prepared), progress);
}

function cancellationCode(prepared: PreparedTransfer): "operation_cancelled" | "operation_timeout" {
  return isSignalAborted(prepared.signal) ? "operation_cancelled" : "operation_timeout";
}

function makeIntent(prepared: PreparedTransfer): ArtifactTransferIntentV1 {
  return freezeRecord({
    schemaVersion: INTENT_SCHEMA_VERSION,
    operationId: prepared.operationId,
    requestDigest: prepared.requestDigest,
    targetBindingDigest: prepared.targetBindingDigest,
    assistantTurnId: prepared.assistantTurnId,
    sourceIdentityDigest: prepared.sourceIdentityDigest,
    kind: prepared.kind,
    ordinal: prepared.ordinal,
    transferActionId: prepared.transferActionId,
    destinationIdentityDigest: prepared.destinationIdentityDigest,
    actionKind: "local_output_commit",
    repeatPolicy: "reconcile_local_effect",
    intentAt: preparedTimestamp(prepared)
  });
}

function sourceRequest(prepared: PreparedTransfer): ArtifactTransferSourceRequest {
  return freezeRecord({
    operationId: prepared.operationId,
    requestDigest: prepared.requestDigest,
    targetBindingDigest: prepared.targetBindingDigest,
    assistantTurnId: prepared.assistantTurnId,
    sourceIdentityDigest: prepared.sourceIdentityDigest,
    kind: prepared.kind,
    ordinal: prepared.ordinal,
    transferActionId: prepared.transferActionId,
    destinationIdentityDigest: prepared.destinationIdentityDigest
  });
}

function commitOptions(
  prepared: PreparedTransfer,
  source: AsyncIterable<Uint8Array>,
  expected?: Readonly<{ bytes: number; sha256: string }>
): Parameters<typeof commitOperationOutput>[0] {
  return {
    operationId: prepared.operationId,
    artifactIdentity: artifactIdentity(prepared),
    outputDirectory: prepared.outputDirectory,
    source,
    maxBytes: prepared.maxBytes,
    ...(expected === undefined ? {} : { expected }),
    ...(prepared.signal === undefined ? {} : { signal: prepared.signal }),
    ...(prepared.deadlineAt === undefined ? {} : { deadlineAt: prepared.deadlineAt }),
    // Artifact-output owns the local effect deadline, but it must use this
    // operation's guarded clock.  A backwards/invalid sample is not allowed
    // to become a fresh filesystem timestamp or deadline decision.
    now: () => {
      const value = prepared.now();
      if (prepared.clockFaulted()) throw new ArtifactTransferError("operation_clock_invalid", "Operation clock became invalid.");
      return value;
    },
    ...(prepared.extensionHint === undefined ? {} : { extensionHint: prepared.extensionHint }),
    ...(prepared.mimeTypeHint === undefined ? {} : { mimeTypeHint: prepared.mimeTypeHint })
  };
}

function artifactIdentity(prepared: PreparedTransfer): string {
  // Fixed property order is intentional: this is an opaque local key input,
  // not a durable/public authority. It contains no destination path.
  return JSON.stringify({
    assistantTurnId: prepared.assistantTurnId,
    sourceIdentityDigest: prepared.sourceIdentityDigest,
    kind: prepared.kind,
    ordinal: prepared.ordinal,
    transferActionId: prepared.transferActionId,
    destinationIdentityDigest: prepared.destinationIdentityDigest,
    maxBytes: prepared.maxBytes
  });
}

function transferIdentity(prepared: PreparedTransfer): string {
  return [
    prepared.operationId,
    prepared.requestDigest,
    prepared.targetBindingDigest,
    prepared.assistantTurnId,
    prepared.sourceIdentityDigest,
    prepared.kind,
    String(prepared.ordinal),
    prepared.transferActionId,
    prepared.destinationIdentityDigest,
    String(prepared.maxBytes),
    prepared.outputKey
  ].join("\0");
}

async function prepare(options: ArtifactTransferOptions): Promise<PreparedTransfer> {
  const record = snapshotRecord(options, "options");
  assertAllowedKeys(record, [
    "operationId", "requestDigest", "targetBindingDigest", "assistantTurnId", "sourceIdentityDigest",
    "kind", "ordinal", "transferActionId", "outputDirectory", "evidenceDigest", "openSource", "journal",
    "signal", "deadlineAt", "now", "limits", "extensionHint", "mimeTypeHint"
  ]);
  const operationId = requiredString(record, "operationId", UUID_PATTERN, 128);
  const requestDigest = requiredString(record, "requestDigest", DIGEST_PATTERN, 128);
  const targetBindingDigest = requiredString(record, "targetBindingDigest", DIGEST_PATTERN, 128);
  const assistantTurnId = requiredOpaqueId(record, "assistantTurnId");
  const sourceIdentityDigest = requiredString(record, "sourceIdentityDigest", DIGEST_PATTERN, 128);
  const kind = requiredKind(record.kind);
  const limits = readLimits(record.limits);
  // The caller-provided depth bound is meaningful only if applied to the
  // complete option graph.  Validate it after reading the scalar limits so a
  // deeply nested/proxy-backed callback record cannot bypass the advertised
  // bound.
  assertGraphBounds(record, new Set<object>(), 0, limits.maxDepth);
  const ordinal = requiredOrdinal(record.ordinal, limits.maxCount);
  const transferActionId = requiredString(record, "transferActionId", UUID_PATTERN, 128);
  const outputDirectory = requiredString(record, "outputDirectory", undefined, limits.maxStringBytes);
  if (!isAbsolutePath(outputDirectory)) throw invalidOptions();
  const canonicalDestination = resolve(outputDirectory);
  if (byteLength(canonicalDestination) > limits.maxStringBytes) throw invalidOptions();
  const evidenceDigest = requiredFunction<ArtifactTransferEvidenceDigest>(record, "evidenceDigest");
  const openSource = requiredFunction<ArtifactTransferOpenSource>(record, "openSource");
  const journal = readJournal(record.journal);
  const signal = readOptionalSignal(record.signal);
  const deadlineAt = readOptionalDeadline(record.deadlineAt);
  const clock = readNow(record.now);
  if (deadlineAt !== undefined && deadlineAt > MAX_DEADLINE_AT) throw invalidOptions();
  if (limits.maxDepth < 2) throw invalidOptions();

  const extensionHint = readOptionalString(record, "extensionHint", limits.maxStringBytes);
  const mimeTypeHint = readOptionalString(record, "mimeTypeHint", limits.maxStringBytes);
  let destinationIdentityDigest: string;
  try {
    destinationIdentityDigest = await evidenceDigest("artifact-destination", freezeRecord({
      schemaVersion: SCHEMA_VERSION,
      operationId,
      requestDigest,
      targetBindingDigest,
      assistantTurnId,
      sourceIdentityDigest,
      kind,
      ordinal,
      transferActionId,
      canonicalDestination
    }));
  } catch {
    throw new ArtifactTransferError("invalid_evidence_digest", "Destination evidence could not be derived.");
  }
  if (!DIGEST_PATTERN.test(destinationIdentityDigest)) throw invalidOptions();

  let outputKey: string;
  try {
    outputKey = deriveOperationOutputKey({
      operationId,
      artifactIdentity: JSON.stringify({ assistantTurnId, sourceIdentityDigest, kind, ordinal, transferActionId, destinationIdentityDigest, maxBytes: limits.maxBytes }),
      ...(extensionHint === undefined ? {} : { extensionHint }),
      ...(mimeTypeHint === undefined ? {} : { mimeTypeHint })
    });
  } catch {
    throw invalidOptions();
  }

  return {
    operationId,
    requestDigest,
    targetBindingDigest,
    assistantTurnId,
    sourceIdentityDigest,
    kind,
    ordinal,
    transferActionId,
    outputDirectory: canonicalDestination,
    destinationIdentityDigest,
    outputKey,
    ...(extensionHint === undefined ? {} : { extensionHint }),
    ...(mimeTypeHint === undefined ? {} : { mimeTypeHint }),
    maxBytes: limits.maxBytes,
    maxCount: limits.maxCount,
    maxDepth: limits.maxDepth,
    ...(signal === undefined ? {} : { signal }),
    ...(deadlineAt === undefined ? {} : { deadlineAt }),
    now: clock.now,
    clockFaulted: clock.faulted,
    openSource,
    readActionState: journal.readActionState,
    persistIntent: journal.persistIntent,
    persistReceipt: journal.persistReceipt,
    lookup: freezeRecord({
      operationId,
      requestDigest,
      targetBindingDigest,
      assistantTurnId,
      sourceIdentityDigest,
      kind,
      ordinal,
      transferActionId,
      destinationIdentityDigest
    })
  };
}

function readLimits(value: unknown): Required<ArtifactTransferLimits> {
  if (value === undefined) return { maxBytes: DEFAULT_MAX_BYTES, maxStringBytes: DEFAULT_MAX_STRING_BYTES, maxCount: DEFAULT_MAX_COUNT, maxDepth: DEFAULT_MAX_DEPTH };
  const record = snapshotRecord(value, "limits");
  assertAllowedKeys(record, ["maxBytes", "maxStringBytes", "maxCount", "maxDepth"]);
  const maxBytes = optionalBoundedNumber(record, "maxBytes", DEFAULT_MAX_BYTES, 0, MAX_MAX_BYTES);
  const maxStringBytes = optionalBoundedNumber(record, "maxStringBytes", DEFAULT_MAX_STRING_BYTES, 32, MAX_MAX_STRING_BYTES);
  const maxCount = optionalBoundedNumber(record, "maxCount", DEFAULT_MAX_COUNT, 1, MAX_MAX_COUNT);
  const maxDepth = optionalBoundedNumber(record, "maxDepth", DEFAULT_MAX_DEPTH, 2, MAX_MAX_DEPTH);
  return { maxBytes, maxStringBytes, maxCount, maxDepth };
}

function readJournal(value: unknown): {
  readActionState: ArtifactTransferJournalPort["readActionState"];
  persistIntent: ArtifactTransferJournalPort["persistIntent"];
  persistReceipt: ArtifactTransferJournalPort["persistReceipt"];
} {
  const record = snapshotRecord(value, "journal");
  assertAllowedKeys(record, ["readActionState", "persistIntent", "persistReceipt"]);
  const readActionState = requiredFunction<ArtifactTransferJournalPort["readActionState"]>(record, "readActionState");
  const persistIntent = requiredFunction<ArtifactTransferJournalPort["persistIntent"]>(record, "persistIntent");
  const persistReceipt = requiredFunction<ArtifactTransferJournalPort["persistReceipt"]>(record, "persistReceipt");
  return {
    readActionState: (lookup: ArtifactTransferLookup) => Reflect.apply(readActionState, value, [freezeRecord({ ...lookup })]),
    persistIntent: (intent: ArtifactTransferIntentV1) => Reflect.apply(persistIntent, value, [freezeRecord({ ...intent })]),
    persistReceipt: (receipt: ArtifactTransferReceiptV1) => Reflect.apply(persistReceipt, value, [freezeRecord({ ...receipt })])
  };
}

function validateDurableState(value: unknown, prepared: PreparedTransfer): ArtifactTransferDurableState | undefined {
  if (value === undefined) return undefined;
  const record = snapshotRecord(value, "durable state", prepared.maxDepth);
  const allowed = new Set(["intent", "receipt"]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw invalidOptions();
  const intentValue = record.intent;
  const receiptValue = record.receipt;
  if (intentValue === undefined && receiptValue === undefined) throw invalidOptions();
  const intent = intentValue === undefined ? undefined : validateIntent(intentValue, prepared);
  const receipt = receiptValue === undefined ? undefined : validateReceipt(receiptValue, prepared);
  // A receipt records completion of an intent-bound transfer.  Accepting a
  // receipt without its causal intent would make an untrusted/partial journal
  // record look replayable and would erase the source handoff boundary.
  if (receipt !== undefined && intent === undefined) throw invalidOptions();
  if (intent !== undefined && receipt !== undefined && !sameIdentity(intent, receipt)) throw invalidOptions();
  if (intent !== undefined && receipt !== undefined && Date.parse(receipt.observedAt) < Date.parse(intent.intentAt)) {
    // A durable observation predating its causal intent is evidence of a
    // backwards/untrusted clock (or journal corruption), never a replayable
    // completion.
    throw invalidOptions();
  }
  return freezeRecord({
    ...(intent === undefined ? {} : { intent }),
    ...(receipt === undefined ? {} : { receipt })
  });
}

function validateIntent(value: unknown, prepared: PreparedTransfer): ArtifactTransferIntentV1 {
  const record = snapshotExactRecord(value, [
    "schemaVersion", "operationId", "requestDigest", "targetBindingDigest", "assistantTurnId",
    "sourceIdentityDigest", "kind", "ordinal", "transferActionId", "destinationIdentityDigest",
    "actionKind", "repeatPolicy", "intentAt"
  ], prepared.maxDepth);
  const intent = record as unknown as ArtifactTransferIntentV1;
  if (intent.schemaVersion !== INTENT_SCHEMA_VERSION || intent.actionKind !== "local_output_commit" || intent.repeatPolicy !== "reconcile_local_effect") throw invalidOptions();
  validateIdentityFields(intent, prepared);
  if (!isTimestamp(intent.intentAt)) throw invalidOptions();
  return freezeRecord({ ...intent });
}

function validateReceipt(value: unknown, prepared: PreparedTransfer): ArtifactTransferReceiptV1 {
  const record = snapshotRecord(value, "receipt", prepared.maxDepth);
  const allowed = new Set([
    "schemaVersion", "operationId", "requestDigest", "targetBindingDigest", "assistantTurnId",
    "sourceIdentityDigest", "kind", "ordinal", "transferActionId", "destinationIdentityDigest",
    "outputKey", "bytes", "sha256", "status", "blockerCode", "observedAt"
  ]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw invalidOptions();
  const receipt = record as unknown as ArtifactTransferReceiptV1;
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION || !isArtifactStatus(receipt.status) || !isTimestamp(receipt.observedAt)) throw invalidOptions();
  validateIdentityFields(receipt, prepared);
  if (receipt.outputKey !== undefined && !OUTPUT_KEY_PATTERN.test(receipt.outputKey)) throw invalidOptions();
  if (receipt.outputKey !== undefined && receipt.outputKey !== prepared.outputKey) throw new ArtifactTransferError("operation_request_mismatch", "Durable artifact output identity does not match the request.");
  if (receipt.bytes !== undefined && (!Number.isSafeInteger(receipt.bytes) || receipt.bytes < 0 || receipt.bytes > prepared.maxBytes)) throw invalidOptions();
  if (receipt.sha256 !== undefined && !SHA256_PATTERN.test(receipt.sha256)) throw invalidOptions();
  if (receipt.blockerCode !== undefined && !CODE_PATTERN.test(receipt.blockerCode)) throw invalidOptions();
  if (receipt.status === "transferred" && (receipt.outputKey === undefined || receipt.bytes === undefined || receipt.sha256 === undefined || receipt.blockerCode !== undefined)) throw invalidOptions();
  if (receipt.status !== "transferred" && receipt.blockerCode === undefined) throw invalidOptions();
  return freezeRecord({ ...receipt });
}

function validateIdentityFields(value: {
  operationId: string;
  requestDigest: string;
  targetBindingDigest: string;
  assistantTurnId: string;
  sourceIdentityDigest: string;
  kind: ArtifactTransferKind;
  ordinal: number;
  transferActionId: string;
  destinationIdentityDigest: string;
}, prepared: PreparedTransfer): void {
  if (
    value.operationId !== prepared.operationId
    || value.requestDigest !== prepared.requestDigest
    || value.targetBindingDigest !== prepared.targetBindingDigest
    || value.assistantTurnId !== prepared.assistantTurnId
    || value.sourceIdentityDigest !== prepared.sourceIdentityDigest
    || value.kind !== prepared.kind
    || value.ordinal !== prepared.ordinal
    || value.transferActionId !== prepared.transferActionId
    || value.destinationIdentityDigest !== prepared.destinationIdentityDigest
  ) throw new ArtifactTransferError("operation_request_mismatch", "Durable artifact transfer identity does not match the request.");
}

function sameIdentity(left: ArtifactTransferIntentV1, right: ArtifactTransferReceiptV1): boolean {
  return sameTransferIdentity(left, right);
}

type TransferIdentity = Pick<ArtifactTransferIntentV1, "operationId" | "requestDigest" | "targetBindingDigest" | "assistantTurnId" | "sourceIdentityDigest" | "kind" | "ordinal" | "transferActionId" | "destinationIdentityDigest">;

function sameTransferIdentity(left: TransferIdentity, right: TransferIdentity): boolean {
  return left.operationId === right.operationId
    && left.requestDigest === right.requestDigest
    && left.targetBindingDigest === right.targetBindingDigest
    && left.assistantTurnId === right.assistantTurnId
    && left.sourceIdentityDigest === right.sourceIdentityDigest
    && left.kind === right.kind
    && left.ordinal === right.ordinal
    && left.transferActionId === right.transferActionId
    && left.destinationIdentityDigest === right.destinationIdentityDigest;
}

function sameIntent(left: ArtifactTransferIntentV1, right: ArtifactTransferIntentV1): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.actionKind === right.actionKind
    && left.repeatPolicy === right.repeatPolicy
    && left.intentAt === right.intentAt
    && sameTransferIdentity(left, right);
}

function sameReceipt(left: ArtifactTransferReceiptV1, right: ArtifactTransferReceiptV1): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.outputKey === right.outputKey
    && left.bytes === right.bytes
    && left.sha256 === right.sha256
    && left.status === right.status
    && left.blockerCode === right.blockerCode
    && left.observedAt === right.observedAt
    && sameTransferIdentity(left, right);
}

async function closeArtifactSource(source: AsyncIterable<Uint8Array>, prepared: PreparedTransfer): Promise<boolean> {
  try {
    const iteratorMethod = dataMethod(source, Symbol.asyncIterator);
    if (typeof iteratorMethod !== "function") return false;
    const iterator = Reflect.apply(iteratorMethod, source, []);
    const closeMethod = dataMethod(iterator, "return");
    if (typeof closeMethod !== "function") return false;
    await awaitProviderOperation(
      prepared,
      () => Reflect.apply(closeMethod, iterator, []) as PromiseLike<unknown>,
      PROVIDER_CLEANUP_TIMEOUT_MS
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * A late source capability arrived after the durable handoff boundary. Close
 * it opportunistically, but never await it or let a malformed provider result
 * escape as an unhandled rejection. The transfer remains uncertain and is
 * never reopened based on this cleanup attempt.
 */
function closeArtifactSourceBestEffort(source: unknown): void {
  try {
    const iteratorMethod = dataMethod(source, Symbol.asyncIterator);
    if (typeof iteratorMethod !== "function") return;
    const iterator = Reflect.apply(iteratorMethod, source, []);
    const closeMethod = dataMethod(iterator, "return");
    if (typeof closeMethod !== "function") return;
    const result = Reflect.apply(closeMethod, iterator, []);
    void Promise.resolve(result).then(() => undefined, () => undefined);
  } catch {
    // The capability is already outside the request authority. There is no
    // safe retry or durable fact to derive from a cleanup failure.
  }
}

function safeSource(value: unknown, maxBytes: number): AsyncIterable<Uint8Array> {
  const iteratorMethod = dataMethod(value, Symbol.asyncIterator);
  if (typeof iteratorMethod !== "function") throw invalidOptions();
  let iterator: unknown;
  try {
    iterator = Reflect.apply(iteratorMethod, value, []);
  } catch {
    throw invalidOptions();
  }
  const nextMethod = dataMethod(iterator, "next");
  if (typeof nextMethod !== "function") throw invalidOptions();
  const closeMethod = dataMethod(iterator, "return");
  let closed = false;

  const copyChunk = (value: unknown): Uint8Array => {
    try {
      // Make the copy before returning from the awaited `next` call.  The
      // provider retains ownership of the original view and may mutate it as
      // soon as this boundary resolves.  The internal marker lets the output
      // sink consume this defensive copy without allocating a second one.
      return copyProviderChunk(value, maxBytes);
    } catch {
      throw new ArtifactTransferError("source_invalid", "Artifact source chunk is invalid.");
    }
  };

  const close = async (value?: unknown): Promise<IteratorResult<Uint8Array>> => {
    if (closed) return { done: true, value: undefined };
    closed = true;
    if (typeof closeMethod !== "function") return { done: true, value: undefined };
    let raw: unknown;
    try {
      raw = await Reflect.apply(closeMethod, iterator, value === undefined ? [] : [value]);
    } catch {
      throw new ArtifactTransferError("source_close_failed", "Artifact source cleanup failed.");
    }
    if (raw === undefined) return { done: true, value: undefined };
    try {
      const result = snapshotExactRecord(raw, ["done", "value"]);
      if (typeof result.done !== "boolean") throw new Error("invalid done");
      return result.done
        ? { done: true, value: undefined }
        : { done: false, value: copyChunk(result.value) };
    } catch {
      throw new ArtifactTransferError("source_close_failed", "Artifact source cleanup failed.");
    }
  };

  const safeIterator: AsyncIterator<Uint8Array> = {
    next: async () => {
      if (closed) return { done: true, value: undefined };
      let raw: unknown;
      try {
        raw = await Reflect.apply(nextMethod, iterator, []);
      } catch {
        try { await close(); } catch { /* preserve the primary source error */ }
        throw new ArtifactTransferError("source_read_failed", "Artifact source could not be read.");
      }
      try {
        const result = snapshotExactRecord(raw, ["done", "value"]);
        if (typeof result.done !== "boolean") throw new Error("invalid done");
        if (result.done) {
          closed = true;
          return { done: true, value: undefined };
        }
        return { done: false, value: copyChunk(result.value) };
      } catch (error) {
        try { await close(); } catch { /* preserve the primary source error */ }
        if (error instanceof ArtifactTransferError && error.code === "source_invalid") throw error;
        throw new ArtifactTransferError("source_invalid", "Artifact source result is invalid.");
      }
    },
    return: close
  };
  Object.freeze(safeIterator);
  return Object.freeze({ [Symbol.asyncIterator]: () => safeIterator });
}

function noSourceRetry(): AsyncIterable<Uint8Array> {
  const iterator: AsyncIterator<Uint8Array> = {
    next: async (): Promise<IteratorResult<Uint8Array>> => {
      throw new ArtifactTransferError("source_retry_forbidden", "Provider source retry is forbidden after durable intent.");
    },
    return: async (): Promise<IteratorResult<Uint8Array>> => ({ done: true, value: undefined })
  };
  Object.freeze(iterator);
  return Object.freeze({
    [Symbol.asyncIterator]: (): AsyncIterator<Uint8Array> => iterator
  });
}

function dataMethod(value: unknown, key: string | symbol): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  let current: object | null = value;
  try {
    for (let depth = 0; current !== null && depth < 16; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) return "value" in descriptor ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function snapshotRecord(value: unknown, label: string, maxDepth = MAX_MAX_DEPTH): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalidOptions();
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalidOptions();
    if (Object.getOwnPropertySymbols(value).length !== 0) throw invalidOptions();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) throw invalidOptions();
      result[key] = descriptor.value;
    }
    assertGraphBounds(value, new Set<object>(), 0, maxDepth);
    void label;
    return result;
  } catch (error) {
    if (error instanceof ArtifactTransferError) throw error;
    throw invalidOptions();
  }
}

function snapshotExactRecord(value: unknown, keys: readonly string[], maxDepth = MAX_MAX_DEPTH): Record<string, unknown> {
  const record = snapshotRecord(value, "record", maxDepth);
  const expected = new Set(keys);
  if (Object.keys(record).length !== expected.size || Object.keys(record).some(key => !expected.has(key))) throw invalidOptions();
  return record;
}

/**
 * Walk only own data properties, never invoking accessors or traversing
 * prototypes.  This bounds the option/journal/record graph while retaining
 * callback and AbortSignal objects as opaque capabilities once their own
 * descriptors have been inspected.
 */
function assertGraphBounds(
  value: unknown,
  seen: Set<object>,
  depth: number,
  maxDepth: number
): void {
  if (value === null || typeof value !== "object" || typeof value === "function") return;
  // Byte views are validated/copied at their own boundary; enumerating every
  // byte as a graph node would reject otherwise bounded chunks.
  if (ArrayBuffer.isView(value)) return;
  if (seen.has(value)) return;
  if (depth > maxDepth || seen.size >= MAX_GRAPH_NODES) throw invalidOptions();
  seen.add(value);
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw invalidOptions();
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) throw invalidOptions();
    assertGraphBounds(descriptor.value, seen, depth + 1, maxDepth);
  }
}

function assertAllowedKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(record).some(key => !allowed.has(key))) throw invalidOptions();
}

function requiredString(record: Record<string, unknown>, key: string, pattern: RegExp | undefined, maxBytes: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || byteLength(value) > maxBytes || /[\u0000-\u001f\u007f]/u.test(value) || (pattern !== undefined && !pattern.test(value))) throw invalidOptions();
  return value;
}

function requiredOpaqueId(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) throw invalidOptions();
  return value;
}

function requiredKind(value: unknown): ArtifactTransferKind {
  if (value !== "file" && value !== "image" && value !== "other") throw invalidOptions();
  return value;
}

function requiredOrdinal(value: unknown, maxCount: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= maxCount) throw invalidOptions();
  return value as number;
}

function requiredFunction<T extends (...args: never[]) => unknown>(record: Record<string, unknown>, key: string): T {
  const value = record[key];
  if (typeof value !== "function") throw invalidOptions();
  return value as T;
}

function readOptionalString(record: Record<string, unknown>, key: string, maxBytes: number): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || byteLength(value) > maxBytes || /[\u0000-\u001f\u007f]/u.test(value)) throw invalidOptions();
  return value;
}

function optionalBoundedNumber(record: Record<string, unknown>, key: string, fallback: number, minimum: number, maximum: number): number {
  const value = record[key];
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw invalidOptions();
  return value as number;
}

function readOptionalSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (typeof AbortSignal !== "function" || value === null || typeof value !== "object") throw invalidOptions();
  try {
    if (!(value instanceof AbortSignal)) throw invalidOptions();
    const own = Object.getOwnPropertyDescriptor(value, "aborted");
    if (own !== undefined) throw invalidOptions();
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted");
    if (descriptor?.get === undefined || typeof descriptor.get.call(value) !== "boolean") throw invalidOptions();
  } catch (error) {
    if (error instanceof ArtifactTransferError) throw error;
    throw invalidOptions();
  }
  return value as AbortSignal;
}

function readOptionalDeadline(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_DEADLINE_AT) throw invalidOptions();
  return value as number;
}

function readNow(value: unknown): Readonly<{ now: () => number; faulted: () => boolean }> {
  if (value !== undefined && typeof value !== "function") throw invalidOptions();
  const source = value === undefined ? Date.now : value as () => number;
  let sample: number;
  try {
    sample = source();
    if (!Number.isSafeInteger(sample) || sample < 0 || sample > MAX_DEADLINE_AT) throw invalidOptions();
  } catch (error) {
    if (error instanceof ArtifactTransferError) throw error;
    throw invalidOptions();
  }
  let faulted = false;
  let lastValid = sample;
  const now = (): number => {
    if (faulted) return lastValid;
    try {
      const next = source();
      if (!Number.isSafeInteger(next) || next < 0 || next > MAX_DEADLINE_AT) throw new Error("invalid clock value");
      if (next < lastValid) throw new Error("clock moved backwards");
      lastValid = next;
      return next;
    } catch {
      // Retain the last valid sample so error handling can remain total and
      // deterministic.  Callers inspect faulted() and return uncertainty
      // before using this value for a new durable fact.
      faulted = true;
      return lastValid;
    }
  };
  return { now, faulted: () => faulted };
}

function isCancelledOrExpired(prepared: PreparedTransfer): boolean {
  if (isSignalAborted(prepared.signal)) return true;
  let current: number;
  try {
    current = prepared.now();
  } catch {
    return true;
  }
  if (prepared.clockFaulted()) return true;
  return prepared.deadlineAt !== undefined && current >= prepared.deadlineAt;
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  if (signal === undefined) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted");
    return descriptor?.get?.call(signal) === true;
  } catch {
    return true;
  }
}

function timestamp(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DEADLINE_AT) throw invalidOptions();
  const instant = new Date(value).toISOString();
  if (!INSTANT_PATTERN.test(instant)) throw invalidOptions();
  return instant;
}

function preparedTimestamp(prepared: PreparedTransfer, notBefore?: string): string {
  const value = prepared.now();
  if (prepared.clockFaulted()) {
    throw new ArtifactTransferError("operation_clock_invalid", "Operation clock became invalid.");
  }
  const instant = timestamp(value);
  if (notBefore !== undefined && (!isTimestamp(notBefore) || Date.parse(instant) < Date.parse(notBefore))) {
    throw new ArtifactTransferError("operation_clock_invalid", "Operation clock moved before the durable intent.");
  }
  return instant;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !INSTANT_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isArtifactStatus(value: unknown): value is ArtifactTransferStatus {
  return value === "transferred" || value === "partial" || value === "blocked";
}

function isAbsolutePath(value: string): boolean {
  return resolve(value) === value || value.startsWith("/");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function invalidOptions(): ArtifactTransferError {
  return new ArtifactTransferError("invalid_options", "Artifact transfer options are invalid.");
}

function freezeRecord<T extends object>(value: T): T {
  return Object.freeze(value);
}
