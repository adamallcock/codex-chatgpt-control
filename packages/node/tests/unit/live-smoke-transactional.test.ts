import { describe, expect, it, vi } from "vitest";
import { qualifyTransactionalSubmitOnce, transactionalSubmitOnceScenario } from "../../src/scripts/live-smoke/transactional.js";
import { optionalScenarios } from "../../src/scripts/live-smoke/scenarios.js";
import type { ChatGPTClient } from "../../src/client.js";
import type { OperationHandleV1, OperationStateV1 } from "../../src/operations/types.js";
import type { OperationInspectResult } from "../../src/operations/service.js";

const send = { kind: "send", actionId: "send-id", outcome: "satisfied", intentRevision: 3, receiptRevision: 5 };
const receipt = { userTurnId: "user-turn", assistantTurnId: "assistant-turn" };

function clientFixture(options: { alreadyCompleted?: boolean; ephemeralResponse?: string; collectedRawMissing?: boolean; blocked?: boolean; pending?: boolean; wrongResponse?: boolean; replayDuplicate?: boolean; replayNewHandle?: boolean; replayNewConversation?: boolean } = {}) {
  let askCount = 0;
  let inspected = 0;
  let statuses = 0;
  let handle = { operationId: "", phase: "submitted", surface: "chat", requestDigest: "request-digest", targetBindingDigest: "target-digest" };
  const ask = vi.fn(async (args: { operationId?: string }) => {
    askCount += 1;
    if (askCount === 1) handle = { ...handle, operationId: args.operationId! };
    const returnedHandle = askCount > 1 && options.replayNewHandle
      ? { ...handle, operationId: "other-operation", requestDigest: "other-request", targetBindingDigest: "other-target" }
      : handle;
    return options.blocked ? {
      ok: false, status: "blocked", blocker: { code: "journal_host_unavailable", message: "private host path" }
    } : {
      ok: askCount > 1,
      status: askCount > 1 ? "ok" : "partial",
      data: { handle: returnedHandle, ...(options.ephemeralResponse !== undefined
        ? { responseText: options.ephemeralResponse }
        : options.alreadyCompleted ? { responseText: "ISSUE41_OK" } : {}) },
      context: { url: "https://chatgpt.com/c/private-id" }
    };
  });
  const inspect = vi.fn(async () => {
    inspected += 1;
    return { handle, state: { phase: inspected === 1 && !options.alreadyCompleted ? "submitted" : "completed", actions: { send }, target: { conversationId: "owned-conversation", tabId: "owned-tab" }, ...(inspected > 1 ? { receipt } : {}) } };
  });
  const collect = vi.fn(async () => options.pending ? { kind: "pending" } : {
    kind: "completed", turn: receipt,
    response: options.alreadyCompleted || options.collectedRawMissing ? {} : { rawText: options.wrongResponse ? "Other response" : "ISSUE41_OK" }
  });
  const status = vi.fn(async () => {
    statuses += 1;
    return { ok: true, status: "ok", data: {
      turnCount: statuses > 1 && options.replayDuplicate ? 4 : 2,
      assistantTurnCount: statuses > 1 && options.replayDuplicate ? 2 : 1,
      latestAssistantText: "Private data must not appear in evidence"
    }, context: { conversationId: statuses > 1 && options.replayNewConversation ? "another-conversation" : "owned-conversation" } };
  });
  return { ask, operations: { inspect, collect }, messages: { status } } as unknown as Pick<ChatGPTClient, "ask" | "operations" | "messages">;
}

type RecoveryInspection = {
  handle: OperationHandleV1;
  state: Omit<OperationStateV1, "receipt" | "target"> & {
    receipt?: typeof receipt;
    target?: { providerId: string; browserId: string; tabId: string; conversationId?: string };
  };
};

function recoveryFixture(options: {
  initialBlockerCode?: string;
  initialPhase?: OperationStateV1["phase"];
  before?: (value: RecoveryInspection) => void;
  after?: (value: RecoveryInspection) => void;
  recoveryBlockerCode?: string;
  changedRecoveryHandle?: boolean;
  completedRecovery?: boolean;
} = {}) {
  const client = clientFixture({ alreadyCompleted: options.completedRecovery === true });
  let asks = 0;
  let inspections = 0;
  let operationId = "";
  const handle = (phase: OperationStateV1["phase"]): OperationHandleV1 => ({
    schemaVersion: "chatgpt.browser_control.operation_handle.v1", operationId,
    requestDigest: "request-digest", targetBindingDigest: "target-digest", surface: "chat",
    revision: 7, phase, mutationBoundary: "send_may_have_occurred"
  });
  vi.mocked(client.ask).mockImplementation(async args => {
    asks += 1;
    operationId = args.operationId!;
    const blockerCode = asks === 1 ? options.initialBlockerCode ?? "ambiguous_submit"
      : asks === 2 ? options.recoveryBlockerCode : undefined;
    const resultHandle = handle(asks === 1 ? "uncertain" : options.completedRecovery ? "completed" : "submitted");
    if (asks === 2 && options.changedRecoveryHandle) resultHandle.targetBindingDigest = "other-target";
    return {
      ok: blockerCode === undefined, status: blockerCode === undefined ? "ok" : "partial",
      data: { handle: resultHandle, ...(options.completedRecovery && asks === 2 ? { responseText: "ISSUE41_OK" } : {}) },
      ...(blockerCode === undefined ? {} : { blocker: { kind: "unknown", code: blockerCode, message: "private ambiguity detail" } }),
      warnings: [],
      context: { timestamp: "2026-09-06T00:00:00.000Z" }
    };
  });
  vi.mocked(client.operations.inspect).mockImplementation(async () => {
    inspections += 1;
    const phase = inspections === 1 ? options.initialPhase ?? "uncertain"
      : inspections === 2 && !options.completedRecovery ? "submitted" : "completed";
    const value: RecoveryInspection = {
      handle: handle(phase),
      state: {
        schemaVersion: "chatgpt.browser_control.operation.v1", operationId,
        requestDigest: "request-digest", surface: "chat", phase,
        mutationBoundary: "send_may_have_occurred", revision: 7,
        createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
        actions: { send: {
          ...send, kind: "send", outcome: inspections === 1 ? "uncertain" : "satisfied",
          repeatPolicy: "observe_only_after_intent", requestDigest: "request-digest", targetDigest: "target-digest",
          intentAt: "2026-09-06T00:00:00.000Z"
        } },
        target: { providerId: "test-provider", browserId: "chrome", tabId: "owned-tab", ...(inspections > 1 ? { conversationId: "owned-conversation" } : {}) },
        ...(phase === "completed" ? { receipt } : {})
      }
    };
    if (inspections === 1) options.before?.(value);
    if (inspections === 2) options.after?.(value);
    return value as OperationInspectResult;
  });
  return client;
}

describe("transactional live qualification", () => {
  it("is opt-in and present separately from compatibility coverage", () => {
    expect(optionalScenarios).toContain(transactionalSubmitOnceScenario);
    expect(transactionalSubmitOnceScenario.required).toBe(false);
    expect(transactionalSubmitOnceScenario.enabled({ agent: {}, reportDir: "/tmp/reports", env: {} })).toBe(false);
    expect(transactionalSubmitOnceScenario.enabled({ agent: {}, reportDir: "/tmp/reports", env: { CHATGPT_E2E_TRANSACTIONAL: "1" } })).toBe(true);
  });

  it("uses a fresh UUID, zero files, exact receipt collection and the same request on completed replay", async () => {
    const client = clientFixture();
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(true);
    const calls = vi.mocked(client.ask).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toMatchObject({ files: [], thread: { type: "new" }, wait: false, read: { format: "text" } });
    expect(calls[0]?.[0].operationId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(calls[0]?.[0].prompt).toContain("\n\n");
    expect(calls[1]?.[0]).toBe(calls[0]?.[0]);
    expect(client.operations.collect).toHaveBeenCalledOnce();
    expect(evidence.details).toMatchObject({ sameSendAction: true, sameOwnedTurns: true, exactlyOneExchange: true });
    expect(JSON.stringify(evidence)).not.toMatch(/private-id|Private data|redacted-test-id|user-turn|assistant-turn/);
  });

  it("qualifies a fast completed ask using its ephemeral exact text and the subsequent durable receipt", async () => {
    const client = clientFixture({ alreadyCompleted: true });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(true);
    expect(evidence.details).toMatchObject({ initialPhase: "completed", responseMatches: true, ownedReceiptVerified: true, sameSendAction: true });
    expect(client.ask).toHaveBeenCalledTimes(2);
  });

  it("never substitutes ephemeral text from an unfinished ask when collection has no raw text", async () => {
    const client = clientFixture({ ephemeralResponse: "ISSUE41_OK", collectedRawMissing: true });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ initialPhase: "submitted", responseMatches: false, failedStage: "operations.collect", duplicateRequestAttempted: false });
    expect(client.operations.collect).toHaveBeenCalledOnce();
    expect(client.ask).toHaveBeenCalledOnce();
    expect(client.messages.status).not.toHaveBeenCalled();
  });

  it("never replays a completed ask whose only raw response has the wrong text", async () => {
    const client = clientFixture({ alreadyCompleted: true, ephemeralResponse: "Other response" });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ initialPhase: "completed", responseMatches: false, failedStage: "operations.collect", duplicateRequestAttempted: false });
    expect(client.operations.collect).toHaveBeenCalledOnce();
    expect(client.ask).toHaveBeenCalledOnce();
    expect(client.messages.status).not.toHaveBeenCalled();
  });

  it("reports an unavailable journal host as failed coverage and never retries", async () => {
    const client = clientFixture({ blocked: true });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ blockerCode: "journal_host_unavailable", failedStage: "ask.submit", duplicateRequestAttempted: false });
    expect(client.ask).toHaveBeenCalledOnce();
    expect(client.operations.inspect).not.toHaveBeenCalled();
    expect(JSON.stringify(evidence)).not.toContain("private host path");
  });

  it.each(["uncertain", "submitted"] as const)("recovers one existing Send intent from %s using the identical request before completed replay", async initialPhase => {
    const client = recoveryFixture({ initialPhase });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(true);
    expect(evidence.details).toMatchObject({ initialPhase, recoveryEligible: true, recoveryAttempted: true, recoverySameTarget: true, recoverySameSendAction: true, sameSendAction: true, exactlyOneExchange: true });
    const calls = vi.mocked(client.ask).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[1]?.[0]).toBe(calls[0]?.[0]);
    expect(calls[2]?.[0]).toBe(calls[0]?.[0]);
    expect(client.operations.collect).toHaveBeenCalledOnce();
    expect(JSON.stringify(evidence)).not.toMatch(/private ambiguity detail|owned-tab|owned-conversation|send-id/);
  });

  it("retains exact ephemeral response evidence when observation-only recovery finishes immediately", async () => {
    const client = recoveryFixture({ completedRecovery: true });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(true);
    expect(evidence.details).toMatchObject({ initialPhase: "uncertain", recoveredPhase: "completed", responseMatches: true, recoveryAttempted: true });
    expect(client.ask).toHaveBeenCalledTimes(3);
  });

  it("does not recover other blockers even when they include a usable operation handle", async () => {
    const client = recoveryFixture({ initialBlockerCode: "configuration_drift" });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ recoveryAttempted: false, failedStage: "ask.submit" });
    expect(client.ask).toHaveBeenCalledOnce();
    expect(client.operations.inspect).not.toHaveBeenCalled();
  });

  it("does not recover an ambiguous submission without a handle", async () => {
    const client = recoveryFixture();
    vi.mocked(client.ask).mockResolvedValueOnce({
      ok: false, status: "partial", data: {}, warnings: [],
      blocker: { kind: "unknown", code: "ambiguous_submit", message: "private ambiguity detail" },
      context: { timestamp: "2026-09-06T00:00:00.000Z" }
    });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ recoveryAttempted: false, failedStage: "ask.submit" });
    expect(client.ask).toHaveBeenCalledOnce();
    expect(client.operations.inspect).not.toHaveBeenCalled();
  });

  const unsafeRecoveryStates: [string, (value: RecoveryInspection) => void][] = [
    ["missing Send intent", value => { value.state.actions = {}; }],
    ["multiple Send intents", value => { value.state.actions.second = { ...value.state.actions.send!, actionId: "second-send" }; }],
    ["wrong operation", value => { value.state.operationId = "other-operation"; }],
    ["wrong request", value => { value.state.requestDigest = "other-request"; }],
    ["wrong handle target", value => { value.handle.targetBindingDigest = "other-target"; }],
    ["wrong intent target", value => { value.state.actions.send!.targetDigest = "other-target"; }],
    ["repeatable intent", value => { value.state.actions.send!.repeatPolicy = "reconcile_set_to_value"; }],
    ["invalid intent revision", value => { value.state.actions.send!.intentRevision = 0; }],
    ["missing target", value => { delete value.state.target; }],
    ["pre-Send phase", value => { value.state.phase = "ready"; }],
    ["no Send boundary", value => { value.state.mutationBoundary = "none"; }]
  ];
  it.each(unsafeRecoveryStates)("never attempts recovery with %s", async (_label, before) => {
    const client = recoveryFixture({ before });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ recoveryEligible: false, recoveryAttempted: false, duplicateRequestAttempted: false, failedStage: "operations.inspect.submitted" });
    expect(client.ask).toHaveBeenCalledOnce();
    expect(client.operations.collect).not.toHaveBeenCalled();
  });

  const recoveryDrifts: [string, (value: RecoveryInspection) => void][] = [
    ["new Send intent", value => { value.state.actions.second = { ...value.state.actions.send!, actionId: "second-send" }; }],
    ["changed Send action", value => { value.state.actions.send!.actionId = "other-send"; }],
    ["changed intent revision", value => { value.state.actions.send!.intentRevision += 1; }],
    ["changed intent target", value => { value.state.actions.send!.targetDigest = "other-target"; }],
    ["changed tab", value => { value.state.target!.tabId = "other-tab"; }],
    ["changed operation", value => { value.state.operationId = "other-operation"; }]
  ];
  it.each(recoveryDrifts)("fails recovery proof after %s without collecting or replaying", async (_label, after) => {
    const client = recoveryFixture({ after });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ recoveryAttempted: true, duplicateRequestAttempted: false, failedStage: "operations.inspect.recovered" });
    expect(client.ask).toHaveBeenCalledTimes(2);
    expect(client.operations.collect).not.toHaveBeenCalled();
  });

  it("rejects changing an already established conversation during recovery", async () => {
    const client = recoveryFixture({ before: value => { value.state.target!.conversationId = "prior-conversation"; } });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ recoveryAttempted: true, recoverySameTarget: false, failedStage: "operations.inspect.recovered" });
    expect(client.ask).toHaveBeenCalledTimes(2);
    expect(client.operations.collect).not.toHaveBeenCalled();
  });

  it.each(["ambiguous_submit", "journal_rpc_outcome_indeterminate"])("stops after one recovery if it returns %s", async recoveryBlockerCode => {
    const client = recoveryFixture({ recoveryBlockerCode });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ recoveryAttempted: true, recoveryBlockerCode, duplicateRequestAttempted: false, failedStage: "ask.recover_submission" });
    expect(client.ask).toHaveBeenCalledTimes(2);
    expect(client.operations.collect).not.toHaveBeenCalled();
  });

  it("rejects a recovery result that changes the bound handle", async () => {
    const client = recoveryFixture({ changedRecoveryHandle: true });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ recoveryAttempted: true, duplicateRequestAttempted: false, failedStage: "ask.recover_submission" });
    expect(client.ask).toHaveBeenCalledTimes(2);
    expect(client.operations.collect).not.toHaveBeenCalled();
  });

  it.each([{ pending: true }, { wrongResponse: true }])("never replays an unfinished or unverified operation: %j", async options => {
    const client = clientFixture(options);
    expect((await qualifyTransactionalSubmitOnce(client)).passed).toBe(false);
    expect(client.ask).toHaveBeenCalledOnce();
  });

  it("fails when browser turn counts expose a duplicate despite unchanged journal identities", async () => {
    const client = clientFixture({ replayDuplicate: true });
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details.failedStage).toBe("messages.status.replayed");
  });

  it("rejects a replay that returns a different operation even with one exchange in each conversation", async () => {
    const evidence = await qualifyTransactionalSubmitOnce(clientFixture({ replayNewHandle: true, replayNewConversation: true }));
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ sameOperationHandle: false, failedStage: "ask.same_identity" });
  });

  it("rejects a replay that changes conversations while returning the old handle and one exchange", async () => {
    const evidence = await qualifyTransactionalSubmitOnce(clientFixture({ replayNewConversation: true }));
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ sameOperationHandle: true, sameConversation: false, failedStage: "messages.status.replayed" });
  });

  it("contains private exception details without attempting another Send", async () => {
    const client = clientFixture();
    vi.mocked(client.operations.collect).mockRejectedValue(new Error("secret private transcript/path"));
    const evidence = await qualifyTransactionalSubmitOnce(client);
    expect(evidence.passed).toBe(false);
    expect(evidence.details).toMatchObject({ exception: true, failedStage: "operations.collect" });
    expect(client.ask).toHaveBeenCalledOnce();
    expect(JSON.stringify(evidence)).not.toContain("secret");
  });
});
