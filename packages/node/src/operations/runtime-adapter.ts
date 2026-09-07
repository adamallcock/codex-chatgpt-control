import type { PageLike } from "../types.js";
import type {
  CoordinatorOwner,
  ProcessTabCoordinator
} from "../runtime/tab-coordinator.js";
import {
  OperationRuntimeContext,
  type OperationRuntimeCapabilities
} from "../runtime/operation-context.js";
import {
  createOperationBrowserAdapter,
  OperationBrowserAdapterError,
  type OperationBrowserRecoveryContext,
  type ComposedOperationBrowserAdapter,
  type OperationBrowserAdapterOptions,
  type OperationBrowserCollectorPrimitive,
  type OperationBrowserControlPrimitive,
  type OperationBrowserArtifactPrimitive,
  type OperationBrowserCurrentTargetResult,
  type OperationBrowserStagingPrimitive,
  type OperationBrowserSubmissionPrimitive,
  type OperationBrowserTargetProbe,
  type OperationBrowserTargetProbeRequest
} from "./browser-adapter.js";
import type {
  OperationArtifactAdapter,
  OperationCollectorAdapter,
  OperationControlAdapter,
  OperationStagingAdapter,
  OperationSubmissionAdapter,
  OperationTargetResolution,
  OperationTargetResolutionRequest
} from "./service.js";
import type {
  OperationStagingCallbackRequest,
  OperationStagingMutationResult,
  OperationStagingObservation
} from "./staging.js";
import type {
  SubmissionExecutePreparedSendRequest,
  SubmissionExecutePreparedSendResult,
  SubmissionHandoffResult,
  SubmissionFinalTransactionResult,
  SubmissionPrepareSendRequest,
  SubmissionPrepareSendResult,
  SubmissionRecoverSendRequest,
  SubmissionStageObservation,
  SubmissionVerifyPreparedSendRequest
} from "./submission.js";
import type {
  BrowserTargetClaim,
  BrowserTargetEvidenceDigest
} from "./browser-target.js";
import type { OwnershipTargetEvidence } from "./turn-ownership.js";
import type { OperationFileIdentity } from "./file-identity.js";
import type { OperationSurface, OperationTargetBindingV1, OperationTargetRequestV1 } from "./types.js";
import { CONTROL_POSTCONDITION_RETRY_POLICY } from "./control.js";
import type {
  ControlSteerExecutePreparedRequest,
  ControlSteerPhaseResult,
  ControlSteerPrepareRequest,
  ControlSteerRecoverRequest,
  ControlSteerVerifyRequest
} from "./control.js";

/**
 * Browser primitives that are safe to pass into an operation adapter.
 *
 * The callbacks receive the captured page explicitly.  They must perform one
 * bounded DOM transaction and return an already-redacted observation.  In
 * particular, a callback must not poll for generation, wait for attachment
 * processing, read a mutable RuntimeEnv, or retry a non-repeatable browser
 * action.  Those waits belong to the operation collector and are deliberately
 * outside the tab actor.
 */
export type OperationRuntimeBrowserPrimitives = Readonly<{
  submission?: OperationBrowserSubmissionPrimitive;
  staging?: OperationBrowserStagingPrimitive;
  collector?: OperationBrowserCollectorPrimitive;
  control?: OperationBrowserControlPrimitive;
  artifacts?: OperationBrowserArtifactPrimitive;
}>;

/**
 * One request-scoped capture.  The capture factory is invoked lazily from
 * `resolveTarget`, after OperationService has created the durable operation
 * record.  It is the only place that may attach/claim/create a browser page.
 *
 * `targetEvidence` is required when no resolver is supplied.  A resolver is
 * useful for an explicit target policy (for example a selected tab versus a
 * caller-provided tab id), but it must remain read-only and return the same
 * captured page object.
 */
export type OperationRuntimeBrowserCapture = Readonly<{
  page: Readonly<PageLike>;
  /** Optional immutable context captured by the provider bridge. */
  runtimeContext?: OperationRuntimeContext<PageLike>;
  targetEvidence?: OwnershipTargetEvidence;
  authoritativeClaim?: BrowserTargetClaim;
  capabilities?: Partial<OperationRuntimeCapabilities>;
  /** Provider-proofed anchor evidence for a target whose ID is allocated by Send. */
  newTargetAnchorDigest?: string;
  blankTaskEvidenceDigest?: string;
  resolveTargetEvidence?: (
    request: OperationBrowserTargetProbeRequest
  ) => Promise<OperationBrowserTargetProbe> | OperationBrowserTargetProbe;
  observeCurrentTarget?: (
    request: Parameters<NonNullable<OperationBrowserAdapterOptions["observeCurrentTarget"]>>[0]
  ) => Promise<OperationBrowserCurrentTargetResult> | OperationBrowserCurrentTargetResult;
  /** Request-local output destination; intentionally absent on recovery. */
  outputDirectory?: string;
  primitives?: OperationRuntimeBrowserPrimitives;
}>;

export type OperationRuntimeBrowserCaptureRequest = Readonly<{
  operationId: string;
  requestDigest: string;
  surface: OperationSurface;
  target: OperationTargetRequestV1;
  signal: AbortSignal;
}>;

/**
 * Frozen locator and complete durable target supplied by an authenticated
 * post-restart handle factory.  `targetRequest` is explicit because a durable
 * binding must never be reconstructed by guessing a selected/replacement tab.
 */
export type OperationRuntimeBrowserRecoveryContext = Readonly<{
  operationId: string;
  requestDigest: string;
  surface: OperationSurface;
  target: OperationTargetBindingV1;
  targetRequest: OperationTargetRequestV1;
}>;

export type OperationRuntimeAdapterOptions = Readonly<{
  /** Backend process owner used by the process/tab coordinator. */
  owner: CoordinatorOwner;
  /** Journal-keyed evidence digest. It must never be a bare public hash. */
  evidenceDigest: BrowserTargetEvidenceDigest;
  /** Lazy, request-scoped page/context capture. */
  capture: (
    request: OperationRuntimeBrowserCaptureRequest
  ) => Promise<OperationRuntimeBrowserCapture> | OperationRuntimeBrowserCapture;
  /** Static operation closures may safely retain request-local private input. */
  primitives?: OperationRuntimeBrowserPrimitives;
  /** Set when the lazy capture will return the corresponding optional port.
   * Leaving this false keeps OperationService on its read-only submission
   * precondition path; exposing an absent staging port would otherwise turn a
   * safe pre-populated composer into an artificial mutation blocker. */
  exposeStaging?: boolean;
  /** Set when callers want structured unavailable control results. */
  exposeControl?: boolean;
  /** Set only for a request-local submit capture with an absolute destination. */
  exposeArtifacts?: boolean;
  coordinator?: ProcessTabCoordinator;
  transactionTimeoutMs?: number;
  files?: readonly OperationFileIdentity[];
  fileManifestDigest?: OperationBrowserAdapterOptions["fileManifestDigest"];
  /** Explicit lazy recovery path; submit adapters do not use this option. */
  recovery?: OperationRuntimeBrowserRecoveryContext;
  /** Separate read-only restart callback; cannot initialize a target:new capture. */
  recoverAuthenticatedSend?: (request: Parameters<NonNullable<OperationSubmissionAdapter["recoverAuthenticatedSend"]>>[0]) => Promise<Readonly<{
    result: SubmissionFinalTransactionResult;
    /** Only read ports may survive recovery; no target resolution or mutation. */
    collector?: OperationCollectorAdapter;
  }>>;
}>;

export type OperationRuntimeAdapterErrorCode =
  | "adapter_incomplete"
  | "capture_failed"
  | "capture_incomplete"
  | "target_evidence_unavailable"
  | "target_binding_mismatch"
  | "page_affinity_mismatch"
  | "unsupported_browser_primitive"
  | "not_initialized"
  | "backend_unavailable"
  | "browser_bridge_unavailable"
  | "login_required"
  | "captcha"
  | "rate_limited"
  | "permission_required"
  | "needs_confirmation"
  | "runtime_incompatible";

/** Stable, redacted error boundary for a request-scoped runtime adapter. */
export class OperationRuntimeAdapterError extends Error {
  readonly code: OperationRuntimeAdapterErrorCode;

  constructor(code: OperationRuntimeAdapterErrorCode) {
    super("The operation browser runtime could not prove the requested action safely.");
    this.name = "OperationRuntimeAdapterError";
    this.code = code;
  }
}

/**
 * This is the generic adapter's injection inventory, retained for compatibility
 * with integrations that assemble their own provider runtime. It does not
 * describe the default ChatGPT composite: `chatgpt-runtime.ts` injects the
 * proven production modules for these seams. The generic adapter itself never
 * guesses selectors or routes legacy polling helpers through a tab actor.
 */
export const UNWIRED_OPERATION_RUNTIME_PRIMITIVES = Object.freeze([
  "new_thread_creation",
  "configuration_set",
  "tool_selection",
  "composer_population",
  "file_chooser_handoff",
  "send_activation",
  "stop_activation",
  "work_steer_activation"
] as const);

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/")
    || /^[A-Za-z]:[\\/]/u.test(value)
    || value.startsWith("\\\\");
}

type Captured = Readonly<{
  page: Readonly<PageLike>;
  runtimeContext?: OperationRuntimeContext<PageLike>;
  targetEvidence?: OwnershipTargetEvidence;
  authoritativeClaim?: BrowserTargetClaim;
  capabilities?: Partial<OperationRuntimeCapabilities>;
  newTargetAnchorDigest?: string;
  blankTaskEvidenceDigest?: string;
  resolveTargetEvidence?: OperationRuntimeBrowserCapture["resolveTargetEvidence"];
  observeCurrentTarget?: OperationRuntimeBrowserCapture["observeCurrentTarget"];
  outputDirectory?: string;
  primitives: OperationRuntimeBrowserPrimitives;
}>;

/**
 * Compose one lazy runtime capture over the existing operation browser
 * adapter.  The returned object is intentionally request-scoped: a caller
 * should construct it in `OperationClient.adapterFactory` and retain it only
 * for the resulting operation handle.
 */
export function createRuntimeOperationBrowserAdapter(
  options: OperationRuntimeAdapterOptions
): ComposedOperationBrowserAdapter {
  options = normalizeRuntimeAdapterOptions(options);

  let capturePromise: Promise<Captured> | undefined;
  let innerPromise: Promise<ComposedOperationBrowserAdapter> | undefined;
  let captureIdentity: Readonly<{
    operationId: string;
    requestDigest: string;
    surface: OperationSurface;
  }> | undefined;

  const exposeStaging = options.exposeStaging ?? options.primitives?.staging !== undefined;
  const exposeControl = options.exposeControl ?? (options.primitives?.control !== undefined || options.recovery !== undefined);
  const exposeArtifacts = options.exposeArtifacts === true && options.recovery === undefined;

  const captureOnce = (request: OperationTargetResolutionRequest): Promise<Captured> => {
    if (
      captureIdentity !== undefined
      && (
        captureIdentity.operationId !== request.operationId
        || captureIdentity.requestDigest !== request.requestDigest
        || captureIdentity.surface !== request.surface
      )
    ) {
      return Promise.reject(new OperationRuntimeAdapterError("capture_incomplete"));
    }
    assertNativeAbortSignal(request.signal);
    captureIdentity ??= Object.freeze({
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      surface: request.surface
    });
    capturePromise ??= Promise.resolve()
      .then(() => options.capture(Object.freeze({
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        surface: request.surface,
        target: request.target,
        signal: request.signal
      })))
      .then(capture => normalizeCapture(capture, options.primitives, options.recovery !== undefined))
      .catch(error => {
        if (error instanceof OperationRuntimeAdapterError) throw error;
        throw new OperationRuntimeAdapterError(captureErrorCode(error));
      });
    return capturePromise;
  };

  const initialize = async (
    request: OperationTargetResolutionRequest
  ): Promise<ComposedOperationBrowserAdapter> => {
    if (
      options.recovery !== undefined
      && (
        request.operationId !== options.recovery.operationId
        || request.requestDigest !== options.recovery.requestDigest
        || request.surface !== options.recovery.surface
        || !sameTargetRequest(request.target, options.recovery.targetRequest)
      )
    ) {
      throw new OperationRuntimeAdapterError("target_binding_mismatch");
    }
    innerPromise ??= captureOnce(request).then(captured => {
      const adapterOptions: OperationBrowserAdapterOptions = {
        page: captured.page,
        ...(captured.runtimeContext === undefined ? {} : { runtimeContext: captured.runtimeContext }),
        owner: options.owner,
        ...(options.coordinator === undefined ? {} : { coordinator: options.coordinator }),
        evidenceDigest: options.evidenceDigest,
        ...(captured.targetEvidence === undefined ? {} : { targetEvidence: captured.targetEvidence }),
        ...(captured.resolveTargetEvidence === undefined ? {} : { resolveTargetEvidence: captured.resolveTargetEvidence }),
        ...(captured.observeCurrentTarget === undefined ? {} : { observeCurrentTarget: captured.observeCurrentTarget }),
        ...(captured.capabilities === undefined ? {} : { capabilities: captured.capabilities }),
        ...(captured.newTargetAnchorDigest === undefined ? {} : { newTargetAnchorDigest: captured.newTargetAnchorDigest }),
        ...(captured.blankTaskEvidenceDigest === undefined ? {} : { blankTaskEvidenceDigest: captured.blankTaskEvidenceDigest }),
        ...(captured.authoritativeClaim === undefined ? {} : { authoritativeClaim: captured.authoritativeClaim }),
        ...(options.transactionTimeoutMs === undefined ? {} : { transactionTimeoutMs: options.transactionTimeoutMs }),
        ...(options.files === undefined ? {} : { files: options.files }),
        ...(options.fileManifestDigest === undefined ? {} : { fileManifestDigest: options.fileManifestDigest }),
        ...(captured.primitives.submission === undefined ? {} : { submission: captured.primitives.submission }),
        ...(captured.primitives.staging === undefined ? {} : { staging: captured.primitives.staging }),
        ...(captured.primitives.collector === undefined ? {} : { collector: captured.primitives.collector }),
        ...(captured.primitives.control === undefined ? {} : { control: captured.primitives.control }),
        ...(captured.primitives.artifacts === undefined ? {} : { artifacts: captured.primitives.artifacts }),
        ...(captured.outputDirectory === undefined ? {} : { outputDirectory: captured.outputDirectory }),
        ...(options.recovery === undefined ? {} : {
          recovery: Object.freeze({
            operationId: options.recovery.operationId,
            requestDigest: options.recovery.requestDigest,
            surface: options.recovery.surface,
            target: options.recovery.target,
            signal: request.signal
          }) satisfies OperationBrowserRecoveryContext
        })
      };
      try {
        return createOperationBrowserAdapter(adapterOptions);
      } catch (error) {
        if (error instanceof OperationBrowserAdapterError) {
          throw new OperationRuntimeAdapterError(mapAdapterError(error.code));
        }
        throw new OperationRuntimeAdapterError("adapter_incomplete");
      }
    });
    return await innerPromise;
  };

  const ensureRecovered = (
    operationId: string,
    requestDigest: string,
    signal: AbortSignal
  ): Promise<ComposedOperationBrowserAdapter> => {
    const recovery = options.recovery;
    if (recovery === undefined) {
      return Promise.reject(new OperationRuntimeAdapterError("not_initialized"));
    }
    if (operationId !== recovery.operationId || requestDigest !== recovery.requestDigest) {
      return Promise.reject(new OperationRuntimeAdapterError("capture_incomplete"));
    }
    assertNativeAbortSignal(signal);
    return initialize({
      operationId: recovery.operationId,
      requestDigest: recovery.requestDigest,
      surface: recovery.surface,
      target: recovery.targetRequest,
      signal
    });
  };

  const resolveTarget = async (
    request: OperationTargetResolutionRequest
  ): Promise<OperationTargetResolution> => {
    const adapter = await initialize(request);
    try {
      return await adapter.resolveTarget(request);
    } catch (error) {
      if (error instanceof OperationRuntimeAdapterError) throw error;
      if (error instanceof OperationBrowserAdapterError) {
        throw new OperationRuntimeAdapterError(mapAdapterError(error.code));
      }
      throw new OperationRuntimeAdapterError("target_evidence_unavailable");
    }
  };

  // Phase ports remain usable after a process/backend restart.  In that case
  // the lazy inner adapter has not been initialized by resolveTarget; recover
  // the authenticated target first, then delegate the exact phase.  Normal
  // submit calls use the already-composed adapter.  Every unavailable path
  // returns a protocol-shaped redacted result rather than routing through the
  // compatibility-only final transaction port.
  const delegateSubmissionPhase = <T>(
    request: Readonly<{ operationId: string; requestDigest: string; signal?: AbortSignal }>,
    callback: (adapter: ComposedOperationBrowserAdapter) => Promise<T>,
    fallback: T
  ): Promise<T> => {
    if (options.recovery === undefined) {
      return delegateSubmission(innerPromise, callback, fallback);
    }
    const signal = request.signal ?? new AbortController().signal;
    return ensureRecovered(request.operationId, request.requestDigest, signal)
      .then(callback)
      .catch(() => fallback);
  };

  let recoveredCollector: OperationCollectorAdapter | undefined;
  const submission: OperationSubmissionAdapter = Object.freeze({
    ...(options.recoverAuthenticatedSend === undefined ? {} : { recoverAuthenticatedSend: async (request: Parameters<NonNullable<OperationSubmissionAdapter["recoverAuthenticatedSend"]>>[0]) => {
      if (innerPromise !== undefined) {
        return await (await innerPromise).submission.recoverSend(request);
      }
      const recovered = await options.recoverAuthenticatedSend!(request);
      if (recovered.result.status === "submitted" || recovered.result.status === "already_submitted") {
        recoveredCollector = recovered.collector;
      }
      return recovered.result;
    } }),
    observeStaging: request => delegateSubmission(innerPromise, adapter => adapter.submission.observeStaging(request), unavailableStage()),
    executeFileHandoffOnce: request => delegateSubmission(innerPromise, adapter => adapter.submission.executeFileHandoffOnce(request), unavailableHandoff()),
    observeAttachments: request => delegateSubmission(innerPromise, adapter => adapter.submission.observeAttachments(request), { status: "unavailable" }),
    prepareSend: request => delegateSubmissionPhase(
      request,
      adapter => adapter.submission.prepareSend(request),
      unavailablePrepareSend()
    ),
    executePreparedSend: request => delegateSubmissionPhase(
      request,
      adapter => adapter.submission.executePreparedSend(request),
      unavailableExecutePreparedSend()
    ),
    verifyPreparedSend: request => delegateSubmissionPhase(
      request,
      adapter => adapter.submission.verifyPreparedSend(request),
      unavailableFinalTransaction()
    ),
    recoverSend: request => delegateSubmissionPhase(
      request,
      adapter => adapter.submission.recoverSend(request),
      unavailableFinalTransaction()
    ),
    executeFinalTabTransaction: request => delegateSubmission(innerPromise, adapter => adapter.submission.executeFinalTabTransaction(request), { status: "blocked", blockerCode: "target_evidence_unavailable" })
  });

  const delegateRecovered = <T>(
    operationId: string,
    requestDigest: string,
    signal: AbortSignal,
    callback: (adapter: ComposedOperationBrowserAdapter) => Promise<T>
  ): Promise<T> => {
    if (options.recovery === undefined) return requireDelegate(innerPromise, callback);
    return ensureRecovered(operationId, requestDigest, signal)
      .then(callback)
      .catch(error => {
        if (error instanceof OperationRuntimeAdapterError) throw error;
        throw new OperationRuntimeAdapterError("target_evidence_unavailable");
      });
  };

  const delegateRecoveredControl = <T>(
    operationId: string,
    requestDigest: string,
    signal: AbortSignal,
    callback: (adapter: ComposedOperationBrowserAdapter) => Promise<T> | undefined,
    fallback: T
  ): Promise<T> => {
    if (options.recovery === undefined) return delegateControl(innerPromise, callback, fallback);
    return ensureRecovered(operationId, requestDigest, signal)
      .then(adapter => callback(adapter) ?? fallback)
      .catch(() => fallback);
  };

  const collector: OperationCollectorAdapter = Object.freeze({
    readContext: request => recoveredCollector !== undefined ? recoveredCollector.readContext(request) : delegateRecovered(
      request.operationId,
      request.requestDigest,
      request.signal,
      adapter => adapter.collector.readContext(request)
    ),
    observe: request => recoveredCollector !== undefined ? recoveredCollector.observe(request) : delegateRecovered(
      request.operationId,
      request.requestDigest,
      request.signal,
      adapter => adapter.collector.observe(request)
    ),
    sleep: (milliseconds, signal) => recoveredCollector !== undefined ? recoveredCollector.sleep(milliseconds, signal) : requireDelegate(innerPromise, adapter => adapter.collector.sleep(milliseconds, signal))
  });

  const staging: OperationStagingAdapter = Object.freeze({
    readCurrent: request => delegateStaging(innerPromise, adapter => adapter.staging?.readCurrent(request), unavailableStaging(request)),
    mutateOnce: request => delegateStagingMutation(innerPromise, adapter => adapter.staging?.mutateOnce(request)),
    observe: request => delegateStaging(innerPromise, adapter => adapter.staging?.observe(request), unavailableStaging(request))
  });

  const control: OperationControlAdapter = Object.freeze({
    postconditionRetry: CONTROL_POSTCONDITION_RETRY_POLICY,
    observeTurn: request => delegateRecoveredControl(
      request.operationId,
      request.parentRequestDigest,
      request.signal,
      adapter => adapter.control?.observeTurn(request),
      { status: "uncertain", reason: "unavailable" }
    ),
    executeOnce: request => delegateRecoveredControl(
      request.operationId,
      request.parentRequestDigest,
      request.signal,
      adapter => adapter.control?.executeOnce(request),
      { status: "uncertain", blockerCode: "send_control_unavailable" }
    ),
    observePostcondition: request => delegateRecoveredControl(
      request.operationId,
      request.parentRequestDigest,
      request.signal,
      adapter => adapter.control?.observePostcondition(request),
      { status: "uncertain", blockerCode: "send_control_unavailable" }
    ),
    prepareSteer: request => delegateRecoveredControl(
      request.parentOperationId,
      request.parentRequestDigest,
      request.signal,
      adapter => adapter.control?.prepareSteer?.(request),
      unavailableSteerPhase(request, "prepare")
    ),
    executeSteerPrepared: request => delegateRecoveredControl(
      request.prepared.parentOperationId,
      request.prepared.parentRequestDigest,
      request.signal,
      adapter => adapter.control?.executeSteerPrepared?.(request),
      unavailableSteerPhase(request, "execute_prepared")
    ),
    verifySteer: request => delegateRecoveredControl(
      request.prepared.parentOperationId,
      request.prepared.parentRequestDigest,
      request.signal,
      adapter => adapter.control?.verifySteer?.(request),
      unavailableSteerPhase(request, "verify")
    ),
    recoverSteer: request => delegateRecoveredControl(
      request.prepared.parentOperationId,
      request.prepared.parentRequestDigest,
      request.signal,
      adapter => adapter.control?.recoverSteer?.(request),
      unavailableSteerPhase(request, "recovery")
    )
  });

  const artifacts: OperationArtifactAdapter | undefined = exposeArtifacts
    ? Object.freeze({
        transfer: request => {
          if (innerPromise === undefined) {
            return Promise.reject(new OperationRuntimeAdapterError("not_initialized"));
          }
          return innerPromise.then(adapter => {
            if (adapter.artifacts === undefined) {
              throw new OperationRuntimeAdapterError("unsupported_browser_primitive");
            }
            return adapter.artifacts.transfer(request);
          }).catch(error => {
            if (error instanceof OperationRuntimeAdapterError) throw error;
            throw new OperationRuntimeAdapterError("target_evidence_unavailable");
          });
        }
      })
    : undefined;

  const adapter: ComposedOperationBrowserAdapter = {
    resolveTarget,
    submission,
    collector,
    ...(exposeStaging ? { staging } : {}),
    ...(exposeControl ? { control } : {}),
    ...(artifacts === undefined ? {} : { artifacts })
  };
  return Object.freeze(adapter);
}

/** Alias for callers that put the runtime qualifier first. */
export const createOperationRuntimeAdapter = createRuntimeOperationBrowserAdapter;

function normalizeRuntimeAdapterOptions(value: unknown): OperationRuntimeAdapterOptions {
  if (!isPlainDataRecord(value)) throw new OperationRuntimeAdapterError("adapter_incomplete");
  try {
    const owner = readOwnData(value, "owner");
    const evidenceDigest = readOwnData(value, "evidenceDigest");
    const capture = readOwnData(value, "capture");
    const primitives = readOwnData(value, "primitives");
    const exposeStaging = readOwnData(value, "exposeStaging");
    const exposeControl = readOwnData(value, "exposeControl");
    const exposeArtifacts = readOwnData(value, "exposeArtifacts");
    const coordinator = readOwnData(value, "coordinator");
    const transactionTimeoutMs = readOwnData(value, "transactionTimeoutMs");
    const files = readOwnData(value, "files");
    const fileManifestDigest = readOwnData(value, "fileManifestDigest");
    const recovery = readOwnData(value, "recovery");
    const recoverAuthenticatedSend = readOwnData(value, "recoverAuthenticatedSend");
    const normalizedRecovery = recovery === undefined
      ? undefined
      : (() => {
        validateRecoveryContext(recovery);
        return normalizeRecoveryContext(recovery);
      })();
    const snapshot: Record<string, unknown> = {
      owner: cloneFrozenData(owner),
      evidenceDigest,
      capture,
      primitives: primitives === undefined ? undefined : cloneFrozenProviderValue(primitives),
      exposeStaging,
      exposeControl,
      exposeArtifacts,
      coordinator,
      transactionTimeoutMs,
      files: files === undefined ? undefined : cloneFrozenData(files),
      fileManifestDigest,
      recovery: normalizedRecovery,
      recoverAuthenticatedSend
    };
    const normalized = Object.freeze(snapshot) as OperationRuntimeAdapterOptions;
    validateOptions(normalized);
    return normalized;
  } catch (error) {
    if (error instanceof OperationRuntimeAdapterError) throw error;
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
}

function validateOptions(options: OperationRuntimeAdapterOptions): void {
  if (!isPlainDataRecord(options)) {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  if (typeof options.capture !== "function" || typeof options.evidenceDigest !== "function") {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  if (options.recoverAuthenticatedSend !== undefined && typeof options.recoverAuthenticatedSend !== "function") {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  if (options.owner === null || typeof options.owner !== "object" || typeof options.owner.backendSessionId !== "string") {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  if (options.files !== undefined && !Array.isArray(options.files)) {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  if (options.exposeStaging !== undefined && typeof options.exposeStaging !== "boolean") {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  if (options.exposeControl !== undefined && typeof options.exposeControl !== "boolean") {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  if (options.exposeArtifacts !== undefined && typeof options.exposeArtifacts !== "boolean") {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  if (options.recovery !== undefined && options.exposeArtifacts === true) {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  if (options.recovery !== undefined) validateRecoveryContext(options.recovery);
}

function validateRecoveryContext(value: unknown): asserts value is OperationRuntimeBrowserRecoveryContext {
  if (!isPlainDataRecord(value)) throw new OperationRuntimeAdapterError("adapter_incomplete");
  const operationId = readOwnData(value, "operationId");
  const requestDigest = readOwnData(value, "requestDigest");
  const surface = readOwnData(value, "surface");
  const target = readOwnData(value, "target");
  const targetRequest = readOwnData(value, "targetRequest");
  if (
    typeof operationId !== "string"
    || !/^[A-Za-z0-9._:-]{1,512}$/u.test(operationId)
    || typeof requestDigest !== "string"
    || !/^hmac-sha256:[0-9a-f]{64}$/u.test(requestDigest)
    || (surface !== "chat" && surface !== "work")
    || !isPlainDataRecord(target)
    || !isPlainDataRecord(targetRequest)
    || !isSafeDataGraph(target)
    || !isSafeDataGraph(targetRequest)
  ) {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  const lifecycle = readOwnData(target, "targetLifecycle");
  if (lifecycle === "new_pending") {
    throw new OperationRuntimeAdapterError("target_binding_mismatch");
  }
  if (lifecycle !== undefined && lifecycle !== "fixed" && lifecycle !== "new_established") {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  const targetType = readOwnData(targetRequest, "type");
  if (
    targetType !== "new"
    && targetType !== "selected_tab"
    && targetType !== "tab_id"
    && targetType !== "conversation_id"
    && targetType !== "url"
  ) {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
}

function normalizeRecoveryContext(
  value: OperationRuntimeBrowserRecoveryContext
): OperationRuntimeBrowserRecoveryContext {
  try {
    const record = value as unknown as Record<string, unknown>;
    const operationId = readOwnData(record, "operationId");
    const requestDigest = readOwnData(record, "requestDigest");
    const surface = readOwnData(record, "surface");
    const targetValue = readOwnData(record, "target");
    const targetRequestValue = readOwnData(record, "targetRequest");
    if (targetValue === undefined || targetRequestValue === undefined) throw new Error("incomplete recovery context");
    const target = cloneFrozenData(targetValue) as OperationTargetBindingV1;
    const targetRequest = cloneFrozenData(targetRequestValue) as OperationTargetRequestV1;
    return Object.freeze({
      operationId: operationId as string,
      requestDigest: requestDigest as string,
      surface: surface as OperationSurface,
      target,
      targetRequest
    });
  } catch {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
}

function sameTargetRequest(
  left: OperationTargetRequestV1,
  right: OperationTargetRequestV1
): boolean {
  const leftType = readOwnData(left as unknown as Record<string, unknown>, "type");
  const rightType = readOwnData(right as unknown as Record<string, unknown>, "type");
  if (leftType !== rightType) return false;
  switch (leftType) {
    case "tab_id":
    case "conversation_id":
    case "url":
      return readOwnData(left as unknown as Record<string, unknown>, leftType === "tab_id" ? "tabId" : leftType === "conversation_id" ? "conversationId" : "url")
        === readOwnData(right as unknown as Record<string, unknown>, leftType === "tab_id" ? "tabId" : leftType === "conversation_id" ? "conversationId" : "url");
    case "new":
    case "selected_tab":
      return true;
    default:
      return false;
  }
}

function cloneFrozenData(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") throw new Error("unsupported value");
    return value;
  }
  if (seen.has(value)) throw new Error("cyclic value");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result = value.map(item => cloneFrozenData(item, seen));
      seen.delete(value);
      return Object.freeze(result);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("non-plain value");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    // Keep descriptor reads side-effect free and define keys explicitly: an
    // assignment to `__proto__` on a normal object invokes the legacy setter
    // and silently drops the caller's own data property.
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) throw new Error("accessor value");
      Object.defineProperty(result, key, {
        value: cloneFrozenData(descriptor.value, seen),
        enumerable: descriptor.enumerable ?? false,
        writable: true,
        configurable: true
      });
    }
    seen.delete(value);
    return Object.freeze(result);
  } catch (error) {
    seen.delete(value);
    throw error;
  }
}

/** Clone callback/primitive records through descriptors, never through gets. */
function cloneFrozenProviderValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new Error("cyclic provider value");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result = value.map(item => cloneFrozenProviderValue(item, seen));
      seen.delete(value);
      return Object.freeze(result);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("non-plain provider value");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) throw new Error("accessor provider value");
      Object.defineProperty(result, key, {
        value: cloneFrozenProviderValue(descriptor.value, seen),
        enumerable: descriptor.enumerable ?? false,
        writable: true,
        configurable: true
      });
    }
    seen.delete(value);
    return Object.freeze(result);
  } catch (error) {
    seen.delete(value);
    throw error;
  }
}

function assertNativeAbortSignal(value: unknown): asserts value is AbortSignal {
  if (value === null || typeof value !== "object" || typeof AbortSignal !== "function") {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  if (getter === undefined) throw new OperationRuntimeAdapterError("adapter_incomplete");
  try {
    if (typeof Reflect.apply(getter, value, []) !== "boolean") throw new Error("invalid signal");
  } catch {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
}

function normalizeCapture(
  value: OperationRuntimeBrowserCapture,
  configuredPrimitives: OperationRuntimeBrowserPrimitives | undefined,
  recoveryCapture = false
): Captured {
  if (!isPlainDataRecord(value)) {
    throw new OperationRuntimeAdapterError("capture_incomplete");
  }
  const page = readOwnData(value, "page");
  const runtimeContext = readOwnData(value, "runtimeContext");
  const targetEvidence = readOwnData(value, "targetEvidence");
  const authoritativeClaim = readOwnData(value, "authoritativeClaim");
  const capabilities = readOwnData(value, "capabilities");
  const newTargetAnchorDigest = readOwnData(value, "newTargetAnchorDigest");
  const blankTaskEvidenceDigest = readOwnData(value, "blankTaskEvidenceDigest");
  const resolveTargetEvidence = readOwnData(value, "resolveTargetEvidence");
  const observeCurrentTarget = readOwnData(value, "observeCurrentTarget");
  const primitivesValue = readOwnData(value, "primitives");
  if (page === undefined || page === null || typeof page !== "object" || Array.isArray(page)) {
    throw new OperationRuntimeAdapterError("capture_incomplete");
  }
  if (runtimeContext !== undefined && !(runtimeContext instanceof OperationRuntimeContext)) {
    throw new OperationRuntimeAdapterError("capture_incomplete");
  }
  if (typeof resolveTargetEvidence !== "function" && targetEvidence === undefined && !recoveryCapture) {
    throw new OperationRuntimeAdapterError("target_evidence_unavailable");
  }
  if (resolveTargetEvidence !== undefined && typeof resolveTargetEvidence !== "function") {
    throw new OperationRuntimeAdapterError("capture_incomplete");
  }
  if (observeCurrentTarget !== undefined && typeof observeCurrentTarget !== "function") {
    throw new OperationRuntimeAdapterError("capture_incomplete");
  }
  if (recoveryCapture && typeof observeCurrentTarget !== "function") {
    throw new OperationRuntimeAdapterError("target_evidence_unavailable");
  }
  if (primitivesValue !== undefined && !isPlainDataRecord(primitivesValue)) {
    throw new OperationRuntimeAdapterError("capture_incomplete");
  }
  const primitives = (primitivesValue === undefined
    ? {}
    : cloneFrozenProviderValue(primitivesValue)) as OperationRuntimeBrowserPrimitives;
  if (configuredPrimitives !== undefined && !isPlainDataRecord(configuredPrimitives)) {
    throw new OperationRuntimeAdapterError("adapter_incomplete");
  }
  const mergedPrimitives: {
    submission?: OperationBrowserSubmissionPrimitive;
    staging?: OperationBrowserStagingPrimitive;
    collector?: OperationBrowserCollectorPrimitive;
    control?: OperationBrowserControlPrimitive;
    artifacts?: OperationBrowserArtifactPrimitive;
  } = {};
  const configuredSubmission = configuredPrimitives === undefined
    ? undefined
    : readOwnData(configuredPrimitives, "submission");
  const configuredStaging = configuredPrimitives === undefined
    ? undefined
    : readOwnData(configuredPrimitives, "staging");
  const configuredCollector = configuredPrimitives === undefined
    ? undefined
    : readOwnData(configuredPrimitives, "collector");
  const configuredControl = configuredPrimitives === undefined
    ? undefined
    : readOwnData(configuredPrimitives, "control");
  const configuredArtifacts = configuredPrimitives === undefined
    ? undefined
    : readOwnData(configuredPrimitives, "artifacts");
  const submission = (readOwnData(primitives, "submission") ?? configuredSubmission) as OperationBrowserSubmissionPrimitive | undefined;
  if (submission !== undefined) mergedPrimitives.submission = submission;
  const staging = (readOwnData(primitives, "staging") ?? configuredStaging) as OperationBrowserStagingPrimitive | undefined;
  if (staging !== undefined) mergedPrimitives.staging = staging;
  const collector = (readOwnData(primitives, "collector") ?? configuredCollector) as OperationBrowserCollectorPrimitive | undefined;
  if (collector !== undefined) mergedPrimitives.collector = collector;
  const control = (readOwnData(primitives, "control") ?? configuredControl) as OperationBrowserControlPrimitive | undefined;
  if (control !== undefined) mergedPrimitives.control = control;
  // A restart capture never supplies request-local artifact primitives. Do not
  // resurrect an artifact source from static options or durable state.
  if (!recoveryCapture) {
    const artifacts = (readOwnData(primitives, "artifacts") ?? configuredArtifacts) as OperationBrowserArtifactPrimitive | undefined;
    if (artifacts !== undefined) mergedPrimitives.artifacts = artifacts;
  }
  const outputDirectory = readOwnData(value, "outputDirectory");
  if (outputDirectory !== undefined
    && (typeof outputDirectory !== "string" || outputDirectory.length === 0 || outputDirectory.length > 4096
      || !isAbsolutePath(outputDirectory) || /[\u0000-\u001f\u007f]/u.test(outputDirectory))) {
    throw new OperationRuntimeAdapterError("capture_incomplete");
  }
  if (recoveryCapture && outputDirectory !== undefined) {
    throw new OperationRuntimeAdapterError("capture_incomplete");
  }
  const normalizedTargetEvidence = targetEvidence === undefined ? undefined : cloneFrozenData(targetEvidence);
  const normalizedClaim = authoritativeClaim === undefined ? undefined : cloneFrozenData(authoritativeClaim);
  const normalizedCapabilities = capabilities === undefined ? undefined : cloneFrozenData(capabilities);
  return Object.freeze({
    page: page as Readonly<PageLike>,
    ...(runtimeContext === undefined ? {} : { runtimeContext }),
    ...(normalizedTargetEvidence === undefined ? {} : { targetEvidence: normalizedTargetEvidence as OwnershipTargetEvidence }),
    ...(normalizedClaim === undefined ? {} : { authoritativeClaim: normalizedClaim as BrowserTargetClaim }),
    ...(normalizedCapabilities === undefined ? {} : { capabilities: normalizedCapabilities as Partial<OperationRuntimeCapabilities> }),
    ...(newTargetAnchorDigest === undefined ? {} : { newTargetAnchorDigest: newTargetAnchorDigest as string }),
    ...(blankTaskEvidenceDigest === undefined ? {} : { blankTaskEvidenceDigest: blankTaskEvidenceDigest as string }),
    ...(resolveTargetEvidence === undefined ? {} : { resolveTargetEvidence: resolveTargetEvidence as OperationRuntimeBrowserCapture["resolveTargetEvidence"] }),
    ...(observeCurrentTarget === undefined ? {} : { observeCurrentTarget: observeCurrentTarget as OperationRuntimeBrowserCapture["observeCurrentTarget"] }),
    ...(outputDirectory === undefined ? {} : { outputDirectory }),
    primitives: Object.freeze(mergedPrimitives)
  });
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function unavailableSteerPhase(
  request: ControlSteerPrepareRequest | ControlSteerExecutePreparedRequest | ControlSteerVerifyRequest | ControlSteerRecoverRequest,
  phase: "prepare" | "execute_prepared" | "verify" | "recovery"
): ControlSteerPhaseResult {
  const identity = "prepared" in request ? request.prepared : request;
  return Object.freeze({
    schemaVersion: request.schemaVersion,
    phase,
    parentOperationId: identity.parentOperationId,
    parentRequestDigest: identity.parentRequestDigest,
    parentTargetBindingDigest: identity.parentTargetBindingDigest,
    controlActionId: identity.controlActionId,
    action: "steer" as const,
    requestDigest: identity.requestDigest,
    expectedAssistantTurnId: identity.expectedAssistantTurnId,
    ...("prepared" in request ? {
      assistantBranchId: request.prepared.assistantBranchId,
      assistantParentTurnId: request.prepared.assistantParentTurnId,
      baselineSnapshotDigest: request.prepared.baselineSnapshotDigest,
      preparedDigest: request.prepared.preparedDigest
    } : {}),
    status: "blocked" as const,
    blockerCode: "backend_unavailable" as const,
    observationRequired: phase === "prepare" ? false : true,
    mutationBoundary: phase === "prepare" ? "none" as const : "control_may_have_occurred" as const
  });
}

function isSafeDataGraph(value: unknown, seen = new Set<object>(), depth = 0): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return true;
  if (typeof value === "function") return false;
  if (depth > 16 || seen.has(value)) return false;
  seen.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).length > 1024) return false;
    for (const descriptor of Object.values(descriptors)) {
      if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) return false;
      if (!isSafeDataGraph(descriptor.value, seen, depth + 1)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function readOwnData(value: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor && descriptor.get === undefined && descriptor.set === undefined
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function mapAdapterError(code: OperationBrowserAdapterError["code"]): OperationRuntimeAdapterErrorCode {
  switch (code) {
    case "adapter_incomplete": return "adapter_incomplete";
    case "page_affinity_mismatch": return "page_affinity_mismatch";
    case "target_evidence_unavailable": return "target_evidence_unavailable";
    case "browser_bridge_unavailable": return "browser_bridge_unavailable";
    case "unsupported_browser_primitive": return "unsupported_browser_primitive";
    case "target_binding_mismatch": return "target_binding_mismatch";
    case "input_file_changed": return "unsupported_browser_primitive";
  }
}

function captureErrorCode(error: unknown): OperationRuntimeAdapterErrorCode {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) return "capture_failed";
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  const code = descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
  switch (code) {
    case "backend_unavailable":
    case "browser_bridge_unavailable":
    case "login_required":
    case "captcha":
    case "rate_limited":
    case "permission_required":
    case "needs_confirmation":
    case "runtime_incompatible":
    case "target_evidence_unavailable":
    case "target_binding_mismatch":
    case "page_affinity_mismatch":
      return code;
    case "rate_limit":
      return "rate_limited";
    default:
      return "capture_failed";
  }
}

function requireDelegate<T>(
  innerPromise: Promise<ComposedOperationBrowserAdapter> | undefined,
  callback: (adapter: ComposedOperationBrowserAdapter) => Promise<T>
): Promise<T> {
  if (innerPromise === undefined) return Promise.reject(new OperationRuntimeAdapterError("not_initialized"));
  return innerPromise
    .then(callback)
    .catch(error => {
      if (error instanceof OperationRuntimeAdapterError) throw error;
      throw new OperationRuntimeAdapterError("target_evidence_unavailable");
    });
}

function delegateSubmission<T>(
  innerPromise: Promise<ComposedOperationBrowserAdapter> | undefined,
  callback: (adapter: ComposedOperationBrowserAdapter) => Promise<T>,
  fallback: T
): Promise<T> {
  if (innerPromise === undefined) return Promise.resolve(fallback);
  return innerPromise.then(callback).catch(() => fallback);
}

function delegateStaging<T>(
  innerPromise: Promise<ComposedOperationBrowserAdapter> | undefined,
  callback: (adapter: ComposedOperationBrowserAdapter) => Promise<T> | undefined,
  fallback: T
): Promise<T> {
  if (innerPromise === undefined) return Promise.resolve(fallback);
  return innerPromise.then(adapter => callback(adapter) ?? fallback).catch(() => fallback);
}

function delegateStagingMutation(
  innerPromise: Promise<ComposedOperationBrowserAdapter> | undefined,
  callback: (adapter: ComposedOperationBrowserAdapter) => Promise<OperationStagingMutationResult> | undefined
): Promise<OperationStagingMutationResult> {
  if (innerPromise === undefined) return Promise.reject(new OperationRuntimeAdapterError("not_initialized"));
  return innerPromise.then(adapter => {
    const result = callback(adapter);
    if (result === undefined) throw new OperationRuntimeAdapterError("unsupported_browser_primitive");
    return result;
  }).catch(error => {
    if (error instanceof OperationRuntimeAdapterError) throw error;
    throw new OperationRuntimeAdapterError("target_evidence_unavailable");
  });
}

function delegateControl<T>(
  innerPromise: Promise<ComposedOperationBrowserAdapter> | undefined,
  callback: (adapter: ComposedOperationBrowserAdapter) => Promise<T> | undefined,
  fallback: T
): Promise<T> {
  if (innerPromise === undefined) return Promise.resolve(fallback);
  return innerPromise.then(adapter => callback(adapter) ?? fallback).catch(() => fallback);
}

function unavailableStage(): SubmissionStageObservation {
  return { status: "unavailable", reason: "unknown" };
}

function unavailableHandoff(): SubmissionHandoffResult {
  return { status: "not_satisfied", blockerCode: "target_evidence_unavailable" };
}

function unavailablePrepareSend(): SubmissionPrepareSendResult {
  return {
    status: "blocked",
    result: { status: "blocked", blockerCode: "target_evidence_unavailable" }
  };
}

function unavailableExecutePreparedSend(): SubmissionExecutePreparedSendResult {
  return {
    status: "blocked",
    result: { status: "blocked", blockerCode: "target_evidence_unavailable" }
  };
}

function unavailableFinalTransaction(): SubmissionFinalTransactionResult {
  return { status: "blocked", blockerCode: "target_evidence_unavailable" };
}

function unavailableStaging(request: Pick<OperationStagingCallbackRequest, "desiredStateDigest">): OperationStagingObservation {
  return {
    status: "unavailable",
    desiredStateDigest: request.desiredStateDigest,
    blockerCode: "target_evidence_unavailable"
  };
}
