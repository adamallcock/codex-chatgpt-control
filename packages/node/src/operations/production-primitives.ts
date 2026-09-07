import type { LocatorLike, PageLike } from "../types.js";
import { composerTextbox, stopGenerationButton } from "../dom/selectors.js";
import { inspectComposerText } from "../dom/composer-text.js";
import { readChatGPTEmptyAttachmentState } from "./production-chatgpt-attachments.js";
import {
  observeBrowserPage,
  type BrowserObservationDigest,
  type BrowserObservationResult
} from "./browser-observation.js";
import type {
  OperationBrowserCollectorPrimitive,
  OperationBrowserControlPrimitive,
  OperationBrowserStagingPrimitive,
  OperationBrowserSubmissionPrimitive
} from "./browser-adapter.js";
import type { OperationRuntimeBrowserPrimitives } from "./runtime-adapter.js";
import type {
  ControlExecutionRequest,
  ControlPostconditionObservation,
  ControlPostconditionRequest,
  ControlTurnObservation,
  ControlTurnObservationRequest
} from "./control.js";
import type {
  OperationCollectorContext,
  OperationCollectorContextRequest
} from "./service.js";
import {
  COLLECTOR_SCHEMA_VERSION,
  type CollectorObservation,
  type CollectorObservationRequest
} from "./collector.js";
import {
  classifyTurnOwnership,
  TURN_OWNERSHIP_SCHEMA_VERSION,
  type OwnershipBaseline,
  type OwnershipBinding,
  type OwnershipIdentityEvidence,
  type OwnershipSnapshot,
  type OwnershipTargetEvidence,
} from "./turn-ownership.js";
import type { OperationTargetBindingV1 } from "./types.js";
import type {
  OperationStagingCallbackRequest,
  OperationStagingMutationResult,
  OperationStagingObservation
} from "./staging.js";
import type {
  SubmissionAttachmentObservation,
  SubmissionAttachmentRequest,
  SubmissionExpectedEnvelope,
  SubmissionFinalTransactionResult,
  SubmissionHandoffResult,
  SubmissionStageObservation,
  SubmissionStageRequest
} from "./submission.js";
import type {
  SendOnceAttachmentObservation,
  SendOnceObservers,
  SendOncePostconditionRequest,
  SendOncePreconditionObservation,
  SendOncePreconditionRequest
} from "./send-once.js";

/**
 * A small, provider-facing primitive layer for the transactional adapter.
 *
 * This module intentionally does not call a legacy command.  Each callback
 * performs a bounded locator/evaluation operation, or one browser activation,
 * and returns only keyed evidence.  Attachment handoff, configuration,
 * The base factory deliberately leaves configuration, attachments, and Work
 * steer to their dedicated provider modules. `chatgpt-runtime.ts` composes
 * those modules into the default ChatGPT operation runtime; the inventory
 * below describes this base factory, not the completed composite runtime.
 */

const DIGEST_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,512}$/u;
const OPAQUE_THREAD_URL_PATTERN = /^https:\/\/opaque\.invalid\/thread\/[0-9a-f]{64}$/u;
const MAX_LOCATOR_CANDIDATES = 128;
const MAX_COMPOSER_CHARS = 8 * 1024 * 1024;

export type ProductionPrimitiveAttachmentObserver = (
  request: SubmissionAttachmentRequest,
  page: Readonly<PageLike>,
  target: OperationTargetBindingV1
) => Promise<SubmissionAttachmentObservation>;

export type ProductionOperationPrimitiveOptions = Readonly<{
  /** Journal-keyed HMAC evidence. Bare hashes are not accepted. */
  evidenceDigest: BrowserObservationDigest;
  /** Request identity is required for the Send evidence domain. */
  operationId?: string;
  requestDigest?: string;
  /** Raw composer text is retained only in this request-scoped closure. */
  desiredComposerText?: string;
  /** Alias for callers that name the same private value `composerText`. */
  composerText?: string;
  /** Provider claim token, retained in the closure and never returned. */
  authoritativeTabClaim?: string;
  /** Optional target captured by a provider integration before Send. */
  target?: OperationTargetBindingV1;
  /** Optional provider-owned attachment identity observer. */
  observeAttachments?: ProductionPrimitiveAttachmentObserver;
}>;

export type ProductionPrimitiveCapability =
  | "composer_set"
  | "empty_attachment_observation"
  | "send_activation"
  | "collector_snapshot"
  | "durable_baseline_projection"
  | "submission_witness_recovery"
  | "stop_control";

export type ProductionPrimitiveUnwiredCapability =
  | "configuration_set"
  | "tool_selection"
  | "power_select"
  | "file_chooser_handoff"
  | "attachment_identity_for_nonempty_manifest"
  | "work_steer_activation";

export const PRODUCTION_PRIMITIVE_CAPABILITIES: readonly ProductionPrimitiveCapability[] = Object.freeze([
  "composer_set",
  "empty_attachment_observation",
  "send_activation",
  "collector_snapshot",
  "durable_baseline_projection",
  "submission_witness_recovery",
  "stop_control"
]);

/**
 * These are not soft feature flags.  They are an inventory of deliberately
 * missing proof, so a caller cannot mistake an unavailable primitive for a
 * best-effort browser fallback.
 */
export const UNWIRED_PRODUCTION_PRIMITIVES: readonly ProductionPrimitiveUnwiredCapability[] = Object.freeze([
  "configuration_set",
  "tool_selection",
  "power_select",
  "file_chooser_handoff",
  "attachment_identity_for_nonempty_manifest",
  "work_steer_activation"
]);

export const PRODUCTION_OPERATION_PRIMITIVE_INVENTORY = Object.freeze({
  scope: "base_primitive_factory" as const,
  wired: PRODUCTION_PRIMITIVE_CAPABILITIES,
  unwired: UNWIRED_PRODUCTION_PRIMITIVES
});

export class ProductionPrimitiveError extends Error {
  constructor(public readonly code: string) {
    super("The provider-specific operation primitive could not prove the requested action safely.");
    this.name = "ProductionPrimitiveError";
  }
}

type PrimitiveState = {
  operationId?: string;
  requestDigest?: string;
  desiredComposerText?: string;
  authoritativeTabClaim?: string;
  target?: OperationTargetBindingV1;
};

/**
 * Create one request-scoped set of production operation primitives.
 *
 * `operationId`, `requestDigest`, and the composer value should normally be
 * supplied by the lazy runtime capture after the journal has created the
 * operation.  If either identity is absent, Send fails closed rather than
 * fabricating an evidence domain.
 */
export function createProductionOperationPrimitives(
  options: ProductionOperationPrimitiveOptions
): OperationRuntimeBrowserPrimitives {
  validateOptions(options);
  const state: PrimitiveState = {
    ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
    ...(options.requestDigest === undefined ? {} : { requestDigest: options.requestDigest }),
    ...(options.desiredComposerText !== undefined
      ? { desiredComposerText: options.desiredComposerText }
      : options.composerText === undefined ? {} : { desiredComposerText: options.composerText }),
    ...(options.authoritativeTabClaim === undefined ? {} : { authoritativeTabClaim: options.authoritativeTabClaim }),
    ...(options.target === undefined ? {} : { target: options.target })
  };
  const staging: OperationBrowserStagingPrimitive = Object.freeze({
    readCurrent: request => readStaging(request, options.evidenceDigest, state),
    mutateOnce: request => mutateStagingOnce(request, options.evidenceDigest, state),
    observe: request => readStaging(request, options.evidenceDigest, state)
  });

  const sendObservers: SendOnceObservers = Object.freeze({
    observePrecondition: request => observeSendPrecondition(request, options.evidenceDigest, state, options.observeAttachments),
    observePostcondition: async request => {
      const result = await observeSendPostcondition(request, options.evidenceDigest, state);
      return result.status === "blocked"
        && (result.blockerCode === "ambiguous_submit" || result.blockerCode === "target_evidence_unavailable")
        ? { result, retryable: true }
        : result;
    },
    // Every retry is an observation-only transaction. The delay remains
    // outside the tab actor and can never repeat the Send activation.
    sleep: sleepOutsideBrowser,
    // ChatGPT can establish the canonical conversation URL before it exposes
    // stable user/assistant DOM identities. Keep that provider settling window
    // bounded without collapsing a successful one-shot Send into uncertainty.
    maxPostconditionAttempts: 32,
    postconditionIntervalMs: 250,
    postconditionTimeoutMs: 15_000
  });

  const submission: OperationBrowserSubmissionPrimitive = Object.freeze({
    observeStaging: (request, page, target) => observeSubmissionStaging(request, page, target, options.evidenceDigest, state),
    // The file identity layer revalidates paths outside the actor.  There is
    // still no identity-grade provider chooser primitive here, so never begin
    // a chooser mutation under an invented selector or wait loop.
    handoffFiles: async () => ({
      status: "not_satisfied",
      blockerCode: "attachment_manifest_mismatch"
    } satisfies SubmissionHandoffResult),
    observeAttachments: (request, page, target) => observeSubmissionAttachments(request, page, target, options.evidenceDigest, state, options.observeAttachments),
    sendObservers
  });

  const collector: OperationBrowserCollectorPrimitive = Object.freeze({
    readContext: (request, page, target) => readCollectorContext(request, page, target, options.evidenceDigest, state),
    observe: (request, page, target, context) => observeCollector(request, page, target, context, options.evidenceDigest, state),
    // This timer is intentionally outside any tab transaction.  The browser
    // adapter invokes it after its short observation transaction has settled.
    sleep: sleepOutsideBrowser
  });

  const control: OperationBrowserControlPrimitive = Object.freeze({
    observeTurn: (request, page, target) => observeControlTurn(request, page, target, options.evidenceDigest, state),
    executeOnce: (request, page, target) => executeControlOnce(request, page, target, options.evidenceDigest, state),
    observePostcondition: (request, page, target) => observeControlPostcondition(request, page, target, options.evidenceDigest, state)
  });

  return Object.freeze({
    staging,
    submission,
    collector,
    control
  });
}

/** Descriptive aliases for integrations that name the layer after the adapter. */
export const createOperationProductionPrimitives = createProductionOperationPrimitives;
export const createProductionPrimitives = createProductionOperationPrimitives;

async function readStaging(
  request: OperationStagingCallbackRequest & { page: Readonly<PageLike>; target: OperationTargetBindingV1 },
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState
): Promise<OperationStagingObservation> {
  if (request.kind !== "composer_set") {
    return unavailableStaging(request, stagingUnwiredCode(request.kind));
  }
  if (state.desiredComposerText === undefined) {
    return unavailableStaging(request, "composer_primitive_unwired");
  }
  if (!await matchesExpectedStagingDigest(request, evidenceDigest)) {
    return unavailableStaging(request, "composer_request_mismatch");
  }

  const current = await readComposerState(request.page, request.target, request.operationId, evidenceDigest);
  if (current === undefined) return unavailableStaging(request, "composer_control_unavailable");
  const satisfied = current.text === state.desiredComposerText;
  const evidence = await digest(evidenceDigest, "composer-observation", {
    operationId: request.operationId,
    targetBindingDigest: request.targetBindingDigest,
    currentStateDigest: current.currentStateDigest,
    status: satisfied ? "satisfied" : "not_satisfied"
  });
  if (evidence === undefined) return unavailableStaging(request, "evidence_digest_failed");
  return {
    status: satisfied ? "satisfied" : "not_satisfied",
    desiredStateDigest: request.desiredStateDigest,
    currentStateDigest: current.currentStateDigest,
    evidenceDigest: evidence
  };
}

async function mutateStagingOnce(
  request: OperationStagingCallbackRequest & { page: Readonly<PageLike>; target: OperationTargetBindingV1 },
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState
): Promise<OperationStagingMutationResult> {
  if (request.kind !== "composer_set" || state.desiredComposerText === undefined) {
    throw new ProductionPrimitiveError(request.kind === "composer_set" ? "composer_primitive_unwired" : stagingUnwiredCode(request.kind));
  }
  if (!isDigest(request.desiredStateDigest) || !isDigest(request.requestDigest)) {
    throw new ProductionPrimitiveError("composer_request_mismatch");
  }
  const expected = await safeDigestWith(evidenceDigest, "staging-desired", { requestDigest: request.requestDigest, kind: request.kind });
  if (expected === undefined || expected !== request.desiredStateDigest) {
    throw new ProductionPrimitiveError("composer_request_mismatch");
  }
  assertStagingActive(request);
  const locator = await uniqueVisibleLocator(request.page, composerTextbox);
  if (locator === undefined || typeof locator.fill !== "function") {
    throw new ProductionPrimitiveError("composer_control_unavailable");
  }
  // The sole reversible composer mutation.  There is no readiness wait and no
  // fallback press/click path if this call rejects.
  assertStagingActive(request);
  await locator.fill(state.desiredComposerText);
  return { status: "started" };
}

function assertStagingActive(request: Pick<OperationStagingCallbackRequest, "signal" | "deadlineAt">): void {
  if (request.signal?.aborted) throw new ProductionPrimitiveError("operation_cancelled");
  if (request.deadlineAt !== undefined && Date.now() >= request.deadlineAt) throw new ProductionPrimitiveError("operation_deadline_exceeded");
}

function stagingUnwiredCode(kind: OperationStagingCallbackRequest["kind"]): string {
  switch (kind) {
    case "configuration_set": return "configuration_primitive_unwired";
    case "tool_set": return "tool_primitive_unwired";
    case "power_select": return "power_primitive_unwired";
    case "composer_set": return "composer_primitive_unwired";
  }
}

function unavailableStaging(
  request: Pick<OperationStagingCallbackRequest, "desiredStateDigest">,
  blockerCode: string
): OperationStagingObservation {
  return {
    status: "unavailable",
    desiredStateDigest: request.desiredStateDigest,
    blockerCode
  };
}

async function matchesExpectedStagingDigest(
  request: Pick<OperationStagingCallbackRequest, "desiredStateDigest" | "requestDigest" | "kind">,
  evidenceDigest: BrowserObservationDigest
): Promise<boolean> {
  return await safeDigestWith(evidenceDigest, "staging-desired", {
    requestDigest: request.requestDigest,
    kind: request.kind
  }) === request.desiredStateDigest;
}

async function observeSubmissionStaging(
  request: SubmissionStageRequest,
  page: Readonly<PageLike>,
  target: OperationTargetBindingV1,
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState
): Promise<SubmissionStageObservation> {
  state.target = target;
  if (!isDigest(request.configurationReceiptDigest) || !isDigest(request.composerReceiptDigest)) {
    return { status: "unavailable", reason: "unknown" };
  }
  const expectedConfiguration = state.requestDigest === undefined
    ? undefined
    : await safeDigestWith(evidenceDigest, "configuration-request", state.requestDigest);
  const expectedComposer = state.requestDigest === undefined
    ? undefined
    : await safeDigestWith(evidenceDigest, "composer-request", state.requestDigest);
  if (expectedConfiguration === undefined || expectedComposer === undefined) {
    return { status: "unavailable", reason: "target" };
  }
  if (request.configurationReceiptDigest !== expectedConfiguration) {
    const evidence = await safeDigestWith(evidenceDigest, "submission-stage", { operationId: request.operationId, reason: "configuration" });
    return evidence === undefined
      ? { status: "mismatch", reason: "configuration" }
      : { status: "mismatch", reason: "configuration", evidenceDigest: evidence };
  }
  if (request.composerReceiptDigest !== expectedComposer || state.desiredComposerText === undefined) {
    return { status: "unavailable", reason: "composer" };
  }
  const current = await readComposerState(page, target, request.operationId, evidenceDigest);
  if (current === undefined) return { status: "unavailable", reason: "composer" };
  if (current.text !== state.desiredComposerText) {
    return { status: "mismatch", reason: "composer", evidenceDigest: current.evidenceDigest };
  }
  return {
    status: "exact",
    evidenceDigest: current.evidenceDigest
  };
}

async function observeSendPrecondition(
  request: SendOncePreconditionRequest,
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState,
  attachmentObserver: ProductionPrimitiveAttachmentObserver | undefined
): Promise<SendOncePreconditionObservation> {
  const identity = sendIdentity(state, request.expected);
  if (identity === undefined) return { status: "unavailable", code: "target_evidence_unavailable" };
  const target = targetForObservation(request.expected, state);
  if (target === undefined) return { status: "unavailable", code: "target_evidence_unavailable" };
  // Recovery after a durable Send intent is observation-only. A pending new
  // target necessarily no longer renders the blank surface, so re-running the
  // normal precondition would reject the very post-Send state we must inspect.
  // The durable blank-task snapshot is the bounded baseline authority here;
  // the subsequent postcondition still has to prove exactly one new user turn
  // and complete provider conversation identity before establishment.
  if (request.mode === "observe_only" && state.target?.targetLifecycle === "new_pending") {
    const recoveryBaseline = recoverPendingBlankBaseline(state);
    if (recoveryBaseline === undefined) return { status: "unavailable", code: "target_evidence_unavailable" };
    return {
      status: "exact",
      targetBindingDigest: request.expected.targetBindingDigest,
      configurationReceiptDigest: request.expected.configurationReceiptDigest,
      composerReceiptDigest: request.expected.composerReceiptDigest,
      attachments: {
        count: request.expected.attachmentManifest.count,
        orderPolicy: "exact",
        identityDigests: request.expected.attachmentManifest.identities.map(entry => entry.identityDigest)
      },
      baseline: {
        ownershipBaseline: recoveryBaseline,
        userTurnEvidenceDigest: await safeDigestWith(evidenceDigest, "send-baseline", {
          snapshotDigest: recoveryBaseline.snapshotDigest,
          userTurns: []
        }) ?? recoveryBaseline.snapshotDigest
      },
      evidenceDigest: recoveryBaseline.snapshotDigest
    };
  }
  if (state.desiredComposerText === undefined) return { status: "unavailable", code: "composer_drift" };
  const expectedComposer = await safeDigestWith(evidenceDigest, "composer-request", state.requestDigest);
  const expectedConfiguration = await safeDigestWith(evidenceDigest, "configuration-request", state.requestDigest);
  if (expectedComposer === undefined || expectedConfiguration === undefined) {
    return { status: "unavailable", code: "target_evidence_unavailable" };
  }
  if (request.expected.composerReceiptDigest !== expectedComposer) {
    return { status: "mismatch", code: "composer_drift" };
  }
  if (request.expected.configurationReceiptDigest !== expectedConfiguration) {
    return { status: "mismatch", code: "configuration_drift" };
  }

  let observation: BrowserObservationResult;
  try {
    observation = await observeBrowserPage(request.page, {
      operationId: identity,
      target,
      evidenceDigest,
      responseContent: "metadata"
    });
  } catch {
    return { status: "unavailable", code: "target_evidence_unavailable" };
  }
  const snapshot = observation.snapshot;
  if (state.target?.targetLifecycle === "new_pending") {
    const anchor = observation.newTargetAnchor;
    if (
      anchor === undefined
      || anchor.anchorDigest !== state.target.newTargetAnchorDigest
      || anchor.blankTaskEvidenceDigest !== state.target.blankTaskEvidenceDigest
      || snapshot.target.thread.status !== "unavailable"
      || snapshot.target.conversation.status !== "unavailable"
      || snapshot.target.canonicalThreadUrl.status !== "unavailable"
      || snapshot.userTurns.length !== 0
      || snapshot.assistantTurns.length !== 0
    ) {
      return { status: "unavailable", code: "target_evidence_unavailable", evidenceDigest: snapshot.snapshotDigest };
    }
  }
  if (!stableBaseline(snapshot)) {
    return { status: "unavailable", code: "target_evidence_unavailable", evidenceDigest: snapshot.snapshotDigest };
  }
  const composerTarget = state.target;
  if (composerTarget === undefined) return { status: "unavailable", code: "target_evidence_unavailable" };
  const composer = await readComposerState(request.page, composerTarget, identity, evidenceDigest);
  if (composer === undefined) return { status: "unavailable", code: "composer_drift", evidenceDigest: snapshot.snapshotDigest };
  if (composer.text !== state.desiredComposerText) {
    return { status: "mismatch", code: "composer_drift", evidenceDigest: composer.evidenceDigest };
  }

  const attachments = await observeAttachmentEnvelope(
    {
      operationId: identity,
      requestDigest: state.requestDigest!,
      surface: request.expected.surface,
      targetBindingDigest: request.expected.targetBindingDigest,
      manifest: request.expected.attachmentManifest
    },
    request.page,
    composerTarget,
    evidenceDigest,
    state,
    attachmentObserver
  );
  if (attachments.status !== "absent" && attachments.status !== "exact") {
    return { status: "unavailable", code: "attachment_manifest_mismatch", evidenceDigest: snapshot.snapshotDigest };
  }

  const baseline = await baselineForSnapshot(snapshot, evidenceDigest, identity, request.expected.targetBindingDigest);
  if (baseline === undefined) return { status: "unavailable", code: "target_evidence_unavailable", evidenceDigest: snapshot.snapshotDigest };
  const sendAttachments: SendOnceAttachmentObservation = {
    count: attachments.count,
    orderPolicy: "exact",
    identityDigests: [...attachments.identityDigests]
  };
  return {
    status: "exact",
    targetBindingDigest: request.expected.targetBindingDigest,
    configurationReceiptDigest: request.expected.configurationReceiptDigest,
    composerReceiptDigest: request.expected.composerReceiptDigest,
    attachments: sendAttachments,
    baseline: {
      ...(baseline.userTurns.at(-1)?.stableId === undefined ? {} : { userTurnId: baseline.userTurns.at(-1)!.stableId }),
      ownershipBaseline: baseline,
      userTurnEvidenceDigest: await safeDigestWith(evidenceDigest, "send-baseline", {
        snapshotDigest: baseline.snapshotDigest,
        userTurns: baseline.userTurns.map(turn => turn.evidenceDigest)
      }) ?? baseline.snapshotDigest
    },
    evidenceDigest: snapshot.snapshotDigest
  };
}

async function observeSendPostcondition(
  request: SendOncePostconditionRequest,
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState
): Promise<SubmissionFinalTransactionResult> {
  const identity = sendIdentity(state, request.expected);
  if (identity === undefined) return { status: "blocked", blockerCode: "target_evidence_unavailable" };
  // The SendOnce coordinator carries the complete baseline that was either
  // durably appended before activation or projected by the service after a
  // restart. Never fall back to the request-scoped map/current page here.
  const baseline = request.baseline.ownershipBaseline;
  if (baseline === undefined) return { status: "blocked", blockerCode: "target_evidence_unavailable" };
  // A process restart loses the in-memory baseline map. The durable pending
  // target's blank-task evidence is the only safe recovery prefix: it proves
  // that the operation owned zero turns before its one durable Send intent.
  const target = targetForObservation(request.expected, state);
  if (target === undefined) return { status: "blocked", blockerCode: "target_evidence_unavailable" };
  let observation: BrowserObservationResult;
  try {
    observation = await observeBrowserPage(request.page, {
      operationId: identity,
      target,
      evidenceDigest,
      responseContent: "metadata",
      baseline
    });
  } catch {
    return { status: "blocked", blockerCode: "target_evidence_unavailable" };
  }
  const delta = observation.snapshot.postSendDelta;
  if (delta === undefined || delta.baselineSnapshotDigest !== baseline.snapshotDigest) {
    return { status: "blocked", blockerCode: "ambiguous_submit", evidenceDigest: observation.snapshot.snapshotDigest };
  }
  const added = observation.snapshot.userTurns.filter(turn => delta.addedUserEvidenceDigests.includes(turn.evidenceDigest));
  if (added.length !== 1) {
    return {
      status: "blocked",
      blockerCode: added.length > 1 ? "concurrent_user_turn" : "ambiguous_submit",
      evidenceDigest: observation.snapshot.snapshotDigest
    };
  }
  const user = added[0];
  if (user?.stableId === undefined) {
    return { status: "blocked", blockerCode: "target_evidence_unavailable", evidenceDigest: observation.snapshot.snapshotDigest };
  }
  const assistant = observation.snapshot.assistantTurns.find(turn => turn.parentStableId === user.stableId);
  const status = request.mode === "observe_only" ? "already_submitted" : "submitted";
  const established = state.target?.targetLifecycle === "new_pending"
    ? (() => {
        const conversation = observation.snapshot.target.conversation;
        const canonicalThreadUrl = observation.snapshot.target.canonicalThreadUrl;
        if (
          conversation.status !== "available"
          || canonicalThreadUrl.status !== "available"
          || state.target.newTargetAnchorDigest === undefined
        ) return undefined;
        return {
          targetBindingDigest: request.expected.targetBindingDigest,
          anchorDigest: state.target.newTargetAnchorDigest,
          causalSendActionId: request.actionId,
          conversationId: conversation.value,
          canonicalThreadUrl: canonicalThreadUrl.value,
          userTurnId: user.stableId,
          userTurnEvidenceDigest: user.evidenceDigest,
          postSendDeltaDigest: delta.deltaDigest,
          evidenceDigest: observation.snapshot.snapshotDigest
        };
      })()
    : undefined;
  if (state.target?.targetLifecycle === "new_pending" && established === undefined) {
    return { status: "blocked", blockerCode: "target_evidence_unavailable", evidenceDigest: observation.snapshot.snapshotDigest };
  }
  return {
    status,
    targetBindingDigest: request.expected.targetBindingDigest,
    evidenceDigest: observation.snapshot.snapshotDigest,
    userTurnId: user.stableId,
    userTurnEvidenceDigest: user.evidenceDigest,
    postSendDeltaDigest: delta.deltaDigest,
    ...(assistant?.stableId === undefined ? {} : { assistantTurnId: assistant.stableId }),
    ...(established === undefined ? {} : { targetEstablishment: established })
  };
}

async function observeSubmissionAttachments(
  request: SubmissionAttachmentRequest,
  page: Readonly<PageLike>,
  target: OperationTargetBindingV1,
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState,
  attachmentObserver: ProductionPrimitiveAttachmentObserver | undefined
): Promise<SubmissionAttachmentObservation> {
  state.target = target;
  return await observeAttachmentEnvelope(request, page, target, evidenceDigest, state, attachmentObserver);
}

async function observeAttachmentEnvelope(
  request: SubmissionAttachmentRequest,
  page: Readonly<PageLike>,
  target: OperationTargetBindingV1,
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState,
  attachmentObserver: ProductionPrimitiveAttachmentObserver | undefined
): Promise<SubmissionAttachmentObservation> {
  if (attachmentObserver !== undefined && request.manifest.count > 0) {
    try {
      return await attachmentObserver(request, page, target);
    } catch {
      return { status: "unavailable" };
    }
  }
  if (request.manifest.count > 0) return { status: "unavailable" };
  const result = await readChatGPTEmptyAttachmentState(page);
  if (result === undefined || !result.supported) return { status: "unavailable" };
  if (result.count !== 0 || result.visibleAttachmentCount !== 0) return { status: "mismatch" };
  const evidence = await safeDigestWith(evidenceDigest, "composer-attachments", {
    operationId: request.operationId,
    targetBindingDigest: request.targetBindingDigest,
    count: 0
  });
  if (evidence === undefined) return { status: "unavailable" };
  return {
    status: "absent",
    evidenceDigest: evidence,
    count: 0,
    orderPolicy: "exact",
    identityDigests: []
  };
}

async function readComposerState(
  page: Readonly<PageLike>,
  target: OperationTargetBindingV1,
  operationId: string,
  evidenceDigest: BrowserObservationDigest
): Promise<{ text: string; currentStateDigest: string; evidenceDigest: string } | undefined> {
  void target;
  const locator = await uniqueVisibleLocator(page, composerTextbox);
  if (locator === undefined) return undefined;
  const text = await readLocatorText(locator);
  if (text === undefined || text.length > MAX_COMPOSER_CHARS || text.includes("\u0000")) return undefined;
  const currentStateDigest = await safeDigestWith(evidenceDigest, "composer-state", {
    operationId,
    text
  });
  if (currentStateDigest === undefined) return undefined;
  const observationDigest = await safeDigestWith(evidenceDigest, "composer-observation", {
    operationId,
    currentStateDigest
  });
  if (observationDigest === undefined) return undefined;
  return { text, currentStateDigest, evidenceDigest: observationDigest };
}

async function readLocatorText(locator: LocatorLike): Promise<string | undefined> {
  try {
    // The locator textContent/innerText fallbacks expose no provider-side
    // maximum and would materialize an unbounded string before this adapter
    // could inspect it.  The transactional path therefore requires evaluate
    // so the cap is enforced inside the browser realm.
    if (typeof locator.evaluate !== "function") return undefined;
    const value = await locator.evaluate(inspectComposerText);
    return typeof value === "string" && value.length <= MAX_COMPOSER_CHARS ? value : undefined;
  } catch {
    return undefined;
  }
  return undefined;
}

async function uniqueVisibleLocator(
  page: Readonly<PageLike>,
  factory: (page: PageLike) => LocatorLike
): Promise<LocatorLike | undefined> {
  if (typeof page.getByRole !== "function") return undefined;
  let locator: LocatorLike;
  try {
    locator = factory(page as PageLike);
  } catch {
    return undefined;
  }
  if (typeof locator.count !== "function") return undefined;
  let count: number;
  try {
    count = await locator.count();
  } catch {
    return undefined;
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_LOCATOR_CANDIDATES) return undefined;
  const visible: LocatorLike[] = [];
  for (let index = 0; index < count; index += 1) {
    const candidate = count === 1 ? locator : locator.nth?.(index);
    if (candidate === undefined || typeof candidate.isVisible !== "function") return undefined;
    try {
      if (await candidate.isVisible()) visible.push(candidate);
    } catch {
      return undefined;
    }
  }
  return visible.length === 1 ? visible[0] : undefined;
}

function targetForObservation(
  expected: SubmissionExpectedEnvelope,
  state: PrimitiveState
): {
  providerId: string;
  browserId: string;
  tabId: string;
  coordinationScope: "process" | "provider";
  authoritativeTabClaim?: string;
  expectedConversationId?: string;
} | undefined {
  void expected;
  return state.target === undefined ? undefined : buildObservationTarget(state.target, state.authoritativeTabClaim);
}

function sendIdentity(state: PrimitiveState, expected: SubmissionExpectedEnvelope): string | undefined {
  if (state.operationId === undefined || !isId(state.operationId) || state.requestDigest === undefined || !isDigest(state.requestDigest)) return undefined;
  if (!isDigest(expected.targetBindingDigest)) return undefined;
  return state.operationId;
}

function stableBaseline(snapshot: OwnershipSnapshot): boolean {
  return snapshot.completeness === "complete"
    && snapshot.userTurns.every(turn => turn.stableId !== undefined);
}

async function baselineForSnapshot(
  snapshot: OwnershipSnapshot,
  evidenceDigest: BrowserObservationDigest,
  operationId: string,
  targetBindingDigest: string
): Promise<OwnershipBaseline | undefined> {
  if (snapshot.completeness !== "complete" || !stableBaseline(snapshot)) return undefined;
  const snapshotDigest = await safeDigestWith(evidenceDigest, "send-baseline-snapshot", {
    operationId,
    targetBindingDigest,
    snapshotDigest: snapshot.snapshotDigest
  }) ?? snapshot.snapshotDigest;
  return {
    schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
    snapshotDigest,
    target: snapshot.target,
    userTurns: snapshot.userTurns,
    assistantTurns: snapshot.assistantTurns,
    completeness: "complete"
  };
}

function recoverPendingBlankBaseline(
  state: PrimitiveState
): OwnershipBaseline | undefined {
  const target = state.target;
  if (
    target === undefined
    || target.targetLifecycle !== "new_pending"
    || target.blankTaskEvidenceDigest === undefined
    || !isDigest(target.blankTaskEvidenceDigest)
  ) return undefined;
  const observationTarget = buildObservationTarget(target, state.authoritativeTabClaim);
  if (observationTarget === undefined) return undefined;
  const available = (value: string): OwnershipIdentityEvidence => ({ status: "available", value });
  const unavailable = (): OwnershipIdentityEvidence => ({ status: "unavailable", reason: "not_observed" });
  const targetEvidence: OwnershipTargetEvidence = {
    provider: available(observationTarget.providerId),
    browser: available(observationTarget.browserId),
    tab: available(observationTarget.tabId),
    thread: unavailable(),
    conversation: unavailable(),
    canonicalThreadUrl: unavailable(),
    authoritativeTabClaim: observationTarget.authoritativeTabClaim === undefined
      ? { status: "unavailable", reason: "not_exposed" }
      : available(observationTarget.authoritativeTabClaim),
    coordinationScope: observationTarget.coordinationScope
  };
  return {
    schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
    snapshotDigest: target.blankTaskEvidenceDigest,
    target: targetEvidence,
    userTurns: [],
    assistantTurns: [],
    completeness: "complete"
  };
}

function buildObservationTarget(
  target: OperationTargetBindingV1,
  authoritativeTabClaim: string | undefined
): {
  providerId: string;
  browserId: string;
  tabId: string;
  coordinationScope: "process" | "provider";
  authoritativeTabClaim?: string;
  expectedConversationId?: string;
  targetLifecycle: "fixed" | "new_pending" | "new_established";
} | undefined {
  if (
    !isId(target.providerId)
    || !isId(target.browserId)
    || !isId(target.tabId)
  ) {
    return undefined;
  }
  const lifecycle = target.targetLifecycle ?? "fixed";
  if (lifecycle !== "new_pending" && (
    target.conversationId === undefined
    || !isId(target.conversationId)
    || target.canonicalThreadUrl === undefined
    || !OPAQUE_THREAD_URL_PATTERN.test(target.canonicalThreadUrl)
  )) return undefined;
  if (lifecycle === "new_pending" && (
    target.newTargetAnchorDigest === undefined
    || target.blankTaskEvidenceDigest === undefined
    || !isDigest(target.newTargetAnchorDigest)
    || !isDigest(target.blankTaskEvidenceDigest)
  )) return undefined;
  if (target.coordinationScope === "provider" && (authoritativeTabClaim === undefined || !isId(authoritativeTabClaim))) return undefined;
  return {
    providerId: target.providerId,
    browserId: target.browserId,
    tabId: target.tabId,
    coordinationScope: target.coordinationScope,
    targetLifecycle: lifecycle,
    ...(authoritativeTabClaim === undefined ? {} : { authoritativeTabClaim }),
    ...(target.conversationId === undefined ? {} : { expectedConversationId: target.conversationId })
  };
}

function makeObservationTarget(
  target: OperationTargetBindingV1,
  state: PrimitiveState
): ReturnType<typeof buildObservationTarget> {
  return buildObservationTarget(target, state.authoritativeTabClaim);
}

async function readCollectorContext(
  request: OperationCollectorContextRequest,
  page: Readonly<PageLike>,
  target: OperationTargetBindingV1,
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState
): Promise<OperationCollectorContext> {
  if (request.submissionActionId === undefined || !isId(request.submissionActionId)) throw new ProductionPrimitiveError("submission_witness_unwired");
  // The service projects the authenticated causal baseline into every
  // collect attempt. Use it for this context read as well, so a later
  // observation can request terminal metadata for the exact assistant turn
  // even when a previous wait:false call returned to the caller.
  const baseline = request.baseline;
  if (baseline === undefined) throw new ProductionPrimitiveError("target_evidence_unavailable");
  const observationTarget = makeObservationTarget(target, state);
  if (observationTarget === undefined) throw new ProductionPrimitiveError("target_evidence_unavailable");
  const observation = await observeBrowserPage(page, {
    operationId: request.operationId,
    target: observationTarget,
    evidenceDigest,
    responseContent: "metadata",
    baseline
  });
  const binding: OwnershipBinding = {
    schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
    operationId: request.operationId,
    targetBindingDigest: request.targetBindingDigest,
    target: observation.snapshot.target,
    evidenceProfile: {
      stableConversationId: "required",
      stableUserTurnId: "required",
      stableAssistantTurnId: "required",
      stableBranchId: "required",
      authoritativeTabClaim: target.coordinationScope === "provider" ? "required" : "unavailable"
    },
    replacementTabRecovery: false,
    actionId: request.submissionActionId,
    actionKind: request.submissionActionKind ?? "send"
  };
  // This cursor is only a candidate from the immediately preceding read. The
  // service keeps the journal baseline/witness authoritative, and the
  // collector reclassifies the next snapshot against both before using it.
  // Never fabricate a cursor when the authenticated witness is absent or the
  // exact delta cannot be classified.
  let prior: OperationCollectorContext["prior"];
  if (request.submissionWitness !== undefined) {
    try {
      prior = classifyTurnOwnership({
        binding,
        baseline,
        snapshot: observation.snapshot,
        submissionWitness: request.submissionWitness
      }).cursor;
    } catch {
      prior = undefined;
    }
  }
  return {
    binding,
    baseline,
    ...(prior === undefined ? {} : { prior })
  };
}

async function observeCollector(
  request: CollectorObservationRequest,
  page: Readonly<PageLike>,
  target: OperationTargetBindingV1,
  context: OperationCollectorContext,
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState
): Promise<CollectorObservation> {
  const observationTarget = makeObservationTarget(target, state);
  if (observationTarget === undefined) throw new ProductionPrimitiveError("target_evidence_unavailable");
  const result = await observeBrowserPage(page, {
    operationId: request.operationId,
    target: observationTarget,
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
    schemaVersion: COLLECTOR_SCHEMA_VERSION,
    snapshot: result.snapshot,
    ...(result.terminal === undefined ? {} : { terminal: result.terminal })
  };
}

async function sleepOutsideBrowser(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 60_000) throw new ProductionPrimitiveError("invalid_sleep");
  if (signal.aborted) throw new ProductionPrimitiveError("operation_cancelled");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new ProductionPrimitiveError("operation_cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function observeControlTurn(
  request: ControlTurnObservationRequest,
  page: Readonly<PageLike>,
  target: OperationTargetBindingV1,
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState
): Promise<ControlTurnObservation> {
  const observation = await observeControlSnapshot(request.operationId, page, target, evidenceDigest, state);
  if (observation === undefined) return { status: "uncertain", reason: "unavailable" };
  const assistant = observation.snapshot.assistantTurns.find(turn => turn.stableId === request.expectedAssistantTurnId);
  if (assistant === undefined) return { status: "mismatch", reason: "different_turn", evidenceDigest: observation.snapshot.snapshotDigest };
  if (assistant.state === "generating") {
    return { status: "generating", assistantTurnId: request.expectedAssistantTurnId, evidenceDigest: assistant.evidenceDigest };
  }
  return { status: "terminal", assistantTurnId: request.expectedAssistantTurnId, reason: "not_generating", evidenceDigest: assistant.evidenceDigest };
}

async function executeControlOnce(
  request: ControlExecutionRequest,
  page: Readonly<PageLike>,
  target: OperationTargetBindingV1,
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState
): Promise<ControlPostconditionObservation> {
  if (request.action !== "stop") return { status: "uncertain", blockerCode: "send_control_unavailable" };
  const locator = await uniqueVisibleLocator(page, stopGenerationButton);
  if (locator === undefined || typeof locator.click !== "function") return { status: "uncertain", blockerCode: "send_control_unavailable" };
  try {
    // Sole Stop activation. A rejection is not retried and is reconciled by
    // the control coordinator's observation-only path.
    await locator.click();
  } catch {
    return { status: "uncertain", blockerCode: "send_control_unavailable" };
  }
  // Release the mutation actor before reading the postcondition. Returning an
  // uncertain result instructs the control coordinator to reacquire the tab
  // through its observation-only port; it must never make this primitive hold
  // the actor across both activation and reconciliation.
  return { status: "uncertain" };
}

async function observeControlPostcondition(
  request: ControlPostconditionRequest,
  page: Readonly<PageLike>,
  target: OperationTargetBindingV1,
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState
): Promise<ControlPostconditionObservation> {
  if (request.action !== "stop") return { status: "uncertain", blockerCode: "send_control_unavailable" };
  const observation = await observeControlSnapshot(request.operationId, page, target, evidenceDigest, state);
  if (observation === undefined) return { status: "uncertain", blockerCode: "target_evidence_unavailable" };
  const assistant = observation.snapshot.assistantTurns.find(turn => turn.stableId === request.expectedAssistantTurnId);
  if (assistant === undefined) return { status: "not_satisfied", blockerCode: "target_binding_mismatch", evidenceDigest: observation.snapshot.snapshotDigest };
  if (assistant.state === "generating") return { status: "not_satisfied", blockerCode: "send_control_unavailable", evidenceDigest: observation.snapshot.snapshotDigest };
  return { status: "satisfied", assistantTurnId: request.expectedAssistantTurnId, evidenceDigest: assistant.evidenceDigest };
}

async function observeControlSnapshot(
  operationId: string,
  page: Readonly<PageLike>,
  target: OperationTargetBindingV1,
  evidenceDigest: BrowserObservationDigest,
  state: PrimitiveState
): Promise<BrowserObservationResult | undefined> {
  const observationTarget = makeObservationTarget(target, state);
  if (observationTarget === undefined) return undefined;
  try {
    return await observeBrowserPage(page, {
      operationId,
      target: observationTarget,
      evidenceDigest,
      responseContent: "metadata"
    });
  } catch {
    return undefined;
  }
}

async function safeDigestWith(
  evidenceDigest: BrowserObservationDigest,
  domain: string,
  material: unknown
): Promise<string | undefined> {
  try {
    const value = await evidenceDigest(domain, material);
    return isDigest(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function digest(
  evidenceDigest: BrowserObservationDigest,
  domain: string,
  material: unknown
): Promise<string | undefined> {
  return await safeDigestWith(evidenceDigest, domain, material);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function validateOptions(options: ProductionOperationPrimitiveOptions): void {
  if (options === null || typeof options !== "object" || Array.isArray(options) || typeof options.evidenceDigest !== "function") {
    throw new ProductionPrimitiveError("invalid_options");
  }
  if (options.operationId !== undefined && !isId(options.operationId)) throw new ProductionPrimitiveError("invalid_options");
  if (options.requestDigest !== undefined && !isDigest(options.requestDigest)) throw new ProductionPrimitiveError("invalid_options");
  if (options.authoritativeTabClaim !== undefined && !isId(options.authoritativeTabClaim)) throw new ProductionPrimitiveError("invalid_options");
  if (options.desiredComposerText !== undefined && typeof options.desiredComposerText !== "string") throw new ProductionPrimitiveError("invalid_options");
  if (options.composerText !== undefined && typeof options.composerText !== "string") throw new ProductionPrimitiveError("invalid_options");
  if (options.observeAttachments !== undefined && typeof options.observeAttachments !== "function") throw new ProductionPrimitiveError("invalid_options");
  if (options.target !== undefined && (options.target === null || typeof options.target !== "object" || Array.isArray(options.target))) throw new ProductionPrimitiveError("invalid_options");
}
