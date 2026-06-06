import { describe, expect, it } from "vitest";
import { createChatGPT } from "../../src/client.js";
import type { SequencePlan, SequenceStep } from "../../src/types.js";

describe("ChatGPT runner facade", () => {
  it("creates browser-control agents with explicit visible-instruction defaults", () => {
    const chatgpt = createChatGPT();
    const agent = chatgpt.agent({
      name: "reviewer",
      instructions: "Review deeply and be concise."
    });

    expect(agent).toMatchObject({
      kind: "chatgpt_browser_agent",
      name: "reviewer",
      instructionsMode: "visible_prefix",
      instructions: "Review deeply and be concise."
    });
    expect(agent.tools).toEqual([]);
    expect(agent.guardrails).toEqual([]);
  });

  it("plans visible-prefix instructions into a single ask step", () => {
    const chatgpt = createChatGPT();
    const agent = chatgpt.agent({
      name: "reviewer",
      instructions: "Review deeply."
    });

    const plan = chatgpt.runner.plan(agent, {
      input: "Assess the SDK shape.",
      thread: { type: "conversationId", conversationId: "abc-123" },
      response: { format: "markdown" }
    });

    expect(plan.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.open",
      "messages.ask"
    ]);
    expect(plan.steps[1]).toMatchObject({
      command: "threads.open",
      args: { conversationId: "abc-123" }
    });

    const ask = finalAsk(plan);
    expect(ask.args.text).toContain("<chatgpt_browser_agent>");
    expect(ask.args.text).toContain("Agent name: reviewer");
    expect(ask.args.text).toContain("Review deeply.");
    expect(ask.args.text).toContain("<user_request>");
    expect(ask.args.text).toContain("Assess the SDK shape.");
    expect(ask.args.read).toEqual({ format: "markdown" });
  });

  it("sets visible mode only when run input or defaults explicitly request it", () => {
    const chatgpt = createChatGPT();
    const preservingAgent = chatgpt.agent({ name: "reviewer" });
    const defaultedAgent = chatgpt.agent({
      name: "configured-reviewer",
      defaults: { mode: { effort: "Thinking" } }
    });

    const preservingPlan = chatgpt.runner.plan(preservingAgent, {
      input: "Assess the SDK shape.",
      thread: { type: "conversationId", conversationId: "abc-123" }
    });
    const explicitPlan = chatgpt.runner.plan(preservingAgent, {
      input: "Assess the SDK shape.",
      thread: { type: "conversationId", conversationId: "abc-123" },
      mode: { model: "Pro" }
    });
    const defaultedPlan = chatgpt.runner.plan(defaultedAgent, {
      input: "Assess the SDK shape.",
      thread: { type: "conversationId", conversationId: "abc-123" }
    });

    expect(preservingPlan.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.open",
      "messages.ask"
    ]);
    expect(explicitPlan.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.open",
      "modes.set",
      "messages.ask"
    ]);
    expect(explicitPlan.steps[2]).toMatchObject({
      command: "modes.set",
      args: { model: "Pro" }
    });
    expect(defaultedPlan.steps[2]).toMatchObject({
      command: "modes.set",
      args: { effort: "Thinking" }
    });
  });

  it("does not leak metadata-only instructions into visible prompt text", () => {
    const chatgpt = createChatGPT();
    const agent = chatgpt.agent({
      name: "local-router",
      instructions: "Never send this local routing note to ChatGPT.",
      instructionsMode: "metadata_only"
    });

    const plan = chatgpt.runner.plan(agent, "Summarize the latest response.");

    const ask = finalAsk(plan);
    expect(ask.args.text).toBe("Summarize the latest response.");
    expect(ask.args.text).not.toContain("local routing");
  });

  it("plans visible setup instructions as a separate budgeted user-visible turn", () => {
    const chatgpt = createChatGPT();
    const agent = chatgpt.agent({
      name: "setup-agent",
      instructions: "Use the attached plan as source of truth.",
      instructionsMode: "visible_setup_message"
    });

    const plan = chatgpt.runner.plan(agent, {
      input: [
        { type: "visible_instruction", text: "Prefer implementation-ready output." },
        { type: "input_text", text: "Design the command surface." },
        { type: "input_file", path: "/tmp/plan.md", description: "Current plan" }
      ],
      attachments: [{ path: "/tmp/audit.md" }]
    });

    expect(plan.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.new",
      "files.attach",
      "messages.ask",
      "messages.ask"
    ]);
    expect(plan.steps[2]).toMatchObject({
      command: "files.attach",
      args: { paths: ["/tmp/plan.md", "/tmp/audit.md"] }
    });

    const setup = plan.steps[3] as Extract<SequenceStep, { command: "messages.ask" }>;
    const ask = finalAsk(plan);
    expect(setup.id).toBe("agent_setup");
    expect(setup.args.text).toContain("Use the attached plan as source of truth.");
    expect(setup.args.read).toBe(false);
    expect(ask.args.text).toContain("Prefer implementation-ready output.");
    expect(ask.args.text).toContain("Design the command surface.");
    expect(ask.args.text).not.toContain("Use the attached plan as source of truth.");
  });

  it("maps guarded execution blockers into runner-shaped results", async () => {
    const chatgpt = createChatGPT({ limits: { maxPromptsPerRun: 0 } });
    const agent = chatgpt.agent({ name: "reviewer" });

    const result = await chatgpt.runner.run(agent, "reply with hi");

    expect(result.ok).toBe(false);
    expect(result.status).toBe("needs_confirmation");
    expect(result.activeAgentName).toBe("reviewer");
    expect(result.lastAgentName).toBe("reviewer");
    expect(result.output_text).toBe("");
    expect(result.finalOutput).toBeUndefined();
    expect(result.output).toEqual([
      {
        type: "run.blocked",
        blocker: expect.objectContaining({
          kind: "confirmation",
          code: "run_budget_exceeded",
          resumable: true
        })
      }
    ]);
    expect(result.interruptions).toEqual([
      expect.objectContaining({
        type: "approval_required",
        status: "needs_confirmation",
        message: expect.stringContaining("run budget"),
        resume: { supported: true, stateId: expect.any(String) }
      })
    ]);
  });

  it("surfaces browser-bridge remediation directly in runner interruptions", async () => {
    const chatgpt = createChatGPT({ now: () => new Date("2026-06-06T00:00:00.000Z") });
    const agent = chatgpt.agent({ name: "reviewer" });

    const result = await chatgpt.runner.run(agent, "reply with hi");

    expect(result.status).toBe("partial");
    expect(result.blocker).toMatchObject({
      kind: "browser_bridge_unavailable",
      code: "codex_chrome_bridge_unavailable",
      message: expect.stringContaining("ordinary shell")
    });
    expect(result.blocker?.message).toContain("setupBrowserRuntime");
    expect(result.blocker?.remediation?.map(step => step.label)).toEqual([
      "Ordinary shell",
      "Codex Chrome bootstrap",
      "Python live bridge",
      "Extension availability"
    ]);
    expect(result.interruptions[0]?.fix?.steps.join(" ")).toContain("scripts/http_stdio_relay.mjs");
  });
});

function finalAsk(plan: SequencePlan): Extract<SequenceStep, { command: "messages.ask" }> {
  const ask = plan.steps.at(-1);
  expect(ask?.command).toBe("messages.ask");
  return ask as Extract<SequenceStep, { command: "messages.ask" }>;
}
