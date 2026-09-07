import {
  attachChatGPTBrowser,
  isChatGPTUrl,
  resolveChatGPTBrowser,
  tabIdFromPage
} from "../browser/attach.js";
import { CHATGPT_HOME } from "../browser/chatgpt-url.js";
import { composerTextbox, sendButton } from "../dom/selectors.js";
import { parseConversationId } from "../browser/page-state.js";
import {
  detectExperienceFromSnapshot,
  openExperience,
  readSurfaceSnapshot
} from "../commands/experience.js";
import type {
  BootstrapArgs,
  BrowserLike,
  ClipboardLike,
  PageLike,
  RuntimeEnv
} from "../types.js";
import {
  coordinatedBrowserResource,
  unwrapCoordinatedBrowser,
} from "../runtime/coordinated-browser.js";
import { unwrapCoordinatedPage } from "../runtime/coordinated-page.js";
import {
  getProcessTabCoordinator,
  type CoordinatorOwner,
  type ProcessTabCoordinator
} from "../runtime/tab-coordinator.js";
import type { OperationRuntimeCapabilities } from "../runtime/operation-context.js";
import {
  createProductionConfigurationStaging
} from "./production-configuration.js";
import { revalidateOperationFile } from "./file-identity.js";
import { createChatGPTAttachmentProviderAsync } from "./production-chatgpt-attachments.js";
import {
  createProductionOperationPrimitives,
  type ProductionOperationPrimitiveOptions
} from "./production-primitives.js";
import {
  createRuntimeOperationBrowserAdapter,
  type OperationRuntimeBrowserCapture,
  type OperationRuntimeBrowserPrimitives,
  type OperationRuntimeAdapterOptions
} from "./runtime-adapter.js";
import {
  createProductionChatGPTArtifacts,
  type ProductionChatGPTArtifacts
} from "./production-chatgpt-artifacts.js";
import {
  createProductionWorkSteerPrimitive,
  type ProductionWorkSteerResult,
  type ProductionWorkSteerObservationRequest
} from "./production-work-steer.js";
import {
  assertAuthenticatedSendRecovery,
  createOperationBrowserAdapter,
  recoverAuthenticatedBrowserSend,
  type OperationBrowserCurrentTargetResult,
  type OperationBrowserCurrentTargetRequest,
  type OperationBrowserTargetProbe,
  type OperationBrowserTargetProbeRequest
} from "./browser-adapter.js";
import type { OperationBrowserAdapter } from "./service.js";
import {
  observeBrowserPage,
  type BrowserObservationTarget
} from "./browser-observation.js";
import type { OperationBrowserStagingPrimitive } from "./browser-adapter.js";
import type {
  BrowserTargetEvidenceDigest
} from "./browser-target.js";
import type {
  OperationAdapterFactory,
  OperationAdapterFactoryContext,
  OperationHandleAdapterFactory,
  OperationHandleAdapterFactoryContext,
  OperationControlAdapterFactory,
  OperationControlAdapterFactoryContext
} from "./client.js";
import type {
  ControlSteerPhaseResult,
  ControlSteerPrepared,
  ControlSteerPrepareRequest,
  ControlSteerExecutePreparedRequest,
  ControlSteerVerifyRequest,
  ControlSteerRecoverRequest
} from "./control.js";
import type { LocatorLike } from "../types.js";
import type {
  OperationConfigurationRequestV1,
  OperationSurface,
  OperationTargetBindingV1,
  OperationTargetRequestV1
} from "./types.js";

/**
 * Configuration for the default ChatGPT browser runtime.
 *
 * The environment is copied once when this factory is created.  Browser
 * attachment itself remains inside the per-request capture callback, which
 * OperationClient invokes only after the journal has created the operation
 * record.  A caller may supply provider-specific primitives later without
 * changing target binding or recovery semantics.
 */
export type ChatGPTRuntimeFactoryOptions = Readonly<{
  env: RuntimeEnv;
  owner: CoordinatorOwner;
  evidenceDigest: BrowserTargetEvidenceDigest;
  coordinator?: ProcessTabCoordinator;
  transactionTimeoutMs?: number;
  surfaceTimeoutMs?: number;
  /**
   * Provider-advertised, integration-tested concurrency capabilities. Missing
   * fields are false. The default ChatGPT bridge deliberately does not claim
   * different-tab overlap until its embedding supplies this evidence.
   */
  capabilities?: Partial<OperationRuntimeCapabilities>;
  /** Optional request-local augmentation for provider primitives under active integration. */
  primitives?: (
    context: ChatGPTPrimitiveFactoryContext
  ) => Partial<OperationRuntimeBrowserPrimitives> | undefined;
}>;

export type ChatGPTPrimitiveFactoryContext = Readonly<{
  operationId: string;
  requestDigest: string;
  surface: OperationSurface;
  prompt?: string;
  configuration?: OperationConfigurationRequestV1;
  files: OperationAdapterFactoryContext["files"];
  signal: AbortSignal;
  page: Readonly<PageLike>;
  target?: OperationTargetBindingV1;
}>;

/**
 * Create a fresh, prompt-bearing control adapter. The prompt is accepted only
 * for this invocation and is never cached or forwarded through durable phase
 * records. The factory binds the authenticated parent target by tab ID.
 */
export function createChatGPTOperationControlAdapterFactory(
  options: ChatGPTRuntimeFactoryOptions
): OperationControlAdapterFactory {
  const normalized = normalizeFactoryOptions(options);
  return async (context: OperationControlAdapterFactoryContext): Promise<OperationBrowserAdapter> => {
    const request = snapshotControlRequest(context.request);
    const target = snapshotTargetBinding(context.target);
    const targetRequest: OperationTargetRequestV1 = Object.freeze({ type: "tab_id", tabId: target.tabId });
    const parentOperationId = context.handle.operationId;
    const parentRequestDigest = context.handle.requestDigest;
    const targetBindingDigest = context.handle.targetBindingDigest;
    if (targetBindingDigest === undefined) throw new ChatGPTRuntimeFactoryError();
    const adapterOptions: OperationRuntimeAdapterOptions = {
      owner: normalized.owner,
      evidenceDigest: normalized.evidenceDigest,
      ...(normalized.coordinator === undefined ? {} : { coordinator: normalized.coordinator }),
      ...(normalized.transactionTimeoutMs === undefined ? {} : { transactionTimeoutMs: normalized.transactionTimeoutMs }),
      exposeStaging: false,
      exposeControl: true,
      recovery: Object.freeze({
        operationId: parentOperationId,
        requestDigest: parentRequestDigest,
        surface: context.state.surface,
        target,
        targetRequest
      }),
      capture: async captureRequest => await captureChatGPTRequest({
        ...normalized,
        request: undefined,
        files: Object.freeze([]),
        captureRequest,
        recoveryTarget: target,
        control: Object.freeze({
          request,
          targetBindingDigest
        })
      })
    };
    return createRuntimeOperationBrowserAdapter(adapterOptions);
  };
}

/** Alias for callers that use the shorter control-factory name. */
export const createChatGPTControlAdapterFactory = createChatGPTOperationControlAdapterFactory;

export class ChatGPTRuntimeFactoryError extends Error {
  readonly code = "chatgpt_runtime_unavailable" as const;

  constructor() {
    super("The ChatGPT operation runtime could not prove the requested browser target safely.");
    this.name = "ChatGPTRuntimeFactoryError";
  }
}

const DEFAULT_SURFACE_TIMEOUT_MS = 30_000;
const MAX_SURFACE_TIMEOUT_MS = 120_000;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,512}$/u;

/**
 * Create the normal request-scoped adapter factory for `ChatGPTClient`.
 *
 * The returned factory performs no browser work until its capture callback is
 * reached by `resolveTarget`.  It is therefore safe to construct while a
 * client is being initialized or while the browser bridge is unavailable.
 */
export function createChatGPTOperationAdapterFactory(
  options: ChatGPTRuntimeFactoryOptions
): OperationAdapterFactory {
  const normalized = normalizeFactoryOptions(options);
  return async (context: OperationAdapterFactoryContext): Promise<OperationBrowserAdapter> => {
    const request = snapshotRequest(context.request);
    const files = Object.freeze([...context.files]);
    const adapterOptions: OperationRuntimeAdapterOptions = {
      owner: normalized.owner,
      evidenceDigest: normalized.evidenceDigest,
      ...(normalized.coordinator === undefined ? {} : { coordinator: normalized.coordinator }),
      ...(normalized.transactionTimeoutMs === undefined ? {} : { transactionTimeoutMs: normalized.transactionTimeoutMs }),
      files,
      fileManifestDigest: (ordinal, manifest) => normalized.evidenceDigest(
        "file-manifest",
        { ordinal, ...manifest }
      ),
      exposeStaging: true,
      exposeControl: true,
      recoverAuthenticatedSend: async recovery => {
        try {
          assertAuthenticatedSendRecovery(recovery);
          if (recovery.operationId !== request.operationId || recovery.surface !== request.surface
            || recovery.signal?.aborted || (recovery.deadlineAt !== undefined && Date.now() >= recovery.deadlineAt)) {
            return { result: { status: "blocked", blockerCode: "target_binding_mismatch" } };
          }
          const expectedText = request.prompt.replace(/\s+/g, " ").trim().normalize("NFC");
          const matchingTurns = new Set<string>();
          let matchingProbe = false;
          const digest: BrowserTargetEvidenceDigest = async (domain, material) => {
            const result = await normalized.evidenceDigest(domain, material);
            if (matchingProbe && domain === "browser-observation-turn" && material !== null && typeof material === "object"
              && readDataProperty(material, "operationId") === request.operationId
              && readDataProperty(material, "role") === "user" && readDataProperty(material, "text") === expectedText) {
              matchingTurns.add(result);
            }
            return result;
          };
          const captured = await captureChatGPTRequest({
            ...normalized, evidenceDigest: digest, request: undefined, files: Object.freeze([]),
            captureRequest: { operationId: recovery.operationId, requestDigest: recovery.requestDigest, surface: recovery.surface,
              target: { type: "tab_id", tabId: recovery.target.tabId }, signal: recovery.signal ?? new AbortController().signal },
            recoveryTarget: recovery.target
          });
          const base = captured.primitives?.submission?.sendObservers;
          if (base === undefined) return { result: { status: "blocked", blockerCode: "target_evidence_unavailable" } };
          const result = await recoverAuthenticatedBrowserSend(recovery, {
            page: captured.page, owner: normalized.owner, coordinator: normalized.coordinator,
            evidenceDigest: digest,
            ...(captured.capabilities === undefined ? {} : { capabilities: captured.capabilities }),
            ...(captured.authoritativeClaim === undefined ? {} : { authoritativeClaim: captured.authoritativeClaim }),
            ...(captured.observeCurrentTarget === undefined ? {} : { observeCurrentTarget: captured.observeCurrentTarget }),
            ...(normalized.transactionTimeoutMs === undefined ? {} : { transactionTimeoutMs: normalized.transactionTimeoutMs }),
            sendObservers: { ...base, observePostcondition: async probe => {
              matchingTurns.clear();
              matchingProbe = true;
              try {
                const observed = await base.observePostcondition(probe);
                const result = "result" in observed ? observed.result : observed;
                if ((result.status === "submitted" || result.status === "already_submitted")
                  && !matchingTurns.has(result.userTurnEvidenceDigest)) {
                  return { result: { status: "blocked", blockerCode: "ambiguous_submit" }, retryable: false };
                }
                return observed;
              } finally {
                matchingProbe = false;
                matchingTurns.clear();
              }
            } }
          });
          if (result.status !== "submitted" && result.status !== "already_submitted") return { result };
          const proof = result.targetEstablishment;
          const target: OperationTargetBindingV1 = recovery.target.targetLifecycle === "new_pending" && proof !== undefined
            ? { ...recovery.target, targetLifecycle: "new_established",
              evidenceProfile: { ...recovery.target.evidenceProfile, stableConversationId: "required", stableUserTurnId: "required" },
              conversationId: proof.conversationId,
              canonicalThreadUrl: proof.canonicalThreadUrl,
              targetEstablishment: { ...proof, observedAt: new Date().toISOString() } }
            : recovery.target;
          // The service calls collection only after durably accepting this
          // proof. Retain only read ports, bound to the proved conversation.
          const readAdapter = createOperationBrowserAdapter({
            page: captured.page, owner: normalized.owner, evidenceDigest: normalized.evidenceDigest,
            coordinator: normalized.coordinator,
            ...(captured.observeCurrentTarget === undefined ? {} : { observeCurrentTarget: captured.observeCurrentTarget }),
            ...(captured.capabilities === undefined ? {} : { capabilities: captured.capabilities }),
            ...(captured.authoritativeClaim === undefined ? {} : { authoritativeClaim: captured.authoritativeClaim }),
            ...(captured.primitives?.collector === undefined ? {} : { collector: captured.primitives.collector }),
            recovery: { operationId: recovery.operationId, requestDigest: recovery.requestDigest,
              surface: recovery.surface, target, signal: recovery.signal ?? new AbortController().signal }
          });
          return { result, collector: readAdapter.collector };
        } catch {
          return { result: { status: "blocked", blockerCode: "target_evidence_unavailable" } };
        }
      },
      ...(hasTransferDestination(request) ? { exposeArtifacts: true } : {}),
      capture: async captureRequest => {
        // `captureRequest` is reached only after OperationService has created
        // the operation record.  Never move this call into factory creation.
        return await captureChatGPTRequest({
          ...normalized,
          request,
          files,
          captureRequest,
          recoveryTarget: undefined
        });
      }
    };
    return createRuntimeOperationBrowserAdapter(adapterOptions);
  };
}

/** Alias for integrations that use the "runtime" naming first. */
export const createChatGPTOperationRuntimeFactory = createChatGPTOperationAdapterFactory;

/**
 * Create the restart-safe handle factory.  Recovery always attaches by the
 * durable tab id; it never falls back to the selected tab or a replacement.
 */
export function createChatGPTOperationHandleAdapterFactory(
  options: ChatGPTRuntimeFactoryOptions
): OperationHandleAdapterFactory {
  const normalized = normalizeFactoryOptions(options);
  return async (context: OperationHandleAdapterFactoryContext): Promise<OperationBrowserAdapter> => {
    const target = snapshotTargetBinding(context.target);
    const targetRequest: OperationTargetRequestV1 = Object.freeze({
      type: "tab_id",
      tabId: target.tabId
    });
    const adapterOptions: OperationRuntimeAdapterOptions = {
      owner: normalized.owner,
      evidenceDigest: normalized.evidenceDigest,
      ...(normalized.coordinator === undefined ? {} : { coordinator: normalized.coordinator }),
      ...(normalized.transactionTimeoutMs === undefined ? {} : { transactionTimeoutMs: normalized.transactionTimeoutMs }),
      exposeStaging: false,
      exposeControl: true,
      recovery: Object.freeze({
        operationId: context.operationId,
        requestDigest: context.requestDigest,
        surface: context.surface,
        target,
        targetRequest
      }),
      capture: async captureRequest => await captureChatGPTRequest({
        ...normalized,
        request: undefined,
        files: Object.freeze([]),
        captureRequest,
        recoveryTarget: target
      })
    };
    return createRuntimeOperationBrowserAdapter(adapterOptions);
  };
}

/** Alias retained for callers that call the restart path a recovery factory. */
export const createChatGPTOperationRecoveryFactory = createChatGPTOperationHandleAdapterFactory;

type NormalizedFactoryOptions = Readonly<{
  env: RuntimeEnv;
  owner: CoordinatorOwner;
  evidenceDigest: BrowserTargetEvidenceDigest;
  coordinator: ProcessTabCoordinator;
  transactionTimeoutMs?: number;
  surfaceTimeoutMs: number;
  capabilities: OperationRuntimeCapabilities;
  primitives?: ChatGPTRuntimeFactoryOptions["primitives"];
}>;

type CaptureRequestOptions = NormalizedFactoryOptions & Readonly<{
  request: OperationAdapterFactoryContext["request"] | undefined;
  files: readonly OperationAdapterFactoryContext["files"][number][];
  captureRequest: Parameters<NonNullable<OperationRuntimeAdapterOptions["capture"]>>[0];
  recoveryTarget: OperationTargetBindingV1 | undefined;
  control?: Readonly<{
    request: OperationControlRequestSnapshot;
    targetBindingDigest: string;
  }>;
}>;

type OperationControlRequestSnapshot = Readonly<{
  schemaVersion: "chatgpt.browser_control.operation_control_request.v1";
  controlActionId: string;
  parent: OperationControlAdapterFactoryContext["request"]["parent"];
  action: "stop" | "steer";
  expectedAssistantTurnId: string;
  steerPrompt?: string;
  timeoutMs?: number;
}>;

function normalizeFactoryOptions(value: ChatGPTRuntimeFactoryOptions): NormalizedFactoryOptions {
  if (value === null || typeof value !== "object") throw new ChatGPTRuntimeFactoryError();
  assertOwnDataKeys(value, [
    "env",
    "owner",
    "evidenceDigest",
    "coordinator",
    "transactionTimeoutMs",
    "surfaceTimeoutMs",
    "capabilities",
    "primitives"
  ]);
  const env = snapshotRuntimeEnv(readDataProperty<RuntimeEnv>(value, "env") as RuntimeEnv);
  const owner = snapshotOwner(readDataProperty<CoordinatorOwner>(value, "owner") as CoordinatorOwner);
  const evidenceDigest = readDataProperty<BrowserTargetEvidenceDigest>(value, "evidenceDigest");
  if (typeof evidenceDigest !== "function") throw new ChatGPTRuntimeFactoryError();
  const coordinatorValue = readDataProperty<ProcessTabCoordinator>(value, "coordinator");
  const coordinator = coordinatorValue ?? getProcessTabCoordinator();
  if (coordinator === null || typeof coordinator !== "object"
    || typeof coordinator.withBrowserAcquisition !== "function"
    || typeof coordinator.withTabTransaction !== "function") {
    throw new ChatGPTRuntimeFactoryError();
  }
  const transactionTimeoutMs = readDataProperty<number>(value, "transactionTimeoutMs");
  if (transactionTimeoutMs !== undefined
    && (!Number.isSafeInteger(transactionTimeoutMs) || transactionTimeoutMs < 1 || transactionTimeoutMs > 120_000)) {
    throw new ChatGPTRuntimeFactoryError();
  }
  const surfaceTimeoutMs = readDataProperty<number>(value, "surfaceTimeoutMs") ?? DEFAULT_SURFACE_TIMEOUT_MS;
  if (!Number.isSafeInteger(surfaceTimeoutMs) || surfaceTimeoutMs < 0 || surfaceTimeoutMs > MAX_SURFACE_TIMEOUT_MS) {
    throw new ChatGPTRuntimeFactoryError();
  }
  const capabilities = snapshotCapabilities(
    readDataProperty<Partial<OperationRuntimeCapabilities>>(value, "capabilities")
  );
  const primitives = readDataProperty<ChatGPTRuntimeFactoryOptions["primitives"]>(value, "primitives");
  if (primitives !== undefined && typeof primitives !== "function") {
    throw new ChatGPTRuntimeFactoryError();
  }
  return Object.freeze({
    env,
    owner,
    evidenceDigest,
    coordinator,
    ...(transactionTimeoutMs === undefined ? {} : { transactionTimeoutMs }),
    surfaceTimeoutMs,
    capabilities,
    ...(primitives === undefined ? {} : { primitives })
  });
}

function snapshotOwner(value: CoordinatorOwner): CoordinatorOwner {
  if (value === null || typeof value !== "object") throw new ChatGPTRuntimeFactoryError();
  assertOwnDataKeys(value, ["backendSessionId", "ownerId", "operationId"]);
  const backendSessionId = readDataProperty(value, "backendSessionId");
  const ownerId = readDataProperty(value, "ownerId");
  if (typeof backendSessionId !== "string" || !ID_PATTERN.test(backendSessionId)) {
    throw new ChatGPTRuntimeFactoryError();
  }
  if (ownerId !== undefined && (typeof ownerId !== "string" || !ID_PATTERN.test(ownerId))) {
    throw new ChatGPTRuntimeFactoryError();
  }
  return Object.freeze({
    backendSessionId,
    ...(ownerId === undefined ? {} : { ownerId })
  });
}

function snapshotRuntimeEnv(value: RuntimeEnv): RuntimeEnv {
  if (value === null || typeof value !== "object") throw new ChatGPTRuntimeFactoryError();
  assertOwnDataKeys(value, ["agent", "browser", "page", "clipboard", "now", "expectedTabId"]);
  const snapshot: RuntimeEnv = {};
  const agent = readDataProperty(value, "agent");
  const browser = readDataProperty<BrowserLike>(value, "browser");
  const page = readDataProperty<PageLike>(value, "page");
  const clipboard = readDataProperty(value, "clipboard");
  const now = readDataProperty<() => Date>(value, "now");
  const expectedTabId = readDataProperty(value, "expectedTabId");
  if (now !== undefined && typeof now !== "function") throw new ChatGPTRuntimeFactoryError();
  if (expectedTabId !== undefined && (typeof expectedTabId !== "string" || !ID_PATTERN.test(expectedTabId))) {
    throw new ChatGPTRuntimeFactoryError();
  }
  if (agent !== undefined) snapshot.agent = agent;
  if (browser !== undefined) snapshot.browser = unwrapCoordinatedBrowser(browser);
  if (page !== undefined) snapshot.page = unwrapCoordinatedPage(page);
  if (clipboard !== undefined && clipboard !== null && typeof clipboard === "object") {
    snapshot.clipboard = clipboard as ClipboardLike;
  }
  if (now !== undefined) snapshot.now = now;
  if (expectedTabId !== undefined) snapshot.expectedTabId = expectedTabId;
  return Object.freeze(snapshot);
}

function snapshotRequest(request: OperationAdapterFactoryContext["request"]): OperationAdapterFactoryContext["request"] {
  if (request === null || typeof request !== "object") throw new ChatGPTRuntimeFactoryError();
  assertOwnDataKeys(request, [
    "schemaVersion",
    "operationId",
    "surface",
    "prompt",
    "target",
    "configuration",
    "files",
    "capture",
    "timeoutMs"
  ]);
  const operationId = readDataProperty(request, "operationId");
  const surface = readDataProperty(request, "surface");
  const prompt = readDataProperty(request, "prompt");
  const target = readDataProperty<OperationTargetRequestV1>(request, "target");
  const configuration = readDataProperty<OperationConfigurationRequestV1>(request, "configuration");
  const capture = readDataProperty(request, "capture");
  const files = readDataProperty(request, "files");
  const schemaVersion = readDataProperty(request, "schemaVersion");
  const timeoutMs = readDataProperty(request, "timeoutMs");
  if (typeof operationId !== "string" || typeof surface !== "string" || typeof prompt !== "string"
    || !isOperationSurface(surface) || target === undefined || typeof target !== "object"
    || schemaVersion !== "chatgpt.browser_control.operation_request.v1") {
    throw new ChatGPTRuntimeFactoryError();
  }
  const copy: Record<string, unknown> = {
    schemaVersion,
    operationId,
    surface,
    prompt,
    target: snapshotTargetRequest(target)
  };
  if (configuration !== undefined) copy.configuration = cloneSafeData(configuration);
  if (capture !== undefined) copy.capture = cloneSafeData(capture);
  if (files !== undefined) copy.files = cloneSafeData(files);
  if (timeoutMs !== undefined) copy.timeoutMs = timeoutMs;
  return Object.freeze(copy) as OperationAdapterFactoryContext["request"];
}

function snapshotControlRequest(
  request: OperationControlAdapterFactoryContext["request"]
): OperationControlRequestSnapshot {
  if (request === null || typeof request !== "object") throw new ChatGPTRuntimeFactoryError();
  assertOwnDataKeys(request, [
    "schemaVersion",
    "controlActionId",
    "parent",
    "action",
    "expectedAssistantTurnId",
    "steerPrompt",
    "timeoutMs"
  ]);
  const schemaVersion = readDataProperty(request, "schemaVersion");
  const controlActionId = readDataProperty(request, "controlActionId");
  const parent = readDataProperty(request, "parent");
  const action = readDataProperty(request, "action");
  const expectedAssistantTurnId = readDataProperty(request, "expectedAssistantTurnId");
  const steerPrompt = readDataProperty<unknown>(request, "steerPrompt");
  const timeoutMs = readDataProperty<unknown>(request, "timeoutMs");
  if (schemaVersion !== "chatgpt.browser_control.operation_control_request.v1"
    || typeof controlActionId !== "string"
    || !ID_PATTERN.test(controlActionId)
    || parent === undefined
    || typeof parent !== "object"
    || Array.isArray(parent)
    || (action !== "stop" && action !== "steer")
    || typeof expectedAssistantTurnId !== "string"
    || !ID_PATTERN.test(expectedAssistantTurnId)
    || (steerPrompt !== undefined && typeof steerPrompt !== "string")
    || (action === "steer" && typeof steerPrompt !== "string")
    || (action === "stop" && steerPrompt !== undefined)
    || (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 0))) {
    throw new ChatGPTRuntimeFactoryError();
  }
  return Object.freeze({
    schemaVersion,
    controlActionId,
    parent: cloneSafeData(parent) as OperationControlRequestSnapshot["parent"],
    action,
    expectedAssistantTurnId,
    ...(steerPrompt === undefined ? {} : { steerPrompt }),
    ...(timeoutMs === undefined ? {} : { timeoutMs: timeoutMs as number })
  });
}

function snapshotTargetRequest(value: OperationTargetRequestV1): OperationTargetRequestV1 {
  if (value === null || typeof value !== "object") throw new ChatGPTRuntimeFactoryError();
  const type = readDataProperty(value, "type");
  switch (type) {
    case "new":
    case "selected_tab":
      assertOwnDataKeys(value, ["type"]);
      return Object.freeze({ type });
    case "tab_id": {
      assertOwnDataKeys(value, ["type", "tabId"]);
      const tabId = readDataProperty(value, "tabId");
      if (typeof tabId !== "string" || !ID_PATTERN.test(tabId)) throw new ChatGPTRuntimeFactoryError();
      return Object.freeze({ type, tabId });
    }
    case "conversation_id": {
      assertOwnDataKeys(value, ["type", "conversationId"]);
      const conversationId = readDataProperty(value, "conversationId");
      if (typeof conversationId !== "string" || !ID_PATTERN.test(conversationId)) throw new ChatGPTRuntimeFactoryError();
      return Object.freeze({ type, conversationId });
    }
    case "url": {
      assertOwnDataKeys(value, ["type", "url"]);
      const url = readDataProperty(value, "url");
      if (typeof url !== "string") throw new ChatGPTRuntimeFactoryError();
      const canonical = canonicalChatGPTUrl(url);
      if (canonical === undefined) throw new ChatGPTRuntimeFactoryError();
      return Object.freeze({ type, url: canonical });
    }
    default:
      throw new ChatGPTRuntimeFactoryError();
  }
}

function snapshotTargetBinding(value: OperationTargetBindingV1): OperationTargetBindingV1 {
  const copy = cloneSafeData(value);
  if (copy === null || typeof copy !== "object" || Array.isArray(copy)) throw new ChatGPTRuntimeFactoryError();
  const target = copy as Record<string, unknown>;
  if (typeof target.providerId !== "string" || typeof target.browserId !== "string"
    || typeof target.tabId !== "string" || typeof target.coordinationScope !== "string"
    || !ID_PATTERN.test(target.providerId) || !ID_PATTERN.test(target.browserId) || !ID_PATTERN.test(target.tabId)
    || (target.coordinationScope !== "process" && target.coordinationScope !== "provider")) {
    throw new ChatGPTRuntimeFactoryError();
  }
  if (target.targetLifecycle === "new_pending") throw new ChatGPTRuntimeFactoryError();
  return Object.freeze(target) as OperationTargetBindingV1;
}

async function captureChatGPTRequest(options: CaptureRequestOptions): Promise<OperationRuntimeBrowserCapture> {
  const targetRequest = options.recoveryTarget === undefined
    ? options.request === undefined ? undefined : options.request.target
    : Object.freeze({ type: "tab_id", tabId: options.recoveryTarget.tabId } satisfies OperationTargetRequestV1);
  if (targetRequest === undefined) throw new ChatGPTRuntimeFactoryError();
  const targetSurface = options.captureRequest.surface;
  const bootstrap = bootstrapArgsForTarget(targetRequest);
  const bootstrapEnv = bootstrapEnvironment(options.env, targetRequest, options.recoveryTarget);
  const acquisitionOwner = Object.freeze({
    ...options.owner,
    operationId: options.captureRequest.operationId
  });
  const coordination = Object.freeze({
    coordinator: options.coordinator,
    owner: acquisitionOwner
  });
  try {
    bootstrapEnv.browser = await resolveChatGPTBrowser(bootstrapEnv, coordination);
  } catch {
    throw new ChatGPTRuntimeFactoryError();
  }
  let selectedTabId: string | undefined;
  if (targetRequest.type === "selected_tab") {
    // The browser wrapper performs this one read through the same process
    // coordinator. Supplying the resulting exact page prevents the broader
    // user-open-tab fallback from turning "selected" into "first ChatGPT tab".
    const selected = await selectExactSelectedPage(bootstrapEnv.browser);
    if (selected === undefined) throw new ChatGPTRuntimeFactoryError();
    selectedTabId = tabIdFromPage(selected);
    if (selectedTabId === undefined || !ID_PATTERN.test(selectedTabId)) {
      throw new ChatGPTRuntimeFactoryError();
    }
    bootstrapEnv.page = selected;
  }
  const env = Object.freeze(bootstrapEnv);
  let attached: Awaited<ReturnType<typeof attachChatGPTBrowser>>;
  try {
    attached = await attachChatGPTBrowser(env, bootstrap, coordination);
  } catch {
    throw new ChatGPTRuntimeFactoryError();
  }
  const rawPage = unwrapCoordinatedPage(attached.page);
  const browserId = coordinatedBrowserResource(attached.browser).key;
  const browserResource = coordinatedBrowserResource(attached.browser).key;
  const tabId = tabIdFromPage(attached.page);
  if (tabId === undefined || !ID_PATTERN.test(tabId)) throw new ChatGPTRuntimeFactoryError();
  if (attached.tabId !== undefined && attached.tabId !== tabId) throw new ChatGPTRuntimeFactoryError();
  if (targetRequest.type === "tab_id" && tabId !== targetRequest.tabId) {
    throw new ChatGPTRuntimeFactoryError();
  }
  if (targetRequest.type === "selected_tab" && (selectedTabId === undefined || tabId !== selectedTabId)) {
    throw new ChatGPTRuntimeFactoryError();
  }
  if (options.recoveryTarget !== undefined) {
    assertRecoveredBrowserIdentity(options.recoveryTarget, browserId, tabId);
  }

  await options.coordinator.withBrowserAcquisition(
    browserResource,
    {
      owner: acquisitionOwner,
      priority: options.recoveryTarget === undefined ? "mutation" : "read",
      signal: options.captureRequest.signal,
      ...(options.transactionTimeoutMs === undefined ? {} : { timeoutMs: options.transactionTimeoutMs }),
      label: "operation-target-prepare"
    },
    async () => {
      await validateExactNavigation(rawPage, targetRequest);
      await ensureSurface(rawPage, targetSurface, targetRequest.type === "new", options.surfaceTimeoutMs, tabId);
    }
  );

  const capabilities = options.capabilities;
  const observeCurrent = async (request: OperationBrowserCurrentTargetRequest): Promise<OperationBrowserCurrentTargetResult> => {
    const observationTarget = observationTargetForBinding(request.target);
    const observed = await observePage(request.page, request.operationId, observationTarget, options.evidenceDigest);
    return Object.freeze({ evidence: observed.snapshot.target });
  };

  const resolveTargetEvidence = async (
    request: OperationBrowserTargetProbeRequest
  ): Promise<OperationBrowserTargetProbe> => {
    if (!sameTargetRequest(request.target, targetRequest)) {
      throw new ChatGPTRuntimeFactoryError();
    }
    return await options.coordinator.withBrowserAcquisition(
      browserResource,
      {
        owner: acquisitionOwner,
        priority: "read",
        signal: request.signal,
        ...(options.transactionTimeoutMs === undefined ? {} : { timeoutMs: options.transactionTimeoutMs }),
        label: "operation-target-bind"
      },
      async () => {
        await validateExactNavigation(rawPage, request.target);
        const observationTarget = observationTargetForRequest(
          request,
          browserId,
          tabId,
          targetRequest
        );
        const observed = await observePage(rawPage, request.operationId, observationTarget, options.evidenceDigest);
        const anchor = observed.newTargetAnchor;
        return Object.freeze({
          page: rawPage,
          evidence: observed.snapshot.target,
          ...(request.target.type === "new" ? { targetLifecycle: "new_pending" as const } : {}),
          ...(anchor === undefined ? {} : {
            newTargetAnchorDigest: anchor.anchorDigest,
            blankTaskEvidenceDigest: anchor.blankTaskEvidenceDigest
          }),
          capabilities
        });
      }
    );
  };

  const request = options.request;
  const productionOptions: ProductionOperationPrimitiveOptions = {
    evidenceDigest: options.evidenceDigest,
    operationId: options.captureRequest.operationId,
    requestDigest: options.captureRequest.requestDigest,
    ...(request === undefined ? {} : { desiredComposerText: request.prompt }),
    ...(options.recoveryTarget === undefined ? {} : { target: options.recoveryTarget })
  };
  const attachments = request === undefined || options.files.length === 0
    ? undefined
    : await createChatGPTAttachmentProviderAsync({
        evidenceDigest: options.evidenceDigest,
        files: options.files,
        identityDigest: (ordinal, manifest) => options.evidenceDigest(
          "file-manifest",
          { ordinal, ...manifest }
        ),
        revalidateFile: identity => revalidateOperationFile(identity, {
          signal: options.captureRequest.signal
        }),
        signal: options.captureRequest.signal
      });
  const production = createProductionOperationPrimitives({
    ...productionOptions,
    ...(attachments === undefined
      ? {}
      : { observeAttachments: attachments.observeAttachments })
  });
  const providerPrimitives = attachments === undefined
    ? production
    : mergePrimitivePorts(production, {
        submission: {
          handoffFiles: attachments.handoffFilesForAdapter,
          observeAttachments: attachments.observeAttachments
        }
      });
  const artifactSource = hasTransferDestination(request)
    ? createProductionChatGPTArtifacts({
        page: rawPage,
        evidenceDigest: options.evidenceDigest,
        signal: options.captureRequest.signal,
        ...(options.transactionTimeoutMs === undefined ? {} : { timeoutMs: options.transactionTimeoutMs })
      })
    : undefined;
  const artifactPrimitive = artifactSource === undefined
    ? undefined
    : productionArtifactPrimitive(artifactSource);
  let capturedPrimitives = artifactPrimitive === undefined
    ? providerPrimitives
    : mergePrimitivePorts(providerPrimitives, { artifacts: artifactPrimitive });
  if (options.control !== undefined && options.control.request.action === "steer") {
    if (options.control.request.steerPrompt === undefined) throw new ChatGPTRuntimeFactoryError();
    const steerPrimitive = createProductionWorkSteerPrimitive({
      evidenceDigest: options.evidenceDigest,
      operationId: options.captureRequest.operationId,
      parentRequestDigest: options.captureRequest.requestDigest,
      targetBindingDigest: options.control.targetBindingDigest,
      controlActionId: options.control.request.controlActionId,
      expectedAssistantTurnId: options.control.request.expectedAssistantTurnId,
      target: options.recoveryTarget ?? (() => { throw new ChatGPTRuntimeFactoryError(); })(),
      prompt: options.control.request.steerPrompt,
      observe: requestValue => observeWorkSteerPage(requestValue, options.evidenceDigest, options.recoveryTarget!),
      resolveComposer: requestValue => resolveWorkComposer(requestValue.page),
      resolveSendControl: requestValue => resolveWorkSendControl(requestValue.page)
    });
    capturedPrimitives = mergePrimitivePorts(capturedPrimitives, {
      control: workSteerControlPrimitive(steerPrimitive, capturedPrimitives.control)
    });
  }
  const configuration = request?.configuration === undefined
    ? undefined
    : createProductionConfigurationStaging({
      evidenceDigest: options.evidenceDigest,
      operationId: options.captureRequest.operationId,
      requestDigest: options.captureRequest.requestDigest,
      surface: targetSurface,
      configuration: request.configuration
    });
  let primitives = composePrimitives(capturedPrimitives, configuration, options, {
    operationId: options.captureRequest.operationId,
    requestDigest: options.captureRequest.requestDigest,
    surface: targetSurface,
    ...(request === undefined ? {} : {
      prompt: request.prompt,
      ...(request.configuration === undefined ? {} : { configuration: request.configuration })
    }),
    files: options.files,
    signal: options.captureRequest.signal,
    page: rawPage,
    ...(options.recoveryTarget === undefined ? {} : { target: options.recoveryTarget })
  });
  if (artifactPrimitive === undefined && primitives.artifacts !== undefined) {
    const { artifacts: _artifacts, ...withoutArtifacts } = primitives;
    primitives = Object.freeze(withoutArtifacts);
  }
  return Object.freeze({
    page: rawPage,
    capabilities,
    resolveTargetEvidence,
    observeCurrentTarget: observeCurrent,
    ...(artifactPrimitive === undefined || !hasTransferDestination(request)
      ? {}
      : { outputDirectory: request.capture.outputDirectory }),
    primitives
  });
}

function productionArtifactPrimitive(
  source: ProductionChatGPTArtifacts
): NonNullable<OperationRuntimeBrowserPrimitives["artifacts"]> {
  return Object.freeze({
    acquireDownload: (request, page) => source.acquireDownload(request, page),
    materializeDownload: source.materializeDownload
  });
}

function workSteerControlPrimitive(
  primitive: ReturnType<typeof createProductionWorkSteerPrimitive>,
  existing: OperationRuntimeBrowserPrimitives["control"] | undefined
): NonNullable<OperationRuntimeBrowserPrimitives["control"]> {
  return Object.freeze({
    ...(existing ?? {}),
    prepareSteer: async (request, page) => mapWorkSteerResult(
      await primitive.prepare({ page, signal: request.signal, deadlineAt: request.deadlineAt }),
      request,
      "prepare"
    ),
    executeSteerPrepared: async (request, page) => mapWorkSteerResult(
      await primitive.executePrepared({ page, prepared: productionPreparedFromControl(request.prepared), signal: request.signal, deadlineAt: request.deadlineAt }),
      request,
      "execute_prepared",
      request.prepared
    ),
    verifySteer: async (request, page) => mapWorkSteerResult(
      await primitive.verify({ page, prepared: productionPreparedFromControl(request.prepared), signal: request.signal, deadlineAt: request.deadlineAt }),
      request,
      "verify",
      request.prepared
    ),
    recoverSteer: async (request, page) => mapWorkSteerResult(
      await primitive.recover({ page, prepared: productionPreparedFromControl(request.prepared), baseline: request.baseline, signal: request.signal, deadlineAt: request.deadlineAt }),
      request,
      "recovery",
      request.prepared
    )
  });
}

function productionPreparedFromControl(
  prepared: ControlSteerPrepared
): Parameters<ReturnType<typeof createProductionWorkSteerPrimitive>["executePrepared"]>[0]["prepared"] {
  return Object.freeze({
    schemaVersion: "chatgpt.browser_control.production_work_steer.v1" as const,
    operationId: prepared.parentOperationId,
    parentRequestDigest: prepared.parentRequestDigest,
    targetBindingDigest: prepared.parentTargetBindingDigest,
    controlActionId: prepared.controlActionId,
    action: "work_steer" as const,
    expectedAssistantTurnId: prepared.expectedAssistantTurnId,
    assistantBranchId: prepared.assistantBranchId,
    assistantParentTurnId: prepared.assistantParentTurnId,
    baselineSnapshotDigest: prepared.baselineSnapshotDigest,
    preparedDigest: prepared.preparedDigest,
    baseline: prepared.baseline
  });
}

function mapWorkSteerResult(
  result: ProductionWorkSteerResult,
  request: ControlSteerPrepareRequest | ControlSteerExecutePreparedRequest | ControlSteerVerifyRequest | ControlSteerRecoverRequest,
  phase: "prepare" | "execute_prepared" | "verify" | "recovery",
  prepared?: ControlSteerPrepared
): ControlSteerPhaseResult {
  const identity = "prepared" in request
    ? request.prepared
    : request;
  const base = {
    schemaVersion: "chatgpt.browser_control.operation_control_coordinator.v1" as const,
    phase,
    parentOperationId: "prepared" in request ? identity.parentOperationId : identity.parentOperationId,
    parentRequestDigest: "prepared" in request ? identity.parentRequestDigest : identity.parentRequestDigest,
    parentTargetBindingDigest: "prepared" in request ? identity.parentTargetBindingDigest : identity.parentTargetBindingDigest,
    controlActionId: "prepared" in request ? identity.controlActionId : identity.controlActionId,
    action: "steer" as const,
    requestDigest: "prepared" in request ? identity.requestDigest : identity.requestDigest,
    expectedAssistantTurnId: "prepared" in request ? identity.expectedAssistantTurnId : identity.expectedAssistantTurnId,
    ...(prepared === undefined ? {} : {
      assistantBranchId: prepared.assistantBranchId,
      assistantParentTurnId: prepared.assistantParentTurnId,
      baselineSnapshotDigest: prepared.baselineSnapshotDigest,
      preparedDigest: prepared.preparedDigest
    })
  };
  if (result.status === "prepared") {
    const productionPrepared = result.prepared;
    return Object.freeze({
      ...base,
      phase: "prepare" as const,
      status: "prepared" as const,
      observationRequired: false as const,
      mutationBoundary: "none" as const,
      prepared: Object.freeze({
        schemaVersion: base.schemaVersion,
        parentOperationId: productionPrepared.operationId,
        parentRequestDigest: productionPrepared.parentRequestDigest,
        parentTargetBindingDigest: productionPrepared.targetBindingDigest,
        controlActionId: productionPrepared.controlActionId,
        action: "steer" as const,
        requestDigest: identity.requestDigest,
        expectedAssistantTurnId: productionPrepared.expectedAssistantTurnId,
        assistantBranchId: productionPrepared.assistantBranchId,
        assistantParentTurnId: productionPrepared.assistantParentTurnId,
        baselineSnapshotDigest: productionPrepared.baselineSnapshotDigest,
        preparedDigest: productionPrepared.preparedDigest,
        baseline: productionPrepared.baseline
      })
    });
  }
  if (result.status === "executed") {
    return Object.freeze({
      ...base,
      phase: "execute_prepared" as const,
      status: "executed" as const,
      observationRequired: true as const,
      mutationBoundary: "control_may_have_occurred" as const
    });
  }
  if (result.status === "satisfied") {
    const receipt = result.receipt;
    return Object.freeze({
      ...base,
      phase: phase === "recovery" ? "recovery" as const : "verify" as const,
      status: "satisfied" as const,
      observationRequired: false as const,
      mutationBoundary: "control_may_have_occurred" as const,
      assistantBranchId: result.assistantBranchId,
      assistantParentTurnId: result.assistantParentTurnId,
      baselineSnapshotDigest: result.baselineSnapshotDigest,
      preparedDigest: result.preparedDigest,
      receipt: Object.freeze({
        schemaVersion: base.schemaVersion,
        baselineSnapshotDigest: receipt.baselineSnapshotDigest,
        preparedDigest: receipt.preparedDigest,
        assistantTurnId: receipt.assistantTurnId,
        assistantBranchId: receipt.assistantBranchId,
        assistantParentTurnId: receipt.assistantParentTurnId,
        userTurnId: receipt.userTurnId,
        userTurnEvidenceDigest: receipt.userTurnEvidenceDigest,
        postSendDeltaDigest: receipt.postSendDeltaDigest,
        evidenceDigest: receipt.evidenceDigest
      })
    });
  }
  if (result.status === "blocked") {
    return Object.freeze({
      ...base,
      status: "blocked" as const,
      blockerCode: result.blockerCode,
      observationRequired: result.observationRequired,
      mutationBoundary: result.mutationBoundary,
      ...(result.evidenceDigest === undefined ? {} : { evidenceDigest: result.evidenceDigest })
    });
  }
  return Object.freeze({
    ...base,
    status: "uncertain" as const,
    blockerCode: result.blockerCode,
    observationRequired: true as const,
    mutationBoundary: "control_may_have_occurred" as const,
    quarantine: result.quarantine,
    ...(result.evidenceDigest === undefined ? {} : { evidenceDigest: result.evidenceDigest })
  });
}

async function observeWorkSteerPage(
  request: ProductionWorkSteerObservationRequest,
  evidenceDigest: BrowserTargetEvidenceDigest,
  targetBinding: OperationTargetBindingV1
) {
  return await observeBrowserPage(request.page, {
    operationId: request.operationId,
    target: observationTargetForBinding(targetBinding),
    evidenceDigest,
    responseContent: "metadata",
    ...(request.baseline === undefined ? {} : { baseline: request.baseline })
  });
}

async function resolveWorkComposer(page: Readonly<PageLike>): Promise<Readonly<{ locator: LocatorLike; capabilityKey: string; candidateCount: number }> | undefined> {
  try {
    const locator = composerTextbox(page);
    const count = typeof locator.count === "function" ? await locator.count() : 0;
    const visible = count === 1 && typeof locator.isVisible === "function" && await locator.isVisible();
    return visible ? { locator, capabilityKey: "chatgpt.composer", candidateCount: 1 } : undefined;
  } catch {
    return undefined;
  }
}

async function resolveWorkSendControl(page: Readonly<PageLike>): Promise<Readonly<{ locator: LocatorLike; capabilityKey: string; localeKey: string; candidateCount: number }> | undefined> {
  try {
    const locator = sendButton(page);
    const count = typeof locator.count === "function" ? await locator.count() : 0;
    const visible = count === 1 && typeof locator.isVisible === "function" && await locator.isVisible();
    return visible ? { locator, capabilityKey: "chatgpt.send", localeKey: "locale.registry", candidateCount: 1 } : undefined;
  } catch {
    return undefined;
  }
}

function composePrimitives(
  production: OperationRuntimeBrowserPrimitives,
  configuration: OperationBrowserStagingPrimitive | undefined,
  options: CaptureRequestOptions,
  context: ChatGPTPrimitiveFactoryContext
): OperationRuntimeBrowserPrimitives {
  const productionStaging = production.staging;
  const productionReadCurrent = productionStaging?.readCurrent;
  const productionMutateOnce = productionStaging?.mutateOnce;
  const productionObserve = productionStaging?.observe;
  const configurationReadCurrent = configuration?.readCurrent;
  const configurationMutateOnce = configuration?.mutateOnce;
  const configurationObserve = configuration?.observe;
  const configured: OperationBrowserStagingPrimitive | undefined =
    configurationReadCurrent === undefined
      || configurationMutateOnce === undefined
      || configurationObserve === undefined
      || productionReadCurrent === undefined
      || productionMutateOnce === undefined
      || productionObserve === undefined
      ? productionStaging
      : Object.freeze({
          readCurrent: request => request.kind === "composer_set"
            ? productionReadCurrent(request)
            : configurationReadCurrent(request),
          mutateOnce: request => request.kind === "composer_set"
            ? productionMutateOnce(request)
            : configurationMutateOnce(request),
          observe: request => request.kind === "composer_set"
            ? productionObserve(request)
            : configurationObserve(request)
        });
  let result: OperationRuntimeBrowserPrimitives = Object.freeze({
    ...production,
    ...(configured === undefined ? {} : { staging: configured })
  });
  const augment = options.primitives?.(context);
  if (augment !== undefined) {
    // Provider integrations normally add one narrow method (for example the
    // chooser handoff) to a production port. Replacing the whole nested port
    // would silently discard the production Send observers or collector
    // ownership logic, so merge at the method boundary instead.
    result = mergePrimitivePorts(result, augment);
  }
  return result;
}

function mergePrimitivePorts(
  base: OperationRuntimeBrowserPrimitives,
  augment: Partial<OperationRuntimeBrowserPrimitives>
): OperationRuntimeBrowserPrimitives {
  const merge = <T extends object>(left: T | undefined, right: Partial<T> | undefined): T | undefined => {
    if (left === undefined) return right === undefined ? undefined : Object.freeze({ ...right }) as T;
    if (right === undefined) return left;
    return Object.freeze({ ...left, ...right });
  };
  const staging = merge(base.staging, augment.staging);
  const submission = merge(base.submission, augment.submission);
  const collector = merge(base.collector, augment.collector);
  const control = merge(base.control, augment.control);
  const artifacts = merge(base.artifacts, augment.artifacts);
  return Object.freeze({
    ...(staging === undefined ? {} : { staging }),
    ...(submission === undefined ? {} : { submission }),
    ...(collector === undefined ? {} : { collector }),
    ...(control === undefined ? {} : { control }),
    ...(artifacts === undefined ? {} : { artifacts })
  });
}

function bootstrapArgsForTarget(target: OperationTargetRequestV1): BootstrapArgs {
  switch (target.type) {
    case "new":
      return Object.freeze({ url: CHATGPT_HOME, preferExistingTab: false });
    case "selected_tab":
      return Object.freeze({
        existingTab: {
          target: { type: "selected", host: "chatgpt" },
          ifMissing: "block",
          ifMultiple: "block",
          requireChatGPT: true
        }
      }) as BootstrapArgs;
    case "tab_id":
      return Object.freeze({
        existingTab: {
          target: { type: "tabId", tabId: target.tabId },
          ifMissing: "block",
          ifMultiple: "block",
          requireChatGPT: true
        }
      }) as BootstrapArgs;
    case "conversation_id":
      return Object.freeze({
        url: new URL(`/c/${target.conversationId}`, CHATGPT_HOME).toString(),
        existingTab: {
          target: { type: "conversationId", conversationId: target.conversationId },
          ifMissing: "open",
          ifMultiple: "block",
          requireChatGPT: true
        }
      }) as BootstrapArgs;
    case "url":
      return Object.freeze({
        url: target.url,
        existingTab: {
          target: { type: "url", url: target.url },
          ifMissing: "open",
          ifMultiple: "block",
          requireChatGPT: true
        }
      }) as BootstrapArgs;
  }
}

function bootstrapEnvironment(
  env: RuntimeEnv,
  target: OperationTargetRequestV1,
  recoveryTarget: OperationTargetBindingV1 | undefined
): RuntimeEnv {
  const copy: RuntimeEnv = { ...env };
  // A selected-tab request must be proven through browser.tabs.selected. A
  // cached arbitrary page would make `existingTab: selected` non-exact.
  if (target.type === "new" || target.type === "selected_tab") {
    delete copy.page;
  }
  if (recoveryTarget !== undefined) {
    copy.expectedTabId = recoveryTarget.tabId;
    if (copy.page !== undefined && tabIdFromPage(copy.page) !== recoveryTarget.tabId) {
      delete copy.page;
    }
  }
  return copy;
}

/**
 * `attachChatGPTBrowser` also supports user-open-tab discovery. That is
 * intentionally broader than an exact selected-tab request, so selected-tab
 * capture is preflighted through the browser's selected-tab primitive and the
 * resulting page is then handed back to attach as its cached exact page.
 */
async function selectExactSelectedPage(browser: BrowserLike | undefined): Promise<PageLike | undefined> {
  const tabs = browser?.tabs;
  const selected = tabs?.selected;
  if (typeof selected !== "function") return undefined;
  let page: PageLike | undefined;
  try {
    const candidate = await Promise.resolve(selected.call(tabs));
    if (candidate === undefined) return undefined;
    // `candidate` is a coordinated page returned by the coordinated browser.
    // Validate its URL while retaining that wrapper so the read stays inside
    // the browser actor; unwrap only after the exact selected-tab proof.
    const url = await Promise.resolve(candidate.url?.()).catch(() => undefined);
    if (!isChatGPTUrl(url)) return undefined;
    page = unwrapCoordinatedPage(candidate);
  } catch {
    return undefined;
  }
  if (page === undefined) return undefined;
  return page;
}

async function validateExactNavigation(
  page: Readonly<PageLike>,
  target: OperationTargetRequestV1
): Promise<void> {
  if (target.type !== "conversation_id" && target.type !== "url") return;
  const actual = await Promise.resolve(page.url?.()).catch(() => undefined);
  const actualCanonical = canonicalChatGPTUrl(actual);
  if (actualCanonical === undefined) throw new ChatGPTRuntimeFactoryError();
  if (target.type === "url") {
    const expected = canonicalChatGPTUrl(target.url);
    if (expected === undefined || actualCanonical !== expected) throw new ChatGPTRuntimeFactoryError();
    return;
  }
  if (parseConversationId(actualCanonical) !== target.conversationId) {
    throw new ChatGPTRuntimeFactoryError();
  }
}

async function ensureSurface(
  page: PageLike,
  surface: OperationSurface,
  allowSwitch: boolean,
  timeoutMs: number,
  tabId: string
): Promise<void> {
  const before = detectExperienceFromSnapshot(await readSurfaceSnapshot(page));
  if (before.experience === surface) return;
  // A fixed conversation/URL target must never be navigated to a surface home
  // as a side effect of attachment. The exact target is more important than
  // a best-effort surface guess; callers can explicitly switch it first.
  if (!allowSwitch || before.experience === "unknown") throw new ChatGPTRuntimeFactoryError();
  const result = await openExperience(
    Object.freeze({ page, expectedTabId: tabId }),
    { experience: surface, timeoutMs }
  );
  if (!result.ok || result.data?.experience !== surface) throw new ChatGPTRuntimeFactoryError();
  const after = detectExperienceFromSnapshot(await readSurfaceSnapshot(page));
  if (after.experience !== surface) throw new ChatGPTRuntimeFactoryError();
}

async function observePage(
  page: Readonly<PageLike>,
  operationId: string,
  target: BrowserObservationTarget,
  evidenceDigest: BrowserTargetEvidenceDigest
): Promise<Awaited<ReturnType<typeof observeBrowserPage>>> {
  return await observeBrowserPage(page, {
    operationId,
    target,
    evidenceDigest,
    responseContent: "metadata"
  });
}

function observationTargetForRequest(
  request: OperationBrowserTargetProbeRequest,
  browserId: string,
  tabId: string,
  target: OperationTargetRequestV1
): BrowserObservationTarget {
  const expectedConversationId = request.target.type === "conversation_id"
    ? request.target.conversationId
    : request.target.type === "url" ? parseConversationId(request.target.url) : undefined;
  return {
    providerId: "chatgpt",
    browserId,
    tabId,
    coordinationScope: "process",
    ...(target.type === "new" ? { targetLifecycle: "new_pending" as const } : {}),
    ...(expectedConversationId === undefined ? {} : { expectedConversationId })
  };
}

function observationTargetForBinding(
  target: OperationTargetBindingV1
): BrowserObservationTarget {
  return {
    providerId: target.providerId,
    browserId: target.browserId,
    tabId: target.tabId,
    coordinationScope: target.coordinationScope,
    ...(target.targetLifecycle === undefined ? {} : { targetLifecycle: target.targetLifecycle }),
    ...(target.conversationId === undefined ? {} : { expectedConversationId: target.conversationId })
  };
}

function assertRecoveredBrowserIdentity(
  target: OperationTargetBindingV1,
  browserId: string,
  tabId: string
): void {
  if (target.providerId !== "chatgpt" || target.browserId !== browserId || target.tabId !== tabId) {
    throw new ChatGPTRuntimeFactoryError();
  }
}

function canonicalChatGPTUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !isChatGPTUrl(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.search !== "" || url.hash !== "") return undefined;
    url.pathname = url.pathname.replace(/\/{2,}/gu, "/").replace(/\/$/u, "") || "/";
    return url.toString();
  } catch {
    return undefined;
  }
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/")
    || /^[A-Za-z]:[\\/]/u.test(value)
    || value.startsWith("\\\\");
}

function hasTransferDestination(
  request: OperationAdapterFactoryContext["request"] | undefined
): request is OperationAdapterFactoryContext["request"] & Readonly<{
  capture: Readonly<{ artifacts: "transfer"; outputDirectory: string }>;
}> {
  const capture = request?.capture;
  if (capture === undefined || capture.artifacts !== "transfer" || typeof capture.outputDirectory !== "string") {
    return false;
  }
  return capture.outputDirectory.length > 0
    && capture.outputDirectory.length <= 4096
    && isAbsolutePath(capture.outputDirectory)
    && !/[\u0000-\u001f\u007f]/u.test(capture.outputDirectory);
}

function isOperationSurface(value: unknown): value is OperationSurface {
  return value === "chat" || value === "work";
}

function sameTargetRequest(
  left: OperationTargetRequestV1,
  right: OperationTargetRequestV1
): boolean {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case "new":
    case "selected_tab":
      return true;
    case "tab_id":
      return right.type === "tab_id" && left.tabId === right.tabId;
    case "conversation_id":
      return right.type === "conversation_id" && left.conversationId === right.conversationId;
    case "url":
      return right.type === "url" && left.url === right.url;
  }
}

function readDataProperty<T = unknown>(value: object, key: string): T | undefined {
  try {
    let current: object | null = value;
    for (let depth = 0; current !== null && depth < 12; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
          throw new ChatGPTRuntimeFactoryError();
        }
        return descriptor.value as T;
      }
      const prototype = Object.getPrototypeOf(current);
      current = prototype !== null && (typeof prototype === "object" || typeof prototype === "function")
        ? prototype
        : null;
    }
    return undefined;
  } catch (error) {
    if (error instanceof ChatGPTRuntimeFactoryError) throw error;
    throw new ChatGPTRuntimeFactoryError();
  }
}

function snapshotCapabilities(
  value: Partial<OperationRuntimeCapabilities> | undefined
): OperationRuntimeCapabilities {
  if (value === undefined) {
    return Object.freeze({
      stableProviderId: true,
      stableBrowserId: true,
      stableTabId: true,
      authoritativeTabClaim: false,
      concurrentTabs: false
    });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ChatGPTRuntimeFactoryError();
  }
  const keys = [
    "stableProviderId",
    "stableBrowserId",
    "stableTabId",
    "authoritativeTabClaim",
    "concurrentTabs"
  ] as const;
  assertOwnDataKeys(value, keys);
  const result = {
    stableProviderId: readDataProperty<boolean>(value, "stableProviderId") ?? false,
    stableBrowserId: readDataProperty<boolean>(value, "stableBrowserId") ?? false,
    stableTabId: readDataProperty<boolean>(value, "stableTabId") ?? false,
    authoritativeTabClaim: readDataProperty<boolean>(value, "authoritativeTabClaim") ?? false,
    concurrentTabs: readDataProperty<boolean>(value, "concurrentTabs") ?? false
  };
  if (Object.values(result).some(item => typeof item !== "boolean")) {
    throw new ChatGPTRuntimeFactoryError();
  }
  return Object.freeze(result);
}

function assertOwnDataKeys(value: object, allowed: readonly string[]): void {
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new ChatGPTRuntimeFactoryError();
  }
  const allowedSet = new Set(allowed);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowedSet.has(key)) throw new ChatGPTRuntimeFactoryError();
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new ChatGPTRuntimeFactoryError();
    }
  }
}

function cloneSafeData(value: unknown, seen = new Set<object>(), depth = 0): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      throw new ChatGPTRuntimeFactoryError();
    }
    return value;
  }
  if (depth > 16 || seen.has(value)) throw new ChatGPTRuntimeFactoryError();
  seen.add(value);
  try {
    // Durable operation snapshots are string-keyed wire data. Silently
    // dropping a symbol would make the snapshot differ from the caller's
    // object while still accepting an unreviewed property.
    if (Reflect.ownKeys(value).some(key => typeof key !== "string")) {
      throw new ChatGPTRuntimeFactoryError();
    }
    if (Array.isArray(value)) {
      const result = value.map(item => cloneSafeData(item, seen, depth + 1));
      seen.delete(value);
      return Object.freeze(result);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new ChatGPTRuntimeFactoryError();
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new ChatGPTRuntimeFactoryError();
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: cloneSafeData(descriptor.value, seen, depth + 1),
        writable: true
      });
    }
    seen.delete(value);
    return Object.freeze(result);
  } catch (error) {
    seen.delete(value);
    throw error;
  }
}
