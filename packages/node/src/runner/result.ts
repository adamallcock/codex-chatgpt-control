import type { CommandResult } from "../types.js";
import { renderUntrustedOutputReturnEnvelope } from "../safety/untrusted-output.js";
import { interruptionFromCommandResult } from "./interruptions.js";
import { augmentCommandBlocker } from "./resume.js";
import type { ChatGPTAgent, ChatGPTRunData, ChatGPTRunItem, ChatGPTRunResult } from "./types.js";

export function toRunResult<TOutput>(
  agent: ChatGPTAgent<TOutput>,
  result: CommandResult<unknown>
): ChatGPTRunResult<TOutput> {
  const outputText = extractOutputText(result.data);
  const finalOutput = parseFinalOutput(agent, outputText);
  const interruption = interruptionFromCommandResult(result, failedCommand(result));
  const interruptions = interruption === undefined ? [] : [interruption];
  const output = runItemsFromResult(result, outputText);
  const state = runStateFromResult(result, interruptions);
  const data: ChatGPTRunData<TOutput> = { outputText };
  if (outputText.length > 0) {
    const envelopeArgs: Parameters<typeof renderUntrustedOutputReturnEnvelope>[0] = {
      outputText,
      source: "chatgpt",
      capturedAt: result.context.timestamp,
      metadata: {
        result_status: result.status,
        report_path: result.reportPath
      }
    };
    if (result.reportPath !== undefined) envelopeArgs.outputPath = result.reportPath;
    data.untrustedOutput = renderUntrustedOutputReturnEnvelope(envelopeArgs);
  }
  if (finalOutput !== undefined) data.finalOutput = finalOutput;
  const thread = threadRefFromContext(result.context);
  if (thread !== undefined) data.thread = thread;
  if (result.reportPath !== undefined) data.reportPath = result.reportPath;

  const mapped: ChatGPTRunResult<TOutput> = {
    ...result,
    data,
    output_text: outputText,
    output,
    newItems: output,
    interruptions,
    state,
    activeAgentName: agent.name,
    lastAgentName: agent.name
  };
  if (finalOutput !== undefined) mapped.finalOutput = finalOutput;
  return mapped;
}

function extractOutputText(data: unknown): string {
  if (!isRecord(data)) return "";
  if (typeof data.responseText === "string") return data.responseText;
  if (typeof data.text === "string") return data.text;
  for (const value of Object.values(data)) {
    const nested = extractOutputText(value);
    if (nested.length > 0) return nested;
  }
  return "";
}

function parseFinalOutput<TOutput>(agent: ChatGPTAgent<TOutput>, outputText: string): TOutput | undefined {
  if (outputText.length === 0) return undefined;
  if (agent.output?.parse === "json") {
    try {
      return JSON.parse(outputText) as TOutput;
    } catch {
      return agent.output.onParseError === "return_text" ? outputText as TOutput : undefined;
    }
  }
  return outputText as TOutput;
}

function runItemsFromResult(result: CommandResult<unknown>, outputText: string): ChatGPTRunItem[] {
  const items = messageItemsFromData(result.data);
  if (!items.some(item => item.type === "message.completed") && outputText.length > 0) {
    items.push({ type: "message.completed", role: "assistant", output_text: outputText, format: "markdown" });
  }
  if (result.blocker !== undefined) {
    items.push({ type: "run.blocked", blocker: augmentCommandBlocker(result.blocker) });
  }
  return items;
}

function messageItemsFromData(data: unknown): ChatGPTRunItem[] {
  if (!isRecord(data)) return [];
  const items: ChatGPTRunItem[] = [];
  if (typeof data.prompt === "string" && data.prompt.length > 0) {
    items.push({
      type: "message.submitted",
      role: "user",
      preview: data.prompt.length > 160 ? `${data.prompt.slice(0, 159)}...` : data.prompt,
      redacted: true
    });
  }
  if (typeof data.responseText === "string" && data.responseText.length > 0) {
    items.push({ type: "message.completed", role: "assistant", output_text: data.responseText, format: "markdown" });
  }
  if (items.length > 0) return items;

  for (const value of Object.values(data)) {
    const nested = messageItemsFromData(value);
    if (nested.length > 0) return nested;
  }
  return [];
}

function runStateFromResult(
  result: CommandResult<unknown>,
  interruptions: ChatGPTRunResult["interruptions"]
): ChatGPTRunResult["state"] {
  const resumable = interruptions.some(interruption => interruption.resume.supported);
  const firstResume = interruptions.find(interruption => interruption.resume.supported)?.resume;
  const state: ChatGPTRunResult["state"] = {
    id: firstResume?.supported === true && firstResume.stateId !== undefined ? firstResume.stateId : `run_${Date.now().toString(36)}`,
    resumable
  };
  const thread = threadRefFromContext(result.context);
  if (thread !== undefined) state.thread = thread;
  return state;
}

function threadRefFromContext(context: CommandResult["context"]): ChatGPTRunData["thread"] {
  const thread: NonNullable<ChatGPTRunData["thread"]> = {};
  if (context.url !== undefined) thread.url = context.url;
  if (context.conversationId !== undefined) thread.conversationId = context.conversationId;
  if (context.title !== undefined) thread.title = context.title;
  return Object.keys(thread).length === 0 ? undefined : thread;
}

function failedCommand(result: CommandResult<unknown>): string | undefined {
  if (result.steps === undefined) return undefined;
  for (let index = result.steps.length - 1; index >= 0; index -= 1) {
    const step = result.steps[index];
    if (step?.ok === false) return step.command;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
