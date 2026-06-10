import { createHash } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type {
  AssertSafeToSubmitArgs,
  AskArgs,
  AttachFilesArgs,
  BootstrapArgs,
  CommandResult,
  CopyResponseArgs,
  DownloadLatestArgs,
  ExistingTabPolicy,
  InspectComposerArgs,
  NewThreadArgs,
  OpenThreadArgs,
  ReadLatestArgs,
  RuntimeEnv,
  SearchThreadsArgs,
  SelectToolArgs,
  SequencePlan,
  SetModeArgs,
  SubmitArgs,
  ThreadTarget,
  VerifyAttachedArgs,
  WaitAndReadArgs,
  WaitArgs
} from "./types.js";
import { assertSafeToSubmit } from "./commands/guards.js";
import { attachFiles, downloadLatestFile, verifyAttachedFiles } from "./commands/files.js";
import { doctor, type DoctorArgs, type DoctorReport } from "./commands/doctor.js";
import { contextFromPage } from "./commands/context.js";
import { askMessage, composeMessage, inspectComposer, readLatest, submitMessage, waitAndRead, waitForMessage } from "./commands/messages.js";
import { selectTool, setMode } from "./commands/modes.js";
import { createRunReport, type RunReportData, type RunReportOptions } from "./commands/reports.js";
import { copyResponse } from "./commands/response-actions.js";
import { commandDescriptors, describeCommand, helpText, type CommandDescriptor } from "./commands/registry.js";
import { runSequence } from "./commands/sequence.js";
import { assertChatGPTHost, bootstrap } from "./commands/session.js";
import { newThread, openThread, searchThreads } from "./commands/threads.js";
import { assertTemporaryChatVerifiedOn, ensureTemporaryChatOn, readTemporaryChatState } from "./commands/temporary.js";
import { resultError, resultOk } from "./errors.js";
import { createChatGPTAgent } from "./runner/agent.js";
import type {
  ChatGPTAgent,
  ChatGPTAgentConfig,
  ChatGPTAttachmentInput,
  ChatGPTInputItem,
  ChatGPTResponse,
  ChatGPTRunner,
  ChatGPTRunInput,
  ChatGPTRunResult
} from "./runner/types.js";
import { toRunResult } from "./runner/result.js";
import {
  responseFromRunResult,
  responsesCreateArgsToRunInput,
  unsupportedResponse,
  validateResponsesCreateArgs,
  type ChatGPTResponsesCreateArgs
} from "./runner/responses.js";
import { streamFromRunResult } from "./runner/stream.js";
import { redactReportValue, type ReportRedactionOptions } from "./safety/report-redaction.js";
import { readMessages } from "./dom/messages.js";
import { normalizePromptForHash } from "./dom/visible-text.js";
import { appendProReviewRunMarker, parseProReviewRunMarker } from "./pro-review/run-marker.js";

export type ChatGPTClientOptions = RuntimeEnv & {
  defaults?: {
    mode?: SetModeArgs;
    wait?: boolean | WaitArgs;
    read?: boolean | ReadLatestArgs;
    existingTab?: BootstrapArgs["existingTab"];
    preferExistingTab?: boolean;
  };
  limits?: Partial<RunLimits>;
  reporting?: RunReportOptions;
};

export type RunLimits = {
  maxPromptsPerRun: number;
  maxThreadsOpenedPerRun: number;
  maxMessagesReadPerRun: number;
  maxReportBytesPerRun: number;
  maxReportPreviewChars: number;
};

export type ThreadSelector =
  | { type: "new" }
  | { type: "current" }
  | { type: "url"; url: string }
  | { type: "conversationId"; conversationId: string }
  | { type: "conversation_id"; conversationId: string }
  | { type: "search"; query: string; select?: "first" | { index: number } | { title: string }; limit?: number }
  | { type: "title"; title: string };

export type WorkflowThread = ThreadTarget | ThreadSelector;

export type FileInput = string | { path: string };

export type AskWorkflowArgs = {
  prompt: string;
  thread?: WorkflowThread;
  existingTab?: BootstrapArgs["existingTab"];
  preferExistingTab?: boolean;
  mode?: SetModeArgs;
  tools?: SelectToolArgs[];
  files?: FileInput[];
  attachments?: FileInput[];
  wait?: boolean | WaitArgs;
  read?: boolean | ReadLatestArgs;
  download?: DownloadLatestArgs;
  report?: boolean | RunReportOptions;
};

export type AskInThreadWorkflowArgs = Omit<AskWorkflowArgs, "thread"> & {
  thread: Exclude<WorkflowThread, { type: "new" }>;
};

export type AskWithFilesWorkflowArgs = Omit<AskWorkflowArgs, "files" | "attachments"> & {
  files: FileInput[];
};

export type AskAndDownloadWorkflowArgs = AskWorkflowArgs & {
  download: DownloadLatestArgs;
};

export type RunMessagesArgs = {
  thread?: WorkflowThread;
  existingTab?: BootstrapArgs["existingTab"];
  preferExistingTab?: boolean;
  mode?: SetModeArgs;
  messages: Array<{
    id?: string;
    prompt: string;
    wait?: boolean | WaitArgs;
    read?: boolean | ReadLatestArgs;
  }>;
  report?: boolean | RunReportOptions;
};

export type ProReviewWorkflowArgs = {
  zipPath: string;
  prompt: string;
  mode?: SetModeArgs;
  autoSubmit?: boolean;
  runId?: string;
  response?: WaitAndReadArgs;
  report?: boolean | RunReportOptions;
};

export type ProReviewRecoveryArgs = {
  runId: string;
  tabId?: string;
  conversationId?: string;
  url?: string;
  expectedPromptSha256?: string;
  expectedZipSha256?: string;
  minChars?: number;
  response?: CopyResponseArgs;
};

const DEFAULT_PRO_REVIEW_MODE: SetModeArgs = { model: "Pro", effort: "拡張" };

export type NamedWorkflowInvocation = {
  name: string;
  input?: Record<string, unknown>;
  report?: boolean | RunReportOptions;
};

export type ChatGPTClient = {
  agent<TOutput = string>(config: ChatGPTAgentConfig<TOutput>): ChatGPTAgent<TOutput>;
  run<TOutput = string>(agent: ChatGPTAgent<TOutput>, input: ChatGPTRunInput): Promise<ChatGPTRunResult<TOutput>>;
  runner: ChatGPTRunner;
  responses: {
    create(args: ChatGPTResponsesCreateArgs | Record<string, unknown>): Promise<ChatGPTResponse>;
  };
  ask(args: AskWorkflowArgs): Promise<CommandResult<unknown>>;
  askInThread(args: AskInThreadWorkflowArgs): Promise<CommandResult<unknown>>;
  askWithFiles(args: AskWithFilesWorkflowArgs): Promise<CommandResult<unknown>>;
  askAndDownload(args: AskAndDownloadWorkflowArgs): Promise<CommandResult<unknown>>;
  runMessages(args: RunMessagesArgs): Promise<CommandResult<unknown>>;
  proReview: {
    dryRun(args: Omit<ProReviewWorkflowArgs, "autoSubmit"> & { autoSubmit?: false }): Promise<CommandResult<unknown>>;
    submitAndRead(args: ProReviewWorkflowArgs & { autoSubmit: true }): Promise<CommandResult<unknown>>;
    recover(args: ProReviewRecoveryArgs): Promise<CommandResult<unknown>>;
  };
  openThread(thread: WorkflowThread): Promise<CommandResult<unknown>>;
  readLatest(args?: ReadLatestArgs): Promise<CommandResult<unknown>>;
  copyLatest(args?: CopyResponseArgs): Promise<CommandResult<unknown>>;
  downloadLatest(args: DownloadLatestArgs): Promise<CommandResult<unknown>>;
  runPlan(plan: SequencePlan | NamedWorkflowInvocation): Promise<CommandResult<unknown>>;
  doctor(args?: DoctorArgs): Promise<CommandResult<DoctorReport>>;
  createReport(result: CommandResult<unknown>, args?: RunReportOptions): Promise<CommandResult<RunReportData>>;
  reports: {
    create(result: CommandResult<unknown>, args?: RunReportOptions): Promise<CommandResult<RunReportData>>;
    redact(value: unknown, args?: ReportRedactionOptions): Promise<CommandResult<unknown>>;
    summarize(result: CommandResult<unknown>, args?: ReportRedactionOptions): Promise<CommandResult<unknown>>;
  };
  plan(name: string, args?: unknown): SequencePlan | undefined;
  commands(filter?: { layer?: CommandDescriptor["layer"] }): CommandDescriptor[];
  describe(name: string): CommandDescriptor | undefined;
  help(topic?: string): string;
  session: {
    bootstrap(args?: BootstrapArgs): Promise<CommandResult<unknown>>;
    assertChatGPTHost(): Promise<CommandResult<unknown>>;
  };
  temporary: {
    readState(): Promise<CommandResult<unknown>>;
    ensureOn(): Promise<CommandResult<unknown>>;
    assertVerifiedOn(): Promise<CommandResult<unknown>>;
  };
  threads: {
    "new"(args?: NewThreadArgs): Promise<CommandResult<unknown>>;
    search(args: SearchThreadsArgs): Promise<CommandResult<unknown>>;
    open(args: OpenThreadArgs): Promise<CommandResult<unknown>>;
  };
  messages: {
    compose(args: { text: string; mode?: "replace" | "append"; timeoutMs?: number }): Promise<CommandResult<unknown>>;
    inspectComposer(args?: InspectComposerArgs): Promise<CommandResult<unknown>>;
    submit(args?: SubmitArgs): Promise<CommandResult<unknown>>;
    ask(args: AskArgs): Promise<CommandResult<unknown>>;
    wait(args?: WaitArgs): Promise<CommandResult<unknown>>;
    readLatest(args?: ReadLatestArgs): Promise<CommandResult<unknown>>;
    waitAndRead(args?: WaitArgs & ReadLatestArgs): Promise<CommandResult<unknown>>;
  };
  files: {
    attach(args: AttachFilesArgs): Promise<CommandResult<unknown>>;
    verifyAttached(args: VerifyAttachedArgs): Promise<CommandResult<unknown>>;
    downloadLatest(args: DownloadLatestArgs): Promise<CommandResult<unknown>>;
  };
  guards: {
    assertSafeToSubmit(args: AssertSafeToSubmitArgs): Promise<CommandResult<unknown>>;
  };
  modes: {
    set(args: SetModeArgs): Promise<CommandResult<unknown>>;
  };
  tools: {
    select(args: SelectToolArgs): Promise<CommandResult<unknown>>;
  };
  response: {
    copy(args?: CopyResponseArgs): Promise<CommandResult<unknown>>;
  };
};

export function createChatGPT(options: ChatGPTClientOptions = {}): ChatGPTClient {
  const env = runtimeEnv(options);
  const limits = normalizeLimits(options.limits);
  const runnerRun = ((agent, input, runnerOptions?: { stream?: boolean }) => {
    const run = () => runAgentWorkflow(agent, input, env, limits, options.defaults, options.reporting);
    return runnerOptions?.stream === true ? streamFromRunResult(run) : run();
  }) as ChatGPTRunner["run"];
  const runner: ChatGPTRunner = {
    run: runnerRun,
    plan: (agent, input) => planAgentWorkflow(agent, input, options.defaults)
  };

  return {
    agent: config => createChatGPTAgent(config),
    run: runner.run,
    runner,
    responses: {
      create: args => createResponse(args, runner, env.now)
    },
    ask: args => runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting)),
    askInThread: args => runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting)),
    askWithFiles: args => runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting)),
    askAndDownload: args => runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting)),
    runMessages: args => runGuarded(planRunMessages(args, options.defaults), env, limits, reportOptions(args.report, options.reporting)),
    proReview: {
      dryRun: args => runProReviewWorkflow({ ...args, autoSubmit: false }, env, limits, options.reporting),
      submitAndRead: args => runProReviewWorkflow(args, env, limits, options.reporting),
      recover: args => recoverProReviewAnswer(args, env)
    },
    openThread: thread => runSequence(planOpenThread(thread), env),
    readLatest: args => readLatest(env, args),
    copyLatest: args => copyResponse(env, args),
    downloadLatest: args => downloadLatestFile(env, args),
    runPlan: plan => runPlanInvocation(plan, env, limits, options.defaults, options.reporting),
    doctor: args => doctor(env, args),
    createReport: (result, args) => createRunReport(env, result, args ?? options.reporting ?? {}),
    reports: {
      create: (result, args) => createRunReport(env, result, args ?? options.reporting ?? {}),
      redact: async (value, args) => resultOk(redactReportValue(value, args), {}),
      summarize: async (result, args) => resultOk(redactReportValue(resultSummary(result), args), {})
    },
    plan: (name, args) => planByName(name, args, options.defaults),
    commands: filter => commandDescriptors().filter(descriptor => filter?.layer === undefined || descriptor.layer === filter.layer),
    describe: name => describeCommand(name),
    help: topic => helpText(topic),
    session: {
      bootstrap: args => bootstrap(env, args),
      assertChatGPTHost: () => assertChatGPTHost(env)
    },
    temporary: {
      readState: () => readTemporaryChatState(env),
      ensureOn: () => ensureTemporaryChatOn(env),
      assertVerifiedOn: () => assertTemporaryChatVerifiedOn(env)
    },
    threads: {
      new: args => newThread(env, args),
      search: args => searchThreads(env, args),
      open: args => openThread(env, args)
    },
    messages: {
      compose: args => composeMessage(env, args),
      inspectComposer: args => inspectComposer(env, args),
      submit: args => submitMessage(env, args),
      ask: args => askMessage(env, args),
      wait: args => waitForMessage(env, args),
      readLatest: args => readLatest(env, args),
      waitAndRead: args => waitAndRead(env, args)
    },
    files: {
      attach: args => attachFiles(env, args),
      verifyAttached: args => verifyAttachedFiles(env, args),
      downloadLatest: args => downloadLatestFile(env, args)
    },
    guards: {
      assertSafeToSubmit: args => assertSafeToSubmit(env, args)
    },
    modes: {
      set: args => setMode(env, args)
    },
    tools: {
      select: args => selectTool(env, args)
    },
    response: {
      copy: args => copyResponse(env, args)
    }
  };
}

async function runProReviewWorkflow(
  args: ProReviewWorkflowArgs,
  env: RuntimeEnv,
  limits: RunLimits,
  reporting: RunReportOptions | undefined
): Promise<CommandResult<unknown>> {
  try {
    const file = await proReviewFileMetadata(args.zipPath);
    const plan = planProReviewWorkflow(args, file);
    return runGuarded(plan, env, limits, reportOptions(args.report, reporting));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)));
  }
}

type ProReviewFileMetadata = {
  path: string;
  name: string;
  bytes: number;
  sha256: string;
};

const MAX_PRO_REVIEW_ZIP_BYTES = 100 * 1024 * 1024;

async function proReviewFileMetadata(path: string): Promise<ProReviewFileMetadata> {
  const fileStat = await stat(path);
  if (!fileStat.isFile()) {
    throw new Error(`Pro review attachment path is not a file: ${path}`);
  }
  if (extname(path).toLowerCase() !== ".zip") {
    throw new Error(`Pro review attachment must be a .zip file: ${path}`);
  }
  if (fileStat.size <= 0) {
    throw new Error(`Pro review attachment zip is empty: ${path}`);
  }
  if (fileStat.size > MAX_PRO_REVIEW_ZIP_BYTES) {
    throw new Error(`Pro review attachment zip exceeds ${MAX_PRO_REVIEW_ZIP_BYTES} bytes: ${path}`);
  }
  if (!await hasZipSignature(path)) {
    throw new Error(`Pro review attachment does not look like a zip file: ${path}`);
  }
  return {
    path,
    name: basename(path),
    bytes: fileStat.size,
    sha256: await sha256File(path)
  };
}

async function hasZipSignature(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4);
    const read = await handle.read(buffer, 0, buffer.length, 0);
    if (read.bytesRead < 4) return false;
    return buffer[0] === 0x50 && buffer[1] === 0x4b
      && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
      && (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);
  } finally {
    await handle.close();
  }
}

function planProReviewWorkflow(args: ProReviewWorkflowArgs, file: ProReviewFileMetadata): SequencePlan {
  const basePromptSha256 = sha256Text(args.prompt);
  const submittedPrompt = args.runId === undefined
    ? args.prompt
    : appendProReviewRunMarker(args.prompt, {
      runId: args.runId,
      promptSha256: basePromptSha256,
      zipSha256: file.sha256,
      zipName: file.name,
      zipBytes: file.bytes
    });
  const promptSha256 = sha256Text(submittedPrompt);
  const mode = args.mode ?? DEFAULT_PRO_REVIEW_MODE;
  const guardArgs: AssertSafeToSubmitArgs = {
    expectedPromptSha256: promptSha256,
    expectedAttachmentName: file.name,
    expectedAttachmentBytes: file.bytes,
    expectedAttachmentSha256: file.sha256,
    expectedAttachmentPath: file.path
  };
  guardArgs.mode = mode;
  if (args.runId !== undefined) guardArgs.runId = args.runId;

  const steps: SequencePlan["steps"] = [
    { id: "bootstrap", command: "session.bootstrap", args: { preferExistingTab: false, url: "https://chatgpt.com/?temporary-chat=true" } },
    { id: "host", command: "session.assertChatGPTHost" },
    { id: "temporary_on", command: "temporary.ensureOn" },
    { id: "temporary_verified", command: "temporary.assertVerifiedOn" }
  ];

  steps.push({ id: "mode", command: "modes.set", args: mode });

  steps.push(
    { id: "attach", command: "files.attach", args: { paths: [file.path] } },
    {
      id: "verify_attachment",
      command: "files.verifyAttached",
      args: {
        expectedName: file.name,
        expectedBytes: file.bytes,
        expectedSha256: file.sha256,
        expectedPath: file.path
      }
    },
    { id: "compose", command: "messages.compose", args: { text: submittedPrompt, mode: "replace" } },
    { id: "inspect_composer", command: "messages.inspectComposer", args: { expectedSha256: promptSha256 } },
    { id: "safe_to_submit", command: "guards.assertSafeToSubmit", args: guardArgs }
  );

  if (args.autoSubmit === true) {
    const waitArgs: WaitArgs = waitArgsFromProReviewResponse(args.response);
    const copyArgs: CopyResponseArgs = {
      which: "latest",
      prefer: "clipboard",
      format: args.response?.format ?? "markdown",
      timeoutMs: Math.max(15000, waitArgs.timeoutMs ?? 600000)
    };
    steps.push(
      {
        id: "submit",
        command: "messages.submit",
        args: {
          text: submittedPrompt,
          submitMode: "buttonOnly",
          requireChatGPTHost: true,
          requireTemporary: true,
          expectedPromptSha256: promptSha256,
          expectedAttachmentName: file.name,
          expectedAttachmentBytes: file.bytes,
          expectedAttachmentSha256: file.sha256,
          expectedAttachmentPath: file.path
        }
      },
      { id: "wait", command: "messages.wait", args: waitArgs },
      { id: "copy", command: "response.copy", args: copyArgs }
    );
  }

  return {
    name: args.autoSubmit === true ? "pro-review-submit-and-read" : "pro-review-dry-run",
    policy: { stopOnError: true, returnPartial: true, defaultTimeoutMs: 45000 },
    steps
  };
}

function waitArgsFromProReviewResponse(response: WaitAndReadArgs | undefined): WaitArgs {
  return {
    timeoutMs: response?.timeoutMs ?? 600000,
    ...(response?.stableMs !== undefined ? { stableMs: response.stableMs } : {}),
    ...(response?.pollMs !== undefined ? { pollMs: response.pollMs } : {}),
    ...(response?.mode !== undefined ? { mode: response.mode } : {})
  };
}

async function recoverProReviewAnswer(
  args: ProReviewRecoveryArgs,
  env: RuntimeEnv
): Promise<CommandResult<unknown>> {
  const boot = await bootstrap(env, { existingTab: proReviewRecoveryTabPolicy(args) });
  if (!boot.ok) {
    return boot;
  }

  const marker = await findVisibleProReviewMarker(env, args);
  if (!marker.ok) {
    return marker;
  }

  const copied = await copyResponse(env, {
    which: "latest",
    prefer: args.response?.prefer ?? "clipboard",
    format: args.response?.format ?? "markdown",
    timeoutMs: args.response?.timeoutMs ?? 15000
  });
  const copiedText = textFromData(copied.data);
  const minChars = args.minChars ?? 1000;
  if (!copied.ok || copiedText === undefined || copiedText.length < minChars) {
    return {
      ...copied,
      ok: false,
      status: copied.ok ? "blocked" : copied.status,
      blocker: copied.blocker ?? {
        kind: "not_found",
        code: "pro_review_recovered_answer_too_short",
        message: `Recovered Pro answer text was too short (${copiedText?.length ?? 0}/${minChars} chars).`,
        resumable: true
      },
      warnings: copied.warnings
    };
  }

  return {
    ...copied,
    data: {
      ...(copied.data !== null && typeof copied.data === "object" ? copied.data as Record<string, unknown> : {}),
      runId: args.runId,
      recovered: true,
      marker: marker.data
    }
  };
}

function proReviewRecoveryTabPolicy(args: ProReviewRecoveryArgs): ExistingTabPolicy {
  if (args.tabId !== undefined) {
    return { target: { type: "tabId", tabId: args.tabId }, ifMissing: "block", ifMultiple: "block", requireChatGPT: true };
  }
  if (args.conversationId !== undefined) {
    return { target: { type: "conversationId", conversationId: args.conversationId }, ifMissing: "block", ifMultiple: "block", requireChatGPT: true };
  }
  if (args.url !== undefined) {
    return { target: { type: "url", url: args.url }, ifMissing: "block", ifMultiple: "block", requireChatGPT: true };
  }
  return { target: { type: "selected", host: "chatgpt" }, ifMissing: "block", ifMultiple: "first", requireChatGPT: true };
}

async function findVisibleProReviewMarker(
  env: RuntimeEnv,
  args: ProReviewRecoveryArgs
): Promise<CommandResult<unknown>> {
  const page = env.page;
  if (page === undefined) {
    return {
      ok: false,
      status: "blocked",
      warnings: [],
      blocker: {
        kind: "not_found",
        code: "pro_review_recovery_tab_unavailable",
        message: "No ChatGPT page was available after recovery bootstrap.",
        resumable: true
      },
      context: { timestamp: new Date().toISOString() }
    };
  }

  const userMessages = await readMessages(page, { role: "user", format: "normalized_text" });
  for (const message of userMessages) {
    const marker = parseProReviewRunMarker(message.text);
    if (marker?.runId !== args.runId) {
      continue;
    }
    if (args.expectedPromptSha256 !== undefined && marker.promptSha256 !== args.expectedPromptSha256) {
      return proReviewMarkerMismatch("promptSha256", args.expectedPromptSha256, marker.promptSha256, env);
    }
    if (args.expectedZipSha256 !== undefined && marker.zipSha256 !== args.expectedZipSha256) {
      return proReviewMarkerMismatch("zipSha256", args.expectedZipSha256, marker.zipSha256, env);
    }
    return resultOk(marker, await contextFromPage(page));
  }

  return {
    ok: false,
    status: "blocked",
    warnings: [],
    blocker: {
      kind: "not_found",
      code: "pro_review_run_marker_not_found",
      message: `No visible submitted user turn contained Pro review run marker "${args.runId}".`,
      resumable: true
    },
    context: await contextFromPage(page)
  };
}

async function proReviewMarkerMismatch(
  field: "promptSha256" | "zipSha256",
  expected: string,
  actual: string,
  env: RuntimeEnv
): Promise<CommandResult<unknown>> {
  return {
    ok: false,
    status: "blocked",
    warnings: [],
    blocker: {
      kind: "confirmation",
      code: "pro_review_run_marker_mismatch",
      fieldPath: field,
      message: `Recovered Pro review run marker ${field} did not match expected hash.`,
      visibleText: `expected=${expected} actual=${actual}`,
      resumable: true
    },
    context: env.page === undefined ? { timestamp: new Date().toISOString() } : await contextFromPage(env.page)
  };
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(normalizePromptForHash(text)).digest("hex");
}

async function runGuarded(
  plan: SequencePlan,
  env: RuntimeEnv,
  limits: RunLimits,
  report: RunReportOptions | undefined
): Promise<CommandResult<unknown>> {
  const budget = checkRunBudget(plan, limits);
  if (budget !== undefined) return budget;

  const result = await runSequence(plan, env);
  if (report === undefined || report.enabled === false) return result;

  const reportResult = await createRunReport(env, result, capReportOptions(report, limits));
  if (reportResult.ok && reportResult.data !== undefined) {
    if (reportResult.data.bytes > limits.maxReportBytesPerRun) {
      const overBudget: CommandResult<unknown> = {
        ok: false,
        status: "needs_confirmation",
        warnings: [`Run report exceeded byte budget after creation: ${reportResult.data.bytes}/${limits.maxReportBytesPerRun}.`],
        reportPath: reportResult.data.path,
        blocker: {
          kind: "confirmation",
          code: "report_byte_budget_exceeded",
          fieldPath: "limits.maxReportBytesPerRun",
          message: `Workflow "${plan.name}" created a report larger than the configured budget (${reportResult.data.bytes}/${limits.maxReportBytesPerRun} bytes). Ask the user before preserving or sharing it.`,
          remediation: [
            {
              label: "Confirm report retention",
              instruction: "Ask the user whether to keep this report, increase maxReportBytesPerRun, or rerun with a smaller report preview.",
              userActionRequired: true
            }
          ],
          resumable: true
        },
        context: result.context
      };
      if (result.steps !== undefined) overBudget.steps = result.steps;
      return overBudget;
    }
    return {
      ...result,
      reportPath: reportResult.data.path,
      warnings: [...result.warnings, ...reportResult.warnings]
    };
  }
  return {
    ...result,
    warnings: [
      ...result.warnings,
      `Run report creation failed: ${reportResult.error?.message ?? reportResult.blocker?.message ?? reportResult.status}`
    ]
  };
}

function normalizeLimits(limits: Partial<RunLimits> | undefined): RunLimits {
  return {
    maxPromptsPerRun: limits?.maxPromptsPerRun ?? 5,
    maxThreadsOpenedPerRun: limits?.maxThreadsOpenedPerRun ?? 3,
    maxMessagesReadPerRun: limits?.maxMessagesReadPerRun ?? 10,
    maxReportBytesPerRun: limits?.maxReportBytesPerRun ?? 2_000_000,
    maxReportPreviewChars: limits?.maxReportPreviewChars ?? 240
  };
}

function checkRunBudget(plan: SequencePlan, limits: RunLimits): CommandResult<unknown> | undefined {
  const prompts = plan.steps.filter(step => step.command === "messages.ask" || step.command === "messages.submit").length;
  const threads = plan.steps.filter(step => step.command === "threads.new" || step.command === "threads.open").length;
  const reads = plan.steps.filter(step => step.command === "messages.readLatest" || step.command === "messages.waitAndRead" || step.command === "response.copy").length
    + plan.steps.filter(step => step.command === "messages.ask" && askStepReads(step.args)).length;

  const violations: string[] = [];
  if (prompts > limits.maxPromptsPerRun) violations.push(`prompts ${prompts}/${limits.maxPromptsPerRun}`);
  if (threads > limits.maxThreadsOpenedPerRun) violations.push(`threads ${threads}/${limits.maxThreadsOpenedPerRun}`);
  if (reads > limits.maxMessagesReadPerRun) violations.push(`reads ${reads}/${limits.maxMessagesReadPerRun}`);
  if (violations.length === 0) return undefined;

  return {
    ok: false,
    status: "needs_confirmation",
    warnings: [],
    blocker: {
      kind: "confirmation",
      code: "run_budget_exceeded",
      fieldPath: "limits",
      message: `Workflow "${plan.name}" exceeds ChatGPT browser-control run budget: ${violations.join(", ")}. Ask the user to confirm a bounded exception.`,
      remediation: [
        {
          label: "Confirm bounded run",
          instruction: "Ask the user to approve this specific over-budget run, or reduce the number of prompts, thread opens, or message reads.",
          userActionRequired: true
        }
      ],
      resumable: true
    },
    context: { timestamp: new Date().toISOString() }
  };
}

function askStepReads(args: AskArgs): boolean {
  return args.read === true || typeof args.read === "object";
}

function reportOptions(
  request: boolean | RunReportOptions | undefined,
  defaults: RunReportOptions | undefined
): RunReportOptions | undefined {
  if (request === false) return undefined;
  if (request === true) return { ...(defaults ?? {}), enabled: true };
  if (request !== undefined) return { ...(defaults ?? {}), ...request, enabled: request.enabled ?? true };
  return defaults?.enabled === true ? defaults : undefined;
}

function capReportOptions(report: RunReportOptions, limits: RunLimits): RunReportOptions {
  return {
    ...report,
    maxPreviewChars: Math.min(report.maxPreviewChars ?? limits.maxReportPreviewChars, limits.maxReportPreviewChars)
  };
}

async function createResponse(
  args: ChatGPTResponsesCreateArgs | Record<string, unknown>,
  runner: ChatGPTRunner,
  now: RuntimeEnv["now"] | undefined
): Promise<ChatGPTResponse> {
  const validation = validateResponsesCreateArgs(args as Record<string, unknown>);
  const timestamp = now?.() ?? new Date();
  if (!validation.ok) {
    return unsupportedResponse(validation.unsupported, timestamp);
  }

  const responseArgs = args as ChatGPTResponsesCreateArgs;
  const agentConfig: ChatGPTAgentConfig = {
    name: "responses-adapter",
    instructionsMode: responseArgs.instructionsMode === "visible_prefix" ? "visible_prefix" : "metadata_only"
  };
  if (typeof responseArgs.instructions === "string") {
    agentConfig.instructions = responseArgs.instructions;
  }

  const agent = createChatGPTAgent(agentConfig);
  const result = await runner.run(agent, responsesCreateArgsToRunInput(responseArgs));
  return responseFromRunResult(result, now?.() ?? timestamp);
}

async function runAgentWorkflow<TOutput>(
  agent: ChatGPTAgent<TOutput>,
  input: ChatGPTRunInput,
  env: RuntimeEnv,
  limits: RunLimits,
  defaults: ChatGPTClientOptions["defaults"] | undefined,
  reporting: RunReportOptions | undefined
): Promise<ChatGPTRunResult<TOutput>> {
  try {
    const normalized = normalizeRunnerInput(agent, input);
    const plan = planAgentWorkflowFromNormalized(agent, normalized, defaults);
    const report = reportOptions(normalized.report ?? agent.defaults.report, reporting);
    const result = await runGuarded(plan, env, limits, report);
    return toRunResult(agent, result);
  } catch (error) {
    return toRunResult(agent, resultError(error instanceof Error ? error : new Error(String(error)), {}));
  }
}

function planAgentWorkflow<TOutput>(
  agent: ChatGPTAgent<TOutput>,
  input: ChatGPTRunInput,
  defaults: ChatGPTClientOptions["defaults"] = {}
): SequencePlan {
  return planAgentWorkflowFromNormalized(agent, normalizeRunnerInput(agent, input), defaults);
}

type NormalizedRunnerInput = {
  prompt: string;
  thread?: WorkflowThread;
  existingTab?: BootstrapArgs["existingTab"];
  preferExistingTab?: boolean;
  mode?: SetModeArgs;
  tools: SelectToolArgs[];
  files: string[];
  wait?: boolean | WaitArgs;
  read?: boolean | ReadLatestArgs;
  download?: DownloadLatestArgs | false;
  copy?: CopyResponseArgs | false;
  report?: boolean | RunReportOptions;
};

function planAgentWorkflowFromNormalized<TOutput>(
  agent: ChatGPTAgent<TOutput>,
  input: NormalizedRunnerInput,
  defaults: ChatGPTClientOptions["defaults"] = {}
): SequencePlan {
  const wait = input.wait ?? agent.defaults.wait ?? defaults.wait ?? true;
  const read = input.read ?? agent.defaults.read ?? defaults.read ?? { format: "markdown" };
  const thread = input.thread ?? agent.defaults.thread ?? { type: "new" };
  const steps: SequencePlan["steps"] = [
    bootstrapStepForWorkflow(
      thread,
      input.existingTab ?? agent.defaults.existingTab ?? defaults.existingTab,
      input.preferExistingTab ?? agent.defaults.preferExistingTab ?? defaults.preferExistingTab
    ),
    ...threadSteps(thread)
  ];

  const mode = input.mode ?? agent.defaults.mode ?? defaults.mode;
  if (mode !== undefined) {
    steps.push({ id: "mode", command: "modes.set", args: mode });
  }
  for (const [index, tool] of input.tools.entries()) {
    steps.push({ id: `tool${index + 1}`, command: "tools.select", args: tool });
  }
  if (input.files.length > 0) {
    steps.push({ id: "attach", command: "files.attach", args: { paths: input.files } });
  }

  if (agent.instructionsMode === "visible_setup_message" && hasInstructions(agent)) {
    steps.push({
      id: "agent_setup",
      command: "messages.ask",
      args: {
        text: renderAgentSetupMessage(agent),
        wait,
        read: false
      }
    });
  }

  steps.push({
    id: "ask",
    command: "messages.ask",
    args: {
      text: renderRunnerPrompt(agent, input.prompt),
      wait,
      read
    }
  });

  if (input.copy !== undefined && input.copy !== false) {
    steps.push({ id: "copy", command: "response.copy", args: input.copy });
  }
  if (input.download !== undefined && input.download !== false) {
    steps.push({ id: "download", command: "files.downloadLatest", args: input.download });
  }

  return {
    name: `agent-run:${agent.name}`,
    policy: { stopOnError: true, returnPartial: true },
    steps
  };
}

function normalizeRunnerInput<TOutput>(agent: ChatGPTAgent<TOutput>, input: ChatGPTRunInput): NormalizedRunnerInput {
  const args = typeof input === "string" ? { input } : input;
  const collected = collectRunnerInput(args.input);
  const attachments = normalizeRunnerAttachments(args.attachments);
  const mode = args.mode;
  const normalized: NormalizedRunnerInput = {
    prompt: collected.prompt,
    tools: args.tools ?? [],
    files: [...collected.files, ...attachments]
  };

  if (args.thread !== undefined) normalized.thread = args.thread;
  if (args.existingTab !== undefined) normalized.existingTab = args.existingTab;
  if (args.preferExistingTab !== undefined) normalized.preferExistingTab = args.preferExistingTab;
  if (mode !== undefined) normalized.mode = mode;
  if (args.response !== undefined) normalized.read = args.response;
  if (args.download !== undefined) normalized.download = args.download;
  if (args.copy !== undefined) normalized.copy = args.copy;
  if (args.report !== undefined) normalized.report = args.report;

  if (normalized.prompt.trim().length === 0) {
    throw new Error(`ChatGPT runner input for agent "${agent.name}" must include non-empty visible text.`);
  }
  return normalized;
}

function collectRunnerInput(input: string | ChatGPTInputItem[]): { prompt: string; files: string[] } {
  if (typeof input === "string") {
    return { prompt: input, files: [] };
  }

  const visibleInstructions: string[] = [];
  const userText: string[] = [];
  const files: string[] = [];

  for (const item of input) {
    switch (item.type) {
      case "input_text":
        userText.push(item.text);
        break;
      case "visible_instruction":
        visibleInstructions.push(item.text);
        break;
      case "input_file":
        files.push(item.path);
        if (item.description !== undefined && item.description.trim().length > 0) {
          userText.push(`Attached file context: ${item.description.trim()}`);
        }
        break;
    }
  }

  const parts: string[] = [];
  if (visibleInstructions.length > 0) {
    parts.push(`<visible_instructions>\n${visibleInstructions.join("\n")}\n</visible_instructions>`);
  }
  if (userText.length > 0) {
    parts.push(userText.join("\n\n"));
  }
  return { prompt: parts.join("\n\n"), files };
}

function normalizeRunnerAttachments(attachments: ChatGPTAttachmentInput[] | undefined): string[] {
  return (attachments ?? []).map(attachment => attachment.path);
}

function renderRunnerPrompt<TOutput>(agent: ChatGPTAgent<TOutput>, prompt: string): string {
  if (agent.instructionsMode !== "visible_prefix" || !hasInstructions(agent)) {
    return prompt;
  }
  return `${renderAgentInstructionBlock(agent)}\n\n<user_request>\n${prompt}\n</user_request>`;
}

function renderAgentSetupMessage<TOutput>(agent: ChatGPTAgent<TOutput>): string {
  return `${renderAgentInstructionBlock(agent)}\n\nAcknowledge these visible setup instructions briefly, then wait for the next user request.`;
}

function renderAgentInstructionBlock<TOutput>(agent: ChatGPTAgent<TOutput>): string {
  return [
    "<chatgpt_browser_agent>",
    `Agent name: ${agent.name}`,
    "Instructions:",
    agent.instructions ?? "",
    "</chatgpt_browser_agent>"
  ].join("\n");
}

function hasInstructions<TOutput>(agent: ChatGPTAgent<TOutput>): boolean {
  return (agent.instructions ?? "").trim().length > 0;
}

async function runPlanInvocation(
  plan: SequencePlan | NamedWorkflowInvocation,
  env: RuntimeEnv,
  limits: RunLimits,
  defaults: ChatGPTClientOptions["defaults"] | undefined,
  reporting: RunReportOptions | undefined
): Promise<CommandResult<unknown>> {
  try {
    if (!("steps" in plan) && plan.name === "doctor-upload") {
      const result = await doctor(env, { check: ["bridge", "login", "upload"] });
      return maybeAttachReport(env, result, reportOptions(plan.report, reporting), limits);
    }

    if (!("steps" in plan) && plan.name === "redacted-run-report") {
      const input = isRecord(plan.input) ? plan.input : {};
      const result = input.result;
      if (!isCommandResult(result)) {
        throw new Error('Named workflow "redacted-run-report" requires input.result to be a CommandResult.');
      }
      return createRunReport(env, result, capReportOptions(reportOptions(plan.report, reporting) ?? {}, limits));
    }

    const resolved = "steps" in plan ? plan : resolvePlan(plan, defaults);
    return runGuarded(resolved, env, limits, reportOptions("report" in plan ? plan.report : undefined, reporting));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), {});
  }
}

async function maybeAttachReport(
  env: RuntimeEnv,
  result: CommandResult<unknown>,
  report: RunReportOptions | undefined,
  limits: RunLimits
): Promise<CommandResult<unknown>> {
  if (report === undefined || report.enabled === false) return result;
  const reportResult = await createRunReport(env, result, capReportOptions(report, limits));
  if (!reportResult.ok || reportResult.data === undefined) return result;
  return { ...result, reportPath: reportResult.data.path };
}

function runtimeEnv(options: ChatGPTClientOptions): RuntimeEnv {
  const env: RuntimeEnv = {};
  if (options.agent !== undefined) env.agent = options.agent;
  if (options.browser !== undefined) env.browser = options.browser;
  if (options.page !== undefined) env.page = options.page;
  if (options.clipboard !== undefined) env.clipboard = options.clipboard;
  if (options.now !== undefined) env.now = options.now;
  return env;
}

function planAskWorkflow(args: AskWorkflowArgs, defaults: ChatGPTClientOptions["defaults"] = {}): SequencePlan {
  const thread = args.thread ?? { type: "new" };
  const steps: SequencePlan["steps"] = [
    bootstrapStepForWorkflow(
      thread,
      args.existingTab ?? defaults.existingTab,
      args.preferExistingTab ?? defaults.preferExistingTab
    ),
    ...threadSteps(thread)
  ];

  const mode = args.mode ?? defaults.mode;
  if (mode !== undefined) {
    steps.push({ id: "mode", command: "modes.set", args: mode });
  }
  for (const [index, tool] of (args.tools ?? []).entries()) {
    steps.push({ id: `tool${index + 1}`, command: "tools.select", args: tool });
  }

  const files = normalizeFileInputs([...(args.files ?? []), ...(args.attachments ?? [])]);
  if (files.length > 0) {
    steps.push({ id: "attach", command: "files.attach", args: { paths: files } });
  }

  steps.push({
    id: "ask",
    command: "messages.ask",
    args: {
      text: args.prompt,
      wait: args.wait ?? defaults.wait ?? true,
      read: args.read ?? defaults.read ?? { format: "markdown" }
    }
  });

  if (args.download !== undefined) {
    steps.push({ id: "download", command: "files.downloadLatest", args: args.download });
  }

  return {
    name: args.download === undefined ? "ask" : "ask-and-download",
    policy: { stopOnError: true, returnPartial: true },
    steps
  };
}

function planRunMessages(args: RunMessagesArgs, defaults: ChatGPTClientOptions["defaults"] = {}): SequencePlan {
  const thread = args.thread ?? { type: "new" };
  const steps: SequencePlan["steps"] = [
    bootstrapStepForWorkflow(
      thread,
      args.existingTab ?? defaults.existingTab,
      args.preferExistingTab ?? defaults.preferExistingTab
    ),
    ...threadSteps(thread)
  ];

  const mode = args.mode ?? defaults.mode;
  if (mode !== undefined) {
    steps.push({ id: "mode", command: "modes.set", args: mode });
  }

  args.messages.forEach((message, index) => {
    steps.push({
      id: message.id ?? `message${index + 1}`,
      command: "messages.ask",
      args: {
        text: message.prompt,
        wait: message.wait ?? defaults.wait ?? true,
        read: message.read ?? defaults.read ?? { format: "markdown" }
      }
    });
  });

  return { name: "run-messages", policy: { stopOnError: true, returnPartial: true }, steps };
}

function planOpenThread(thread: WorkflowThread): SequencePlan {
  return {
    name: "open-thread",
    policy: { stopOnError: true, returnPartial: true },
    steps: [
      { id: "bootstrap", command: "session.bootstrap" },
      ...threadSteps(thread)
    ]
  };
}

function planByName(name: string, args: unknown, defaults: ChatGPTClientOptions["defaults"] = {}): SequencePlan | undefined {
  const input = isRecord(args) ? args : {};
  switch (name) {
    case "new-ask-read":
      return planAskWorkflow({ prompt: stringInput(input, "prompt"), thread: { type: "new" } }, defaults);
    case "find-open-copy-latest":
      return {
        name,
        steps: [
          { id: "bootstrap", command: "session.bootstrap" },
          { id: "find", command: "threads.search", args: { query: stringInput(input, "query"), limit: 5 } },
          { id: "open", command: "threads.open", args: { fromStep: "find", select: "first" } },
          { id: "copy", command: "response.copy", args: { which: "latest" } }
        ]
      };
    case "find-open-ask-read":
      return planAskWorkflow({
        prompt: stringInput(input, "prompt"),
        thread: { type: "search", query: stringInput(input, "query"), select: "first" }
      }, defaults);
    case "attach-ask-read":
      return planAskWorkflow({
        prompt: stringInput(input, "prompt"),
        thread: { type: "new" },
        files: arrayInput(input, "files").map(String)
      }, defaults);
    case "ask-and-download":
      return planAskWorkflow({
        prompt: stringInput(input, "prompt"),
        thread: { type: "new" },
        download: { destDir: stringInput(input, "destDir") }
      }, defaults);
    case "two-turn":
      return planRunMessages({
        thread: { type: "new" },
        messages: [
          { id: "first", prompt: stringInput(input, "first") },
          { id: "second", prompt: stringInput(input, "second") }
        ]
      }, defaults);
    default:
      return undefined;
  }
}

function resolvePlan(plan: SequencePlan | NamedWorkflowInvocation, defaults: ChatGPTClientOptions["defaults"] = {}): SequencePlan {
  if ("steps" in plan) return plan;
  const resolved = planByName(plan.name, plan.input, defaults);
  if (resolved === undefined) {
    throw new Error(`Unknown ChatGPT workflow plan: ${plan.name}`);
  }
  return resolved;
}

function resultSummary(result: CommandResult<unknown>): Record<string, unknown> {
  return {
    ok: result.ok,
    status: result.status,
    warnings: result.warnings,
    blocker: result.blocker,
    error: result.error,
    context: result.context,
    reportPath: result.reportPath
  };
}

function textFromData(data: unknown): string | undefined {
  if (data === null || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const text = record.text ?? record.responseText ?? record.markdown ?? record.normalizedText ?? record.visibleText;
  return typeof text === "string" ? text : undefined;
}

function isCommandResult(value: unknown): value is CommandResult<unknown> {
  return isRecord(value)
    && typeof value.ok === "boolean"
    && typeof value.status === "string"
    && Array.isArray(value.warnings)
    && isRecord(value.context)
    && typeof value.context.timestamp === "string";
}

function bootstrapStepForWorkflow(
  thread: WorkflowThread,
  existingTab: BootstrapArgs["existingTab"] | undefined,
  preferExistingTab: boolean | undefined
): SequencePlan["steps"][number] {
  const args = bootstrapArgsForWorkflow(thread, existingTab, preferExistingTab);
  if (args === undefined) {
    return { id: "bootstrap", command: "session.bootstrap" };
  }
  return { id: "bootstrap", command: "session.bootstrap", args };
}

function bootstrapArgsForWorkflow(
  thread: WorkflowThread,
  existingTab: BootstrapArgs["existingTab"] | undefined,
  preferExistingTab: boolean | undefined
): BootstrapArgs | undefined {
  const args: BootstrapArgs = {};
  if (existingTab !== undefined) {
    args.existingTab = existingTab === true ? existingTabPolicyFromThread(thread) : existingTab;
  }
  if (preferExistingTab !== undefined) {
    args.preferExistingTab = preferExistingTab;
  }
  return Object.keys(args).length === 0 ? undefined : args;
}

function existingTabPolicyFromThread(thread: WorkflowThread): ExistingTabPolicy {
  const target = existingTabTargetFromThread(thread);
  if (target === undefined) {
    return {
      target: { type: "selected", host: "chatgpt" },
      ifMissing: "block",
      ifMultiple: "first",
      requireChatGPT: true
    };
  }
  return {
    target,
    ifMissing: "block",
    ifMultiple: target.type === "selected" ? "first" : "block",
    requireChatGPT: true
  };
}

function existingTabTargetFromThread(thread: WorkflowThread): ExistingTabPolicy["target"] | undefined {
  if (isTypedThread(thread)) {
    switch (thread.type) {
      case "new":
      case "search":
        return undefined;
      case "current":
        return { type: "selected", host: "chatgpt" };
      case "url":
        return { type: "url", url: thread.url };
      case "conversationId":
      case "conversation_id":
        return { type: "conversationId", conversationId: thread.conversationId };
      case "title":
        return { type: "title", title: thread.title, exact: false };
    }
  }

  if (thread.url !== undefined) return { type: "url", url: thread.url };
  if (thread.conversationId !== undefined) return { type: "conversationId", conversationId: thread.conversationId };
  if (thread.title !== undefined) return { type: "title", title: thread.title, exact: false };
  return undefined;
}

function threadSteps(thread: WorkflowThread): SequencePlan["steps"] {
  if (isTypedThread(thread)) {
    switch (thread.type) {
      case "new":
        return [{ id: "new", command: "threads.new" }];
      case "current":
        return [];
      case "url":
        return [{ id: "open", command: "threads.open", args: { url: thread.url } }];
      case "conversationId":
        return [{ id: "open", command: "threads.open", args: { conversationId: thread.conversationId } }];
      case "conversation_id":
        return [{ id: "open", command: "threads.open", args: { conversationId: thread.conversationId } }];
      case "search":
        return [
          { id: "find", command: "threads.search", args: { query: thread.query, limit: thread.limit ?? 5 } },
          { id: "open", command: "threads.open", args: { fromStep: "find", select: thread.select ?? "first" } }
        ];
      case "title":
        return [{ id: "open", command: "threads.open", args: { title: thread.title } }];
    }
  }

  if (thread.url !== undefined) return [{ id: "open", command: "threads.open", args: { url: thread.url } }];
  if (thread.conversationId !== undefined) return [{ id: "open", command: "threads.open", args: { conversationId: thread.conversationId } }];
  const query = thread.query ?? thread.title;
  if (query === undefined) return [];
  return [
    { id: "find", command: "threads.search", args: { query, limit: 5 } },
    { id: "open", command: "threads.open", args: { fromStep: "find", select: thread.title === undefined ? "first" : { title: thread.title } } }
  ];
}

function isTypedThread(thread: WorkflowThread): thread is ThreadSelector {
  return "type" in thread;
}

function normalizeFileInputs(files: FileInput[]): string[] {
  return files.map(file => typeof file === "string" ? file : file.path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringInput(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Named workflow input "${key}" must be a non-empty string.`);
  }
  return value;
}

function arrayInput(input: Record<string, unknown>, key: string): unknown[] {
  const value = input[key];
  if (!Array.isArray(value)) {
    throw new Error(`Named workflow input "${key}" must be an array.`);
  }
  return value;
}
