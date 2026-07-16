export const BACKEND_REQUEST_SCHEMA_VERSION = "chatgpt.browser_control.backend_request.v1" as const;
export const BACKEND_RESPONSE_SCHEMA_VERSION = "chatgpt.browser_control.backend_response.v1" as const;
export const BACKEND_EVENT_SCHEMA_VERSION = "chatgpt.browser_control.backend_event.v1" as const;

export const backendCommands = [
  "backend.version",
  "backend.health",
  "backend.capabilities",
  "runner.run",
  "runner.plan",
  "runner.stream",
  "responses.create",
  "ask",
  "askInThread",
  "askWithFiles",
  "askAndDownload",
  "runMessages",
  "openThread",
  "readLatest",
  "copyLatest",
  "downloadLatest",
  "runPlan",
  "doctor",
  "createReport",
  "reports.create",
  "reports.redact",
  "reports.summarize",
  "commands",
  "describe",
  "help",
  "session.bootstrap",
  "experience.detect",
  "experience.open",
  "configuration.inspect",
  "configuration.apply",
  "work.start",
  "work.status",
  "work.wait",
  "work.steer",
  "work.readLatest",
  "threads.new",
  "threads.search",
  "threads.open",
  "messages.compose",
  "messages.submit",
  "messages.ask",
  "messages.wait",
  "messages.readLatest",
  "messages.status",
  "messages.waitAndRead",
  "artifacts.listLatest",
  "artifacts.wait",
  "artifacts.downloadLatest",
  "files.preflight",
  "files.attach",
  "files.downloadLatest",
  "projects.sources.list",
  "projects.sources.planAdd",
  "projects.sources.add",
  "modes.set",
  "modes.get",
  "tools.select",
  "response.copy"
] as const;

export type BackendCommand = typeof backendCommands[number];

export type BackendRequest = {
  schemaVersion: typeof BACKEND_REQUEST_SCHEMA_VERSION;
  requestId?: string;
  command: BackendCommand;
  payload: Record<string, unknown>;
};

export type BackendProtocolErrorCode =
  | "invalid_request"
  | "unsupported_schema_version"
  | "unknown_command";

export class ProtocolError extends Error {
  constructor(
    public readonly code: BackendProtocolErrorCode,
    message: string,
    public readonly recoverable: boolean
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

export type BackendResponseOk<TResult = unknown> = {
  schemaVersion: typeof BACKEND_RESPONSE_SCHEMA_VERSION;
  requestId?: string;
  ok: true;
  result: TResult;
};

export type BackendResponseError = {
  schemaVersion: typeof BACKEND_RESPONSE_SCHEMA_VERSION;
  requestId?: string;
  ok: false;
  error: {
    code: BackendProtocolErrorCode | string;
    message: string;
    recoverable: boolean;
  };
};

export type BackendResponse<TResult = unknown> = BackendResponseOk<TResult> | BackendResponseError;

export type BackendCapabilities = {
  protocolVersion: typeof BACKEND_REQUEST_SCHEMA_VERSION;
  commands: BackendCommand[];
  transports: Array<"stdio" | "http">;
  streaming: {
    modes: Array<"ndjson" | "sse">;
    tokenDeltas: false;
  };
};

export type BackendRunItemStreamEvent = {
  type: "run_item_stream_event";
  name: string;
  item: Record<string, unknown>;
};

export type BackendAgentUpdatedStreamEvent = {
  type: "agent_updated_stream_event";
  agent: Record<string, unknown>;
};

export type BackendCompletedEvent = {
  type: "completed";
  result: unknown;
};

export type BackendErrorEvent = {
  type: "error";
  error: {
    code: string;
    message: string;
    recoverable: boolean;
  };
};

export type BackendEventPayload =
  | BackendRunItemStreamEvent
  | BackendAgentUpdatedStreamEvent
  | BackendCompletedEvent
  | BackendErrorEvent;

export type BackendEvent = BackendEventPayload & {
  schemaVersion: typeof BACKEND_EVENT_SCHEMA_VERSION;
  requestId?: string;
};

const commandSet = new Set<string>(backendCommands);

export function parseBackendRequest(raw: unknown): BackendRequest {
  if (!isRecord(raw)) {
    throw new ProtocolError("invalid_request", "Backend request must be an object.", false);
  }

  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== BACKEND_REQUEST_SCHEMA_VERSION) {
    throw new ProtocolError(
      "unsupported_schema_version",
      `Unsupported backend request schemaVersion: ${String(schemaVersion)}`,
      false
    );
  }

  const command = raw.command;
  if (typeof command !== "string" || !commandSet.has(command)) {
    throw new ProtocolError("unknown_command", `Unknown backend command: ${String(command)}`, false);
  }

  const request: BackendRequest = {
    schemaVersion: BACKEND_REQUEST_SCHEMA_VERSION,
    command: command as BackendCommand,
    payload: normalizePayload(raw.payload)
  };

  if (raw.requestId !== undefined) {
    if (typeof raw.requestId !== "string" || raw.requestId.length === 0) {
      throw new ProtocolError("invalid_request", "Backend request requestId must be a non-empty string when provided.", false);
    }
    request.requestId = raw.requestId;
  }

  return request;
}

export function backendResponseOk<TResult>(requestId: string | undefined, result: TResult): BackendResponseOk<TResult> {
  const response: BackendResponseOk<TResult> = {
    schemaVersion: BACKEND_RESPONSE_SCHEMA_VERSION,
    ok: true,
    result
  };
  if (requestId !== undefined) response.requestId = requestId;
  return response;
}

export function backendResponseError(requestId: string | undefined, error: ProtocolError | Error): BackendResponseError {
  const response: BackendResponseError = {
    schemaVersion: BACKEND_RESPONSE_SCHEMA_VERSION,
    ok: false,
    error: {
      code: error instanceof ProtocolError ? error.code : "invalid_request",
      message: error.message,
      recoverable: error instanceof ProtocolError ? error.recoverable : false
    }
  };
  if (requestId !== undefined) response.requestId = requestId;
  return response;
}

export function backendEvent(requestId: string | undefined, payload: BackendEventPayload): BackendEvent {
  const event: BackendEvent = {
    schemaVersion: BACKEND_EVENT_SCHEMA_VERSION,
    ...payload
  };
  if (requestId !== undefined) event.requestId = requestId;
  return event;
}

export function backendEventCompleted(requestId: string | undefined, result: unknown): BackendEvent {
  return backendEvent(requestId, { type: "completed", result });
}

function normalizePayload(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new ProtocolError("invalid_request", "Backend request payload must be an object when provided.", false);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
