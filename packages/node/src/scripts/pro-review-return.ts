import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizePromptForHash } from "../dom/visible-text.js";

export const PRO_REVIEW_RETURN_USAGE = [
  "Usage:",
  "  npm run pro-review-return -- --meta <answer.meta.json>",
  "  npm run pro-review-return -- --meta <answer.meta.json> --consume-current --current-thread-id <threadId> [--current-session-id <sessionId>]",
  "  npm run pro-review-return -- --meta <answer.meta.json> --preflight-thread-json <thread-read.json>",
  "  npm run pro-review-return -- --meta <answer.meta.json> --reserve-send --preflight-thread-json <thread-read.json>",
  "  npm run pro-review-return -- --meta <answer.meta.json> --record-turn-started --attempt-id <attemptId> [--turn-id <turnId>]",
  "  npm run pro-review-return -- --meta <answer.meta.json> --confirm-sent --post-send-thread-json <thread-read.json> [--attempt-id <attemptId>]",
  "",
  "Validates a schema v2 Pro review answer metadata file and returns the Codex",
  "thread routing payload that an outer Codex tool can send after thread preflight.",
  "",
  "With --consume-current, validates that the answer belongs to the current",
  "Codex thread and marks the local return ledger as current_thread_consumed.",
  "With --preflight-thread-json, validates a previously read target Codex thread",
  "snapshot for cross-thread return without sending anything.",
  "--reserve-send, --record-turn-started, and --confirm-sent only update the",
  "local return ledger. They do not call Codex thread messaging by themselves.",
  "",
  "This script does not send to Codex by itself."
].join("\n");

export type ProReviewReturnArgs = {
  metaPath: string;
  consumeCurrent: boolean;
  reserveSend: boolean;
  recordTurnStarted: boolean;
  confirmSent: boolean;
  preflightThreadJsonPath?: string;
  postSendThreadJsonPath?: string;
  attemptId?: string;
  turnId?: string;
  currentThreadId?: string;
  currentSessionId?: string;
};

export type ProReviewReturnRequest = {
  ok: true;
  status: "ready";
  threadId: string;
  sessionId?: string;
  runId: string;
  promptPath: string;
  prompt: string;
  answerPath: string;
  answerSha256: string;
  ledgerPath: string;
};

export type ProReviewCurrentThreadConsumeResult = Omit<ProReviewReturnRequest, "status"> & {
  status: "current_thread_consumed";
  answerText: string;
  consumedAt: string;
};

export type ProReviewCrossThreadPreflightResult =
  | (Omit<ProReviewReturnRequest, "status"> & {
    status: "preflight_ready";
    target: {
      threadId: string;
      sessionId: string;
      runtimeStatus: string;
    };
  })
  | {
    ok: false;
    status: "blocked" | "duplicate_detected";
    threadId?: string;
    runId: string;
    blocker: {
      code: string;
      message: string;
    };
  };

export type ProReviewSendReservation = Omit<ProReviewReturnRequest, "status"> & {
  status: "send_reserved";
  attemptId: string;
  leaseExpiresAt: string;
};

export type ProReviewTurnStarted = Omit<ProReviewReturnRequest, "status"> & {
  status: "turn_started";
  attemptId: string;
  recordedAt: string;
  turnId?: string;
};

export type ProReviewSendConfirmation =
  | (Omit<ProReviewReturnRequest, "status"> & {
    status: "marker_observed";
    attemptId: string;
    confirmedAt: string;
  })
  | {
    ok: false;
    status: "blocked" | "duplicate_detected";
    threadId?: string;
    runId: string;
    blocker: {
      code: string;
      message: string;
    };
  };

export type CodexThreadReturnTools = {
  readThread: (args: { threadId: string; turnLimit?: number; includeOutputs?: boolean; maxOutputCharsPerItem?: number }) => Promise<unknown>;
  sendMessageToThread: (args: { threadId: string; prompt: string }) => Promise<unknown>;
};

export type ProReviewGuardedCrossThreadSendResult = Extract<ProReviewSendConfirmation, { ok: true }> & {
  sendResult: unknown;
  postSendThread: unknown;
};

type ProReviewReturnState =
  | "return_prompt_prepared"
  | "blocked"
  | "current_thread_consumed"
  | "send_reserved"
  | "turn_started"
  | "marker_observed"
  | "completed"
  | "duplicate_detected"
  | "failed_retryable"
  | "failed_terminal";

export class ProReviewReturnError extends Error {
  constructor(message: string, readonly exitCode = 2) {
    super(message);
    this.name = "ProReviewReturnError";
  }
}

export function parseProReviewReturnArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): ProReviewReturnArgs {
  let metaPath: string | undefined;
  let consumeCurrent = false;
  let reserveSend = false;
  let recordTurnStarted = false;
  let confirmSent = false;
  let preflightThreadJsonPath: string | undefined;
  let postSendThreadJsonPath: string | undefined;
  let attemptId: string | undefined;
  let turnId: string | undefined;
  let currentThreadId: string | undefined;
  let currentSessionId: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    switch (arg) {
      case "--help":
      case "-h":
        throw new ProReviewReturnError(PRO_REVIEW_RETURN_USAGE, 0);
      case "--meta":
        metaPath = requiredValue(argv, ++index, arg);
        break;
      case "--consume-current":
        consumeCurrent = true;
        break;
      case "--reserve-send":
        reserveSend = true;
        break;
      case "--record-turn-started":
        recordTurnStarted = true;
        break;
      case "--confirm-sent":
        confirmSent = true;
        break;
      case "--preflight-thread-json":
        preflightThreadJsonPath = requiredValue(argv, ++index, arg);
        break;
      case "--post-send-thread-json":
        postSendThreadJsonPath = requiredValue(argv, ++index, arg);
        break;
      case "--attempt-id":
        attemptId = requiredValue(argv, ++index, arg);
        break;
      case "--turn-id":
        turnId = requiredValue(argv, ++index, arg);
        break;
      case "--current-thread-id":
        currentThreadId = requiredValue(argv, ++index, arg);
        break;
      case "--current-session-id":
        currentSessionId = requiredValue(argv, ++index, arg);
        break;
      default:
        throw new ProReviewReturnError(`Unknown argument: ${arg}\n\n${PRO_REVIEW_RETURN_USAGE}`);
    }
  }
  if (metaPath === undefined) {
    throw new ProReviewReturnError(`Missing --meta.\n\n${PRO_REVIEW_RETURN_USAGE}`);
  }
  const resolvedCurrentThreadId = firstText(currentThreadId, env.CODEX_THREAD_ID);
  const resolvedCurrentSessionId = firstText(currentSessionId, env.CODEX_SESSION_ID);
  const modeCount = [consumeCurrent, reserveSend, recordTurnStarted, confirmSent, preflightThreadJsonPath !== undefined && !reserveSend].filter(Boolean).length;
  if (modeCount > 1) {
    throw new ProReviewReturnError("Choose only one return action.");
  }
  if (reserveSend && preflightThreadJsonPath === undefined) {
    throw new ProReviewReturnError("--reserve-send requires --preflight-thread-json.");
  }
  return {
    metaPath,
    consumeCurrent,
    reserveSend,
    recordTurnStarted,
    confirmSent,
    ...(preflightThreadJsonPath !== undefined ? { preflightThreadJsonPath } : {}),
    ...(postSendThreadJsonPath !== undefined ? { postSendThreadJsonPath } : {}),
    ...(attemptId !== undefined ? { attemptId } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
    ...(resolvedCurrentThreadId !== undefined ? { currentThreadId: resolvedCurrentThreadId } : {}),
    ...(resolvedCurrentSessionId !== undefined ? { currentSessionId: resolvedCurrentSessionId } : {})
  };
}

export async function prepareProReviewReturn(metaPath: string): Promise<ProReviewReturnRequest> {
  const { request } = await validateProReviewReturn(metaPath);
  return request;
}

export async function consumeCurrentThreadReturn(
  metaPath: string,
  current: { threadId: string; sessionId?: string }
): Promise<ProReviewCurrentThreadConsumeResult> {
  const { request, answerText, ledger } = await validateProReviewReturn(metaPath);
  requireEquals(request.threadId, current.threadId, "current.threadId");
  if (request.sessionId !== undefined) {
    requireEquals(current.sessionId, request.sessionId, "current.sessionId");
  }

  const consumedAt = new Date().toISOString();
  const consumedBy = {
    method: "current_thread_direct",
    consumedAt,
    threadId: current.threadId,
    ...(current.sessionId !== undefined ? { sessionId: current.sessionId } : {})
  };
  const updatedReturn = {
    ...requireRecord(ledger.return, "ledger.return"),
    state: "current_thread_consumed" as ProReviewReturnState,
    returnedAt: consumedAt,
    consumedBy
  };
  await writeFileAtomic(request.ledgerPath, `${JSON.stringify({
    ...ledger,
    state: "current_thread_consumed",
    updatedAt: consumedAt,
    return: updatedReturn
  }, null, 2)}\n`);

  return {
    ...request,
    status: "current_thread_consumed",
    answerText,
    consumedAt
  };
}

export async function preflightCrossThreadReturn(
  metaPath: string,
  targetThreadSnapshot: unknown
): Promise<ProReviewCrossThreadPreflightResult> {
  const { request, meta } = await validateProReviewReturn(metaPath);
  const target = normalizeTargetThread(targetThreadSnapshot);
  const block = (code: string, message: string, status: "blocked" | "duplicate_detected" = "blocked"): ProReviewCrossThreadPreflightResult => ({
    ok: false,
    status,
    ...(target.threadId !== undefined ? { threadId: target.threadId } : {}),
    runId: request.runId,
    blocker: { code, message }
  });

  if (request.sessionId === undefined) {
    return block("codex_session_missing", "Return metadata is missing codex.sessionId; cross-thread preflight requires threadId plus sessionId.");
  }
  if (target.threadId === undefined) {
    return block("target_thread_id_missing", "Target thread snapshot does not include id or threadId.");
  }
  if (target.threadId !== request.threadId) {
    return block("target_thread_mismatch", "Target thread id does not match return metadata codex.threadId.");
  }
  if (target.sessionId === undefined) {
    return block("target_session_missing", "Target thread snapshot does not include sessionId.");
  }
  if (target.sessionId !== request.sessionId) {
    return block("target_session_mismatch", "Target thread sessionId does not match return metadata codex.sessionId.");
  }
  if (target.cwd === undefined || target.cwd !== meta.codex.cwd) {
    return block("target_cwd_mismatch", "Target thread cwd is missing or does not match return metadata.");
  }
  if (target.projectRoot === undefined || target.projectRoot !== meta.codex.projectRoot) {
    return block("target_project_root_mismatch", "Target thread projectRoot is missing or does not match return metadata.");
  }
  if (!gitMatches(target.git, meta.codex.git)) {
    return block("target_git_mismatch", "Target thread git metadata is missing or does not match return metadata.");
  }
  if (target.archived === true) {
    return block("target_thread_archived", "Target thread is archived.");
  }
  if (target.runtimeStatus === undefined) {
    return block("target_runtime_status_missing", "Target thread snapshot does not include runtime status.");
  }
  if (!["idle", "notLoaded", "not_loaded"].includes(target.runtimeStatus)) {
    return block("target_thread_not_idle", `Target thread runtime status is ${target.runtimeStatus}.`);
  }
  if (target.activeFlags === undefined) {
    return block("target_active_flags_missing", "Target thread snapshot does not include active flags evidence.");
  }
  if (target.activeFlags.length > 0) {
    return block("target_thread_active_flags", `Target thread has active flags: ${target.activeFlags.join(", ")}.`);
  }
  const searchableText = collectStrings(targetThreadSnapshot).join("\n");
  if (searchableText.includes(request.runId)) {
    if (searchableText.includes(request.answerSha256)) {
      return block("duplicate_run_id_same_hash", "Target thread already contains this runId and answer hash; do not resend.", "duplicate_detected");
    }
    return block("duplicate_run_id_hash_unknown", "Target thread already contains this runId but the matching answer hash was not observed.");
  }

  return {
    ok: true,
    status: "preflight_ready",
    threadId: request.threadId,
    ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
    runId: request.runId,
    promptPath: request.promptPath,
    prompt: request.prompt,
    answerPath: request.answerPath,
    answerSha256: request.answerSha256,
    ledgerPath: request.ledgerPath,
    target: {
      threadId: target.threadId,
      sessionId: target.sessionId,
      runtimeStatus: target.runtimeStatus
    }
  };
}

export async function reserveCrossThreadSend(
  metaPath: string,
  targetThreadSnapshot: unknown,
  options: { attemptId?: string; leaseMs?: number } = {}
): Promise<ProReviewSendReservation> {
  const preflight = await preflightCrossThreadReturn(metaPath, targetThreadSnapshot);
  if (!preflight.ok) {
    throw new ProReviewReturnError(`Cannot reserve send: ${preflight.blocker.code}: ${preflight.blocker.message}`);
  }
  const { request, ledger } = await validateProReviewReturn(metaPath, ["return_prompt_prepared"]);
  const attemptId = options.attemptId ?? `attempt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (returnAttempts(ledger).some(attempt => attempt.attemptId === attemptId)) {
    throw new ProReviewReturnError("attemptId already exists in ledger.");
  }
  const reservedAt = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + (options.leaseMs ?? 10 * 60 * 1000)).toISOString();
  const attempt = {
    attemptId,
    state: "send_reserved",
    reservedAt,
    leaseExpiresAt,
    targetThreadId: preflight.target.threadId,
    targetSessionId: preflight.target.sessionId
  };
  await updateLedger(request.ledgerPath, ledger, "send_reserved", {
    state: "send_reserved",
    reservedAt,
    leaseExpiresAt,
    attempts: [...returnAttempts(ledger), attempt]
  });
  return {
    ...request,
    status: "send_reserved",
    attemptId,
    leaseExpiresAt
  };
}

export async function recordCrossThreadTurnStarted(
  metaPath: string,
  options: { attemptId?: string; turnId?: string } = {}
): Promise<ProReviewTurnStarted> {
  const { request, ledger } = await validateProReviewReturn(metaPath, ["send_reserved"]);
  const attempt = selectAttempt(ledger, options.attemptId);
  requireEquals(attempt.state, "send_reserved", "attempt.state");
  requireUnexpiredLease(attempt);
  const recordedAt = new Date().toISOString();
  const updatedAttempt: Record<string, unknown> = {
    ...attempt,
    state: "turn_started",
    recordedAt,
    ...(options.turnId !== undefined ? { turnId: options.turnId } : {})
  };
  await updateLedger(request.ledgerPath, ledger, "turn_started", {
    state: "turn_started",
    turnId: options.turnId ?? null,
    attempts: replaceAttempt(ledger, updatedAttempt)
  });
  return {
    ...request,
    status: "turn_started",
    attemptId: requireText(updatedAttempt.attemptId, "attempt.attemptId"),
    recordedAt,
    ...(options.turnId !== undefined ? { turnId: options.turnId } : {})
  };
}

export async function confirmCrossThreadSend(
  metaPath: string,
  postSendThreadSnapshot: unknown,
  options: { attemptId?: string } = {}
): Promise<ProReviewSendConfirmation> {
  const { request, ledger } = await validateProReviewReturn(metaPath, ["turn_started", "send_reserved"]);
  const attempt = selectAttempt(ledger, options.attemptId);
  const attemptState = requireText(attempt.state, "attempt.state");
  if (!["turn_started", "send_reserved"].includes(attemptState)) {
    throw new ProReviewReturnError("attempt.state must be turn_started or send_reserved before confirmation.");
  }
  const target = normalizeTargetThread(postSendThreadSnapshot);
  const block = (code: string, message: string, status: "blocked" | "duplicate_detected" = "blocked"): ProReviewSendConfirmation => ({
    ok: false,
    status,
    ...(target.threadId !== undefined ? { threadId: target.threadId } : {}),
    runId: request.runId,
    blocker: { code, message }
  });
  if (target.threadId !== request.threadId) {
    return block("post_send_thread_mismatch", "Post-send readback thread id does not match return metadata.");
  }
  if (request.sessionId !== undefined && target.sessionId !== request.sessionId) {
    return block("post_send_session_mismatch", "Post-send readback sessionId does not match return metadata.");
  }
  const searchableText = collectStrings(postSendThreadSnapshot).join("\n");
  if (!searchableText.includes(request.runId)) {
    return block("post_send_marker_missing", "Post-send readback did not contain the runId marker.");
  }
  if (!searchableText.includes(request.answerSha256)) {
    return block("post_send_answer_hash_missing", "Post-send readback did not contain the answer hash marker.");
  }
  const confirmedAt = new Date().toISOString();
  const updatedAttempt: Record<string, unknown> = {
    ...attempt,
    state: "marker_observed",
    confirmedAt
  };
  await updateLedger(request.ledgerPath, ledger, "marker_observed", {
    state: "marker_observed",
    returnedAt: confirmedAt,
    attempts: replaceAttempt(ledger, updatedAttempt)
  });
  return {
    ...request,
    status: "marker_observed",
    attemptId: requireText(updatedAttempt.attemptId, "attempt.attemptId"),
    confirmedAt
  };
}

export async function guardedCrossThreadSend(
  metaPath: string,
  tools: CodexThreadReturnTools,
  options: { attemptId?: string; turnLimit?: number } = {}
): Promise<ProReviewGuardedCrossThreadSendResult | Exclude<ProReviewSendConfirmation, { ok: true }>> {
  const request = await prepareProReviewReturn(metaPath);
  const preSendThread = await tools.readThread({
    threadId: request.threadId,
    turnLimit: options.turnLimit ?? 20,
    includeOutputs: false
  });
  const reservation = await reserveCrossThreadSend(metaPath, preSendThread, {
    ...(options.attemptId !== undefined ? { attemptId: options.attemptId } : {})
  });
  const sendResult = await tools.sendMessageToThread({
    threadId: request.threadId,
    prompt: request.prompt
  });
  const turnId = extractTurnId(sendResult);
  await recordCrossThreadTurnStarted(metaPath, {
    attemptId: reservation.attemptId,
    ...(turnId !== undefined ? { turnId } : {})
  });
  const postSendThread = await tools.readThread({
    threadId: request.threadId,
    turnLimit: options.turnLimit ?? 20,
    includeOutputs: false
  });
  const confirmation = await confirmCrossThreadSend(metaPath, postSendThread, {
    attemptId: reservation.attemptId
  });
  if (!confirmation.ok) return confirmation;
  return {
    ...confirmation,
    sendResult,
    postSendThread
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseProReviewReturnArgs(argv);
    if (args.consumeCurrent) {
      if (args.currentThreadId === undefined) {
        throw new ProReviewReturnError("Missing --current-thread-id or CODEX_THREAD_ID for --consume-current.");
      }
      console.log(JSON.stringify(await consumeCurrentThreadReturn(args.metaPath, {
        threadId: args.currentThreadId,
        ...(args.currentSessionId !== undefined ? { sessionId: args.currentSessionId } : {})
      }), null, 2));
      return 0;
    }
    if (args.preflightThreadJsonPath !== undefined) {
      const threadSnapshot = JSON.parse(await readFile(args.preflightThreadJsonPath, "utf8")) as unknown;
      const result = args.reserveSend
        ? await reserveCrossThreadSend(args.metaPath, threadSnapshot, {
          ...(args.attemptId !== undefined ? { attemptId: args.attemptId } : {})
        })
        : await preflightCrossThreadReturn(args.metaPath, threadSnapshot);
      console.log(JSON.stringify(result, null, 2));
      return result.ok ? 0 : 2;
    }
    if (args.recordTurnStarted) {
      const result = await recordCrossThreadTurnStarted(args.metaPath, {
        ...(args.attemptId !== undefined ? { attemptId: args.attemptId } : {}),
        ...(args.turnId !== undefined ? { turnId: args.turnId } : {})
      });
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    if (args.confirmSent) {
      if (args.postSendThreadJsonPath === undefined) {
        throw new ProReviewReturnError("Missing --post-send-thread-json for --confirm-sent.");
      }
      const threadSnapshot = JSON.parse(await readFile(args.postSendThreadJsonPath, "utf8")) as unknown;
      const result = await confirmCrossThreadSend(args.metaPath, threadSnapshot, {
        ...(args.attemptId !== undefined ? { attemptId: args.attemptId } : {})
      });
      console.log(JSON.stringify(result, null, 2));
      return result.ok ? 0 : 2;
    }
    console.log(JSON.stringify(await prepareProReviewReturn(args.metaPath), null, 2));
    return 0;
  } catch (error) {
    if (error instanceof ProReviewReturnError) {
      console.error(error.message);
      return error.exitCode;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function validateProReviewReturn(
  metaPath: string,
  allowedLedgerStates: ProReviewReturnState[] = ["return_prompt_prepared"]
): Promise<{
  request: ProReviewReturnRequest;
  answerText: string;
  meta: {
    runId: string;
    codex: {
      threadId: string;
      sessionId?: string;
      cwd: string;
      projectRoot: string;
      git: {
        available: true;
        worktreeRoot: string;
        branch: string;
        headSha: string;
        remoteUrlSha256?: string;
      };
    };
  };
  ledger: Record<string, unknown>;
}> {
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as unknown;
  const record = requireRecord(meta, "metadata");
  requireEquals(record.schemaVersion, 2, "schemaVersion");
  requireEquals(record.ok, true, "ok");
  const runId = requireText(record.runId, "runId");

  const codex = requireRecord(record.codex, "codex");
  const threadId = requireText(codex.threadId, "codex.threadId");
  const sessionId = optionalText(codex.sessionId, "codex.sessionId");
  const cwd = requireText(codex.cwd, "codex.cwd");
  const projectRoot = requireText(codex.projectRoot, "codex.projectRoot");
  const git = requireRecord(codex.git, "codex.git");
  requireEquals(git.available, true, "codex.git.available");
  const gitWorktreeRoot = requireText(git.worktreeRoot, "codex.git.worktreeRoot");
  const gitBranch = requireText(git.branch, "codex.git.branch");
  const gitHeadSha = requireText(git.headSha, "codex.git.headSha");
  const gitRemoteUrlSha256 = optionalText(git.remoteUrlSha256, "codex.git.remoteUrlSha256");

  const promptRecord = requireRecord(record.prompt, "prompt");
  const inputPromptPath = requireText(promptRecord.path, "prompt.path");
  const inputPromptSha256 = requireText(promptRecord.sha256, "prompt.sha256");
  const inputPrompt = await readFile(inputPromptPath, "utf8");
  requireEquals(sha256Text(normalizePromptForHash(inputPrompt)), inputPromptSha256, "prompt.sha256");

  const zip = requireRecord(record.zip, "zip");
  const zipPath = requireText(zip.path, "zip.path");
  const zipSha256 = requireText(zip.sha256, "zip.sha256");
  requireEquals(await sha256File(zipPath), zipSha256, "zip.sha256");

  const answer = requireRecord(record.answer, "answer");
  const answerPath = requireText(answer.path, "answer.path");
  const answerSha256 = requireText(answer.sha256, "answer.sha256");
  const answerSource = requireText(answer.source, "answer.source");
  if (!["clipboard", "dom"].includes(answerSource)) {
    throw new ProReviewReturnError("answer.source must be clipboard or dom.");
  }
  const answerFormat = requireText(answer.format, "answer.format");
  requireEquals(answerFormat, "markdown", "answer.format");
  const answerText = await readFile(answerPath, "utf8");
  requireEquals(sha256Text(answerText), answerSha256, "answer.sha256");

  const ret = requireRecord(record.return, "return");
  requireEquals(ret.state, "return_prompt_prepared", "return.state");
  const promptPath = requireText(ret.promptPath, "return.promptPath");
  const promptSha256 = requireText(ret.promptSha256, "return.promptSha256");
  const ledgerPath = requireText(ret.ledgerPath, "return.ledgerPath");
  const prompt = await readFile(promptPath, "utf8");
  requireEquals(sha256Text(prompt), promptSha256, "return.promptSha256");
  requireReturnPromptMarkers(prompt, {
    runId,
    threadId,
    answerPath,
    answerSha256,
    inputPromptPath,
    inputPromptSha256,
    zipPath,
    zipSha256
  });

  const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as unknown;
  const ledgerRecord = requireRecord(ledger, "ledger");
  requireEquals(ledgerRecord.schemaVersion, 2, "ledger.schemaVersion");
  requireEquals(ledgerRecord.runId, runId, "ledger.runId");
  requireJsonEquivalent(ledgerRecord.codex, codex, "ledger.codex");
  requireJsonEquivalent(ledgerRecord.prompt, promptRecord, "ledger.prompt");
  requireJsonEquivalent(ledgerRecord.zip, zip, "ledger.zip");
  requireJsonEquivalent(ledgerRecord.answer, answer, "ledger.answer");
  const ledgerState = requireText(ledgerRecord.state, "ledger.state") as ProReviewReturnState;
  if (!allowedLedgerStates.includes(ledgerState)) {
    throw new ProReviewReturnError(`ledger.state did not match expected value.`);
  }
  const ledgerReturn = requireRecord(ledgerRecord.return, "ledger.return");
  requireEquals(ledgerReturn.state, ledgerState, "ledger.return.state");
  requireEquals(ledgerReturn.ledgerPath, ledgerPath, "ledger.return.ledgerPath");
  requireEquals(ledgerReturn.promptPath, promptPath, "ledger.return.promptPath");
  requireEquals(ledgerReturn.promptSha256, promptSha256, "ledger.return.promptSha256");
  if (ret.method !== undefined) requireEquals(ledgerReturn.method, ret.method, "ledger.return.method");

  return {
    request: {
      ok: true,
      status: "ready",
      threadId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      runId,
      promptPath,
      prompt,
      answerPath,
      answerSha256,
      ledgerPath
    },
    answerText,
    meta: {
      runId,
      codex: {
        threadId,
        ...(sessionId !== undefined ? { sessionId } : {}),
        cwd,
        projectRoot,
        git: {
          available: true,
          worktreeRoot: gitWorktreeRoot,
          branch: gitBranch,
          headSha: gitHeadSha,
          ...(gitRemoteUrlSha256 !== undefined ? { remoteUrlSha256: gitRemoteUrlSha256 } : {})
        }
      }
    },
    ledger: ledgerRecord
  };
}

function requireReturnPromptMarkers(prompt: string, expected: Record<string, string>): void {
  for (const [name, value] of Object.entries(expected)) {
    if (!prompt.includes(value)) {
      throw new ProReviewReturnError(`return prompt does not include ${name}.`);
    }
  }
  if (!hasClosedInlineAnswerFence(prompt) && !prompt.includes("Omitted because the answer is ")) {
    throw new ProReviewReturnError("return prompt inline answer must be fenced or explicitly omitted.");
  }
  if (!prompt.includes("untrusted third-party review input")) {
    throw new ProReviewReturnError("return prompt does not mark the Pro answer as untrusted advisory input.");
  }
}

function hasClosedInlineAnswerFence(prompt: string): boolean {
  const lines = prompt.split(/\r?\n/);
  const headerIndex = lines.findIndex(line => line.trim() === "## Inline Answer");
  if (headerIndex < 0) return false;
  const fenceStartIndex = lines.findIndex((line, index) => index > headerIndex && line.trim().length > 0);
  if (fenceStartIndex < 0) return false;
  const startMatch = lines[fenceStartIndex]?.match(/^(`{3,})text\s*$/);
  if (startMatch === undefined || startMatch === null) return false;
  const fence = startMatch[1];
  return lines.slice(fenceStartIndex + 1).some(line => line === fence);
}

function normalizeTargetThread(value: unknown): {
  threadId?: string;
  sessionId?: string;
  cwd?: string;
  projectRoot?: string;
  git?: {
    available?: boolean;
    worktreeRoot?: string;
    branch?: string;
    headSha?: string;
    remoteUrlSha256?: string;
  };
  runtimeStatus?: string;
  activeFlags?: string[];
  archived?: boolean;
} {
  const root = requireRecord(value, "targetThreadSnapshot");
  const thread = recordAt(root, "thread") ?? root;
  const metadata = recordAt(thread, "metadata") ?? {};
  const runtime = recordAt(thread, "runtime") ?? recordAt(thread, "runtimeStatus") ?? {};
  const statusObject = recordAt(thread, "status") ?? recordAt(root, "status");
  const git = recordAt(thread, "git") ?? recordAt(metadata, "git");
  const threadId = firstTextValue(thread.id, thread.threadId, root.threadId, root.id);
  const sessionId = firstTextValue(thread.sessionId, thread.session_id, root.sessionId, metadata.sessionId);
  const cwd = firstTextValue(thread.cwd, root.cwd, metadata.cwd);
  const projectRoot = firstTextValue(thread.projectRoot, thread.project_root, root.projectRoot, metadata.projectRoot);
  const runtimeStatus = firstTextValue(thread.status, thread.runtimeStatus, root.status, root.runtimeStatus, runtime.status, runtime.state, statusObject?.type);
  const activeFlags = arrayText(thread.activeFlags) ?? arrayText(root.activeFlags) ?? arrayText(runtime.activeFlags);
  const archived =
    thread.archived === true || root.archived === true
      ? true
      : thread.archived === false || root.archived === false
        ? false
        : undefined;
  return {
    ...(threadId !== undefined ? { threadId } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(projectRoot !== undefined ? { projectRoot } : {}),
    ...(git !== undefined ? { git: normalizeGit(git) } : {}),
    ...(runtimeStatus !== undefined ? { runtimeStatus } : {}),
    ...(activeFlags !== undefined ? { activeFlags } : {}),
    ...(archived !== undefined ? { archived } : {})
  };
}

function normalizeGit(value: Record<string, unknown>): {
  available?: boolean;
  worktreeRoot?: string;
  branch?: string;
  headSha?: string;
  remoteUrlSha256?: string;
} {
  const worktreeRoot = firstTextValue(value.worktreeRoot, value.worktree_root);
  const branch = firstTextValue(value.branch);
  const headSha = firstTextValue(value.headSha, value.head_sha, value.head);
  const remoteUrlSha256 = firstTextValue(value.remoteUrlSha256, value.remote_url_sha256);
  return {
    ...(typeof value.available === "boolean" ? { available: value.available } : {}),
    ...(worktreeRoot !== undefined ? { worktreeRoot } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(headSha !== undefined ? { headSha } : {}),
    ...(remoteUrlSha256 !== undefined ? { remoteUrlSha256 } : {})
  };
}

function gitMatches(
  actual: ReturnType<typeof normalizeTargetThread>["git"],
  expected: {
    available: true;
    worktreeRoot: string;
    branch: string;
    headSha: string;
    remoteUrlSha256?: string;
  }
): boolean {
  if (actual === undefined || actual.available !== true) return false;
  if (actual.worktreeRoot !== expected.worktreeRoot) return false;
  if (actual.branch !== expected.branch) return false;
  if (actual.headSha !== expected.headSha) return false;
  if (expected.remoteUrlSha256 !== undefined && actual.remoteUrlSha256 !== expected.remoteUrlSha256) return false;
  return true;
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return output;
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) collectStrings(child, output);
  }
  return output;
}

function extractTurnId(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractTurnId(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const direct = firstTextValue(record.turnId, record.turn_id);
  if (direct !== undefined) return direct;
  for (const child of Object.values(record)) {
    const found = extractTurnId(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function firstTextValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function arrayText(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

async function updateLedger(
  ledgerPath: string,
  ledger: Record<string, unknown>,
  state: ProReviewReturnState,
  returnPatch: Record<string, unknown>
): Promise<void> {
  const updatedAt = new Date().toISOString();
  const ret = requireRecord(ledger.return, "ledger.return");
  await writeFileAtomic(ledgerPath, `${JSON.stringify({
    ...ledger,
    state,
    updatedAt,
    return: {
      ...ret,
      ...returnPatch,
      state
    }
  }, null, 2)}\n`);
}

function returnAttempts(ledger: Record<string, unknown>): Array<Record<string, unknown>> {
  const ret = requireRecord(ledger.return, "ledger.return");
  const attempts = ret.attempts;
  if (attempts === undefined) return [];
  if (!Array.isArray(attempts)) {
    throw new ProReviewReturnError("ledger.return.attempts must be an array.");
  }
  return attempts.map((attempt, index) => requireRecord(attempt, `ledger.return.attempts[${index}]`));
}

function selectAttempt(ledger: Record<string, unknown>, attemptId: string | undefined): Record<string, unknown> {
  const attempts = returnAttempts(ledger);
  const selected = attemptId === undefined
    ? attempts.at(-1)
    : attempts.find(attempt => attempt.attemptId === attemptId);
  if (selected === undefined) {
    throw new ProReviewReturnError("send attempt was not found in ledger.");
  }
  return selected;
}

function replaceAttempt(ledger: Record<string, unknown>, updatedAttempt: Record<string, unknown>): Array<Record<string, unknown>> {
  const attemptId = requireText(updatedAttempt.attemptId, "attempt.attemptId");
  return returnAttempts(ledger).map(attempt => attempt.attemptId === attemptId ? updatedAttempt : attempt);
}

function requireUnexpiredLease(attempt: Record<string, unknown>): void {
  const leaseExpiresAt = requireText(attempt.leaseExpiresAt, "attempt.leaseExpiresAt");
  const expiry = Date.parse(leaseExpiresAt);
  if (!Number.isFinite(expiry)) {
    throw new ProReviewReturnError("attempt.leaseExpiresAt must be a valid timestamp.");
  }
  if (Date.now() > expiry) {
    throw new ProReviewReturnError("send reservation lease has expired.");
  }
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new ProReviewReturnError(`Missing value for ${flag}.\n\n${PRO_REVIEW_RETURN_USAGE}`);
  }
  return value;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProReviewReturnError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProReviewReturnError(`${field} must be a non-empty string.`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireText(value, field);
}

function requireJsonEquivalent(actual: unknown, expected: unknown, field: string): void {
  if (!jsonEquivalent(actual, expected)) {
    throw new ProReviewReturnError(`${field} did not match metadata.`);
  }
}

function jsonEquivalent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonEquivalent(item, b[index]));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord).filter(key => aRecord[key] !== undefined).sort();
    const bKeys = Object.keys(bRecord).filter(key => bRecord[key] !== undefined).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key, index) => key === bKeys[index] && jsonEquivalent(aRecord[key], bRecord[key]));
  }
  return false;
}

function requireEquals(actual: unknown, expected: unknown, field: string): void {
  if (actual !== expected) {
    throw new ProReviewReturnError(`${field} did not match expected value.`);
  }
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function writeFileAtomic(path: string, payload: string): Promise<void> {
  const tempPath = `${path}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await writeFile(tempPath, payload, "utf8");
  await rename(tempPath, path);
}

function firstText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function isDirectRun(): boolean {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isDirectRun()) {
  process.exitCode = await main();
}
