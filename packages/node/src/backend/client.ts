import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type {
  AskAndDownloadWorkflowArgs,
  AskInThreadWorkflowArgs,
  AskWithFilesWorkflowArgs,
  AskWorkflowArgs,
  NamedWorkflowInvocation,
  RunMessagesArgs,
  WorkflowThread
} from "../client.js";
import type { DoctorArgs, DoctorReport } from "../commands/doctor.js";
import type { RunReportData, RunReportOptions } from "../commands/reports.js";
import type { CommandDescriptor } from "../commands/registry.js";
import { createChatGPTAgent } from "../runner/agent.js";
import type { ChatGPTResponsesCreateArgs } from "../runner/responses.js";
import type { ChatGPTRunStream, ChatGPTRunStreamEvent } from "../runner/stream.js";
import type {
  ChatGPTAgent,
  ChatGPTAgentConfig,
  ChatGPTResponse,
  ChatGPTRunInput,
  ChatGPTRunResult
} from "../runner/types.js";
import type { ReportRedactionOptions } from "../safety/report-redaction.js";
import type {
  ArtifactDownloadArgs,
  ArtifactWaitArgs,
  ApplyConfigurationData,
  ApplyConfigurationArgs,
  BootstrapArgs,
  ChatGPTExperience,
  CommandResult,
  ConfigurationInspectionData,
  CopyResponseArgs,
  DetectExperienceArgs,
  DetectExperienceData,
  DownloadLatestArgs,
  GetModeArgs,
  GetModeData,
  InspectConfigurationArgs,
  ListArtifactsArgs,
  MessageStatusArgs,
  NewThreadArgs,
  OpenThreadArgs,
  OpenExperienceData,
  ReadLatestArgs,
  ReadWorkLatestArgs,
  ReadWorkLatestData,
  SearchThreadsArgs,
  SelectToolArgs,
  SequencePlan,
  SetModeArgs,
  StartWorkArgs,
  StartWorkData,
  SteerWorkArgs,
  SteerWorkData,
  WaitArgs,
  WorkStatusArgs,
  WorkStatusData,
  WorkWaitArgs,
  WorkWaitData
} from "../types.js";
import {
  BACKEND_REQUEST_SCHEMA_VERSION,
  BACKEND_RESPONSE_SCHEMA_VERSION,
  BACKEND_EVENT_SCHEMA_VERSION,
  type BackendCommand,
  type BackendEvent,
  type BackendRequest,
  type BackendResponse
} from "./protocol.js";

export type BackendTransport = {
  request(request: BackendRequest): Promise<BackendResponse>;
  stream(request: BackendRequest): AsyncIterable<BackendEvent>;
  close?: () => Promise<void> | void;
};

export class BackendClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoverable: boolean
  ) {
    super(message);
    this.name = "BackendClientError";
  }
}

export type ChatGPTBackendRunner = {
  run<TOutput = string>(agent: ChatGPTAgent<TOutput>, input: ChatGPTRunInput): Promise<ChatGPTRunResult<TOutput>>;
  plan<TOutput = string>(agent: ChatGPTAgent<TOutput>, input: ChatGPTRunInput): Promise<SequencePlan>;
  stream<TOutput = string>(agent: ChatGPTAgent<TOutput>, input: ChatGPTRunInput): ChatGPTRunStream<TOutput>;
};

export type ChatGPTBackendClient = {
  agent<TOutput = string>(config: ChatGPTAgentConfig<TOutput>): ChatGPTAgent<TOutput>;
  run<TOutput = string>(agent: ChatGPTAgent<TOutput>, input: ChatGPTRunInput): Promise<ChatGPTRunResult<TOutput>>;
  runner: ChatGPTBackendRunner;
  responses: {
    create(args: ChatGPTResponsesCreateArgs | Record<string, unknown>): Promise<ChatGPTResponse>;
  };
  commands(filter?: { layer?: CommandDescriptor["layer"] }): Promise<CommandDescriptor[]>;
  describe(name: string): Promise<CommandDescriptor | undefined>;
  help(topic?: string): Promise<string>;
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
  reports: {
    create(result: CommandResult<unknown>, args?: RunReportOptions): Promise<CommandResult<RunReportData>>;
    redact(value: unknown, args?: ReportRedactionOptions): Promise<CommandResult<unknown>>;
    summarize(result: CommandResult<unknown>, args?: ReportRedactionOptions): Promise<CommandResult<unknown>>;
  };
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
    ask(args: { text: string; wait?: boolean | WaitArgs; read?: boolean | ReadLatestArgs; timeoutMs?: number }): Promise<CommandResult<unknown>>;
    wait(args?: WaitArgs): Promise<CommandResult<unknown>>;
    readLatest(args?: ReadLatestArgs): Promise<CommandResult<unknown>>;
    status(args?: MessageStatusArgs): Promise<CommandResult<unknown>>;
    waitAndRead(args?: WaitArgs & ReadLatestArgs): Promise<CommandResult<unknown>>;
  };
  files: {
    attach(args: { paths: string[]; timeoutMs?: number }): Promise<CommandResult<unknown>>;
    downloadLatest(args: DownloadLatestArgs): Promise<CommandResult<unknown>>;
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
  close(): Promise<void>;
};

export function createChatGPTBackendClient(transport: BackendTransport): ChatGPTBackendClient {
  let nextRequestId = 0;

  const request = async <TResult>(command: BackendCommand, payload: Record<string, unknown> = {}): Promise<TResult> => {
    const response = await transport.request({
      schemaVersion: BACKEND_REQUEST_SCHEMA_VERSION,
      requestId: `req_${++nextRequestId}`,
      command,
      payload
    });
    return unwrapResponse<TResult>(response);
  };

  const runner: ChatGPTBackendRunner = {
    run: (agent, input) => request("runner.run", { agent, input }),
    plan: (agent, input) => request("runner.plan", { agent, input }),
    stream: (agent, input) => streamFromBackendEvents(transport.stream({
      schemaVersion: BACKEND_REQUEST_SCHEMA_VERSION,
      requestId: `req_${++nextRequestId}`,
      command: "runner.stream",
      payload: { agent, input }
    }))
  };

  return {
    agent: config => createChatGPTAgent(config),
    run: runner.run,
    runner,
    responses: {
      create: args => request("responses.create", args as Record<string, unknown>)
    },
    commands: filter => request("commands", filter === undefined ? {} : { filter }),
    describe: name => request("describe", { name }),
    help: topic => request("help", topic === undefined ? {} : { topic }),
    ask: args => request("ask", args as Record<string, unknown>),
    askInThread: args => request("askInThread", args as Record<string, unknown>),
    askWithFiles: args => request("askWithFiles", args as Record<string, unknown>),
    askAndDownload: args => request("askAndDownload", args as Record<string, unknown>),
    runMessages: args => request("runMessages", args as unknown as Record<string, unknown>),
    openThread: thread => request("openThread", thread as unknown as Record<string, unknown>),
    readLatest: args => request("readLatest", args as Record<string, unknown> | undefined ?? {}),
    copyLatest: args => request("copyLatest", args as Record<string, unknown> | undefined ?? {}),
    downloadLatest: args => request("downloadLatest", args as unknown as Record<string, unknown>),
    runPlan: plan => request("runPlan", plan as unknown as Record<string, unknown>),
    doctor: args => request("doctor", args as Record<string, unknown> | undefined ?? {}),
    createReport: (result, args) => request("createReport", args === undefined ? { result } : { result, args }),
    reports: {
      create: (result, args) => request("reports.create", args === undefined ? { result } : { result, args }),
      redact: (value, args) => request("reports.redact", args === undefined ? { value } : { value, args }),
      summarize: (result, args) => request("reports.summarize", args === undefined ? { result } : { result, args })
    },
    session: {
      bootstrap: args => request("session.bootstrap", args as Record<string, unknown> | undefined ?? {})
    },
    experience: {
      detect: args => request("experience.detect", args as Record<string, unknown> | undefined ?? {}),
      open: args => request("experience.open", args as Record<string, unknown>)
    },
    configuration: {
      inspect: args => request("configuration.inspect", args as Record<string, unknown> | undefined ?? {}),
      apply: args => request("configuration.apply", args as unknown as Record<string, unknown>)
    },
    work: {
      start: args => request("work.start", args as unknown as Record<string, unknown>),
      status: args => request("work.status", args as Record<string, unknown> | undefined ?? {}),
      wait: args => request("work.wait", args as Record<string, unknown> | undefined ?? {}),
      steer: args => request("work.steer", args as unknown as Record<string, unknown>),
      readLatest: args => request("work.readLatest", args as Record<string, unknown> | undefined ?? {}),
      artifacts: {
        listLatest: args => request("artifacts.listLatest", args as Record<string, unknown> | undefined ?? {}),
        wait: args => request("artifacts.wait", args as Record<string, unknown> | undefined ?? {}),
        downloadLatest: args => request("artifacts.downloadLatest", args as unknown as Record<string, unknown>)
      }
    },
    threads: {
      new: args => request("threads.new", args as Record<string, unknown> | undefined ?? {}),
      search: args => request("threads.search", args as unknown as Record<string, unknown>),
      open: args => request("threads.open", args as unknown as Record<string, unknown>)
    },
    messages: {
      compose: args => request("messages.compose", args),
      submit: args => request("messages.submit", args as Record<string, unknown> | undefined ?? {}),
      ask: args => request("messages.ask", args as Record<string, unknown>),
      wait: args => request("messages.wait", args as Record<string, unknown> | undefined ?? {}),
      readLatest: args => request("messages.readLatest", args as Record<string, unknown> | undefined ?? {}),
      status: args => request("messages.status", args as Record<string, unknown> | undefined ?? {}),
      waitAndRead: args => request("messages.waitAndRead", args as Record<string, unknown>)
    },
    artifacts: {
      listLatest: args => request("artifacts.listLatest", args as Record<string, unknown> | undefined ?? {}),
      wait: args => request("artifacts.wait", args as Record<string, unknown> | undefined ?? {}),
      downloadLatest: args => request("artifacts.downloadLatest", args as unknown as Record<string, unknown>)
    },
    files: {
      attach: args => request("files.attach", args),
      downloadLatest: args => request("files.downloadLatest", args as unknown as Record<string, unknown>)
    },
    modes: {
      set: args => request("modes.set", args as Record<string, unknown>),
      get: args => request("modes.get", args as Record<string, unknown> | undefined ?? {})
    },
    tools: {
      select: args => request("tools.select", args as Record<string, unknown>)
    },
    response: {
      copy: args => request("response.copy", args as Record<string, unknown> | undefined ?? {})
    },
    close: async () => {
      await transport.close?.();
    }
  };
}

export type StdioBackendTransportOptions = {
  command: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

const DEFAULT_BACKEND_TIMEOUT_MS = 600_000;

export class StdioBackendTransport implements BackendTransport {
  private child: ChildProcessWithoutNullStreams | undefined;
  private stdout: Interface | undefined;
  private pendingResponses = new Map<string, PendingResponse>();
  private pendingStreams = new Map<string, PendingStream>();
  private stderrText = "";

  constructor(private readonly options: StdioBackendTransportOptions) {}

  async request(request: BackendRequest): Promise<BackendResponse> {
    const requestId = requireRequestId(request);
    this.start();
    return new Promise<BackendResponse>((resolve, reject) => {
      const timeout = this.createDeadline(requestId);
      this.pendingResponses.set(requestId, { resolve, reject, timeout });
      this.write(request, error => {
        this.clearResponse(requestId);
        reject(error);
      });
    });
  }

  stream(request: BackendRequest): AsyncIterable<BackendEvent> {
    const requestId = requireRequestId(request);
    this.start();
    const queue = new AsyncQueue<BackendEvent>();
    const timeout = this.createDeadline(requestId);
    this.pendingStreams.set(requestId, { queue, timeout });
    this.write(request, error => {
      this.clearStream(requestId);
      queue.fail(error);
    });
    return queue;
  }

  async close(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    this.child = undefined;
    this.stdout?.close();
    this.stdout = undefined;
    child.removeAllListeners("error");
    child.removeAllListeners("exit");
    child.kill();
    this.failAll(new BackendClientError("backend_closed", "Backend transport was closed.", true));
  }

  private start(): void {
    if (this.child !== undefined) return;
    const [command, ...args] = this.options.command;
    if (command === undefined) {
      throw new BackendClientError("invalid_backend_command", "Stdio backend command must not be empty.", false);
    }

    const child = spawn(command, args, {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });

    this.stdout.on("line", line => {
      if (this.child !== child) return;
      this.handleLine(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      if (this.child !== child) return;
      this.stderrText = `${this.stderrText}${String(chunk)}`.slice(-4000);
    });
    child.on("error", error => {
      if (this.child !== child) return;
      this.child = undefined;
      this.stdout?.close();
      this.stdout = undefined;
      this.failAll(error);
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      const suffix = this.stderrText.length > 0 ? ` stderr=${this.stderrText}` : "";
      this.child = undefined;
      this.stdout?.close();
      this.stdout = undefined;
      this.failAll(new BackendClientError(
        "backend_exited",
        `Backend process exited with code ${String(code)} signal ${String(signal)}.${suffix}`,
        true
      ));
    });
  }

  private write(request: BackendRequest, reject: (error: Error) => void): void {
    const child = this.child;
    if (child === undefined) {
      reject(new BackendClientError("backend_not_started", "Backend process is not running.", true));
      return;
    }
    child.stdin.write(`${JSON.stringify(request)}\n`, error => {
      if (error !== null && error !== undefined) reject(error);
    });
  }

  private handleLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      this.failAll(new BackendClientError(
        "invalid_backend_json",
        error instanceof Error ? error.message : String(error),
        true
      ));
      return;
    }

    if (!isRecord(value)) {
      this.failAll(new BackendClientError("invalid_backend_message", "Backend protocol line must be a JSON object.", true));
      return;
    }
    if (value.schemaVersion === BACKEND_RESPONSE_SCHEMA_VERSION) {
      this.handleResponse(value as BackendResponse);
      return;
    }
    if (value.schemaVersion === BACKEND_EVENT_SCHEMA_VERSION) {
      this.handleEvent(value as BackendEvent);
      return;
    }
    this.failAll(new BackendClientError(
      "unsupported_backend_schema",
      `Unsupported backend protocol schemaVersion: ${String(value.schemaVersion)}`,
      true
    ));
  }

  private handleResponse(response: BackendResponse): void {
    const requestId = response.requestId;
    if (requestId === undefined) {
      this.failAll(new BackendClientError("missing_backend_request_id", "Backend response is missing requestId.", true));
      return;
    }
    const pending = this.pendingResponses.get(requestId);
    if (pending === undefined) {
      const stream = this.pendingStreams.get(requestId);
      if (stream !== undefined) {
        stream.queue.fail(new BackendClientError(
          "unexpected_backend_response",
          `Backend sent a response for streaming requestId ${requestId}.`,
          true
        ));
        this.clearStream(requestId);
        return;
      }
      this.failAll(new BackendClientError(
        "unknown_backend_request_id",
        `Backend response used unknown requestId ${requestId}.`,
        true
      ));
      return;
    }
    if (typeof response.ok !== "boolean") {
      this.clearResponse(requestId);
      pending.reject(new BackendClientError(
        "invalid_backend_response",
        `Backend response for requestId ${requestId} is missing boolean ok.`,
        true
      ));
      return;
    }
    this.clearResponse(requestId);
    pending.resolve(response);
  }

  private handleEvent(event: BackendEvent): void {
    const requestId = event.requestId;
    if (requestId === undefined) {
      this.failAll(new BackendClientError("missing_backend_request_id", "Backend event is missing requestId.", true));
      return;
    }
    const pending = this.pendingStreams.get(requestId);
    if (pending === undefined) {
      const response = this.pendingResponses.get(requestId);
      if (response !== undefined) {
        this.clearResponse(requestId);
        response.reject(new BackendClientError(
          "unexpected_backend_event",
          `Backend sent an event for non-streaming requestId ${requestId}.`,
          true
        ));
        return;
      }
      this.failAll(new BackendClientError(
        "unknown_backend_request_id",
        `Backend event used unknown requestId ${requestId}.`,
        true
      ));
      return;
    }
    if (typeof event.type !== "string") {
      pending.queue.fail(new BackendClientError(
        "invalid_backend_event",
        `Backend event for requestId ${requestId} is missing type.`,
        true
      ));
      this.clearStream(requestId);
      return;
    }
    pending.queue.push(event);
    if (event.type === "completed") {
      pending.queue.finish();
      this.clearStream(requestId);
    }
    if (event.type === "error") {
      pending.queue.fail(new BackendClientError(event.error.code, event.error.message, event.error.recoverable));
      this.clearStream(requestId);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingResponses.clear();
    for (const pending of this.pendingStreams.values()) {
      clearTimeout(pending.timeout);
      pending.queue.fail(error);
    }
    this.pendingStreams.clear();
  }

  private clearResponse(requestId: string): void {
    const pending = this.pendingResponses.get(requestId);
    if (pending !== undefined) {
      clearTimeout(pending.timeout);
      this.pendingResponses.delete(requestId);
    }
  }

  private clearStream(requestId: string): void {
    const pending = this.pendingStreams.get(requestId);
    if (pending !== undefined) {
      clearTimeout(pending.timeout);
      this.pendingStreams.delete(requestId);
    }
  }

  private createDeadline(requestId: string): NodeJS.Timeout {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS;
    return setTimeout(() => {
      const error = new BackendClientError(
        "backend_timeout",
        `Backend request ${requestId} timed out after ${timeoutMs}ms.`,
        true
      );
      const child = this.child;
      this.child = undefined;
      this.stdout?.close();
      this.stdout = undefined;
      if (child !== undefined) {
        child.removeAllListeners("error");
        child.removeAllListeners("exit");
        child.kill();
      }
      this.failAll(error);
    }, timeoutMs);
  }
}

function unwrapResponse<TResult>(response: BackendResponse): TResult {
  if (response.ok) return response.result as TResult;
  throw new BackendClientError(response.error.code, response.error.message, response.error.recoverable);
}

function streamFromBackendEvents<TOutput>(events: AsyncIterable<BackendEvent>): ChatGPTRunStream<TOutput> {
  const queue = new AsyncQueue<ChatGPTRunStreamEvent>();
  let resolveCompleted!: (result: ChatGPTRunResult<TOutput>) => void;
  let rejectCompleted!: (error: unknown) => void;
  const completed = new Promise<ChatGPTRunResult<TOutput>>((resolve, reject) => {
    resolveCompleted = resolve;
    rejectCompleted = reject;
  });

  void (async () => {
    try {
      for await (const event of events) {
        if (event.type === "run_item_stream_event") {
          queue.push({
            type: "run_item_stream_event",
            name: event.name as ChatGPTRunStreamEvent["name"],
            item: event.item as ChatGPTRunStreamEvent["item"]
          });
          continue;
        }
        if (event.type === "completed") {
          resolveCompleted(event.result as ChatGPTRunResult<TOutput>);
          queue.finish();
          return;
        }
        if (event.type === "error") {
          throw new BackendClientError(event.error.code, event.error.message, event.error.recoverable);
        }
      }
      throw new BackendClientError("stream_incomplete", "Backend stream ended before a completed event.", true);
    } catch (error) {
      queue.fail(error);
      rejectCompleted(error);
    }
  })();

  return {
    completed,
    [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator]()
  };
}

function requireRequestId(request: BackendRequest): string {
  if (request.requestId === undefined) {
    throw new BackendClientError("missing_request_id", "Backend transport requests require requestId.", false);
  }
  return request.requestId;
}

type PendingResponse = {
  resolve: (response: BackendResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type PendingStream = {
  queue: AsyncQueue<BackendEvent>;
  timeout: NodeJS.Timeout;
};

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<() => void> = [];
  private done = false;
  private error: unknown;

  push(value: T): void {
    if (this.done || this.error !== undefined) return;
    this.values.push(value);
    this.wake();
  }

  finish(): void {
    this.done = true;
    this.wake();
  }

  fail(error: unknown): void {
    this.error = error;
    this.wake();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const value = this.values.shift();
      if (value !== undefined) {
        yield value;
        continue;
      }
      if (this.error !== undefined) throw this.error;
      if (this.done) return;
      await new Promise<void>(resolve => {
        this.waiters.push(resolve);
      });
    }
  }

  private wake(): void {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
