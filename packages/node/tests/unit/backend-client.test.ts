import { describe, expect, it } from "vitest";
import { createChatGPT } from "../../src/client.js";
import {
  createChatGPTBackendClient,
  StdioBackendTransport,
  type BackendTransport
} from "../../src/backend/client.js";
import { BackendSession } from "../../src/backend/session.js";
import {
  BACKEND_REQUEST_SCHEMA_VERSION,
  BACKEND_RESPONSE_SCHEMA_VERSION,
  type BackendEvent,
  type BackendRequest,
  type BackendResponse
} from "../../src/backend/protocol.js";
import type { ChatGPTInterruption } from "../../src/runner/types.js";

describe("ChatGPT backend client", () => {
  it("sends backend request envelopes", async () => {
    const transport = new RecordingTransport({
      ok: true,
      result: {
        ok: true,
        status: "ok",
        output_text: "hi",
        finalOutput: "hi",
        output: [],
        newItems: [],
        interruptions: [],
        state: { id: "state-1", resumable: false },
        activeAgentName: "reviewer",
        lastAgentName: "reviewer",
        warnings: [],
        context: { timestamp: "2026-06-06T00:00:00.000Z" }
      }
    });
    const chatgpt = createChatGPTBackendClient(transport);
    const agent = chatgpt.agent({ name: "reviewer", instructions: "Review deeply." });

    await chatgpt.runner.run(agent, "reply with hi");

    expect(transport.requests).toEqual([
      expect.objectContaining({
        schemaVersion: BACKEND_REQUEST_SCHEMA_VERSION,
        command: "runner.run",
        payload: {
          agent: expect.objectContaining({
            name: "reviewer",
            instructions: "Review deeply.",
            instructionsMode: "visible_prefix"
          }),
          input: "reply with hi"
        }
      })
    ]);
  });

  it("exposes guarded Pro review backend primitives", async () => {
    const transport = new RecordingTransport({
      ok: true,
      result: { ok: true, status: "ok", warnings: [], context: { timestamp: "2026-06-06T00:00:00.000Z" } }
    });
    const chatgpt = createChatGPTBackendClient(transport);

    expect(typeof chatgpt.proReview.dryRun).toBe("function");
    expect(typeof chatgpt.proReview.submitAndRead).toBe("function");
    expect(typeof chatgpt.session.assertChatGPTHost).toBe("function");
    expect(typeof chatgpt.temporary.ensureOn).toBe("function");
    expect(typeof chatgpt.messages.inspectComposer).toBe("function");
    expect(typeof chatgpt.files.preflight).toBe("function");
    expect(typeof chatgpt.files.verifyAttached).toBe("function");
    expect(typeof chatgpt.guards.assertSafeToSubmit).toBe("function");

    await chatgpt.proReview.dryRun({ zipPath: "/tmp/review.zip", prompt: "Review." });
    await chatgpt.session.assertChatGPTHost();
    await chatgpt.temporary.ensureOn();
    await chatgpt.messages.inspectComposer({ expectedSha256: "a".repeat(64) });
    await chatgpt.files.preflight({ paths: ["/tmp/review.zip"] });
    await chatgpt.files.verifyAttached({ expectedName: "review.zip" });
    await chatgpt.guards.assertSafeToSubmit({
      expectedPromptSha256: "a".repeat(64),
      expectedAttachmentName: "review.zip"
    });

    expect(transport.requests.map(request => request.command)).toEqual([
      "proReview.dryRun",
      "session.assertChatGPTHost",
      "temporary.ensureOn",
      "messages.inspectComposer",
      "files.preflight",
      "files.verifyAttached",
      "guards.assertSafeToSubmit"
    ]);
  });

  it("matches in-process runner plans", async () => {
    const options = deterministicOptions();
    const inProcess = createChatGPT(options);
    const backend = createChatGPTBackendClient(new SessionTransport(new BackendSession(options)));
    const agentConfig = { name: "reviewer", instructions: "Review deeply." };
    const input = {
      input: "Assess the SDK shape.",
      thread: { type: "conversationId" as const, conversationId: "abc-123" },
      response: { format: "markdown" as const }
    };

    const inProcessPlan = inProcess.runner.plan(inProcess.agent(agentConfig), input);
    const backendPlan = await backend.runner.plan(backend.agent(agentConfig), input);

    expect(backendPlan).toEqual(inProcessPlan);
  });

  it("matches in-process unsupported Responses adapter output", async () => {
    const options = deterministicOptions({ maxPromptsPerRun: 0 });
    const inProcess = createChatGPT(options);
    const backend = createChatGPTBackendClient(new SessionTransport(new BackendSession(options)));
    const args = { input: "hi", model: "gpt-5.5" };

    await expect(backend.responses.create(args)).resolves.toEqual(await inProcess.responses.create(args));
  });

  it("matches in-process command descriptors", async () => {
    const options = deterministicOptions();
    const inProcess = createChatGPT(options);
    const backend = createChatGPTBackendClient(new SessionTransport(new BackendSession(options)));

    await expect(backend.commands()).resolves.toEqual(inProcess.commands());
    await expect(backend.describe("runner.run")).resolves.toEqual(inProcess.describe("runner.run"));
    await expect(backend.help("runner.run")).resolves.toEqual(inProcess.help("runner.run"));
  });

  it("streams milestone events and final result from the backend", async () => {
    const options = deterministicOptions({ maxPromptsPerRun: 0 });
    const inProcess = createChatGPT(options);
    const backend = createChatGPTBackendClient(new SessionTransport(new BackendSession(options)));
    const inProcessAgent = inProcess.agent({ name: "stream-agent" });
    const backendAgent = backend.agent({ name: "stream-agent" });

    const expectedStream = inProcess.runner.run(inProcessAgent, "reply with hi", { stream: true });
    const expectedNames: string[] = [];
    for await (const event of expectedStream) expectedNames.push(event.name);

    const stream = backend.runner.stream(backendAgent, "reply with hi");
    const actualNames: string[] = [];
    for await (const event of stream) actualNames.push(event.name);

    expect(actualNames).toEqual(expectedNames);
    const expectedResult = await expectedStream.completed;
    await expect(stream.completed).resolves.toMatchObject({
      ok: expectedResult.ok,
      status: expectedResult.status,
      output_text: expectedResult.output_text,
      interruptions: expectedResult.interruptions.map(stableInterruption)
    });
  });

  it("rejects and clears pending requests when stdio backend times out", async () => {
    const transport = new StdioBackendTransport({
      command: [process.execPath, "-e", "process.stdin.resume();"],
      timeoutMs: 20
    });
    const backend = createChatGPTBackendClient(transport);

    await expect(backend.commands()).rejects.toMatchObject({
      code: "backend_timeout",
      recoverable: true
    });
    await backend.close();
  });

  it("rejects malformed stdio backend protocol lines immediately", async () => {
    const backend = createChatGPTBackendClient(new StdioBackendTransport({
      command: [process.execPath, "-e", [
        "process.stdin.once('data', () => {",
        "console.log(JSON.stringify({ schemaVersion: 'wrong.v1', requestId: 'req_1' }));",
        "});"
      ].join("")]
    }));

    await expect(backend.commands()).rejects.toMatchObject({
      code: "unsupported_backend_schema"
    });
    await backend.close();
  });

  it("rejects backend responses without requestId immediately", async () => {
    const backend = createChatGPTBackendClient(new StdioBackendTransport({
      command: [process.execPath, "-e", [
        "process.stdin.once('data', () => {",
        "console.log(JSON.stringify({ schemaVersion: 'chatgpt.browser_control.backend_response.v1', ok: true, result: [] }));",
        "});"
      ].join("")]
    }));

    await expect(backend.commands()).rejects.toMatchObject({
      code: "missing_backend_request_id"
    });
    await backend.close();
  });

  it("rejects events sent for non-streaming requests", async () => {
    const backend = createChatGPTBackendClient(new StdioBackendTransport({
      command: [process.execPath, "-e", [
        "process.stdin.once('data', line => {",
        "const request = JSON.parse(String(line));",
        "console.log(JSON.stringify({ schemaVersion: 'chatgpt.browser_control.backend_event.v1', requestId: request.requestId, type: 'completed', result: {} }));",
        "});"
      ].join("")]
    }));

    await expect(backend.commands()).rejects.toMatchObject({
      code: "unexpected_backend_event"
    });
    await backend.close();
  });
});

function deterministicOptions(limits: { maxPromptsPerRun?: number } = {}) {
  return {
    now: () => new Date("2026-06-06T00:00:00.000Z"),
    limits
  };
}

function stableInterruption(interruption: ChatGPTInterruption): Record<string, unknown> {
  const expected: Record<string, unknown> = {
    ...interruption,
    id: expect.any(String),
    resume: { ...interruption.resume }
  };
  const resume = expected.resume as Record<string, unknown>;
  if (resume.stateId !== undefined) {
    resume.stateId = expect.any(String);
  }
  return expected;
}

type RecordingResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; recoverable: boolean } };

class RecordingTransport implements BackendTransport {
  readonly requests: BackendRequest[] = [];

  constructor(private readonly response: RecordingResponse) {}

  async request(request: BackendRequest): Promise<BackendResponse> {
    this.requests.push(request);
    const response = {
      schemaVersion: BACKEND_RESPONSE_SCHEMA_VERSION,
      ...this.response
    } as BackendResponse;
    if (request.requestId !== undefined) response.requestId = request.requestId;
    return response;
  }

  async *stream(_request: BackendRequest): AsyncIterable<BackendEvent> {
    throw new Error("RecordingTransport.stream is not implemented for this test.");
  }
}

class SessionTransport implements BackendTransport {
  constructor(private readonly session: BackendSession) {}

  async request(request: BackendRequest): Promise<BackendResponse> {
    return this.session.dispatch(request);
  }

  stream(request: BackendRequest): AsyncIterable<BackendEvent> {
    return this.session.stream(request);
  }
}
