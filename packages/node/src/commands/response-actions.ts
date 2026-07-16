import { readSystemClipboard, waitForClipboardChange } from "../browser/clipboard.js";
import { readAssistantGenerationState } from "../dom/generation-state.js";
import { formatClipboardMarkdown, normalizeResponseFormat } from "../dom/message-format.js";
import { resultError, resultOk } from "../errors.js";
import { readLatestMessage, readMessages, type ExtractedMessage } from "../dom/messages.js";
import { copyResponseButtons } from "../dom/selectors.js";
import type { CommandResult, CopiedResponse, CopyResponseArgs, PageLike, RuntimeEnv } from "../types.js";
import { contextFromPage } from "./context.js";
import { withCommandOutputText } from "./output.js";
import { ensurePage } from "./session.js";

export async function copyResponse(
  env: RuntimeEnv,
  args: CopyResponseArgs = {}
): Promise<CommandResult<CopiedResponse>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<CopiedResponse>;
  }

  const page = env.page!;

  try {
    if (isLatestSelection(args.which)) {
      const generation = await readAssistantGenerationState(page);
      if (generation.active || generation.stopped) {
        const latest = await readSelectedAssistantMessage(page, args.which, args.format ?? "markdown").catch(() => undefined);
        const warning = generation.active
          ? "Response is still generating; copied content may be partial."
          : "Response appears to have been stopped before completion; copied content may be partial.";
        const fallbackReason = generation.active
          ? "Response is still generating; returned DOM-derived partial content."
          : "Response appears to have been stopped before completion; returned DOM-derived partial content.";
        const data = latest === undefined ? undefined : copiedResponseFromExtracted(latest, "dom", fallbackReason);
        const result: CommandResult<CopiedResponse> = {
          ok: false,
          status: "partial",
          warnings: [
            warning,
            ...generation.signals.map(signal => `Generation state signal: ${signal}`)
          ],
          context: await contextFromPage(page)
        };
        if (data !== undefined) result.data = data;
        return withCommandOutputText(result);
      }
    }

    if (args.prefer !== "dom") {
      const before = await readClipboard(env);
      const buttons = copyResponseButtons(page);
      const target = args.which === undefined || args.which === "latest"
        ? buttons.last?.() ?? buttons
        : buttons.nth?.(args.which.assistantIndex) ?? buttons;

      await target.click?.();
      const copied = await waitForClipboard(env, before, args.timeoutMs ?? 3000);
      if (copied !== undefined) {
        const requestedFormat = normalizeResponseFormat(args.format);
        if (requestedFormat === "html" || requestedFormat === "blocks" || requestedFormat === "all") {
          const latest = await readSelectedAssistantMessage(page, args.which, requestedFormat);
          if (latest !== undefined) {
            const fallbackReason = `Clipboard copy succeeded, but ${formatLabel(requestedFormat)} requires DOM extraction.`;
            const data = copiedResponseFromExtracted(latest, "dom", fallbackReason);
            data.markdown = formatClipboardMarkdown(copied).markdown ?? copied;
            data.warnings = [...(data.warnings ?? []), fallbackReason];
            return withCommandOutputText(resultOk(data, await contextFromPage(page), data.warnings));
          }

          const warning = `Clipboard copy succeeded, but ${formatLabel(requestedFormat)} requires DOM extraction and no assistant DOM message was available; returned clipboard Markdown instead.`;
          const data: CopiedResponse = {
            ...formatClipboardMarkdown(copied, undefined, "markdown"),
            source: "clipboard",
            fallbackReason: warning,
            warnings: [warning]
          };
          return withCommandOutputText(resultOk(data, await contextFromPage(page), [warning]));
        }

        const metadata = await readSelectedAssistantMessage(page, args.which, "markdown").catch(() => undefined);
        const data: CopiedResponse = {
          ...formatClipboardMarkdown(copied, undefined, args.format),
          source: "clipboard"
        };
        mergeResponseMetadata(data, metadata);
        return withCommandOutputText(resultOk(
          data,
          await contextFromPage(page)
        ));
      }
    }

    const latest = await readSelectedAssistantMessage(page, args.which, args.format ?? "markdown");
    if (latest !== undefined) {
      const fallbackReason = args.prefer === "dom"
        ? `Returned DOM-derived ${formatLabel(latest.format)} because clipboard copy was not requested.`
        : "System clipboard did not change; returned DOM-derived response content.";
      const data = copiedResponseFromExtracted(latest, "dom", fallbackReason);
      return withCommandOutputText(resultOk(
        data,
        await contextFromPage(page),
        data.warnings ?? [fallbackReason]
      ));
    }

    return {
      ok: false,
      status: "not_found",
      warnings: [],
      blocker: {
        kind: "not_found",
        message: "No assistant response was available to copy."
      },
      context: await contextFromPage(page)
    };
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

function isLatestSelection(which: CopyResponseArgs["which"]): boolean {
  return which === undefined || which === "latest";
}

function readClipboard(env: RuntimeEnv): Promise<string | undefined> {
  return env.clipboard?.read() ?? readSystemClipboard();
}

function waitForClipboard(env: RuntimeEnv, before: string | undefined, timeoutMs: number): Promise<string | undefined> {
  return env.clipboard?.waitForChange(before, timeoutMs) ?? waitForClipboardChange(before, timeoutMs);
}

async function readSelectedAssistantMessage(
  page: PageLike,
  which: CopyResponseArgs["which"],
  format: CopyResponseArgs["format"] = "markdown"
): Promise<ExtractedMessage | undefined> {
  if (which === undefined || which === "latest") {
    return readLatestMessage(page, "assistant", format);
  }

  const messages = await readMessages(page, { role: "assistant", format });
  return messages.at(which.assistantIndex);
}

function formatLabel(format: string): string {
  return format === "markdown" ? "Markdown" : format.replaceAll("_", " ");
}

function copiedResponseFromExtracted(
  latest: ExtractedMessage,
  source: CopiedResponse["source"],
  fallbackReason?: string
): CopiedResponse {
  const data: CopiedResponse = {
    text: latest.text,
    format: latest.format,
    source
  };
  if (latest.fidelity !== undefined) data.fidelity = latest.fidelity;
  if (latest.captureLimit !== undefined) data.captureLimit = latest.captureLimit;
  if (latest.warnings !== undefined || fallbackReason !== undefined) {
    data.warnings = [...(latest.warnings ?? []), ...(fallbackReason === undefined ? [] : [fallbackReason])];
  }
  if (fallbackReason !== undefined) data.fallbackReason = fallbackReason;
  mergeResponseMetadata(data, latest);
  return data;
}

function mergeResponseMetadata(
  data: CopiedResponse,
  latest: ExtractedMessage | undefined
): void {
  if (latest === undefined) return;
  if (latest.markdown !== undefined && data.markdown === undefined) data.markdown = latest.markdown;
  if (latest.captureLimit !== undefined) data.captureLimit = latest.captureLimit;
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
}
