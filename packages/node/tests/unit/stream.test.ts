import { describe, expect, it } from "vitest";
import { createChatGPT } from "../../src/client.js";
import { createChatGPTAgent } from "../../src/runner/agent.js";
import { toRunResult } from "../../src/runner/result.js";
import { createMilestoneStream, streamFromRunResult } from "../../src/runner/stream.js";
import type { ChatGPTRunResult } from "../../src/runner/types.js";

describe("milestone stream", () => {
  it("emits milestone events and preserves final output", async () => {
    const stream = createMilestoneStream(async emit => {
      emit({
        type: "run_item_stream_event",
        name: "message_submitted",
        item: { type: "message.submitted", role: "user", preview: "hi", redacted: true }
      });
      emit({
        type: "run_item_stream_event",
        name: "message_completed",
        item: { type: "message.completed", role: "assistant", output_text: "hi", format: "markdown" }
      });
      return okRunResult("hi");
    });

    const names: string[] = [];
    for await (const event of stream) {
      names.push(event.name);
    }

    expect(names).toEqual(["message_submitted", "message_completed"]);
    await expect(stream.completed).resolves.toMatchObject({ output_text: "hi" });
  });

  it("supports runner.run stream mode with milestone events and completed result", async () => {
    const chatgpt = createChatGPT({ limits: { maxPromptsPerRun: 0 } });
    const agent = chatgpt.agent({ name: "stream-agent" });

    const stream = chatgpt.runner.run(agent, "reply with hi", { stream: true });
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({
        type: "run_item_stream_event",
        name: "run_blocked",
        item: expect.objectContaining({ type: "run.blocked" })
      })
    ]);
    await expect(stream.completed).resolves.toMatchObject({
      status: "needs_confirmation",
      output_text: ""
    });
  });

  it("derives submitted and completed milestones from runner result data", async () => {
    const agent = createChatGPTAgent({ name: "stream-agent" });
    const result = toRunResult(agent, {
      ok: true,
      status: "ok",
      warnings: [],
      context: { timestamp: "2026-06-05T00:00:00.000Z" },
      data: {
        prompt: "reply with hi",
        responseText: "hi",
        complete: true,
        completionState: "complete"
      }
    });

    const stream = streamFromRunResult(async () => result);
    const names: string[] = [];
    for await (const event of stream) {
      names.push(event.name);
    }

    expect(names).toEqual(["message_submitted", "message_completed"]);
    await expect(stream.completed).resolves.toMatchObject({ output_text: "hi" });
  });

  it("maps partial runner output to message_in_progress milestones", async () => {
    const agent = createChatGPTAgent({ name: "stream-agent" });
    const result = toRunResult(agent, {
      ok: false,
      status: "partial",
      warnings: ["Timed out after receiving partial assistant text."],
      context: { timestamp: "2026-06-05T00:00:00.000Z" },
      data: {
        prompt: "write a long list",
        responseText: "partial list",
        complete: false,
        completionState: "generating",
        generationActive: true
      }
    });

    const stream = streamFromRunResult(async () => result);
    const names: string[] = [];
    for await (const event of stream) {
      names.push(event.name);
    }

    expect(names).toEqual(["message_submitted", "message_in_progress"]);
    await expect(stream.completed).resolves.toMatchObject({ output_text: "partial list" });
  });

  it("emits Chat/Work experience and configuration milestones from verified sequence steps", async () => {
    const agent = createChatGPTAgent({ name: "stream-agent" });
    const result = toRunResult(agent, {
      ok: true,
      status: "ok",
      warnings: [],
      context: { timestamp: "2026-07-16T00:00:00.000Z" },
      data: {
        prompt: "continue",
        responseText: "done",
        complete: true,
        completionState: "complete"
      },
      steps: [
        {
          id: "experience",
          command: "experience.open",
          ok: true,
          status: "ok",
          startedAt: "2026-07-16T00:00:00.000Z",
          endedAt: "2026-07-16T00:00:00.001Z",
          dataPreview: { experience: "work", changed: true },
          warnings: []
        },
        {
          id: "configuration",
          command: "configuration.apply",
          ok: true,
          status: "ok",
          startedAt: "2026-07-16T00:00:00.001Z",
          endedAt: "2026-07-16T00:00:00.002Z",
          dataPreview: {
            requested: { model: "GPT-5.6 Sol", effort: "High" },
            verified: true
          },
          warnings: []
        }
      ]
    });

    const stream = streamFromRunResult(async () => result);
    const names: string[] = [];
    for await (const event of stream) names.push(event.name);

    expect(names).toEqual([
      "experience_opened",
      "configuration_applied",
      "message_submitted",
      "message_completed"
    ]);
    expect(result.output).toContainEqual({
      type: "configuration.applied",
      requested: { model: "GPT-5.6 Sol", effort: "High" },
      verified: true
    });
  });
});

function okRunResult(outputText: string): ChatGPTRunResult {
  return {
    ok: true,
    status: "ok",
    warnings: [],
    context: { timestamp: "2026-06-05T00:00:00.000Z" },
    data: { outputText, finalOutput: outputText },
    output_text: outputText,
    output: [],
    newItems: [],
    interruptions: [],
    state: { id: "state-1", resumable: false },
    activeAgentName: "agent",
    lastAgentName: "agent",
    finalOutput: outputText
  };
}
