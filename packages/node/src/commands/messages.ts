import { createHash } from "node:crypto";
import { readPageState } from "../browser/page-state.js";
import { withTimeout } from "../browser/evaluate.js";
import { resultError, resultOk } from "../errors.js";
import { countPageMessages, isTransientAssistantText, readLatestMessage, readLatestMessageText, readLatestMessageTextSnapshot, readMessages } from "../dom/messages.js";
import { composerTextbox, copyResponseButtons, sendButton } from "../dom/selectors.js";
import { normalizeLineBreaks, normalizePromptForHash, normalizeWhitespace } from "../dom/visible-text.js";
import type {
  AskArgs,
  AskReadData,
  CommandResult,
  ComposeArgs,
  ComposeData,
  InspectComposerArgs,
  InspectComposerData,
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
import { verifyAttachedFiles } from "./files.js";
import { withCommandOutputText } from "./output.js";
import { assertChatGPTHost, bootstrap } from "./session.js";
import { assertTemporaryChatVerifiedOn } from "./temporary.js";

export type CompletionSnapshot = {
  textStableForMs: number;
  stableMs: number;
  hasStopButton: boolean;
  hasResponseActions: boolean;
  latestText: string;
};

type AssistantProgressSnapshot = {
  latestText?: string;
  turnCount?: number;
  assistantTurnCount: number;
  latestAssistantTurnIndex?: number;
};

export function isResponseComplete(snapshot: CompletionSnapshot): boolean {
  return snapshot.latestText.trim().length > 0
    && !isTransientAssistantText(snapshot.latestText)
    && snapshot.textStableForMs >= snapshot.stableMs
    && !snapshot.hasStopButton
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

export async function inspectComposer(
  env: RuntimeEnv,
  args: InspectComposerArgs = {}
): Promise<CommandResult<InspectComposerData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<InspectComposerData>;
  }

  const page = env.page!;

  try {
    const text = normalizeLineBreaks(await readLocatorText(composerTextbox(page)));
    const sha256 = sha256Text(normalizePromptForHash(text));
    const sendState = await waitForSendButtonReady(page);
    const data: InspectComposerData = {
      text,
      sha256,
      length: text.length,
      sendButtonCount: sendState.count,
      sendButtonEnabled: sendState.enabled
    };

    const expectedSha256 = args.expectedSha256 ?? (args.expectedText === undefined ? undefined : sha256Text(normalizePromptForHash(args.expectedText)));
    if (expectedSha256 !== undefined) {
      data.matchesExpected = sha256 === expectedSha256;
      if (!data.matchesExpected) {
        return {
          ok: false,
          status: "blocked",
          warnings: [],
          data,
          blocker: {
            kind: "confirmation",
            code: "composer_prompt_mismatch",
            message: "Composer text does not match the expected prompt hash.",
            resumable: true
          },
          context: await contextFromPage(page)
        };
      }
    }

    if (sendState.count !== 1 || !sendState.enabled) {
      return {
        ok: false,
        status: "blocked",
        warnings: [],
        data,
        blocker: {
          kind: "selector_drift",
          code: "send_button_not_unique_enabled",
          message: "Send button must be unique and enabled before safe submission.",
          resumable: true
        },
        context: await contextFromPage(page)
      };
    }

    return resultOk(data, await contextFromPage(page));
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

  try {
    const preflight = await assertSubmitPreconditions(env, args);
    if (preflight !== undefined) {
      return preflight as CommandResult<SubmitData>;
    }

    const previousTurnCount = args.previousTurnCount ?? await countPageMessages(page).catch(() => undefined);
    const target = sendButton(page);
    try {
      if (typeof target.click !== "function") {
        throw new Error("Send button locator does not expose click().");
      }
      await withTimeout(
        target.click({ timeoutMs: 10000 }),
        12000,
        "Timed out clicking send button."
      );
    } catch {
      if (args.submitMode === "buttonOnly") {
        const clickedByLocator = await clickSendButtonByLocatorEvaluate(target).catch(() => false);
        const clickedByDom = clickedByLocator ? true : await clickUniqueSendButtonByDom(page).catch(() => false);
        if (!clickedByDom) {
          throw new Error("Send button click failed and submitMode=buttonOnly forbids Enter fallback.");
        }
      } else {
        await page.keyboard?.press?.("Enter");
      }
    }

    const userTurn = await waitForSubmittedUserTurn(page, args.text, previousTurnCount, args.timeoutMs ?? 30000);
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
        warnings: [],
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

async function assertSubmitPreconditions(
  env: RuntimeEnv,
  args: SubmitArgs
): Promise<CommandResult<unknown> | undefined> {
  if (args.requireChatGPTHost === true) {
    const host = await assertChatGPTHost(env);
    if (!host.ok) return host;
  }

  if (args.requireTemporary === true) {
    const temporary = await assertTemporaryChatVerifiedOn(env);
    if (!temporary.ok) return temporary;
  }

  if (args.expectedAttachmentName !== undefined) {
    const attachmentArgs: Parameters<typeof verifyAttachedFiles>[1] = {
      expectedName: args.expectedAttachmentName
    };
    if (args.expectedAttachmentBytes !== undefined) attachmentArgs.expectedBytes = args.expectedAttachmentBytes;
    if (args.expectedAttachmentSha256 !== undefined) attachmentArgs.expectedSha256 = args.expectedAttachmentSha256;
    if (args.expectedAttachmentPath !== undefined) attachmentArgs.expectedPath = args.expectedAttachmentPath;
    const attachment = await verifyAttachedFiles(env, attachmentArgs);
    if (!attachment.ok) return attachment;
  }

  if (args.expectedPromptSha256 !== undefined) {
    const composer = await inspectComposer(env, { expectedSha256: args.expectedPromptSha256 });
    if (!composer.ok) return composer;
  }

  return undefined;
}

async function clickSendButtonByLocatorEvaluate(locator: ReturnType<typeof sendButton>): Promise<boolean> {
  if (typeof locator.evaluate !== "function") {
    return false;
  }
  const count = await locator.count?.().catch(() => undefined);
  if (count !== undefined && count !== 1) {
    return false;
  }
  return withTimeout(locator.evaluate(element => {
    const button = element as HTMLButtonElement;
    if (button.disabled || button.getAttribute("aria-disabled") === "true") {
      return false;
    }
    button.click();
    return true;
  }), 5000, "Timed out clicking send button by locator evaluate.");
}

async function clickUniqueSendButtonByDom(page: PageLike): Promise<boolean> {
  if (typeof page.evaluate !== "function") {
    return false;
  }
  return withTimeout(page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
      .filter(node => {
        const element = node as HTMLElement;
        const label = `${element.getAttribute("aria-label") ?? ""} ${element.innerText ?? ""} ${element.textContent ?? ""}`;
        return /send prompt|send message|\bsend\b|送信/i.test(label);
      });
    if (buttons.length !== 1) {
      return false;
    }
    const button = buttons[0] as HTMLButtonElement;
    if (button.disabled || button.getAttribute("aria-disabled") === "true") {
      return false;
    }
    button.click();
    return true;
  }), 5000, "Timed out clicking unique send button by DOM.");
}

async function readSendButtonState(page: PageLike): Promise<{ count: number; enabled: boolean }> {
  if (typeof page.evaluate === "function") {
    const state = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
        .filter(node => {
          const element = node as HTMLElement;
          const label = `${element.getAttribute("aria-label") ?? ""} ${element.innerText ?? ""} ${element.textContent ?? ""}`;
          return /send prompt|send message|\bsend\b|送信/i.test(label);
        });
      const enabled = buttons.length === 1
        && !(buttons[0] as HTMLButtonElement).disabled
        && buttons[0]?.getAttribute("aria-disabled") !== "true";
      return { count: buttons.length, enabled };
    }).catch(() => undefined);
    if (state !== undefined) return state;
  }

  const locator = sendButton(page);
  const count = await locator.count?.().catch(() => 0) ?? 0;
  return { count, enabled: count === 1 };
}

async function waitForSendButtonReady(page: PageLike): Promise<{ count: number; enabled: boolean }> {
  let state = await readSendButtonState(page);
  for (let attempt = 0; state.count === 1 && !state.enabled && attempt < 20; attempt += 1) {
    await page.waitForTimeout?.(500);
    state = await readSendButtonState(page);
  }
  return state;
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
  let lastTargetText = "";
  let lastChangedAt = Date.now();
  let latestAssistantCount = await countPageMessages(page, "assistant").catch(() => 0);

  while (Date.now() - started < timeoutMs) {
    const state = await readPageState(page).catch(() => undefined);
    if (state?.blocker !== undefined && state.blocker.kind !== "modal") {
      return {
        ok: false,
        status: "blocked",
        warnings: [],
        blocker: state.blocker,
        context: await contextFromPage(page)
      };
    }

    const progress = await readAssistantProgressSnapshot(page)
      .catch(() => fallbackAssistantProgressSnapshot(page, latestAssistantCount));
    latestAssistantCount = progress.assistantTurnCount;
    const targetReached = waitTargetReached(args, progress);
    const latestText = targetReached ? normalizeWhitespace(progress.latestText ?? "") : "";

    if (latestText !== lastTargetText) {
      lastTargetText = latestText;
      lastChangedAt = Date.now();
    }

    const snapshot: CompletionSnapshot = {
      latestText,
      stableMs,
      textStableForMs: Date.now() - lastChangedAt,
      hasStopButton: await hasStopControl(page),
      hasResponseActions: await hasLatestAssistantResponseActions(page)
    };

    if (targetReached && isResponseComplete(snapshot)) {
      return withCommandOutputText(resultOk(
        { complete: true, responseText: latestText, assistantTurnCount: latestAssistantCount, elapsedMs: Date.now() - started },
        await contextFromPage(page)
      ));
    }

    await sleep(page, pollMs);
  }

  if (lastTargetText.length > 0) {
    return withCommandOutputText({
      ok: false,
      status: "partial",
      data: {
        complete: false,
        responseText: lastTargetText,
        assistantTurnCount: latestAssistantCount,
        elapsedMs: Date.now() - started
      },
      warnings: ["Timed out after receiving partial assistant text."],
      context: await contextFromPage(page)
    } satisfies CommandResult<WaitData>);
  }

  return {
    ok: false,
    status: "timeout",
    warnings: [],
    error: {
      name: "WaitTimeout",
      message: "No assistant response appeared before the timeout.",
      recoverable: true
    },
    context: await contextFromPage(page)
  };
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
    if (!waitResult.ok && waitResult.status !== "partial") {
      if (!readRequested || readRole(args.read) === "user") {
        return forwardFailure(waitResult);
      }
      waitFailure = waitResult;
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

  return withCommandOutputText(resultOk(askReadData("", read.data?.text, wait.data?.complete), read.context, wait.warnings));
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

async function hasStopControl(page: PageLike): Promise<boolean> {
  if (typeof page.evaluate === "function") {
    return page.evaluate(() => {
      const text = document.body?.innerText ?? "";
      if (/\b(stop generating|stop streaming|cancel)\b/i.test(text)) {
        return true;
      }

      const controls = Array.from(document.querySelectorAll("button, [role='button']"));
      return controls.some(control => {
        const label = [
          control.getAttribute("aria-label"),
          control.getAttribute("title"),
          control.getAttribute("data-testid"),
          control.textContent
        ].filter(Boolean).join(" ");
        return /\b(stop|cancel)\b|停止|中止|キャンセル/i.test(label);
      });
    }).catch(() => false);
  }
  return false;
}

async function hasLatestAssistantResponseActions(page: PageLike): Promise<boolean> {
  if (typeof page.evaluate === "function") {
    const latestScoped = await page.evaluate(() => {
      const assistantNodes = Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));
      const latest = assistantNodes.at(-1) as HTMLElement | undefined;
      if (latest === undefined) {
        return undefined;
      }

      const turn = latest.closest("[data-testid^='conversation-turn'], article, [data-testid*='turn']");
      const scope = turn ?? latest.parentElement;
      if (scope === null) {
        return undefined;
      }

      const actions = Array.from(scope.querySelectorAll("button, [role='button']"));
      return actions.some(action => {
        const label = [
          action.getAttribute("data-testid"),
          action.getAttribute("aria-label"),
          action.getAttribute("title"),
          action.textContent
        ].filter(Boolean).join(" ");
        return /copy-turn-action-button|Copy response|回答をコピー|応答をコピー|レスポンスをコピー/i.test(label);
      });
    }).catch(() => undefined);
    if (typeof latestScoped === "boolean") {
      return latestScoped;
    }
  }

  try {
    const copyButtons = copyResponseButtons(page);
    const count = await copyButtons.count?.();
    if (count !== undefined) {
      return count > 0;
    }
    return await copyButtons.isVisible?.() === true;
  } catch {
    if (typeof page.evaluate === "function") {
      return page.evaluate(() => /\b(Copy response|More actions)\b/i.test(document.body?.innerText ?? "")).catch(() => false);
    }
    return true;
  }
}

async function readAssistantProgressSnapshot(page: PageLike): Promise<AssistantProgressSnapshot> {
  if (typeof page.evaluate === "function") {
    return page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
      const assistantNodes = nodes.filter(node => node.getAttribute("data-message-author-role") === "assistant");
      const latestAssistant = assistantNodes.at(-1) as HTMLElement | undefined;
      const latestAssistantTurnIndex = latestAssistant === undefined ? undefined : nodes.indexOf(latestAssistant) + 1;
      const snapshot: {
        latestText?: string;
        turnCount: number;
        assistantTurnCount: number;
        latestAssistantTurnIndex?: number;
      } = {
        turnCount: nodes.length,
        assistantTurnCount: assistantNodes.length
      };

      const latestText = latestAssistant?.innerText ?? latestAssistant?.textContent ?? undefined;
      if (latestText !== undefined) snapshot.latestText = latestText;
      if (latestAssistantTurnIndex !== undefined) snapshot.latestAssistantTurnIndex = latestAssistantTurnIndex;
      return snapshot;
    });
  }

  return fallbackAssistantProgressSnapshot(page, 0);
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

function waitTargetReached(args: WaitArgs, snapshot: AssistantProgressSnapshot): boolean {
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

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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
