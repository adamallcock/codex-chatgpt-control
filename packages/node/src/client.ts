import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AskArgs,
  ArtifactDownloadArgs,
  ArtifactWaitArgs,
  ApplyConfigurationData,
  ApplyConfigurationArgs,
  AttachFilesArgs,
  BootstrapArgs,
  ChatGPTExperience,
  CommandResult,
  ConfigurationInspectionData,
  ConfigurationSelection,
  CopyResponseArgs,
  DetectExperienceArgs,
  DetectExperienceData,
  DownloadLatestArgs,
  FilePreflightArgs,
  FilePreflightData,
  ExistingTabPolicy,
  GetModeArgs,
  GetModeData,
  InspectConfigurationArgs,
  ListArtifactsArgs,
  MessageStatusArgs,
  StopGenerationArgs,
  StopGenerationData,
  NewThreadArgs,
  OpenThreadArgs,
  OpenExperienceData,
  ProjectSourcesAddArgs,
  ProjectSourcesAddData,
  ProjectSourcesAddPlanData,
  ProjectSourcesListArgs,
  ProjectSourcesListData,
  ProjectSourcesPlanAddArgs,
  ReadLatestArgs,
  ResponseFormat,
  RuntimeEnv,
  ReadWorkLatestArgs,
  ReadWorkLatestData,
  SearchThreadsArgs,
  SelectToolArgs,
  SequencePlan,
  SequenceStep,
  SetModeArgs,
  StartWorkArgs,
  StartWorkData,
  SteerWorkArgs,
  SteerWorkData,
  ThreadTarget,
  WaitArgs,
  WorkStatusArgs,
  WorkStatusData,
  WorkTaskRef,
  WorkWaitArgs,
  WorkWaitData
} from "./types.js";
import { downloadLatestArtifact, listLatestArtifacts, waitForArtifact } from "./commands/artifacts.js";
import { attachFiles, downloadLatestFile, preflightFiles } from "./commands/files.js";
import { addProjectSources, buildProjectSourceAddPlan, listProjectSources } from "./commands/project-sources.js";
import { doctor, type DoctorArgs, type DoctorReport } from "./commands/doctor.js";
import { askMessage, composeMessage, messageStatus, readLatest, stopGeneration, submitMessage, waitAndRead, waitForMessage } from "./commands/messages.js";
import { getMode, selectTool, setMode } from "./commands/modes.js";
import { applyConfiguration, inspectConfiguration } from "./commands/configuration.js";
import { detectExperience, openExperience } from "./commands/experience.js";
import { createRunReport, type RunReportData, type RunReportOptions } from "./commands/reports.js";
import { copyResponse } from "./commands/response-actions.js";
import { commandDescriptors, describeCommand, helpText, type CommandDescriptor } from "./commands/registry.js";
import { runSequence } from "./commands/sequence.js";
import { bootstrap } from "./commands/session.js";
import { newThread, openThread, searchThreads } from "./commands/threads.js";
import { readLatestWork, startWork, steerWork, waitForWork, workStatus } from "./commands/work.js";
import { resultError, resultOk } from "./errors.js";
import { createChatGPTAgent } from "./runner/agent.js";
import type {
  ChatGPTAgent,
  ChatGPTAgentConfig,
  ChatGPTAttachmentInput,
  ChatGPTInputItem,
  ChatGPTResponse,
  ChatGPTRunDefaults,
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
import { explainCommandBlocker, type BlockerExplanation, type ExplainBlockerOptions } from "./diagnostics/blockers.js";
import {
  OperationClient,
  OperationClientError,
  type OperationAdapterFactory,
  type OperationAdapterFactoryContext,
  type OperationControlAdapterFactory,
  type OperationControlAdapterFactoryContext,
  type OperationClientCollectOptions,
  type OperationClientControlOptions,
  type OperationClientRunOptions,
  type OperationClientSubmitOptions,
  type OperationHandleAdapterFactory,
  type OperationHandleAdapterFactoryContext
} from "./operations/client.js";
import { JOURNAL_RUNTIME_UNAVAILABLE_MESSAGE, OperationJournal, OperationJournalError } from "./operations/journal.js";
import { createJournalRpcClientFromDescriptor } from "./operations/journal-rpc-client.js";
import type { OperationJournalAuthority } from "./operations/journal-authority.js";
import {
  OperationService,
  type OperationBrowserAdapter,
  type OperationServiceOptions
} from "./operations/service.js";
import type {
  OperationControlRequestV1,
  OperationConfigurationRequestV1,
  OperationHandleV1,
  OperationInputFileV1,
  OperationSubmitRequestV1
} from "./operations/types.js";
import {
  OPERATION_CONTROL_REQUEST_SCHEMA_VERSION,
  OPERATION_REQUEST_SCHEMA_VERSION
} from "./operations/types.js";
import type { CollectorResult } from "./operations/collector.js";
import type { ControlResult } from "./operations/control.js";
import type { OperationInspectResult, OperationRunResult, OperationSubmitResult } from "./operations/service.js";
import { createRuntimeEnvSession } from "./runtime/runtime-session.js";
import { coordinateRuntimeEnv } from "./runtime/coordinated-browser.js";
import {
  createChatGPTOperationAdapterFactory,
  createChatGPTOperationControlAdapterFactory,
  createChatGPTOperationHandleAdapterFactory
} from "./operations/chatgpt-runtime.js";
import type { CoordinatorOwner } from "./runtime/tab-coordinator.js";

export type ChatGPTClientOptions = RuntimeEnv & {
  defaults?: {
    experience?: Exclude<ChatGPTExperience, "unknown">;
    configuration?: ConfigurationSelection;
    mode?: SetModeArgs;
    wait?: boolean | WaitArgs;
    read?: boolean | ReadLatestArgs;
    existingTab?: BootstrapArgs["existingTab"];
    preferExistingTab?: boolean;
  };
  limits?: Partial<RunLimits>;
  reporting?: RunReportOptions;
  /** Additive transactional operation surface. Construction remains synchronous; journal opening is lazy. */
  operations?: ChatGPTOperationsOptions;
};

/**
 * Runner defaults contain the same fields as client defaults plus a default
 * thread selector.  Keep that extra field visible to the transactional
 * mapper; casting runner defaults down to client defaults used to silently
 * discard the runner's target choice and open a new thread instead.
 */
type TransactionalAskDefaults = ChatGPTClientOptions["defaults"] & Partial<ChatGPTRunDefaults>;

/**
 * Configuration for the additive transactional operation surface.
 *
 * The default state root is the platform application-state directory owned by
 * `OperationJournal`. Set `stateRoot` explicitly when multiple cooperating
 * clients must share a project-local journal. Browser adapters are opt-in:
 * without one, durable inspection still works but browser-touching calls fail
 * closed with an adapter blocker.
 */
export type ChatGPTOperationsOptions = Readonly<{
  stateRoot?: string;
  /** Explicit private-file connection to a normal Node journal authority. */
  journalService?: Readonly<{ descriptorPath: string; timeoutMs?: number }>;
  adapter?: OperationBrowserAdapter;
  adapterFactory?: OperationAdapterFactory;
  handleAdapterFactory?: OperationHandleAdapterFactory;
  /** Fresh request-local adapter for Stop or Work steer; never cached. */
  controlAdapterFactory?: OperationControlAdapterFactory;
  maxCachedAdapters?: number;
  maxCasRetries?: number;
}>;

/** Stable, lazily initialized facade exposed as `chatgpt.operations`. */
export type ChatGPTOperations = Readonly<{
  submit(request: OperationSubmitRequestV1, options?: OperationClientSubmitOptions): Promise<OperationSubmitResult>;
  collect(handle: OperationHandleV1, options?: OperationClientCollectOptions): Promise<CollectorResult>;
  inspect(handle: OperationHandleV1): Promise<OperationInspectResult>;
  control(request: OperationControlRequestV1, options?: OperationClientControlOptions): Promise<ControlResult>;
  run(request: OperationSubmitRequestV1, options?: OperationClientRunOptions): Promise<OperationRunResult>;
}>;

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
  /** Caller-owned durable identity. Supplying it opts this invocation into the transactional operation path. */
  operationId?: string;
  thread?: WorkflowThread;
  existingTab?: BootstrapArgs["existingTab"];
  preferExistingTab?: boolean;
  experience?: Exclude<ChatGPTExperience, "unknown">;
  configuration?: ConfigurationSelection;
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
  experience?: Exclude<ChatGPTExperience, "unknown">;
  configuration?: ConfigurationSelection;
  mode?: SetModeArgs;
  messages: Array<{
    id?: string;
    prompt: string;
    wait?: boolean | WaitArgs;
    read?: boolean | ReadLatestArgs;
  }>;
  report?: boolean | RunReportOptions;
};

export type NamedWorkflowInvocation = {
  name: string;
  input?: Record<string, unknown>;
  report?: boolean | RunReportOptions;
};

export type ChatGPTClient = {
  agent<TOutput = string>(config: ChatGPTAgentConfig<TOutput>): ChatGPTAgent<TOutput>;
  run<TOutput = string>(agent: ChatGPTAgent<TOutput>, input: ChatGPTRunInput): Promise<ChatGPTRunResult<TOutput>>;
  runner: ChatGPTRunner;
  operations: ChatGPTOperations;
  responses: {
    create(args: ChatGPTResponsesCreateArgs | Record<string, unknown>): Promise<ChatGPTResponse>;
  };
  ask(args: AskWorkflowArgs): Promise<CommandResult<unknown>>;
  askInThread(args: AskInThreadWorkflowArgs): Promise<CommandResult<unknown>>;
  askWithFiles(args: AskWithFilesWorkflowArgs): Promise<CommandResult<unknown>>;
  askAndDownload(args: AskAndDownloadWorkflowArgs): Promise<CommandResult<unknown>>;
  runMessages(args: RunMessagesArgs): Promise<CommandResult<unknown>>;
  openThread(thread: WorkflowThread): Promise<CommandResult<unknown>>;
  readLatest(args?: ReadLatestArgs): Promise<CommandResult<unknown>>;
  copyLatest(args?: CopyResponseArgs): Promise<CommandResult<unknown>>;
  downloadLatest(args: DownloadLatestArgs): Promise<CommandResult<unknown>>;
  artifacts: {
    listLatest(args?: ListArtifactsArgs): Promise<CommandResult<unknown>>;
    wait(args?: ArtifactWaitArgs): Promise<CommandResult<unknown>>;
    downloadLatest(args: ArtifactDownloadArgs): Promise<CommandResult<unknown>>;
  };
  runPlan(plan: SequencePlan | NamedWorkflowInvocation): Promise<CommandResult<unknown>>;
  doctor(args?: DoctorArgs): Promise<CommandResult<DoctorReport>>;
  createReport(result: CommandResult<unknown>, args?: RunReportOptions): Promise<CommandResult<RunReportData>>;
  explainBlocker(resultOrBlocker: CommandResult<unknown> | NonNullable<CommandResult["blocker"]> | undefined, options?: ExplainBlockerOptions): BlockerExplanation;
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
  };
  experience: {
    detect(args?: DetectExperienceArgs): Promise<CommandResult<DetectExperienceData>>;
    open(args: { experience: Exclude<ChatGPTExperience, "unknown">; timeoutMs?: number }): Promise<CommandResult<OpenExperienceData>>;
  };
  configuration: {
    inspect(args?: InspectConfigurationArgs): Promise<CommandResult<ConfigurationInspectionData>>;
    apply(args: ApplyConfigurationArgs): Promise<CommandResult<ApplyConfigurationData>>;
  };
  work: {
    start(args: StartWorkArgs): Promise<CommandResult<StartWorkData>>;
    status(args?: WorkStatusArgs): Promise<CommandResult<WorkStatusData>>;
    wait(args?: WorkWaitArgs): Promise<CommandResult<WorkWaitData>>;
    steer(args: SteerWorkArgs): Promise<CommandResult<SteerWorkData>>;
    readLatest(args?: ReadWorkLatestArgs): Promise<CommandResult<ReadWorkLatestData>>;
    artifacts: {
      listLatest(args?: ListArtifactsArgs): Promise<CommandResult<unknown>>;
      wait(args?: ArtifactWaitArgs): Promise<CommandResult<unknown>>;
      downloadLatest(args: ArtifactDownloadArgs): Promise<CommandResult<unknown>>;
    };
  };
  threads: {
    "new"(args?: NewThreadArgs): Promise<CommandResult<unknown>>;
    search(args: SearchThreadsArgs): Promise<CommandResult<unknown>>;
    open(args: OpenThreadArgs): Promise<CommandResult<unknown>>;
  };
  messages: {
    compose(args: { text: string; mode?: "replace" | "append"; timeoutMs?: number }): Promise<CommandResult<unknown>>;
    submit(args?: { text?: string; previousTurnCount?: number; timeoutMs?: number }): Promise<CommandResult<unknown>>;
    ask(args: AskArgs): Promise<CommandResult<unknown>>;
    wait(args?: WaitArgs): Promise<CommandResult<unknown>>;
    readLatest(args?: ReadLatestArgs): Promise<CommandResult<unknown>>;
    status(args?: MessageStatusArgs): Promise<CommandResult<unknown>>;
    stop(args: StopGenerationArgs): Promise<CommandResult<StopGenerationData>>;
    waitAndRead(args?: WaitArgs & ReadLatestArgs): Promise<CommandResult<unknown>>;
  };
  files: {
    preflight(args: FilePreflightArgs): Promise<CommandResult<FilePreflightData>>;
    attach(args: AttachFilesArgs): Promise<CommandResult<unknown>>;
    downloadLatest(args: DownloadLatestArgs): Promise<CommandResult<unknown>>;
  };
  projects: {
    sources: {
      list(args: ProjectSourcesListArgs): Promise<CommandResult<ProjectSourcesListData>>;
      planAdd(args: ProjectSourcesPlanAddArgs): Promise<CommandResult<ProjectSourcesAddPlanData>>;
      add(args: ProjectSourcesAddArgs): Promise<CommandResult<ProjectSourcesAddData | ProjectSourcesAddPlanData>>;
    };
  };
  modes: {
    set(args: SetModeArgs): Promise<CommandResult<unknown>>;
    get(args?: GetModeArgs): Promise<CommandResult<GetModeData>>;
  };
  tools: {
    select(args: SelectToolArgs): Promise<CommandResult<unknown>>;
  };
  response: {
    copy(args?: CopyResponseArgs): Promise<CommandResult<unknown>>;
  };
};

export function createChatGPT(options: ChatGPTClientOptions = {}): ChatGPTClient {
  // RuntimeEnv remains mutable for the legacy command implementations, but it
  // must never be shared by two public invocations.  The session owns only the
  // browser/page/tab snapshot; provider references are copied once and each
  // call receives its own mutable capture for the whole workflow.
  const runtimeEnvironment = runtimeEnv(options);
  const runtime = createRuntimeEnvSession(runtimeEnvironment);
  // The cached OperationClient must remain stable so request-local adapters
  // (including file/output closures) survive a submit -> collect sequence.
  // Its default ChatGPT factories, however, must see the invocation that is
  // currently using them. Async-local scope keeps concurrent calls from
  // replacing one another's browser/page snapshot.
  const operationRuntime = new AsyncLocalStorage<RuntimeEnv>();
  // A direct in-process client is one runtime lifetime. Keep its coordinator
  // identity stable across every operation while ensuring separately created
  // clients remain diagnostically distinguishable.
  const operationOwner: CoordinatorOwner = Object.freeze({
    backendSessionId: randomUUID()
  });
  const limits = normalizeLimits(options.limits);
  // Keep one promise for the lifetime of this client. Opening the journal is
  // deliberately deferred until an operation is actually requested, while
  // concurrent first calls still converge on one authenticated service/key.
  let operationClientPromise: Promise<OperationClient> | undefined;
  const operationClient = (): Promise<OperationClient> => {
    operationClientPromise ??= createOperationClientForChatGPT(
      options,
      () => operationRuntime.getStore() ?? runtimeEnvironment,
      operationOwner
    );
    return operationClientPromise;
  };
  const runOperationInvocation = <T>(callback: () => Promise<T>): Promise<T> => {
    const active = operationRuntime.getStore();
    if (active !== undefined) return callback();
    return runtime.run(env => operationRuntime.run(env, callback));
  };
  const operations: ChatGPTOperations = Object.freeze({
    submit: (request, operationOptions) => runOperationInvocation(
      () => operationClient().then(client => client.submit(request, operationOptions))
    ),
    collect: (handle, operationOptions) => runOperationInvocation(
      () => operationClient().then(client => client.collect(handle, operationOptions))
    ),
    inspect: handle => runOperationInvocation(
      () => operationClient().then(client => client.inspect(handle))
    ),
    control: (request, operationOptions) => runOperationInvocation(
      () => operationClient().then(client => client.control(request, operationOptions))
    ),
    run: (request, operationOptions) => runOperationInvocation(
      () => operationClient().then(client => client.run(request, operationOptions))
    )
  });
  const runnerRun = ((agent, input, runnerOptions?: { stream?: boolean }) => {
    const run = () => runtime.run(env => operationRuntime.run(env, () => runAgentWorkflow(
      agent,
      input,
      env,
      limits,
      options.defaults,
      options.reporting,
      options,
      operations
    )));
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
    operations,
    responses: {
      // Keep the entire Responses adapter, including its runner invocation,
      // inside one capture.  Passing a runner bound to this env avoids a
      // nested session capture for the same public workflow.
      create: args => runtime.run(env => operationRuntime.run(env, () => createResponse(
        args,
        (agent, input) => runAgentWorkflow(
          agent,
          input,
          env,
          limits,
          options.defaults,
          options.reporting,
          options,
          operations
        ),
        env.now
      )))
    },
    ask: args => runtime.run(env => operationRuntime.run(env, () => args.operationId === undefined
      ? runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting))
      : runTransactionalAsk(args, options.defaults, options, operations))),
    askInThread: args => runtime.run(env => operationRuntime.run(env, () => args.operationId === undefined
      ? runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting))
      : runTransactionalAsk(args, options.defaults, options, operations))),
    askWithFiles: args => runtime.run(env => operationRuntime.run(env, () => args.operationId === undefined
      ? runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting))
      : runTransactionalAsk(args, options.defaults, options, operations))),
    askAndDownload: args => runtime.run(env => operationRuntime.run(env, () => args.operationId === undefined
      ? runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting))
      : runTransactionalAsk(args, options.defaults, options, operations))),
    runMessages: args => runtime.run(env => runGuarded(planRunMessages(args, options.defaults), env, limits, reportOptions(args.report, options.reporting))),
    openThread: thread => runtime.run(env => runSequence(planOpenThread(thread), env)),
    readLatest: args => runtime.run(env => readLatest(env, args)),
    copyLatest: args => runtime.run(env => copyResponse(env, args)),
    downloadLatest: args => runtime.run(env => downloadLatestFile(env, args)),
    runPlan: plan => runtime.run(env => runPlanInvocation(plan, env, limits, options.defaults, options.reporting)),
    doctor: args => runtime.run(env => doctor(env, args)),
    createReport: (result, args) => runtime.run(env => createRunReport(env, result, args ?? options.reporting ?? {})),
    explainBlocker: (resultOrBlocker, args) => explainCommandBlocker(resultOrBlocker, args),
    reports: {
      create: (result, args) => runtime.run(env => createRunReport(env, result, args ?? options.reporting ?? {})),
      redact: async (value, args) => resultOk(redactReportValue(value, args), {}),
      summarize: async (result, args) => resultOk(redactReportValue(resultSummary(result), args), {})
    },
    plan: (name, args) => planByName(name, args, options.defaults),
    commands: filter => commandDescriptors().filter(descriptor => filter?.layer === undefined || descriptor.layer === filter.layer),
    describe: name => describeCommand(name),
    help: topic => helpText(topic),
    session: {
      bootstrap: args => runtime.run(env => bootstrap(env, args))
    },
    experience: {
      detect: args => runtime.run(env => detectExperience(env, args)),
      open: args => runtime.run(env => openExperience(env, args))
    },
    configuration: {
      inspect: args => runtime.run(env => inspectConfiguration(env, args)),
      apply: args => runtime.run(env => applyConfiguration(env, args))
    },
    work: {
      start: args => runtime.run(env => operationRuntime.run(env, () => args.operationId === undefined
        ? startWork(env, args)
        : runTransactionalWorkStart(args, options.defaults, operations))),
      status: args => runtime.run(env => workStatus(env, args)),
      wait: args => runtime.run(env => waitForWork(env, args)),
      steer: args => runtime.run(env => operationRuntime.run(env, () => hasTransactionalWorkControl(args)
        ? runTransactionalWorkSteer(args, operations)
        : steerWork(env, args))),
      readLatest: args => runtime.run(env => readLatestWork(env, args)),
      artifacts: {
        listLatest: args => runtime.run(env => listLatestArtifacts(env, args)),
        wait: args => runtime.run(env => waitForArtifact(env, args)),
        downloadLatest: args => runtime.run(env => downloadLatestArtifact(env, args))
      }
    },
    threads: {
      new: args => runtime.run(env => newThread(env, args)),
      search: args => runtime.run(env => searchThreads(env, args)),
      open: args => runtime.run(env => openThread(env, args))
    },
    messages: {
      compose: args => runtime.run(env => composeMessage(env, args)),
      submit: args => runtime.run(env => submitMessage(env, args)),
      ask: args => runtime.run(env => askMessage(env, args)),
      wait: args => runtime.run(env => waitForMessage(env, args)),
      readLatest: args => runtime.run(env => readLatest(env, args)),
      status: args => runtime.run(env => messageStatus(env, args)),
      stop: args => runtime.run(env => stopGeneration(env, args)),
      waitAndRead: args => runtime.run(env => waitAndRead(env, args))
    },
    files: {
      preflight: args => runtime.run(env => preflightFiles(env, args)),
      attach: args => runtime.run(env => attachFiles(env, args)),
      downloadLatest: args => runtime.run(env => downloadLatestFile(env, args))
    },
    projects: {
      sources: {
        list: args => runtime.run(env => listProjectSources(env, args)),
        planAdd: args => runtime.run(env => buildProjectSourceAddPlan(env, args)),
        add: args => runtime.run(env => addProjectSources(env, args))
      }
    },
    artifacts: {
      listLatest: args => runtime.run(env => listLatestArtifacts(env, args)),
      wait: args => runtime.run(env => waitForArtifact(env, args)),
      downloadLatest: args => runtime.run(env => downloadLatestArtifact(env, args))
    },
    modes: {
      set: args => runtime.run(env => setMode(env, args)),
      get: args => runtime.run(env => getMode(env, args))
    },
    tools: {
      select: args => runtime.run(env => selectTool(env, args))
    },
    response: {
      copy: args => runtime.run(env => copyResponse(env, args))
    }
  };
}

async function runGuarded(
  plan: SequencePlan,
  env: RuntimeEnv,
  limits: RunLimits,
  report: RunReportOptions | undefined
): Promise<CommandResult<unknown>> {
  const budget = checkRunBudget(plan, limits);
  if (budget !== undefined) return budget;

  const filePreflight = await preflightPlanFiles(plan, env);
  if (filePreflight !== undefined) return filePreflight;

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

async function preflightPlanFiles(
  plan: SequencePlan,
  env: RuntimeEnv
): Promise<CommandResult<unknown> | undefined> {
  const paths = plan.steps
    .flatMap(step => step.command === "files.attach" ? pathsFromAttachStep(step) : []);
  if (paths.length === 0) return undefined;

  const result = await preflightFiles(env, { paths });
  return result.ok ? undefined : result;
}

function pathsFromAttachStep(step: Extract<SequenceStep, { command: "files.attach" }>): string[] {
  const paths = step.args.paths;
  return paths.every(item => typeof item === "string") ? paths : [];
}

function appendSurfaceConfigurationSteps(
  steps: SequencePlan["steps"],
  preferences: {
    experience: Exclude<ChatGPTExperience, "unknown"> | undefined;
    configuration: ConfigurationSelection | undefined;
    mode: SetModeArgs | undefined;
  }
): void {
  if (preferences.experience !== undefined) {
    steps.push({
      id: "experience",
      command: "experience.open",
      args: { experience: preferences.experience }
    });
  }
  if (preferences.configuration !== undefined) {
    steps.push({
      id: "configuration",
      command: "configuration.apply",
      args: {
        ...(preferences.experience === undefined ? {} : { experience: preferences.experience }),
        desired: preferences.configuration,
        strict: true
      }
    });
    return;
  }
  if (preferences.mode !== undefined) {
    steps.push({ id: "mode", command: "modes.set", args: preferences.mode });
  }
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
  const reads = plan.steps.filter(step => step.command === "messages.readLatest" || step.command === "messages.status" || step.command === "messages.waitAndRead" || step.command === "response.copy").length
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
  run: <TOutput = string>(
    agent: ChatGPTAgent<TOutput>,
    input: ChatGPTRunInput
  ) => Promise<ChatGPTRunResult<TOutput>>,
  now: RuntimeEnv["now"] | undefined
): Promise<ChatGPTResponse> {
  const validation = validateResponsesCreateArgs(args as Record<string, unknown>);
  const timestamp = now?.() ?? new Date();
  if (!validation.ok) {
    return unsupportedResponse(
      validation.unsupported,
      timestamp,
      readOperationIdFromUnknown(args)
    );
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
  const result = await run(agent, responsesCreateArgsToRunInput(responseArgs));
  return responseFromRunResult(result, now?.() ?? timestamp);
}

async function runAgentWorkflow<TOutput>(
  agent: ChatGPTAgent<TOutput>,
  input: ChatGPTRunInput,
  env: RuntimeEnv,
  limits: RunLimits,
  defaults: ChatGPTClientOptions["defaults"] | undefined,
  reporting: RunReportOptions | undefined,
  clientOptions: ChatGPTClientOptions,
  operations: ChatGPTOperations
): Promise<ChatGPTRunResult<TOutput>> {
  const requestedOperationId = runnerOperationId(input);
  try {
    const normalized = normalizeRunnerInput(agent, input);
    if (normalized.operationId !== undefined) {
      const result = await runTransactionalRunnerWorkflow(
        agent,
        normalized,
        defaults,
        clientOptions,
        operations
      );
      return toRunResult(agent, result);
    }
    const plan = planAgentWorkflowFromNormalized(agent, normalized, defaults);
    const report = reportOptions(normalized.report ?? agent.defaults.report, reporting);
    const result = await runGuarded(plan, env, limits, report);
    return toRunResult(agent, result);
  } catch (error) {
    const result = requestedOperationId === undefined
      ? resultError(error instanceof Error ? error : new Error(String(error)), {})
      : transactionalAskError(requestedOperationId, error);
    return toRunResult(agent, result);
  }
}

/**
 * Runner opt-in adapter.  It deliberately funnels through the same
 * transactional ask preparation/result mapping used by the high-level Chat
 * helpers so request identity, file manifests, action journaling, and
 * structured blocker handling cannot drift between surfaces.
 */
async function runTransactionalRunnerWorkflow<TOutput>(
  agent: ChatGPTAgent<TOutput>,
  input: NormalizedRunnerInput,
  defaults: ChatGPTClientOptions["defaults"] | undefined,
  clientOptions: ChatGPTClientOptions,
  operations: ChatGPTOperations
): Promise<CommandResult<unknown>> {
  const operationId = input.operationId;
  if (operationId === undefined) {
    return transactionalAskError("invalid-operation", new Error("Transactional runner input is missing operationId."));
  }
  if (agent.instructionsMode === "visible_setup_message" && hasInstructions(agent)) {
    const unsupported = transactionalUnsupported(
      operationId,
      "visible_setup_message requires a separate setup turn and is not supported by one transactional operation.",
      "agent.instructionsMode"
    );
    return unsupported.ok ? transactionalAskError(operationId, new Error("Invalid transactional runner input.")) : unsupported.result;
  }
  if (input.copy !== undefined && input.copy !== false) {
    const unsupported = transactionalUnsupported(
      operationId,
      "copy is not supported by the transactional runner path; use operations.collect and an explicit response action.",
      "copy"
    );
    return unsupported.ok ? transactionalAskError(operationId, new Error("Invalid transactional runner input.")) : unsupported.result;
  }

  // Match the legacy precedence exactly: input values win, then agent
  // defaults, then client defaults.  The transactional mapper performs the
  // same merge for target/configuration/wait/read as the Chat ask surface.
  const effectiveDefaults = {
    ...(defaults ?? {}),
    ...agent.defaults
  } as TransactionalAskDefaults;
  const report = input.report ?? agent.defaults.report;
  const result = await runTransactionalAsk(
    {
      operationId,
      prompt: renderRunnerPrompt(agent, input.prompt),
      ...(input.thread === undefined ? {} : { thread: input.thread }),
      ...(input.existingTab === undefined ? {} : { existingTab: input.existingTab }),
      ...(input.preferExistingTab === undefined ? {} : { preferExistingTab: input.preferExistingTab }),
      ...(input.experience === undefined ? {} : { experience: input.experience }),
      ...(input.configuration === undefined ? {} : { configuration: input.configuration }),
      ...(input.mode === undefined ? {} : { mode: input.mode }),
      ...(input.tools.length === 0 ? {} : { tools: input.tools }),
      ...(input.files.length === 0 ? {} : { files: input.files }),
      ...(input.wait === undefined ? {} : { wait: input.wait }),
      ...(input.read === undefined ? {} : { read: input.read }),
      ...(report === undefined ? {} : { report }),
      ...(input.download === undefined || input.download === false ? {} : { download: input.download })
    },
    effectiveDefaults,
    clientOptions,
    operations
  );
  return result;
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
  operationId?: string;
  thread?: WorkflowThread;
  existingTab?: BootstrapArgs["existingTab"];
  preferExistingTab?: boolean;
  experience?: Exclude<ChatGPTExperience, "unknown">;
  configuration?: ConfigurationSelection;
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
  const artifactDownload = input.download !== undefined && input.download !== false && usesCreateImageTool(input.tools);
  const steps: SequencePlan["steps"] = [
    bootstrapStepForWorkflow(
      thread,
      input.existingTab ?? agent.defaults.existingTab ?? defaults.existingTab,
      input.preferExistingTab ?? agent.defaults.preferExistingTab ?? defaults.preferExistingTab
    ),
    ...threadSteps(thread)
  ];

  appendSurfaceConfigurationSteps(steps, {
    experience: input.experience ?? agent.defaults.experience ?? defaults.experience,
    configuration: input.configuration ?? agent.defaults.configuration ?? defaults.configuration,
    mode: input.mode ?? agent.defaults.mode ?? defaults.mode
  });
  for (const [index, tool] of input.tools.entries()) {
    steps.push({ id: `tool${index + 1}`, command: "tools.select", args: tool });
  }
  if (input.files.length > 0) {
    steps.push({ id: "attach", command: "files.attach", args: { paths: input.files } });
  }
  if (artifactDownload) {
    steps.push({ id: "artifactBaseline", command: "artifacts.listLatest", args: { kind: "image" } });
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
      wait: artifactDownload ? false : wait,
      read: artifactDownload ? false : read
    }
  });

  if (artifactDownload) {
    steps.push({
      id: "artifact",
      command: "artifacts.wait",
      args: artifactWaitArgs(wait, input.download === false ? undefined : input.download)
    });
  }

  if (input.copy !== undefined && input.copy !== false) {
    steps.push({ id: "copy", command: "response.copy", args: input.copy });
  }
  if (input.download !== undefined && input.download !== false) {
    steps.push({ id: "download", command: artifactDownload ? "artifacts.downloadLatest" : "files.downloadLatest", args: input.download });
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

  if (args.operationId !== undefined) normalized.operationId = args.operationId;
  if (args.thread !== undefined) normalized.thread = args.thread;
  if (args.existingTab !== undefined) normalized.existingTab = args.existingTab;
  if (args.preferExistingTab !== undefined) normalized.preferExistingTab = args.preferExistingTab;
  if (args.experience !== undefined) normalized.experience = args.experience;
  if (args.configuration !== undefined) normalized.configuration = args.configuration;
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

function runnerOperationId(input: ChatGPTRunInput): string | undefined {
  return typeof input === "string" ? undefined : input.operationId;
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
  if (options.expectedTabId !== undefined) env.expectedTabId = options.expectedTabId;
  // Coordinate only the browser/page snapshot. The runtime session still
  // owns invocation isolation and compatibility mutation semantics for the
  // legacy fields; browser methods themselves use the process-wide actor.
  return coordinateRuntimeEnv(env);
}

async function createOperationClientForChatGPT(
  options: ChatGPTClientOptions,
  runtimeEnvironment: () => RuntimeEnv,
  owner: CoordinatorOwner
): Promise<OperationClient> {
  const operationOptions = options.operations ?? {};
  if (operationOptions.journalService !== undefined && operationOptions.stateRoot !== undefined) {
    throw new OperationJournalError("journal_service_configuration_conflict", "The journal service owns its state root; configure either journalService or stateRoot.");
  }
  const journal: OperationJournalAuthority = operationOptions.journalService === undefined
    ? await OperationJournal.open(operationOptions.stateRoot === undefined ? {} : { stateRoot: operationOptions.stateRoot })
    : await createJournalRpcClientFromDescriptor(operationOptions.journalService.descriptorPath, {
        ...(operationOptions.journalService.timeoutMs === undefined ? {} : { timeoutMs: operationOptions.journalService.timeoutMs })
      });
  const serviceOptions: OperationServiceOptions = {
    ...(operationOptions.maxCasRetries === undefined ? {} : { maxCasRetries: operationOptions.maxCasRetries }),
    ...(options.now === undefined ? {} : { now: () => options.now!().getTime() })
  };
  const service = new OperationService(journal, serviceOptions);
  const adapter = operationOptions.adapter ?? unavailableOperationAdapter();
  // Supplying any custom adapter seam is an explicit integration choice. Do
  // not combine one half of a custom provider with the default ChatGPT
  // recovery path. With no customization, however, browser-touching
  // operations work out of the box and remain lazy until target resolution.
  const hasCustomAdapter = operationOptions.adapter !== undefined
    || operationOptions.adapterFactory !== undefined
    || operationOptions.handleAdapterFactory !== undefined
    || operationOptions.controlAdapterFactory !== undefined;
  const evidenceDigest = (domain: string, material: unknown): string | Promise<string> => {
    // Provider primitives use both the journal's short labels and their own
    // versioned slash-separated domains. Preserve short labels verbatim so
    // service-side identities (notably file manifests) remain identical;
    // envelope provider domains inside one bounded journal namespace rather
    // than allowing the provider label to violate the journal API.
    if (/^[a-z][a-z0-9-]{0,63}$/u.test(domain)) {
      return journal.evidenceDigest(domain, material);
    }
    return journal.evidenceDigest("provider-evidence", { domain, material });
  };
  const adapterFactory = hasCustomAdapter
    ? operationOptions.adapterFactory
    : async (context: OperationAdapterFactoryContext) => createChatGPTOperationAdapterFactory({
      env: runtimeEnvironment(),
      owner,
      evidenceDigest
    })(context);
  const handleAdapterFactory = hasCustomAdapter
    ? operationOptions.handleAdapterFactory
    : async (context: OperationHandleAdapterFactoryContext) => createChatGPTOperationHandleAdapterFactory({
      env: runtimeEnvironment(),
      owner,
      evidenceDigest
    })(context);
  const controlAdapterFactory = hasCustomAdapter
    ? operationOptions.controlAdapterFactory
    : async (context: OperationControlAdapterFactoryContext) => createChatGPTOperationControlAdapterFactory({
      env: runtimeEnvironment(),
      owner,
      evidenceDigest
    })(context);
  return new OperationClient(service, adapter, {
    ...(adapterFactory === undefined ? {} : { adapterFactory }),
    ...(handleAdapterFactory === undefined ? {} : { handleAdapterFactory }),
    ...(controlAdapterFactory === undefined ? {} : { controlAdapterFactory }),
    ...(operationOptions.maxCachedAdapters === undefined ? {} : { maxCachedAdapters: operationOptions.maxCachedAdapters })
  });
}

/**
 * A conservative placeholder keeps the public facade constructible for
 * browser-free inspection and for callers that provide factories later. It
 * never probes a page, claims capabilities, or synthesizes a successful
 * operation result; all browser-touching paths fail closed.
 */
function unavailableOperationAdapter(): OperationBrowserAdapter {
  const unavailable = async (): Promise<never> => {
    throw new OperationClientError(
      "adapter_unavailable",
      "A browser-bound operation adapter is required for this operation."
    );
  };
  return {
    resolveTarget: unavailable as OperationBrowserAdapter["resolveTarget"],
    submission: {
      observeStaging: unavailable,
      executeFileHandoffOnce: unavailable,
      observeAttachments: unavailable,
      // Send is deliberately exposed as explicit phases.  The placeholder
      // has no browser capability, so every phase fails closed; retaining the
      // legacy method below is source compatibility only and is never used by
      // the transactional coordinator.
      prepareSend: unavailable,
      executePreparedSend: unavailable,
      verifyPreparedSend: unavailable,
      recoverSend: unavailable,
      executeFinalTabTransaction: unavailable
    } as OperationBrowserAdapter["submission"],
    collector: {
      readContext: unavailable,
      observe: unavailable,
      sleep: unavailable
    } as OperationBrowserAdapter["collector"]
  };
}

/**
 * The transactional high-level path is deliberately opt-in.  Keep this
 * adapter narrow: it translates the existing workflow vocabulary into the
 * immutable operation request, then exposes only operation-safe result data.
 * In particular, no legacy sequence is allowed to run before validation has
 * rejected an unsupported combination.
 */
type TransactionalAskPreparation = Readonly<{
  request: OperationSubmitRequestV1;
  options: OperationClientRunOptions;
  responseFormat: TransactionalResponseFormat;
  maxResponseChars?: number;
}>;

type TransactionalAskPreparationResult =
  | { ok: true; value: TransactionalAskPreparation }
  | { ok: false; result: CommandResult<unknown> };

type TransactionalAskData = Readonly<{
  operationId: string;
  responseFormat: TransactionalResponseFormat;
  handle?: OperationHandleV1;
  requestDigest?: string;
  pending?: boolean;
  responseText?: string;
  responseDigest?: string;
  responseBytes?: number;
  complete?: boolean;
  submissionState?: "not_submitted" | "submitted" | "submitted_unconfirmed" | "submitted_generating";
  completionState?: "complete" | "generating" | "stopped" | "partial" | "unknown";
  generationActive?: boolean;
  artifacts?: unknown;
}>;

const TRANSACTIONAL_OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

async function runTransactionalAsk(
  args: AskWorkflowArgs,
  defaults: TransactionalAskDefaults | undefined,
  clientOptions: ChatGPTClientOptions,
  operations: ChatGPTOperations
): Promise<CommandResult<unknown>> {
  const prepared = prepareTransactionalAsk(args, defaults, clientOptions);
  if (!prepared.ok) return prepared.result;

  try {
    // Route through the public, stable facade so this path has exactly the
    // same identity/journal semantics as callers using chatgpt.operations.run.
    const run = await operations.run(prepared.value.request, prepared.value.options);
    const handle = await freshestOperationHandle(operations, run.submit.handle);
    return transactionalAskCommandResult(prepared.value, run, handle);
  } catch (error) {
    // OperationClient and adapter errors are intentionally converted to a
    // bounded structured result.  Their native messages may include a path,
    // URL, prompt, or provider-private text and must not cross this boundary.
    return transactionalAskError(args.operationId!, error);
  }
}

/**
 * Work's public workflow keeps its existing command implementation as the
 * compatibility path.  An explicit operation ID opts only this client call
 * into the durable submit/collect protocol; the low-level `startWork` command
 * remains available to sequence callers unchanged.
 */
async function runTransactionalWorkStart(
  args: StartWorkArgs,
  defaults: ChatGPTClientOptions["defaults"] | undefined,
  operations: ChatGPTOperations
): Promise<CommandResult<StartWorkData>> {
  const prepared = prepareTransactionalWorkStart(args, defaults);
  if (!prepared.ok) return prepared.result;

  try {
    const run = await operations.run(prepared.value.request, prepared.value.options);
    const handle = await freshestOperationHandle(operations, run.submit.handle);
    const task = await transactionalWorkTask(operations, handle);
    return transactionalWorkStartResult(prepared.value, run, handle, task);
  } catch (error) {
    return transactionalWorkError(args.operationId!, error);
  }
}

type TransactionalWorkStartPreparation = Readonly<{
  request: OperationSubmitRequestV1;
  options: OperationClientRunOptions;
  readRequested: boolean;
  responseFormat: TransactionalResponseFormat;
  maxResponseChars?: number;
}>;

type TransactionalResponseFormat = Extract<ResponseFormat, "markdown" | "text">;

type TransactionalWorkStartPreparationResult =
  | { ok: true; value: TransactionalWorkStartPreparation }
  | { ok: false; result: CommandResult<StartWorkData> };

function prepareTransactionalWorkStart(
  args: StartWorkArgs,
  defaults: ChatGPTClientOptions["defaults"] | undefined
): TransactionalWorkStartPreparationResult {
  const operationId = args.operationId;
  if (operationId === undefined || !TRANSACTIONAL_OPERATION_ID_PATTERN.test(operationId)) {
    return {
      ok: false,
      result: transactionalWorkStartUnsupported(operationId, "operationId must be a canonical UUID.", "operationId")
    };
  }
  if (args.prompt.trim().length === 0) {
    return {
      ok: false,
      result: transactionalWorkStartUnsupported(operationId, "prompt must be non-empty.", "prompt")
    };
  }
  if (args.timeoutMs !== undefined && (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs < 1 || args.timeoutMs > 86_400_000)) {
    return {
      ok: false,
      result: transactionalWorkStartUnsupported(operationId, "timeoutMs must be between 1 and 86400000.", "timeoutMs")
    };
  }

  const wait = args.wait ?? false;
  const read = args.read ?? false;
  const waitOptions = transactionalWorkWaitOptions(wait, read);
  if (!waitOptions.ok) {
    return { ok: false, result: transactionalWorkStartUnsupported(operationId, waitOptions.message, waitOptions.fieldPath) };
  }

  const configuration = transactionalWorkConfiguration(args.configuration ?? defaults?.configuration);
  if (!configuration.ok) {
    return { ok: false, result: transactionalWorkStartUnsupported(operationId, configuration.message, configuration.fieldPath) };
  }

  const files = (args.files ?? []).map(path => ({ path }));
  const request: OperationSubmitRequestV1 = {
    schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
    operationId,
    surface: "work",
    prompt: args.prompt,
    target: args.newTask === false ? { type: "selected_tab" } : { type: "new" },
    ...(configuration.value === undefined ? {} : { configuration: configuration.value }),
    ...(files.length === 0 ? {} : { files }),
    capture: {
      responseContent: waitOptions.responseContent,
      responseFormat: waitOptions.responseFormat,
      artifacts: "receipt_only"
    }
  };
  return {
    ok: true,
    value: {
      request,
      options: {
        ...waitOptions.options,
        ...(args.timeoutMs === undefined || typeof wait !== "object" || wait.timeoutMs !== undefined
          ? {}
          : { timeoutMs: args.timeoutMs })
      },
      readRequested: waitOptions.readRequested,
      responseFormat: waitOptions.responseFormat,
      ...(waitOptions.maxResponseChars === undefined ? {} : { maxResponseChars: waitOptions.maxResponseChars })
    }
  };
}

type TransactionalWorkConfigurationResult =
  | { ok: true; value?: OperationConfigurationRequestV1 }
  | { ok: false; message: string; fieldPath: string };

function transactionalWorkConfiguration(
  selected: ConfigurationSelection | undefined
): TransactionalWorkConfigurationResult {
  if (selected === undefined) return { ok: true };
  const value: OperationConfigurationRequestV1 = { experience: "work" };
  if (selected.model !== undefined) value.model = selected.model;
  const modelVersion = selected.modelVersion ?? selected.version;
  if (modelVersion !== undefined) value.modelVersion = modelVersion;
  const additional: Record<string, string> = {};
  if (selected.effort !== undefined) additional.effort = selected.effort;
  if (selected.speed !== undefined) additional.speed = selected.speed;
  if (selected.intelligence !== undefined) {
    return {
      ok: false,
      message: "configuration.intelligence is not supported by the transactional Work path.",
      fieldPath: "configuration.intelligence"
    };
  }
  if (Object.keys(additional).length > 0) value.additional = additional;
  return { ok: true, value };
}

type TransactionalWorkWaitResult =
  | {
      ok: true;
      options: OperationClientRunOptions;
      responseContent: "include" | "metadata";
      readRequested: boolean;
      responseFormat: TransactionalResponseFormat;
      maxResponseChars?: number;
    }
  | { ok: false; message: string; fieldPath: string };

function transactionalWorkWaitOptions(
  wait: boolean | WaitArgs,
  read: boolean | ReadLatestArgs
): TransactionalWorkWaitResult {
  const readRequested = read === true || typeof read === "object";
  const responseFormat: TransactionalResponseFormat = typeof read === "object" && read.format === "text"
    ? "text"
    : "markdown";
  const maxResponseChars = typeof read === "object" ? read.maxChars : undefined;
  if (
    maxResponseChars !== undefined
    && (!Number.isSafeInteger(maxResponseChars) || maxResponseChars < 0 || maxResponseChars > 8 * 1024 * 1024)
  ) {
    return { ok: false, message: "read.maxChars must be between 0 and 8388608.", fieldPath: "read.maxChars" };
  }
  if (typeof read === "object") {
    if (read.role !== undefined && read.role !== "assistant") {
      return { ok: false, message: "read.role=user is not supported by the transactional Work path.", fieldPath: "read.role" };
    }
    if (read.format !== undefined && read.format !== "markdown" && read.format !== "text") {
      return { ok: false, message: "read.format must be markdown or text on the transactional Work path.", fieldPath: "read.format" };
    }
  }
  if (typeof wait === "object") {
    if (wait.timeoutMs !== undefined && (!Number.isSafeInteger(wait.timeoutMs) || wait.timeoutMs < 1 || wait.timeoutMs > 86_400_000)) {
      return { ok: false, message: "wait.timeoutMs must be between 1 and 86400000.", fieldPath: "wait.timeoutMs" };
    }
    if (wait.pollMs !== undefined && (!Number.isSafeInteger(wait.pollMs) || wait.pollMs < 0 || wait.pollMs > 60_000)) {
      return { ok: false, message: "wait.pollMs must be between 0 and 60000.", fieldPath: "wait.pollMs" };
    }
    if (wait.responseContent !== undefined && wait.responseContent !== "include" && wait.responseContent !== "metadata") {
      return { ok: false, message: "wait.responseContent must be include or metadata.", fieldPath: "wait.responseContent" };
    }
    for (const [key, value] of [
      ["afterTurnCount", wait.afterTurnCount],
      ["afterAssistantTurnCount", wait.afterAssistantTurnCount],
      ["afterStep", wait.afterStep],
      ["stableMs", wait.stableMs],
      ["mode", wait.mode]
    ] as const) {
      if (value !== undefined) {
        return { ok: false, message: `wait.${key} is not supported by the transactional Work path.`, fieldPath: `wait.${key}` };
      }
    }
  }
  // A Work read is collect-only.  If the caller asks to read without an
  // explicit wait, collect still waits for the exact owned turn rather than
  // falling back to a page-wide latest response.
  const waitForOwnedTurn = wait !== false || readRequested;
  const responseContent = typeof wait === "object" && wait.responseContent !== undefined
    ? wait.responseContent
    : readRequested ? "include" : "metadata";
  const options: OperationClientRunOptions = {
    wait: waitForOwnedTurn,
    responseContent,
    ...(typeof wait === "object" && wait.timeoutMs === undefined ? {} : typeof wait === "object" ? { timeoutMs: wait.timeoutMs } : {}),
    ...(typeof wait === "object" && wait.pollMs === undefined ? {} : typeof wait === "object" ? { pollIntervalMs: wait.pollMs } : {})
  };
  return {
    ok: true,
    options,
    responseContent,
    readRequested,
    responseFormat,
    ...(maxResponseChars === undefined ? {} : { maxResponseChars })
  };
}

async function transactionalWorkTask(
  operations: ChatGPTOperations,
  handle: OperationHandleV1
): Promise<WorkTaskRef> {
  try {
    const inspected = await operations.inspect(handle);
    const target = inspected.state.target;
    return {
      ...(target?.canonicalThreadUrl === undefined ? {} : { url: target.canonicalThreadUrl }),
      ...(target?.conversationId === undefined ? {} : { conversationId: target.conversationId })
    };
  } catch {
    return {};
  }
}

function transactionalWorkStartResult(
  prepared: TransactionalWorkStartPreparation,
  run: OperationRunResult,
  handle: OperationHandleV1,
  task: WorkTaskRef
): CommandResult<StartWorkData> {
  const base: StartWorkData = {
    task,
    responseFormat: prepared.responseFormat,
    operationId: handle.operationId,
    handle,
    requestDigest: handle.requestDigest,
    submitted: {
      submitted: false,
      submissionState: transactionalSubmissionState(
        handle,
        "blocker" in run.submit.submission ? run.submit.submission.blocker.mutationBoundary : handle.mutationBoundary
      ),
      completionState: transactionalCompletionState(handle.phase),
      generationActive: handle.phase === "generating"
    }
  };
  const submission = run.submit.submission;
  if (submission.kind === "blocked" || submission.kind === "uncertain" || submission.kind === "cancelled") {
    const submitted = {
      ...base,
      submitted: {
        ...base.submitted,
        submitted: base.submitted.submissionState !== "not_submitted"
      }
    };
    return transactionalWorkBlockerResult(
      submitted,
      submission.blocker.code,
      submission.kind === "uncertain" || submission.blocker.mutationBoundary !== "none",
      submission.blocker.observationRequired
    );
  }

  base.submitted = {
    ...base.submitted,
    submitted: true,
    submissionState: "submitted",
    completionState: handle.phase === "generating" ? "generating" : handle.phase === "completed" ? "complete" : "unknown",
    generationActive: handle.phase === "generating"
  };
  const collected = run.collect;
  if (collected === undefined) {
    return {
      ok: true,
      status: "ok",
      data: { ...base, pending: true, complete: handle.phase === "completed" },
      warnings: ["Work was submitted through the transactional path; collect the returned handle to observe its exact assistant turn."],
      context: { timestamp: new Date().toISOString(), experience: "work" }
    };
  }
  if (collected.kind === "completed") {
    const rawText = prepared.request.capture?.responseContent === "include" ? collected.response.rawText : undefined;
    const responseText = rawText === undefined
      ? undefined
      : prepared.maxResponseChars === undefined
        ? rawText
        : rawText.slice(0, prepared.maxResponseChars);
    const response = prepared.readRequested && responseText !== undefined
      ? {
          role: "assistant" as const,
          text: responseText,
          format: prepared.responseFormat === "text" ? "normalized_text" as const : "markdown" as const,
          completionState: "complete" as const,
          generationActive: false
        }
      : undefined;
    const data: StartWorkData = {
      ...base,
      complete: true,
      ...(collected.response.text?.digest === undefined ? {} : { responseDigest: collected.response.text.digest }),
      ...(collected.response.text?.bytes === undefined ? {} : { responseBytes: collected.response.text.bytes }),
      ...(response === undefined ? {} : { response }),
      submitted: {
        ...base.submitted,
        completionState: "complete",
        generationActive: false
      }
    };
    return { ok: true, status: "ok", data, warnings: [], context: { timestamp: new Date().toISOString(), experience: "work" } };
  }
  if (collected.kind === "pending") {
    return {
      ok: false,
      status: "partial",
      data: {
        ...base,
        pending: true,
        complete: false,
        submitted: {
          ...base.submitted,
          completionState: collected.phase === "generating" ? "generating" : "unknown",
          generationActive: collected.phase === "generating"
        }
      },
      warnings: ["Work was submitted exactly once, but completion was not verified."],
      context: { timestamp: new Date().toISOString(), experience: "work" }
    };
  }
  return transactionalWorkBlockerResult(
    base,
    collected.blocker.code,
    collected.blocker.mutationBoundary !== "none",
    true
  );
}

function hasTransactionalWorkControl(args: SteerWorkArgs): boolean {
  return args.operationId !== undefined
    || args.handle !== undefined
    || args.controlActionId !== undefined
    || args.expectedAssistantTurnId !== undefined;
}

async function runTransactionalWorkSteer(
  args: SteerWorkArgs,
  operations: ChatGPTOperations
): Promise<CommandResult<SteerWorkData>> {
  const operationId = args.operationId ?? args.handle?.operationId;
  if (args.prompt.trim().length === 0) {
    return transactionalWorkSteerUnsupported(operationId, "prompt must be non-empty.", "prompt");
  }
  if (args.handle === undefined) {
    return transactionalWorkSteerUnsupported(operationId, "a durable parent handle is required for transactional Work steer.", "handle");
  }
  if (args.handle.surface !== "work") {
    return transactionalWorkSteerUnsupported(operationId, "the parent handle must belong to the Work surface.", "handle.surface", args.handle);
  }
  if (args.handle.phase !== "generating") {
    return transactionalWorkSteerUnsupported(operationId, "the parent handle must identify a generating Work operation.", "handle.phase", args.handle);
  }
  if (args.handle.targetBindingDigest === undefined) {
    return transactionalWorkSteerUnsupported(operationId, "the parent handle must carry an exact target binding.", "handle.targetBindingDigest", args.handle);
  }
  if (operationId === undefined || !TRANSACTIONAL_OPERATION_ID_PATTERN.test(operationId)) {
    return transactionalWorkSteerUnsupported(operationId, "operationId must be a canonical UUID.", "operationId", args.handle);
  }
  if (args.handle.operationId !== operationId) {
    return transactionalWorkSteerUnsupported(operationId, "operationId must match handle.operationId.", "operationId", args.handle);
  }
  if (args.controlActionId === undefined || !TRANSACTIONAL_OPERATION_ID_PATTERN.test(args.controlActionId)) {
    return transactionalWorkSteerUnsupported(operationId, "controlActionId must be a canonical UUID.", "controlActionId", args.handle);
  }
  if (args.expectedAssistantTurnId === undefined || !/^[A-Za-z0-9._:-]{1,512}$/u.test(args.expectedAssistantTurnId)) {
    return transactionalWorkSteerUnsupported(operationId, "expectedAssistantTurnId must identify one exact assistant turn.", "expectedAssistantTurnId", args.handle);
  }
  if (args.wait !== undefined && args.wait !== false) {
    return transactionalWorkSteerUnsupported(operationId, "wait is not supported by transactional Work steer; collect the parent operation separately.", "wait", args.handle);
  }
  if (args.read !== undefined && args.read !== false) {
    return transactionalWorkSteerUnsupported(operationId, "read is not supported by transactional Work steer; collect the parent operation separately.", "read", args.handle);
  }
  if (args.timeoutMs !== undefined && (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs < 0 || args.timeoutMs > 86_400_000)) {
    return transactionalWorkSteerUnsupported(operationId, "timeoutMs must be between 0 and 86400000.", "timeoutMs", args.handle);
  }
  const request: OperationControlRequestV1 = {
    schemaVersion: OPERATION_CONTROL_REQUEST_SCHEMA_VERSION,
    controlActionId: args.controlActionId,
    parent: args.handle,
    action: "steer",
    expectedAssistantTurnId: args.expectedAssistantTurnId,
    steerPrompt: args.prompt,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
  };
  try {
    const result = await operations.control(request);
    const data: SteerWorkData = {
      operationId,
      controlActionId: result.controlActionId,
      requestDigest: result.requestDigest,
      handle: args.handle,
      parentHandle: args.handle,
      ...(result.kind === "completed" || result.receipt === undefined ? {} : { control: result.receipt }),
      ...(result.kind === "completed" ? { control: result.receipt } : {})
    };
    if (result.kind === "completed") {
      return {
        ok: true,
        status: "ok",
        data,
        warnings: ["Work steer was bound to the supplied assistant turn and authorized at most one browser action."],
        context: { timestamp: new Date().toISOString(), experience: "work" }
      };
    }
    return transactionalWorkBlockerResult(
      data,
      result.blocker.code,
      result.kind === "uncertain" || result.blocker.mutationBoundary !== "none",
      result.blocker.observationRequired
    );
  } catch (error) {
    return transactionalWorkError(operationId, error, args.controlActionId, args.handle);
  }
}

function transactionalWorkStartUnsupported(
  operationId: string | undefined,
  message: string,
  fieldPath: string
): CommandResult<StartWorkData> {
  const unsupported = transactionalUnsupported(operationId, message, fieldPath);
  if (unsupported.ok) {
    return {
      ok: false,
      status: "error",
      data: {
        task: {},
        submitted: { submitted: false, submissionState: "not_submitted" },
        ...(operationId === undefined ? {} : { operationId })
      },
      warnings: [],
      error: { name: "OperationInputError", message, recoverable: false },
      context: { timestamp: new Date().toISOString(), experience: "work" }
    };
  }
  return {
    ...unsupported.result,
    data: {
      task: {},
      submitted: { submitted: false, submissionState: "not_submitted" },
      ...(operationId === undefined ? {} : { operationId })
    }
  };
}

function transactionalWorkSteerUnsupported(
  operationId: string | undefined,
  message: string,
  fieldPath: string,
  handle?: OperationHandleV1
): CommandResult<SteerWorkData> {
  const unsupported = transactionalUnsupported(operationId, message, fieldPath);
  if (unsupported.ok) {
    return {
      ok: false,
      status: "error",
      data: {
        ...(operationId === undefined ? {} : { operationId }),
        ...(handle === undefined ? {} : { handle, parentHandle: handle })
      },
      warnings: [],
      error: { name: "OperationInputError", message, recoverable: false },
      context: { timestamp: new Date().toISOString(), experience: "work" }
    };
  }
  return {
    ...unsupported.result,
    data: {
      ...(operationId === undefined ? {} : { operationId }),
      ...(handle === undefined ? {} : { handle, parentHandle: handle })
    }
  };
}

function transactionalWorkBlockerResult<T extends StartWorkData | SteerWorkData>(
  data: T,
  code: string,
  uncertain: boolean,
  recoverable: boolean
): CommandResult<T> {
  const message = `Transactional Work operation ${uncertain ? "is uncertain" : "was blocked"} (${code.replaceAll("_", " ")}).`;
  return {
    ok: false,
    status: uncertain ? "partial" : "blocked",
    data,
    warnings: [],
    blocker: {
      kind: transactionalBlockerKind(code),
      code,
      message,
      resumable: recoverable
    },
    context: { timestamp: new Date().toISOString(), experience: "work" }
  };
}

function transactionalWorkError(
  operationId: string,
  error: unknown
): CommandResult<StartWorkData>;
function transactionalWorkError(
  operationId: string,
  error: unknown,
  controlActionId: string,
  parentHandle: OperationHandleV1
): CommandResult<SteerWorkData>;
function transactionalWorkError(
  operationId: string,
  error: unknown,
  controlActionId?: string,
  parentHandle?: OperationHandleV1
): CommandResult<StartWorkData> | CommandResult<SteerWorkData> {
  const code = safeOwnErrorCode(error) ?? "operation_error";
  const runtimeUnavailable = code === "journal_runtime_unavailable";
  const serviceUnavailable = JOURNAL_SERVICE_FAILURE_CODES.has(code);
  const indeterminate = code === "journal_rpc_outcome_indeterminate";
  const message = runtimeUnavailable ? JOURNAL_RUNTIME_UNAVAILABLE_MESSAGE : serviceUnavailable ? journalServiceFailureMessage(code) : `Transactional Work operation failed (${code.replaceAll("_", " ")}).`;
  const blocker = code === "adapter_unavailable"
    || code === "browser_bridge_unavailable"
    || code === "target_evidence_unavailable"
    || code === "backend_unavailable"
    || runtimeUnavailable || serviceUnavailable;
  const data = parentHandle === undefined
    ? {
        operationId,
        task: {},
        submitted: { submitted: false, submissionState: "not_submitted" }
      } as StartWorkData
    : {
        operationId,
        controlActionId,
        handle: parentHandle,
        parentHandle
      } as SteerWorkData;
  return {
    ok: false,
    status: indeterminate ? "partial" : blocker ? "blocked" : "error",
    data,
    warnings: [],
    ...(blocker ? { blocker: {
      kind: transactionalBlockerKind(code), code, message, resumable: !runtimeUnavailable && !serviceUnavailable,
      ...(runtimeUnavailable ? { remediation: [{
        label: "Use a supported transactional host",
        instruction: "Start the packaged journal service in a supported Node host and configure operations.journalService.descriptorPath in the browser client.",
        userActionRequired: false
      }] } : serviceUnavailable ? { remediation: [{
        ...journalServiceRemediation(code),
        userActionRequired: false
      }] } : {})
    } } : {}),
    error: { name: "OperationError", message, recoverable: blocker && !runtimeUnavailable && !serviceUnavailable },
    context: { timestamp: new Date().toISOString(), experience: "work" }
  };
}

async function freshestOperationHandle(
  operations: ChatGPTOperations,
  candidate: OperationHandleV1
): Promise<OperationHandleV1> {
  try {
    const inspected = await operations.inspect(candidate);
    return inspected.handle;
  } catch {
    // The submit/collect result is still an authenticated handle and is the
    // freshest locator available if a browser-free reload is unavailable.
    return candidate;
  }
}

function prepareTransactionalAsk(
  args: AskWorkflowArgs,
  defaults: TransactionalAskDefaults | undefined,
  clientOptions: ChatGPTClientOptions
): TransactionalAskPreparationResult {
  const operationId = args.operationId;
  if (operationId === undefined || !TRANSACTIONAL_OPERATION_ID_PATTERN.test(operationId)) {
    return transactionalUnsupported(
      operationId,
      "operationId must be a canonical UUID.",
      "operationId"
    );
  }
  if (args.prompt.trim().length === 0) {
    return transactionalUnsupported(operationId, "prompt must be non-empty.", "prompt");
  }
  if (args.download !== undefined) {
    return transactionalUnsupported(
      operationId,
      "download is not supported by the transactional ask path; use operations.collect and an explicit artifact transfer.",
      "download"
    );
  }
  if (args.report !== undefined && args.report !== false) {
    return transactionalUnsupported(operationId, "report is not supported by the transactional ask path.", "report");
  }
  if (clientOptions.reporting?.enabled === true) {
    return transactionalUnsupported(operationId, "client reporting must be disabled for the transactional ask path.", "reporting");
  }

  const target = transactionalTarget(args, defaults);
  if (!target.ok) return transactionalUnsupported(operationId, target.message, target.fieldPath);

  const configuration = transactionalConfiguration(args, defaults);
  if (!configuration.ok) return transactionalUnsupported(operationId, configuration.message, configuration.fieldPath);

  const wait = args.wait ?? defaults?.wait ?? true;
  const read = args.read ?? defaults?.read ?? { format: "markdown" as const };
  const waitOptions = transactionalWaitOptions(wait, read);
  if (!waitOptions.ok) return transactionalUnsupported(operationId, waitOptions.message, waitOptions.fieldPath);

  const files: OperationInputFileV1[] = [
    ...(args.files ?? []),
    ...(args.attachments ?? [])
  ].map(file => typeof file === "string" ? { path: file } : { path: file.path });

  const request: OperationSubmitRequestV1 = {
    schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
    operationId,
    surface: "chat",
    prompt: args.prompt,
    target: target.target,
    ...(configuration.value === undefined ? {} : { configuration: configuration.value }),
    ...(files.length === 0 ? {} : { files }),
    capture: {
      responseContent: waitOptions.responseContent,
      responseFormat: waitOptions.responseFormat,
      artifacts: "receipt_only"
    }
  };
  return {
    ok: true,
    value: {
      request,
      options: waitOptions.options,
      responseFormat: waitOptions.responseFormat,
      ...(waitOptions.maxResponseChars === undefined ? {} : { maxResponseChars: waitOptions.maxResponseChars })
    }
  };
}

type TransactionalTargetResult =
  | { ok: true; target: OperationSubmitRequestV1["target"] }
  | { ok: false; message: string; fieldPath: string };

function transactionalTarget(
  args: AskWorkflowArgs,
  defaults: TransactionalAskDefaults | undefined
): TransactionalTargetResult {
  const thread = args.thread ?? defaults?.thread;
  const existingTab = args.existingTab ?? defaults?.existingTab;
  const preferExistingTab = args.preferExistingTab ?? defaults?.preferExistingTab;

  if (thread !== undefined) {
    if (existingTab !== undefined || preferExistingTab === true) {
      return {
        ok: false,
        message: "thread cannot be combined with existingTab or preferExistingTab on the transactional ask path.",
        fieldPath: "thread"
      };
    }
    return targetFromWorkflowThread(thread);
  }

  if (preferExistingTab === true) {
    if (existingTab !== undefined) {
      return {
        ok: false,
        message: "preferExistingTab cannot be combined with existingTab on the transactional ask path.",
        fieldPath: "preferExistingTab"
      };
    }
    return { ok: true, target: { type: "selected_tab" } };
  }
  if (existingTab !== undefined) return targetFromExistingTab(existingTab);
  return { ok: true, target: { type: "new" } };
}

function targetFromWorkflowThread(thread: WorkflowThread): TransactionalTargetResult {
  if (isTypedThread(thread)) {
    switch (thread.type) {
      case "new":
        return { ok: true, target: { type: "new" } };
      case "current":
        return { ok: true, target: { type: "selected_tab" } };
      case "url":
        return thread.url.length > 0
          ? { ok: true, target: { type: "url", url: thread.url } }
          : { ok: false, message: "thread.url must be non-empty.", fieldPath: "thread.url" };
      case "conversationId":
      case "conversation_id":
        return thread.conversationId.length > 0
          ? { ok: true, target: { type: "conversation_id", conversationId: thread.conversationId } }
          : { ok: false, message: "thread.conversationId must be non-empty.", fieldPath: "thread.conversationId" };
      case "search":
      case "title":
        return {
          ok: false,
          message: "thread search/title selection is not supported by the transactional ask path; supply a URL or conversationId.",
          fieldPath: "thread"
        };
    }
  }
  if (thread.url !== undefined) {
    return thread.url.length > 0
      ? { ok: true, target: { type: "url", url: thread.url } }
      : { ok: false, message: "thread.url must be non-empty.", fieldPath: "thread.url" };
  }
  if (thread.conversationId !== undefined) {
    return thread.conversationId.length > 0
      ? { ok: true, target: { type: "conversation_id", conversationId: thread.conversationId } }
      : { ok: false, message: "thread.conversationId must be non-empty.", fieldPath: "thread.conversationId" };
  }
  if (thread.query !== undefined || thread.title !== undefined) {
    return {
      ok: false,
      message: "thread search/title selection is not supported by the transactional ask path; supply a URL or conversationId.",
      fieldPath: "thread"
    };
  }
  return { ok: true, target: { type: "new" } };
}

function targetFromExistingTab(existingTab: NonNullable<AskWorkflowArgs["existingTab"]>): TransactionalTargetResult {
  if (existingTab === true) return { ok: true, target: { type: "selected_tab" } };
  if (existingTab === false) return { ok: true, target: { type: "new" } };
  if (existingTab.ifMissing !== undefined && existingTab.ifMissing !== "block") {
    return { ok: false, message: "existingTab.ifMissing must be block on the transactional ask path.", fieldPath: "existingTab.ifMissing" };
  }
  if (existingTab.ifMultiple !== undefined && existingTab.ifMultiple !== "block") {
    return { ok: false, message: "existingTab.ifMultiple must be block on the transactional ask path.", fieldPath: "existingTab.ifMultiple" };
  }
  if (existingTab.requireChatGPT === false) {
    return { ok: false, message: "existingTab.requireChatGPT=false is not supported by the transactional ask path.", fieldPath: "existingTab.requireChatGPT" };
  }
  const target = existingTab.target;
  if (target === undefined || target.type === "selected") return { ok: true, target: { type: "selected_tab" } };
  switch (target.type) {
    case "tabId":
      return target.tabId.length > 0
        ? { ok: true, target: { type: "tab_id", tabId: target.tabId } }
        : { ok: false, message: "existingTab.target.tabId must be non-empty.", fieldPath: "existingTab.target.tabId" };
    case "conversationId":
    case "conversation_id":
      return target.conversationId.length > 0
        ? { ok: true, target: { type: "conversation_id", conversationId: target.conversationId } }
        : { ok: false, message: "existingTab.target.conversationId must be non-empty.", fieldPath: "existingTab.target.conversationId" };
    case "url":
      return target.url.length > 0
        ? { ok: true, target: { type: "url", url: target.url } }
        : { ok: false, message: "existingTab.target.url must be non-empty.", fieldPath: "existingTab.target.url" };
    case "title":
      return { ok: false, message: "existingTab title selection is not supported by the transactional ask path; supply a tabId, URL, or conversationId.", fieldPath: "existingTab.target" };
  }
}

type TransactionalConfigurationResult =
  | { ok: true; value?: OperationConfigurationRequestV1 }
  | { ok: false; message: string; fieldPath: string };

function transactionalConfiguration(
  args: AskWorkflowArgs,
  defaults: TransactionalAskDefaults | undefined
): TransactionalConfigurationResult {
  const experience = args.experience ?? defaults?.experience;
  if (experience === "work") {
    return { ok: false, message: "experience=work is not supported by the transactional chat ask path.", fieldPath: "experience" };
  }
  const selected = args.configuration ?? defaults?.configuration;
  const mode = args.mode ?? defaults?.mode;
  if (mode?.timeoutMs !== undefined) {
    return { ok: false, message: "mode.timeoutMs is not supported by the transactional ask path.", fieldPath: "mode.timeoutMs" };
  }
  const values: OperationConfigurationRequestV1 = {};
  if (experience !== undefined) values.experience = experience;

  const model = mergeConfigurationValue("model", selected?.model, mode?.model);
  if (!model.ok) return model;
  if (model.value !== undefined) values.model = model.value;

  const modelVersion = mergeConfigurationValue(
    "modelVersion",
    selected?.modelVersion ?? selected?.version,
    mode?.modelVersion ?? mode?.version
  );
  if (!modelVersion.ok) return modelVersion;
  if (modelVersion.value !== undefined) values.modelVersion = modelVersion.value;

  const additional: Record<string, string> = {};
  for (const [axis, first, second] of [
    ["intelligence", selected?.intelligence, mode?.intelligence],
    ["effort", selected?.effort, mode?.effort],
    ["speed", selected?.speed, undefined]
  ] as const) {
    const merged = mergeConfigurationValue(axis, first, second);
    if (!merged.ok) return merged;
    if (merged.value !== undefined) additional[axis] = merged.value;
  }
  const tools = args.tools;
  if (tools !== undefined) {
    for (const [index, tool] of tools.entries()) {
      if (tool.tool.trim().length === 0) {
        return { ok: false, message: "tool must be non-empty.", fieldPath: `tools[${index}].tool` };
      }
      if (tool.timeoutMs !== undefined) {
        return { ok: false, message: "tool timeoutMs is not supported by the transactional ask path.", fieldPath: `tools[${index}].timeoutMs` };
      }
    }
    if (tools.length > 0) values.tools = tools.map(tool => tool.tool);
  }
  if (Object.keys(additional).length > 0) values.additional = additional;
  return Object.keys(values).length === 0 ? { ok: true } : { ok: true, value: values };
}

function mergeConfigurationValue(
  axis: string,
  first: string | undefined,
  second: string | undefined
): { ok: true; value?: string } | { ok: false; message: string; fieldPath: string } {
  if (first !== undefined && second !== undefined && first !== second) {
    return {
      ok: false,
      message: `configuration and mode disagree for ${axis}; provide one value.`,
      fieldPath: axis === "modelVersion" ? "configuration.modelVersion" : `configuration.${axis}`
    };
  }
  if (first === undefined && second === undefined) return { ok: true };
  const value = first ?? second;
  return value === undefined ? { ok: true } : { ok: true, value };
}

type TransactionalWaitResult =
  | {
      ok: true;
      options: OperationClientRunOptions;
      responseContent: "include" | "metadata";
      readRequested: boolean;
      responseFormat: TransactionalResponseFormat;
      maxResponseChars?: number;
    }
  | { ok: false; message: string; fieldPath: string };

function transactionalWaitOptions(
  wait: boolean | WaitArgs,
  read: boolean | ReadLatestArgs
): TransactionalWaitResult {
  const readRequested = read === true || typeof read === "object";
  const responseFormat: TransactionalResponseFormat = typeof read === "object" && read.format === "text"
    ? "text"
    : "markdown";
  const maxResponseChars = typeof read === "object" ? read.maxChars : undefined;
  if (maxResponseChars !== undefined && (!Number.isSafeInteger(maxResponseChars) || maxResponseChars < 0 || maxResponseChars > 8 * 1024 * 1024)) {
    return { ok: false, message: "read.maxChars must be between 0 and 8388608.", fieldPath: "read.maxChars" };
  }
  if (typeof read === "object") {
    if (read.role !== undefined && read.role !== "assistant") {
      return { ok: false, message: "read.role=user is not supported by the transactional ask path.", fieldPath: "read.role" };
    }
    if (read.format !== undefined && read.format !== "markdown" && read.format !== "text") {
      return { ok: false, message: "read.format must be markdown or text on the transactional ask path.", fieldPath: "read.format" };
    }
  }
  if (typeof wait === "object") {
    if (wait.timeoutMs !== undefined && (!Number.isSafeInteger(wait.timeoutMs) || wait.timeoutMs < 1 || wait.timeoutMs > 86_400_000)) {
      return { ok: false, message: "wait.timeoutMs must be between 1 and 86400000.", fieldPath: "wait.timeoutMs" };
    }
    if (wait.pollMs !== undefined && (!Number.isSafeInteger(wait.pollMs) || wait.pollMs < 0 || wait.pollMs > 60_000)) {
      return { ok: false, message: "wait.pollMs must be between 0 and 60000.", fieldPath: "wait.pollMs" };
    }
    if (wait.responseContent !== undefined && wait.responseContent !== "include" && wait.responseContent !== "metadata") {
      return { ok: false, message: "wait.responseContent must be include or metadata.", fieldPath: "wait.responseContent" };
    }
    for (const [key, value] of [
      ["afterTurnCount", wait.afterTurnCount],
      ["afterAssistantTurnCount", wait.afterAssistantTurnCount],
      ["afterStep", wait.afterStep],
      ["stableMs", wait.stableMs],
      ["mode", wait.mode]
    ] as const) {
      if (value !== undefined) {
        return { ok: false, message: `wait.${key} is not supported by the transactional ask path.`, fieldPath: `wait.${key}` };
      }
    }
  }
  const responseContent = typeof wait === "object" && wait.responseContent !== undefined
    ? wait.responseContent
    : readRequested ? "include" : "metadata";
  const options: OperationClientRunOptions = {
    wait: wait !== false,
    responseContent,
    ...(typeof wait === "object" && wait.timeoutMs === undefined ? {} : typeof wait === "object" ? { timeoutMs: wait.timeoutMs } : {}),
    ...(typeof wait === "object" && wait.pollMs === undefined ? {} : typeof wait === "object" ? { pollIntervalMs: wait.pollMs } : {})
  };
  return {
    ok: true,
    options,
    responseContent,
    readRequested,
    responseFormat,
    ...(maxResponseChars === undefined ? {} : { maxResponseChars })
  };
}

function transactionalUnsupported(
  operationId: string | undefined,
  message: string,
  fieldPath: string
): TransactionalAskPreparationResult {
  const data: Record<string, unknown> = operationId === undefined ? {} : { operationId };
  return {
    ok: false,
    result: {
      ok: false,
      status: "unsupported",
      data,
      warnings: [],
      error: { name: "OperationInputError", message, recoverable: false },
      blocker: { kind: "unknown", code: "unsupported_operation_input", fieldPath, message },
      context: { timestamp: new Date().toISOString() }
    }
  };
}

function transactionalAskCommandResult(
  prepared: TransactionalAskPreparation,
  run: OperationRunResult,
  handle: OperationHandleV1
): CommandResult<unknown> {
  const base: TransactionalAskData = {
    operationId: handle.operationId,
    responseFormat: prepared.responseFormat,
    handle,
    requestDigest: handle.requestDigest
  };
  const submission = run.submit.submission;
  if (submission.kind === "blocked" || submission.kind === "uncertain" || submission.kind === "cancelled") {
    return transactionalBlockerResult(
      {
        ...base,
        submissionState: transactionalSubmissionState(handle, submission.blocker.mutationBoundary),
        complete: false,
        completionState: transactionalCompletionState(handle.phase),
        generationActive: handle.phase === "generating"
      },
      submission.blocker.code,
      submission.blocker.mutationBoundary !== "none",
      submission.blocker.observationRequired
    );
  }
  if (run.collect === undefined) {
    if (submission.kind === "completed_receipt") {
      return {
        ok: true,
        status: "ok",
        data: { ...base, submissionState: "submitted", complete: true, completionState: "complete", generationActive: false },
        warnings: [],
        context: { timestamp: new Date().toISOString() }
      };
    }
    return {
      ok: false,
      status: "partial",
      data: { ...base, pending: true, complete: false, completionState: "generating", generationActive: true, submissionState: "submitted_generating" },
      warnings: [],
      context: { timestamp: new Date().toISOString() }
    };
  }
  const collected = run.collect;
  if (collected.kind === "completed") {
    const rawText = prepared.request.capture?.responseContent === "include" ? collected.response.rawText : undefined;
    const responseText = rawText === undefined
      ? undefined
      : prepared.maxResponseChars === undefined
        ? rawText
        : rawText.slice(0, prepared.maxResponseChars);
    const data: TransactionalAskData = {
      ...base,
      submissionState: "submitted",
      complete: true,
      completionState: "complete",
      generationActive: false,
      ...(responseText === undefined ? {} : { responseText }),
      ...(collected.response.text?.digest === undefined ? {} : { responseDigest: collected.response.text.digest }),
      ...(collected.response.text?.bytes === undefined ? {} : { responseBytes: collected.response.text.bytes }),
      artifacts: collected.response.artifacts
    };
    return { ok: true, status: "ok", data, warnings: [], context: { timestamp: new Date().toISOString() } };
  }
  if (collected.kind === "pending") {
    return {
      ok: false,
      status: "partial",
      data: { ...base, pending: true, complete: false, completionState: collected.phase === "generating" ? "generating" : "unknown", generationActive: collected.phase === "generating", submissionState: "submitted_generating" },
      warnings: [],
      context: { timestamp: new Date().toISOString() }
    };
  }
  return transactionalBlockerResult(
    {
      ...base,
      submissionState: transactionalSubmissionState(handle, collected.blocker.mutationBoundary),
      complete: false,
      completionState: transactionalCompletionState(handle.phase),
      generationActive: handle.phase === "generating"
    },
    collected.blocker.code,
    collected.blocker.mutationBoundary !== "none",
    true
  );
}

function transactionalSubmissionState(
  handle: OperationHandleV1,
  boundary: OperationHandleV1["mutationBoundary"]
): NonNullable<TransactionalAskData["submissionState"]> {
  if (["submitted", "generating", "capturing", "completed"].includes(handle.phase)) {
    return handle.phase === "generating" ? "submitted_generating" : "submitted";
  }
  return boundary === "send_may_have_occurred" || boundary === "control_may_have_occurred"
    ? "submitted_unconfirmed"
    : "not_submitted";
}

function transactionalCompletionState(
  phase: OperationHandleV1["phase"]
): NonNullable<TransactionalAskData["completionState"]> {
  if (phase === "completed") return "complete";
  if (phase === "generating") return "generating";
  if (phase === "uncertain" || phase === "capturing") return "partial";
  return "unknown";
}

function transactionalBlockerResult(
  data: TransactionalAskData,
  code: string,
  uncertain: boolean,
  recoverable: boolean
): CommandResult<unknown> {
  const kind = transactionalBlockerKind(code);
  const message = `Transactional operation ${uncertain ? "is uncertain" : "was blocked"} (${code.replaceAll("_", " ")}).`;
  return {
    ok: false,
    status: uncertain ? "partial" : "blocked",
    data,
    warnings: [],
    blocker: { kind, code, message, resumable: recoverable },
    context: { timestamp: new Date().toISOString() }
  };
}

function transactionalBlockerKind(code: string): import("./types.js").BlockerKind {
  if (code === "browser_bridge_unavailable") return "browser_bridge_unavailable";
  if (code === "login_required") return "login_required";
  if (code === "captcha") return "captcha";
  if (code === "rate_limited") return "rate_limit";
  if (code === "permission_required" || code === "input_file_changed") return "permission";
  if (code === "needs_confirmation") return "confirmation";
  if (code.includes("artifact")) return "artifact_unavailable";
  if (code.includes("selector") || code.includes("configuration") || code.includes("target") || code.includes("turn")) return "selector_drift";
  if (code.includes("file") || code.includes("attachment")) return "upload_failed";
  return "unknown";
}

const JOURNAL_SERVICE_FAILURE_CODES = new Set([
  "journal_rpc_unavailable", "journal_rpc_authentication_failed", "journal_rpc_protocol_error",
  "journal_rpc_limit_exceeded", "journal_rpc_outcome_indeterminate", "journal_rpc_request_rejected",
  "journal_rpc_unsupported_platform"
]);

function journalServiceFailureMessage(code: string): string {
  if (code === "journal_rpc_unsupported_platform") {
    return "The private-file journal service requires POSIX file ownership and permissions and is unavailable on Windows.";
  }
  return code === "journal_rpc_outcome_indeterminate"
    ? "The journal service connection ended without confirming a durable write. Preserve the operation identity and reconcile its state before any further browser action."
    : "The configured journal service could not provide authenticated operation state. Restore its private connection before continuing.";
}

function journalServiceRemediation(code: string): { label: string; instruction: string } {
  return code === "journal_rpc_unsupported_platform" ? {
    label: "Use a supported journal host",
    instruction: "On Windows, use the local journal in an ordinary Node browser host without operations.journalService. The private-file journal service requires a POSIX host. Preserve any existing operation identity."
  } : {
    label: "Reconnect the same journal",
    instruction: "Restore the private journal-service connection, then inspect or reconcile the same operation identity. Never create a new operation ID to retry an uncertain Send."
  };
}

function transactionalAskError(operationId: string, error: unknown): CommandResult<unknown> {
  const code = safeOwnErrorCode(error) ?? "operation_error";
  const runtimeUnavailable = code === "journal_runtime_unavailable";
  const serviceUnavailable = JOURNAL_SERVICE_FAILURE_CODES.has(code);
  const indeterminate = code === "journal_rpc_outcome_indeterminate";
  const blocker = runtimeUnavailable || serviceUnavailable || code === "adapter_unavailable" || code === "browser_bridge_unavailable" || code === "target_evidence_unavailable";
  const message = runtimeUnavailable ? JOURNAL_RUNTIME_UNAVAILABLE_MESSAGE : serviceUnavailable ? journalServiceFailureMessage(code) : `Transactional operation failed (${code.replaceAll("_", " ")}).`;
  return {
    ok: false,
    status: indeterminate ? "partial" : blocker ? "blocked" : "error",
    data: { operationId },
    warnings: [],
    ...(blocker ? { blocker: {
      kind: transactionalBlockerKind(code), code, message, resumable: !runtimeUnavailable && !serviceUnavailable,
      ...(runtimeUnavailable ? { remediation: [{
        label: "Use a supported transactional host",
        instruction: "Start the packaged journal service in a supported Node host and configure operations.journalService.descriptorPath in the browser client.",
        userActionRequired: false
      }] } : serviceUnavailable ? { remediation: [{
        ...journalServiceRemediation(code),
        userActionRequired: false
      }] } : {})
    } } : {}),
    error: { name: "OperationError", message, recoverable: blocker && !runtimeUnavailable && !serviceUnavailable },
    context: { timestamp: new Date().toISOString() }
  };
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

  appendSurfaceConfigurationSteps(steps, {
    experience: args.experience ?? defaults.experience,
    configuration: args.configuration ?? defaults.configuration,
    mode: args.mode ?? defaults.mode
  });
  for (const [index, tool] of (args.tools ?? []).entries()) {
    steps.push({ id: `tool${index + 1}`, command: "tools.select", args: tool });
  }

  const files = normalizeFileInputs([...(args.files ?? []), ...(args.attachments ?? [])]);
  if (files.length > 0) {
    steps.push({ id: "attach", command: "files.attach", args: { paths: files } });
  }
  const artifactDownload = args.download !== undefined && usesCreateImageTool(args.tools ?? []);
  if (artifactDownload) {
    steps.push({ id: "artifactBaseline", command: "artifacts.listLatest", args: { kind: "image" } });
  }

  steps.push({
    id: "ask",
    command: "messages.ask",
    args: {
      text: args.prompt,
      wait: artifactDownload ? false : args.wait ?? defaults.wait ?? true,
      read: artifactDownload ? false : args.read ?? defaults.read ?? { format: "markdown" }
    }
  });

  if (args.download !== undefined) {
    if (artifactDownload) {
      steps.push({
        id: "artifact",
        command: "artifacts.wait",
        args: artifactWaitArgs(args.wait ?? defaults.wait ?? true, args.download)
      });
    }
    steps.push({ id: "download", command: artifactDownload ? "artifacts.downloadLatest" : "files.downloadLatest", args: args.download });
  }

  return {
    name: args.download === undefined ? "ask" : "ask-and-download",
    policy: { stopOnError: true, returnPartial: true },
    steps
  };
}

function usesCreateImageTool(tools: SelectToolArgs[]): boolean {
  return tools.some(tool => normalizeToolName(tool.tool) === "create_image");
}

function normalizeToolName(tool: string): string {
  return tool.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function artifactWaitArgs(wait: boolean | WaitArgs | undefined, download: DownloadLatestArgs | undefined): ArtifactWaitArgs {
  const args: ArtifactWaitArgs = {
    kind: "image",
    afterArtifactCount: "${artifactBaseline.data.count}" as unknown as number,
    requireDownload: true
  };
  if (typeof wait === "object") {
    if (wait.timeoutMs !== undefined) args.timeoutMs = wait.timeoutMs;
    if (wait.stableMs !== undefined) args.stableMs = wait.stableMs;
    if (wait.pollMs !== undefined) args.pollMs = wait.pollMs;
  }
  if (args.timeoutMs === undefined && download?.timeoutMs !== undefined) {
    args.timeoutMs = download.timeoutMs;
  }
  return args;
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

  appendSurfaceConfigurationSteps(steps, {
    experience: args.experience ?? defaults.experience,
    configuration: args.configuration ?? defaults.configuration,
    mode: args.mode ?? defaults.mode
  });

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

/**
 * Read only a bounded own data property. Provider/runtime failures are an
 * untrusted boundary: consulting an inherited property or accessor can run
 * arbitrary code and can surface private diagnostics while formatting a
 * public result.
 */
function safeOwnErrorCode(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, "code");
  } catch {
    return undefined;
  }
  if (descriptor === undefined || !("value" in descriptor)) return undefined;
  return typeof descriptor.value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(descriptor.value)
    ? descriptor.value
    : undefined;
}

function readOperationIdFromUnknown(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "operationId");
    const operationId = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
    return typeof operationId === "string" && TRANSACTIONAL_OPERATION_ID_PATTERN.test(operationId)
      ? operationId
      : undefined;
  } catch {
    return undefined;
  }
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
