import { types as nodeTypes } from "node:util";
import type { PageLike } from "../types.js";
import {
  createBrowserResourceKey,
  createTabResourceKey,
  type BrowserResourceKey,
  type CoordinatorAcquisitionContext,
  type CoordinatorOwner,
  type CoordinatorPriority,
  type CoordinatorRequestOptions,
  type CoordinatorResourceKind,
  type ProcessTabCoordinator,
  type TabResourceKey
} from "../runtime/tab-coordinator.js";
import type { OperationRuntimeCapabilities } from "../runtime/operation-context.js";
import type { OperationTargetBindingV1, OperationTargetLifecycle } from "./types.js";
import type {
  OwnershipIdentityEvidence,
  OwnershipTargetEvidence
} from "./turn-ownership.js";

/** The exact digest shape accepted by every target-evidence boundary. */
const DIGEST_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/;
/** Keep IDs opaque: the adapter never interprets provider-specific semantics. */
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,512}$/;
/** `browser-observation.ts` deliberately emits this non-routable URL identity. */
const OPAQUE_THREAD_URL_PATTERN = /^https:\/\/opaque\.invalid\/thread\/[0-9a-f]{64}$/;
const INVALID_ID_VALUES = new Set(["unknown", "undefined", "null", "n/a", "na"]);
const TARGET_EVIDENCE_DIGEST_DOMAIN = "codex-chatgpt-control/operation-target-evidence/v1";
const CLAIM_EVIDENCE_DIGEST_DOMAIN = "codex-chatgpt-control/tab-claim-evidence/v1";

/** A target HMAC implementation must be keyed by the journal/runtime secret. */
export type BrowserTargetEvidenceDigest = (domain: string, material: unknown) => string | Promise<string>;

/**
 * Provider claims are intentionally separate from the browser-observation
 * target.  Observation exposes only the opaque token; the epoch is retained
 * here for fencing and is never written into user-visible diagnostics.
 */
export type BrowserTargetClaim = Readonly<{
  token: string;
  epoch: number;
}>;

/**
 * The capability matrix is conservative by construction.  Missing fields are
 * false, so an older provider can never accidentally advertise concurrent-tab
 * or cross-process safety.
 */
export type BrowserTargetCapabilities = Readonly<OperationRuntimeCapabilities>;

export type BrowserTargetBindingInput<Page extends PageLike = PageLike> = Readonly<{
  /** An explicit page captured by the caller; never read from RuntimeEnv. */
  page: Readonly<Page>;
  /** The normalized target from `observeBrowserPage(...).snapshot.target`. */
  evidence: OwnershipTargetEvidence;
  /** Fixed is the compatibility default; new_pending carries a blank-task anchor. */
  targetLifecycle?: OperationTargetLifecycle;
  /** Required keyed evidence for a pending new-task anchor. */
  newTargetAnchorDigest?: string;
  blankTaskEvidenceDigest?: string;
  /** Optional provider claim/fencing evidence.  Omission means process scope. */
  authoritativeClaim?: BrowserTargetClaim;
  capabilities?: Partial<BrowserTargetCapabilities>;
  evidenceDigest: BrowserTargetEvidenceDigest;
  owner: CoordinatorOwner;
  coordinator: ProcessTabCoordinator;
  userTurnBaselineDigest?: string;
  assistantTurnBaselineDigest?: string;
  configurationReceiptDigest?: string;
}>;

export type BrowserTargetResource = Readonly<{
  /** `provider` is reserved for validated provider claim + advertised overlap. */
  scope: OperationTargetBindingV1["coordinationScope"];
  resourceKind: CoordinatorResourceKind;
  resourceKey: BrowserResourceKey | TabResourceKey;
  /** True only when different tabs may use independent coordinator actors. */
  concurrentTabs: boolean;
  authoritativeClaimValidated: boolean;
}>;

export type BrowserTargetTransactionOptions = Readonly<{
  priority?: CoordinatorPriority;
  signal?: AbortSignal;
  deadlineAt?: number;
  timeoutMs?: number;
  label?: string;
}>;

export type BrowserTargetTransactionContext<Page extends PageLike = PageLike> = Readonly<{
  page: Readonly<Page>;
  target: OperationTargetBindingV1;
  acquisition: CoordinatorAcquisitionContext;
  /**
   * Validate a fresh read-only observation before any mutation.  The read and
   * mutation should remain one short transaction; polling/sleeping belongs
   * after the promise returned by `withTabTransaction` settles.
   */
  assertCurrent: (evidence: OwnershipTargetEvidence, claim?: BrowserTargetClaim, allowNewTargetEstablishment?: boolean) => void;
}>;

export type BrowserTargetBinding<Page extends PageLike = PageLike> = Readonly<{
  page: Readonly<Page>;
  target: OperationTargetBindingV1;
  /**
   * Evidence for this live observation only. This is deliberately distinct
   * from the journal's canonical targetBindingDigest, which is computed from
   * the complete durable OperationTargetBindingV1 by OperationJournal.
   */
  targetEvidenceDigest: string;
  evidence: OwnershipTargetEvidence;
  capabilities: BrowserTargetCapabilities;
  resource: BrowserTargetResource;
  owner: CoordinatorOwner;
  assertPage: (page: unknown) => void;
  assertCurrent: (evidence: OwnershipTargetEvidence, claim?: BrowserTargetClaim, allowNewTargetEstablishment?: boolean) => void;
  /** Internal one-way latch set after a post-Send identity proof. */
  markTargetEstablished?: (establishment: Readonly<{
    conversationId: string;
    canonicalThreadUrl: string;
  }>) => void;
  withTabTransaction: <T>(
    options: BrowserTargetTransactionOptions,
    callback: (context: BrowserTargetTransactionContext<Page>) => T | PromiseLike<T>
  ) => Promise<T>;
}>;

export type BrowserTargetErrorCode =
  | "invalid_target_evidence"
  | "invalid_capabilities"
  | "invalid_claim"
  | "invalid_owner"
  | "invalid_digest"
  | "navigation_mismatch"
  | "claim_mismatch"
  | "page_mismatch";

/** Errors intentionally contain no caller-controlled IDs, URLs, or digests. */
export class BrowserTargetError extends Error {
  readonly code: BrowserTargetErrorCode;

  constructor(code: BrowserTargetErrorCode, message: string) {
    super(message);
    this.name = "BrowserTargetError";
    this.code = code;
  }
}

type PlainRecord = Record<string, unknown>;
type NormalizedClaim = BrowserTargetClaim | undefined;

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.get !== undefined || descriptor?.set !== undefined) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function fail(code: BrowserTargetErrorCode, message: string): never {
  throw new BrowserTargetError(code, message);
}

function assertPlainRecord(value: unknown, code: BrowserTargetErrorCode, message: string): asserts value is PlainRecord {
  if (!isPlainRecord(value)) fail(code, message);
}

function assertExactKeys(value: PlainRecord, keys: readonly string[], code: BrowserTargetErrorCode): void {
  const allowed = new Set(keys);
  try {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) fail(code, "Unsupported target field.");
    }
  } catch (error) {
    if (error instanceof BrowserTargetError) throw error;
    fail(code, "Unsupported target field.");
  }
}

function stableId(value: unknown, code: BrowserTargetErrorCode = "invalid_target_evidence"): string {
  if (typeof value !== "string") fail(code, "Stable target identity is invalid.");
  const normalized = value.trim();
  if (
    normalized !== value
    ||
    normalized.length === 0
    || normalized.length > 512
    || INVALID_ID_VALUES.has(normalized.toLowerCase())
    || !OPAQUE_ID_PATTERN.test(normalized)
  ) {
    fail(code, "Stable target identity is invalid.");
  }
  return normalized;
}

function digest(value: unknown, code: BrowserTargetErrorCode = "invalid_digest"): string {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) fail(code, "Target evidence digest is invalid.");
  return value;
}

function normalizeIdentity(
  value: unknown,
  label: string,
  required: boolean
): OwnershipIdentityEvidence {
  assertPlainRecord(value, "invalid_target_evidence", "Target identity evidence is invalid.");
  assertExactKeys(value, ["status", "value", "reason"], "invalid_target_evidence");
  if (value.status === "available") {
    if (value.value === undefined) fail("invalid_target_evidence", "Required target identity is unavailable.");
    return Object.freeze({ status: "available" as const, value: stableId(value.value) });
  }
  if (value.status === "unavailable") {
    if (required) fail("invalid_target_evidence", `Required ${label} evidence is unavailable.`);
    if (value.reason !== "not_exposed" && value.reason !== "not_observed" && value.reason !== "redacted") {
      fail("invalid_target_evidence", "Target identity evidence is invalid.");
    }
    return Object.freeze({ status: "unavailable" as const, reason: value.reason });
  }
  fail("invalid_target_evidence", "Target identity evidence is invalid.");
}

function normalizeCanonicalThreadUrl(value: unknown, required = true): OwnershipIdentityEvidence {
  assertPlainRecord(value, "invalid_target_evidence", "Canonical thread evidence is invalid.");
  assertExactKeys(value, ["status", "value", "reason"], "invalid_target_evidence");
  if (value.status === "unavailable" && !required) {
    if (value.reason !== "not_exposed" && value.reason !== "not_observed" && value.reason !== "redacted") {
      fail("invalid_target_evidence", "Canonical thread evidence is invalid.");
    }
    return Object.freeze({ status: "unavailable" as const, reason: value.reason });
  }
  if (value.status !== "available" || typeof value.value !== "string" || !OPAQUE_THREAD_URL_PATTERN.test(value.value)) {
    fail("invalid_target_evidence", "Opaque canonical thread evidence is required.");
  }
  return Object.freeze({ status: "available" as const, value: value.value });
}

function normalizeTargetEvidence(value: unknown, allowPendingIdentity = false): OwnershipTargetEvidence {
  assertPlainRecord(value, "invalid_target_evidence", "Target evidence is invalid.");
  assertExactKeys(
    value,
    ["provider", "browser", "tab", "thread", "conversation", "canonicalThreadUrl", "authoritativeTabClaim", "coordinationScope"],
    "invalid_target_evidence"
  );
  if (value.coordinationScope !== "process" && value.coordinationScope !== "provider") {
    fail("invalid_target_evidence", "Target coordination scope is invalid.");
  }
  const provider = normalizeIdentity(value.provider, "provider", true);
  const browser = normalizeIdentity(value.browser, "browser", true);
  const tab = normalizeIdentity(value.tab, "tab", true);
  const thread = normalizeIdentity(value.thread, "thread", !allowPendingIdentity);
  const conversation = normalizeIdentity(value.conversation, "conversation", !allowPendingIdentity);
  const canonicalThreadUrl = normalizeCanonicalThreadUrl(value.canonicalThreadUrl, !allowPendingIdentity);
  const authoritativeTabClaim = normalizeIdentity(value.authoritativeTabClaim, "authoritative tab claim", false);
  return Object.freeze({
    provider,
    browser,
    tab,
    thread,
    conversation,
    canonicalThreadUrl,
    authoritativeTabClaim,
    coordinationScope: value.coordinationScope
  });
}

function normalizeClaim(value: unknown): NormalizedClaim {
  if (value === undefined) return undefined;
  assertPlainRecord(value, "invalid_claim", "Authoritative claim is invalid.");
  assertExactKeys(value, ["token", "epoch"], "invalid_claim");
  const token = stableId(value.token, "invalid_claim");
  if (!Number.isSafeInteger(value.epoch) || (value.epoch as number) < 0) {
    fail("invalid_claim", "Authoritative claim is invalid.");
  }
  return Object.freeze({ token, epoch: value.epoch as number });
}

function normalizeCapabilities(value: unknown): BrowserTargetCapabilities {
  if (value === undefined) {
    return Object.freeze({
      stableProviderId: false,
      stableBrowserId: false,
      stableTabId: false,
      authoritativeTabClaim: false,
      concurrentTabs: false
    });
  }
  assertPlainRecord(value, "invalid_capabilities", "Target capabilities are invalid.");
  assertExactKeys(value, ["stableProviderId", "stableBrowserId", "stableTabId", "authoritativeTabClaim", "concurrentTabs"], "invalid_capabilities");
  const result = {
    stableProviderId: value.stableProviderId === undefined ? false : value.stableProviderId,
    stableBrowserId: value.stableBrowserId === undefined ? false : value.stableBrowserId,
    stableTabId: value.stableTabId === undefined ? false : value.stableTabId,
    authoritativeTabClaim: value.authoritativeTabClaim === undefined ? false : value.authoritativeTabClaim,
    concurrentTabs: value.concurrentTabs === undefined ? false : value.concurrentTabs
  };
  if (Object.values(result).some(item => typeof item !== "boolean")) {
    fail("invalid_capabilities", "Target capabilities are invalid.");
  }
  return Object.freeze(result as BrowserTargetCapabilities);
}

function normalizeOwner(value: unknown): CoordinatorOwner {
  assertPlainRecord(value, "invalid_owner", "Coordinator owner is invalid.");
  assertExactKeys(value, ["backendSessionId", "ownerId", "operationId"], "invalid_owner");
  const backendSessionId = stableId(value.backendSessionId, "invalid_owner");
  const ownerId = value.ownerId === undefined ? undefined : stableId(value.ownerId, "invalid_owner");
  const operationId = value.operationId === undefined ? undefined : stableId(value.operationId, "invalid_owner");
  return Object.freeze({
    backendSessionId,
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(operationId === undefined ? {} : { operationId })
  });
}

function assertPageLike(value: unknown): asserts value is Readonly<PageLike> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof (value as { evaluate?: unknown }).evaluate !== "function"
  ) {
    fail("invalid_target_evidence", "An explicit page is required.");
  }
}

function availableValue(identity: OwnershipIdentityEvidence, label: string): string {
  if (identity.status !== "available") fail("invalid_target_evidence", `${label} evidence is unavailable.`);
  return identity.value;
}

function claimEvidenceValue(target: OwnershipTargetEvidence): string | undefined {
  return target.authoritativeTabClaim.status === "available" ? target.authoritativeTabClaim.value : undefined;
}

function validateDigestFunction(fn: unknown): asserts fn is BrowserTargetEvidenceDigest {
  if (typeof fn !== "function") fail("invalid_digest", "Target evidence digest function is required.");
}

type TargetDigestRequest = Readonly<{ fn: BrowserTargetEvidenceDigest; domain: string; material: unknown }>;

function* targetDigest(fn: BrowserTargetEvidenceDigest, domain: string, material: unknown): Generator<TargetDigestRequest, string, string> {
  return yield { fn, domain, material };
}

function validateTargetDigest(value: unknown): string {
  try { return digest(value); } catch { fail("invalid_digest", "Target evidence digest is invalid."); }
}

/**
 * Stable identities plus the provider's explicit concurrent-tab capability
 * are sufficient for independent actors inside this SDK process.  This does
 * not make the key a cross-process lock: ProcessTabCoordinator is deliberately
 * process-local, and a provider claim is still required before upgrading the
 * durable target to provider scope.
 */
function supportsProcessTabConcurrency(capabilities: BrowserTargetCapabilities): boolean {
  return capabilities.stableProviderId
    && capabilities.stableBrowserId
    && capabilities.stableTabId
    && capabilities.concurrentTabs;
}

function supportsProviderTabConcurrency(
  capabilities: BrowserTargetCapabilities,
  claimValidated: boolean
): boolean {
  return supportsProcessTabConcurrency(capabilities)
    && claimValidated
    && capabilities.authoritativeTabClaim;
}

function computeResource(
  target: OperationTargetBindingV1,
  capabilities: BrowserTargetCapabilities,
  claimValidated: boolean
): BrowserTargetResource {
  if (supportsProviderTabConcurrency(capabilities, claimValidated)) {
    return Object.freeze({
      scope: "provider" as const,
      resourceKind: "tab" as const,
      resourceKey: createTabResourceKey(target.providerId, target.browserId, target.tabId),
      concurrentTabs: true,
      authoritativeClaimValidated: true
    });
  }
  if (supportsProcessTabConcurrency(capabilities)) {
    return Object.freeze({
      scope: "process" as const,
      resourceKind: "tab" as const,
      resourceKey: createTabResourceKey(target.providerId, target.browserId, target.tabId),
      concurrentTabs: true,
      authoritativeClaimValidated: claimValidated
    });
  }
  // Without provider fencing, serialize the whole browser actor in this
  // process.  A per-tab key is safe only when stable identities and the
  // provider's concurrentTabs capability are both present.
  return Object.freeze({
    scope: "process" as const,
    resourceKind: "browser" as const,
    resourceKey: createBrowserResourceKey(target.providerId, target.browserId),
    concurrentTabs: false,
    authoritativeClaimValidated: claimValidated
  });
}

function targetMaterial(
  evidence: OwnershipTargetEvidence,
  target: OperationTargetBindingV1,
  claim: NormalizedClaim
): unknown {
  return {
    provider: evidence.provider,
    browser: evidence.browser,
    tab: evidence.tab,
    thread: evidence.thread,
    conversation: evidence.conversation,
    canonicalThreadUrl: evidence.canonicalThreadUrl,
    authoritativeTabClaim: evidence.authoritativeTabClaim,
    coordinationScope: target.coordinationScope,
    ...(claim === undefined ? {} : { claimEpoch: claim.epoch })
  };
}

function compareAvailable(
  expected: OwnershipIdentityEvidence,
  observed: OwnershipIdentityEvidence,
  code: BrowserTargetErrorCode
): void {
  const expectedValue = availableValue(expected, "Bound target");
  if (observed.status !== "available" || expectedValue !== observed.value) {
    fail(code, code === "claim_mismatch" ? "Authoritative claim changed." : "Observed target changed.");
  }
}

function compareAvailableIdentityValue(
  expected: string | undefined,
  observed: OwnershipIdentityEvidence,
  code: BrowserTargetErrorCode
): void {
  if (expected === undefined || observed.status !== "available" || observed.value !== expected) {
    fail(code, code === "claim_mismatch" ? "Authoritative claim changed." : "Observed target changed.");
  }
}

function makeTransactionOptions(
  owner: CoordinatorOwner,
  options: BrowserTargetTransactionOptions
): CoordinatorRequestOptions {
  const result: {
    owner: CoordinatorOwner;
    priority: CoordinatorPriority;
    signal?: AbortSignal;
    deadlineAt?: number;
    timeoutMs?: number;
    label?: string;
  } = {
    owner,
    priority: options.priority ?? "mutation"
  };
  if (options.signal !== undefined) result.signal = options.signal;
  if (options.deadlineAt !== undefined) result.deadlineAt = options.deadlineAt;
  if (options.timeoutMs !== undefined) result.timeoutMs = options.timeoutMs;
  if (options.label !== undefined) result.label = options.label;
  return Object.freeze(result);
}

/**
 * Bind one explicit page and one normalized observation to an immutable target.
 * This adapter is deliberately browser-agnostic: it never reads or mutates a
 * legacy `RuntimeEnv`, and it never performs polling or sleeps itself.
 */
export function bindBrowserTarget<Page extends PageLike = PageLike>(
  input: BrowserTargetBindingInput<Page>
): BrowserTargetBinding<Page> {
  const steps = bindBrowserTargetSteps(input);
  let step = steps.next();
  while (!step.done) {
    let value: unknown;
    try { value = step.value.fn(step.value.domain, step.value.material); }
    catch { fail("invalid_digest", "Target evidence digest is invalid."); }
    // Preserve this established synchronous API. Async authorities use the
    // explicit variant below; absorb rejection before failing closed here.
    if (nodeTypes.isPromise(value)) {
      void value.catch(() => undefined);
      fail("invalid_digest", "Use asynchronous target binding for an asynchronous authority.");
    }
    step = steps.next(validateTargetDigest(value));
  }
  return step.value;
}

/** Bind the same immutable target while its journal authority signs remotely. */
export async function bindBrowserTargetAsync<Page extends PageLike = PageLike>(
  input: BrowserTargetBindingInput<Page>
): Promise<BrowserTargetBinding<Page>> {
  const steps = bindBrowserTargetSteps(input);
  let step = steps.next();
  while (!step.done) {
    let value: unknown;
    try { value = await step.value.fn(step.value.domain, step.value.material); }
    catch { fail("invalid_digest", "Target evidence digest is invalid."); }
    step = steps.next(validateTargetDigest(value));
  }
  return step.value;
}

function* bindBrowserTargetSteps<Page extends PageLike = PageLike>(
  input: BrowserTargetBindingInput<Page>
): Generator<TargetDigestRequest, BrowserTargetBinding<Page>, string> {
  assertPlainRecord(input, "invalid_target_evidence", "Target binding input is invalid.");
  assertExactKeys(
    input,
    ["page", "evidence", "targetLifecycle", "newTargetAnchorDigest", "blankTaskEvidenceDigest", "authoritativeClaim", "capabilities", "evidenceDigest", "owner", "coordinator", "userTurnBaselineDigest", "assistantTurnBaselineDigest", "configurationReceiptDigest"],
    "invalid_target_evidence"
  );
  // All later reads cross asynchronous signing boundaries in the async
  // variant. Capture scalar fields and opaque capabilities before yielding.
  input = Object.freeze({ ...input });
  assertPageLike(input.page);
  validateDigestFunction(input.evidenceDigest);
  if (
    input.coordinator === null
    || typeof input.coordinator !== "object"
    || typeof input.coordinator.withTabTransaction !== "function"
    || typeof input.coordinator.withBrowserAcquisition !== "function"
  ) {
    fail("invalid_target_evidence", "A process tab coordinator is required.");
  }

  const targetLifecycle: OperationTargetLifecycle = input.targetLifecycle ?? "fixed";
  if (targetLifecycle !== "fixed" && targetLifecycle !== "new_pending" && targetLifecycle !== "new_established") {
    fail("invalid_target_evidence", "Target lifecycle is invalid.");
  }
  const pending = targetLifecycle === "new_pending";
  const evidence = normalizeTargetEvidence(input.evidence, pending);
  const claim = normalizeClaim(input.authoritativeClaim);
  const capabilities = normalizeCapabilities(input.capabilities);
  const owner = normalizeOwner(input.owner);
  const providerId = availableValue(evidence.provider, "Provider");
  const browserId = availableValue(evidence.browser, "Browser");
  const tabId = availableValue(evidence.tab, "Tab");
  const conversationId = pending ? undefined : availableValue(evidence.conversation, "Conversation");
  const canonicalThreadUrl = pending ? undefined : availableValue(evidence.canonicalThreadUrl, "Canonical thread URL");
  const observedClaim = claimEvidenceValue(evidence);
  if (claim !== undefined && observedClaim !== claim.token) {
    fail("claim_mismatch", "Authoritative claim does not match the observed target.");
  }
  const claimValidated = claim !== undefined && observedClaim === claim.token;
  for (const value of [input.userTurnBaselineDigest, input.assistantTurnBaselineDigest, input.configurationReceiptDigest]) {
    if (value !== undefined) digest(value);
  }
  if (pending) {
    if (
      evidence.thread.status !== "unavailable"
      || evidence.conversation.status !== "unavailable"
      || evidence.canonicalThreadUrl.status !== "unavailable"
    ) {
      fail("invalid_target_evidence", "A pending new target cannot contain provider conversation identity.");
    }
    if (input.newTargetAnchorDigest === undefined || input.blankTaskEvidenceDigest === undefined) {
      fail("invalid_digest", "A pending new target requires blank-task anchor evidence.");
    }
    digest(input.newTargetAnchorDigest);
    digest(input.blankTaskEvidenceDigest);
  } else if (input.newTargetAnchorDigest !== undefined || input.blankTaskEvidenceDigest !== undefined) {
    fail("invalid_target_evidence", "Blank-task anchor evidence is only valid for a pending new target.");
  }

  const providerScope = supportsProviderTabConcurrency(capabilities, claimValidated);
  const targetWithoutDigest: OperationTargetBindingV1 = Object.freeze({
    providerId,
    browserId,
    tabId,
    coordinationScope: providerScope ? "provider" : "process",
    ...(claimValidated ? {
      tabClaimEvidenceDigest: yield* targetDigest(input.evidenceDigest, CLAIM_EVIDENCE_DIGEST_DOMAIN, {
        token: claim?.token,
        epoch: claim?.epoch
      })
    } : {}),
    ...(canonicalThreadUrl === undefined ? {} : { canonicalThreadUrl }),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(input.userTurnBaselineDigest === undefined ? {} : { userTurnBaselineDigest: input.userTurnBaselineDigest }),
    ...(input.assistantTurnBaselineDigest === undefined ? {} : { assistantTurnBaselineDigest: input.assistantTurnBaselineDigest }),
    ...(input.configurationReceiptDigest === undefined ? {} : { configurationReceiptDigest: input.configurationReceiptDigest }),
    evidenceProfile: Object.freeze({
      providerIdentity: "required" as const,
      stableTabId: "required" as const,
      stableConversationId: pending ? "unavailable" as const : "required" as const,
      // Turn IDs are established by the subsequent ownership observation;
      // target binding stores only their baseline evidence digests.
      stableUserTurnId: "unavailable" as const,
      authoritativeTabClaim: providerScope ? "required" as const : "unavailable" as const,
      replacementTabRecovery: false
    }),
    ...(pending ? {
      targetLifecycle: "new_pending" as const,
      newTargetAnchorDigest: input.newTargetAnchorDigest,
      blankTaskEvidenceDigest: input.blankTaskEvidenceDigest
    } : {})
  });
  const targetEvidenceDigest = yield* targetDigest(input.evidenceDigest,
    TARGET_EVIDENCE_DIGEST_DOMAIN,
    targetMaterial(evidence, targetWithoutDigest, claim)
  );
  const target = Object.freeze({ ...targetWithoutDigest });
  let activeTarget: OperationTargetBindingV1 = target;
  const resource = computeResource(target, capabilities, claimValidated);
  const page = input.page;
  const coordinator = input.coordinator;
  let targetEstablished = false;

  const assertPage = (observedPage: unknown): void => {
    if (observedPage !== page) fail("page_mismatch", "The supplied page is not the bound operation page.");
  };
  const assertCurrent = (current: OwnershipTargetEvidence, currentClaim?: BrowserTargetClaim, allowNewTargetEstablishment = false): void => {
    const observed = normalizeTargetEvidence(current, pending);
    compareAvailable(evidence.provider, observed.provider, "navigation_mismatch");
    compareAvailable(evidence.browser, observed.browser, "navigation_mismatch");
    compareAvailable(evidence.tab, observed.tab, "navigation_mismatch");
    if (!pending || targetEstablished) {
      if (!targetEstablished) compareAvailable(evidence.thread, observed.thread, "navigation_mismatch");
      if (targetEstablished) {
        compareAvailableIdentityValue(activeTarget.conversationId, observed.conversation, "navigation_mismatch");
        compareAvailableIdentityValue(activeTarget.canonicalThreadUrl, observed.canonicalThreadUrl, "navigation_mismatch");
      } else {
        compareAvailable(evidence.conversation, observed.conversation, "navigation_mismatch");
        compareAvailable(evidence.canonicalThreadUrl, observed.canonicalThreadUrl, "navigation_mismatch");
      }
    } else {
      const identities = [observed.thread, observed.conversation, observed.canonicalThreadUrl];
      const availableCount = identities.filter(identity => identity.status === "available").length;
      if (availableCount !== 0 && availableCount !== identities.length) {
        fail("navigation_mismatch", "Observed new-target identity is incomplete.");
      }
    }
    if (claimValidated) {
      compareAvailable(evidence.authoritativeTabClaim, observed.authoritativeTabClaim, "claim_mismatch");
      const normalizedCurrentClaim = normalizeClaim(currentClaim);
      if (
        normalizedCurrentClaim === undefined
        || normalizedCurrentClaim.token !== claim?.token
        || normalizedCurrentClaim.epoch !== claim?.epoch
      ) {
        fail("claim_mismatch", "Authoritative claim changed.");
      }
    }
  };
  const withTabTransaction = async <T>(
    options: BrowserTargetTransactionOptions,
    callback: (context: BrowserTargetTransactionContext<Page>) => T | PromiseLike<T>
  ): Promise<T> => {
    if (typeof callback !== "function") fail("invalid_target_evidence", "A transaction callback is required.");
    if (!isPlainRecord(options)) fail("invalid_target_evidence", "Transaction options are invalid.");
    assertExactKeys(options, ["priority", "signal", "deadlineAt", "timeoutMs", "label"], "invalid_target_evidence");
    const requestOptions = makeTransactionOptions(owner, options);
    const run = (acquisition: CoordinatorAcquisitionContext): T | PromiseLike<T> => callback(Object.freeze({
      page,
      target: activeTarget,
      acquisition,
      assertCurrent
    }));
    if (resource.resourceKind === "tab") {
      return coordinator.withTabTransaction(resource.resourceKey as TabResourceKey, requestOptions, run);
    }
    return coordinator.withBrowserAcquisition(resource.resourceKey as BrowserResourceKey, requestOptions, run);
  };

  const binding: BrowserTargetBinding<Page> = {
    page,
    get target() { return activeTarget; },
    targetEvidenceDigest,
    evidence,
    capabilities,
    resource,
    owner,
    assertPage,
    assertCurrent,
    ...(pending ? {
      markTargetEstablished: (establishment: Readonly<{ conversationId: string; canonicalThreadUrl: string }>) => {
        if (
          !isPlainRecord(establishment)
          || typeof establishment.conversationId !== "string"
          || !OPAQUE_ID_PATTERN.test(establishment.conversationId)
          || typeof establishment.canonicalThreadUrl !== "string"
          || !OPAQUE_THREAD_URL_PATTERN.test(establishment.canonicalThreadUrl)
        ) return;
        activeTarget = Object.freeze({
          providerId: target.providerId,
          browserId: target.browserId,
          tabId: target.tabId,
          coordinationScope: target.coordinationScope,
          ...(target.tabClaimEvidenceDigest === undefined ? {} : { tabClaimEvidenceDigest: target.tabClaimEvidenceDigest }),
          canonicalThreadUrl: establishment.canonicalThreadUrl,
          conversationId: establishment.conversationId,
          ...(target.userTurnBaselineDigest === undefined ? {} : { userTurnBaselineDigest: target.userTurnBaselineDigest }),
          ...(target.assistantTurnBaselineDigest === undefined ? {} : { assistantTurnBaselineDigest: target.assistantTurnBaselineDigest }),
          ...(target.configurationReceiptDigest === undefined ? {} : { configurationReceiptDigest: target.configurationReceiptDigest }),
          evidenceProfile: Object.freeze({
            ...target.evidenceProfile,
            stableConversationId: "required" as const,
            stableUserTurnId: "required" as const
          })
        });
        targetEstablished = true;
      }
    } : {}),
    withTabTransaction
  };
  return Object.freeze(binding);
}
