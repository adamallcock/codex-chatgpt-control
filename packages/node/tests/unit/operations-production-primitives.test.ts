import { describe, expect, it } from "vitest";
import type { LocatorLike, PageLike } from "../../src/types.js";
import {
  createProductionOperationPrimitives,
  PRODUCTION_OPERATION_PRIMITIVE_INVENTORY
} from "../../src/operations/production-primitives.js";
import { observeBrowserPage } from "../../src/operations/browser-observation.js";
import { runSendOnce, type SendOnceObservers } from "../../src/operations/send-once.js";
import type { OperationTargetBindingV1 } from "../../src/operations/types.js";
import type { SubmissionExpectedEnvelope } from "../../src/operations/submission.js";
import type { OperationStagingCallbackRequest } from "../../src/operations/staging.js";
import { TURN_OWNERSHIP_SCHEMA_VERSION, type OwnershipBaseline } from "../../src/operations/turn-ownership.js";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_DIGEST = `hmac-sha256:${"a".repeat(64)}`;
const TARGET_DIGEST = `hmac-sha256:${"b".repeat(64)}`;
const CLAIM = "claim-1";
const SECRET_PROMPT = "secret prompt /private/should-not-escape.txt";

const evidenceDigest = (domain: string, material: unknown): string => {
  const text = `${domain}:${JSON.stringify(material)}`;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return `hmac-sha256:${hash.toString(16).padStart(8, "0").repeat(8).slice(0, 64)}`;
};

type RawTurn = {
  role: "user" | "assistant";
  stableId: string;
  parentStableId?: string;
  branchStableId?: string;
  ordinal: number;
  text: string;
  contentHtml?: string;
  structure: { tag: string; childCount: number; artifactCount: number };
  state?: "generating" | "terminal";
  finishReason?: string;
  artifacts: [];
};

function rawObservation(turns: RawTurn[]): Record<string, unknown> {
  return {
    canonicalUrl: "https://chatgpt.com/c/conversation-1",
    conversationId: "conversation-1",
    threadId: "thread-1",
    turns,
    completeness: "complete",
    terminalState: turns.some(turn => turn.state === "generating")
      ? "generating"
      : turns.some(turn => turn.role === "assistant") ? "terminal" : "idle"
  };
}

function blankTaskObservation(): Record<string, unknown> {
  return {
    canonicalUrl: "https://chatgpt.com/",
    turns: [],
    completeness: "complete",
    terminalState: "idle"
  };
}

function turn(role: RawTurn["role"], stableId: string, ordinal: number, extras: Partial<RawTurn> = {}): RawTurn {
  return {
    role,
    stableId,
    ordinal,
    text: role === "user" ? "private prompt" : "private response",
    structure: { tag: "div", childCount: 1, artifactCount: 0 },
    artifacts: [],
    ...extras
  };
}

const target: OperationTargetBindingV1 = {
  providerId: "provider-1",
  browserId: "browser-1",
  tabId: "tab-1",
  coordinationScope: "process",
  conversationId: "conversation-1",
  canonicalThreadUrl: "https://opaque.invalid/thread/" + "1".repeat(64),
  evidenceProfile: {
    providerIdentity: "required",
    stableTabId: "required",
    stableConversationId: "required",
    stableUserTurnId: "unavailable",
    authoritativeTabClaim: "unavailable",
    replacementTabRecovery: false
  }
};

const pendingTarget: OperationTargetBindingV1 = {
  providerId: "provider-1",
  browserId: "browser-1",
  tabId: "tab-new",
  coordinationScope: "process",
  evidenceProfile: {
    providerIdentity: "required",
    stableTabId: "required",
    stableConversationId: "unavailable",
    stableUserTurnId: "unavailable",
    authoritativeTabClaim: "unavailable",
    replacementTabRecovery: false
  },
  targetLifecycle: "new_pending",
  newTargetAnchorDigest: evidenceDigest("new-anchor", { tab: "tab-new" }),
  blankTaskEvidenceDigest: evidenceDigest("new-blank", { tab: "tab-new" })
};

function expected(primitivesRequestDigest = REQUEST_DIGEST): SubmissionExpectedEnvelope {
  return {
    surface: "chat",
    targetBindingDigest: TARGET_DIGEST,
    configurationReceiptDigest: evidenceDigest("configuration-request", primitivesRequestDigest),
    composerReceiptDigest: evidenceDigest("composer-request", primitivesRequestDigest),
    attachmentManifest: { count: 0, orderPolicy: "exact", identities: [] }
  };
}

function composerLocator(options: Readonly<{
  count?: number;
  visible?: boolean[];
  value?: string;
  onFill?: (value: string) => void;
}> = {}): LocatorLike {
  const count = options.count ?? 1;
  const visible = options.visible ?? Array.from({ length: count }, () => true);
  const make = (index: number): LocatorLike => ({
    count: async () => count,
    nth: childIndex => make(childIndex),
    isVisible: async () => visible[index] ?? false,
    evaluate: async <T>(fn: (element: Element) => T) => fn({
      tagName: "TEXTAREA",
      value: options.value ?? SECRET_PROMPT
    } as unknown as Element),
    fill: async value => options.onFill?.(value)
  });
  return make(0);
}

function pageFixture(options: Readonly<{
  observations: Record<string, unknown>[];
  composer?: LocatorLike;
  send?: LocatorLike;
  stop?: LocatorLike;
  onWait?: () => never;
}>): PageLike & { evaluateCount: () => number; waitCount: () => number } {
  let evaluateCount = 0;
  let waitCount = 0;
  let observationIndex = 0;
  const page: PageLike = {
    getByRole: role => role === "textbox"
      ? options.composer ?? composerLocator()
      : role === "button" && options.send !== undefined
        ? options.send
        : role === "button" && options.stop !== undefined
          ? options.stop
          : composerLocator({ count: 0 }),
    evaluate: async (fn, arg) => {
      expect(fn.toString()).not.toContain("querySelectorAll");
      expect(fn.toString()).not.toContain('structural.includes("composer")');
      expect(fn.toString()).not.toContain("Array.from");
      evaluateCount += 1;
      if (arg !== null && typeof arg === "object" && "observationOnly" in arg) {
        return {
          status: "ready",
          composerCount: 1,
          fileInputCount: 1,
          inputFilesReadable: true,
          attachmentRegionCount: 0,
          facts: [],
          secondaryFacts: [],
          factSource: "none",
          orderDeterministic: true,
          activationCandidateCount: 0
        } as never;
      }
      const next = options.observations[Math.min(observationIndex++, options.observations.length - 1)];
      return next as never;
    },
    waitForTimeout: async _milliseconds => {
      waitCount += 1;
      options.onWait?.();
    }
  };
  return Object.assign(page, { evaluateCount: () => evaluateCount, waitCount: () => waitCount });
}

function stagingRequest(kind: OperationStagingCallbackRequest["kind"] = "composer_set"): OperationStagingCallbackRequest {
  return {
    operationId: OPERATION_ID,
    requestDigest: REQUEST_DIGEST,
    targetBindingDigest: TARGET_DIGEST,
    actionId: "22222222-2222-4222-8222-222222222222",
    kind,
    desiredStateDigest: evidenceDigest("staging-desired", { requestDigest: REQUEST_DIGEST, kind }),
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 10_000
  };
}

function collectorBaseline(): OwnershipBaseline {
  return {
    schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
    snapshotDigest: evidenceDigest("collector-baseline", { operationId: OPERATION_ID, targetBindingDigest: TARGET_DIGEST }),
    target: {
      provider: { status: "available", value: target.providerId },
      browser: { status: "available", value: target.browserId },
      tab: { status: "available", value: target.tabId },
      thread: { status: "available", value: "thread-1" },
      conversation: { status: "available", value: "conversation-1" },
      canonicalThreadUrl: { status: "available", value: target.canonicalThreadUrl! },
      authoritativeTabClaim: { status: "unavailable", reason: "not_exposed" },
      coordinationScope: "process"
    },
    userTurns: [],
    assistantTurns: [],
    completeness: "complete"
  };
}

describe("provider-specific production operation primitives", () => {
  it("sets the composer once, keeps private prompt/path out of evidence, and does not wait", async () => {
    let filled: string | undefined;
    const page = pageFixture({
      observations: [],
      composer: composerLocator({ value: "", onFill: value => { filled = value; } }),
      onWait: () => { throw new Error("wait must not be called"); }
    });
    const primitives = createProductionOperationPrimitives({
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      desiredComposerText: SECRET_PROMPT
    });
    const request = stagingRequest();
    const result = await primitives.staging!.readCurrent!({ ...request, page, target });
    expect(result.status).toBe("not_satisfied");
    expect(JSON.stringify(result)).not.toContain(SECRET_PROMPT);
    expect(JSON.stringify(result)).not.toContain("/private/");

    await primitives.staging!.mutateOnce!({ ...request, page, target });
    expect(filled).toBe(SECRET_PROMPT);
    expect(page.waitCount()).toBe(0);
  });

  it("returns precise fail-closed blockers for unsupported staging kinds and ambiguous composer controls", async () => {
    const ambiguous = pageFixture({ observations: [], composer: composerLocator({ count: 2, visible: [true, true] }) });
    const primitives = createProductionOperationPrimitives({
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      desiredComposerText: SECRET_PROMPT
    });
    const mutation = await primitives.staging!.mutateOnce!({ ...stagingRequest(), page: ambiguous, target }).catch(error => error);
    expect(mutation).toMatchObject({ code: "composer_control_unavailable" });

    const unsupported = await primitives.staging!.readCurrent!({
      ...stagingRequest("configuration_set"),
      page: ambiguous,
      target
    });
    expect(unsupported).toMatchObject({ status: "unavailable", blockerCode: "configuration_primitive_unwired" });
  });

  it("bounds composer values inside evaluate and refuses unbounded locator fallbacks", async () => {
    const primitives = createProductionOperationPrimitives({
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      desiredComposerText: SECRET_PROMPT
    });
    const oversized = pageFixture({
      observations: [],
      composer: composerLocator({ value: "x".repeat(8 * 1024 * 1024 + 1) })
    });
    const oversizedResult = await primitives.staging!.readCurrent!({
      ...stagingRequest(),
      page: oversized,
      target
    });
    expect(oversizedResult).toMatchObject({ status: "unavailable", blockerCode: "composer_control_unavailable" });

    const providerOnly = pageFixture({
      observations: [],
      composer: {
        count: async () => 1,
        isVisible: async () => true,
        textContent: async () => SECRET_PROMPT
      }
    });
    const providerOnlyResult = await primitives.staging!.readCurrent!({
      ...stagingRequest(),
      page: providerOnly,
      target
    });
    expect(providerOnlyResult).toMatchObject({ status: "unavailable", blockerCode: "composer_control_unavailable" });
  });

  it("reads a contenteditable composer from its text tree when the bridge exposes an empty synthetic value", async () => {
    const root = {
      nodeType: 1,
      tagName: "DIV",
      value: "",
      firstChild: undefined as unknown,
      nextSibling: null,
      parentNode: null,
      getAttribute: (name: string) => name === "contenteditable" ? "true" : null
    };
    const text = {
      nodeType: 3,
      nodeValue: SECRET_PROMPT,
      firstChild: null,
      nextSibling: null,
      parentNode: root
    };
    root.firstChild = text;
    const composer: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      evaluate: async <T>(fn: (element: Element) => T) => fn(root as unknown as Element)
    };
    const primitives = createProductionOperationPrimitives({
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      desiredComposerText: SECRET_PROMPT
    });

    const result = await primitives.staging!.readCurrent!({
      ...stagingRequest(),
      page: pageFixture({ observations: [], composer }),
      target
    });

    expect(result.status).toBe("satisfied");
  });

  it("activates Send at most once and reconciles one exact post-Send user delta", async () => {
    let clicks = 0;
    const send = composerLocator();
    send.click = async () => { clicks += 1; };
    send.evaluate = async <T>() => true as T;
    const before = rawObservation([
      turn("user", "user-old", 0),
      turn("assistant", "assistant-old", 0, { parentStableId: "user-old", branchStableId: "branch-old", state: "terminal", finishReason: "stop" })
    ]);
    const after = rawObservation([
      turn("user", "user-old", 0),
      turn("assistant", "assistant-old", 0, { parentStableId: "user-old", branchStableId: "branch-old", state: "terminal", finishReason: "stop" }),
      turn("user", "user-new", 1),
      turn("assistant", "assistant-new", 1, { parentStableId: "user-new", branchStableId: "branch-new", state: "generating" })
    ]);
    const page = pageFixture({ observations: [before, before, after], composer: composerLocator(), send });
    const primitives = createProductionOperationPrimitives({
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      desiredComposerText: SECRET_PROMPT,
      target
    });
    // The real submission coordinator supplies this target-bearing read before
    // invoking Send; recovery without that target is intentionally unavailable.
    await primitives.submission!.observeStaging!({
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      surface: "chat",
      targetBindingDigest: TARGET_DIGEST,
      configurationReceiptDigest: expected().configurationReceiptDigest,
      composerReceiptDigest: expected().composerReceiptDigest
    }, page, target);
    const observers = primitives.submission!.sendObservers! as SendOnceObservers;
    const result = await runSendOnce({
      page,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      surface: "chat",
      actionId: "22222222-2222-4222-8222-222222222222",
      mode: "mutate_once",
      expected: expected(),
      observers
    });
    expect(result).toMatchObject({ status: "submitted", userTurnId: "user-new" });
    expect(JSON.stringify(result)).not.toContain(SECRET_PROMPT);
    expect(JSON.stringify(result)).not.toContain("/private/");
    expect(clicks).toBe(1);
  });

  it("establishes a new provider conversation from one exact post-Send observation", async () => {
    let clicks = 0;
    const send = composerLocator();
    send.click = async () => { clicks += 1; };
    send.evaluate = async <T>() => true as T;
    const anchorProbe = await observeBrowserPage(pageFixture({ observations: [blankTaskObservation()] }), {
      operationId: OPERATION_ID,
      target: {
        providerId: "provider-1",
        browserId: "browser-1",
        tabId: "tab-new",
        coordinationScope: "process",
        targetLifecycle: "new_pending"
      },
      evidenceDigest
    });
    const targetForTest: OperationTargetBindingV1 = {
      ...pendingTarget,
      newTargetAnchorDigest: anchorProbe.newTargetAnchor!.anchorDigest,
      blankTaskEvidenceDigest: anchorProbe.newTargetAnchor!.blankTaskEvidenceDigest
    };
    const after = rawObservation([
      turn("user", "user-new", 0),
      turn("assistant", "assistant-new", 0, { parentStableId: "user-new", branchStableId: "branch-new", state: "generating" })
    ]);
    const page = pageFixture({ observations: [blankTaskObservation(), blankTaskObservation(), after], composer: composerLocator(), send });
    const primitives = createProductionOperationPrimitives({
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      desiredComposerText: SECRET_PROMPT,
      target: targetForTest
    });
    await primitives.submission!.observeStaging!({
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      surface: "chat",
      targetBindingDigest: TARGET_DIGEST,
      configurationReceiptDigest: expected().configurationReceiptDigest,
      composerReceiptDigest: expected().composerReceiptDigest
    }, page, targetForTest);
    const result = await runSendOnce({
      page,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      surface: "chat",
      actionId: "22222222-2222-4222-8222-222222222222",
      mode: "mutate_once",
      expected: expected(),
      observers: primitives.submission!.sendObservers!
    });
    expect(result).toMatchObject({
      status: "submitted",
      userTurnId: "user-new",
      targetEstablishment: {
        targetBindingDigest: TARGET_DIGEST,
        causalSendActionId: "22222222-2222-4222-8222-222222222222",
        conversationId: "conversation-1"
      }
    });
    expect(clicks).toBe(1);
  });

  it("retries transient post-Send observations without repeating the Send activation", async () => {
    let clicks = 0;
    const send = composerLocator();
    send.click = async () => { clicks += 1; };
    send.evaluate = async <T>() => true as T;
    const anchorProbe = await observeBrowserPage(pageFixture({ observations: [blankTaskObservation()] }), {
      operationId: OPERATION_ID,
      target: {
        providerId: "provider-1",
        browserId: "browser-1",
        tabId: "tab-new",
        coordinationScope: "process",
        targetLifecycle: "new_pending"
      },
      evidenceDigest
    });
    const targetForTest: OperationTargetBindingV1 = {
      ...pendingTarget,
      newTargetAnchorDigest: anchorProbe.newTargetAnchor!.anchorDigest,
      blankTaskEvidenceDigest: anchorProbe.newTargetAnchor!.blankTaskEvidenceDigest
    };
    const after = rawObservation([
      turn("user", "user-new", 0),
      turn("assistant", "assistant-new", 0, { parentStableId: "user-new", branchStableId: "branch-new", state: "generating" })
    ]);
    const page = pageFixture({
      observations: [blankTaskObservation(), blankTaskObservation(), rawObservation([]), after],
      composer: composerLocator(),
      send
    });
    const primitives = createProductionOperationPrimitives({
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      desiredComposerText: SECRET_PROMPT,
      target: targetForTest
    });
    await primitives.submission!.observeStaging!({
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      surface: "chat",
      targetBindingDigest: TARGET_DIGEST,
      configurationReceiptDigest: expected().configurationReceiptDigest,
      composerReceiptDigest: expected().composerReceiptDigest
    }, page, targetForTest);
    expect(primitives.submission!.sendObservers).toMatchObject({
      maxPostconditionAttempts: 32,
      postconditionIntervalMs: 250,
      postconditionTimeoutMs: 15_000
    });

    const result = await runSendOnce({
      page,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      surface: "chat",
      actionId: "22222222-2222-4222-8222-222222222222",
      mode: "mutate_once",
      expected: expected(),
      observers: primitives.submission!.sendObservers!
    });

    expect(result).toMatchObject({ status: "submitted", userTurnId: "user-new", assistantTurnId: "assistant-new" });
    expect(clicks).toBe(1);
  });

  it("reconstructs the blank baseline after restart and never requires a second Send", async () => {
    const anchorProbe = await observeBrowserPage(pageFixture({ observations: [blankTaskObservation()] }), {
      operationId: OPERATION_ID,
      target: {
        providerId: "provider-1",
        browserId: "browser-1",
        tabId: "tab-new",
        coordinationScope: "process",
        targetLifecycle: "new_pending"
      },
      evidenceDigest
    });
    const targetForTest: OperationTargetBindingV1 = {
      ...pendingTarget,
      newTargetAnchorDigest: anchorProbe.newTargetAnchor!.anchorDigest,
      blankTaskEvidenceDigest: anchorProbe.newTargetAnchor!.blankTaskEvidenceDigest
    };
    const after = rawObservation([turn("user", "user-after-restart", 0)]);
    const page = pageFixture({ observations: [after] });
    const primitives = createProductionOperationPrimitives({
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      target: targetForTest
    });
    const observers = primitives.submission!.sendObservers!;
    const precondition = await observers.observePrecondition({
      page,
      expected: expected(),
      mode: "observe_only"
    });
    expect(precondition.status).toBe("exact");
    expect(page.evaluateCount()).toBe(0);
    const postcondition = await observers.observePostcondition({
      page,
      actionId: "22222222-2222-4222-8222-222222222222",
      expected: expected(),
      mode: "observe_only",
      baseline: precondition.status === "exact" ? precondition.baseline : { userTurnEvidenceDigest: REQUEST_DIGEST },
      activation: "not_attempted",
      attempt: 1
    });
    expect(postcondition).toMatchObject({
      status: "already_submitted",
      userTurnId: "user-after-restart",
      targetEstablishment: { conversationId: "conversation-1" }
    });
    expect(page.evaluateCount()).toBe(1);
  });

  it.each(["markdown", "text"] as const)("derives an authenticated prior cursor and preserves %s format for exact terminal capture", async responseFormat => {
    const actionId = "22222222-2222-4222-8222-222222222222";
    const terminalTurns = [
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, {
        parentStableId: "user-1",
        branchStableId: "branch-1",
        state: "terminal",
        finishReason: "stop"
      })
    ];
    const rawMetadata = rawObservation(terminalTurns);
    const rawTerminal = rawObservation(terminalTurns.map(turnValue => turnValue.role === "assistant"
      ? { ...turnValue, contentHtml: "<p>Stopped response</p>" }
      : turnValue));
    const targetProof = await observeBrowserPage(pageFixture({ observations: [rawMetadata] }), {
      operationId: OPERATION_ID,
      target: {
        providerId: target.providerId,
        browserId: target.browserId,
        tabId: target.tabId,
        coordinationScope: target.coordinationScope,
        targetLifecycle: "fixed",
        expectedConversationId: target.conversationId!
      },
      evidenceDigest,
      responseContent: "metadata"
    });
    const baseline: OwnershipBaseline = {
      ...collectorBaseline(),
      target: targetProof.snapshot.target
    };
    const proof = await observeBrowserPage(pageFixture({ observations: [rawMetadata] }), {
      operationId: OPERATION_ID,
      target: {
        providerId: target.providerId,
        browserId: target.browserId,
        tabId: target.tabId,
        coordinationScope: target.coordinationScope,
        targetLifecycle: "fixed",
        expectedConversationId: target.conversationId!
      },
      evidenceDigest,
      responseContent: "metadata",
      baseline
    });
    const user = proof.snapshot.userTurns[0]!;
    const delta = proof.snapshot.postSendDelta!;
    const page = pageFixture({
      observations: [rawMetadata, rawTerminal],
      onWait: () => { throw new Error("collector must not use page waits"); }
    });
    const primitives = createProductionOperationPrimitives({
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      target
    });
    const context = await primitives.collector!.readContext!({
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      targetBindingDigest: TARGET_DIGEST,
      submissionActionId: actionId,
      submissionActionKind: "send",
      submissionWitness: {
        actionId,
        actionKind: "send",
        baselineSnapshotDigest: baseline.snapshotDigest,
        postSendDeltaDigest: delta.deltaDigest,
        operationUserEvidenceDigest: user.evidenceDigest,
        userTurnStableId: user.stableId!
      },
      baseline,
      signal: new AbortController().signal
    }, page, target);
    expect(context.prior).toMatchObject({
      phase: "owned_assistant_terminal",
      userTurnId: "user-1",
      assistantTurnId: "assistant-1",
      assistantBranchId: "branch-1"
    });
    const observed = await primitives.collector!.observe!({
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      targetBindingDigest: TARGET_DIGEST,
      responseContent: "metadata",
      responseFormat,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000
    }, page, target, context);
    expect(observed.schemaVersion).toBe("chatgpt.browser_control.collector.v1");
    expect(observed.terminal).toMatchObject({
      userTurnId: "user-1",
      assistantTurnId: "assistant-1",
      branchStableId: "branch-1",
      finishReason: "stop",
      responseFormat
    });
    expect(page.waitCount()).toBe(0);
    expect(PRODUCTION_OPERATION_PRIMITIVE_INVENTORY.wired).toContain("durable_baseline_projection");
    expect(PRODUCTION_OPERATION_PRIMITIVE_INVENTORY.wired).toContain("submission_witness_recovery");
    expect(PRODUCTION_OPERATION_PRIMITIVE_INVENTORY.scope).toBe("base_primitive_factory");
    expect(PRODUCTION_OPERATION_PRIMITIVE_INVENTORY.unwired).not.toContain("new_thread_target_lifecycle");
    expect(PRODUCTION_OPERATION_PRIMITIVE_INVENTORY.unwired).not.toContain("submission_witness_recovery");
  });

  it("fails closed for a genuine new-thread target before conversation identity exists", async () => {
    const { conversationId: _conversationId, canonicalThreadUrl: _canonicalThreadUrl, ...targetWithoutIdentity } = target;
    const newThreadTarget: OperationTargetBindingV1 = targetWithoutIdentity;
    const { canonicalThreadUrl: _missingCanonical, ...targetWithoutCanonical } = target;
    for (const candidate of [newThreadTarget, targetWithoutCanonical]) {
      const page = pageFixture({ observations: [rawObservation([])] });
      const primitives = createProductionOperationPrimitives({
        evidenceDigest,
        operationId: OPERATION_ID,
        requestDigest: REQUEST_DIGEST,
        desiredComposerText: SECRET_PROMPT,
        target: candidate
      });
      const send = primitives.submission!.sendObservers!;
      const observed = await send.observePrecondition({
        page,
        expected: expected(),
        mode: "mutate_once"
      });
      expect(observed).toEqual({ status: "unavailable", code: "target_evidence_unavailable" });
      expect(page.evaluateCount()).toBe(0);
    }
  });

  it("does not initiate a chooser handoff without provider attachment identity proof", async () => {
    let chooserWaits = 0;
    const page = pageFixture({ observations: [] });
    page.waitForEvent = async () => {
      chooserWaits += 1;
      throw new Error("chooser must not be touched");
    };
    const primitives = createProductionOperationPrimitives({ evidenceDigest, target });
    const result = await primitives.submission!.handoffFiles!({
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      surface: "chat",
      actionId: "22222222-2222-4222-8222-222222222222",
      targetBindingDigest: TARGET_DIGEST,
      manifest: {
        count: 1,
        orderPolicy: "exact",
        identities: [{ ordinal: 0, identityDigest: evidenceDigest("file", { ordinal: 0 }) }]
      }
    }, [{
      sourcePath: "/private/secret.pdf",
      manifest: { displayName: "secret.pdf", bytes: 1, contentSha256: "1".repeat(64) },
      proof: { device: "1", inode: "1", size: "1", modifiedNs: "1", changedNs: "1" }
    }], page, target);
    expect(result).toEqual({ status: "not_satisfied", blockerCode: "attachment_manifest_mismatch" });
    expect(JSON.stringify(result)).not.toContain("/private/secret.pdf");
    expect(chooserWaits).toBe(0);
  });

  it("does not click an ambiguous Stop control", async () => {
    let clicks = 0;
    const stop = composerLocator({ count: 2, visible: [true, true] });
    stop.click = async () => { clicks += 1; };
    const page = pageFixture({
      observations: [rawObservation([
        turn("user", "user-1", 0),
        turn("assistant", "assistant-1", 0, { parentStableId: "user-1", branchStableId: "branch-1", state: "generating" })
      ])],
      stop
    });
    const primitives = createProductionOperationPrimitives({ evidenceDigest, authoritativeTabClaim: CLAIM });
    const result = await primitives.control!.executeOnce!({
      operationId: OPERATION_ID,
      parentRequestDigest: REQUEST_DIGEST,
      targetBindingDigest: TARGET_DIGEST,
      controlActionId: "33333333-3333-4333-8333-333333333333",
      action: "stop",
      expectedAssistantTurnId: "assistant-1",
      requestDigest: REQUEST_DIGEST,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000
    }, page, target);
    expect(result).toMatchObject({ status: "uncertain", blockerCode: "send_control_unavailable" });
    expect(clicks).toBe(0);
  });

  it("releases the mutation boundary before observing a successful Stop postcondition", async () => {
    let clicks = 0;
    const stop = composerLocator();
    stop.click = async () => { clicks += 1; };
    const page = pageFixture({
      observations: [rawObservation([
        turn("user", "user-1", 0),
        turn("assistant", "assistant-1", 0, {
          parentStableId: "user-1",
          branchStableId: "branch-1",
          state: "terminal",
          finishReason: "stop"
        })
      ])],
      stop
    });
    const primitives = createProductionOperationPrimitives({ evidenceDigest, target });
    const request = {
      operationId: OPERATION_ID,
      parentRequestDigest: REQUEST_DIGEST,
      targetBindingDigest: TARGET_DIGEST,
      controlActionId: "33333333-3333-4333-8333-333333333333",
      action: "stop" as const,
      expectedAssistantTurnId: "assistant-1",
      requestDigest: REQUEST_DIGEST,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000
    };

    const mutation = await primitives.control!.executeOnce!(request, page, target);
    expect(mutation).toEqual({ status: "uncertain" });
    expect(clicks).toBe(1);
    expect(page.evaluateCount()).toBe(0);

    const observed = await primitives.control!.observePostcondition!(request, page, target);
    expect(observed).toMatchObject({ status: "satisfied", assistantTurnId: "assistant-1" });
    expect(page.evaluateCount()).toBe(1);
  });
});


describe("asynchronous composer signing", () => {
  it.each(["resolve", "reject", "cancel"] as const)("holds composer mutation until signing settles: %s", async outcome => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let fills = 0;
    const controller = new AbortController();
    const page = pageFixture({ observations: [], composer: composerLocator({ value: "", onFill: () => { fills += 1; } }) });
    const primitives = createProductionOperationPrimitives({
      evidenceDigest: async (domain, material) => {
        await pending;
        if (outcome === "reject") throw new Error("private signing failure");
        return evidenceDigest(domain, material);
      },
      operationId: OPERATION_ID, requestDigest: REQUEST_DIGEST, desiredComposerText: SECRET_PROMPT
    });
    const mutation = primitives.staging!.mutateOnce!({ ...stagingRequest(), signal: controller.signal, page, target });
    const assertion = outcome === "resolve"
      ? expect(mutation).resolves.toEqual({ status: "started" })
      : expect(mutation).rejects.toMatchObject({ code: outcome === "reject" ? "composer_request_mismatch" : "operation_cancelled" });
    await Promise.resolve();
    expect(fills).toBe(0);
    if (outcome === "cancel") controller.abort();
    release();
    await assertion;
    expect(fills).toBe(outcome === "resolve" ? 1 : 0);
  });

  it("returns concrete signed observation fields from an async authority", async () => {
    const page = pageFixture({ observations: [], composer: composerLocator({ value: SECRET_PROMPT }) });
    const primitives = createProductionOperationPrimitives({
      evidenceDigest: async (domain, material) => evidenceDigest(domain, material),
      operationId: OPERATION_ID, requestDigest: REQUEST_DIGEST, desiredComposerText: SECRET_PROMPT
    });
    const observed = await primitives.staging!.readCurrent!({ ...stagingRequest(), page, target });
    expect(observed).toMatchObject({ status: "satisfied", currentStateDigest: expect.stringMatching(/^hmac-sha256:/), evidenceDigest: expect.stringMatching(/^hmac-sha256:/) });
    expect(JSON.stringify(observed)).not.toContain(SECRET_PROMPT);
  });
});
