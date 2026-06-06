import { describe, expect, it } from "vitest";
import { resolveVariableReference, runSequenceWithExecutor } from "../../src/commands/sequence.js";
import type { CommandResult } from "../../src/types.js";

describe("runSequence", () => {
  it("stops after a failed step and returns prior successful results", async () => {
    const result = await runSequenceWithExecutor({
      name: "stop-example",
      policy: { stopOnError: true, returnPartial: true },
      steps: [
        { id: "find", command: "threads.search", args: { query: "Naming" } },
        { id: "open", command: "threads.open", args: { conversationId: "missing" } },
        { id: "ask", command: "messages.ask", args: { text: "hi" } }
      ]
    }, async step => {
      if (step.id === "open") {
        return { ok: false, status: "not_found", warnings: [], context: { timestamp: "t" } };
      }
      return { ok: true, status: "ok", data: { id: step.id }, warnings: [], context: { timestamp: "t" } };
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("partial");
    expect(result.steps?.map(step => step.id)).toEqual(["find", "open"]);
    expect((result.data as Record<string, unknown>).find).toEqual({ id: "find" });
  });

  it("resolves safe variable paths", () => {
    const previous = new Map<string, CommandResult<unknown>>();
    previous.set("find", {
      ok: true,
      status: "ok",
      data: { results: [{ conversationId: "abc" }] },
      warnings: [],
      context: { timestamp: "t" }
    });

    expect(resolveVariableReference("${find.data.results[0].conversationId}", previous)).toBe("abc");
  });

  it("exposes assistant response text at the top level of workflow results", async () => {
    const result = await runSequenceWithExecutor({
      name: "ask-example",
      steps: [
        { id: "bootstrap", command: "session.bootstrap" },
        { id: "ask", command: "messages.ask", args: { text: "hi" } }
      ]
    }, async step => ({
      ok: true,
      status: "ok",
      data: step.id === "ask" ? { prompt: "hi", responseText: "hello" } : {},
      warnings: [],
      context: { timestamp: "t" }
    }));

    expect(result.output_text).toBe("hello");
    expect((result.data as { responseText?: string }).responseText).toBe("hello");
  });

  it("rejects unsafe variable paths", () => {
    expect(() => resolveVariableReference("${input.__proto__.polluted}", new Map(), {})).toThrow("Unsafe");
  });
});
