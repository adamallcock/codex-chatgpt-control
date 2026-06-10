import type { RunReportOptions } from "../commands/reports.js";
import { renderUntrustedOutputReturnEnvelope } from "../safety/untrusted-output.js";
import type { BootstrapArgs, ResponseFormat } from "../types.js";
import type {
  ChatGPTAttachmentInput,
  ChatGPTInputItem,
  ChatGPTResponse,
  ChatGPTRunInput,
  ChatGPTRunResult,
  ChatGPTThreadSelector,
  ChatGPTVisibleModePreference,
  ChatGPTVisibleToolPreference,
  UnsupportedField
} from "./types.js";

const acceptedTopLevelFields = new Set([
  "input",
  "thread",
  "existingTab",
  "preferExistingTab",
  "attachments",
  "mode",
  "tools",
  "text",
  "stream",
  "report",
  "instructions",
  "instructionsMode"
]);

const unsupportedAlternatives: Record<string, string> = {
  model: "Use mode for visible ChatGPT UI mode preference. This does not select an API model.",
  temperature: "No browser-control equivalent. ChatGPT web does not expose API temperature.",
  top_p: "No browser-control equivalent. ChatGPT web does not expose API nucleus sampling.",
  seed: "No browser-control equivalent. Visible ChatGPT web does not expose deterministic API seeds.",
  logprobs: "No browser-control equivalent. Visible ChatGPT web does not expose token log probabilities.",
  top_logprobs: "No browser-control equivalent. Visible ChatGPT web does not expose token log probabilities.",
  previous_response_id: "Use thread: { type: \"conversationId\", conversationId } or a ChatGPT thread URL.",
  store: "No browser-control equivalent. Use visible ChatGPT settings or temporary chat controls when implemented.",
  service_tier: "No browser-control equivalent. Visible ChatGPT web does not expose API service tiers.",
  max_output_tokens: "Use response.maxChars/read maxChars for capture limits. This does not control model generation.",
  parallel_tool_calls: "No browser-control equivalent. Visible ChatGPT browser control selects visible tools sequentially.",
  truncation: "No browser-control equivalent. Use prompt design and response capture limits instead."
};

const responseFormats = new Set<ResponseFormat>([
  "markdown",
  "text",
  "normalized_text",
  "visible_text",
  "html",
  "blocks",
  "all"
]);

export type ChatGPTResponsesCreateArgs = {
  input: string | ChatGPTInputItem[];
  thread?: ChatGPTThreadSelector;
  existingTab?: BootstrapArgs["existingTab"];
  preferExistingTab?: boolean;
  attachments?: ChatGPTAttachmentInput[];
  mode?: ChatGPTVisibleModePreference;
  tools?: ChatGPTVisibleToolPreference[];
  text?: { format?: ResponseFormat };
  stream?: false;
  report?: boolean | RunReportOptions;
  instructions?: string;
  instructionsMode?: "visible_prefix";
};

export type ResponsesValidationResult =
  | { ok: true; unsupported: [] }
  | { ok: false; unsupported: UnsupportedField[] };

export function validateResponsesCreateArgs(args: Record<string, unknown>): ResponsesValidationResult {
  const unsupported: UnsupportedField[] = [];

  for (const [path, alternative] of Object.entries(unsupportedAlternatives)) {
    if (args[path] !== undefined) {
      unsupported.push(apiOnlyField(path, alternative));
    }
  }

  for (const path of Object.keys(args)) {
    if (!acceptedTopLevelFields.has(path) && unsupportedAlternatives[path] === undefined) {
      unsupported.push({
        path,
        reason: "This field is not part of the narrow ChatGPT browser-control Responses adapter.",
        alternative: "Use chatgpt.runner.run(...) for lower-level browser-control options."
      });
    }
  }

  if (args.input === undefined) {
    unsupported.push({
      path: "input",
      reason: "Responses adapter calls must include visible input text or input items.",
      alternative: "Provide input: \"your visible prompt\"."
    });
  }

  if (args.stream !== undefined && args.stream !== false) {
    unsupported.push({
      path: "stream",
      reason: "This adapter stage supports only non-streaming calls.",
      alternative: "Set stream: false, or use the runner milestone stream when enabled."
    });
  }

  if (args.instructions !== undefined && args.instructionsMode !== "visible_prefix") {
    unsupported.push({
      path: "instructions",
      reason: "Responses API instructions are hidden context, but ChatGPT browser control can only submit visible text.",
      alternative: "Set instructionsMode: \"visible_prefix\" to send instructions visibly."
    });
  }

  if (args.instructionsMode !== undefined && args.instructionsMode !== "visible_prefix") {
    unsupported.push({
      path: "instructionsMode",
      reason: "Only explicit visible-prefix instructions are supported by this adapter.",
      alternative: "Use instructionsMode: \"visible_prefix\" or omit instructionsMode."
    });
  }

  if (isRecord(args.text)) {
    const format = args.text.format;
    if (format !== undefined && (typeof format !== "string" || !responseFormats.has(format as ResponseFormat))) {
      unsupported.push({
        path: "text.format",
        reason: "The requested response text format is not supported by ChatGPT browser-control capture.",
        alternative: "Use markdown, visible_text, normalized_text, html, blocks, or all."
      });
    }
    for (const path of Object.keys(args.text)) {
      if (path !== "format") {
        unsupported.push({
          path: `text.${path}`,
          reason: "Only text.format is supported by the narrow Responses adapter.",
          alternative: "Use chatgpt.runner.run(...) for lower-level browser-control options."
        });
      }
    }
  }

  return unsupported.length === 0 ? { ok: true, unsupported: [] } : { ok: false, unsupported };
}

export function responsesCreateArgsToRunInput(args: ChatGPTResponsesCreateArgs): ChatGPTRunInput {
  const runInput: Exclude<ChatGPTRunInput, string> = {
    input: args.input,
    response: { format: args.text?.format ?? "markdown" }
  };
  if (args.thread !== undefined) runInput.thread = args.thread;
  if (args.existingTab !== undefined) runInput.existingTab = args.existingTab;
  if (args.preferExistingTab !== undefined) runInput.preferExistingTab = args.preferExistingTab;
  if (args.attachments !== undefined) runInput.attachments = args.attachments;
  if (args.mode !== undefined) runInput.mode = args.mode;
  if (args.tools !== undefined) runInput.tools = args.tools;
  if (args.report !== undefined) runInput.report = args.report;
  return runInput;
}

export function responseFromRunResult<TOutput>(
  result: ChatGPTRunResult<TOutput>,
  now: Date = new Date()
): ChatGPTResponse {
  const id = responseId(now);
  const browserControl: ChatGPTResponse["browser_control"] = {
    visibleUi: true,
    resultStatus: result.status
  };
  if (result.data?.thread !== undefined) browserControl.thread = result.data.thread;
  const reportPath = result.data?.reportPath ?? result.reportPath;
  if (reportPath !== undefined) browserControl.reportPath = reportPath;
  if (result.output_text.length > 0) {
    const envelopeArgs: Parameters<typeof renderUntrustedOutputReturnEnvelope>[0] = {
      outputText: result.output_text,
      source: "chatgpt",
      capturedAt: now.toISOString(),
      metadata: {
        response_id: id,
        result_status: result.status,
        report_path: reportPath
      }
    };
    if (reportPath !== undefined) envelopeArgs.outputPath = reportPath;
    browserControl.untrustedOutput = renderUntrustedOutputReturnEnvelope(envelopeArgs);
  }

  return {
    id,
    object: "chatgpt.browser.response",
    created_at: Math.floor(now.getTime() / 1000),
    status: result.status,
    output_text: result.output_text,
    output: result.output,
    browser_control: browserControl
  };
}

export function unsupportedResponse(unsupported: UnsupportedField[], now: Date = new Date()): ChatGPTResponse {
  return {
    id: responseId(now),
    object: "chatgpt.browser.response",
    created_at: Math.floor(now.getTime() / 1000),
    status: "unsupported",
    output_text: "",
    output: [],
    browser_control: {
      visibleUi: true,
      resultStatus: "unsupported",
      unsupported
    }
  };
}

function apiOnlyField(path: string, alternative: string): UnsupportedField {
  return {
    path,
    reason: "This is an OpenAI API field that visible ChatGPT browser control cannot honestly support.",
    alternative
  };
}

function responseId(now: Date): string {
  return `chatgpt-browser-${now.getTime().toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
