import { createHash } from "node:crypto";
import { readPageState, type PageState } from "../browser/page-state.js";
import { resultError, resultOk } from "../errors.js";
import { EMPTY_GENERATION_STATE, latestAssistantTurnHasResponseActions, readAssistantGenerationState, type AssistantGenerationState } from "../dom/generation-state.js";
import { countPageMessages, isTransientAssistantText, readLatestMessage, readLatestMessageText, readLatestMessageTextSnapshot, readMessages } from "../dom/messages.js";
import { composerTextbox, copyResponseButtons, sendButton } from "../dom/selectors.js";
import { readWaitDomSnapshot, waitTextMetadata, type WaitDomSnapshot } from "../dom/wait-snapshot.js";
import { normalizeLineBreaks, normalizeWhitespace } from "../dom/visible-text.js";
import type {
  AskArgs,
  AskReadData,
  CommandResult,
  ComposeArgs,
  ComposeData,
  PageLike,
  ReadLatestArgs,
  ReadLatestData,
  RuntimeEnv,
  SubmitArgs,
  SubmitData,
  WaitAndReadArgs,
  WaitArgs,
  WaitData
} from "../types.js";
import { contextFromPage } from "./context.js";
import { createDeadline } from "./deadline.js";
import { withCommandOutputText } from "./output.js";
import { createSingleFlightProbe, type ProbeResult } from "./probes.js";
import { bootstrap } from "./session.js";

export type CompletionSnapshot = {
  textStableForMs: number;
  stableMs: number;
  generation: AssistantGenerationState;
  hasResponseActions: boolean;
  latestText: string;
};

type AssistantProgressSnapshot = {
  latestText?: string;
  turnCount?: number;
  assistantTurnCount: number;
  latestAssistantTurnIndex?: number;
};

type SendButtonState = {
  available: boolean;
  visible?: boolean;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  reason?: string;
};

export function isResponseComplete(snapshot: CompletionSnapshot): boolean {
  return snapshot.latestText.trim().length > 0
    && !isTransientAssistantText(snapshot.latestText)
    && snapshot.textStableForMs >= snapshot.stableMs
    && !snapshot.generation.active
    && !snapshot.generation.stopped
    && snapshot.hasResponseActions;
}

export async function composeMessage(
  env: RuntimeEnv,
  args: ComposeArgs
): Promise<CommandResult<ComposeData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<ComposeData>;
  }

  const page = env.page!;

  try {
    const textbox = composerTextbox(page);
    const text = args.mode === "append"
      ? `${await readLocatorText(textbox)}${args.text}`
      : args.text;

    await textbox.click?.();
    await textbox.fill?.(text);
    const actual = normalizeWhitespace(await readLocatorText(textbox));
    const wanted = normalizeWhitespace(text);

    if (actual !== wanted && actual.length > 0) {
      return {
        ok: false,
        status: "error",
        warnings: [],
        error: {
          name: "ComposerVerificationError",
          message: "Composer text did not match the requested prompt after fill.",
          recoverable: true
        },
        context: await contextFromPage(page)
      };
    }

    return resultOk({ text }, await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

export async function submitMessage(
  env: RuntimeEnv,
  args: SubmitArgs = {}
): Promise<CommandResult<SubmitData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<SubmitData>;
  }

  const page = env.page!;
  const previousTurnCount = args.previousTurnCount ?? await countPageMessages(page).catch(() => undefined);

  try {
    const ready = await waitForSendButtonReady(page, args.timeoutMs ?? 30000);
    if (!ready.ready) {
      const blocker: NonNullable<CommandResult<SubmitData>["blocker"]> = {
        kind: ready.code === "attachment_processing" ? "upload_failed" : "selector_drift",
        code: ready.code,
        message: ready.message,
        remediation: [
          {
            label: "Wait for composer",
            instruction: "Wait for ChatGPT's composer and attachments to become ready, then retry without manually changing the page.",
            userActionRequired: false
          }
        ],
        resumable: true
      };
      if (ready.visibleText !== undefined) {
        blocker.visibleText = ready.visibleText;
      }
      return {
        ok: false,
        status: "blocked",
        warnings: [],
        blocker,
        context: await contextFromPage(page)
      };
    }

    const timeoutMs = args.timeoutMs ?? 30000;
    const startedAt = Date.now();
    await clickSendControl(page);

    let userTurn = await waitForSubmittedUserTurn(
      page,
      args.text,
      previousTurnCount,
      initialSubmitWaitMs(timeoutMs)
    );
    if (userTurn === undefined && Date.now() - startedAt < timeoutMs && await shouldRetryNoopSubmit(page, args.text)) {
      await sleep(page, 250);
      await clickSendControl(page);
      userTurn = await waitForSubmittedUserTurn(
        page,
        args.text,
        previousTurnCount,
        Math.max(0, timeoutMs - (Date.now() - startedAt))
      );
    }

    if (userTurn === undefined) {
      const latestUser = await readLatestMessage(page, "user", "normalized_text");
      if (submittedUserTurnMatches(latestUser?.text, args.text)) {
        return resultOk(
          submitData(latestUser?.text, await countPageMessages(page).catch(() => undefined)),
          await contextFromPage(page)
        );
      }

      return {
        ok: false,
        status: "timeout",
        warnings: await sendTimeoutWarnings(page),
        error: {
          name: "SubmitTimeout",
          message: "No matching submitted user turn appeared before the timeout.",
          recoverable: true
        },
        context: await contextFromPage(page)
      };
    }

    return resultOk(
      submitData(userTurn, await countPageMessages(page).catch(() => undefined)),
      await contextFromPage(page)
    );
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

async function clickSendControl(page: PageLike): Promise<void> {
  try {
    await sendButton(page).click?.();
  } catch {
    await page.keyboard?.press?.("Enter");
  }
}

function initialSubmitWaitMs(timeoutMs: number): number {
  return Math.min(3000, Math.max(500, Math.floor(timeoutMs / 3)));
}

async function shouldRetryNoopSubmit(page: PageLike, text: string | undefined): Promise<boolean> {
  const state = await readSendButtonState(page).catch(() => ({ available: false } satisfies SendButtonState));
  if (!isSendButtonReady(state)) {
    return false;
  }
  if (text === undefined) {
    return true;
  }
  const composerText = await readLocatorText(composerTextbox(page)).catch(() => "");
  return submittedUserTurnMatches(composerText, text);
}

async function waitForSendButtonReady(
  page: PageLike,
  timeoutMs: number
): Promise<
  | { ready: true }
  | { ready: false; code: "attachment_processing" | "send_button_not_ready"; message: string; visibleText?: string }
> {
  const started = Date.now();
  let lastState: SendButtonState | undefined;
  let lastVisibleText: string | undefined;

  while (Date.now() - started < timeoutMs) {
    const state = await readSendButtonState(page).catch(() => ({ available: true } satisfies SendButtonState));
    lastState = state;
    if (isSendButtonReady(state)) {
      return { ready: true };
    }

    const visibleText = await readVisibleTextForSubmit(page).catch(() => undefined);
    if (visibleText !== undefined && /uploading|processing|attaching|preparing|reading|scanning/i.test(visibleText)) {
      lastVisibleText = visibleText.slice(0, 500);
    }
    await sleep(page, 250);
  }

  if (lastVisibleText !== undefined) {
    return {
      ready: false,
      code: "attachment_processing",
      message: "ChatGPT still appears to be processing an attachment, so the send button did not become ready.",
      visibleText: lastVisibleText
    };
  }

  return {
    ready: false,
    code: "send_button_not_ready",
    message: `ChatGPT's send button did not become ready before timeout.${describeSendState(lastState)}`
  };
}

function isSendButtonReady(state: SendButtonState): boolean {
  if (!state.available) return false;
  if (state.visible === false) return false;
  if (state.disabled === true) return false;
  if (state.busy === true) return false;
  return true;
}

async function readSendButtonState(page: PageLike): Promise<SendButtonState> {
  const locator = sendButton(page);
  if (typeof locator.count === "function" && await locator.count().catch(() => 1) === 0) {
    return { available: false, reason: "not_found" };
  }
  const visible = typeof locator.isVisible === "function" ? await locator.isVisible({ timeoutMs: 500 }).catch(() => undefined) : undefined;
  if (typeof locator.evaluate !== "function") {
    const state: SendButtonState = { available: true };
    if (visible !== undefined) state.visible = visible;
    return state;
  }

  const evaluated = await locator.evaluate(element => {
    const htmlElement = element as HTMLElement;
    const button = element as HTMLButtonElement;
    return {
      disabled: button.disabled === true
        || element.getAttribute("disabled") !== null
        || element.getAttribute("aria-disabled") === "true"
        || element.getAttribute("data-disabled") === "true",
      busy: element.getAttribute("aria-busy") === "true"
        || htmlElement.className.toString().toLocaleLowerCase().includes("loading"),
      label: element.getAttribute("aria-label")
        ?? element.getAttribute("title")
        ?? htmlElement.innerText
        ?? element.textContent
        ?? undefined
    };
  });

  const state: SendButtonState = {
    available: true,
    disabled: evaluated.disabled,
    busy: evaluated.busy
  };
  if (visible !== undefined) state.visible = visible;
  if (evaluated.label !== undefined) state.label = evaluated.label;
  return state;
}

async function readVisibleTextForSubmit(page: PageLike): Promise<string | undefined> {
  if (typeof page.evaluate !== "function") {
    return undefined;
  }
  // Attachment/upload status renders inside the composer form; prefer that region over
  // the whole page so the not-ready poll does not serialize the full document text.
  return page.evaluate(() => {
    const composerForm = document.querySelector("main form") ?? document.querySelector("form");
    const scopedText = (composerForm as HTMLElement | null)?.innerText;
    if (scopedText !== undefined && scopedText.trim().length > 0) {
      return scopedText;
    }
    return document.body?.innerText ?? "";
  });
}

async function sendTimeoutWarnings(page: PageLike): Promise<string[]> {
  const state = await readSendButtonState(page).catch(() => undefined);
  if (state === undefined || isSendButtonReady(state)) {
    return [];
  }
  return [`Send button state after submit timeout:${describeSendState(state)}`];
}

function describeSendState(state: SendButtonState | undefined): string {
  if (state === undefined) return "";
  const parts: string[] = [];
  if (!state.available) parts.push("available=false");
  if (state.visible !== undefined) parts.push(`visible=${state.visible}`);
  if (state.disabled !== undefined) parts.push(`disabled=${state.disabled}`);
  if (state.busy !== undefined) parts.push(`busy=${state.busy}`);
  if (state.label !== undefined && state.label.trim().length > 0) parts.push(`label=${JSON.stringify(state.label.trim().slice(0, 80))}`);
  if (state.reason !== undefined) parts.push(`reason=${state.reason}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

export async function waitForMessage(
  env: RuntimeEnv,
  args: WaitArgs = {}
): Promise<CommandResult<WaitData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<WaitData>;
  }

  const page = env.page!;
  const timeoutMs = args.timeoutMs ?? (args.mode === "deep_research" ? 1_800_000 : 120_000);
  const stableMs = args.stableMs ?? (args.mode === "deep_research" ? 10_000 : 2_000);
  const pollMs = args.pollMs ?? 750;
  const started = Date.now();
  const deadline = createDeadline(timeoutMs, started);
  const probeTimeoutMs = Math.max(50, Math.min(1000, Math.max(pollMs, Math.floor(timeoutMs / 4))));
  const waitWarnings = new Set<string>();
  // One combined DOM probe per poll: counts, latest-text metadata, generation state, and
  // response actions come back in a single evaluate, sampled from the same DOM instant.
  // The full assistant text never crosses the bridge during polling; it is fetched once
  // at loop exit. Page-state blocker scans run on a coarser cadence below.
  const waitSnapshotProbe = createSingleFlightProbe("wait snapshot", readWaitDomSnapshot);
  const pageStateProbe = createSingleFlightProbe("page state", readPageState);
  const PAGE_STATE_POLL_STRIDE = 4;
  let pollIndex = 0;
  let lastTargetKey = "";
  let lastChangedAt = Date.now();
  let lastObservedTextLength = 0;
  let latestAssistantCount = await countPageMessages(page, "assistant").catch(() => 0);

  while (Date.now() - started < timeoutMs) {
    const probeResult = await waitSnapshotProbe(page, deadline, { timeoutMs: probeTimeoutMs });
    addWarnings(waitWarnings, probeResult.warnings);
    const snapshot = await waitSnapshotFromProbeResult(page, probeResult, latestAssistantCount);
    latestAssistantCount = snapshot.assistantTurnCount;
    const targetReached = waitTargetReached(args, snapshot);
    const targetKey = targetReached && snapshot.text.length > 0
      ? `${snapshot.text.length}:${snapshot.text.hash}`
      : "";

    if (targetKey !== lastTargetKey) {
      lastTargetKey = targetKey;
      lastChangedAt = Date.now();
    }
    if (targetReached && snapshot.text.length > 0) {
      lastObservedTextLength = snapshot.text.length;
    }

    if (pollIndex % PAGE_STATE_POLL_STRIDE === 0) {
      const state = await pageStateFromProbe(pageStateProbe(page, deadline, { timeoutMs: probeTimeoutMs }), waitWarnings);
      if (state?.blocker !== undefined && state.blocker.kind !== "modal") {
        return {
          ok: false,
          status: "blocked",
          warnings: [...waitWarnings],
          blocker: state.blocker,
          context: await contextFromPage(page)
        };
      }
    }
    pollIndex += 1;

    const hasResponseActions = await resolveResponseActions(page, snapshot);

    if (targetReached && snapshot.generation.stopped && snapshot.text.length > 0) {
      const stoppedText = normalizeWhitespace(await fetchLatestAssistantText(page) ?? "");
      // A failed re-read must not fabricate an empty capture: real text was observed in
      // the snapshot, so omit response content entirely and tell the caller how to get it.
      const data = stoppedText.length > 0
        ? waitDataFromText(args, false, stoppedText, latestAssistantCount, Date.now() - started)
        : waitDataWithoutText(latestAssistantCount, Date.now() - started);
      if (stoppedText.length === 0) {
        waitWarnings.add(`The interrupted assistant text (~${snapshot.text.length} chars observed) could not be re-read at wait exit; call messages.readLatest on the same thread to capture it.`);
      }
      return withCommandOutputText({
        ok: false,
        status: "partial",
        data,
        warnings: [
          ...waitWarnings,
          ...(stoppedText.length > 0 ? responseContentWarnings(args, false) : []),
          "ChatGPT generation appears to have been stopped or interrupted before completion.",
          ...snapshot.generation.signals.map(signal => `Generation state signal: ${signal}`)
        ],
        context: await contextFromPage(page)
      } satisfies CommandResult<WaitData>);
    }

    const metadataComplete = targetReached
      && snapshot.text.length > 0
      && !snapshot.text.transient
      && Date.now() - lastChangedAt >= stableMs
      && !snapshot.generation.active
      && !snapshot.generation.stopped
      && hasResponseActions;

    if (metadataComplete) {
      // Fetch the text once and confirm it still matches the stable snapshot before
      // declaring completion; a hash mismatch means the answer moved on mid-fetch.
      const latestText = normalizeWhitespace(await fetchLatestAssistantText(page) ?? "");
      const fetchedMetadata = waitTextMetadata(latestText);
      const completionSnapshot: CompletionSnapshot = {
        latestText,
        stableMs,
        textStableForMs: Date.now() - lastChangedAt,
        generation: snapshot.generation,
        hasResponseActions
      };
      if (fetchedMetadata.hash === snapshot.text.hash && isResponseComplete(completionSnapshot)) {
        const data = waitDataFromText(args, true, latestText, latestAssistantCount, Date.now() - started);
        return withCommandOutputText(resultOk(
          data,
          await contextFromPage(page),
          [...waitWarnings, ...responseContentWarnings(args, true)]
        ));
      }
      if (latestText.length > 0) {
        lastTargetKey = `${fetchedMetadata.length}:${fetchedMetadata.hash}`;
        lastChangedAt = Date.now();
        lastObservedTextLength = fetchedMetadata.length;
      }
    }

    await sleep(page, pollMs);
  }

  if (lastObservedTextLength > 0) {
    const partialText = await fetchLatestAssistantText(page);
    if (partialText !== undefined && normalizeWhitespace(partialText).length > 0) {
      const data = waitDataFromText(args, false, normalizeWhitespace(partialText), latestAssistantCount, Date.now() - started);
      return withCommandOutputText({
        ok: false,
        status: "partial",
        data,
        warnings: [...waitWarnings, ...responseContentWarnings(args, false), "Timed out after receiving partial assistant text."],
        context: await contextFromPage(page)
      } satisfies CommandResult<WaitData>);
    }
    waitWarnings.add(`Partial assistant text (${lastObservedTextLength} chars) was observed during polling but could not be re-read at wait exit.`);
  }

  return {
    ok: false,
    status: "timeout",
    warnings: [...waitWarnings],
    error: {
      name: "WaitTimeout",
      message: "No assistant response appeared before the timeout.",
      recoverable: true
    },
    context: await contextFromPage(page)
  };
}

async function fetchLatestAssistantText(page: PageLike): Promise<string | undefined> {
  const first = await readLatestMessageText(page, "assistant").catch(() => undefined);
  if (first !== undefined) {
    return first;
  }
  // One retry: exit-time reads race DOM reflow/navigation, and a transient failure here
  // would otherwise discard an answer the polling snapshots proved exists.
  await sleep(page, 150);
  return readLatestMessageText(page, "assistant").catch(() => undefined);
}

function waitDataWithoutText(assistantTurnCount: number, elapsedMs: number): WaitData {
  return { complete: false, assistantTurnCount, elapsedMs };
}

async function resolveResponseActions(page: PageLike, snapshot: WaitDomSnapshot): Promise<boolean> {
  if (snapshot.hasResponseActions !== undefined) {
    return snapshot.hasResponseActions;
  }
  // No conversation-turn markers: fall back to the structural copy-button locator, as
  // the standalone response-actions probe does.
  try {
    const copyButtons = copyResponseButtons(page);
    const count = await copyButtons.count?.();
    if (count !== undefined) {
      return count > 0;
    }
    return await copyButtons.isVisible?.() === true;
  } catch {
    return false;
  }
}

async function waitSnapshotFromProbeResult(
  page: PageLike,
  result: ProbeResult<WaitDomSnapshot | undefined>,
  previousAssistantTurnCount: number
): Promise<WaitDomSnapshot> {
  if (result.ok && result.value !== undefined) {
    return result.value;
  }
  if (!result.ok && (result.timedOut === true || result.skipped === true)) {
    return {
      turnCount: 0,
      assistantTurnCount: previousAssistantTurnCount,
      text: waitTextMetadata(""),
      generation: EMPTY_GENERATION_STATE,
      hasResponseActions: false
    };
  }
  return fallbackWaitSnapshot(page, previousAssistantTurnCount);
}

/**
 * Degraded snapshot for pages where the combined evaluate is unavailable or failed.
 * Reuses the standalone facet probes, which carry their own content/locator fallbacks;
 * text metadata is computed SDK-side from the extracted text.
 */
async function fallbackWaitSnapshot(page: PageLike, previousAssistantTurnCount: number): Promise<WaitDomSnapshot> {
  const progress = await fallbackAssistantProgressSnapshot(page, previousAssistantTurnCount);
  const generation = await readAssistantGenerationState(page).catch(() => EMPTY_GENERATION_STATE);
  const hasResponseActions = await latestAssistantTurnHasResponseActions(page).catch(() => false);
  const snapshot: WaitDomSnapshot = {
    turnCount: progress.turnCount ?? 0,
    assistantTurnCount: progress.assistantTurnCount,
    text: waitTextMetadata(progress.latestText),
    generation,
    hasResponseActions
  };
  if (progress.latestAssistantTurnIndex !== undefined) {
    snapshot.latestAssistantTurnIndex = progress.latestAssistantTurnIndex;
  }
  return snapshot;
}

function waitDataFromText(
  args: WaitArgs,
  complete: boolean,
  responseText: string,
  assistantTurnCount: number,
  elapsedMs: number
): WaitData {
  const data: WaitData = {
    complete,
    assistantTurnCount,
    elapsedMs
  };

  if (args.responseContent === "metadata") {
    data.responseContent = "metadata";
    data.responseChars = responseText.length;
    data.responseSha256 = createHash("sha256").update(responseText).digest("hex");
    return data;
  }

  data.responseText = responseText;
  return data;
}

function responseContentWarnings(args: WaitArgs, complete: boolean): string[] {
  if (args.responseContent !== "metadata") return [];
  return [
    complete
      ? "Assistant response text was omitted because responseContent is metadata; call readLatest to capture the completed answer."
      : "Partial assistant text was omitted because responseContent is metadata; call wait again on the same thread or readLatest after completion."
  ];
}

async function pageStateFromProbe(
  probe: Promise<ProbeResult<PageState>>,
  warnings: Set<string>
): Promise<PageState | undefined> {
  const result = await probe;
  addWarnings(warnings, result.warnings);
  return result.ok ? result.value : undefined;
}

function addWarnings(target: Set<string>, warnings: readonly string[]): void {
  for (const warning of warnings) {
    target.add(warning);
  }
}

export async function readLatest(
  env: RuntimeEnv,
  args: ReadLatestArgs = {}
): Promise<CommandResult<ReadLatestData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<ReadLatestData>;
  }

  const page = env.page!;
  const role = args.role ?? "assistant";
  const format = args.format ?? "markdown";
  const latest = await readLatestMessage(page, role, format, args.maxChars);

  if (latest === undefined) {
    return {
      ok: false,
      status: "not_found",
      warnings: [],
      blocker: {
        kind: "not_found",
        message: `No ${role} message is currently loaded.`
      },
      context: await contextFromPage(page)
    };
  }

  const data: ReadLatestData = { role, text: latest.text, format: latest.format };
  if (latest.source !== undefined) data.source = latest.source;
  if (latest.fidelity !== undefined) data.fidelity = latest.fidelity;
  if (latest.captureLimit !== undefined) data.captureLimit = latest.captureLimit;
  if (latest.warnings !== undefined) data.warnings = latest.warnings;
  if (latest.markdown !== undefined) data.markdown = latest.markdown;
  if (latest.visibleText !== undefined) data.visibleText = latest.visibleText;
  if (latest.normalizedText !== undefined) data.normalizedText = latest.normalizedText;
  if (latest.html !== undefined) data.html = latest.html;
  if (latest.blocks !== undefined) data.blocks = latest.blocks;
  if (latest.citations !== undefined) data.citations = latest.citations;
  if (latest.codeBlocks !== undefined) data.codeBlocks = latest.codeBlocks;
  if (latest.tables !== undefined) data.tables = latest.tables;
  if (latest.branch !== undefined) data.branch = latest.branch;
  if (latest.actions !== undefined) data.actions = latest.actions;
  if (latest.thoughtDurationText !== undefined) data.thoughtDurationText = latest.thoughtDurationText;
  if (latest.sourcesAvailable !== undefined) data.sourcesAvailable = latest.sourcesAvailable;

  return withCommandOutputText(resultOk(data, await contextFromPage(page), data.warnings ?? []));
}

export async function askMessage(
  env: RuntimeEnv,
  args: AskArgs
): Promise<CommandResult<AskReadData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<AskReadData>;
  }

  const page = env.page!;
  const beforeTurnCount = await countPageMessages(page).catch(() => undefined);
  const beforeAssistantTurnCount = await countPageMessages(page, "assistant").catch(() => undefined);
  const composeArgs: ComposeArgs = { text: args.text, mode: "replace" };
  if (args.timeoutMs !== undefined) {
    composeArgs.timeoutMs = args.timeoutMs;
  }
  const compose = await composeMessage(env, composeArgs);
  if (!compose.ok) {
    return forwardFailure(compose);
  }

  const submitArgs: SubmitArgs = { text: args.text };
  if (beforeTurnCount !== undefined) {
    submitArgs.previousTurnCount = beforeTurnCount;
  }
  if (args.timeoutMs !== undefined) {
    submitArgs.timeoutMs = args.timeoutMs;
  }
  const submit = await submitMessage(env, submitArgs);
  if (!submit.ok) {
    return forwardFailure(submit);
  }

  const readRequested = args.read === true || typeof args.read === "object";
  let waitResult: CommandResult<WaitData> | undefined;
  let waitFailure: CommandResult<WaitData> | undefined;
  if (args.wait === true || typeof args.wait === "object") {
    const waitArgs: WaitArgs = typeof args.wait === "object" ? { ...args.wait } : {};
    if (beforeTurnCount !== undefined) {
      waitArgs.afterTurnCount = beforeTurnCount;
    }
    if (beforeAssistantTurnCount !== undefined) {
      waitArgs.afterAssistantTurnCount = beforeAssistantTurnCount;
    }
    waitResult = await waitForMessage(env, waitArgs);
    if (!waitResult.ok) {
      if (waitResult.status === "partial") {
        waitFailure = waitResult;
      } else {
        if (!readRequested || readRole(args.read) === "user") {
          return forwardFailure(waitResult);
        }
        waitFailure = waitResult;
      }
    }
  }

  let responseText = waitResult?.data?.responseText;
  const warnings: string[] = [];
  if (readRequested) {
    const read = await readLatest(env, typeof args.read === "object" ? args.read : {});
    if (read.ok) {
      if (waitFailure !== undefined && !readCapturedNewAssistantTurn(read, beforeTurnCount, beforeAssistantTurnCount)) {
        return forwardFailure(waitFailure);
      }
      responseText = read.data?.text;
      warnings.push(...read.warnings);
      if (waitFailure !== undefined) {
        warnings.push(
          ...waitFailure.warnings,
          `Assistant response was read after ${waitFailure.status}, but completion was not confirmed by the wait step.`
        );
      }
    } else if (responseText === undefined) {
      return forwardFailure(waitFailure ?? read);
    }
  }

  if (waitFailure !== undefined && responseText === undefined) {
    return forwardFailure(waitFailure);
  }

  const state = await readPageState(page).catch(() => undefined);
  const data: AskReadData = { prompt: args.text };
  const complete = waitResult?.data?.complete ?? (waitResult === undefined ? undefined : false);
  if (complete !== undefined) {
    data.complete = complete;
  }
  if (responseText !== undefined) {
    data.responseText = responseText;
  }
  if (state?.conversationId !== undefined) {
    data.conversationId = state.conversationId;
  }
  if (state?.title !== undefined) {
    data.title = state.title;
  }

  if (waitFailure !== undefined) {
    data.complete = false;
    return withCommandOutputText({
      ok: false,
      status: "partial",
      data,
      warnings: [
        ...warnings,
        `Assistant response was read after ${waitFailure.status}, but completion was not confirmed.`
      ],
      context: await contextFromPage(page)
    } satisfies CommandResult<AskReadData>);
  }

  return withCommandOutputText(resultOk(data, await contextFromPage(page), warnings));
}

export async function waitAndRead(
  env: RuntimeEnv,
  args: WaitAndReadArgs = {}
): Promise<CommandResult<AskReadData>> {
  const wait = await waitForMessage(env, args);
  if (!wait.ok && wait.status !== "partial") {
    return forwardFailure(wait);
  }

  const read = await readLatest(env, args);
  if (!read.ok) {
    if (wait.data?.responseText !== undefined) {
      return withCommandOutputText({
        ok: wait.ok,
        status: wait.status,
        data: {
          prompt: "",
          responseText: wait.data.responseText,
          complete: wait.data.complete
        },
        warnings: wait.warnings,
        context: wait.context
      });
    }
    return forwardFailure(read);
  }

  const data = askReadData("", read.data?.text, wait.data?.complete);
  const warnings = [...read.warnings, ...wait.warnings];
  if (!wait.ok && wait.status === "partial") {
    data.complete = false;
    return withCommandOutputText({
      ok: false,
      status: "partial",
      data,
      warnings: [
        ...warnings,
        "Assistant response was read after partial wait, but completion was not confirmed."
      ],
      context: read.context
    } satisfies CommandResult<AskReadData>);
  }

  return withCommandOutputText(resultOk(data, read.context, warnings));
}

async function ensurePage(env: RuntimeEnv): Promise<CommandResult<unknown>> {
  if (env.page !== undefined) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
}

async function waitForSubmittedUserTurn(
  page: PageLike,
  text: string | undefined,
  previousTurnCount: number | undefined,
  timeoutMs: number
): Promise<string | undefined> {
  const started = Date.now();
  const wanted = text === undefined ? undefined : normalizeWhitespace(text);

  while (Date.now() - started < timeoutMs) {
    const snapshot = await readLatestMessageTextSnapshot(page, "user").catch(() => undefined);
    const latestText = snapshot?.latestText;
    const turnCount = snapshot?.turnCount;
    const countIncreased = previousTurnCount === undefined || (turnCount !== undefined && turnCount > previousTurnCount);
    const latestMatches = submittedUserTurnMatches(latestText, wanted);

    if (latestText !== undefined && countIncreased && latestMatches) {
      return latestText;
    }

    await sleep(page, 250);
  }

  return undefined;
}

export function submittedUserTurnMatches(actual: string | undefined, wanted: string | undefined): boolean {
  if (wanted === undefined) {
    return actual !== undefined && normalizeWhitespace(actual).length > 0;
  }

  const normalizedActual = normalizeWhitespace(actual ?? "");
  const normalizedWanted = normalizeWhitespace(wanted);
  if (normalizedActual === normalizedWanted || normalizedActual.includes(normalizedWanted)) {
    return true;
  }

  const renderedActual = normalizeSubmittedTurnRenderedText(actual ?? "");
  const renderedWanted = normalizeSubmittedTurnRenderedText(wanted);
  if (renderedActual === renderedWanted || renderedActual.includes(renderedWanted)) {
    return true;
  }

  const structuralActual = normalizeSubmittedTurnText(actual ?? "");
  const structuralWanted = normalizeSubmittedTurnText(wanted);
  if (structuralActual === structuralWanted || structuralActual.includes(structuralWanted)) {
    return true;
  }

  const structuralActualWithoutLanguage = normalizeSubmittedTurnText(actual ?? "", false);
  const structuralWantedWithoutLanguage = normalizeSubmittedTurnText(wanted, false);
  return structuralActualWithoutLanguage === structuralWantedWithoutLanguage
    || structuralActualWithoutLanguage.includes(structuralWantedWithoutLanguage);
}

function normalizeSubmittedTurnRenderedText(text: string): string {
  return normalizeWhitespace(renderSubmittedTurnMarkdownSyntax(text));
}

function normalizeSubmittedTurnText(text: string, preserveFenceLanguage = true): string {
  return normalizeWhitespace(
    renderSubmittedTurnMarkdownSyntax(text, preserveFenceLanguage)
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/\|/g, " ")
      .replace(/(?:^|\s)-{3,}(?:\s|$)/g, " ")
  );
}

function renderSubmittedTurnMarkdownSyntax(text: string, preserveFenceLanguage = true): string {
  return normalizeLineBreaks(text)
    .replace(/```[ \t]*([a-z0-9_+#.-]+)?/gi, (_match, language: string | undefined) => language && preserveFenceLanguage ? `\n${language}\n` : "\n")
    .replace(/~~~[ \t]*([a-z0-9_+#.-]+)?/gi, (_match, language: string | undefined) => language && preserveFenceLanguage ? `\n${language}\n` : "\n")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

async function fallbackAssistantProgressSnapshot(
  page: PageLike,
  previousAssistantTurnCount: number
): Promise<AssistantProgressSnapshot> {
  const messages = await readMessages(page, { format: "normalized_text" }).catch(() => undefined);
  if (messages !== undefined) {
    let latestAssistantTurnIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") {
        latestAssistantTurnIndex = index;
        break;
      }
    }
    const assistantMessages = messages.filter(message => message.role === "assistant");
    const snapshot: AssistantProgressSnapshot = {
      turnCount: messages.length,
      assistantTurnCount: assistantMessages.length
    };
    const latestAssistant = latestAssistantTurnIndex === -1 ? undefined : messages[latestAssistantTurnIndex];
    if (latestAssistant?.text !== undefined) snapshot.latestText = latestAssistant.text;
    if (latestAssistantTurnIndex !== -1) snapshot.latestAssistantTurnIndex = latestAssistantTurnIndex + 1;
    return snapshot;
  }

  const snapshot: AssistantProgressSnapshot = {
    assistantTurnCount: await countPageMessages(page, "assistant").catch(() => previousAssistantTurnCount)
  };
  const latestText = await readLatestMessageText(page, "assistant").catch(() => undefined);
  const turnCount = await countPageMessages(page).catch(() => undefined);
  if (latestText !== undefined) snapshot.latestText = latestText;
  if (turnCount !== undefined) snapshot.turnCount = turnCount;
  return snapshot;
}

function waitTargetReached(
  args: WaitArgs,
  snapshot: { assistantTurnCount: number; turnCount?: number; latestAssistantTurnIndex?: number }
): boolean {
  const assistantTargetReached = args.afterAssistantTurnCount === undefined
    || snapshot.assistantTurnCount > args.afterAssistantTurnCount;
  const turnTargetReached = args.afterTurnCount === undefined
    || (snapshot.latestAssistantTurnIndex !== undefined
      ? snapshot.latestAssistantTurnIndex > args.afterTurnCount
      : snapshot.turnCount !== undefined && snapshot.turnCount > args.afterTurnCount);
  return assistantTargetReached && turnTargetReached;
}

async function readLocatorText(locator: { innerText?: () => Promise<string>; textContent?: () => Promise<string | null> }): Promise<string> {
  if (typeof locator.innerText === "function") {
    return locator.innerText().catch(() => "");
  }
  if (typeof locator.textContent === "function") {
    return locator.textContent().then(text => text ?? "").catch(() => "");
  }
  return "";
}

async function sleep(page: PageLike, ms: number): Promise<void> {
  if (typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(ms);
    return;
  }
  await new Promise(resolve => setTimeout(resolve, ms));
}

function submitData(userTurnText: string | undefined, turnCount: number | undefined): SubmitData {
  const data: SubmitData = { submitted: true };
  if (userTurnText !== undefined) {
    data.userTurnText = userTurnText;
  }
  if (turnCount !== undefined) {
    data.turnCount = turnCount;
  }
  return data;
}

function askReadData(prompt: string, responseText: string | undefined, complete: boolean | undefined): AskReadData {
  const data: AskReadData = { prompt };
  if (responseText !== undefined) {
    data.responseText = responseText;
  }
  if (complete !== undefined) {
    data.complete = complete;
  }
  return data;
}

function readRole(read: AskArgs["read"]): ReadLatestArgs["role"] | undefined {
  return typeof read === "object" ? read.role : undefined;
}

function readCapturedNewAssistantTurn(
  read: CommandResult<ReadLatestData>,
  beforeTurnCount: number | undefined,
  beforeAssistantTurnCount: number | undefined
): boolean {
  const assistantAdvanced = beforeAssistantTurnCount === undefined
    || (read.context.assistantTurnCount !== undefined && read.context.assistantTurnCount > beforeAssistantTurnCount);
  const turnAdvanced = beforeTurnCount === undefined
    || (read.context.turnCount !== undefined && read.context.turnCount > beforeTurnCount);
  return assistantAdvanced && turnAdvanced;
}

function forwardFailure<T>(result: CommandResult<unknown>): CommandResult<T> {
  const forwarded: CommandResult<T> = {
    ok: false,
    status: result.status,
    warnings: result.warnings,
    context: result.context
  };
  if (result.error !== undefined) {
    forwarded.error = result.error;
  }
  if (result.blocker !== undefined) {
    forwarded.blocker = result.blocker;
  }
  if (result.steps !== undefined) {
    forwarded.steps = result.steps;
  }
  return forwarded;
}
