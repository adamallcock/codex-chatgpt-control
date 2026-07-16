import { countPageMessages } from "../dom/messages.js";
import { localeLabels } from "../dom/locale-labels.js";
import { resultError, resultOk } from "../errors.js";
import type {
  ApplyConfigurationData,
  CommandResult,
  LocatorLike,
  ReadWorkLatestArgs,
  ReadWorkLatestData,
  RuntimeEnv,
  StartWorkArgs,
  StartWorkData,
  SteerWorkArgs,
  SteerWorkData,
  WaitData,
  WorkStatusArgs,
  WorkStatusData,
  WorkTaskRef,
  WorkWaitArgs,
  WorkWaitData
} from "../types.js";
import { listLatestArtifacts } from "./artifacts.js";
import { applyConfiguration } from "./configuration.js";
import { contextFromPage } from "./context.js";
import { openExperience, detectExperience } from "./experience.js";
import { attachFiles } from "./files.js";
import {
  askMessage,
  composeMessage,
  messageStatus,
  readLatest,
  submitMessage,
  waitForMessage
} from "./messages.js";
import { ensurePage } from "./session.js";

const NEW_WORK_LABELS = localeLabels.newWork;

export async function startWork(
  env: RuntimeEnv,
  args: StartWorkArgs
): Promise<CommandResult<StartWorkData>> {
  const prompt = args.prompt.trim();
  if (prompt.length === 0) {
    return {
      ok: false,
      status: "unsupported",
      warnings: [],
      blocker: {
        kind: "selector_drift",
        code: "empty_work_prompt",
        fieldPath: "prompt",
        message: "work.start requires a non-empty visible prompt.",
        resumable: false
      },
      context: { timestamp: new Date().toISOString() }
    };
  }

  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<StartWorkData>;
  }
  const page = env.page!;

  try {
    const surface = await openExperience(env, {
      experience: "work",
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
    });
    if (!surface.ok) {
      return forwardCommandFailure(surface);
    }

    if (args.newTask !== false) {
      const fresh = await ensureBlankWorkTask(env, args.timeoutMs);
      if (!fresh.ok) {
        return forwardCommandFailure(fresh);
      }
    }

    const baselineTurnCount = await countPageMessages(page).catch(() => undefined);
    const baselineAssistantTurnCount = await countPageMessages(page, "assistant").catch(() => undefined);

    let configuration: ApplyConfigurationData | undefined;
    if (args.configuration !== undefined) {
      const applied = await applyConfiguration(env, {
        experience: "work",
        desired: args.configuration,
        strict: true,
        ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
      });
      if (!applied.ok || applied.data === undefined) {
        return forwardCommandFailure(applied);
      }
      configuration = applied.data;
    }

    if ((args.files?.length ?? 0) > 0) {
      const attach = await attachFiles(env, {
        paths: args.files ?? [],
        ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
      });
      if (!attach.ok) {
        return forwardCommandFailure(attach);
      }
    }

    const compose = await composeMessage(env, {
      text: prompt,
      mode: "replace",
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
    });
    if (!compose.ok) {
      return forwardCommandFailure(compose);
    }

    const submitArgs = {
      text: prompt,
      ...(baselineTurnCount === undefined ? {} : { previousTurnCount: baselineTurnCount }),
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
    };
    const submit = await submitMessage(env, submitArgs);
    if (!submit.ok || submit.data === undefined) {
      return forwardCommandFailure(submit);
    }

    const task = await workTaskRef(env, baselineTurnCount, baselineAssistantTurnCount);
    const data: StartWorkData = { task, submitted: submit.data };
    if (configuration !== undefined) data.configuration = configuration;

    let waitResult: CommandResult<WaitData> | undefined;
    if (args.wait === true || typeof args.wait === "object") {
      const waitArgs: WorkWaitArgs = typeof args.wait === "object" ? { ...args.wait } : {};
      if (baselineTurnCount !== undefined) waitArgs.afterTurnCount = baselineTurnCount;
      if (baselineAssistantTurnCount !== undefined) waitArgs.afterAssistantTurnCount = baselineAssistantTurnCount;
      waitResult = await waitForMessage(env, waitArgs);
      if (waitResult.data !== undefined) data.wait = waitResult.data;
      if (!waitResult.ok && waitResult.status !== "partial") {
        return forwardWorkFailure(waitResult, data);
      }
    }

    if (args.read === true || typeof args.read === "object") {
      const read = await readLatest(env, typeof args.read === "object" ? args.read : {});
      if (!read.ok || read.data === undefined) {
        return forwardWorkFailure(read, data);
      }
      data.response = read.data;
    }

    if (waitResult !== undefined && !waitResult.ok) {
      const partial: CommandResult<StartWorkData> = {
        ok: false,
        status: "partial",
        data,
        warnings: [
          ...waitResult.warnings,
          "The Work task was submitted exactly once, but completion was not verified."
        ],
        context: await workContext(env)
      };
      const outputText = data.response?.text ?? waitResult.output_text;
      if (outputText !== undefined) partial.output_text = outputText;
      return partial;
    }

    return resultOk(
      data,
      await workContext(env, surface.data?.selectorProfile),
      ["Work task submission uses matching-turn recovery and will not blindly resubmit the prompt."]
    );
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await workContext(env));
  }
}

export async function workStatus(
  env: RuntimeEnv,
  args: WorkStatusArgs = {}
): Promise<CommandResult<WorkStatusData>> {
  const ready = await requireWork(env);
  if (!ready.ok) return forwardCommandFailure(ready);

  const message = await messageStatus(env, args);
  if (!message.ok || message.data === undefined) {
    return forwardCommandFailure(message);
  }
  const data: WorkStatusData = {
    experience: "work",
    task: await workTaskRef(env, undefined, undefined),
    message: message.data
  };
  const warnings = [...message.warnings];

  if (args.includeArtifacts === true) {
    const artifacts = await listLatestArtifacts(env, {});
    if (artifacts.ok && artifacts.data !== undefined) {
      data.artifacts = artifacts.data;
      warnings.push(...artifacts.warnings);
    } else {
      warnings.push(`Work artifact status was unavailable: ${artifacts.blocker?.message ?? artifacts.error?.message ?? artifacts.status}`);
    }
  }

  return resultOk(data, {
    ...message.context,
    experience: "work",
    ...(ready.data?.selectorProfile === undefined
      ? {}
      : { selectorProfile: ready.data.selectorProfile })
  }, warnings);
}

export async function waitForWork(
  env: RuntimeEnv,
  args: WorkWaitArgs = {}
): Promise<CommandResult<WorkWaitData>> {
  const ready = await requireWork(env);
  if (!ready.ok) return forwardCommandFailure(ready);
  return markWorkResult(await waitForMessage(env, args), ready.data?.selectorProfile);
}

export async function steerWork(
  env: RuntimeEnv,
  args: SteerWorkArgs
): Promise<CommandResult<SteerWorkData>> {
  const ready = await requireWork(env);
  if (!ready.ok) return forwardCommandFailure(ready);
  return markWorkResult(await askMessage(env, {
    text: args.prompt,
    wait: args.wait ?? false,
    read: args.read ?? false,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
  }), ready.data?.selectorProfile);
}

export async function readLatestWork(
  env: RuntimeEnv,
  args: ReadWorkLatestArgs = {}
): Promise<CommandResult<ReadWorkLatestData>> {
  const ready = await requireWork(env);
  if (!ready.ok) return forwardCommandFailure(ready);
  return markWorkResult(await readLatest(env, args), ready.data?.selectorProfile);
}

async function ensureBlankWorkTask(
  env: RuntimeEnv,
  timeoutMs: number | undefined
): Promise<CommandResult<{ fresh: boolean }>> {
  const page = env.page!;
  const currentTurns = await countPageMessages(page).catch(() => 0);
  if (currentTurns === 0) {
    return resultOk({ fresh: true }, await workContext(env));
  }

  if (await clickNewWorkControl(page)) {
    const started = Date.now();
    const timeout = timeoutMs ?? 30000;
    while (Date.now() - started < timeout) {
      await page.waitForTimeout?.(150);
      if (await countPageMessages(page).catch(() => currentTurns) === 0) {
        return resultOk({ fresh: true }, await workContext(env));
      }
    }
    return {
      ok: false,
      status: "blocked",
      warnings: [],
      blocker: {
        kind: "selector_drift",
        code: "work_new_task_unverified",
        message: "The new Work task control was clicked, but the visible conversation did not reset to a blank task.",
        resumable: true
      },
      context: await workContext(env)
    };
  }

  return {
    ok: false,
    status: "blocked",
    warnings: [],
    blocker: {
      kind: "selector_drift",
      code: "work_new_task_control_not_found",
      message: "A current Work task is loaded and no unique new-task control was found. Pass newTask: false only when intentionally steering the current task.",
      candidates: NEW_WORK_LABELS.map(label => ({ label })),
      resumable: true
    },
    context: await workContext(env)
  };
}

async function clickNewWorkControl(page: NonNullable<RuntimeEnv["page"]>): Promise<boolean> {
  for (const label of NEW_WORK_LABELS) {
    for (const role of ["button", "link"]) {
      if (await clickIfUnique(page.getByRole?.(role, { name: label, exact: true }))) {
        return true;
      }
    }
  }
  return false;
}

async function requireWork(env: RuntimeEnv): Promise<CommandResult<{
  experience: "work";
  selectorProfile: NonNullable<CommandResult<unknown>["context"]["selectorProfile"]>;
}>> {
  const detected = await detectExperience(env);
  if (detected.ok && detected.data?.experience === "work") {
    return resultOk({
      experience: "work",
      selectorProfile: detected.data.selectorProfile
    }, detected.context);
  }
  return {
    ok: false,
    status: "unsupported",
    warnings: detected.warnings,
    blocker: {
      kind: "selector_drift",
      code: "work_surface_required",
      fieldPath: "experience",
      message: `This command requires the visible Work surface; detected ${detected.data?.experience ?? "unknown"}.`,
      resumable: true
    },
    context: detected.context
  };
}

async function workTaskRef(
  env: RuntimeEnv,
  baselineTurnCount: number | undefined,
  baselineAssistantTurnCount: number | undefined
): Promise<WorkTaskRef> {
  const context = await workContext(env);
  const task: WorkTaskRef = {};
  if (context.url !== undefined) task.url = context.url;
  if (context.conversationId !== undefined) task.conversationId = context.conversationId;
  if (context.title !== undefined) task.title = context.title;
  if (baselineTurnCount !== undefined) task.baselineTurnCount = baselineTurnCount;
  if (baselineAssistantTurnCount !== undefined) task.baselineAssistantTurnCount = baselineAssistantTurnCount;
  return task;
}

async function workContext(
  env: RuntimeEnv,
  selectorProfile?: NonNullable<CommandResult<unknown>["context"]["selectorProfile"]>
) {
  return contextFromPage(env.page, {
    experience: "work",
    ...(selectorProfile === undefined ? {} : { selectorProfile })
  });
}

function markWorkResult<T>(
  result: CommandResult<T>,
  selectorProfile: NonNullable<CommandResult<unknown>["context"]["selectorProfile"]> | undefined
): CommandResult<T> {
  return {
    ...result,
    context: {
      ...result.context,
      experience: "work",
      ...(selectorProfile === undefined ? {} : { selectorProfile })
    }
  };
}

function forwardWorkFailure<T>(
  result: CommandResult<T>,
  data: StartWorkData
): CommandResult<StartWorkData> {
  const forwarded: CommandResult<StartWorkData> = {
    ok: false,
    status: result.status,
    data,
    warnings: result.warnings,
    context: result.context
  };
  if (result.output_text !== undefined) forwarded.output_text = result.output_text;
  if (result.blocker !== undefined) forwarded.blocker = result.blocker;
  if (result.error !== undefined) forwarded.error = result.error;
  return forwarded;
}

function forwardCommandFailure<T>(result: CommandResult<unknown>): CommandResult<T> {
  const forwarded: CommandResult<T> = {
    ok: false,
    status: result.status,
    warnings: result.warnings,
    context: result.context
  };
  if (result.output_text !== undefined) forwarded.output_text = result.output_text;
  if (result.reportPath !== undefined) forwarded.reportPath = result.reportPath;
  if (result.blocker !== undefined) forwarded.blocker = result.blocker;
  if (result.error !== undefined) forwarded.error = result.error;
  if (result.steps !== undefined) forwarded.steps = result.steps;
  return forwarded;
}

async function clickIfUnique(locator: LocatorLike | undefined): Promise<boolean> {
  if (locator?.count === undefined || locator.click === undefined) return false;
  if (await locator.count().catch(() => 0) !== 1) return false;
  await locator.click();
  return true;
}
