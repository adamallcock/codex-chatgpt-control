import type { CommandResult, CompletionState, SubmissionState } from "../types.js";
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
  const submissionState = readSubmissionState(result.data);
  const completionState = readCompletionState(result.data);
  const generationActive = readGenerationActive(result.data);
  if (submissionState !== undefined) data.submissionState = submissionState;
  if (completionState !== undefined) data.completionState = completionState;
  if (generationActive !== undefined) data.generationActive = generationActive;
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
  const items = lifecycleItemsFromSteps(result.steps);
  items.push(...messageItemsFromData(result.data));
  if (!items.some(item => item.type === "message.completed" || item.type === "message.in_progress") && outputText.length > 0) {
    if (result.status === "partial" && readCompletionState(result.data) !== "complete") {
      items.push(inProgressItem(outputText, readCompletionState(result.data), readGenerationActive(result.data)));
    } else {
      items.push({ type: "message.completed", role: "assistant", output_text: outputText, format: "markdown" });
    }
  }
  if (result.blocker !== undefined) {
    items.push({ type: "run.blocked", blocker: augmentCommandBlocker(result.blocker) });
  }
  return items;
}

function lifecycleItemsFromSteps(steps: CommandResult<unknown>["steps"]): ChatGPTRunItem[] {
  if (steps === undefined) return [];
  const items: ChatGPTRunItem[] = [];
  for (const step of steps) {
    if (!step.ok || !isRecord(step.dataPreview)) continue;
    if (step.command === "experience.open") {
      const experience = step.dataPreview.experience;
      if (experience === "chat" || experience === "work") {
        const item: Extract<ChatGPTRunItem, { type: "experience.opened" }> = {
          type: "experience.opened",
          experience
        };
        if (typeof step.dataPreview.changed === "boolean") item.changed = step.dataPreview.changed;
        items.push(item);
      }
      continue;
    }
    if (step.command === "configuration.apply") {
      const item: Extract<ChatGPTRunItem, { type: "configuration.applied" }> = {
        type: "configuration.applied"
      };
      if (isRecord(step.dataPreview.requested)) {
        item.requested = step.dataPreview.requested;
      }
      if (typeof step.dataPreview.verified === "boolean") {
        item.verified = step.dataPreview.verified;
      }
      items.push(item);
    }
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
    if (readCompletionState(data) === "complete" || data.complete === true) {
      items.push({ type: "message.completed", role: "assistant", output_text: data.responseText, format: "markdown" });
    } else {
      items.push(inProgressItem(data.responseText, readCompletionState(data), readGenerationActive(data)));
    }
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
  const submissionState = readSubmissionState(result.data);
  const completionState = readCompletionState(result.data);
  if (submissionState !== undefined) state.submissionState = submissionState;
  if (completionState !== undefined) state.completionState = completionState;
  return state;
}

function inProgressItem(
  outputText: string,
  completionState: CompletionState | undefined,
  generationActive: boolean | undefined
): ChatGPTRunItem {
  const item: ChatGPTRunItem = {
    type: "message.in_progress",
    role: "assistant",
    output_text: outputText,
    preview: outputText.length > 160 ? `${outputText.slice(0, 159)}...` : outputText,
    format: "markdown",
    textLength: outputText.length,
    textHash: hashText(outputText)
  };
  if (completionState !== undefined) item.completionState = completionState;
  if (generationActive !== undefined) item.generationActive = generationActive;
  return item;
}

function readCompletionState(data: unknown): CompletionState | undefined {
  if (!isRecord(data)) return undefined;
  const value = data.completionState;
  if (value === "complete" || value === "generating" || value === "stopped" || value === "partial" || value === "unknown") {
    return value;
  }
  for (const nested of Object.values(data)) {
    const nestedState = readCompletionState(nested);
    if (nestedState !== undefined) return nestedState;
  }
  return undefined;
}

function readSubmissionState(data: unknown): SubmissionState | undefined {
  if (!isRecord(data)) return undefined;
  const value = data.submissionState;
  if (value === "not_submitted" || value === "submitted" || value === "submitted_unconfirmed" || value === "submitted_generating") {
    return value;
  }
  for (const nested of Object.values(data)) {
    const nestedState = readSubmissionState(nested);
    if (nestedState !== undefined) return nestedState;
  }
  return undefined;
}

function readGenerationActive(data: unknown): boolean | undefined {
  if (!isRecord(data)) return undefined;
  if (typeof data.generationActive === "boolean") return data.generationActive;
  for (const nested of Object.values(data)) {
    const value = readGenerationActive(nested);
    if (value !== undefined) return value;
  }
  return undefined;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
