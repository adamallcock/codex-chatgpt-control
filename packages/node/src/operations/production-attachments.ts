import { types as nodeTypes } from "node:util";
import type { FileChooserLike, LocatorLike, PageLike } from "../types.js";
import type { BrowserObservationDigest } from "./browser-observation.js";
import {
  type OperationFileIdentity,
  type OperationFileManifestEntryV1
} from "./file-identity.js";
import type {
  SubmissionAttachmentObservation,
  SubmissionAttachmentRequest,
  SubmissionExpectedEnvelope,
  SubmissionHandoffRequest,
  SubmissionHandoffResult
} from "./submission.js";
import type { OperationTargetBindingV1 } from "./types.js";
import { coordinatedEventRegistrationBarrier } from "../runtime/coordinated-page.js";
import { isPlainDataRecord } from "../runtime/value-boundaries.js";

/**
 * Provider capability for activating the one proven attachment/upload
 * control. Most providers return a visible locator. A browser integration may
 * instead return one bounded activation callback when its native upload input
 * is intentionally hidden and the provider can prove the exact active-composer
 * target through a narrower browser capability.
 */
export type ProductionAttachmentActivation = Readonly<{
  /** Provider-side candidate count before this primitive is allowed to click. */
  candidateCount: number;
  /** Stable provider capability key, never a localized display string. */
  capabilityKey: string;
} & (
  | {
      locator: LocatorLike;
      activate?: never;
    }
  | {
      locator?: never;
      /** One provider-owned gesture. The primitive starts the chooser waiter first. */
      activate: (options: Readonly<{ timeoutMs: number }>) => Promise<void> | void;
    }
)>;

/**
 * Optional bounded preparation for providers whose composer exposes a plus
 * menu before the final localized Upload row. The durable file-handoff intent
 * must already exist before this callback is invoked. This is a mutation and
 * therefore the callback receives the provider timeout and is awaited to
 * settlement; the primitive never retries it.
 */
export type ProductionAttachmentPreparationResult = Readonly<
  | { status: "prepared"; providerEvidenceDigest: string }
  | { status: "not_satisfied"; blockerCode: "selector_drift" | "ambiguous_file_handoff" | "operation_timeout" }
  | { status: "uncertain"; quarantine: "provider" | "caller" }
>;

/**
 * A provider attachment observer must return identity evidence from the live
 * surface itself. A filename, aria-label, or display name is not a content
 * identity and must never be converted into a manifest SHA or identity digest.
 */
export type ProductionAttachmentSurfaceRead = Readonly<
  | {
      status: "absent";
      source: "live_surface";
      count: 0;
      identityDigests: readonly [];
      providerEvidenceDigest: string;
    }
  | {
      status: "exact";
      source: "live_surface";
      count: number;
      identityDigests: readonly string[];
      providerEvidenceDigest: string;
    }
  | {
      status: "mismatch" | "delayed" | "ambiguous" | "unavailable";
      source: "live_surface";
      providerEvidenceDigest?: string;
    }
>;

export type ProductionAttachmentPrimitiveOptions = Readonly<{
  /** Journal-keyed HMAC evidence. Bare hashes are rejected. */
  evidenceDigest: BrowserObservationDigest;
  /** Request-local immutable inputs. Paths remain inside this module closure. */
  files: readonly OperationFileIdentity[];
  /** Computes the operation identity digest for one immutable file manifest. */
  identityDigest: (ordinal: number, manifest: OperationFileManifestEntryV1) => string | Promise<string>;
  /** Provider proof that a path still has its established identity. */
  revalidateFile: (identity: OperationFileIdentity) => Promise<void>;
  /** One bounded read of the provider's live attachment surface. Never polls. */
  observeSurface: (
    request: SubmissionAttachmentRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<ProductionAttachmentSurfaceRead>;
  /** One bounded discovery of the unique visible localized activation control. */
  resolveActivation: (
    request: SubmissionHandoffRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<ProductionAttachmentActivation | undefined>;
  /**
   * Optional one-shot plus-menu preparation. When present, this is the only
   * supported route for a two-step composer; callers must not hide a second
   * activation inside resolveActivation.
   */
  prepareActivation?: (
    request: SubmissionHandoffRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1,
    options: Readonly<{ timeoutMs: number }>
  ) => Promise<ProductionAttachmentPreparationResult>;
  /** Maximum chooser/callback budget. No polling interval is used. */
  timeoutMs?: number;
  /** Maximum accepted provider candidate count. */
  maxCandidates?: number;
}>;

/** Direct API plus the adapter-shaped bridge used by OperationBrowserAdapter. */
export type ProductionAttachmentPrimitive = Readonly<{
  observeAttachments: (
    request: SubmissionAttachmentRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<SubmissionAttachmentObservation>;
  handoffFiles: (
    request: SubmissionHandoffRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<SubmissionHandoffResult>;
  /**
   * Adapter-compatible wrapper. The supplied identities are checked against
   * the request-local immutable list, then discarded; raw paths never enter a
   * provider result or evidence payload.
   */
  handoffFilesForAdapter: (
    request: SubmissionHandoffRequest,
    files: readonly OperationFileIdentity[],
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<SubmissionHandoffResult>;
}>;

export const PRODUCTION_ATTACHMENT_SCHEMA_VERSION =
  "chatgpt.browser_control.production_attachments.v1" as const;

const DIGEST_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,512}$/u;
const CAPABILITY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const MAX_FILES = 256;
const DEFAULT_MAX_CANDIDATES = 128;
const MAX_CANDIDATES = 512;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_DEADLINE_AT = Date.UTC(2100, 0, 1);
const MAX_GRAPH_DEPTH = 12;
const MAX_GRAPH_NODES = 4_096;

type Snapshot = Readonly<{
  files: readonly OperationFileIdentity[];
  identityDigests: readonly string[];
}>;

type NormalizedRequest = Readonly<{
  operationId: string;
  requestDigest: string;
  surface: SubmissionAttachmentRequest["surface"];
  targetBindingDigest: string;
  manifest: SubmissionExpectedEnvelope["attachmentManifest"];
}>;

type NormalizedHandoffRequest = Readonly<{
  operationId: string;
  requestDigest: string;
  surface: SubmissionHandoffRequest["surface"];
  actionId: string;
  targetBindingDigest: string;
  manifest: SubmissionExpectedEnvelope["attachmentManifest"];
  signal?: AbortSignal;
  deadlineAt?: number;
}>;

type ChooserOutcome =
  | Readonly<{ kind: "success"; chooser: FileChooserLike }>
  | Readonly<{ kind: "rejected" }>
  | Readonly<{ kind: "timeout" }>
  | Readonly<{ kind: "aborted" }>;

type ChooserWait = {
  promise: Promise<ChooserOutcome>;
  outcome?: ChooserOutcome;
  registration?: Promise<void>;
};

type SafeMethod = (this: object, ...args: unknown[]) => unknown;

type RevalidationResult = "ok" | "changed" | "timeout";

/**
 * Build one request-scoped, non-repeatable attachment capability.
 *
 * The factory validates and freezes the entire identity graph before any
 * provider callback can run. Handoff has one state machine: revalidate -> arm
 * one chooser waiter -> resolve one visible control -> click at most once ->
 * setFiles at most once. If either browser mutation can have happened and its
 * outcome is not exact, the result is quarantined as uncertain.
 */
export function createProductionAttachmentPrimitive(
  options: ProductionAttachmentPrimitiveOptions
): ProductionAttachmentPrimitive {
  const normalized = normalizeOptions(options);
  return buildAttachmentPrimitive(normalized, snapshotFiles(normalized.files, normalized.identityDigest));
}

/** Snapshot caller input before awaiting a remote signing authority. */
export async function createProductionAttachmentPrimitiveAsync(
  options: ProductionAttachmentPrimitiveOptions
): Promise<ProductionAttachmentPrimitive> {
  const normalized = normalizeOptions(options);
  let digests: readonly string[];
  try {
    digests = await Promise.all(normalized.files.map(async (file, ordinal) =>
      await normalized.identityDigest(ordinal, file.manifest)));
  } catch { throw new Error("attachment identity digest failed"); }
  const snapshot = snapshotFiles(normalized.files, ordinal => digests[ordinal]!);
  return buildAttachmentPrimitive(normalized, snapshot);
}

function buildAttachmentPrimitive(
  normalized: ReturnType<typeof normalizeOptions>, snapshot: Snapshot
): ProductionAttachmentPrimitive {
  let handoffConsumed = false;

  const observeAttachments = async (
    request: SubmissionAttachmentRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ): Promise<SubmissionAttachmentObservation> => {
    const normalizedRequest = normalizeAttachmentRequest(request, snapshot);
    if (normalizedRequest === undefined || !isSafeProviderObject(page) || !isSafeDataGraph(target)) {
      return { status: "unavailable" };
    }

    let read: ProductionAttachmentSurfaceRead;
    try {
      const result = normalized.observeSurface(
        cloneAttachmentRequest(normalizedRequest),
        page,
        target
      );
      read = await boundedCallback(result, normalized.timeoutMs);
    } catch {
      return { status: "unavailable" };
    }
    return normalizeSurfaceObservation(normalizedRequest, read, normalized.evidenceDigest);
  };

  const handoffFiles = async (
    request: SubmissionHandoffRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ): Promise<SubmissionHandoffResult> => {
    const normalizedRequest = normalizeHandoffRequest(request, snapshot);
    if (normalizedRequest === undefined || !isSafeProviderObject(page) || !isSafeDataGraph(target)) {
      return { status: "not_satisfied", blockerCode: "attachment_manifest_mismatch" };
    }
    if (normalizedRequest.manifest.count === 0) {
      return { status: "not_satisfied", blockerCode: "attachment_manifest_mismatch" };
    }
    if (handoffConsumed) {
      return { status: "uncertain", quarantine: "caller" };
    }
    handoffConsumed = true;

    // The request deadline is the coordinator's absolute deadline. The
    // provider timeout remains a local upper bound, so a provider callback can
    // never outlive either budget. Once this request has entered the one-shot
    // handoff state, any caller cancellation is observation-only even when it
    // arrives before the first browser mutation.
    const requestSignal = normalizedRequest.signal;
    const requestDeadlineAt = normalizedRequest.deadlineAt;
    const deadlineAt = Math.min(requestDeadlineAt ?? MAX_DEADLINE_AT, Date.now() + normalized.timeoutMs);
    const requestCancellation = handoffCancellation(requestSignal, requestDeadlineAt);
    if (requestCancellation !== undefined) return requestCancellation;
    const revalidated = await revalidateSnapshot(snapshot, normalized.revalidateFile, deadlineAt);
    const afterRevalidationCancellation = handoffCancellation(requestSignal, requestDeadlineAt);
    if (afterRevalidationCancellation !== undefined) return afterRevalidationCancellation;
    if (revalidated === "changed") {
      return { status: "not_satisfied", blockerCode: "input_file_changed" };
    }
    if (revalidated === "timeout") {
      return { status: "not_satisfied", blockerCode: "operation_timeout" };
    }

    const chooserBudget = remainingBudget(deadlineAt);
    if (chooserBudget <= 0) return { status: "not_satisfied", blockerCode: "operation_timeout" };
    const waiter = startChooserWait(page, chooserBudget, requestSignal);
    // A coordinated page registers the provider listener through its tab
    // actor. Prove that short registration transaction completed, then drain
    // one host turn for any outcome that was already scheduled before this
    // operation's first activation. Such an outcome cannot be causal to the
    // not-yet-issued click and must block the handoff.
    const beforeActivation = await settleChooserBeforeMutation(waiter, deadlineAt, requestSignal);
    const afterActivationFenceCancellation = handoffCancellation(requestSignal, requestDeadlineAt);
    if (afterActivationFenceCancellation !== undefined) return afterActivationFenceCancellation;
    if (beforeActivation !== undefined) {
      // A chooser that settled before this invocation's activation may belong
      // to a human or an earlier browser action. Never feed request files to
      // an event whose causal activation this primitive cannot prove.
      if (beforeActivation.kind === "success") return { status: "not_satisfied", blockerCode: "ambiguous_file_handoff" };
      return beforeActivation.kind === "timeout"
        ? { status: "not_satisfied", blockerCode: "operation_timeout" }
        : { status: "not_satisfied", blockerCode: "ambiguous_file_handoff" };
    }

    if (normalized.prepareActivation !== undefined) {
      const preparationBudget = remainingBudget(deadlineAt);
      if (preparationBudget <= 0) return { status: "not_satisfied", blockerCode: "operation_timeout" };
      const beforePreparationCancellation = handoffCancellation(requestSignal, requestDeadlineAt);
      if (beforePreparationCancellation !== undefined) return beforePreparationCancellation;
      let preparation: ProductionAttachmentPreparationResult;
      try {
        const rawPreparation = normalized.prepareActivation(
          cloneHandoffRequest(normalizedRequest),
          page,
          target,
          { timeoutMs: preparationBudget }
        );
        preparation = await awaitMutatingCallback(rawPreparation);
      } catch {
        return { status: "uncertain", quarantine: "provider" };
      }
      const afterPreparationCancellation = handoffCancellation(requestSignal, requestDeadlineAt);
      if (afterPreparationCancellation !== undefined) return afterPreparationCancellation;
      if (!isPlainDataRecord(preparation)) return { status: "uncertain", quarantine: "provider" };
      const preparationStatus = readData(preparation, "status");
      if (preparationStatus === "not_satisfied") {
        const blockerCode = readData(preparation, "blockerCode");
        return blockerCode === "selector_drift" || blockerCode === "ambiguous_file_handoff" || blockerCode === "operation_timeout"
          ? { status: "not_satisfied", blockerCode }
          : { status: "uncertain", quarantine: "provider" };
      }
      if (preparationStatus === "uncertain") {
        const quarantine = readData(preparation, "quarantine");
        return quarantine === "provider" || quarantine === "caller"
          ? { status: "uncertain", quarantine }
          : { status: "uncertain", quarantine: "provider" };
      }
      const providerEvidenceDigest = readData(preparation, "providerEvidenceDigest");
      if (preparationStatus !== "prepared" || !isDigest(providerEvidenceDigest)) {
        return { status: "uncertain", quarantine: "provider" };
      }
      // If the preparation mutation delivered a chooser, it is not ours to
      // consume unless the final activation below also occurs after this
      // handoff invocation. A rejection means preparation may have acted.
      const afterPreparation = await settleChooserBeforeMutation(waiter, deadlineAt, requestSignal);
      if (afterPreparation !== undefined) {
        return { status: "uncertain", quarantine: "provider" };
      }
    }

    let activation: ProductionAttachmentActivation | undefined;
    const beforeResolveCancellation = handoffCancellation(requestSignal, requestDeadlineAt);
    if (beforeResolveCancellation !== undefined) return beforeResolveCancellation;
    try {
      const result = normalized.resolveActivation(
        cloneHandoffRequest(normalizedRequest),
        page,
        target
      );
      activation = await boundedCallback(result, remainingBudget(deadlineAt));
    } catch {
      return { status: "not_satisfied", blockerCode: "selector_drift" };
    }
    const afterResolveCancellation = handoffCancellation(requestSignal, requestDeadlineAt);
    if (afterResolveCancellation !== undefined) return afterResolveCancellation;
    const beforeFinalActivation = await settleChooserBeforeMutation(waiter, deadlineAt, requestSignal);
    if (beforeFinalActivation !== undefined) {
      return { status: "not_satisfied", blockerCode: "ambiguous_file_handoff" };
    }
    if (activation === undefined || !validateActivation(activation, normalized.maxCandidates)) {
      return { status: "not_satisfied", blockerCode: "selector_drift" };
    }

    const locator = readData<LocatorLike>(activation, "locator");
    const providerActivation = safeMethod(activation, "activate");
    let activate: ((timeoutMs: number) => unknown) | undefined;
    if (locator !== undefined) {
      const locatorCount = await readLocatorCount(locator, remainingBudget(deadlineAt));
      if (locatorCount !== 1) {
        return { status: "not_satisfied", blockerCode: "selector_drift" };
      }
      const visible = await readLocatorVisible(locator, remainingBudget(deadlineAt));
      if (visible !== true) {
        return { status: "not_satisfied", blockerCode: "selector_drift" };
      }
      const click = safeMethod(locator, "click");
      if (click === undefined) {
        return { status: "not_satisfied", blockerCode: "selector_drift" };
      }
      activate = timeoutMs => click.call(locator, { timeout: timeoutMs, timeoutMs });
    } else if (providerActivation !== undefined) {
      activate = timeoutMs => providerActivation.call(activation, { timeoutMs });
    }
    if (activate === undefined) return { status: "not_satisfied", blockerCode: "selector_drift" };

    const clickBudget = remainingBudget(deadlineAt);
    if (clickBudget <= 0) return { status: "not_satisfied", blockerCode: "operation_timeout" };
    const beforeClickCancellation = handoffCancellation(requestSignal, requestDeadlineAt);
    if (beforeClickCancellation !== undefined) return beforeClickCancellation;
    try {
      await awaitMutatingCallback(activate(clickBudget));
    } catch {
      // The chooser reconciliation below is authoritative. A bridge rejection
      // may have followed a delivered browser gesture.
    }
    const afterClickCancellation = handoffCancellation(requestSignal, requestDeadlineAt);
    if (afterClickCancellation !== undefined) return afterClickCancellation;

    // The activation has crossed the browser mutation boundary and its click
    // promise has settled. A chooser event is an observation, not a pending
    // mutation: bound that wait so a provider that ignores its own event
    // timeout cannot strand the operation forever. A late chooser is merely
    // recorded by the handled promise; no continuation can call setFiles.
    // Once click has crossed the browser boundary, keep the native chooser
    // reconciliation alive long enough for a late event even when the
    // provider-local pre-activation budget elapsed. A caller/coordinator abort
    // still short-circuits this observation and forbids setFiles.
    const chooserTimeout = requestDeadlineAt === undefined
      ? normalized.timeoutMs
      : Math.max(0, Math.min(normalized.timeoutMs, requestDeadlineAt - Date.now()));
    const chooser = await awaitChooser(waiter, chooserTimeout, requestSignal);
    if (chooser.kind === "aborted") return { status: "uncertain", quarantine: "caller" };
    if (chooser.kind === "success") {
      const beforeSetFilesCancellation = handoffCancellation(requestSignal, requestDeadlineAt);
      if (beforeSetFilesCancellation !== undefined) return beforeSetFilesCancellation;
      const result = await setChooserFilesOnce(
        chooser.chooser,
        snapshot,
        normalizedRequest,
        normalized,
        requestDeadlineAt === undefined
          ? normalized.timeoutMs
          : Math.max(0, Math.min(normalized.timeoutMs, requestDeadlineAt - Date.now()))
      );
      // A click that rejected after delivering the gesture can still produce
      // an exact chooser/setFiles result. Evidence remains authoritative.
      return result;
    }
    if (chooser.kind === "timeout") {
      return handoffCancellation(requestSignal, requestDeadlineAt)
        ?? { status: "uncertain", quarantine: "provider" };
    }
    // A visible activation occurred, but the chooser rejected. It is no longer
    // safe to claim that no provider-side mutation happened.
    return handoffCancellation(requestSignal, requestDeadlineAt)
      ?? { status: "uncertain", quarantine: "provider" };
  };

  const handoffFilesForAdapter = async (
    request: SubmissionHandoffRequest,
    files: readonly OperationFileIdentity[],
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ): Promise<SubmissionHandoffResult> => {
    if (!sameIdentityList(files, snapshot.files)) {
      return { status: "not_satisfied", blockerCode: "attachment_manifest_mismatch" };
    }
    return await handoffFiles(request, page, target);
  };

  return Object.freeze({
    observeAttachments,
    handoffFiles,
    handoffFilesForAdapter
  });
}

/** Alias retained for integrations that name the layer after its provider. */
export const createOperationProductionAttachments = createProductionAttachmentPrimitive;

function normalizeOptions(options: ProductionAttachmentPrimitiveOptions): Readonly<{
  files: readonly OperationFileIdentity[];
  identityDigest: ProductionAttachmentPrimitiveOptions["identityDigest"];
  evidenceDigest: BrowserObservationDigest;
  revalidateFile: ProductionAttachmentPrimitiveOptions["revalidateFile"];
  observeSurface: ProductionAttachmentPrimitiveOptions["observeSurface"];
  resolveActivation: ProductionAttachmentPrimitiveOptions["resolveActivation"];
  prepareActivation: ProductionAttachmentPrimitiveOptions["prepareActivation"];
  timeoutMs: number;
  maxCandidates: number;
}> {
  if (!isPlainDataRecord(options)) throw new Error("invalid attachment options");
  const evidenceDigestValue = readData(options, "evidenceDigest");
  const files = readData(options, "files");
  const identityDigestValue = readData(options, "identityDigest");
  const revalidateValue = readData(options, "revalidateFile");
  const observeSurfaceValue = readData(options, "observeSurface");
  const resolveActivationValue = readData(options, "resolveActivation");
  const prepareActivationValue = readData(options, "prepareActivation");
  const timeoutValue = readData(options, "timeoutMs");
  const maxCandidateValue = readData(options, "maxCandidates");
  if (
    typeof evidenceDigestValue !== "function"
    || typeof identityDigestValue !== "function"
    || !Array.isArray(files)
    || typeof observeSurfaceValue !== "function"
    || typeof resolveActivationValue !== "function"
    || typeof revalidateValue !== "function"
    || (prepareActivationValue !== undefined && typeof prepareActivationValue !== "function")
  ) {
    throw new Error("invalid attachment options");
  }
  const timeoutMs = timeoutValue === undefined ? DEFAULT_TIMEOUT_MS : timeoutValue;
  const maxCandidates = maxCandidateValue === undefined ? DEFAULT_MAX_CANDIDATES : maxCandidateValue;
  if (!isPositiveSafeInteger(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error("invalid attachment timeout");
  }
  if (!isPositiveSafeInteger(maxCandidates) || maxCandidates > MAX_CANDIDATES) {
    throw new Error("invalid attachment candidate bound");
  }
  const normalizedFiles = cloneIdentityList(files);
  return {
    files: normalizedFiles,
    identityDigest: identityDigestValue as ProductionAttachmentPrimitiveOptions["identityDigest"],
    evidenceDigest: evidenceDigestValue as BrowserObservationDigest,
    revalidateFile: revalidateValue as ProductionAttachmentPrimitiveOptions["revalidateFile"],
    observeSurface: observeSurfaceValue as ProductionAttachmentPrimitiveOptions["observeSurface"],
    resolveActivation: resolveActivationValue as ProductionAttachmentPrimitiveOptions["resolveActivation"],
    prepareActivation: prepareActivationValue as ProductionAttachmentPrimitiveOptions["prepareActivation"] | undefined,
    timeoutMs,
    maxCandidates
  };
}

function snapshotFiles(
  files: readonly OperationFileIdentity[],
  identityDigest: ProductionAttachmentPrimitiveOptions["identityDigest"]
): Snapshot {
  if (files.length > MAX_FILES) throw new Error("attachment manifest exceeds its bounded item limit");
  const identityDigests: string[] = [];
  for (let ordinal = 0; ordinal < files.length; ordinal += 1) {
    const identity = files[ordinal];
    if (identity === undefined) throw new Error("attachment identity is missing");
    let digest: unknown;
    try {
      digest = identityDigest(ordinal, identity.manifest);
    } catch {
      throw new Error("attachment identity digest failed");
    }
    if (isNativePromise(digest)) void digest.catch(() => undefined);
    if (!isDigest(digest) || identityDigests.includes(digest)) throw new Error("attachment identity digest is invalid");
    identityDigests.push(digest);
  }
  return Object.freeze({
    files: Object.freeze([...files]),
    identityDigests: Object.freeze(identityDigests)
  });
}

function normalizeAttachmentRequest(
  request: SubmissionAttachmentRequest,
  snapshot: Snapshot
): NormalizedRequest | undefined {
  if (!isPlainDataRecord(request)) return undefined;
  const operationId = readData(request, "operationId");
  const requestDigest = readData(request, "requestDigest");
  const surface = readData(request, "surface");
  const targetBindingDigest = readData(request, "targetBindingDigest");
  const manifest = normalizeManifest(readData(request, "manifest"), snapshot);
  if (
    typeof operationId !== "string" || !ID_PATTERN.test(operationId)
    || !isDigest(requestDigest)
    || (surface !== "chat" && surface !== "work")
    || !isDigest(targetBindingDigest)
    || manifest === undefined
  ) return undefined;
  return { operationId, requestDigest, surface, targetBindingDigest, manifest };
}

function normalizeHandoffRequest(
  request: SubmissionHandoffRequest,
  snapshot: Snapshot
): NormalizedHandoffRequest | undefined {
  if (!isPlainDataRecord(request)) return undefined;
  const operationId = readData(request, "operationId");
  const requestDigest = readData(request, "requestDigest");
  const surface = readData(request, "surface");
  const actionId = readData(request, "actionId");
  const targetBindingDigest = readData(request, "targetBindingDigest");
  const manifest = normalizeManifest(readData(request, "manifest"), snapshot);
  const signal = readData<AbortSignal>(request, "signal");
  const deadlineAt = readData<number>(request, "deadlineAt");
  if (
    typeof operationId !== "string" || !ID_PATTERN.test(operationId)
    || !isDigest(requestDigest)
    || (surface !== "chat" && surface !== "work")
    || typeof actionId !== "string" || !ID_PATTERN.test(actionId)
    || !isDigest(targetBindingDigest)
    || manifest === undefined
    || signal !== undefined && !isAbortSignal(signal)
    || deadlineAt !== undefined && (
      !Number.isSafeInteger(deadlineAt) || deadlineAt < 0 || deadlineAt > MAX_DEADLINE_AT
    )
  ) return undefined;
  return {
    operationId,
    requestDigest,
    surface,
    actionId,
    targetBindingDigest,
    manifest,
    ...(signal === undefined ? {} : { signal }),
    ...(deadlineAt === undefined ? {} : { deadlineAt })
  };
}

function normalizeManifest(
  value: unknown,
  snapshot: Snapshot
): SubmissionExpectedEnvelope["attachmentManifest"] | undefined {
  if (!isPlainDataRecord(value)) return undefined;
  const count = readData(value, "count");
  const orderPolicy = readData(value, "orderPolicy");
  const identities = readData(value, "identities");
  if (!isNonnegativeSafeInteger(count) || count > MAX_FILES || orderPolicy !== "exact" || !Array.isArray(identities) || !hasSafeArrayDescriptors(identities) || identities.length !== count || count !== snapshot.files.length) return undefined;
  const result: { identityDigest: string; ordinal: number }[] = [];
  const seen = new Set<string>();
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const entry = identities[ordinal];
    if (!isPlainDataRecord(entry)) return undefined;
    const identityDigest = readData(entry, "identityDigest");
    const entryOrdinal = readData(entry, "ordinal");
    if (!isDigest(identityDigest) || entryOrdinal !== ordinal || identityDigest !== snapshot.identityDigests[ordinal] || seen.has(identityDigest)) return undefined;
    seen.add(identityDigest);
    result.push({ identityDigest, ordinal });
  }
  return {
    count,
    orderPolicy: "exact",
    identities: Object.freeze(result)
  };
}

async function normalizeSurfaceObservation(
  request: NormalizedRequest,
  read: ProductionAttachmentSurfaceRead,
  evidenceDigest: BrowserObservationDigest
): Promise<SubmissionAttachmentObservation> {
  if (!isPlainDataRecord(read)) return { status: "unavailable" };
  const status = readData(read, "status");
  const source = readData(read, "source");
  const providerEvidenceDigest = readData(read, "providerEvidenceDigest");
  if (source !== "live_surface" || typeof status !== "string") return { status: "unavailable" };
  if (providerEvidenceDigest !== undefined && !isDigest(providerEvidenceDigest)) return { status: "unavailable" };
  if (status === "mismatch" || status === "delayed" || status === "ambiguous" || status === "unavailable") {
    const evidence = await safeEvidence(evidenceDigest, "attachment-surface", {
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      targetBindingDigest: request.targetBindingDigest,
      status,
      providerEvidenceDigest
    });
    return evidence === undefined ? { status } : { status, evidenceDigest: evidence };
  }
  const count = readData(read, "count");
  const identityDigests = readData(read, "identityDigests");
  if (!isNonnegativeSafeInteger(count) || count > MAX_FILES || !Array.isArray(identityDigests) || !hasSafeArrayDescriptors(identityDigests) || identityDigests.length !== count) {
    return { status: "unavailable" };
  }
  const observed: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < identityDigests.length; index += 1) {
    const identity = identityDigests[index];
    if (typeof identity !== "string" || !isDigest(identity) || seen.has(identity)) return { status: "ambiguous" };
    seen.add(identity);
    observed.push(identity);
  }
  if (status === "absent") {
    // `request.manifest` is the desired non-empty envelope.  An exact empty
    // live surface is the precondition that authorizes the one durable
    // handoff; requiring the desired manifest itself to be empty would make
    // every real upload unreachable.
    if (count !== 0 || observed.length !== 0 || request.manifest.count === 0 || providerEvidenceDigest === undefined) return { status: "mismatch" };
    const evidence = await safeEvidence(evidenceDigest, "attachment-surface", {
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      targetBindingDigest: request.targetBindingDigest,
      status,
      count: 0,
      identityDigests: [],
      providerEvidenceDigest
    });
    return evidence === undefined
      ? { status: "unavailable" }
      : { status: "absent", evidenceDigest: evidence, count: 0, orderPolicy: "exact", identityDigests: [] };
  }
  if (status !== "exact") return { status: "unavailable" };
  const exact = providerEvidenceDigest !== undefined
    && count === request.manifest.count
    && observed.every((identity, index) => identity === request.manifest.identities[index]?.identityDigest);
  const evidence = await safeEvidence(evidenceDigest, "attachment-surface", {
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    targetBindingDigest: request.targetBindingDigest,
    status,
    count,
    identityDigests: observed,
    providerEvidenceDigest
  });
  if (!exact) return evidence === undefined ? { status: "mismatch" } : { status: "mismatch", evidenceDigest: evidence };
  return evidence === undefined
    ? { status: "unavailable" }
    : { status: "exact", evidenceDigest: evidence, count, orderPolicy: "exact", identityDigests: observed };
}

async function revalidateSnapshot(
  snapshot: Snapshot,
  revalidateFile: (identity: OperationFileIdentity) => Promise<void>,
  deadlineAt: number
): Promise<RevalidationResult> {
  for (const identity of snapshot.files) {
    const budget = remainingBudget(deadlineAt);
    if (budget <= 0) return "timeout";
    try {
      const result = revalidateFile(identity);
      await boundedCallback(result, budget);
    } catch {
      if (remainingBudget(deadlineAt) <= 0) return "timeout";
      return "changed";
    }
  }
  return "ok";
}

async function setChooserFilesOnce(
  chooser: FileChooserLike,
  snapshot: Snapshot,
  request: NormalizedHandoffRequest,
  options: Readonly<{ evidenceDigest: BrowserObservationDigest; timeoutMs: number }>,
  timeoutMs: number
): Promise<SubmissionHandoffResult> {
  if (timeoutMs <= 0) return { status: "uncertain", quarantine: "provider" };
  const beforeMutationCancellation = handoffCancellation(request.signal, request.deadlineAt);
  if (beforeMutationCancellation !== undefined) return beforeMutationCancellation;
  // Chrome exposes FileChooser as a provider proxy around an object with
  // private fields. Descriptor-walking to the prototype and calling that raw
  // method with the proxy as `this` loses the provider's required binding.
  // Read this one trusted capability through the proxy and retain its exact
  // receiver, as the normal `chooser.setFiles(...)` API does.
  const setFiles = providerCallable(chooser, "setFiles");
  if (setFiles === undefined) return { status: "uncertain", quarantine: "provider" };
  const paths = snapshot.files.map(identity => identity.sourcePath);
  let rawResult: unknown;
  try {
    rawResult = setFiles(paths, { timeout: timeoutMs, timeoutMs });
  } catch {
    return { status: "uncertain", quarantine: "provider" };
  }
  try {
    await awaitMutatingCallback(rawResult);
  } catch {
    return { status: "uncertain", quarantine: "provider" };
  }
  // A cancellation during setFiles cannot prove whether the provider accepted
  // the local paths. Awaiting the native promise above prevents actor release,
  // but the result is still explicitly uncertain and must be reconciled by a
  // later observation rather than retried.
  if (request.signal?.aborted || request.deadlineAt !== undefined && Date.now() >= request.deadlineAt) {
    return { status: "uncertain", quarantine: "caller" };
  }
  const evidence = await safeEvidence(options.evidenceDigest, "attachment-handoff", {
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    actionId: request.actionId,
    targetBindingDigest: request.targetBindingDigest,
    count: request.manifest.count,
    identityDigests: request.manifest.identities.map(entry => entry.identityDigest),
    status: "satisfied"
  });
  return evidence === undefined
    ? { status: "uncertain", quarantine: "provider" }
    : { status: "satisfied", evidenceDigest: evidence };
}

function startChooserWait(page: Readonly<PageLike>, timeoutMs: number, signal?: AbortSignal): ChooserWait {
  const wait: ChooserWait = {
    promise: Promise.resolve({ kind: "rejected" })
  };
  if (signal?.aborted) {
    wait.outcome = { kind: "aborted" };
    wait.promise = Promise.resolve(wait.outcome);
    return wait;
  }
  const waitForEvent = safeMethod(page, "waitForEvent");
  if (waitForEvent === undefined) {
    wait.outcome = { kind: "rejected" };
    wait.promise = Promise.resolve(wait.outcome);
    return wait;
  }
  let raw: unknown;
  try {
    // Registration is synchronous and happens before any provider activation.
    raw = waitForEvent.call(page, "filechooser", { timeout: timeoutMs, timeoutMs });
  } catch {
    wait.outcome = { kind: "rejected" };
    wait.promise = Promise.resolve(wait.outcome);
    return wait;
  }
  if (!isNativePromise(raw)) {
    wait.outcome = { kind: "rejected" };
    wait.promise = Promise.resolve(wait.outcome);
    return wait;
  }
  const registration = coordinatedEventRegistrationBarrier(raw);
  if (registration !== undefined) wait.registration = registration;
  const handled = raw.then(
    value => {
      const outcome: ChooserOutcome = !isSafeProviderObject(value) || safeMethod(value, "setFiles") === undefined
        ? { kind: "rejected" }
        : { kind: "success", chooser: value as FileChooserLike };
      wait.outcome = outcome;
      return outcome;
    },
    () => {
      const outcome: ChooserOutcome = { kind: "rejected" };
      wait.outcome = outcome;
      return outcome;
    }
  );
  wait.promise = handled;
  return wait;
}

/**
 * Fence a coordinated waitForEvent registration before a browser mutation.
 * The additional host turn catches an already-scheduled provider rejection or
 * stale chooser; neither can have been caused by the click that has not run.
 */
async function settleChooserBeforeMutation(
  waiter: ChooserWait,
  deadlineAt: number,
  signal?: AbortSignal
): Promise<ChooserOutcome | undefined> {
  if (waiter.outcome !== undefined) return waiter.outcome;
  if (signal?.aborted) return { kind: "aborted" };
  if (waiter.registration !== undefined) {
    const budget = remainingBudget(deadlineAt);
    if (budget <= 0) return { kind: "timeout" };
    const registration = await awaitRegistration(waiter.registration, budget, signal);
    if (registration === "aborted") return { kind: "aborted" };
    if (registration === "timeout") return { kind: "timeout" };
    if (waiter.outcome !== undefined) return waiter.outcome;
    if (remainingBudget(deadlineAt) <= 0) return { kind: "timeout" };
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  } else {
    // An ordinary PageLike invokes waitForEvent in this stack. Native promise
    // adoption needs only microtasks; avoid imposing a timer turn on a caller
    // whose deliberately tiny provider timeout has already armed the waiter.
    await flushMicrotasks();
  }
  if (signal?.aborted) return { kind: "aborted" };
  if (waiter.outcome !== undefined) return waiter.outcome;
  return remainingBudget(deadlineAt) <= 0 ? { kind: "timeout" } : undefined;
}

async function awaitRegistration(
  value: Promise<void>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<"settled" | "timeout" | "aborted"> {
  return await new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    const onAbort = (): void => finish("aborted");
    const finish = (result: "settled" | "timeout" | "aborted"): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      finish("aborted");
      return;
    }
    void value.then(() => finish("settled"), () => finish("timeout"));
  });
}

async function awaitChooser(
  waiter: ChooserWait,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ChooserOutcome> {
  if (waiter.outcome !== undefined) return waiter.outcome;
  return await new Promise(resolve => {
    let settled = false;
    const onAbort = (): void => finish({ kind: "aborted" });
    const finish = (outcome: ChooserOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
    void waiter.promise.then(finish, () => finish({ kind: "rejected" }));
  });
}

function validateActivation(value: ProductionAttachmentActivation, maxCandidates: number): boolean {
  if (!isPlainDataRecord(value)) return false;
  const locator = readData(value, "locator");
  const activate = readData(value, "activate");
  const candidateCount = readData(value, "candidateCount");
  const capabilityKey = readData(value, "capabilityKey");
  const locatorActivation = isSafeProviderObject(locator) && activate === undefined;
  const callbackActivation = locator === undefined && typeof activate === "function";
  return (locatorActivation || callbackActivation)
    && Number.isSafeInteger(candidateCount)
    && candidateCount === 1
    && candidateCount <= maxCandidates
    && typeof capabilityKey === "string"
    && CAPABILITY_KEY_PATTERN.test(capabilityKey);
}

async function readLocatorCount(locator: LocatorLike, timeoutMs: number): Promise<number | undefined> {
  const count = safeMethod(locator, "count");
  if (count === undefined) return undefined;
  try {
    const value = await boundedCallback(count.call(locator), timeoutMs);
    return isNonnegativeSafeInteger(value) && value <= MAX_CANDIDATES ? value : undefined;
  } catch {
    return undefined;
  }
}

async function readLocatorVisible(locator: LocatorLike, timeoutMs: number): Promise<boolean | undefined> {
  const visible = safeMethod(locator, "isVisible");
  if (visible === undefined) return undefined;
  try {
    const value = await boundedCallback(visible.call(locator), timeoutMs);
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function boundedCallback<T>(value: PromiseLike<T> | T, timeoutMs: number): Promise<T> {
  // The browser contracts use native promises. Reject thenable proxies rather
  // than reading a hostile `then` accessor through Promise.resolve().
  if (isObjectLike(value) && !isNativePromise(value)) throw new Error("provider promise is not native");
  if (!isNativePromise(value)) return value as T;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("provider callback timed out")), timeoutMs);
    value.then(resolve, reject);
  });
  try {
    return await promise;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Mutating provider calls are deliberately not raced with a local timer.
 * Browser bridges can deliver the click/setFiles action and reject or settle
 * late; returning early would release a coordinated actor while that mutation
 * is still able to land. The provider receives the timeout option, and the
 * outer coordinator owns the transaction deadline/quarantine.
 */
async function awaitMutatingCallback<T>(value: PromiseLike<T> | T): Promise<T> {
  if (isObjectLike(value) && !isNativePromise(value)) throw new Error("provider promise is not native");
  if (isNativePromise(value)) return await value;
  return value as T;
}

function isNativePromise(value: unknown): value is Promise<unknown> {
  try {
    return nodeTypes.isPromise(value);
  } catch {
    return false;
  }
}

function sameIdentityList(left: readonly OperationFileIdentity[], right: readonly OperationFileIdentity[]): boolean {
  let normalized: readonly OperationFileIdentity[];
  try {
    normalized = cloneIdentityList(left);
  } catch {
    return false;
  }
  if (normalized.length !== right.length) return false;
  for (let index = 0; index < right.length; index += 1) {
    const candidate = normalized[index];
    const expected = right[index];
    if (candidate === undefined || expected === undefined || !sameIdentity(candidate, expected)) return false;
  }
  return true;
}

function sameIdentity(left: OperationFileIdentity, right: OperationFileIdentity): boolean {
  return left.sourcePath === right.sourcePath
    && left.manifest.displayName === right.manifest.displayName
    && left.manifest.bytes === right.manifest.bytes
    && left.manifest.contentSha256 === right.manifest.contentSha256
    && left.proof.device === right.proof.device
    && left.proof.inode === right.proof.inode
    && left.proof.size === right.proof.size
    && left.proof.modifiedNs === right.proof.modifiedNs
    && left.proof.changedNs === right.proof.changedNs;
}

function cloneIdentityList(value: readonly OperationFileIdentity[]): readonly OperationFileIdentity[] {
  if (!Array.isArray(value) || value.length > MAX_FILES || !hasSafeArrayDescriptors(value)) throw new Error("invalid attachment identities");
  const result: OperationFileIdentity[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const identity = value[index];
    if (identity === undefined || !isPlainDataRecord(identity)) throw new Error("invalid attachment identity");
    const sourcePath = readData(identity, "sourcePath");
    const manifest = cloneManifestEntry(readData(identity, "manifest"));
    const proof = cloneProof(readData(identity, "proof"));
    if (typeof sourcePath !== "string" || sourcePath.length === 0 || sourcePath.length > 4096 || /[\u0000-\u001f\u007f]/u.test(sourcePath) || manifest === undefined || proof === undefined) throw new Error("invalid attachment identity");
    result.push(Object.freeze({ sourcePath, manifest, proof }));
  }
  return Object.freeze(result);
}

function cloneManifestEntry(value: unknown): OperationFileIdentity["manifest"] | undefined {
  if (!isPlainDataRecord(value)) return undefined;
  const displayName = readData(value, "displayName");
  const bytes = readData(value, "bytes");
  const contentSha256 = readData(value, "contentSha256");
  if (typeof displayName !== "string" || displayName.length === 0 || displayName.length > 512 || /[\\/\u0000-\u001f\u007f]/u.test(displayName)) return undefined;
  if (!isNonnegativeSafeInteger(bytes) || typeof contentSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(contentSha256)) return undefined;
  return Object.freeze({ displayName, bytes, contentSha256 });
}

function cloneProof(value: unknown): OperationFileIdentity["proof"] | undefined {
  if (!isPlainDataRecord(value)) return undefined;
  const device = readData(value, "device");
  const inode = readData(value, "inode");
  const size = readData(value, "size");
  const modifiedNs = readData(value, "modifiedNs");
  const changedNs = readData(value, "changedNs");
  if (typeof device !== "string" || !/^[0-9]+$/u.test(device)
    || typeof inode !== "string" || !/^[0-9]+$/u.test(inode)
    || typeof size !== "string" || !/^[0-9]+$/u.test(size)
    || typeof modifiedNs !== "string" || !/^[0-9]+$/u.test(modifiedNs)
    || typeof changedNs !== "string" || !/^[0-9]+$/u.test(changedNs)) return undefined;
  return Object.freeze({ device, inode, size, modifiedNs, changedNs });
}

function cloneAttachmentRequest(request: NormalizedRequest): SubmissionAttachmentRequest {
  return Object.freeze({
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    surface: request.surface,
    targetBindingDigest: request.targetBindingDigest,
    manifest: Object.freeze({
      count: request.manifest.count,
      orderPolicy: "exact",
      identities: Object.freeze(request.manifest.identities.map(entry => Object.freeze({ ...entry })))
    })
  });
}

function cloneHandoffRequest(request: NormalizedHandoffRequest): SubmissionHandoffRequest {
  return Object.freeze({
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    surface: request.surface,
    actionId: request.actionId,
    targetBindingDigest: request.targetBindingDigest,
    manifest: Object.freeze({
      count: request.manifest.count,
      orderPolicy: "exact",
      identities: Object.freeze(request.manifest.identities.map(entry => Object.freeze({ ...entry })))
    }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    ...(request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt })
  });
}

async function safeEvidence(
  evidenceDigest: BrowserObservationDigest,
  domain: string,
  material: unknown
): Promise<string | undefined> {
  try {
    const result = await evidenceDigest(domain, material);
    return isDigest(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function remainingBudget(deadlineAt: number): number {
  return Math.max(0, Math.min(MAX_TIMEOUT_MS, deadlineAt - Date.now()));
}

/**
 * A handoff request is issued only after its durable intent is recorded.  A
 * request-local abort therefore cannot authorize a retry, even when it arrives
 * before the provider reaches click/setFiles. Return an explicit quarantine
 * result so callers know to observe the live surface instead.
 */
function handoffCancellation(
  signal: AbortSignal | undefined,
  deadlineAt: number | undefined
): SubmissionHandoffResult | undefined {
  if (signal?.aborted) return { status: "uncertain", quarantine: "caller" };
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    return { status: "uncertain", quarantine: "caller" };
  }
  return undefined;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (typeof AbortSignal === "undefined" || !(value instanceof AbortSignal)) return false;
  try {
    return typeof value.aborted === "boolean"
      && typeof value.addEventListener === "function"
      && typeof value.removeEventListener === "function";
  } catch {
    return false;
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function readData<T = unknown>(value: object, key: PropertyKey): T | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) return undefined;
    return descriptor.value as T;
  } catch {
    return undefined;
  }
}

function safeMethod(value: object, key: string): SafeMethod | undefined {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < MAX_GRAPH_DEPTH; depth += 1) {
    const descriptor = readDescriptor(current, key);
    if (descriptor !== undefined) {
      if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined || typeof descriptor.value !== "function") return undefined;
      return descriptor.value as SafeMethod;
    }
    current = readPrototype(current);
  }
  return undefined;
}

function providerCallable(value: object, key: PropertyKey): ((...args: unknown[]) => unknown) | undefined {
  try {
    const candidate = Reflect.get(value, key, value);
    if (typeof candidate !== "function") return undefined;
    return (...args: unknown[]) => Reflect.apply(candidate, value, args);
  } catch {
    return undefined;
  }
}

function readDescriptor(value: object, key: PropertyKey): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
}

function readPrototype(value: object): object | null {
  try {
    return Object.getPrototypeOf(value) as object | null;
  } catch {
    return null;
  }
}

function isSafeProviderObject(value: unknown): value is object {
  if (!isObjectLike(value)) return false;
  // A descriptor walk is intentionally shallow for browser objects; provider
  // methods may live on prototypes and are validated at each invocation.
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return false;
      const descriptor = descriptors[key];
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isSafeDataGraph(value: unknown, seen = new Set<object>(), depth = 0): boolean {
  if (value === null || typeof value !== "object") return value !== undefined && typeof value !== "function";
  if (depth > MAX_GRAPH_DEPTH || seen.has(value)) return depth <= MAX_GRAPH_DEPTH;
  seen.add(value);
  if (seen.size > MAX_GRAPH_NODES) return false;
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return false;
  }
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) return false;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return false;
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) return false;
    if (!isSafeDataGraph(descriptor.value, seen, depth + 1)) return false;
  }
  return true;
}

function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function hasSafeArrayDescriptors(value: readonly unknown[]): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return false;
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) return false;
    }
    const lengthDescriptor = readDescriptor(value, "length");
    const length = lengthDescriptor !== undefined && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
    return isNonnegativeSafeInteger(length) && length === value.length;
  } catch {
    return false;
  }
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonnegativeSafeInteger(value) && value > 0;
}
