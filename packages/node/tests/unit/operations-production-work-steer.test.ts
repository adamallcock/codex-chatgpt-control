import { describe, expect, it } from "vitest";
import type { LocatorLike, PageLike } from "../../src/types.js";
import {
  createProductionWorkSteerPrimitive,
  type ProductionWorkSteerOptions,
  type ProductionWorkSteerPrepared
} from "../../src/operations/production-work-steer.js";
import { TURN_OWNERSHIP_SCHEMA_VERSION, type OwnershipSnapshot } from "../../src/operations/turn-ownership.js";
import type { BrowserObservationResult } from "../../src/operations/browser-observation.js";
import type { OperationTargetBindingV1 } from "../../src/operations/types.js";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_DIGEST = digest("request", "parent");
const TARGET_DIGEST = digest("target", "parent");
const ACTION_ID = "22222222-2222-4222-8222-222222222222";
const ASSISTANT_ID = "assistant-parent";
const ASSISTANT_BRANCH = "branch-main";
const ASSISTANT_PARENT = "user-original";
const STEER_USER_ID = "user-steer";
const STEER_USER_EVIDENCE = digest("turn", STEER_USER_ID);
const SECRET_PROMPT = "private steer prompt that must never cross a durable boundary";
const PRIVATE_URL = "https://opaque.invalid/thread/" + "a".repeat(64);

function digest(domain: string, material: unknown): string {
  const source = domain + ":" + JSON.stringify(material);
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  return "hmac-sha256:" + hash.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}

const target: OperationTargetBindingV1 = {
  providerId: "provider-work",
  browserId: "browser-one",
  tabId: "tab-work",
  coordinationScope: "process",
  conversationId: "conversation-work",
  canonicalThreadUrl: PRIVATE_URL,
  evidenceProfile: {
    providerIdentity: "required",
    stableTabId: "required",
    stableConversationId: "required",
    stableUserTurnId: "required",
    authoritativeTabClaim: "unavailable",
    replacementTabRecovery: false
  }
};

const targetEvidence = {
  provider: { status: "available", value: target.providerId } as const,
  browser: { status: "available", value: target.browserId } as const,
  tab: { status: "available", value: target.tabId } as const,
  thread: { status: "available", value: "thread-work" } as const,
  conversation: { status: "available", value: target.conversationId! } as const,
  canonicalThreadUrl: { status: "available", value: target.canonicalThreadUrl! } as const,
  authoritativeTabClaim: { status: "unavailable", reason: "not_exposed" } as const,
  coordinationScope: "process" as const
};

function userTurn(id: string, evidence = digest("turn", id), ordinal = 0) {
  return {
    stableId: id,
    evidenceDigest: evidence,
    structureDigest: digest("structure", id),
    ordinal,
    artifactEvidenceDigests: [] as string[]
  };
}

function assistantTurn(
  id: string,
  parentStableId: string,
  state: "generating" | "terminal" = "generating",
  ordinal = 0,
  structure = id
) {
  return {
    stableId: id,
    evidenceDigest: digest("assistant", id + ":" + state),
    structureDigest: digest("assistant-structure", structure),
    ordinal,
    parentStableId,
    branchStableId: ASSISTANT_BRANCH,
    state,
    artifactEvidenceDigests: [] as string[]
  };
}

function baselineSnapshot(): OwnershipSnapshot {
  return {
    schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
    snapshotDigest: digest("snapshot", "baseline"),
    target: targetEvidence,
    userTurns: [userTurn(ASSISTANT_PARENT)],
    assistantTurns: [assistantTurn(ASSISTANT_ID, ASSISTANT_PARENT)],
    completeness: "complete",
    terminalState: "generating"
  };
}

function postSnapshotTerminalParent(before = baselineSnapshot()): OwnershipSnapshot {
  const deltaDigest = digest("browser-observation-post-send-delta", {
    baselineSnapshotDigest: before.snapshotDigest,
    addedUserEvidenceDigests: [STEER_USER_EVIDENCE]
  });
  const priorParent = before.assistantTurns.find(turn => turn.stableId === ASSISTANT_ID)!;
  const changedParent = {
    ...priorParent,
    evidenceDigest: digest("assistant", "parent-terminal"),
    structureDigest: digest("assistant-structure", "parent-terminal"),
    state: "terminal" as const
  };
  return {
    schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
    snapshotDigest: digest("snapshot", "post-steer"),
    target: targetEvidence,
    userTurns: [
      ...before.userTurns,
      userTurn(STEER_USER_ID, STEER_USER_EVIDENCE, before.userTurns.length)
    ],
    assistantTurns: [
      changedParent,
      assistantTurn("assistant-steer", STEER_USER_ID, "generating", before.assistantTurns.length)
    ],
    completeness: "complete",
    terminalState: "terminal",
    postSendDelta: {
      baselineSnapshotDigest: before.snapshotDigest,
      addedUserEvidenceDigests: [STEER_USER_EVIDENCE],
      deltaDigest
    }
  };
}

function observation(snapshot: OwnershipSnapshot): BrowserObservationResult {
  return { snapshot };
}

type FixtureOptions = {
  evidenceDigest?: ProductionWorkSteerOptions["evidenceDigest"];
  states?: OwnershipSnapshot[];
  fill?: (value: string, options?: unknown) => Promise<void>;
  click?: (options?: unknown) => Promise<void>;
  now?: () => number;
  observe?: ProductionWorkSteerOptions["observe"];
  resolveComposer?: ProductionWorkSteerOptions["resolveComposer"];
  resolveSendControl?: ProductionWorkSteerOptions["resolveSendControl"];
  sendEnabled?: boolean;
};

type Fixture = {
  primitive: ReturnType<typeof createProductionWorkSteerPrimitive>;
  events: string[];
  fills: string[];
  clicks: number;
  observedRequests: unknown[];
  resolverRequests: unknown[];
};

function makeFixture(options: FixtureOptions = {}): Fixture {
  const events: string[] = [];
  const fills: string[] = [];
  const resolverRequests: unknown[] = [];
  const observedRequests: unknown[] = [];
  let clicks = 0;
  const states = options.states ?? [baselineSnapshot(), baselineSnapshot(), postSnapshotTerminalParent()];
  let observationIndex = 0;
  const composerLocator: LocatorLike = {
    count: async () => 1,
    isVisible: async () => true,
    fill: async (value, fillOptions) => {
      void fillOptions;
      events.push("fill");
      fills.push(value);
      await options.fill?.(value, fillOptions);
    }
  };
  const sendLocator: LocatorLike = {
    count: async () => 1,
    isVisible: async () => true,
    evaluate: async <T>() => (options.sendEnabled ?? true) as T,
    click: async clickOptions => {
      events.push("click");
      clicks += 1;
      await options.click?.(clickOptions);
    }
  };
  const observe: ProductionWorkSteerOptions["observe"] = options.observe ?? (async request => {
    events.push("observe:" + request.phase);
    observedRequests.push(request);
    const state = states[Math.min(observationIndex++, states.length - 1)]!;
    return observation(state);
  });
  const resolveComposer: ProductionWorkSteerOptions["resolveComposer"] = options.resolveComposer ?? (async request => {
    resolverRequests.push(request);
    return { locator: composerLocator, capabilityKey: "work.composer", candidateCount: 1 };
  });
  const resolveSendControl: ProductionWorkSteerOptions["resolveSendControl"] = options.resolveSendControl ?? (async request => {
    resolverRequests.push(request);
    return { locator: sendLocator, capabilityKey: "work.send", localeKey: "en-US", candidateCount: 1 };
  });
  const config: ProductionWorkSteerOptions = {
    evidenceDigest: options.evidenceDigest ?? digest,
    operationId: OPERATION_ID,
    parentRequestDigest: REQUEST_DIGEST,
    targetBindingDigest: TARGET_DIGEST,
    controlActionId: ACTION_ID,
    expectedAssistantTurnId: ASSISTANT_ID,
    target,
    prompt: SECRET_PROMPT,
    observe,
    resolveComposer,
    resolveSendControl,
    ...(options.now === undefined ? {} : { now: options.now })
  };
  return {
    primitive: createProductionWorkSteerPrimitive(config),
    events,
    fills,
    get clicks() { return clicks; },
    observedRequests,
    resolverRequests
  };
}

function call(signal = new AbortController().signal, deadlineAt?: number): { page: Readonly<PageLike>; signal: AbortSignal; deadlineAt?: number } {
  return {
    page: {},
    signal,
    ...(deadlineAt === undefined ? {} : { deadlineAt })
  };
}

async function prepareFixture(fixture: Fixture): Promise<ProductionWorkSteerPrepared> {
  const result = await fixture.primitive.prepare(call());
  expect(result.status).toBe("prepared");
  if (result.status !== "prepared") throw new Error("fixture preparation failed");
  return result.prepared;
}

describe("production Work steer four-phase primitive", () => {
  it("captures a frozen derived baseline and keeps prepare read-only", async () => {
    const fixture = makeFixture();
    const prepared = await prepareFixture(fixture);
    expect(fixture.events).toEqual(["observe:prepare"]);
    expect(prepared.assistantBranchId).toBe(ASSISTANT_BRANCH);
    expect(prepared.assistantParentTurnId).toBe(ASSISTANT_PARENT);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.baseline)).toBe(true);
    expect(Object.isFrozen(prepared.baseline.userTurns)).toBe(true);
    expect(JSON.stringify(prepared)).not.toContain(SECRET_PROMPT);
    expect(JSON.stringify(prepared)).not.toContain(PRIVATE_URL);
    expect(fixture.fills).toEqual([]);
    expect(fixture.clicks).toBe(0);
    expect(fixture.observedRequests[0]).not.toHaveProperty("target");
  });

  it("round-trips the caller-persisted prepared record and keeps execute phase-separated", async () => {
    const fixture = makeFixture();
    const prepared = await prepareFixture(fixture);
    const persisted = JSON.parse(JSON.stringify(prepared)) as ProductionWorkSteerPrepared;
    const result = await fixture.primitive.executePrepared({ ...call(), prepared: persisted });
    expect(result.status).toBe("executed");
    expect(fixture.events).toEqual(["observe:prepare", "observe:final_recheck", "fill", "click"]);
    expect(fixture.observedRequests.some(request => (request as { phase?: string }).phase === "verify")).toBe(false);
    expect(fixture.observedRequests.some(request => (request as { phase?: string }).phase === "recovery")).toBe(false);
    expect(fixture.fills).toEqual([SECRET_PROMPT]);
    expect(fixture.clicks).toBe(1);
    expect(JSON.stringify(result)).not.toContain(SECRET_PROMPT);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_URL);
  });

  it("rejects a changed final baseline before either browser mutation", async () => {
    const changed = { ...baselineSnapshot(), snapshotDigest: digest("snapshot", "changed") };
    const fixture = makeFixture({ states: [baselineSnapshot(), changed] });
    const prepared = await prepareFixture(fixture);
    const result = await fixture.primitive.executePrepared({ ...call(), prepared });
    expect(result.status).toBe("blocked");
    expect(result.mutationBoundary).toBe("none");
    expect(fixture.fills).toEqual([]);
    expect(fixture.clicks).toBe(0);
  });

  it("cannot accept caller mutation as a forged prepared identity", async () => {
    const fixture = makeFixture();
    const prepared = await prepareFixture(fixture);
    const forged = JSON.parse(JSON.stringify(prepared)) as Record<string, unknown>;
    forged.assistantBranchId = "branch-forged";
    const result = await fixture.primitive.executePrepared({ ...call(), prepared: forged as ProductionWorkSteerPrepared });
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("forged prepared unexpectedly proceeded");
    expect(result.blockerCode).toBe("operation_state_corrupt");
    expect(fixture.events).toEqual(["observe:prepare"]);
    expect(fixture.fills).toEqual([]);
    expect(fixture.clicks).toBe(0);
  });

  it("consumes execution exactly once, including after a blocked final read", async () => {
    const changed = { ...baselineSnapshot(), snapshotDigest: digest("snapshot", "changed") };
    const fixture = makeFixture({ states: [baselineSnapshot(), changed] });
    const prepared = await prepareFixture(fixture);
    const first = await fixture.primitive.executePrepared({ ...call(), prepared });
    const second = await fixture.primitive.executePrepared({ ...call(), prepared });
    expect(first.status).toBe("blocked");
    expect(second.status).toBe("uncertain");
    expect(fixture.events).toEqual(["observe:prepare", "observe:final_recheck"]);
  });

  it("proves one exact delta while allowing the owned generating parent to become terminal", async () => {
    const fixture = makeFixture();
    const prepared = await prepareFixture(fixture);
    const executed = await fixture.primitive.executePrepared({ ...call(), prepared });
    expect(executed.status).toBe("executed");
    const verified = await fixture.primitive.verify({ ...call(), prepared });
    expect(verified.status).toBe("satisfied");
    if (verified.status !== "satisfied") throw new Error("verification failed");
    expect(verified.receipt.baselineSnapshotDigest).toBe(prepared.baselineSnapshotDigest);
    expect(verified.receipt.preparedDigest).toBe(prepared.preparedDigest);
    expect(verified.receipt.assistantBranchId).toBe(ASSISTANT_BRANCH);
    expect(verified.receipt.assistantParentTurnId).toBe(ASSISTANT_PARENT);
    expect(verified.receipt.userTurnId).toBe(STEER_USER_ID);
    expect(Object.isFrozen(verified.receipt)).toBe(true);
    expect(fixture.events).toEqual(["observe:prepare", "observe:final_recheck", "fill", "click", "observe:verify"]);
  });

  it("rejects mutation of a non-parent baseline assistant", async () => {
    const before = baselineSnapshot();
    const otherUser = userTurn("user-older", digest("turn", "user-older"), 1);
    const otherAssistant = assistantTurn("assistant-older", "user-older", "terminal", 0);
    const withOther: OwnershipSnapshot = {
      ...before,
      snapshotDigest: digest("snapshot", "baseline-with-other"),
      userTurns: [before.userTurns[0]!, otherUser],
      assistantTurns: [otherAssistant, { ...before.assistantTurns[0]!, ordinal: 1 }]
    };
    const changedPost = postSnapshotTerminalParent(withOther);
    const changedOther: OwnershipSnapshot = {
      ...changedPost,
      assistantTurns: [
        { ...otherAssistant, evidenceDigest: digest("assistant", "other-changed") },
        ...changedPost.assistantTurns
      ]
    };
    const fixture = makeFixture({ states: [withOther, changedOther] });
    const prepared = await prepareFixture(fixture);
    const result = await fixture.primitive.verify({ ...call(), prepared });
    expect(result.status).toBe("uncertain");
    if (result.status !== "uncertain") throw new Error("mutated non-parent unexpectedly satisfied");
    expect(result.blockerCode).toBe("turn_ownership_ambiguous");
    expect(fixture.fills).toEqual([]);
    expect(fixture.clicks).toBe(0);
  });

  it("rejects concurrent new users and regeneration siblings", async () => {
    const before = baselineSnapshot();
    const normalPost = postSnapshotTerminalParent(before);
    const concurrent: OwnershipSnapshot = {
      ...normalPost,
      userTurns: [
        ...normalPost.userTurns,
        userTurn("user-concurrent", digest("turn", "user-concurrent"), 2)
      ],
      postSendDelta: {
        baselineSnapshotDigest: before.snapshotDigest,
        addedUserEvidenceDigests: [STEER_USER_EVIDENCE, digest("turn", "user-concurrent")],
        deltaDigest: digest("browser-observation-post-send-delta", "concurrent")
      }
    };
    const firstFixture = makeFixture({ states: [before, concurrent] });
    const prepared = await prepareFixture(firstFixture);
    const concurrentResult = await firstFixture.primitive.verify({ ...call(), prepared });
    expect(concurrentResult.status).toBe("uncertain");
    if (concurrentResult.status !== "uncertain") throw new Error("concurrent turn unexpectedly satisfied");
    expect(concurrentResult.blockerCode).toBe("concurrent_user_turn");

    const sibling: OwnershipSnapshot = {
      ...before,
      assistantTurns: [
        before.assistantTurns[0]!,
        { ...assistantTurn("assistant-sibling", ASSISTANT_PARENT, "generating", 1), branchStableId: "branch-other" }
      ]
    };
    const siblingFixture = makeFixture({ states: [sibling] });
    const siblingResult = await siblingFixture.primitive.prepare(call());
    expect(siblingResult.status).toBe("blocked");
    if (siblingResult.status !== "blocked") throw new Error("sibling unexpectedly prepared");
    expect(siblingResult.blockerCode).toBe("turn_ownership_ambiguous");
  });

  it("recovers from a caller-supplied durable baseline using observation only", async () => {
    const fixture = makeFixture({ states: [baselineSnapshot(), postSnapshotTerminalParent()] });
    const prepared = await prepareFixture(fixture);
    const persistedPrepared = JSON.parse(JSON.stringify(prepared)) as ProductionWorkSteerPrepared;
    const persistedBaseline = JSON.parse(JSON.stringify(prepared.baseline)) as ProductionWorkSteerPrepared["baseline"];
    const result = await fixture.primitive.recover({ ...call(), prepared: persistedPrepared, baseline: persistedBaseline });
    expect(result.status).toBe("satisfied");
    expect(fixture.events).toEqual(["observe:prepare", "observe:recovery"]);
    expect(fixture.fills).toEqual([]);
    expect(fixture.clicks).toBe(0);
    expect(fixture.resolverRequests).toEqual([]);
  });

  it("awaits an in-flight read to settlement after cancellation so an outer actor can quarantine it", async () => {
    let release!: () => void;
    let started!: () => void;
    const readStarted = new Promise<void>(resolve => { started = resolve; });
    const readGate = new Promise<void>(resolve => { release = resolve; });
    const fixture = makeFixture({
      observe: async () => {
        started();
        await readGate;
        return observation(baselineSnapshot());
      }
    });
    const controller = new AbortController();
    let settled = false;
    const pending = fixture.primitive.prepare(call(controller.signal)).then(result => {
      settled = true;
      return result;
    });
    await readStarted;
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    const result = await pending;
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") expect(result.blockerCode).toBe("operation_cancelled");
  });

  it("awaits a delayed fill to settlement instead of returning on a deadline race", async () => {
    let release!: () => void;
    let started!: () => void;
    const fillStarted = new Promise<void>(resolve => { started = resolve; });
    const fillGate = new Promise<void>(resolve => { release = resolve; });
    const fixture = makeFixture({
      fill: async () => {
        started();
        await fillGate;
      }
    });
    const prepared = await prepareFixture(fixture);
    let settled = false;
    const executing = fixture.primitive.executePrepared({ ...call(), prepared }).then(result => {
      settled = true;
      return result;
    });
    await fillStarted;
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect((await executing).status).toBe("executed");
  });

  it("awaits a delayed click to settlement and never retries it", async () => {
    let release!: () => void;
    let started!: () => void;
    const clickStarted = new Promise<void>(resolve => { started = resolve; });
    const clickGate = new Promise<void>(resolve => { release = resolve; });
    const fixture = makeFixture({
      click: async () => {
        started();
        await clickGate;
      }
    });
    const prepared = await prepareFixture(fixture);
    let settled = false;
    const executing = fixture.primitive.executePrepared({ ...call(), prepared }).then(result => {
      settled = true;
      return result;
    });
    await clickStarted;
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect((await executing).status).toBe("executed");
    expect(fixture.clicks).toBe(1);
  });

  it("quarantines fill acts-then-throws and never clicks or retries", async () => {
    const fixture = makeFixture({ fill: async () => { throw new Error(SECRET_PROMPT + ":" + PRIVATE_URL); } });
    const prepared = await prepareFixture(fixture);
    const result = await fixture.primitive.executePrepared({ ...call(), prepared });
    expect(result.status).toBe("uncertain");
    expect(result.mutationBoundary).toBe("control_may_have_occurred");
    expect(fixture.clicks).toBe(0);
    const replay = await fixture.primitive.executePrepared({ ...call(), prepared });
    expect(replay.status).toBe("uncertain");
    expect(fixture.clicks).toBe(0);
    expect(JSON.stringify(result)).not.toContain(SECRET_PROMPT);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_URL);
  });

  it("quarantines click acts-then-throws without a retry", async () => {
    const fixture = makeFixture({ click: async () => { throw new Error(SECRET_PROMPT + ":" + PRIVATE_URL); } });
    const prepared = await prepareFixture(fixture);
    const result = await fixture.primitive.executePrepared({ ...call(), prepared });
    expect(result.status).toBe("uncertain");
    expect(fixture.clicks).toBe(1);
    const replay = await fixture.primitive.executePrepared({ ...call(), prepared });
    expect(replay.status).toBe("uncertain");
    expect(fixture.clicks).toBe(1);
  });

  it("rechecks the actual Send enabled state after fill and never clicks a disabled control", async () => {
    const fixture = makeFixture({ sendEnabled: false });
    const prepared = await prepareFixture(fixture);
    const result = await fixture.primitive.executePrepared({ ...call(), prepared });
    expect(result.status).toBe("uncertain");
    expect(result.mutationBoundary).toBe("control_may_have_occurred");
    expect(fixture.fills).toEqual([SECRET_PROMPT]);
    expect(fixture.clicks).toBe(0);
  });

  it("distinguishes cancellation before mutation from cancellation after fill settlement", async () => {
    const beforeController = new AbortController();
    const beforeFixture = makeFixture();
    const beforePrepared = await prepareFixture(beforeFixture);
    beforeController.abort();
    const before = await beforeFixture.primitive.executePrepared({ ...call(beforeController.signal), prepared: beforePrepared });
    expect(before.status).toBe("blocked");
    expect(before.mutationBoundary).toBe("none");
    expect(beforeFixture.fills).toEqual([]);

    const afterController = new AbortController();
    const afterFixture = makeFixture({ fill: async () => afterController.abort() });
    const afterPrepared = await prepareFixture(afterFixture);
    const after = await afterFixture.primitive.executePrepared({ ...call(afterController.signal), prepared: afterPrepared });
    expect(after.status).toBe("uncertain");
    expect(after.mutationBoundary).toBe("control_may_have_occurred");
    expect(afterFixture.clicks).toBe(0);
  });

  it("fails closed on accessor, cyclic, proxy, and spoofed signal inputs", async () => {
    const accessorOptions = { ...makeConfigForValidation(), get prompt() { return SECRET_PROMPT; } };
    expect(() => createProductionWorkSteerPrimitive(accessorOptions as ProductionWorkSteerOptions)).toThrow();

    const fixture = makeFixture();
    const prepared = await prepareFixture(fixture);
    const cyclic = JSON.parse(JSON.stringify(prepared)) as Record<string, unknown>;
    cyclic.loop = cyclic;
    const cyclicResult = await fixture.primitive.executePrepared({ ...call(), prepared: cyclic as ProductionWorkSteerPrepared });
    expect(cyclicResult.status).toBe("blocked");

    const proxyPrepared = new Proxy(prepared, { ownKeys: () => { throw new Error("private"); } });
    const proxyResult = await fixture.primitive.executePrepared({ ...call(), prepared: proxyPrepared });
    expect(proxyResult.status).toBe("blocked");

    const fakeSignal = { aborted: false, addEventListener() {}, removeEventListener() {} } as unknown as AbortSignal;
    const fakeResult = await fixture.primitive.executePrepared({ ...call(fakeSignal), prepared });
    expect(fakeResult.status).toBe("blocked");
    expect(fixture.fills).toEqual([]);
  });

  it("keeps raw prompt, URL, labels, and provider exceptions out of requests/results", async () => {
    const requests: unknown[] = [];
    const fixture = makeFixture({
      observe: async request => {
        requests.push(request);
        return observation(baselineSnapshot());
      },
      resolveComposer: async request => {
        requests.push(request);
        return undefined;
      }
    });
    const preparedResult = await fixture.primitive.prepare(call());
    const preparedText = JSON.stringify(preparedResult);
    expect(preparedText).not.toContain(SECRET_PROMPT);
    expect(preparedText).not.toContain(PRIVATE_URL);
    for (const request of requests) {
      const text = JSON.stringify(request);
      expect(text).not.toContain(SECRET_PROMPT);
      expect(text).not.toContain(PRIVATE_URL);
      expect(request).not.toHaveProperty("target");
    }
    const throwing = makeFixture({ fill: async () => { throw new Error(SECRET_PROMPT + ":" + PRIVATE_URL); } });
    const throwingPrepared = await prepareFixture(throwing);
    const result = await throwing.primitive.executePrepared({ ...call(), prepared: throwingPrepared });
    expect(JSON.stringify(result)).not.toContain(SECRET_PROMPT);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_URL);
  });
});

function makeConfigForValidation(): ProductionWorkSteerOptions {
  return {
    evidenceDigest: digest,
    operationId: OPERATION_ID,
    parentRequestDigest: REQUEST_DIGEST,
    targetBindingDigest: TARGET_DIGEST,
    controlActionId: ACTION_ID,
    expectedAssistantTurnId: ASSISTANT_ID,
    target,
    prompt: SECRET_PROMPT,
    observe: async () => observation(baselineSnapshot()),
    resolveComposer: async () => undefined,
    resolveSendControl: async () => undefined,
    now: () => Date.now()
  };
}


describe("asynchronous Work steer signing", () => {
  it.each(["resolve", "reject", "cancel"] as const)("settles prepared-record signing before any mutation: %s", async outcome => {
    let delay = false;
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const fixture = makeFixture({ evidenceDigest: async (domain, material) => {
      if (delay) {
        entered();
        await pending;
        if (outcome === "reject") throw new Error("private remote failure");
      }
      return digest(domain, material);
    } });
    const prepared = await prepareFixture(fixture);
    delay = true;
    const controller = new AbortController();
    const execution = fixture.primitive.executePrepared({ ...call(), signal: controller.signal, prepared });
    await started;
    expect(fixture.fills).toEqual([]);
    expect(fixture.clicks).toBe(0);
    if (outcome === "cancel") controller.abort();
    release();
    const result = await execution;
    expect(result.status).toBe(outcome === "resolve" ? "executed" : "blocked");
    expect(fixture.clicks).toBe(outcome === "resolve" ? 1 : 0);
    if (outcome === "resolve") {
      const verified = await fixture.primitive.verify({ ...call(), prepared });
      expect(verified.status).toBe("satisfied");
      if (verified.status === "satisfied") expect(typeof verified.receipt.evidenceDigest).toBe("string");
    }
    expect(JSON.stringify(result)).not.toContain("private remote failure");
  });
});
