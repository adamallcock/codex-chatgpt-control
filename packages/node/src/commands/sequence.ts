import type { CommandResult, RuntimeEnv, SequencePlan, SequencePolicy, SequenceStep, SequenceStepResult } from "../types.js";
import { attachFiles, downloadLatestFile } from "./files.js";
import { askMessage, composeMessage, readLatest, submitMessage, waitAndRead, waitForMessage } from "./messages.js";
import { copyResponse } from "./response-actions.js";
import { bootstrap } from "./session.js";
import { newThread, openThread, searchThreads } from "./threads.js";
import { setMode, selectTool } from "./modes.js";
import { withCommandOutputText } from "./output.js";

export type SequenceExecutor = (
  step: SequenceStep,
  env: RuntimeEnv,
  previousResults: Map<string, CommandResult<unknown>>,
  policy: SequencePolicy
) => Promise<CommandResult<unknown>>;

export const defaultSequencePolicy: SequencePolicy = {
  stopOnError: true,
  returnPartial: true,
  defaultTimeoutMs: 120000,
  screenshotOnBlocker: true,
  allowPromptResubmit: "only_if_no_matching_user_turn"
};

export async function runSequence(
  plan: SequencePlan,
  env: RuntimeEnv = {}
): Promise<CommandResult<unknown>> {
  return runSequenceWithExecutor(plan, executeStep, env);
}

export async function runSequenceWithExecutor(
  plan: SequencePlan,
  executor: SequenceExecutor,
  env: RuntimeEnv = {}
): Promise<CommandResult<unknown>> {
  const policy = normalizePolicy(plan.policy);
  const stepResults: SequenceStepResult[] = [];
  const values = new Map<string, CommandResult<unknown>>();
  const input = plan.input ?? {};

  for (const step of plan.steps) {
    const startedAt = new Date().toISOString();
    const resolvedStep = resolveStepArgs(step, values, input);
    const result = await executor(resolvedStep, env, values, policy);
    values.set(step.id, result);
    stepResults.push(toStepResult(step, result, startedAt));

    if (!result.ok && policy.stopOnError) {
      return sequenceFailure(result, values, stepResults, policy);
    }
  }

  const lastStep = plan.steps.at(-1);
  const finalResult = lastStep === undefined ? okSequenceResult(values, stepResults) : values.get(lastStep.id);
  if (finalResult === undefined) {
    return okSequenceResult(values, stepResults);
  }
  return withCommandOutputText({ ...finalResult, steps: stepResults });
}

export async function executeStep(
  step: SequenceStep,
  env: RuntimeEnv,
  previousResults: Map<string, CommandResult<unknown>>
): Promise<CommandResult<unknown>> {
  switch (step.command) {
    case "session.bootstrap":
      return bootstrap(env, step.args);
    case "threads.search":
      return searchThreads(env, step.args);
    case "threads.open":
      return openThread(env, step.args, previousResults);
    case "threads.new":
      return newThread(env, step.args);
    case "messages.compose":
      return composeMessage(env, step.args);
    case "messages.submit":
      return submitMessage(env, step.args);
    case "messages.ask":
      return askMessage(env, step.args);
    case "messages.wait":
      return waitForMessage(env, step.args);
    case "messages.readLatest":
      return readLatest(env, step.args);
    case "messages.waitAndRead":
      return waitAndRead(env, step.args);
    case "files.attach":
      return attachFiles(env, step.args);
    case "files.downloadLatest":
      return downloadLatestFile(env, step.args);
    case "response.copy":
      return copyResponse(env, step.args);
    case "modes.set":
      return setMode(env, step.args);
    case "tools.select":
      return selectTool(env, step.args);
  }
}

export function normalizePolicy(policy: Partial<SequencePolicy> | undefined): SequencePolicy {
  return { ...defaultSequencePolicy, ...(policy ?? {}) };
}

export function resolveStepArgs(
  step: SequenceStep,
  previousResults: Map<string, CommandResult<unknown>>,
  input: Record<string, unknown> = {}
): SequenceStep {
  if (!("args" in step) || step.args === undefined) {
    return step;
  }

  return {
    ...step,
    args: resolveValue(step.args, previousResults, input)
  } as SequenceStep;
}

export function resolveVariableReference(
  reference: string,
  previousResults: Map<string, CommandResult<unknown>>,
  input: Record<string, unknown> = {}
): unknown {
  const match = /^\$\{([^}]+)\}$/.exec(reference);
  if (match === null) {
    return reference;
  }

  const path = match[1];
  if (path === undefined || path.length === 0) {
    throw new Error("Empty variable reference is not allowed.");
  }

  if (path.includes("__proto__") || path.includes("prototype") || path.includes("constructor")) {
    throw new Error(`Unsafe variable reference rejected: ${path}`);
  }

  const [root, ...segments] = tokenizePath(path);
  let current: unknown;
  if (root === "input") {
    current = input;
  } else if (root !== undefined && previousResults.has(root)) {
    current = previousResults.get(root);
  } else {
    throw new Error(`Unknown variable root: ${root ?? ""}`);
  }

  for (const segment of segments) {
    current = readPathSegment(current, segment);
  }

  return current;
}

function resolveValue<T>(value: T, previousResults: Map<string, CommandResult<unknown>>, input: Record<string, unknown>): T {
  if (typeof value === "string") {
    return resolveVariableReference(value, previousResults, input) as T;
  }

  if (Array.isArray(value)) {
    return value.map(item => resolveValue(item, previousResults, input)) as T;
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, resolveValue(child, previousResults, input)])
    ) as T;
  }

  return value;
}

function tokenizePath(path: string): string[] {
  const segments: string[] = [];
  for (const part of path.split(".")) {
    const head = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(part)?.[1];
    if (head === undefined) {
      throw new Error(`Invalid variable path segment: ${part}`);
    }
    segments.push(head);
    for (const indexMatch of part.matchAll(/\[(\d+)\]/g)) {
      segments.push(indexMatch[1]!);
    }
    const consumed = `${head}${Array.from(part.matchAll(/\[(\d+)\]/g)).map(match => `[${match[1]}]`).join("")}`;
    if (consumed !== part) {
      throw new Error(`Invalid variable path segment: ${part}`);
    }
  }
  return segments;
}

function readPathSegment(value: unknown, segment: string): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const index = Number(segment);
    if (!Number.isInteger(index)) {
      throw new Error(`Array segment must be numeric: ${segment}`);
    }
    return value[index];
  }

  if (typeof value === "object") {
    return (value as Record<string, unknown>)[segment];
  }

  return undefined;
}

function toStepResult(step: SequenceStep, result: CommandResult<unknown>, startedAt: string): SequenceStepResult {
  const stepResult: SequenceStepResult = {
    id: step.id,
    command: step.command,
    status: result.status,
    ok: result.ok,
    startedAt,
    endedAt: new Date().toISOString(),
    warnings: result.warnings
  };

  const dataPreview = previewData(result.data);
  if (dataPreview !== undefined) {
    stepResult.dataPreview = dataPreview;
  }

  return stepResult;
}

function previewData(data: unknown): unknown {
  if (data === undefined) {
    return undefined;
  }
  if (typeof data === "string") {
    return data.length > 120 ? `${data.slice(0, 119)}...` : data;
  }
  if (Array.isArray(data)) {
    return { type: "array", length: data.length };
  }
  if (typeof data === "object" && data !== null) {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([key, value]) => {
        if (/text|prompt|response/i.test(key) && typeof value === "string") {
          return [key, value.length > 120 ? `${value.slice(0, 119)}...` : value];
        }
        return [key, value];
      })
    );
  }
  return data;
}

function sequenceFailure(
  result: CommandResult<unknown>,
  values: Map<string, CommandResult<unknown>>,
  stepResults: SequenceStepResult[],
  policy: SequencePolicy
): CommandResult<unknown> {
  const failure: CommandResult<unknown> = {
    ok: false,
    status: policy.returnPartial ? "partial" : result.status,
    data: collectSequenceData(values),
    warnings: collectWarnings(stepResults, result.warnings),
    context: result.context,
    steps: stepResults
  };
  if (result.error !== undefined) {
    failure.error = result.error;
  }
  if (result.blocker !== undefined) {
    failure.blocker = result.blocker;
  }
  return withCommandOutputText(failure);
}

function okSequenceResult(
  values: Map<string, CommandResult<unknown>>,
  stepResults: SequenceStepResult[]
): CommandResult<unknown> {
  return withCommandOutputText({
    ok: true,
    status: "ok",
    data: collectSequenceData(values),
    warnings: collectWarnings(stepResults),
    context: { timestamp: new Date().toISOString() },
    steps: stepResults
  });
}

function collectSequenceData(values: Map<string, CommandResult<unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Array.from(values.entries()).map(([id, result]) => [id, result.data])
  );
}

function collectWarnings(stepResults: SequenceStepResult[], extra: string[] = []): string[] {
  return [...stepResults.flatMap(step => step.warnings), ...extra];
}
