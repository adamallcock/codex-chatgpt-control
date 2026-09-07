import { createHash, randomUUID } from "node:crypto";
import { createChatGPT, type AskWorkflowArgs, type ChatGPTClient } from "../../client.js";
import type { OperationHandleV1, OperationStateV1 } from "../../operations/types.js";
import type { CommandResult, MessageStatusData } from "../../types.js";
import { contextEnvFlag, contextEnvText } from "./harness.js";
import type { LiveSmokeScenario } from "./types.js";

const EXPECTED_RESPONSE = "ISSUE41_OK";
const PROMPT = `Reply with exactly this token and no other text:\n\n${EXPECTED_RESPONSE}`;

type TransactionalSmokeClient = Pick<ChatGPTClient, "ask" | "operations" | "messages">;

type TransactionalSmokeEvidence = {
  passed: boolean;
  details: Record<string, string | number | boolean>;
};

/**
 * Explicit opt-in: one new synthetic conversation, zero attachments, and at
 * most one Send. Uses the production runtime with an optional explicit journal service.
 * An ambiguous submission permits one guarded, observation-only recovery.
 * A completed receipt is required before the final same-identity replay.
 */
export const transactionalSubmitOnceScenario: LiveSmokeScenario = {
  name: "transactional-submit-once",
  required: false,
  enabled: context => contextEnvFlag(context, "CHATGPT_E2E_TRANSACTIONAL"),
  run: async context => {
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const descriptorPath = contextEnvText(context, "CHATGPT_E2E_JOURNAL_DESCRIPTOR");
    const chatgpt = createChatGPT({
      agent: context.agent,
      ...(descriptorPath === undefined ? {} : { operations: { journalService: { descriptorPath } } }),
      ...(context.browser === undefined ? {} : { browser: context.browser })
    });
    const evidence = await qualifyTransactionalSubmitOnce(chatgpt);
    return {
      name: "transactional-submit-once",
      required: false,
      status: evidence.passed ? "pass" : "fail",
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      details: evidence.details
    };
  }
};

/** The injected client is solely a harness test seam; the live entrypoint uses the public production facade. */
export async function qualifyTransactionalSubmitOnce(
  chatgpt: TransactionalSmokeClient
): Promise<TransactionalSmokeEvidence> {
  const args: AskWorkflowArgs = {
    operationId: randomUUID(),
    prompt: PROMPT,
    thread: { type: "new" },
    experience: "chat",
    files: [],
    wait: false,
    read: { format: "text" },
    report: false
  };
  const details: TransactionalSmokeEvidence["details"] = {
    productionRuntime: true,
    filesRequested: 0,
    multilinePrompt: true,
    duplicateRequestAttempted: false,
    recoveryAttempted: false
  };
  let stage = "ask.submit";
  const fail = (): TransactionalSmokeEvidence => ({ passed: false, details: { ...details, failedStage: stage } });
  try {
    let submitted = await chatgpt.ask(args);
    details.submitStatus = submitted.status;
    if (submitted.blocker !== undefined) {
      details.blockerCode = safeCode(submitted.blocker.code);
      if (submitted.blocker.code !== "ambiguous_submit") return fail();
    }
    const handle = handleFromCommand(submitted);
    if (handle === undefined || handle.operationId !== args.operationId
      || (submitted.status !== "ok" && submitted.status !== "partial")) return fail();

    stage = "operations.inspect.submitted";
    let initial = await chatgpt.operations.inspect(handle);
    let initialSend = sendActions(initial.state);
    details.initialPhase = initial.state.phase;
    details.sendActionCount = initialSend.length;
    if (submitted.blocker?.code === "ambiguous_submit") {
      const intent = initialSend[0];
      const target = initial.state.target;
      details.recoveryEligible = sameOperationHandle(handle, initial.handle)
        && matchesHandleState(initial.handle, initial.state)
        && (initial.state.phase === "uncertain" || initial.state.phase === "submitted")
        && initial.state.mutationBoundary === "send_may_have_occurred"
        && initialSend.length === 1 && intent !== undefined
        && intent.repeatPolicy === "observe_only_after_intent"
        && intent.requestDigest === handle.requestDigest
        && intent.targetDigest === handle.targetBindingDigest
        && Number.isSafeInteger(intent.intentRevision) && intent.intentRevision > 0
        && typeof intent.actionId === "string" && intent.actionId.length > 0
        && target !== undefined
        && [target.providerId, target.browserId, target.tabId].every(value => typeof value === "string" && value.length > 0);
      if (details.recoveryEligible !== true || intent === undefined || target === undefined) return fail();
      // Capture immutable identity before calling recovery. New conversations
      // may establish a conversation ID, but cannot change their tab/anchor.
      const before = {
        handle: { ...initial.handle }, intent: { ...intent },
        providerId: target.providerId, browserId: target.browserId, tabId: target.tabId,
        conversationId: target.conversationId
      };
      stage = "ask.recover_submission";
      details.recoveryAttempted = true;
      const recovered = await chatgpt.ask(args);
      details.recoveryStatus = recovered.status;
      if (recovered.blocker !== undefined) {
        details.recoveryBlockerCode = safeCode(recovered.blocker.code);
        return fail();
      }
      const recoveredHandle = handleFromCommand(recovered);
      if (recoveredHandle === undefined || !sameOperationHandle(before.handle, recoveredHandle)
        || (recovered.status !== "ok" && recovered.status !== "partial")) return fail();
      stage = "operations.inspect.recovered";
      const recoveredState = await chatgpt.operations.inspect(recoveredHandle);
      const recoveredSend = sendActions(recoveredState.state);
      const afterIntent = recoveredSend[0];
      const afterTarget = recoveredState.state.target;
      details.recoverySameTarget = sameOperationHandle(before.handle, recoveredState.handle)
        && matchesHandleState(recoveredState.handle, recoveredState.state)
        && afterTarget?.providerId === before.providerId
        && afterTarget?.browserId === before.browserId
        && afterTarget?.tabId === before.tabId
        && (before.conversationId === undefined || afterTarget?.conversationId === before.conversationId);
      details.recoverySameSendAction = recoveredSend.length === 1
        && afterIntent?.actionId === before.intent.actionId
        && afterIntent?.intentRevision === before.intent.intentRevision
        && afterIntent?.requestDigest === before.intent.requestDigest
        && afterIntent?.targetDigest === before.intent.targetDigest
        && afterIntent?.repeatPolicy === before.intent.repeatPolicy;
      if (details.recoverySameTarget !== true || details.recoverySameSendAction !== true) return fail();
      details.recoveredPhase = recoveredState.state.phase;
      submitted = recovered;
      initial = recoveredState;
      initialSend = recoveredSend;
    }
    if (initialSend.length !== 1 || initialSend[0]?.outcome !== "satisfied") return fail();

    stage = "operations.collect";
    const collected = await chatgpt.operations.collect(initial.handle, {
      wait: true,
      timeoutMs: 60_000,
      maxAttempts: 120,
      pollIntervalMs: 500,
      responseContent: "include",
      responseFormat: "text"
    });
    details.collectKind = collected.kind;
    if (collected.kind !== "completed") {
      if (collected.kind === "blocked") details.blockerCode = safeCode(collected.blocker.code);
      return fail();
    }
    // A fast response may already be captured by ask's first observation.
    // Completed receipt replay deliberately does not persist or return raw text.
    const initialData = submitted.data as { responseText?: unknown } | undefined;
    const text = collected.response.rawText ?? (initial.state.phase === "completed"
      && typeof initialData?.responseText === "string" ? initialData.responseText : undefined);
    details.responseMatches = text?.trim() === EXPECTED_RESPONSE;
    details.responseBytes = text === undefined ? 0 : new TextEncoder().encode(text).length;
    if (text !== undefined) details.responseHash = createHash("sha256").update(text).digest("hex");
    if (details.responseMatches !== true) return fail();

    stage = "operations.inspect.completed";
    const completed = await chatgpt.operations.inspect(initial.handle);
    const receipt = completed.state.receipt;
    if (completed.state.phase !== "completed" || receipt === undefined
      || receipt.userTurnId !== collected.turn.userTurnId
      || receipt.assistantTurnId !== collected.turn.assistantTurnId) return fail();
    details.ownedReceiptVerified = true;

    stage = "messages.status.completed";
    const before = await chatgpt.messages.status({ maxPreviewChars: 0 });
    details.initialConversationVerified = matchesEstablishedConversation(before, completed.state);
    if (!hasExactlyOneExchange(before) || details.initialConversationVerified !== true) return fail();

    // This is unreachable after unresolved uncertainty, a pending collect,
    // a host blocker, or a missing receipt. Never use a new ID as a retry.
    stage = "ask.same_identity";
    details.duplicateRequestAttempted = true;
    const replayed = await chatgpt.ask(args);
    details.replayStatus = replayed.status;
    if (!replayed.ok) return fail();
    const replayHandle = handleFromCommand(replayed);
    details.sameOperationHandle = replayHandle !== undefined
      && replayHandle.operationId === args.operationId
      && sameOperationHandle(replayHandle, completed.handle);
    if (details.sameOperationHandle !== true) return fail();

    stage = "operations.inspect.replayed";
    const replayState = await chatgpt.operations.inspect(completed.handle);
    const replaySend = sendActions(replayState.state);
    const replayReceipt = replayState.state.receipt;
    details.sameSendAction = replaySend.length === 1
      && replaySend[0]?.actionId === initialSend[0]?.actionId
      && replaySend[0]?.intentRevision === initialSend[0]?.intentRevision
      && replaySend[0]?.receiptRevision === initialSend[0]?.receiptRevision;
    details.sameOwnedTurns = replayReceipt?.userTurnId === receipt.userTurnId
      && replayReceipt?.assistantTurnId === receipt.assistantTurnId;
    if (details.sameSendAction !== true || details.sameOwnedTurns !== true) return fail();

    stage = "messages.status.replayed";
    const after = await chatgpt.messages.status({ maxPreviewChars: 0 });
    details.exactlyOneExchange = hasExactlyOneExchange(after);
    details.sameConversation = matchesEstablishedConversation(after, completed.state);
    if (details.exactlyOneExchange !== true || details.sameConversation !== true) return fail();
    details.finalPhase = replayState.state.phase;
    return { passed: true, details };
  } catch {
    // Host/provider failures can contain private paths or identifiers. Only
    // bounded structural evidence crosses the live report boundary.
    details.exception = true;
    return fail();
  }
}

function sendActions(state: OperationStateV1) {
  return Object.values(state.actions).filter(action => action.kind === "send");
}

function sameOperationHandle(first: OperationHandleV1, second: OperationHandleV1): boolean {
  return typeof first.operationId === "string" && first.operationId.length > 0
    && first.operationId === second.operationId
    && typeof first.requestDigest === "string" && first.requestDigest.length > 0
    && first.requestDigest === second.requestDigest
    && first.surface === "chat" && first.surface === second.surface
    && typeof first.targetBindingDigest === "string" && first.targetBindingDigest.length > 0
    && first.targetBindingDigest === second.targetBindingDigest;
}

function matchesHandleState(handle: OperationHandleV1, state: OperationStateV1): boolean {
  return state.operationId === handle.operationId && state.requestDigest === handle.requestDigest
    && state.surface === handle.surface;
}

function handleFromCommand(command: CommandResult<unknown>): OperationHandleV1 | undefined {
  if (typeof command.data !== "object" || command.data === null || !("handle" in command.data)) return undefined;
  const value = command.data.handle;
  return typeof value === "object" && value !== null && "operationId" in value
    ? value as OperationHandleV1
    : undefined;
}

function hasExactlyOneExchange(command: CommandResult<unknown>): boolean {
  const data = command.data as Partial<MessageStatusData> | undefined;
  return command.ok && data?.turnCount === 2 && data.assistantTurnCount === 1;
}

function matchesEstablishedConversation(command: CommandResult<unknown>, state: OperationStateV1): boolean {
  const target = state.target;
  return typeof target?.conversationId === "string" && target.conversationId.length > 0
    && command.context.conversationId === target.conversationId
    && (command.context.tabId === undefined || command.context.tabId === target.tabId);
}

function safeCode(value: string | undefined): string {
  return value !== undefined && /^[a-z0-9_]{1,100}$/u.test(value) ? value : "unavailable";
}
