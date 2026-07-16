import { describe, expect, it } from "vitest";
import { createChatGPT } from "../../src/client.js";
import { toRunResult } from "../../src/runner/result.js";
import { responseFromRunResult, responsesCreateArgsToRunInput, validateResponsesCreateArgs } from "../../src/runner/responses.js";

describe("Responses adapter validation", () => {
  it("accepts browser-compatible response fields", () => {
    const result = validateResponsesCreateArgs({
      input: "hi",
      thread: { type: "new" },
      attachments: [{ path: "/tmp/context.md" }],
      experience: "work",
      configuration: { model: "GPT-5.6 Sol", effort: "High" },
      mode: { effort: "Thinking" },
      tools: [{ tool: "web_search" }],
      existingTab: true,
      preferExistingTab: true,
      text: { format: "markdown" },
      stream: false,
      report: false
    });

    expect(result.ok).toBe(true);
  });

  it("maps existing-tab fields into runner input", () => {
    const input = responsesCreateArgsToRunInput({
      input: "Continue.",
      thread: { type: "url", url: "https://chatgpt.com/c/abc-123" },
      existingTab: true,
      preferExistingTab: true,
      text: { format: "markdown" }
    });

    expect(input).toMatchObject({
      input: "Continue.",
      thread: { type: "url", url: "https://chatgpt.com/c/abc-123" },
      existingTab: true,
      preferExistingTab: true,
      response: { format: "markdown" }
    });
  });

  it("maps Chat/Work experience and configuration into runner input", () => {
    const input = responsesCreateArgsToRunInput({
      input: "Produce a brief.",
      experience: "work",
      configuration: {
        model: "GPT-5.6 Sol",
        effort: "High",
        speed: "Standard"
      }
    });

    expect(input).toMatchObject({
      input: "Produce a brief.",
      experience: "work",
      configuration: {
        model: "GPT-5.6 Sol",
        effort: "High",
        speed: "Standard"
      }
    });
  });

  it.each([
    "model",
    "temperature",
    "top_p",
    "seed",
    "logprobs",
    "top_logprobs",
    "previous_response_id",
    "store",
    "service_tier",
    "max_output_tokens",
    "parallel_tool_calls",
    "truncation"
  ])("rejects API-only field %s", field => {
    const result = validateResponsesCreateArgs({
      input: "hi",
      [field]: "bad"
    } as Record<string, unknown>);

    expect(result.ok).toBe(false);
    expect(result.unsupported[0]).toMatchObject({
      path: field,
      reason: expect.stringContaining("visible ChatGPT browser control")
    });
    expect(result.unsupported[0]?.alternative).toBeTruthy();
  });

  it("rejects hidden instructions unless visible prefix is explicit", () => {
    const result = validateResponsesCreateArgs({
      input: "hi",
      instructions: "hidden system semantics"
    });

    expect(result.ok).toBe(false);
    expect(result.unsupported[0]?.path).toBe("instructions");
    expect(result.unsupported[0]?.alternative).toContain("instructionsMode");
  });

  it("accepts instructions only when visible prefix is explicit", () => {
    const result = validateResponsesCreateArgs({
      input: "hi",
      instructions: "These will be sent visibly.",
      instructionsMode: "visible_prefix"
    });

    expect(result.ok).toBe(true);
  });

  it("returns an unsupported browser response without submitting prompts", async () => {
    const chatgpt = createChatGPT({ limits: { maxPromptsPerRun: 0 } });

    const response = await chatgpt.responses.create({
      input: "hi",
      model: "gpt-5.5"
    } as Record<string, unknown>);

    expect(response).toMatchObject({
      object: "chatgpt.browser.response",
      status: "unsupported",
      output_text: "",
      output: [],
      browser_control: {
        visibleUi: true,
        resultStatus: "unsupported",
        unsupported: [
          expect.objectContaining({
            path: "model"
          })
        ]
      }
    });
  });

  it("maps accepted calls through the runner response shape", async () => {
    const chatgpt = createChatGPT({ limits: { maxPromptsPerRun: 0 } });

    const response = await chatgpt.responses.create({
      input: "hi",
      thread: { type: "new" },
      text: { format: "markdown" },
      stream: false
    });

    expect(response.object).toBe("chatgpt.browser.response");
    expect(response.status).toBe("needs_confirmation");
    expect(response.browser_control.resultStatus).toBe("needs_confirmation");
    expect(response.output[0]).toMatchObject({
      type: "run.blocked",
      blocker: expect.objectContaining({ code: "run_budget_exceeded" })
    });
  });

  it("maps partial runner results through the response shape", () => {
    const chatgpt = createChatGPT();
    const agent = chatgpt.agent({ name: "reviewer" });
    const runResult = toRunResult(agent, {
      ok: false,
      status: "partial",
      data: {
        prompt: "Write 500 numbered items.",
        responseText: "I will now produce the list.",
        complete: false,
        completionState: "generating",
        generationActive: true
      },
      warnings: ["Timed out after receiving partial assistant text."],
      context: {
        timestamp: "2026-06-10T00:00:00.000Z",
        conversationId: "fixture-partial"
      }
    });

    const response = responseFromRunResult(runResult, new Date("2026-06-10T00:00:00.000Z"));

    expect(response.status).toBe("partial");
    expect(response.output_text).toBe("I will now produce the list.");
    expect(response.browser_control.resultStatus).toBe("partial");
    expect(response.browser_control.completionState).toBe("generating");
    expect(response.browser_control.generationActive).toBe(true);
    expect(response.browser_control.thread?.conversationId).toBe("fixture-partial");
  });
});
