import { createChatGPT, type ChatGPTClient, type ChatGPTClientOptions } from "../client.js";
import type { ChatGPTAgentConfig, ChatGPTRunInput } from "../runner/types.js";
import type {
  ArtifactDownloadArgs,
  ArtifactWaitArgs,
  CopyResponseArgs,
  CommandResult,
  DownloadLatestArgs,
  ListArtifactsArgs,
  ReadLatestArgs,
  SequencePlan
} from "../types.js";
import {
  BACKEND_REQUEST_SCHEMA_VERSION,
  backendCommands,
  backendResponseError,
  backendEvent,
  backendEventCompleted,
  backendResponseOk,
  ProtocolError,
  type BackendEvent,
  type BackendCapabilities,
  type BackendRequest,
  type BackendResponse
} from "./protocol.js";

export type BackendSessionOptions = ChatGPTClientOptions;

export class BackendSession {
  private clientInstance: ChatGPTClient | undefined;

  constructor(private readonly options: BackendSessionOptions = {}) {}

  async dispatch(request: BackendRequest): Promise<BackendResponse> {
    try {
      const result = await dispatchBackendCommand(this.client(), request);
      return backendResponseOk(request.requestId, result);
    } catch (error) {
      return backendResponseError(request.requestId, error instanceof Error ? error : new Error(String(error)));
    }
  }

  async *stream(request: BackendRequest): AsyncIterable<BackendEvent> {
    try {
      if (request.command !== "runner.stream") {
        const response = await this.dispatch(request);
        if (response.ok) {
          yield backendEventCompleted(request.requestId, response.result);
        } else {
          yield backendEvent(request.requestId, { type: "error", error: response.error });
        }
        return;
      }

      const payload = request.payload;
      const agent = this.client().agent(agentConfig(payload));
      const stream = this.client().runner.run(agent, runInput(payload), { stream: true });
      for await (const event of stream) {
        yield backendEvent(request.requestId, {
          type: "run_item_stream_event",
          name: event.name,
          item: event.item as unknown as Record<string, unknown>
        });
      }
      yield backendEventCompleted(request.requestId, await stream.completed);
    } catch (error) {
      const protocolError = error instanceof ProtocolError
        ? error
        : new ProtocolError("invalid_request", error instanceof Error ? error.message : String(error), false);
      yield backendEvent(request.requestId, {
        type: "error",
        error: {
          code: protocolError.code,
          message: protocolError.message,
          recoverable: protocolError.recoverable
        }
      });
    }
  }

  private client(): ChatGPTClient {
    this.clientInstance ??= createChatGPT(this.options);
    return this.clientInstance;
  }
}

async function dispatchBackendCommand(client: ChatGPTClient, request: BackendRequest): Promise<unknown> {
  const payload = request.payload;

  switch (request.command) {
    case "backend.version":
      return {
        name: "codex-chatgpt-control-backend",
        runtime: "node",
        protocolVersion: BACKEND_REQUEST_SCHEMA_VERSION
      };
    case "backend.health":
      return {
        ok: true,
        status: "ok",
        timestamp: new Date().toISOString()
      };
    case "backend.capabilities":
      return backendCapabilities();
    case "runner.run": {
      const agent = client.agent(agentConfig(payload));
      return client.runner.run(agent, runInput(payload));
    }
    case "runner.plan": {
      const agent = client.agent(agentConfig(payload));
      return client.runner.plan(agent, runInput(payload));
    }
    case "responses.create":
      return client.responses.create(payload);
    case "commands":
      return client.commands(commandFilter(payload));
    case "describe":
      return client.describe(requiredString(payload, "name"));
    case "help":
      return client.help(optionalString(payload, "topic"));
    case "doctor":
      return client.doctor(payload);
    case "ask":
      return client.ask(payload as Parameters<ChatGPTClient["ask"]>[0]);
    case "askInThread":
      return client.askInThread(payload as Parameters<ChatGPTClient["askInThread"]>[0]);
    case "askWithFiles":
      return client.askWithFiles(payload as Parameters<ChatGPTClient["askWithFiles"]>[0]);
    case "askAndDownload":
      return client.askAndDownload(payload as Parameters<ChatGPTClient["askAndDownload"]>[0]);
    case "runMessages":
      return client.runMessages(payload as Parameters<ChatGPTClient["runMessages"]>[0]);
    case "openThread":
      return client.openThread(payload as Parameters<ChatGPTClient["openThread"]>[0]);
    case "readLatest":
      return client.readLatest(emptyToUndefined(payload) as ReadLatestArgs | undefined);
    case "copyLatest":
      return client.copyLatest(emptyToUndefined(payload) as CopyResponseArgs | undefined);
    case "downloadLatest":
      return client.downloadLatest(payload as DownloadLatestArgs);
    case "runPlan":
      return client.runPlan(runPlanPayload(payload));
    case "createReport":
      return client.createReport(
        requiredRecord(payload, "result") as CommandResult<unknown>,
        optionalRecord(payload, "args") as Parameters<ChatGPTClient["createReport"]>[1]
      );
    case "reports.create":
      return client.reports.create(
        requiredRecord(payload, "result") as CommandResult<unknown>,
        optionalRecord(payload, "args") as Parameters<ChatGPTClient["reports"]["create"]>[1]
      );
    case "reports.redact":
      return client.reports.redact(
        payload.value,
        optionalRecord(payload, "args") as Parameters<ChatGPTClient["reports"]["redact"]>[1]
      );
    case "reports.summarize":
      return client.reports.summarize(
        requiredRecord(payload, "result") as CommandResult<unknown>,
        optionalRecord(payload, "args") as Parameters<ChatGPTClient["reports"]["summarize"]>[1]
      );
    case "session.bootstrap":
      return client.session.bootstrap(emptyToUndefined(payload));
    case "experience.detect":
      return client.experience.detect(emptyToUndefined(payload));
    case "experience.open":
      return client.experience.open(payload as Parameters<ChatGPTClient["experience"]["open"]>[0]);
    case "configuration.inspect":
      return client.configuration.inspect(emptyToUndefined(payload));
    case "configuration.apply":
      return client.configuration.apply(payload as Parameters<ChatGPTClient["configuration"]["apply"]>[0]);
    case "work.start":
      return client.work.start(payload as Parameters<ChatGPTClient["work"]["start"]>[0]);
    case "work.status":
      return client.work.status(emptyToUndefined(payload));
    case "work.wait":
      return client.work.wait(emptyToUndefined(payload));
    case "work.steer":
      return client.work.steer(payload as Parameters<ChatGPTClient["work"]["steer"]>[0]);
    case "work.readLatest":
      return client.work.readLatest(emptyToUndefined(payload));
    case "threads.new":
      return client.threads.new(emptyToUndefined(payload));
    case "threads.search":
      return client.threads.search(payload as Parameters<ChatGPTClient["threads"]["search"]>[0]);
    case "threads.open":
      return client.threads.open(payload as Parameters<ChatGPTClient["threads"]["open"]>[0]);
    case "messages.compose":
      return client.messages.compose(payload as Parameters<ChatGPTClient["messages"]["compose"]>[0]);
    case "messages.submit":
      return client.messages.submit(emptyToUndefined(payload));
    case "messages.ask":
      return client.messages.ask(payload as Parameters<ChatGPTClient["messages"]["ask"]>[0]);
    case "messages.wait":
      return client.messages.wait(emptyToUndefined(payload));
    case "messages.readLatest":
      return client.messages.readLatest(emptyToUndefined(payload));
    case "messages.status":
      return client.messages.status(emptyToUndefined(payload));
    case "messages.waitAndRead":
      return client.messages.waitAndRead(payload as Parameters<ChatGPTClient["messages"]["waitAndRead"]>[0]);
    case "artifacts.listLatest":
      return client.artifacts.listLatest(emptyToUndefined(payload) as ListArtifactsArgs | undefined);
    case "artifacts.wait":
      return client.artifacts.wait(emptyToUndefined(payload) as ArtifactWaitArgs | undefined);
    case "artifacts.downloadLatest":
      return client.artifacts.downloadLatest(payload as ArtifactDownloadArgs);
    case "files.preflight":
      return client.files.preflight(payload as Parameters<ChatGPTClient["files"]["preflight"]>[0]);
    case "files.attach":
      return client.files.attach(payload as Parameters<ChatGPTClient["files"]["attach"]>[0]);
    case "files.downloadLatest":
      return client.files.downloadLatest(payload as Parameters<ChatGPTClient["files"]["downloadLatest"]>[0]);
    case "projects.sources.list":
      return client.projects.sources.list(payload as Parameters<ChatGPTClient["projects"]["sources"]["list"]>[0]);
    case "projects.sources.planAdd":
      return client.projects.sources.planAdd(payload as Parameters<ChatGPTClient["projects"]["sources"]["planAdd"]>[0]);
    case "projects.sources.add":
      return client.projects.sources.add(payload as Parameters<ChatGPTClient["projects"]["sources"]["add"]>[0]);
    case "modes.set":
      return client.modes.set(payload as Parameters<ChatGPTClient["modes"]["set"]>[0]);
    case "modes.get":
      return client.modes.get(emptyToUndefined(payload));
    case "tools.select":
      return client.tools.select(payload as Parameters<ChatGPTClient["tools"]["select"]>[0]);
    case "response.copy":
      return client.response.copy(emptyToUndefined(payload));
  }
}

function backendCapabilities(): BackendCapabilities {
  return {
    protocolVersion: BACKEND_REQUEST_SCHEMA_VERSION,
    commands: [...backendCommands],
    transports: ["stdio"],
    streaming: {
      modes: ["ndjson"],
      tokenDeltas: false
    }
  };
}

function agentConfig(payload: Record<string, unknown>): ChatGPTAgentConfig {
  return requiredRecord(payload, "agent") as ChatGPTAgentConfig;
}

function runInput(payload: Record<string, unknown>): ChatGPTRunInput {
  if (!Object.hasOwn(payload, "input")) {
    throw new ProtocolError("invalid_request", "Backend runner command requires payload.input.", false);
  }
  return payload.input as ChatGPTRunInput;
}

function runPlanPayload(payload: Record<string, unknown>): SequencePlan | Parameters<ChatGPTClient["runPlan"]>[0] {
  if (isRecord(payload.plan)) return payload.plan as SequencePlan;
  return payload as Parameters<ChatGPTClient["runPlan"]>[0];
}

function commandFilter(payload: Record<string, unknown>): Parameters<ChatGPTClient["commands"]>[0] {
  if (isRecord(payload.filter)) return payload.filter as Parameters<ChatGPTClient["commands"]>[0];
  return Object.keys(payload).length === 0 ? undefined : payload as Parameters<ChatGPTClient["commands"]>[0];
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError("invalid_request", `Backend command requires payload.${key} as a non-empty string.`, false);
  }
  return value;
}

function optionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ProtocolError("invalid_request", `Backend command payload.${key} must be a string when provided.`, false);
  }
  return value;
}

function requiredRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  if (!isRecord(value)) {
    throw new ProtocolError("invalid_request", `Backend command requires payload.${key} as an object.`, false);
  }
  return value;
}

function optionalRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new ProtocolError("invalid_request", `Backend command payload.${key} must be an object when provided.`, false);
  }
  return value;
}

function emptyToUndefined(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(payload).length === 0 ? undefined : payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
