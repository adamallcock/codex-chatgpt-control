import { describe, expect, it } from "vitest";
import type { ChatGPTClient } from "../../src/client.js";
import type { CommandResult } from "../../src/types.js";
import {
  parseContinueThreadCliArgs,
  runContinueThread,
  threadSelectorFromTarget
} from "../../src/scripts/continue-thread.js";

describe("continue-thread entrypoint", () => {
  it("treats pasted ChatGPT thread URLs as URL thread selectors", () => {
    expect(threadSelectorFromTarget("https://chatgpt.com/c/6a20e900-4744-83ea-9b80-2c75fb85bd63")).toEqual({
      type: "url",
      url: "https://chatgpt.com/c/6a20e900-4744-83ea-9b80-2c75fb85bd63"
    });
  });

  it("treats ordinary text as a history search selector", () => {
    expect(threadSelectorFromTarget("Naming macOS Utility")).toEqual({
      type: "search",
      query: "Naming macOS Utility",
      select: "first",
      limit: 5
    });
  });

  it("parses CLI arguments from positional target and prompt flags", () => {
    expect(parseContinueThreadCliArgs([
      "Naming",
      "macOS",
      "Utility",
      "--prompt",
      "Continue from the latest answer."
    ], {})).toEqual({
      target: "Naming macOS Utility",
      prompt: "Continue from the latest answer.",
      format: "markdown"
    });
  });

  it("parses selected existing-tab mode without a search target", () => {
    expect(parseContinueThreadCliArgs([
      "--existing",
      "selected",
      "--format",
      "normalized_text"
    ], {})).toEqual({
      existing: {
        target: { type: "selected", host: "chatgpt" },
        ifMissing: "block"
      },
      format: "normalized_text"
    });
  });

  it("parses existing conversation ids with explicit open-if-missing fallback", () => {
    expect(parseContinueThreadCliArgs([
      "--existing-conversation-id",
      "abc-123",
      "--open-if-missing"
    ], {})).toEqual({
      existing: {
        target: { type: "conversationId", conversationId: "abc-123" },
        ifMissing: "open"
      },
      format: "markdown"
    });
  });

  it("opens and reads when no prompt is supplied", async () => {
    const calls: string[] = [];
    const client = fakeClient(calls);

    const result = await runContinueThread(client, {
      target: "https://chatgpt.com/c/6a20e900-4744-83ea-9b80-2c75fb85bd63",
      format: "normalized_text"
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "open:https://chatgpt.com/c/6a20e900-4744-83ea-9b80-2c75fb85bd63",
      "read:normalized_text"
    ]);
  });

  it("bootstraps and reads the current thread when selected existing-tab mode is supplied", async () => {
    const calls: string[] = [];
    const client = fakeClient(calls);

    const result = await runContinueThread(client, {
      existing: {
        target: { type: "selected", host: "chatgpt" },
        ifMissing: "block"
      },
      format: "markdown"
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "bootstrap:selected",
      "read:markdown"
    ]);
  });

  it("bootstraps and continues the current thread when existing-tab mode has a prompt", async () => {
    const calls: string[] = [];
    const client = fakeClient(calls);

    const result = await runContinueThread(client, {
      existing: {
        target: { type: "selected", host: "chatgpt" },
        ifMissing: "block"
      },
      prompt: "Continue.",
      format: "markdown"
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "bootstrap:selected",
      "askInThread:current:Continue."
    ]);
  });

  it("continues the selected thread when a prompt is supplied", async () => {
    const calls: string[] = [];
    const client = fakeClient(calls);

    const result = await runContinueThread(client, {
      target: "Naming macOS Utility",
      prompt: "Continue from the latest answer.",
      format: "markdown"
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "askInThread:Naming macOS Utility:Continue from the latest answer."
    ]);
  });
});

function fakeClient(calls: string[]): Pick<ChatGPTClient, "askInThread" | "openThread" | "readLatest" | "session"> {
  return {
    session: {
      bootstrap: async args => {
        const target = args?.existingTab === true
          ? "true"
          : typeof args?.existingTab === "object" && args.existingTab.target?.type === "selected"
            ? "selected"
            : typeof args?.existingTab === "object" && args.existingTab.target?.type === "conversationId"
              ? `conversation:${args.existingTab.target.conversationId}`
              : "none";
        calls.push(`bootstrap:${target}`);
        return ok({});
      }
    },
    askInThread: async args => {
      const thread = args.thread as { query?: string; url?: string };
      calls.push(`askInThread:${thread.query ?? thread.url ?? ("type" in thread ? thread.type : undefined)}:${args.prompt}`);
      return ok({ responseText: "continued" });
    },
    openThread: async thread => {
      calls.push(`open:${"url" in thread ? thread.url : JSON.stringify(thread)}`);
      return ok({});
    },
    readLatest: async args => {
      calls.push(`read:${args?.format ?? "default"}`);
      return ok({ text: "latest" });
    }
  };
}

function ok(data: unknown): CommandResult<unknown> {
  return {
    ok: true,
    status: "ok",
    data,
    warnings: [],
    context: { timestamp: "2026-06-06T00:00:00.000Z" }
  };
}
