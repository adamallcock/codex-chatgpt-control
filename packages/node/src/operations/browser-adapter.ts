import { createBrowserResourceKey, getProcessTabCoordinator, type CoordinatorOwner, type ProcessTabCoordinator } from "../runtime/tab-coordinator.js";
import {
  OperationRuntimeContext,
  type OperationRuntimeCapabilities,
  type OperationRuntimeContextCapture
} from "../runtime/operation-context.js";
import type { PageLike } from "../types.js";
import {
  observeBrowserPage,
  type BrowserObservationDigest,
  type BrowserObservationResult
} from "./browser-observation.js";
import {
  bindBrowserTargetAsync,
  type BrowserTargetBinding,
  type BrowserTargetBindingInput,
  type BrowserTargetCapabilities,
  type BrowserTargetClaim,
  type BrowserTargetEvidenceDigest,
  type BrowserTargetTransactionContext
} from "./browser-target.js";
import {
  type OperationStagingCallbackRequest,
  type OperationStagingMutationResult,
  type OperationStagingObservation
} from "./staging.js";
import { canonicalJson } from "./canonical.js";
import {
  executePreparedSendOnce,
  prepareSendOnce,
  recoverSendOnce,
  runSendOnce,
  verifyPreparedSendOnce,
  type SendOncePrepared,
  type SendOnceObservers,
  type SendOncePreconditionObservation,
  type SendOncePostconditionRequest
} from "./send-once.js";
import {
  revalidateOperationFile,
  type OperationFileIdentity
} from "./file-identity.js";
import type {
  CollectorObservation,
  CollectorObservationRequest
} from "./collector.js";
import {
  CONTROL_COORDINATOR_SCHEMA_VERSION,
  CONTROL_POSTCONDITION_RETRY_POLICY
} from "./control.js";
import type {
  ControlSteerExecutePreparedRequest,
  ControlSteerPhaseResult,
  ControlSteerPrepareRequest,
  ControlSteerRecoverRequest,
  ControlSteerVerifyRequest,
  ControlSteerPrepared,
  ControlExecutionRequest,
  ControlExecutionResult,
  ControlPostconditionObservation,
  ControlPostconditionRequest,
  ControlTurnObservation,
  ControlTurnObservationRequest
} from "./control.js";
import type {
  OperationCollectorContext,
  OperationCollectorContextRequest,
  OperationCollectorAdapter,
  OperationBrowserAdapter,
  OperationControlAdapter,
  OperationStagingAdapter,
  OperationSubmissionAdapter,
  OperationTargetResolution,
  OperationTargetResolutionRequest,
  AuthenticatedSendRecoveryRequest
} from "./service.js";
import {
  transferOperationArtifact,
  type ArtifactTransferSourceRequest
} from "./artifact-transfer.js";
import type { DownloadLike } from "../browser/downloads.js";
import type {
  OperationBlockerCode,
  OperationTargetBindingV1,
  OperationTargetRequestV1,
  OperationSurface
} from "./types.js";
import { TURN_OWNERSHIP_SCHEMA_VERSION, type OwnershipTargetEvidence } from "./turn-ownership.js";
import type {
  SubmissionAttachmentObservation,
  SubmissionAttachmentRequest,
  SubmissionExpectedEnvelope,
  SubmissionFinalTransactionRequest,
  SubmissionFinalTransactionResult,
  SubmissionHandoffRequest,
  SubmissionHandoffResult,
  SubmissionPrepareSendRequest,
  SubmissionPrepareSendResult,
  SubmissionPreparedSend,
  SubmissionExecutePreparedSendRequest,
  SubmissionExecutePreparedSendResult,
  SubmissionVerifyPreparedSendRequest,
  SubmissionRecoverSendRequest,
  SubmissionBlockerCode,
  SubmissionStageObservation,
  SubmissionStageRequest
} from "./submission.js";

/**
 * Browser-bound adapter errors intentionally contain only a stable code.  The
 * visible browser layer may produce provider/bridge errors containing URLs,
 * paths, prompt text, or claim tokens; none of those values are allowed to
 * cross this boundary.
 */
export type OperationBrowserAdapterErrorCode =
  | "adapter_incomplete"
  | "target_evidence_unavailable"
  | "target_binding_mismatch"
  | "page_affinity_mismatch"
  | "browser_bridge_unavailable"
  | "unsupported_browser_primitive"
  | "input_file_changed";

export class OperationBrowserAdapterError extends Error {
  readonly code: OperationBrowserAdapterErrorCode;

  constructor(code: OperationBrowserAdapterErrorCode) {
    super(code === "input_file_changed"
      ? "An operation input file changed before the file handoff; no browser handoff was attempted."
      : "The operation browser adapter could not prove the requested browser action safely.");
    this.name = "OperationBrowserAdapterError";
    this.code = code;
  }
}

type AdapterPage = PageLike;

/** A target probe is read-only and returns no caller-controlled diagnostics. */
export type OperationBrowserTargetProbe = Readonly<{
  page?: Readonly<PageLike>;
  evidence: OwnershipTargetEvidence;
  authoritativeClaim?: BrowserTargetClaim;
  capabilities?: Partial<BrowserTargetCapabilities>;
  /** New targets must carry provider-proofed blank-task anchor evidence. */
  targetLifecycle?: "fixed" | "new_pending" | "new_established";
  newTargetAnchorDigest?: string;
  blankTaskEvidenceDigest?: string;
}>;

export type OperationBrowserTargetProbeRequest = Readonly<{
  page: Readonly<PageLike>;
  operationId: string;
  requestDigest: string;
  surface: OperationSurface;
  target: OperationTargetRequestV1;
  signal: AbortSignal;
}>;

export type OperationBrowserCurrentTargetRequest = Readonly<{
  page: Readonly<PageLike>;
  operationId: string;
  target: OperationTargetBindingV1;
  signal: AbortSignal;
  deadlineAt?: number;
}>;

export type OperationBrowserCurrentTargetResult = Readonly<{
  evidence: OwnershipTargetEvidence;
  authoritativeClaim?: BrowserTargetClaim;
}>;

/**
 * Authenticated, read-only context used when a process-restarted handle is
 * reconstructed.  The durable target is the complete journal-owned binding;
 * it is never rebuilt from the currently selected tab or from a guessed
 * replacement.
 */
export type OperationBrowserRecoveryContext = Readonly<{
  operationId: string;
  requestDigest: string;
  surface: OperationSurface;
  target: OperationTargetBindingV1;
  signal: AbortSignal;
}>;

/** The page and target are supplied by the adapter, not recovered from RuntimeEnv. */
export type OperationBrowserStagingPrimitive = Readonly<{
  readCurrent?: (request: OperationStagingCallbackRequest & {
    page: Readonly<PageLike>;
    target: OperationTargetBindingV1;
  }) => Promise<OperationStagingObservation>;
  mutateOnce?: (request: OperationStagingCallbackRequest & {
    page: Readonly<PageLike>;
    target: OperationTargetBindingV1;
  }) => Promise<OperationStagingMutationResult>;
  observe?: (request: OperationStagingCallbackRequest & {
    page: Readonly<PageLike>;
    target: OperationTargetBindingV1;
  }) => Promise<OperationStagingObservation>;
}>;

export type OperationBrowserSubmissionPrimitive = Readonly<{
  observeStaging?: (
    request: SubmissionStageRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<SubmissionStageObservation>;
  handoffFiles?: (
    request: SubmissionHandoffRequest,
    files: readonly OperationFileIdentity[],
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<SubmissionHandoffResult>;
  observeAttachments?: (
    request: SubmissionAttachmentRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<SubmissionAttachmentObservation>;
  /** One-shot redacted probes; SendOnce owns bounded polling outside the actor. */
  sendObservers?: SendOnceObservers;
}>;

export type OperationBrowserCollectorPrimitive = Readonly<{
  readContext?: (
    request: OperationCollectorContextRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<OperationCollectorContext>;
  observe?: (
    request: CollectorObservationRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1,
    context: OperationCollectorContext
  ) => Promise<CollectorObservation>;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}>;

export type OperationBrowserControlPrimitive = Readonly<{
  observeTurn?: (
    request: ControlTurnObservationRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<ControlTurnObservation>;
  executeOnce?: (
    request: ControlExecutionRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<ControlExecutionResult>;
  observePostcondition?: (
    request: ControlPostconditionRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<ControlPostconditionObservation>;
  /** Read-only Work-steer preparation; prompt text never crosses this boundary. */
  prepareSteer?: (
    request: ControlSteerPrepareRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<ControlSteerPhaseResult>;
  /** Sole short Work-steer control transaction; provider must await mutation settlement. */
  executeSteerPrepared?: (
    request: ControlSteerExecutePreparedRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<ControlSteerPhaseResult>;
  /** Read-only Work-steer postcondition observation. */
  verifySteer?: (
    request: ControlSteerVerifyRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<ControlSteerPhaseResult>;
  /** Read-only Work-steer restart/quarantine recovery. */
  recoverSteer?: (
    request: ControlSteerRecoverRequest,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<ControlSteerPhaseResult>;
}>;

/** Provider-facing artifact phases. Browser acquisition is short-lived; the
 * adapter releases the tab actor before materializing the local byte stream. */
export type OperationBrowserArtifactPrimitive = Readonly<{
  acquireDownload: (
    request: ArtifactTransferSourceRequest & Readonly<{
      signal: AbortSignal;
      deadlineAt: number;
    }>,
    page: Readonly<PageLike>,
    target: OperationTargetBindingV1
  ) => Promise<DownloadLike>;
  materializeDownload: (download: DownloadLike) => Promise<AsyncIterable<Uint8Array>>;
}>;

export type OperationBrowserAdapterOptions = Readonly<{
  /** One immutable page captured by the caller before constructing the adapter. */
  page: Readonly<PageLike>;
  /** A context is optional, but if supplied it must bind the same page. */
  runtimeContext?: OperationRuntimeContext<PageLike>;
  owner: CoordinatorOwner;
  coordinator?: ProcessTabCoordinator;
  evidenceDigest: BrowserTargetEvidenceDigest;
  targetEvidence?: OwnershipTargetEvidence;
  /** Provider-proofed anchor evidence when the target is `new_pending`. */
  newTargetAnchorDigest?: string;
  blankTaskEvidenceDigest?: string;
  resolveTargetEvidence?: (
    request: OperationBrowserTargetProbeRequest
  ) => Promise<OperationBrowserTargetProbe> | OperationBrowserTargetProbe;
  observeCurrentTarget?: (
    request: OperationBrowserCurrentTargetRequest
  ) => Promise<OperationBrowserCurrentTargetResult> | OperationBrowserCurrentTargetResult;
  capabilities?: Partial<OperationRuntimeCapabilities>;
  authoritativeClaim?: BrowserTargetClaim;
  /** Hard upper bound for one queued/in-flight browser transaction. */
  transactionTimeoutMs?: number;
  files?: readonly OperationFileIdentity[];
  /** The callback is a keyed manifest identity function; it receives no path. */
  fileManifestDigest?: (ordinal: number, manifest: OperationFileIdentity["manifest"]) => string | Promise<string>;
  submission?: OperationBrowserSubmissionPrimitive;
  staging?: OperationBrowserStagingPrimitive;
  collector?: OperationBrowserCollectorPrimitive;
  control?: OperationBrowserControlPrimitive;
  /** Optional request-local artifact source; omitted on restart adapters. */
  artifacts?: OperationBrowserArtifactPrimitive;
  /** Absolute request-local output directory, never passed to the service. */
  outputDirectory?: string;
  /** Optional lazy, read-only hydration of one authenticated durable target. */
  recovery?: OperationBrowserRecoveryContext;
}>;

export type ComposedOperationBrowserAdapter = OperationBrowserAdapter;

/** Validate the durable prefix before an authenticated restart can touch a browser. */
export function assertAuthenticatedSendRecovery(request: AuthenticatedSendRecoveryRequest): void {
  const { target, durableBaseline: baseline } = request;
  if (!isPlainDataRecord(target) || !isSafeDataGraph(target) || !isPlainDataRecord(baseline)
    || !isSafeDataGraph(baseline) || baseline.schemaVersion !== TURN_OWNERSHIP_SCHEMA_VERSION
    || baseline.completeness !== "complete"
    || !DIGEST_PATTERN.test(baseline.snapshotDigest) || !DIGEST_PATTERN.test(request.expected.targetBindingDigest)
    || !OPAQUE_ID_PATTERN.test(request.operationId) || !OPAQUE_ID_PATTERN.test(request.actionId)
    || !DIGEST_PATTERN.test(request.requestDigest)) throw new OperationBrowserAdapterError("target_binding_mismatch");
  compareRecoveredIdentity(baseline.target.provider, target.providerId);
  compareRecoveredIdentity(baseline.target.browser, target.browserId);
  compareRecoveredIdentity(baseline.target.tab, target.tabId);
  if (baseline.target.coordinationScope !== target.coordinationScope) throw new OperationBrowserAdapterError("target_binding_mismatch");
  if (target.targetLifecycle === "new_pending" || target.targetLifecycle === "new_established") {
    if (!DIGEST_PATTERN.test(target.newTargetAnchorDigest ?? "") || !DIGEST_PATTERN.test(target.blankTaskEvidenceDigest ?? "")
      || (target.targetLifecycle === "new_pending" && (target.conversationId !== undefined || target.canonicalThreadUrl !== undefined))
      || (target.targetLifecycle === "new_established" && (target.targetEstablishment?.causalSendActionId !== request.actionId
        || target.targetEstablishment.anchorDigest !== target.newTargetAnchorDigest))
      || baseline.userTurns.length !== 0 || baseline.assistantTurns.length !== 0
      || [baseline.target.thread, baseline.target.conversation, baseline.target.canonicalThreadUrl].some(identity => identity.status === "available")) {
      throw new OperationBrowserAdapterError("target_binding_mismatch");
    }
  } else {
    compareRecoveredIdentity(baseline.target.conversation, target.conversationId);
    compareRecoveredIdentity(baseline.target.canonicalThreadUrl, target.canonicalThreadUrl);
  }
}

/** A separate observe-only path; no activation/staging/file/control ports are accepted. */
export async function recoverAuthenticatedBrowserSend(
  request: AuthenticatedSendRecoveryRequest,
  options: Pick<OperationBrowserAdapterOptions, "page" | "owner" | "coordinator" | "evidenceDigest" | "capabilities" | "authoritativeClaim" | "observeCurrentTarget" | "transactionTimeoutMs"> & Readonly<{ sendObservers: SendOnceObservers }>
): Promise<SubmissionFinalTransactionResult> {
  try {
    assertAuthenticatedSendRecovery(request);
    if (options.observeCurrentTarget === undefined || request.signal?.aborted || (request.deadlineAt !== undefined && Date.now() >= request.deadlineAt)) {
      return { status: "blocked", blockerCode: "target_evidence_unavailable" };
    }
    const coordinator = options.coordinator ?? getProcessTabCoordinator();
    const observed = await coordinator.withBrowserAcquisition(createBrowserResourceKey(request.target.providerId, request.target.browserId), {
      owner: { ...options.owner, operationId: request.operationId }, priority: "read",
      ...(request.signal === undefined ? {} : { signal: request.signal }), timeoutMs: Math.max(1, Math.min(options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS,
        (request.deadlineAt ?? Number.MAX_SAFE_INTEGER) - Date.now())), label: "operation-authenticated-send-recovery"
    }, async acquisition => {
      const current = normalizeCurrentTargetResult(await options.observeCurrentTarget!({
        operationId: request.operationId, page: options.page, target: request.target,
        signal: acquisition.signal,
        ...(request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt })
      }));
      await assertRecoveredTargetIdentity(request.target, current, options, true);
      return current;
    });
    // A pending binding is rebuilt only from its authenticated blank baseline,
    // never from the conversation currently displayed after the uncertain Send.
    const binding = await bindBrowserTargetAsync({
      page: options.page, evidence: request.target.targetLifecycle === "new_established" ? observed.evidence : request.durableBaseline.target,
      ...(request.target.targetLifecycle === "new_pending" ? {
        targetLifecycle: "new_pending", newTargetAnchorDigest: request.target.newTargetAnchorDigest!,
        blankTaskEvidenceDigest: request.target.blankTaskEvidenceDigest!
      } : {}),
      ...(options.authoritativeClaim === undefined ? {} : { authoritativeClaim: options.authoritativeClaim }),
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
      evidenceDigest: options.evidenceDigest, owner: { ...options.owner, operationId: request.operationId },
      coordinator
    });
    binding.assertCurrent(observed.evidence, observed.authoritativeClaim, true);
    const linked = createLinkedAbortController(request.signal);
    try {
      const send = createPhaseSendObservers(binding, request.operationId, options.sendObservers, linked.controller,
        options.observeCurrentTarget, options.evidenceDigest, options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS);
      return await recoverSendOnce({ ...request, page: options.page, observers: send.observers, signal: linked.controller.signal });
    } finally { linked.cleanup(); }
  } catch {
    return { status: "blocked", blockerCode: "target_binding_mismatch" };
  }
}

type Binding = BrowserTargetBinding<PageLike>;
type CachedContext = OperationCollectorContext;

const DIGEST_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,512}$/u;
const OPAQUE_THREAD_URL_PATTERN = /^https:\/\/opaque\.invalid\/thread\/[0-9a-f]{64}$/u;
const CLAIM_EVIDENCE_DIGEST_DOMAIN = "codex-chatgpt-control/tab-claim-evidence/v1";
const MAX_DEADLINE_AT = Date.UTC(2100, 0, 1);
const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;
const MAX_TRANSACTION_TIMEOUT_MS = 120_000;

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/")
    || /^[A-Za-z]:[\\/]/u.test(value)
    || value.startsWith("\\\\");
}

/**
 * Build the operation browser adapter over one captured page.
 *
 * The adapter is deliberately a composition layer: journal persistence stays
 * in OperationService, browser observations are supplied by narrow injected
 * primitives (or the conservative browser-observation default), and every
 * non-repeatable call is made at one explicit site.  No method reads
 * RuntimeEnv.page and no method retries a browser mutation.
 */
export function createOperationBrowserAdapter(
  options: OperationBrowserAdapterOptions
): ComposedOperationBrowserAdapter {
  options = normalizeAdapterOptions(options);
  const page = options.page;
  const runtimeCapture = options.runtimeContext?.capture();
  if (runtimeCapture !== undefined && runtimeCapture.page !== page) {
    throw new OperationBrowserAdapterError("page_affinity_mismatch");
  }
  const coordinator = options.coordinator ?? getProcessTabCoordinator();
  const transactionTimeoutMs = options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS;
  const bindings = new Map<string, BrowserTargetBinding<PageLike>>();
  const collectorContexts = new Map<string, CachedContext>();
  let recoveryPromise: Promise<BrowserTargetBinding<PageLike>> | undefined;

  const ensureRecovered = async (
    operationId: string,
    requestDigest: string,
    surface: OperationSurface,
    signal: AbortSignal
  ): Promise<BrowserTargetBinding<PageLike>> => {
    const recovery = options.recovery;
    if (recovery === undefined) {
      throw new OperationBrowserAdapterError("target_binding_mismatch");
    }
    assertNativeAbortSignal(signal);
    if (
      operationId !== recovery.operationId
      || requestDigest !== recovery.requestDigest
      || surface !== recovery.surface
    ) {
      throw new OperationBrowserAdapterError("target_binding_mismatch");
    }
    recoveryPromise ??= hydrateRecoveredTarget(options, recovery, page, coordinator);
    const binding = await recoveryPromise;
    bindings.set(recovery.operationId, binding);
    return binding;
  };

  const resolveTarget = async (request: OperationTargetResolutionRequest): Promise<OperationTargetResolution> => {
    if (options.recovery !== undefined) {
      try {
        const binding = await ensureRecovered(
          request.operationId,
          request.requestDigest,
          request.surface,
          request.signal
        );
        return Object.freeze({ target: binding.target });
      } catch (error) {
        if (error instanceof OperationBrowserAdapterError) throw error;
        throw new OperationBrowserAdapterError(errorCode(error));
      }
    }
    let probe: OperationBrowserTargetProbe;
    try {
      probe = await resolveProbe(options, request);
      assertProbePage(page, probe.page);
      if (request.target.type === "new") {
        if (probe.targetLifecycle !== undefined && probe.targetLifecycle !== "new_pending") {
          throw new OperationBrowserAdapterError("target_binding_mismatch");
        }
      } else if (probe.targetLifecycle === "new_pending") {
        throw new OperationBrowserAdapterError("target_binding_mismatch");
      }
      assertStaticTarget(request.target, probe.evidence, options.resolveTargetEvidence !== undefined);
      if (runtimeCapture !== undefined) {
        assertRuntimeAffinity(runtimeCapture, page, probe);
      }
      const owner = Object.freeze({
        ...options.owner,
        operationId: request.operationId
      });
      const input: BrowserTargetBindingInput = {
        page,
        evidence: probe.evidence,
        ...(request.target.type === "new"
          ? { targetLifecycle: "new_pending" as const }
          : probe.targetLifecycle === undefined ? {} : { targetLifecycle: probe.targetLifecycle }),
        ...((probe.newTargetAnchorDigest ?? options.newTargetAnchorDigest) === undefined
          ? {}
          : { newTargetAnchorDigest: probe.newTargetAnchorDigest ?? options.newTargetAnchorDigest }),
        ...((probe.blankTaskEvidenceDigest ?? options.blankTaskEvidenceDigest) === undefined
          ? {}
          : { blankTaskEvidenceDigest: probe.blankTaskEvidenceDigest ?? options.blankTaskEvidenceDigest }),
        ...(probe.authoritativeClaim === undefined ? {} : { authoritativeClaim: probe.authoritativeClaim }),
        capabilities: {
          ...(options.capabilities ?? {}),
          ...(probe.capabilities ?? {})
        },
        evidenceDigest: options.evidenceDigest,
        owner,
        coordinator
      };
      const binding = await bindBrowserTargetAsync(input);
      const previous = bindings.get(request.operationId);
      if (previous !== undefined && canonicalJson(previous.target) !== canonicalJson(binding.target)) {
        throw new OperationBrowserAdapterError("target_binding_mismatch");
      }
      bindings.set(request.operationId, binding);
      return Object.freeze({ target: binding.target });
    } catch (error) {
      if (error instanceof OperationBrowserAdapterError) throw error;
      throw new OperationBrowserAdapterError(errorCode(error));
    }
  };

  const observeStaging = async (request: SubmissionStageRequest): Promise<SubmissionStageObservation> => {
    const binding = bindingFor(bindings, request.operationId, request.targetBindingDigest);
    if (binding === undefined) return unavailableStage("target");
    try {
      return await runReadTransaction(binding, request.operationId, async context => {
        if (options.submission?.observeStaging === undefined) return unavailableStage("unknown");
        return await options.submission.observeStaging(request, context.page, context.target);
      }, options.observeCurrentTarget, options.evidenceDigest, { timeoutMs: transactionTimeoutMs });
    } catch {
      return unavailableStage("target");
    }
  };

  const executeFileHandoffOnce = async (request: SubmissionHandoffRequest): Promise<SubmissionHandoffResult> => {
    const binding = bindingFor(bindings, request.operationId, request.targetBindingDigest);
    if (binding === undefined) return { status: "not_satisfied", blockerCode: "target_binding_mismatch" };
    const files = await matchFileManifest(options.files, options.fileManifestDigest, request.manifest);
    if (files === undefined || options.submission?.handoffFiles === undefined) {
      return { status: "not_satisfied", blockerCode: "attachment_manifest_mismatch" };
    }

    // Target proof gets its own short read transaction. Hashing/revalidation
    // stays outside the actor, so a large file cannot monopolize the tab.
    try {
      await runReadTransaction(
        binding,
        request.operationId,
        async () => undefined,
        options.observeCurrentTarget,
        options.evidenceDigest,
        boundedRequest(request.signal, request.deadlineAt, transactionTimeoutMs, "operation-file-handoff-target")
      );
      for (const identity of files) {
        if (request.signal?.aborted || request.deadlineAt !== undefined && Date.now() >= request.deadlineAt) {
          // A durable file-handoff intent already exists by the time this port
          // is called.  Even a cancellation before the provider mutation is
          // therefore observation-only; never let a caller retry the handoff.
          return { status: "uncertain", quarantine: "caller" };
        }
        try {
          await revalidateOperationFile(identity);
        } catch {
          return { status: "not_satisfied", blockerCode: "input_file_changed" };
        }
      }
      if (request.signal?.aborted || request.deadlineAt !== undefined && Date.now() >= request.deadlineAt) {
        return { status: "uncertain", quarantine: "caller" };
      }
      // This is the sole file-handoff mutation site. There is no catch/retry
      // branch that invokes handoffFiles a second time.
      return await runMutationTransaction(
        binding,
        request.operationId,
        async context => {
          const providerRequest = Object.freeze({
            ...request,
            signal: context.acquisition.signal,
            ...(context.acquisition.timing.deadlineAt === undefined
              ? (request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt })
              : { deadlineAt: context.acquisition.timing.deadlineAt })
          });
          const result = await options.submission!.handoffFiles!(providerRequest, files, context.page, context.target);
          // A provider may finish with a success-looking acknowledgement after
          // the coordinator has already aborted its in-flight mutation.  The
          // acknowledgement is no longer safe to treat as exact; recovery must
          // observe the live attachment surface and may not repeat the handoff.
          return context.acquisition.signal.aborted
            ? { status: "uncertain", quarantine: "caller" }
            : result;
        },
        options.observeCurrentTarget,
        options.evidenceDigest,
        boundedRequest(request.signal, request.deadlineAt, transactionTimeoutMs, "operation-file-handoff", "mutation")
      );
    } catch {
      return request.signal?.aborted || request.deadlineAt !== undefined && Date.now() >= request.deadlineAt
        ? { status: "uncertain", quarantine: "caller" }
        : { status: "uncertain", quarantine: "provider" };
    }
  };

  const observeAttachments = async (request: SubmissionAttachmentRequest): Promise<SubmissionAttachmentObservation> => {
    const binding = bindingFor(bindings, request.operationId, request.targetBindingDigest);
    if (binding === undefined) return { status: "unavailable" };
    try {
      return await runReadTransaction(binding, request.operationId, async context => {
        if (options.submission?.observeAttachments === undefined) return { status: "unavailable" };
        return await options.submission.observeAttachments(request, context.page, context.target);
      }, options.observeCurrentTarget, options.evidenceDigest, { timeoutMs: transactionTimeoutMs });
    } catch {
      return { status: "unavailable" };
    }
  };

  /**
   * Send's four phase ports deliberately share only an operation-local abort
   * controller.  The controller is linked to both the caller and whichever
   * coordinator transaction is currently executing.  This lets the provider
   * see the coordinator's cancellation without making the durable service
   * aware of a page, actor, or bridge object.
   */
  const prepareSend = async (request: SubmissionPrepareSendRequest): Promise<SubmissionPrepareSendResult> => {
    const binding = bindingFor(bindings, request.operationId, request.expected.targetBindingDigest);
    if (binding === undefined) return blockedPrepareSend("target_binding_mismatch");
    const baseObservers = options.submission?.sendObservers;
    if (baseObservers === undefined) return blockedPrepareSend("target_evidence_unavailable");

    const linked = createLinkedAbortController(request.signal);
    const send = createPhaseSendObservers(
      binding,
      request.operationId,
      baseObservers,
      linked.controller,
      options.observeCurrentTarget,
      options.evidenceDigest,
      transactionTimeoutMs
    );
    try {
      const result = await prepareSendOnce({
        page,
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        surface: request.surface,
        actionId: request.actionId,
        expected: request.expected,
        observers: send.observers,
        signal: linked.controller.signal,
        ...(request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt }),
        transaction: callback => runSendTransaction(
          binding,
          request.operationId,
          linked.controller,
          options.observeCurrentTarget,
          options.evidenceDigest,
          request.deadlineAt,
          transactionTimeoutMs,
          "operation-send-prepare",
          "read",
          context => send.withContext(context, callback)
        )
      });
      if (result.status === "blocked") return resultToPrepareSend(result.result);
      try {
        return {
          status: "prepared",
          prepared: submissionPreparedFromSendOnce(result.prepared, request.expected)
        };
      } catch {
        return blockedPrepareSend("port_protocol_violation");
      }
    } catch {
      return blockedPrepareSend(phaseBlocker(linked.controller.signal, request.deadlineAt));
    } finally {
      linked.cleanup();
    }
  };

  const executePreparedSend = async (
    request: SubmissionExecutePreparedSendRequest
  ): Promise<SubmissionExecutePreparedSendResult> => {
    const binding = bindingFor(bindings, request.operationId, request.expected.targetBindingDigest);
    if (binding === undefined) return blockedExecuteSend("target_binding_mismatch");
    const baseObservers = options.submission?.sendObservers;
    if (baseObservers === undefined) return blockedExecuteSend("target_evidence_unavailable");

    let prepared: SubmissionPreparedSend;
    try {
      prepared = normalizeSubmissionPreparedSend(request.prepared, request.expected, {
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        surface: request.surface,
        actionId: request.actionId
      });
    } catch {
      return blockedExecuteSend("port_protocol_violation");
    }

    const linked = createLinkedAbortController(request.signal);
    const send = createPhaseSendObservers(
      binding,
      request.operationId,
      baseObservers,
      linked.controller,
      options.observeCurrentTarget,
      options.evidenceDigest,
      transactionTimeoutMs
    );
    try {
      const result = await executePreparedSendOnce({
        page,
        prepared: prepared.prepared as SendOncePrepared,
        observers: send.observers,
        signal: linked.controller.signal,
        ...(request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt }),
        transaction: callback => runSendTransaction(
          binding,
          request.operationId,
          linked.controller,
          options.observeCurrentTarget,
          options.evidenceDigest,
          request.deadlineAt,
          transactionTimeoutMs,
          "operation-send-execute",
          "mutation",
          context => send.withContext(context, callback)
        )
      });
      if (result.status === "blocked" || result.status === "uncertain") return result;
      return {
        status: result.status,
        activation: result.activation,
        mutationMayHaveOccurred: true
      };
    } catch {
      return {
        status: "uncertain",
        result: { status: "uncertain", quarantine: "caller" }
      };
    } finally {
      linked.cleanup();
    }
  };

  const verifyPreparedSend = async (
    request: SubmissionVerifyPreparedSendRequest
  ): Promise<SubmissionFinalTransactionResult> => {
    const binding = bindingFor(bindings, request.operationId, request.expected.targetBindingDigest);
    if (binding === undefined) return { status: "blocked", blockerCode: "target_binding_mismatch" };
    const baseObservers = options.submission?.sendObservers;
    if (baseObservers === undefined) return { status: "uncertain", quarantine: "provider" };

    let prepared: SubmissionPreparedSend;
    try {
      prepared = normalizeSubmissionPreparedSend(request.prepared, request.expected, {
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        surface: request.surface,
        actionId: request.actionId
      });
    } catch {
      return { status: "uncertain", quarantine: "caller" };
    }

    const linked = createLinkedAbortController(request.signal);
    const send = createPhaseSendObservers(
      binding,
      request.operationId,
      baseObservers,
      linked.controller,
      options.observeCurrentTarget,
      options.evidenceDigest,
      transactionTimeoutMs
    );
    try {
      const result = await verifyPreparedSendOnce({
        page,
        prepared: prepared.prepared as SendOncePrepared,
        observers: send.observers,
        activation: request.activation,
        mutationMayHaveOccurred: request.mutationMayHaveOccurred,
        signal: linked.controller.signal,
        ...(request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt })
      });
      markEstablished(binding, result);
      return result;
    } catch {
      return { status: "uncertain", quarantine: "caller" };
    } finally {
      linked.cleanup();
    }
  };

  const recoverSend = async (
    request: SubmissionRecoverSendRequest
  ): Promise<SubmissionFinalTransactionResult> => {
    let binding = bindingFor(bindings, request.operationId, request.expected.targetBindingDigest);
    if (binding === undefined && options.recovery !== undefined) {
      try {
        binding = await ensureRecovered(request.operationId, request.requestDigest, request.surface, request.signal ?? options.recovery.signal);
      } catch {
        return { status: "blocked", blockerCode: "target_binding_mismatch" };
      }
    }
    if (binding === undefined) return { status: "blocked", blockerCode: "target_binding_mismatch" };
    const baseObservers = options.submission?.sendObservers;
    if (baseObservers === undefined) return { status: "uncertain", quarantine: "provider" };

    const linked = createLinkedAbortController(request.signal);
    const send = createPhaseSendObservers(
      binding,
      request.operationId,
      baseObservers,
      linked.controller,
      options.observeCurrentTarget,
      options.evidenceDigest,
      transactionTimeoutMs
    );
    try {
      const result = await recoverSendOnce({
        page,
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        surface: request.surface,
        actionId: request.actionId,
        expected: request.expected,
        durableBaseline: request.durableBaseline,
        observers: send.observers,
        signal: linked.controller.signal,
        ...(request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt })
      });
      markEstablished(binding, result);
      return result;
    } catch {
      return { status: "uncertain", quarantine: "caller" };
    } finally {
      linked.cleanup();
    }
  };

  const executeFinalTabTransaction = async (
    request: SubmissionFinalTransactionRequest
  ): Promise<SubmissionFinalTransactionResult> => {
    const binding = bindingFor(bindings, request.operationId, request.expected.targetBindingDigest);
    if (binding === undefined) {
      return { status: "blocked", blockerCode: "target_binding_mismatch" };
    }
    const baseObservers = options.submission?.sendObservers;
    if (baseObservers === undefined) return { status: "blocked", blockerCode: "target_evidence_unavailable" };

    // The precondition read is part of the short activation transaction. Each
    // postcondition probe, by contrast, reacquires the same tab actor for one
    // bounded read and releases it before SendOnce waits for the next probe.
    // The provider primitive is intentionally one-shot: it must not poll or
    // sleep while this callback owns the actor.
    const observers: SendOnceObservers = {
      observePrecondition: baseObservers.observePrecondition,
      observePostcondition: async postconditionRequest => {
        const probe = await runReadTransaction(
          binding,
          request.operationId,
          context => baseObservers.observePostcondition({
            ...postconditionRequest,
            page: context.page,
            // A probe is owned by this individual short read transaction, not
            // by the earlier activation transaction. Provider code must see
            // the current actor's cancellation/deadline so an in-flight read
            // cannot outlive its coordinator quarantine unnoticed.
            signal: context.acquisition.signal,
            ...(context.acquisition.timing.deadlineAt === undefined
              ? {}
              : { deadlineAt: context.acquisition.timing.deadlineAt })
          }),
          options.observeCurrentTarget,
          options.evidenceDigest,
          boundedRequest(
            postconditionRequest.signal,
            postconditionRequest.deadlineAt,
            transactionTimeoutMs,
            "operation-send-postcondition"
          ),
          true
        );
        // Provider observers are one-shot reads. A missing/temporarily
        // ambiguous delta is a retryable observation miss; no browser
        // mutation is ever retried here. Definitive blockers stay terminal.
        if (
          isPlainPostconditionResult(probe)
          && probe.status === "blocked"
          && (probe.blockerCode === "target_evidence_unavailable" || probe.blockerCode === "ambiguous_submit")
        ) {
          return { result: probe, retryable: true };
        }
        return probe;
      },
      ...(baseObservers.sleep === undefined ? {} : { sleep: baseObservers.sleep }),
      ...(baseObservers.maxPostconditionAttempts === undefined ? {} : { maxPostconditionAttempts: baseObservers.maxPostconditionAttempts }),
      ...(baseObservers.postconditionIntervalMs === undefined ? {} : { postconditionIntervalMs: baseObservers.postconditionIntervalMs }),
      ...(baseObservers.postconditionTimeoutMs === undefined ? {} : { postconditionTimeoutMs: baseObservers.postconditionTimeoutMs })
    };
    const operationController = new AbortController();
    const sourceAbortCleanup: (() => void)[] = [];
    if (request.signal !== undefined) {
      const abortFromCaller = (): void => operationController.abort(request.signal?.reason);
      if (request.signal.aborted) operationController.abort(request.signal.reason);
      else {
        request.signal.addEventListener("abort", abortFromCaller, { once: true });
        sourceAbortCleanup.push(() => request.signal?.removeEventListener("abort", abortFromCaller));
      }
    }
    try {
      const transaction = async <T>(callback: () => Promise<T>): Promise<T> =>
        await binding.withTabTransaction(
          boundedRequest(
            request.signal,
            request.deadlineAt,
            transactionTimeoutMs,
            request.mode === "mutate_once" ? "operation-send" : "operation-send-observe",
            request.mode === "mutate_once" ? "mutation" : "read"
          ),
          async context => {
            const abortFromCoordinator = (): void => operationController.abort(context.acquisition.signal.reason);
            if (context.acquisition.signal.aborted) operationController.abort(context.acquisition.signal.reason);
            else context.acquisition.signal.addEventListener("abort", abortFromCoordinator, { once: true });
            try {
              const current = await readCurrentTarget(
                binding,
                request.operationId,
                context.page,
                options.observeCurrentTarget,
                options.evidenceDigest,
                context.acquisition.signal,
                context.acquisition.timing.deadlineAt
              );
              binding.assertCurrent(current.evidence, current.authoritativeClaim);
              return await callback();
            } finally {
              context.acquisition.signal.removeEventListener("abort", abortFromCoordinator);
            }
          }
        );
      const result = await runSendOnce({
        page,
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        surface: request.surface,
        actionId: request.actionId,
        mode: request.mode,
        expected: request.expected,
        observers,
        signal: operationController.signal,
        ...(request.deadlineAt === undefined ? { deadlineAt: MAX_DEADLINE_AT } : { deadlineAt: request.deadlineAt }),
        ...(request.persistPreSendBaseline === undefined
          ? {}
          : { persistPreSendBaseline: request.persistPreSendBaseline }),
        ...(request.durableBaseline === undefined
          ? {}
          : { durableBaseline: request.durableBaseline }),
        transaction
      });
      if (
        binding.markTargetEstablished !== undefined
        && (result.status === "submitted" || result.status === "already_submitted")
        && result.targetEstablishment !== undefined
      ) {
        binding.markTargetEstablished({
          conversationId: result.targetEstablishment.conversationId,
          canonicalThreadUrl: result.targetEstablishment.canonicalThreadUrl
        });
      }
      return result;
    } catch {
      return request.mode === "mutate_once"
        ? { status: "uncertain", quarantine: "provider" }
        : { status: "blocked", blockerCode: "target_evidence_unavailable" };
    } finally {
      for (const cleanup of sourceAbortCleanup) cleanup();
    }
  };

  const readContext = async (request: OperationCollectorContextRequest): Promise<OperationCollectorContext> => {
    if (options.recovery !== undefined) {
      await ensureRecovered(request.operationId, request.requestDigest, options.recovery.surface, request.signal);
    }
    const binding = bindingFor(bindings, request.operationId, request.targetBindingDigest);
    if (binding === undefined) throw new OperationBrowserAdapterError("target_binding_mismatch");
    if (options.collector?.readContext === undefined) {
      throw new OperationBrowserAdapterError("unsupported_browser_primitive");
    }
    try {
      const context = await runReadTransaction(binding, request.operationId, transaction =>
        options.collector!.readContext!(request, transaction.page, transaction.target)
      , options.observeCurrentTarget, options.evidenceDigest, {
        signal: request.signal,
        timeoutMs: transactionTimeoutMs,
        label: "operation-collect-context"
      });
      collectorContexts.set(request.operationId, context);
      return context;
    } catch {
      throw new OperationBrowserAdapterError("target_evidence_unavailable");
    }
  };

  const observe = async (request: CollectorObservationRequest): Promise<CollectorObservation> => {
    if (options.recovery !== undefined) {
      await ensureRecovered(request.operationId, request.requestDigest, options.recovery.surface, request.signal);
    }
    const binding = bindingFor(bindings, request.operationId, request.targetBindingDigest);
    const context = collectorContexts.get(request.operationId);
    if (binding === undefined || context === undefined) throw new OperationBrowserAdapterError("target_binding_mismatch");
    try {
      return await binding.withTabTransaction(boundedRequest(request.signal, request.deadlineAt, transactionTimeoutMs, "operation-collect-observe"), async transaction => {
        const current = await readCurrentTarget(binding, request.operationId, transaction.page, options.observeCurrentTarget, options.evidenceDigest, transaction.acquisition.signal, transaction.acquisition.timing.deadlineAt);
        binding.assertCurrent(current.evidence, current.authoritativeClaim);
        const observation = options.collector?.observe === undefined
          ? await defaultCollectorObservation(
            request,
            transaction,
            context,
            options.evidenceDigest,
            current.authoritativeClaim
          )
          : await options.collector.observe(request, transaction.page, transaction.target, context);
        // The observation itself carries the exact target. Do not use a
        // page-wide latest turn or a prompt similarity fallback.
        binding.assertCurrent(observation.snapshot.target, current.authoritativeClaim);
        return observation;
      });
    } catch {
      throw new OperationBrowserAdapterError("target_evidence_unavailable");
    }
  };

  const sleep = async (milliseconds: number, signal: AbortSignal): Promise<void> => {
    if (options.collector?.sleep !== undefined) return await options.collector.sleep(milliseconds, signal);
    await sleepOutsideCoordinator(milliseconds, signal);
  };

  const observeTurn = async (request: ControlTurnObservationRequest): Promise<ControlTurnObservation> => {
    if (options.recovery !== undefined) {
      await ensureRecovered(request.operationId, request.parentRequestDigest, options.recovery.surface, request.signal);
    }
    const binding = bindingFor(bindings, request.operationId, request.targetBindingDigest);
    if (binding === undefined) return { status: "uncertain", reason: "target_mismatch" };
    if (options.control?.observeTurn === undefined) return { status: "uncertain", reason: "unavailable" };
    try {
      return await runReadTransaction(binding, request.operationId, transaction =>
        options.control!.observeTurn!(request, transaction.page, transaction.target)
      , options.observeCurrentTarget, options.evidenceDigest, boundedRequest(request.signal, request.deadlineAt, transactionTimeoutMs, "operation-control-observe"));
    } catch {
      return { status: "uncertain", reason: "unavailable" };
    }
  };

  const executeControlOnce = async (request: ControlExecutionRequest): Promise<ControlExecutionResult> => {
    if (options.recovery !== undefined) {
      await ensureRecovered(request.operationId, request.parentRequestDigest, options.recovery.surface, request.signal);
    }
    const binding = bindingFor(bindings, request.operationId, request.targetBindingDigest);
    if (binding === undefined) return { status: "uncertain", blockerCode: "target_binding_mismatch" };
    if (options.control?.executeOnce === undefined) return { status: "uncertain", blockerCode: "send_control_unavailable" };
    try {
      return await binding.withTabTransaction(boundedRequest(request.signal, request.deadlineAt, transactionTimeoutMs, `operation-${request.action}`, "control"), async transaction =>
        await (async () => {
          const current = await readCurrentTarget(binding, request.operationId, transaction.page, options.observeCurrentTarget, options.evidenceDigest, transaction.acquisition.signal, transaction.acquisition.timing.deadlineAt);
          binding.assertCurrent(current.evidence, current.authoritativeClaim);
          return await options.control!.executeOnce!(request, transaction.page, transaction.target);
        })()
      );
    } catch {
      return { status: "uncertain", blockerCode: "send_control_unavailable" };
    }
  };

  const observePostcondition = async (request: ControlPostconditionRequest): Promise<ControlPostconditionObservation> => {
    if (options.recovery !== undefined) {
      await ensureRecovered(request.operationId, request.parentRequestDigest, options.recovery.surface, request.signal);
    }
    const binding = bindingFor(bindings, request.operationId, request.targetBindingDigest);
    if (binding === undefined) return { status: "uncertain", blockerCode: "target_binding_mismatch" };
    if (options.control?.observePostcondition === undefined) return { status: "uncertain", blockerCode: "send_control_unavailable" };
    try {
      return await runReadTransaction(binding, request.operationId, transaction =>
        options.control!.observePostcondition!(request, transaction.page, transaction.target)
      , options.observeCurrentTarget, options.evidenceDigest, boundedRequest(request.signal, request.deadlineAt, transactionTimeoutMs, "operation-control-postcondition"));
    } catch {
      return { status: "uncertain", blockerCode: "send_control_unavailable" };
    }
  };

  const getSteerBinding = async (
    operationId: string,
    requestDigest: string,
    signal: AbortSignal
  ): Promise<Binding | undefined> => await steerBindingFor(
    bindings,
    ensureRecovered,
    options.recovery,
    operationId,
    requestDigest,
    signal
  );

  /**
   * Work steer is deliberately separate from Stop's compatibility port.  A
   * preparation is one short read transaction and returns only the provider's
   * prompt-free prepared capability.  The caller persists that capability and
   * its baseline before it can invoke executeSteerPrepared.
   */
  const prepareSteer = async (request: ControlSteerPrepareRequest): Promise<ControlSteerPhaseResult> => {
    const binding = await getSteerBinding(request.parentOperationId, request.parentRequestDigest, request.signal);
    if (binding === undefined) return blockedSteerPhase(request, "prepare", "target_binding_mismatch", false, "none");
    const provider = options.control?.prepareSteer;
    if (provider === undefined) return blockedSteerPhase(request, "prepare", "backend_unavailable", true, "none");
    try {
      const result = await runReadTransaction(
        binding,
        request.parentOperationId,
        context => provider({
          schemaVersion: request.schemaVersion,
          parentOperationId: request.parentOperationId,
          parentRequestDigest: request.parentRequestDigest,
          parentTargetBindingDigest: request.parentTargetBindingDigest,
          controlActionId: request.controlActionId,
          requestDigest: request.requestDigest,
          expectedAssistantTurnId: request.expectedAssistantTurnId,
          signal: context.acquisition.signal,
          deadlineAt: context.acquisition.timing.deadlineAt ?? request.deadlineAt
        }, context.page, context.target),
        options.observeCurrentTarget,
        options.evidenceDigest,
        boundedRequest(
          request.signal,
          request.deadlineAt,
          transactionTimeoutMs,
          "operation-control-steer-prepare"
        )
      );
      return normalizeSteerProviderResult(result, request, "prepare");
    } catch (error) {
      return blockedSteerPhase(
        request,
        "prepare",
        phaseFailureCode(request.signal, request.deadlineAt, error),
        true,
        "none"
      );
    }
  };

  /**
   * Execute is the only Work-steer mutation site.  `runSteerControlTransaction`
   * keeps the callback promise alive until provider settlement even when the
   * coordinator has already rejected the public transaction at its deadline.
   * That quarantine is what prevents a late fill/click from overlapping a
   * subsequent operation on the shared page.
   */
  const executeSteerPrepared = async (
    request: ControlSteerExecutePreparedRequest
  ): Promise<ControlSteerPhaseResult> => {
    const operationId = request.prepared.parentOperationId;
    const binding = await getSteerBinding(operationId, request.prepared.parentRequestDigest, request.signal);
    if (binding === undefined) return blockedSteerPhase(request, "execute_prepared", "target_binding_mismatch", false, "none");
    const provider = options.control?.executeSteerPrepared;
    if (provider === undefined) return blockedSteerPhase(request, "execute_prepared", "backend_unavailable", false, "none", request.prepared);
    try {
      const result = await runSteerControlTransaction(
        binding,
        operationId,
        request.signal,
        request.deadlineAt,
        transactionTimeoutMs,
        options.observeCurrentTarget,
        options.evidenceDigest,
        context => provider({
          schemaVersion: request.schemaVersion,
          prepared: request.prepared,
          signal: context.acquisition.signal,
          deadlineAt: context.acquisition.timing.deadlineAt ?? request.deadlineAt
        }, context.page, context.target)
      );
      return normalizeSteerProviderResult(result, request, "execute_prepared", request.prepared);
    } catch (error) {
      return uncertainSteerPhase(
        request,
        "execute_prepared",
        request.prepared,
        phaseFailureCode(request.signal, request.deadlineAt, error),
        "provider"
      );
    }
  };

  /** Verification is a bounded read and releases the tab actor before any
   * caller-level retry or persistence work. */
  const verifySteer = async (request: ControlSteerVerifyRequest): Promise<ControlSteerPhaseResult> => {
    const operationId = request.prepared.parentOperationId;
    const binding = await getSteerBinding(operationId, request.prepared.parentRequestDigest, request.signal);
    if (binding === undefined) return uncertainSteerPhase(request, "verify", request.prepared, "target_binding_mismatch", "caller");
    const provider = options.control?.verifySteer;
    if (provider === undefined) return uncertainSteerPhase(request, "verify", request.prepared, "backend_unavailable", "provider");
    try {
      const result = await runReadTransaction(
        binding,
        operationId,
        context => provider({
          schemaVersion: request.schemaVersion,
          prepared: request.prepared,
          signal: context.acquisition.signal,
          deadlineAt: context.acquisition.timing.deadlineAt ?? request.deadlineAt
        }, context.page, context.target),
        options.observeCurrentTarget,
        options.evidenceDigest,
        boundedRequest(request.signal, request.deadlineAt, transactionTimeoutMs, "operation-control-steer-verify")
      );
      return normalizeSteerProviderResult(result, request, "verify", request.prepared);
    } catch (error) {
      return uncertainSteerPhase(
        request,
        "verify",
        request.prepared,
        phaseFailureCode(request.signal, request.deadlineAt, error),
        "caller"
      );
    }
  };

  /**
   * Recovery is observation-only.  It may hydrate a durable target binding,
   * but it never calls prepare, execute, composer fill, or Send/click.
   */
  const recoverSteer = async (request: ControlSteerRecoverRequest): Promise<ControlSteerPhaseResult> => {
    const operationId = request.prepared.parentOperationId;
    const binding = await getSteerBinding(operationId, request.prepared.parentRequestDigest, request.signal);
    if (binding === undefined) return uncertainSteerPhase(request, "recovery", request.prepared, "target_binding_mismatch", "caller");
    const provider = options.control?.recoverSteer;
    if (provider === undefined) return uncertainSteerPhase(request, "recovery", request.prepared, "backend_unavailable", "provider");
    try {
      const result = await runReadTransaction(
        binding,
        operationId,
        context => provider({
          schemaVersion: request.schemaVersion,
          prepared: request.prepared,
          baseline: request.baseline,
          signal: context.acquisition.signal,
          deadlineAt: context.acquisition.timing.deadlineAt ?? request.deadlineAt
        }, context.page, context.target),
        options.observeCurrentTarget,
        options.evidenceDigest,
        boundedRequest(request.signal, request.deadlineAt, transactionTimeoutMs, "operation-control-steer-recovery")
      );
      return normalizeSteerProviderResult(result, request, "recovery", request.prepared);
    } catch (error) {
      return uncertainSteerPhase(
        request,
        "recovery",
        request.prepared,
        phaseFailureCode(request.signal, request.deadlineAt, error),
        "caller"
      );
    }
  };

  const submission: OperationSubmissionAdapter = Object.freeze({
    observeStaging,
    executeFileHandoffOnce,
    observeAttachments,
    prepareSend,
    executePreparedSend,
    verifyPreparedSend,
    recoverSend,
    executeFinalTabTransaction
  });
  const collector: OperationCollectorAdapter = Object.freeze({ readContext, observe, sleep });
  const control: OperationControlAdapter | undefined = options.control === undefined
    ? undefined
    : Object.freeze({
        observeTurn,
        executeOnce: executeControlOnce,
        observePostcondition,
        postconditionRetry: CONTROL_POSTCONDITION_RETRY_POLICY,
        prepareSteer,
        executeSteerPrepared,
        verifySteer,
        recoverSteer
      }) as OperationControlAdapter;
  const staging: OperationStagingAdapter | undefined = options.staging === undefined
    ? undefined
    : Object.freeze({
        readCurrent: async (callbackRequest: OperationStagingCallbackRequest) => {
          const binding = bindings.get(callbackRequest.operationId);
          if (binding === undefined) return unavailableStagingObservation(callbackRequest);
          return await runReadTransaction(binding, callbackRequest.operationId, transaction =>
            options.staging!.readCurrent === undefined
              ? unavailableStagingObservation(callbackRequest)
              : options.staging!.readCurrent({ ...callbackRequest, page: transaction.page, target: transaction.target, signal: transaction.acquisition.signal, deadlineAt: transaction.acquisition.timing.deadlineAt ?? callbackRequest.deadlineAt })
          , options.observeCurrentTarget, options.evidenceDigest, boundedRequest(callbackRequest.signal, callbackRequest.deadlineAt, transactionTimeoutMs, "operation-staging-read"));
        },
        observe: async (callbackRequest: OperationStagingCallbackRequest) => {
          const binding = bindings.get(callbackRequest.operationId);
          if (binding === undefined) return unavailableStagingObservation(callbackRequest);
          return await runReadTransaction(binding, callbackRequest.operationId, transaction =>
            options.staging!.observe === undefined
              ? unavailableStagingObservation(callbackRequest)
              : options.staging!.observe({ ...callbackRequest, page: transaction.page, target: transaction.target, signal: transaction.acquisition.signal, deadlineAt: transaction.acquisition.timing.deadlineAt ?? callbackRequest.deadlineAt })
          , options.observeCurrentTarget, options.evidenceDigest, boundedRequest(callbackRequest.signal, callbackRequest.deadlineAt, transactionTimeoutMs, "operation-staging-observe"));
        },
        mutateOnce: async (callbackRequest: OperationStagingCallbackRequest) => {
          const binding = bindings.get(callbackRequest.operationId);
          if (binding === undefined) throw new OperationBrowserAdapterError("target_binding_mismatch");
          return await runMutationTransaction(binding, callbackRequest.operationId, transaction =>
            options.staging!.mutateOnce === undefined
              ? Promise.reject(new OperationBrowserAdapterError("unsupported_browser_primitive"))
              : options.staging!.mutateOnce({ ...callbackRequest, page: transaction.page, target: transaction.target, signal: transaction.acquisition.signal, deadlineAt: transaction.acquisition.timing.deadlineAt ?? callbackRequest.deadlineAt })
          , options.observeCurrentTarget, options.evidenceDigest, boundedRequest(callbackRequest.signal, callbackRequest.deadlineAt, transactionTimeoutMs, "operation-staging-mutate", "mutation"));
        }
      });
  const artifacts = options.artifacts === undefined || options.outputDirectory === undefined
    ? undefined
    : Object.freeze({
        transfer: async (request: import("./service.js").OperationArtifactTransferRequest) => {
          const binding = bindingFor(bindings, request.operationId, request.targetBindingDigest);
          if (binding === undefined) {
            throw new OperationBrowserAdapterError("target_binding_mismatch");
          }
          // `acquireDownload` is the only browser phase. Its promise is fully
          // settled before this callback invokes `materializeDownload`, so a
          // large stream or filesystem commit never owns the tab actor.
          return await transferOperationArtifact({
            operationId: request.operationId,
            requestDigest: request.requestDigest,
            targetBindingDigest: request.targetBindingDigest,
            assistantTurnId: request.assistantTurnId,
            sourceIdentityDigest: request.sourceIdentityDigest,
            kind: request.kind,
            ordinal: request.ordinal,
            transferActionId: request.transferActionId,
            outputDirectory: options.outputDirectory!,
            evidenceDigest: options.evidenceDigest,
            signal: request.signal,
            deadlineAt: request.deadlineAt,
            ...(request.mimeTypeHint === undefined ? {} : { mimeTypeHint: request.mimeTypeHint }),
            openSource: async sourceRequest => {
              const download = await runMutationTransaction(
                binding,
                request.operationId,
                context => options.artifacts!.acquireDownload({
                  ...sourceRequest,
                  signal: request.signal,
                  deadlineAt: request.deadlineAt
                }, context.page, context.target),
                options.observeCurrentTarget,
                options.evidenceDigest,
                boundedRequest(
                  request.signal,
                  request.deadlineAt,
                  transactionTimeoutMs,
                  "operation-artifact-acquire",
                  "mutation"
                )
              );
              // The transaction above has released the actor. This local
              // phase must never call into the page or browser bridge.
              return await options.artifacts!.materializeDownload(download);
            },
            journal: request.journal
          });
        }
      });
  const adapter: ComposedOperationBrowserAdapter = Object.freeze({
    resolveTarget,
    submission,
    collector,
    ...(artifacts === undefined ? {} : { artifacts }),
    ...(staging === undefined ? {} : { staging }),
    ...(control === undefined ? {} : { control }),
  });
  return adapter;
}

function normalizeAdapterOptions(value: unknown): OperationBrowserAdapterOptions {
  if (!isPlainDataRecord(value)) throw new OperationBrowserAdapterError("adapter_incomplete");
  try {
    const page = readOwnData(value, "page");
    const runtimeContext = readOwnData(value, "runtimeContext");
    const owner = readOwnData(value, "owner");
    const coordinator = readOwnData(value, "coordinator");
    const evidenceDigest = readOwnData(value, "evidenceDigest");
    const targetEvidence = readOwnData(value, "targetEvidence");
    const newTargetAnchorDigest = readOwnData(value, "newTargetAnchorDigest");
    const blankTaskEvidenceDigest = readOwnData(value, "blankTaskEvidenceDigest");
    const resolveTargetEvidence = readOwnData(value, "resolveTargetEvidence");
    const observeCurrentTarget = readOwnData(value, "observeCurrentTarget");
    const capabilities = readOwnData(value, "capabilities");
    const authoritativeClaim = readOwnData(value, "authoritativeClaim");
    const transactionTimeoutMs = readOwnData(value, "transactionTimeoutMs");
    const files = readOwnData(value, "files");
    const fileManifestDigest = readOwnData(value, "fileManifestDigest");
    const submission = readOwnData(value, "submission");
    const staging = readOwnData(value, "staging");
    const collector = readOwnData(value, "collector");
    const control = readOwnData(value, "control");
    const artifacts = readOwnData(value, "artifacts");
    const outputDirectory = readOwnData(value, "outputDirectory");
    const recovery = readOwnData(value, "recovery");
    const normalizedRecovery = recovery === undefined
      ? undefined
      : (() => {
        validateRecoveryContext(recovery);
        return normalizeRecoveryContext(recovery);
      })();
    const snapshot: Record<string, unknown> = {
      page,
      runtimeContext,
      owner: cloneFrozenData(owner),
      coordinator,
      evidenceDigest,
      targetEvidence: targetEvidence === undefined ? undefined : cloneFrozenData(targetEvidence),
      newTargetAnchorDigest,
      blankTaskEvidenceDigest,
      resolveTargetEvidence,
      observeCurrentTarget,
      capabilities: capabilities === undefined ? undefined : cloneFrozenData(capabilities),
      authoritativeClaim: authoritativeClaim === undefined ? undefined : cloneFrozenData(authoritativeClaim),
      transactionTimeoutMs,
      files: files === undefined ? undefined : cloneFrozenData(files),
      fileManifestDigest,
      submission: submission === undefined ? undefined : cloneFrozenProviderValue(submission),
      staging: staging === undefined ? undefined : cloneFrozenProviderValue(staging),
      collector: collector === undefined ? undefined : cloneFrozenProviderValue(collector),
      control: control === undefined ? undefined : cloneFrozenProviderValue(control),
      artifacts: artifacts === undefined ? undefined : cloneFrozenProviderValue(artifacts),
      outputDirectory,
      recovery: normalizedRecovery
    };
    const normalized = Object.freeze(snapshot) as OperationBrowserAdapterOptions;
    validateOptions(normalized);
    return normalized;
  } catch (error) {
    if (error instanceof OperationBrowserAdapterError) throw error;
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
}

function validateOptions(options: OperationBrowserAdapterOptions): void {
  if (!isPlainDataRecord(options) || options.page === null || typeof options.page !== "object") {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  if (typeof options.evidenceDigest !== "function") throw new OperationBrowserAdapterError("adapter_incomplete");
  if (!options.owner || typeof options.owner.backendSessionId !== "string") throw new OperationBrowserAdapterError("adapter_incomplete");
  if (options.runtimeContext !== undefined && !(options.runtimeContext instanceof OperationRuntimeContext)) {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  if (options.recovery !== undefined) {
    validateRecoveryContext(options.recovery);
    if (options.observeCurrentTarget === undefined) {
      throw new OperationBrowserAdapterError("target_evidence_unavailable");
    }
  } else if (options.targetEvidence === undefined && options.resolveTargetEvidence === undefined) {
    throw new OperationBrowserAdapterError("target_evidence_unavailable");
  }
  if (options.files !== undefined && !Array.isArray(options.files)) throw new OperationBrowserAdapterError("adapter_incomplete");
  if (options.recovery !== undefined
    && (options.artifacts !== undefined || options.outputDirectory !== undefined)) {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  if (options.artifacts !== undefined) {
    if (!isPlainDataRecord(options.artifacts)
      || typeof readOwnData(options.artifacts, "acquireDownload") !== "function"
      || typeof readOwnData(options.artifacts, "materializeDownload") !== "function") {
      throw new OperationBrowserAdapterError("adapter_incomplete");
    }
  }
  if (options.outputDirectory !== undefined
    && (typeof options.outputDirectory !== "string"
      || options.outputDirectory.length === 0
      || options.outputDirectory.length > 4096
      || !isAbsolutePath(options.outputDirectory)
      || /[\u0000-\u001f\u007f]/u.test(options.outputDirectory))) {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  if (
    options.transactionTimeoutMs !== undefined
    && (!Number.isSafeInteger(options.transactionTimeoutMs) || options.transactionTimeoutMs < 1 || options.transactionTimeoutMs > MAX_TRANSACTION_TIMEOUT_MS)
  ) {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
}

function validateRecoveryContext(value: unknown): asserts value is OperationBrowserRecoveryContext {
  if (!isPlainDataRecord(value)) throw new OperationBrowserAdapterError("adapter_incomplete");
  if (
    readOwnData(value, "operationId") === undefined
    || readOwnData(value, "requestDigest") === undefined
    || readOwnData(value, "surface") === undefined
    || readOwnData(value, "target") === undefined
    || readOwnData(value, "signal") === undefined
  ) {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  const operationId = readOwnData(value, "operationId");
  const requestDigest = readOwnData(value, "requestDigest");
  const surface = readOwnData(value, "surface");
  const target = readOwnData(value, "target");
  const signal = readOwnData(value, "signal");
  if (
    typeof operationId !== "string"
    || !OPAQUE_ID_PATTERN.test(operationId)
    || typeof requestDigest !== "string"
    || !DIGEST_PATTERN.test(requestDigest)
    || (surface !== "chat" && surface !== "work")
    || target === null
    || typeof target !== "object"
    || Array.isArray(target)
  ) {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  assertNativeAbortSignal(signal);
  if (!isSafeDataGraph(target) || !isPlainDataRecord(target)) {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  const lifecycle = readOwnData(target, "targetLifecycle");
  if (lifecycle === "new_pending") {
    throw new OperationBrowserAdapterError("target_binding_mismatch");
  }
  if (lifecycle !== undefined && lifecycle !== "fixed" && lifecycle !== "new_established") {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  const providerId = readOwnData(target, "providerId");
  const browserId = readOwnData(target, "browserId");
  const tabId = readOwnData(target, "tabId");
  const coordinationScope = readOwnData(target, "coordinationScope");
  const evidenceProfile = readOwnData(target, "evidenceProfile");
  if (
    typeof providerId !== "string"
    || !OPAQUE_ID_PATTERN.test(providerId)
    || typeof browserId !== "string"
    || !OPAQUE_ID_PATTERN.test(browserId)
    || typeof tabId !== "string"
    || !OPAQUE_ID_PATTERN.test(tabId)
    || (coordinationScope !== "process" && coordinationScope !== "provider")
    || !isPlainDataRecord(evidenceProfile)
  ) {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  const conversationId = readOwnData(target, "conversationId");
  const canonicalThreadUrl = readOwnData(target, "canonicalThreadUrl");
  if (
    typeof conversationId !== "string"
    || !OPAQUE_ID_PATTERN.test(conversationId)
    || typeof canonicalThreadUrl !== "string"
    || !OPAQUE_THREAD_URL_PATTERN.test(canonicalThreadUrl)
  ) {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  if (lifecycle === "new_established" && !isPlainDataRecord(readOwnData(target, "targetEstablishment"))) {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  const claimDigest = readOwnData(target, "tabClaimEvidenceDigest");
  if (claimDigest !== undefined && (typeof claimDigest !== "string" || !DIGEST_PATTERN.test(claimDigest))) {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
}

function normalizeRecoveryContext(
  value: OperationBrowserRecoveryContext
): OperationBrowserRecoveryContext {
  try {
    const record = value as unknown as Record<string, unknown>;
    const operationId = readOwnData(record, "operationId");
    const requestDigest = readOwnData(record, "requestDigest");
    const surface = readOwnData(record, "surface");
    const targetValue = readOwnData(record, "target");
    const signal = readOwnData(record, "signal");
    if (targetValue === undefined || signal === undefined) throw new Error("incomplete recovery context");
    const target = cloneFrozenData(targetValue) as OperationTargetBindingV1;
    return Object.freeze({
      operationId: operationId as string,
      requestDigest: requestDigest as string,
      surface: surface as OperationSurface,
      target,
      signal: signal as AbortSignal
    });
  } catch {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
}

async function hydrateRecoveredTarget(
  options: OperationBrowserAdapterOptions,
  recovery: OperationBrowserRecoveryContext,
  page: Readonly<PageLike>,
  coordinator: ProcessTabCoordinator
): Promise<BrowserTargetBinding<PageLike>> {
  const observeCurrentTarget = options.observeCurrentTarget;
  if (observeCurrentTarget === undefined) {
    throw new OperationBrowserAdapterError("target_evidence_unavailable");
  }
  assertNativeAbortSignal(recovery.signal);
  let observed: OperationBrowserCurrentTargetResult;
  try {
    observed = normalizeCurrentTargetResult(await observeCurrentTarget({
      page,
      operationId: recovery.operationId,
      target: recovery.target,
      signal: recovery.signal
    }));
  } catch (error) {
    if (error instanceof OperationBrowserAdapterError) throw error;
    throw new OperationBrowserAdapterError("target_evidence_unavailable");
  }
  await assertRecoveredTargetIdentity(recovery.target, observed, options);
  const lifecycle = recovery.target.targetLifecycle ?? "fixed";
  let bound: BrowserTargetBinding<PageLike>;
  try {
    bound = await bindBrowserTargetAsync({
      page,
      evidence: observed.evidence,
      ...(lifecycle === "new_established" ? { targetLifecycle: "new_established" as const } : {}),
      ...(recovery.target.coordinationScope !== "provider" || observed.authoritativeClaim === undefined
        ? {}
        : { authoritativeClaim: observed.authoritativeClaim }),
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
      evidenceDigest: options.evidenceDigest,
      owner: Object.freeze({ ...options.owner, operationId: recovery.operationId }),
      coordinator,
      ...(recovery.target.userTurnBaselineDigest === undefined ? {} : { userTurnBaselineDigest: recovery.target.userTurnBaselineDigest }),
      ...(recovery.target.assistantTurnBaselineDigest === undefined ? {} : { assistantTurnBaselineDigest: recovery.target.assistantTurnBaselineDigest }),
      ...(recovery.target.configurationReceiptDigest === undefined ? {} : { configurationReceiptDigest: recovery.target.configurationReceiptDigest })
    });
  } catch (error) {
    if (error instanceof OperationBrowserAdapterError) throw error;
    throw new OperationBrowserAdapterError("target_binding_mismatch");
  }
  return preserveRecoveredTarget(bound, recovery.target);
}

async function assertRecoveredTargetIdentity(
  target: OperationTargetBindingV1,
  observed: OperationBrowserCurrentTargetResult,
  options: Pick<OperationBrowserAdapterOptions, "capabilities" | "evidenceDigest">,
  pendingSubmitRecovery = false
): Promise<void> {
  const evidence = observed.evidence;
  compareRecoveredIdentity(evidence.provider, target.providerId);
  compareRecoveredIdentity(evidence.browser, target.browserId);
  compareRecoveredIdentity(evidence.tab, target.tabId);
  if (!pendingSubmitRecovery || target.targetLifecycle !== "new_pending") {
    compareRecoveredIdentity(evidence.conversation, target.conversationId);
    compareRecoveredIdentity(evidence.canonicalThreadUrl, target.canonicalThreadUrl);
  }
  if (target.coordinationScope !== "provider") return;
  const claim = observed.authoritativeClaim;
  if (
    claim === undefined
    || target.tabClaimEvidenceDigest === undefined
    || options.capabilities?.stableProviderId !== true
    || options.capabilities.stableBrowserId !== true
    || options.capabilities.stableTabId !== true
    || options.capabilities.concurrentTabs !== true
    || options.capabilities.authoritativeTabClaim !== true
  ) {
    throw new OperationBrowserAdapterError("target_binding_mismatch");
  }
  let claimDigest: unknown;
  try {
    claimDigest = await options.evidenceDigest(CLAIM_EVIDENCE_DIGEST_DOMAIN, {
      token: claim.token,
      epoch: claim.epoch
    });
  } catch {
    throw new OperationBrowserAdapterError("target_binding_mismatch");
  }
  if (claimDigest !== target.tabClaimEvidenceDigest) {
    throw new OperationBrowserAdapterError("target_binding_mismatch");
  }
}

function compareRecoveredIdentity(
  observed: OwnershipTargetEvidence["provider"],
  expected: string | undefined
): void {
  if (expected === undefined || observed.status !== "available" || observed.value !== expected) {
    throw new OperationBrowserAdapterError("target_binding_mismatch");
  }
}

function preserveRecoveredTarget(
  binding: BrowserTargetBinding<PageLike>,
  target: OperationTargetBindingV1
): BrowserTargetBinding<PageLike> {
  const assertCurrent = (
    evidence: OwnershipTargetEvidence,
    claim?: BrowserTargetClaim,
    allowNewTargetEstablishment = false
  ): void => {
    binding.assertCurrent(evidence, claim, allowNewTargetEstablishment);
    compareRecoveredIdentity(evidence.provider, target.providerId);
    compareRecoveredIdentity(evidence.browser, target.browserId);
    compareRecoveredIdentity(evidence.tab, target.tabId);
    compareRecoveredIdentity(evidence.conversation, target.conversationId);
    compareRecoveredIdentity(evidence.canonicalThreadUrl, target.canonicalThreadUrl);
  };
  return Object.freeze({
    page: binding.page,
    target,
    targetEvidenceDigest: binding.targetEvidenceDigest,
    evidence: binding.evidence,
    capabilities: binding.capabilities,
    resource: binding.resource,
    owner: binding.owner,
    assertPage: binding.assertPage,
    assertCurrent,
    withTabTransaction: <T>(
      transactionOptions: Parameters<BrowserTargetBinding<PageLike>["withTabTransaction"]>[0],
      callback: Parameters<BrowserTargetBinding<PageLike>["withTabTransaction"]>[1]
    ): Promise<T> => binding.withTabTransaction(transactionOptions, context => callback(Object.freeze({
      ...context,
      target,
      assertCurrent
    }))) as Promise<T>
  });
}

function cloneFrozenData(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      throw new Error("unsupported recovery value");
    }
    return value;
  }
  if (seen.has(value)) throw new Error("cyclic recovery value");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result = value.map(item => cloneFrozenData(item, seen));
      seen.delete(value);
      return Object.freeze(result);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("non-plain recovery value");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    // Use a null-prototype destination and explicit definitions so an own
    // `__proto__` data key cannot invoke the legacy setter and disappear.
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new Error("accessor recovery value");
      }
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

/** Clone provider primitive records without ever reading an accessor/get trap. */
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
      if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new Error("accessor provider value");
      }
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
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  if (getter === undefined) throw new OperationBrowserAdapterError("adapter_incomplete");
  try {
    if (typeof Reflect.apply(getter, value, []) !== "boolean") throw new Error("invalid signal");
  } catch {
    throw new OperationBrowserAdapterError("adapter_incomplete");
  }
}

async function resolveProbe(
  options: OperationBrowserAdapterOptions,
  request: OperationTargetResolutionRequest
): Promise<OperationBrowserTargetProbe> {
  if (options.resolveTargetEvidence !== undefined) {
    const value = await options.resolveTargetEvidence({
      page: options.page,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      surface: request.surface,
      target: request.target,
      signal: request.signal
    });
    return normalizeTargetProbe(value);
  }
  if (options.targetEvidence === undefined) throw new OperationBrowserAdapterError("target_evidence_unavailable");
  return normalizeTargetProbe(Object.freeze({
    page: options.page,
    evidence: options.targetEvidence,
    ...(options.newTargetAnchorDigest === undefined ? {} : { newTargetAnchorDigest: options.newTargetAnchorDigest }),
    ...(options.blankTaskEvidenceDigest === undefined ? {} : { blankTaskEvidenceDigest: options.blankTaskEvidenceDigest }),
    ...(options.authoritativeClaim === undefined ? {} : { authoritativeClaim: options.authoritativeClaim }),
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities })
  }));
}

/**
 * Read resolver output through own data descriptors only. Provider adapters
 * are an untrusted boundary: a getter or proxy trap must not run while the
 * operation is deciding whether the Send target is safe.
 */
function normalizeTargetProbe(value: unknown): OperationBrowserTargetProbe {
  if (!isPlainDataRecord(value)) throw new OperationBrowserAdapterError("target_evidence_unavailable");
  const page = readOwnData(value, "page");
  const evidence = readOwnData(value, "evidence");
  const targetLifecycle = readOwnData(value, "targetLifecycle");
  const newTargetAnchorDigest = readOwnData(value, "newTargetAnchorDigest");
  const blankTaskEvidenceDigest = readOwnData(value, "blankTaskEvidenceDigest");
  const authoritativeClaim = readOwnData(value, "authoritativeClaim");
  const capabilities = readOwnData(value, "capabilities");
  const allowed = new Set([
    "page",
    "evidence",
    "targetLifecycle",
    "newTargetAnchorDigest",
    "blankTaskEvidenceDigest",
    "authoritativeClaim",
    "capabilities"
  ]);
  try {
    for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error("unsupported probe field");
  } catch {
    throw new OperationBrowserAdapterError("target_evidence_unavailable");
  }
  if (evidence === undefined) throw new OperationBrowserAdapterError("target_evidence_unavailable");
  if (!isSafeDataGraph(evidence) || (authoritativeClaim !== undefined && !isSafeDataGraph(authoritativeClaim)) || (capabilities !== undefined && !isSafeDataGraph(capabilities))) {
    throw new OperationBrowserAdapterError("target_evidence_unavailable");
  }
  if (targetLifecycle !== undefined
    && targetLifecycle !== "fixed"
    && targetLifecycle !== "new_pending"
    && targetLifecycle !== "new_established") {
    throw new OperationBrowserAdapterError("target_evidence_unavailable");
  }
  return Object.freeze({
    ...(page === undefined ? {} : { page: page as Readonly<PageLike> }),
    evidence: evidence as OwnershipTargetEvidence,
    ...(targetLifecycle === undefined ? {} : { targetLifecycle }),
    ...(newTargetAnchorDigest === undefined ? {} : { newTargetAnchorDigest: newTargetAnchorDigest as string }),
    ...(blankTaskEvidenceDigest === undefined ? {} : { blankTaskEvidenceDigest: blankTaskEvidenceDigest as string }),
    ...(authoritativeClaim === undefined ? {} : { authoritativeClaim: authoritativeClaim as BrowserTargetClaim }),
    ...(capabilities === undefined ? {} : { capabilities: capabilities as Partial<BrowserTargetCapabilities> })
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

function isSafeDataGraph(value: unknown, seen = new Set<object>(), depth = 0): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return true;
  if (typeof value === "function") return true;
  if (depth > 16 || seen.has(value)) return depth <= 16;
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

function assertProbePage(boundPage: Readonly<PageLike>, probedPage: Readonly<PageLike> | undefined): void {
  if (probedPage !== undefined && probedPage !== boundPage) throw new OperationBrowserAdapterError("page_affinity_mismatch");
}

function assertRuntimeAffinity(
  runtimeCapture: OperationRuntimeContextCapture<PageLike>,
  page: Readonly<PageLike>,
  probe: OperationBrowserTargetProbe
): void {
  const tabId = probe.evidence.tab.status === "available" ? probe.evidence.tab.value : undefined;
  const claim = probe.authoritativeClaim === undefined
    ? undefined
    : { status: "available" as const, token: probe.authoritativeClaim.token, epoch: probe.authoritativeClaim.epoch };
  runtimeCapture.assertPageAffinity(page, {
    ...(tabId === undefined ? {} : { tabId }),
    ...(claim === undefined ? {} : { authoritativeClaim: claim })
  });
}

function assertStaticTarget(
  target: OperationTargetRequestV1,
  evidence: OwnershipTargetEvidence,
  hasResolver: boolean
): void {
  if (hasResolver) return;
  switch (target.type) {
    case "selected_tab":
      return;
    case "tab_id":
      if (evidence.tab.status === "available" && evidence.tab.value === target.tabId) return;
      break;
    case "conversation_id":
      if (evidence.conversation.status === "available" && evidence.conversation.value === target.conversationId) return;
      break;
    case "new":
    case "url":
      break;
  }
  throw new OperationBrowserAdapterError("target_evidence_unavailable");
}

function bindingFor(
  bindings: ReadonlyMap<string, BrowserTargetBinding<PageLike>>,
  operationId: string,
  _targetBindingDigest: string | undefined
): BrowserTargetBinding<PageLike> | undefined {
  const binding = bindings.get(operationId);
  // The journal owner computes the durable target-binding digest after the
  // target-bound event is appended. `bindBrowserTarget` also emits a local
  // evidence digest, but those domains intentionally differ. Operation ID is
  // therefore the only safe adapter lookup key here; OperationService has
  // already authenticated the caller handle before reaching these ports.
  if (binding === undefined) return undefined;
  return binding;
}

function unavailableStage(reason: "target" | "configuration" | "composer" | "unknown"): SubmissionStageObservation {
  return { status: "unavailable", reason } as SubmissionStageObservation;
}

function unavailableStagingObservation(request: Pick<OperationStagingCallbackRequest, "desiredStateDigest">): OperationStagingObservation {
  return {
    status: "unavailable",
    desiredStateDigest: request.desiredStateDigest,
    blockerCode: "target_evidence_unavailable"
  };
}

async function matchFileManifest(
  identities: readonly OperationFileIdentity[] | undefined,
  manifestDigest: OperationBrowserAdapterOptions["fileManifestDigest"],
  manifest: SubmissionExpectedEnvelope["attachmentManifest"]
): Promise<readonly OperationFileIdentity[] | undefined> {
  if (manifest.count === 0) return [];
  if (identities === undefined || identities.length !== manifest.count || manifestDigest === undefined) return undefined;
  const sorted = [...identities];
  for (let ordinal = 0; ordinal < manifest.count; ordinal += 1) {
    const identity = sorted[ordinal];
    const expected = manifest.identities[ordinal];
    if (identity === undefined || expected === undefined || expected.ordinal !== ordinal) return undefined;
    let digest: string;
    try {
      digest = await manifestDigest(ordinal, identity.manifest);
    } catch {
      return undefined;
    }
    if (digest !== expected.identityDigest || !DIGEST_PATTERN.test(digest)) return undefined;
  }
  return Object.freeze(sorted);
}

async function runReadTransaction<T>(
  binding: BrowserTargetBinding<PageLike>,
  operationId: string,
  callback: (context: BrowserTargetTransactionContext<PageLike>) => Promise<T> | T,
  observeCurrentTarget?: OperationBrowserAdapterOptions["observeCurrentTarget"],
  evidenceDigest?: BrowserTargetEvidenceDigest,
  transactionOptions: Parameters<BrowserTargetBinding<PageLike>["withTabTransaction"]>[0] = { timeoutMs: DEFAULT_TRANSACTION_TIMEOUT_MS },
  allowNewTargetEstablishment = false
): Promise<T> {
  return await binding.withTabTransaction({ ...transactionOptions, priority: transactionOptions.priority ?? "read", label: transactionOptions.label ?? "operation-read" }, async context => {
    const current = await readCurrentTarget(binding, operationId, context.page, observeCurrentTarget, evidenceDigest, context.acquisition.signal, context.acquisition.timing.deadlineAt);
    binding.assertCurrent(current.evidence, current.authoritativeClaim, allowNewTargetEstablishment);
    return await callback(context);
  });
}

async function runMutationTransaction<T>(
  binding: BrowserTargetBinding<PageLike>,
  operationId: string,
  callback: (context: BrowserTargetTransactionContext<PageLike>) => Promise<T> | T,
  observeCurrentTarget?: OperationBrowserAdapterOptions["observeCurrentTarget"],
  evidenceDigest?: BrowserTargetEvidenceDigest,
  transactionOptions: Parameters<BrowserTargetBinding<PageLike>["withTabTransaction"]>[0] = { timeoutMs: DEFAULT_TRANSACTION_TIMEOUT_MS }
): Promise<T> {
  return await binding.withTabTransaction({ ...transactionOptions, priority: transactionOptions.priority ?? "mutation", label: transactionOptions.label ?? "operation-mutation" }, async context => {
    const current = await readCurrentTarget(binding, operationId, context.page, observeCurrentTarget, evidenceDigest, context.acquisition.signal, context.acquisition.timing.deadlineAt);
    binding.assertCurrent(current.evidence, current.authoritativeClaim);
    return await callback(context);
  });
}

type SteerPhase = "prepare" | "execute_prepared" | "verify" | "recovery";
type SteerPhaseRequest =
  | ControlSteerPrepareRequest
  | ControlSteerExecutePreparedRequest
  | ControlSteerVerifyRequest
  | ControlSteerRecoverRequest;

type SteerPhaseIdentity = Readonly<{
  parentOperationId: string;
  parentRequestDigest: string;
  parentTargetBindingDigest: string;
  controlActionId: string;
  requestDigest: string;
  expectedAssistantTurnId: string;
}>;

/** Resolve one durable identity from either a fresh or prepared phase call. */
function steerPhaseIdentity(request: SteerPhaseRequest): SteerPhaseIdentity {
  if ("prepared" in request) {
    return {
      parentOperationId: request.prepared.parentOperationId,
      parentRequestDigest: request.prepared.parentRequestDigest,
      parentTargetBindingDigest: request.prepared.parentTargetBindingDigest,
      controlActionId: request.prepared.controlActionId,
      requestDigest: request.prepared.requestDigest,
      expectedAssistantTurnId: request.prepared.expectedAssistantTurnId
    };
  }
  return {
    parentOperationId: request.parentOperationId,
    parentRequestDigest: request.parentRequestDigest,
    parentTargetBindingDigest: request.parentTargetBindingDigest,
    controlActionId: request.controlActionId,
    requestDigest: request.requestDigest,
    expectedAssistantTurnId: request.expectedAssistantTurnId
  };
}

function steerPhaseBase(
  request: SteerPhaseRequest,
  phase: SteerPhase,
  prepared?: ControlSteerPrepared
): Record<string, unknown> {
  const identity = steerPhaseIdentity(request);
  const selected = prepared ?? ("prepared" in request ? request.prepared : undefined);
  return {
    schemaVersion: CONTROL_COORDINATOR_SCHEMA_VERSION,
    phase,
    parentOperationId: identity.parentOperationId,
    parentRequestDigest: identity.parentRequestDigest,
    parentTargetBindingDigest: identity.parentTargetBindingDigest,
    controlActionId: identity.controlActionId,
    action: "steer",
    requestDigest: identity.requestDigest,
    expectedAssistantTurnId: identity.expectedAssistantTurnId,
    ...(selected === undefined ? {} : {
      assistantBranchId: selected.assistantBranchId,
      assistantParentTurnId: selected.assistantParentTurnId,
      baselineSnapshotDigest: selected.baselineSnapshotDigest,
      preparedDigest: selected.preparedDigest
    })
  };
}

function blockedSteerPhase(
  request: SteerPhaseRequest,
  phase: SteerPhase,
  blockerCode: OperationBlockerCode,
  observationRequired: boolean,
  mutationBoundary: "none" | "control_may_have_occurred",
  prepared?: ControlSteerPrepared,
  evidenceDigest?: string
): ControlSteerPhaseResult {
  return Object.freeze({
    ...steerPhaseBase(request, phase, prepared),
    status: "blocked" as const,
    blockerCode,
    observationRequired,
    mutationBoundary,
    ...(evidenceDigest === undefined ? {} : { evidenceDigest })
  }) as ControlSteerPhaseResult;
}

function uncertainSteerPhase(
  request: SteerPhaseRequest,
  phase: Exclude<SteerPhase, "prepare">,
  prepared: ControlSteerPrepared,
  blockerCode: OperationBlockerCode,
  quarantine: "caller" | "provider",
  evidenceDigest?: string
): ControlSteerPhaseResult {
  return Object.freeze({
    ...steerPhaseBase(request, phase, prepared),
    status: "uncertain" as const,
    blockerCode,
    observationRequired: true as const,
    mutationBoundary: "control_may_have_occurred" as const,
    quarantine,
    ...(evidenceDigest === undefined ? {} : { evidenceDigest })
  }) as ControlSteerPhaseResult;
}

/** Do not expose provider diagnostics or untrusted extra fields downstream. */
function normalizeSteerProviderResult(
  value: unknown,
  request: SteerPhaseRequest,
  phase: SteerPhase,
  prepared?: ControlSteerPrepared
): ControlSteerPhaseResult {
  const clone = cloneFrozenData(value);
  if (!isPlainDataRecord(clone)) throw new Error("invalid steer phase result");
  const expected = steerPhaseBase(request, phase, prepared);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (readOwnData(clone, key) !== expectedValue) throw new Error("steer phase identity mismatch");
  }
  const status = readOwnData(clone, "status");
  const observationRequired = readOwnData(clone, "observationRequired");
  const mutationBoundary = readOwnData(clone, "mutationBoundary");
  if (typeof observationRequired !== "boolean"
    || (mutationBoundary !== "none" && mutationBoundary !== "control_may_have_occurred")) {
    throw new Error("invalid steer phase boundary");
  }

  const evidenceDigest = readOwnData(clone, "evidenceDigest");
  if (evidenceDigest !== undefined && (typeof evidenceDigest !== "string" || !DIGEST_PATTERN.test(evidenceDigest))) {
    throw new Error("invalid steer evidence");
  }
  const blockerCode = readOwnData(clone, "blockerCode");
  if (blockerCode !== undefined && (typeof blockerCode !== "string" || !/^[a-z][a-z0-9_]{0,63}$/u.test(blockerCode))) {
    throw new Error("invalid steer blocker");
  }

  if (status === "prepared") {
    if (phase !== "prepare" || observationRequired !== false || mutationBoundary !== "none") throw new Error("invalid steer preparation");
    const preparedValue = readOwnData(clone, "prepared");
    if (!isPlainDataRecord(preparedValue)) throw new Error("missing steer preparation");
    assertSteerPreparedIdentity(preparedValue, steerPhaseIdentity(request));
    return Object.freeze({
      ...expected,
      status: "prepared" as const,
      observationRequired: false as const,
      mutationBoundary: "none" as const,
      prepared: cloneFrozenData(preparedValue)
    }) as ControlSteerPhaseResult;
  }
  if (status === "executed") {
    if (phase !== "execute_prepared" || prepared === undefined || observationRequired !== true || mutationBoundary !== "control_may_have_occurred") {
      throw new Error("invalid steer execution");
    }
    return Object.freeze({
      ...expected,
      status: "executed" as const,
      observationRequired: true as const,
      mutationBoundary: "control_may_have_occurred" as const
    }) as ControlSteerPhaseResult;
  }
  if (status === "satisfied") {
    if ((phase !== "verify" && phase !== "recovery") || prepared === undefined || observationRequired !== false || mutationBoundary !== "control_may_have_occurred") {
      throw new Error("invalid steer satisfaction");
    }
    const receipt = readOwnData(clone, "receipt");
    if (!isPlainDataRecord(receipt)) throw new Error("missing steer receipt");
    assertSteerReceiptIdentity(receipt, prepared);
    return Object.freeze({
      ...expected,
      status: "satisfied" as const,
      observationRequired: false as const,
      mutationBoundary: "control_may_have_occurred" as const,
      receipt: cloneFrozenData(receipt)
    }) as ControlSteerPhaseResult;
  }
  if (status === "blocked") {
    if (typeof blockerCode !== "string" || readOwnData(clone, "quarantine") !== undefined) throw new Error("invalid steer blocker result");
    if (phase === "prepare" && mutationBoundary !== "none") throw new Error("preparation crossed mutation boundary");
    return Object.freeze({
      ...expected,
      status: "blocked" as const,
      blockerCode,
      observationRequired,
      mutationBoundary,
      ...(evidenceDigest === undefined ? {} : { evidenceDigest })
    }) as ControlSteerPhaseResult;
  }
  if (status === "uncertain") {
    const quarantine = readOwnData(clone, "quarantine");
    if (typeof blockerCode !== "string"
      || observationRequired !== true
      || mutationBoundary !== "control_may_have_occurred"
      || (quarantine !== "caller" && quarantine !== "provider")
      || phase === "prepare") {
      throw new Error("invalid steer uncertainty");
    }
    return Object.freeze({
      ...expected,
      status: "uncertain" as const,
      blockerCode,
      observationRequired: true as const,
      mutationBoundary: "control_may_have_occurred" as const,
      quarantine,
      ...(evidenceDigest === undefined ? {} : { evidenceDigest })
    }) as ControlSteerPhaseResult;
  }
  throw new Error("invalid steer phase status");
}

function assertSteerPreparedIdentity(
  value: Record<string, unknown>,
  expected: SteerPhaseIdentity
): void {
  if (readOwnData(value, "schemaVersion") !== CONTROL_COORDINATOR_SCHEMA_VERSION
    || readOwnData(value, "parentOperationId") !== expected.parentOperationId
    || readOwnData(value, "parentRequestDigest") !== expected.parentRequestDigest
    || readOwnData(value, "parentTargetBindingDigest") !== expected.parentTargetBindingDigest
    || readOwnData(value, "controlActionId") !== expected.controlActionId
    || readOwnData(value, "action") !== "steer"
    || readOwnData(value, "requestDigest") !== expected.requestDigest
    || readOwnData(value, "expectedAssistantTurnId") !== expected.expectedAssistantTurnId) {
    throw new Error("steer prepared identity mismatch");
  }
  for (const key of ["assistantBranchId", "assistantParentTurnId", "baselineSnapshotDigest", "preparedDigest"] as const) {
    const field = readOwnData(value, key);
    if (typeof field !== "string" || field.length === 0) throw new Error("steer prepared evidence is invalid");
  }
}

function assertSteerReceiptIdentity(
  value: Record<string, unknown>,
  prepared: ControlSteerPrepared
): void {
  if (readOwnData(value, "schemaVersion") !== CONTROL_COORDINATOR_SCHEMA_VERSION
    || readOwnData(value, "baselineSnapshotDigest") !== prepared.baselineSnapshotDigest
    || readOwnData(value, "preparedDigest") !== prepared.preparedDigest
    || readOwnData(value, "assistantTurnId") !== prepared.expectedAssistantTurnId
    || readOwnData(value, "assistantBranchId") !== prepared.assistantBranchId
    || readOwnData(value, "assistantParentTurnId") !== prepared.assistantParentTurnId) {
    throw new Error("steer receipt identity mismatch");
  }
}

function phaseFailureCode(signal: AbortSignal, deadlineAt: number, error?: unknown): OperationBlockerCode {
  if (signal.aborted) return "operation_cancelled";
  const code = error !== null && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === "deadline_exceeded") return "operation_timeout";
  if (code === "aborted") return "operation_cancelled";
  if (Date.now() >= deadlineAt) return "operation_timeout";
  if (code === "navigation_mismatch" || code === "claim_mismatch" || code === "page_mismatch" || code === "target_binding_mismatch") {
    return "target_binding_mismatch";
  }
  return "target_evidence_unavailable";
}

/**
 * Rehydrate a missing binding only through the durable recovery context. The
 * helper never selects a new page or target and never performs a mutation.
 */
async function steerBindingFor(
  bindings: ReadonlyMap<string, BrowserTargetBinding<PageLike>>,
  ensureRecovered: (
    operationId: string,
    requestDigest: string,
    surface: OperationSurface,
    signal: AbortSignal
  ) => Promise<BrowserTargetBinding<PageLike>>,
  recovery: OperationBrowserRecoveryContext | undefined,
  operationId: string,
  requestDigest: string,
  signal: AbortSignal
): Promise<BrowserTargetBinding<PageLike> | undefined> {
  const binding = bindingFor(bindings, operationId, undefined);
  if (binding !== undefined || recovery === undefined) return binding;
  try {
    await ensureRecovered(operationId, requestDigest, recovery.surface, signal);
  } catch {
    return undefined;
  }
  return bindingFor(bindings, operationId, undefined);
}

/**
 * Unlike a plain `withTabTransaction` call, retain and await the provider
 * callback when the coordinator rejects its public promise at a deadline.
 */
async function runSteerControlTransaction<T>(
  binding: BrowserTargetBinding<PageLike>,
  operationId: string,
  signal: AbortSignal,
  deadlineAt: number,
  transactionTimeoutMs: number,
  observeCurrentTarget: OperationBrowserAdapterOptions["observeCurrentTarget"],
  evidenceDigest: BrowserTargetEvidenceDigest,
  callback: (context: BrowserTargetTransactionContext<PageLike>) => Promise<T>
): Promise<T> {
  let workPromise: Promise<T> | undefined;
  const transaction = binding.withTabTransaction(
    boundedRequest(signal, deadlineAt, transactionTimeoutMs, "operation-control-steer-execute", "control"),
    async context => {
      workPromise = (async () => {
        const current = await readCurrentTarget(
          binding,
          operationId,
          context.page,
          observeCurrentTarget,
          evidenceDigest,
          context.acquisition.signal,
          context.acquisition.timing.deadlineAt
        );
        binding.assertCurrent(current.evidence, current.authoritativeClaim);
        return await callback(context);
      })();
      return await workPromise;
    }
  );
  try {
    return await transaction;
  } catch (error) {
    if (workPromise !== undefined) await workPromise.catch(() => undefined);
    throw error;
  }
}

type LinkedAbortController = Readonly<{
  controller: AbortController;
  cleanup: () => void;
}>;

/** Link caller cancellation to a phase-local signal without retaining it. */
function createLinkedAbortController(source?: AbortSignal): LinkedAbortController {
  const controller = new AbortController();
  if (source === undefined) return { controller, cleanup: () => undefined };
  const onAbort = (): void => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  if (source.aborted) onAbort();
  else source.addEventListener("abort", onAbort, { once: true });
  return {
    controller,
    cleanup: () => source.removeEventListener("abort", onAbort)
  };
}

type SendPhaseContext = Readonly<{
  page: Readonly<PageLike>;
  target: OperationTargetBindingV1;
  acquisition: BrowserTargetTransactionContext<PageLike>["acquisition"];
}>;

type PhaseSendObservers = Readonly<{
  observers: SendOnceObservers;
  withContext: <T>(context: SendPhaseContext, callback: () => Promise<T>) => Promise<T>;
}>;

/**
 * Adapt one provider's one-shot Send observers to the four phase protocol.
 * Precondition reads use the phase's active actor; each postcondition probe
 * acquires a fresh read actor and releases it before SendOnce sleeps/polls.
 */
function createPhaseSendObservers(
  binding: BrowserTargetBinding<PageLike>,
  operationId: string,
  baseObservers: SendOnceObservers,
  controller: AbortController,
  observeCurrentTarget: OperationBrowserAdapterOptions["observeCurrentTarget"],
  evidenceDigest: BrowserTargetEvidenceDigest,
  transactionTimeoutMs: number
): PhaseSendObservers {
  let activeContext: SendPhaseContext | undefined;
  const observers: SendOnceObservers = {
    observePrecondition: async request => {
      const context = activeContext;
      const signal = context?.acquisition.signal ?? controller.signal;
      return await baseObservers.observePrecondition({
        ...request,
        ...(context === undefined ? {} : { page: context.page }),
        signal,
        ...(context?.acquisition.timing.deadlineAt === undefined
          ? {}
          : { deadlineAt: context.acquisition.timing.deadlineAt })
      });
    },
    observePostcondition: async request => {
      const probe = await runSendTransaction(
        binding,
        operationId,
        controller,
        observeCurrentTarget,
        evidenceDigest,
        request.deadlineAt,
        transactionTimeoutMs,
        "operation-send-postcondition",
        "read",
        context => baseObservers.observePostcondition({
          ...request,
          page: context.page,
          signal: context.acquisition.signal,
          ...(context.acquisition.timing.deadlineAt === undefined
            ? {}
            : { deadlineAt: context.acquisition.timing.deadlineAt })
        })
      );
      if (
        isPlainPostconditionResult(probe)
        && probe.status === "blocked"
        && (probe.blockerCode === "target_evidence_unavailable" || probe.blockerCode === "ambiguous_submit")
      ) {
        return { result: probe, retryable: true };
      }
      return probe;
    },
    ...(baseObservers.sleep === undefined ? {} : { sleep: baseObservers.sleep }),
    ...(baseObservers.maxPostconditionAttempts === undefined ? {} : { maxPostconditionAttempts: baseObservers.maxPostconditionAttempts }),
    ...(baseObservers.postconditionIntervalMs === undefined ? {} : { postconditionIntervalMs: baseObservers.postconditionIntervalMs }),
    ...(baseObservers.postconditionTimeoutMs === undefined ? {} : { postconditionTimeoutMs: baseObservers.postconditionTimeoutMs })
  };
  return {
    observers,
    withContext: async <T>(context: SendPhaseContext, callback: () => Promise<T>): Promise<T> => {
      activeContext = context;
      try {
        return await callback();
      } finally {
        if (activeContext === context) activeContext = undefined;
      }
    }
  };
}

/**
 * Run a single target revalidation plus provider callback in one coordinator
 * transaction. The coordinator may reject its public promise at a deadline
 * while its callback is still in flight; retain the callback promise and await
 * it before propagating that error so an activation can never be overlapped.
 */
async function runSendTransaction<T>(
  binding: BrowserTargetBinding<PageLike>,
  operationId: string,
  controller: AbortController,
  observeCurrentTarget: OperationBrowserAdapterOptions["observeCurrentTarget"],
  evidenceDigest: BrowserTargetEvidenceDigest,
  requestedDeadlineAt: number | undefined,
  transactionTimeoutMs: number,
  label: string,
  priority: "read" | "mutation",
  callback: (context: BrowserTargetTransactionContext<PageLike>) => Promise<T>
): Promise<T> {
  let workPromise: Promise<T> | undefined;
  const transaction = binding.withTabTransaction(
    boundedRequest(
      controller.signal,
      requestedDeadlineAt,
      transactionTimeoutMs,
      label,
      priority
    ),
    async context => {
      const abortFromCoordinator = (): void => {
        if (!controller.signal.aborted) controller.abort(context.acquisition.signal.reason);
      };
      if (context.acquisition.signal.aborted) abortFromCoordinator();
      else context.acquisition.signal.addEventListener("abort", abortFromCoordinator, { once: true });
      workPromise = (async () => {
        const current = await readCurrentTarget(
          binding,
          operationId,
          context.page,
          observeCurrentTarget,
          evidenceDigest,
          context.acquisition.signal,
          context.acquisition.timing.deadlineAt
        );
        binding.assertCurrent(current.evidence, current.authoritativeClaim);
        return await callback(context);
      })();
      try {
        return await workPromise;
      } finally {
        context.acquisition.signal.removeEventListener("abort", abortFromCoordinator);
      }
    }
  );
  try {
    return await transaction;
  } catch (error) {
    // `workPromise` is set before target proof/provider work starts. Awaiting it
    // here preserves coordinator quarantine semantics without releasing an
    // actor while the browser call is still running.
    if (workPromise !== undefined) await workPromise.catch(() => undefined);
    throw error;
  }
}

function blockedPrepareSend(blockerCode: SubmissionBlockerCode): SubmissionPrepareSendResult {
  return { status: "blocked", result: { status: "blocked", blockerCode } };
}

function resultToPrepareSend(
  result: Extract<SubmissionFinalTransactionResult, { status: "blocked" }>
): SubmissionPrepareSendResult {
  return { status: "blocked", result };
}

function blockedExecuteSend(blockerCode: SubmissionBlockerCode): SubmissionExecutePreparedSendResult {
  return { status: "blocked", result: { status: "blocked", blockerCode } };
}

function phaseBlocker(signal: AbortSignal, deadlineAt: number | undefined): SubmissionBlockerCode {
  if (signal.aborted) return "operation_cancelled";
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) return "operation_timeout";
  return "port_protocol_violation";
}

function submissionPreparedFromSendOnce(
  prepared: SendOncePrepared,
  expected: SubmissionExpectedEnvelope
): SubmissionPreparedSend {
  const baseline = prepared.baseline.ownershipBaseline;
  if (baseline === undefined) throw new Error("missing durable Send baseline");
  return normalizeSubmissionPreparedSend(
    {
      prepared: cloneFrozenData(prepared),
      baseline: cloneFrozenData(baseline),
      evidenceDigest: prepared.observation.evidenceDigest
    } as SubmissionPreparedSend,
    expected,
    {
      operationId: prepared.operationId,
      requestDigest: prepared.requestDigest,
      surface: prepared.surface,
      actionId: prepared.actionId
    }
  );
}

function normalizeSubmissionPreparedSend(
  value: SubmissionPreparedSend,
  expected: SubmissionExpectedEnvelope,
  identity: Readonly<{
    operationId: string;
    requestDigest: string;
    surface: OperationSurface;
    actionId: string;
  }>
): SubmissionPreparedSend {
  const clone = cloneFrozenData(value);
  if (!isPlainDataRecord(clone)) throw new Error("invalid opaque Send capability");
  assertExactDataKeys(clone, ["prepared", "baseline", "evidenceDigest"]);
  const prepared = readOwnData(clone, "prepared");
  const baseline = readOwnData(clone, "baseline");
  const evidence = readOwnData(clone, "evidenceDigest");
  if (!isPlainDataRecord(prepared) || !isPlainDataRecord(baseline) || typeof evidence !== "string" || !DIGEST_PATTERN.test(evidence)) {
    throw new Error("invalid opaque Send capability");
  }
  assertExactDataKeys(prepared, ["schemaVersion", "operationId", "requestDigest", "surface", "actionId", "expected", "observation", "baseline"]);
  if (
    readOwnData(prepared, "schemaVersion") !== "chatgpt.browser_control.send_once_prepared.v1"
    || readOwnData(prepared, "operationId") !== identity.operationId
    || readOwnData(prepared, "requestDigest") !== identity.requestDigest
    || readOwnData(prepared, "surface") !== identity.surface
    || readOwnData(prepared, "actionId") !== identity.actionId
    || canonicalJson(readOwnData(prepared, "expected")) !== canonicalJson(expected)
  ) {
    throw new Error("opaque Send identity mismatch");
  }
  const preparedBaseline = readOwnData(prepared, "baseline");
  if (!isPlainDataRecord(preparedBaseline)) {
    throw new Error("missing opaque Send baseline");
  }
  const ownershipBaseline = readOwnData(preparedBaseline, "ownershipBaseline");
  if (!isPlainDataRecord(ownershipBaseline) || canonicalJson(ownershipBaseline) !== canonicalJson(baseline)) {
    throw new Error("opaque Send baseline mismatch");
  }
  const observation = readOwnData(prepared, "observation");
  if (!isPlainDataRecord(observation) || readOwnData(observation, "status") !== "exact" || readOwnData(observation, "evidenceDigest") !== evidence) {
    throw new Error("opaque Send observation mismatch");
  }
  return clone as SubmissionPreparedSend;
}

function assertExactDataKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error("unsupported opaque Send field");
  }
}

function markEstablished(
  binding: BrowserTargetBinding<PageLike>,
  result: SubmissionFinalTransactionResult
): void {
  if (
    binding.markTargetEstablished !== undefined
    && (result.status === "submitted" || result.status === "already_submitted")
    && result.targetEstablishment !== undefined
  ) {
    binding.markTargetEstablished({
      conversationId: result.targetEstablishment.conversationId,
      canonicalThreadUrl: result.targetEstablishment.canonicalThreadUrl
    });
  }
}

async function readCurrentTarget(
  binding: BrowserTargetBinding<PageLike>,
  operationId: string,
  page: PageLike,
  observeCurrentTarget?: OperationBrowserAdapterOptions["observeCurrentTarget"],
  evidenceDigest?: BrowserTargetEvidenceDigest,
  signal: AbortSignal = new AbortController().signal,
  deadlineAt?: number
): Promise<OperationBrowserCurrentTargetResult> {
  if (observeCurrentTarget !== undefined) {
    const observed = await observeCurrentTarget({ page, operationId, target: binding.target, signal, ...(deadlineAt === undefined ? {} : { deadlineAt }) });
    return normalizeCurrentTargetResult(observed);
  }
  // The default read is a bounded, read-only browser observation. Provider
  // implementations can inject a narrower identity probe when their DOM
  // exposes stable target evidence without a complete turn snapshot.
  const target = binding.target;
  const boundThreadId = binding.evidence.thread.status === "available"
    ? binding.evidence.thread.value
    : undefined;
  const boundClaim = binding.evidence.authoritativeTabClaim.status === "available"
    ? binding.evidence.authoritativeTabClaim.value
    : undefined;
  const result: BrowserObservationResult = await observeBrowserPage(page, {
    operationId,
    target: {
      providerId: target.providerId,
      browserId: target.browserId,
      tabId: target.tabId,
      coordinationScope: target.coordinationScope,
      ...(boundClaim === undefined ? {} : { authoritativeTabClaim: boundClaim }),
      ...(target.targetLifecycle === undefined ? {} : { targetLifecycle: target.targetLifecycle }),
      ...(target.conversationId === undefined ? {} : { expectedConversationId: target.conversationId }),
      ...(boundThreadId === undefined ? {} : { expectedThreadId: boundThreadId })
    },
    // An injected digest is required for target evidence. Never manufacture a
    // placeholder digest: unavailable evidence must remain unavailable.
    evidenceDigest: evidenceDigest ?? (() => {
      throw new OperationBrowserAdapterError("target_evidence_unavailable");
    }),
    responseContent: "metadata"
  });
  return { evidence: result.snapshot.target };
}

function normalizeCurrentTargetResult(value: unknown): OperationBrowserCurrentTargetResult {
  if (!isPlainDataRecord(value)) throw new OperationBrowserAdapterError("target_evidence_unavailable");
  const evidence = readOwnData(value, "evidence");
  if (evidence === undefined) throw new OperationBrowserAdapterError("target_evidence_unavailable");
  const authoritativeClaim = readOwnData(value, "authoritativeClaim");
  if (!isSafeDataGraph(evidence) || (authoritativeClaim !== undefined && !isSafeDataGraph(authoritativeClaim))) {
    throw new OperationBrowserAdapterError("target_evidence_unavailable");
  }
  try {
    for (const key of Object.keys(value)) {
      if (key !== "evidence" && key !== "authoritativeClaim") {
        throw new Error("unsupported current target field");
      }
    }
  } catch {
    throw new OperationBrowserAdapterError("target_evidence_unavailable");
  }
  return Object.freeze({
    evidence: evidence as OwnershipTargetEvidence,
    ...(authoritativeClaim === undefined ? {} : { authoritativeClaim: authoritativeClaim as BrowserTargetClaim })
  });
}

function boundedRequest(
  signal: AbortSignal | undefined,
  requestedDeadlineAt: number | undefined,
  transactionTimeoutMs: number,
  label: string,
  priority: "read" | "mutation" | "control" = "read"
): Parameters<BrowserTargetBinding<PageLike>["withTabTransaction"]>[0] {
  const localDeadline = Date.now() + transactionTimeoutMs;
  return {
    priority,
    signal: signal ?? new AbortController().signal,
    deadlineAt: Math.min(requestedDeadlineAt ?? MAX_DEADLINE_AT, localDeadline),
    label
  };
}

async function defaultCollectorObservation(
  request: CollectorObservationRequest,
  transaction: BrowserTargetTransactionContext<PageLike>,
  context: OperationCollectorContext,
  evidenceDigest: BrowserObservationDigest,
  authoritativeClaim?: BrowserTargetClaim
): Promise<CollectorObservation> {
  const target = transaction.target;
  const observation = await observeBrowserPage(transaction.page, {
    operationId: request.operationId,
    target: {
      providerId: target.providerId,
      browserId: target.browserId,
      tabId: target.tabId,
      coordinationScope: target.coordinationScope,
      ...(authoritativeClaim === undefined ? {} : { authoritativeTabClaim: authoritativeClaim.token }),
      ...(target.conversationId === undefined ? {} : { expectedConversationId: target.conversationId })
    },
    evidenceDigest,
    responseContent: request.responseContent,
    ...(request.responseFormat === undefined ? {} : { responseFormat: request.responseFormat }),
    ...(context.baseline === undefined ? {} : { baseline: context.baseline }),
    ...(context.prior?.assistantTurnId === undefined ? {} : {
      terminalAssistantTurnId: context.prior.assistantTurnId,
      ...(request.responseContent === "include" ? { rawAssistantTurnId: context.prior.assistantTurnId } : {})
    })
  });
  return {
    schemaVersion: "chatgpt.browser_control.collector.v1",
    snapshot: observation.snapshot,
    ...(observation.terminal === undefined ? {} : { terminal: observation.terminal })
  };
}

function sleepOutsideCoordinator(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 60_000) {
    return Promise.reject(new OperationBrowserAdapterError("adapter_incomplete"));
  }
  if (signal.aborted) return Promise.reject(new OperationBrowserAdapterError("browser_bridge_unavailable"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new OperationBrowserAdapterError("browser_bridge_unavailable"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isPlainPostconditionResult(
  value: SubmissionFinalTransactionResult | Readonly<{ result: SubmissionFinalTransactionResult; retryable: boolean }>
): value is SubmissionFinalTransactionResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "status");
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string";
}

function errorCode(error: unknown): OperationBrowserAdapterErrorCode {
  if (error instanceof OperationBrowserAdapterError) return error.code;
  return "target_evidence_unavailable";
}
