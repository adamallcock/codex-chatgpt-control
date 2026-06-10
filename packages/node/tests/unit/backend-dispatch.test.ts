import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BackendSession } from "../../src/backend/session.js";
import {
  BACKEND_REQUEST_SCHEMA_VERSION,
  type BackendCommand,
  type BackendResponse,
  type BackendResponseOk,
  parseBackendRequest
} from "../../src/backend/protocol.js";

describe("backend dispatch", () => {
  it("reports backend version, health, and capabilities", async () => {
    const session = deterministicSession();

    await expect(send(session, "backend.version")).resolves.toMatchObject({
      ok: true,
      result: {
        name: "codex-chatgpt-control-backend",
        runtime: "node"
      }
    });

    await expect(send(session, "backend.health")).resolves.toMatchObject({
      ok: true,
      result: {
        ok: true,
        status: "ok"
      }
    });

    const capabilities = await send(session, "backend.capabilities");
    expectOk(capabilities);
    expect(capabilities).toMatchObject({
      ok: true,
      result: {
        protocolVersion: BACKEND_REQUEST_SCHEMA_VERSION,
        transports: ["stdio"],
        streaming: { modes: ["ndjson"], tokenDeltas: false }
      }
    });
    expect((capabilities.result as { commands: string[] }).commands).toContain("runner.run");
    expect((capabilities.result as { commands: string[] }).commands).toContain("responses.create");
  });

  it("dispatches runner.plan through the public ChatGPT client", async () => {
    const response = await send(deterministicSession(), "runner.plan", {
      agent: { name: "reviewer", instructions: "Review deeply." },
      input: {
        input: "Assess the SDK shape.",
        thread: { type: "conversationId", conversationId: "abc-123" },
        response: { format: "markdown" }
      }
    });

    expect(response.ok).toBe(true);
    expectOk(response);
    expect(response.result).toMatchObject({
      name: "agent-run:reviewer",
      steps: [
        { command: "session.bootstrap" },
        { command: "threads.open", args: { conversationId: "abc-123" } },
        { command: "messages.ask" }
      ]
    });
  });

  it("dispatches runner.run and preserves structured browser-control results", async () => {
    const response = await send(deterministicSession({ maxPromptsPerRun: 0 }), "runner.run", {
      agent: { name: "reviewer" },
      input: "reply with hi"
    });

    expect(response.ok).toBe(true);
    expectOk(response);
    expect(response.result).toMatchObject({
      ok: false,
      status: "needs_confirmation",
      activeAgentName: "reviewer",
      output: [
        {
          type: "run.blocked",
          blocker: expect.objectContaining({
            kind: "confirmation",
            code: "run_budget_exceeded"
          })
        }
      ]
    });
  });

  it("dispatches responses.create without submitting unsupported calls", async () => {
    const response = await send(deterministicSession({ maxPromptsPerRun: 0 }), "responses.create", {
      input: "hi",
      model: "gpt-5.5"
    });

    expect(response.ok).toBe(true);
    expectOk(response);
    expect(response.result).toMatchObject({
      object: "chatgpt.browser.response",
      status: "unsupported",
      browser_control: {
        unsupported: [
          expect.objectContaining({ path: "model" })
        ]
      }
    });
  });

  it("dispatches command registry helpers", async () => {
    const session = deterministicSession();

    const commands = await send(session, "commands");
    expect(commands.ok).toBe(true);
    expectOk(commands);
    expect(commands.result).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "runner.run" })
    ]));

    const describe = await send(session, "describe", { name: "runner.run" });
    expectOk(describe);
    expect(describe).toMatchObject({
      ok: true,
      result: expect.objectContaining({
        name: "runner.run",
        layer: "workflow"
      })
    });

    const help = await send(session, "help", { topic: "runner.run" });
    expect(help.ok).toBe(true);
    expectOk(help);
    expect(help.result).toContain("runner.run");
  });

  it("dispatches doctor checks as typed command results", async () => {
    const reportDir = await mkdtemp(join(tmpdir(), "chatgpt-backend-doctor-"));
    const response = await send(deterministicSession(), "doctor", {
      check: ["bridge", "upload", "localization", "reports", "file_preflight"],
      files: ["/absolute/path/spec.md"],
      report: { destDir: reportDir }
    });

    expect(response.ok).toBe(true);
    expectOk(response);
    expect(response.result).toMatchObject({
      ok: true,
      status: "ok",
      data: {
        ready: false,
        checks: {
          bridge: {
            status: "blocked"
          },
          upload: {
            status: "unknown"
          },
          localization: {
            status: "unknown"
          },
          reports: {
            status: "ok"
          },
          file_preflight: {
            status: "unsupported",
            code: "file_preflight_deferred"
          }
        }
      }
    });
  });
});

function deterministicSession(limits: { maxPromptsPerRun?: number } = {}): BackendSession {
  return new BackendSession({
    now: () => new Date("2026-06-06T00:00:00.000Z"),
    limits
  });
}

async function send(session: BackendSession, command: BackendCommand, payload: Record<string, unknown> = {}) {
  return session.dispatch(parseBackendRequest({
    schemaVersion: BACKEND_REQUEST_SCHEMA_VERSION,
    requestId: `req_${command}`,
    command,
    payload
  }));
}

function expectOk(response: BackendResponse): asserts response is BackendResponseOk {
  if (!response.ok) {
    throw new Error(`Expected backend response to be ok, got ${response.error.code}: ${response.error.message}`);
  }
}
