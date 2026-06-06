import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createChatGPT } from "../../src/client.js";
import type { BrowserLike, CommandResult, PageLike } from "../../src/types.js";

describe("createChatGPT", () => {
  it("plans ask as a new-thread Markdown workflow by default", () => {
    const chatgpt = createChatGPT();
    const plan = chatgpt.plan("new-ask-read", { prompt: "reply with the word hi" });

    expect(plan?.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.new",
      "messages.ask"
    ]);
    expect(plan?.steps.at(-1)).toMatchObject({
      command: "messages.ask",
      args: {
        text: "reply with the word hi",
        wait: true,
        read: { format: "markdown" }
      }
    });
  });

  it("preserves visible mode by default but honors explicit client mode defaults", () => {
    const preserving = createChatGPT();
    const configured = createChatGPT({ defaults: { mode: { effort: "Thinking" } } });

    expect(preserving.plan("new-ask-read", { prompt: "reply with hi" })?.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.new",
      "messages.ask"
    ]);

    const configuredPlan = configured.plan("new-ask-read", { prompt: "reply with hi" });
    expect(configuredPlan?.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.new",
      "modes.set",
      "messages.ask"
    ]);
    expect(configuredPlan?.steps[2]).toMatchObject({
      command: "modes.set",
      args: { effort: "Thinking" }
    });
  });

  it("exposes registry-backed help and descriptors", () => {
    const chatgpt = createChatGPT();

    expect(chatgpt.commands({ layer: "workflow" }).map(command => command.name)).toContain("ask");
    expect(chatgpt.describe("messages.readLatest")).toMatchObject({
      layer: "primitive",
      risk: "medium",
      args: expect.objectContaining({ format: expect.stringContaining("markdown") }),
      retryPolicy: expect.stringContaining("CommandResult")
    });
    expect(chatgpt.describe("ask")).toMatchObject({
      defaults: expect.objectContaining({ wait: true, read: { format: "markdown" } })
    });
    expect(chatgpt.help("ask")).toContain("Ask ChatGPT");
    expect(chatgpt.help("ask")).toContain("Retry policy:");
  });

  it("builds named macro plans", () => {
    const chatgpt = createChatGPT();
    const plan = chatgpt.plan("find-open-copy-latest", { query: "SDK Design Proposal" });
    const askPlan = chatgpt.plan("find-open-ask-read", { query: "SDK Design Proposal", prompt: "Continue." });

    expect(plan?.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.search",
      "threads.open",
      "response.copy"
    ]);
    expect(askPlan?.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.search",
      "threads.open",
      "messages.ask"
    ]);
  });

  it("returns structured failures for invalid named workflows", async () => {
    const chatgpt = createChatGPT();

    const unknown = await chatgpt.runPlan({ name: "missing-plan" });
    const invalid = await chatgpt.runPlan({ name: "new-ask-read", input: {} });

    expect(unknown.ok).toBe(false);
    expect(unknown.status).toBe("error");
    expect(unknown.error?.message).toContain("Unknown ChatGPT workflow plan");
    expect(invalid.ok).toBe(false);
    expect(invalid.status).toBe("error");
    expect(invalid.error?.message).toContain("prompt");
  });

  it("runs direct named diagnostic and report macros", async () => {
    const page = fakeChatGPTPage();
    const browser: BrowserLike = { name: "chrome", tabs: { selected: () => page } };
    const chatgpt = createChatGPT({ browser });

    const doctorResult = await chatgpt.runPlan({ name: "doctor-upload" });
    expect(doctorResult.ok).toBe(true);
    expect((doctorResult.data as { checks?: unknown }).checks).toBeDefined();

    const dir = await mkdtemp(join(tmpdir(), "chatgpt-macro-report-"));
    const reportResult = await chatgpt.runPlan({
      name: "redacted-run-report",
      input: {
        result: {
          ok: true,
          status: "ok",
          data: { responseText: "private@example.com" },
          warnings: [],
          context: { timestamp: "2026-06-05T00:00:00.000Z" }
        }
      },
      report: { destDir: dir }
    });

    expect(reportResult.ok).toBe(true);
    expect((reportResult.data as { path?: string }).path).toContain(dir);
  });

  it("offers primitive namespaces", () => {
    const chatgpt = createChatGPT();

    expect(typeof chatgpt.session.bootstrap).toBe("function");
    expect(typeof chatgpt.threads.search).toBe("function");
    expect(typeof chatgpt.messages.readLatest).toBe("function");
    expect(typeof chatgpt.files.attach).toBe("function");
    expect(typeof chatgpt.response.copy).toBe("function");
  });

  it("blocks workflows that exceed run budgets before opening the browser", async () => {
    const chatgpt = createChatGPT({ limits: { maxPromptsPerRun: 1 } });
    const result = await chatgpt.runMessages({
      messages: [
        { prompt: "first" },
        { prompt: "second" }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("needs_confirmation");
    expect(result.blocker?.message).toContain("prompts 2/1");
  });

  it("returns confirmation when a generated report exceeds the byte budget", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-budget-report-"));
    const chatgpt = createChatGPT({ limits: { maxReportBytesPerRun: 1 }, reporting: { destDir: dir } });

    const result = await chatgpt.runPlan({
      name: "new-ask-read",
      input: { prompt: "reply with hi" },
      report: true
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("needs_confirmation");
    expect(result.reportPath).toContain(dir);
    expect(result.warnings.join(" ")).toContain("byte budget");
    expect(result.blocker?.message).toContain("larger than the configured budget");
    expect(result.context.timestamp).toBeDefined();
    expect(result.steps?.map(step => ({
      id: step.id,
      command: step.command,
      status: step.status,
      ok: step.ok
    }))).toEqual([
      {
        id: "bootstrap",
        command: "session.bootstrap",
        status: "blocked",
        ok: false
      }
    ]);
  });

  it("writes redacted reports by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-report-"));
    const chatgpt = createChatGPT();
    const result: CommandResult<unknown> = {
      ok: true,
      status: "ok",
      data: {
        name: "customer-contract-private.pdf",
        files: [
          {
            name: "private@example.com-contract.pdf",
            path: "/example/user/secret/private@example.com-contract.pdf"
          }
        ],
        responseText: "private@example.com /example/user/secret token_12345678901234567890123456789012"
      },
      warnings: ["warning includes private@example.com"],
      error: { name: "PrivateError", message: "/example/user/secret", recoverable: true },
      blocker: { kind: "unknown", message: "token_12345678901234567890123456789012", visibleText: "private@example.com" },
      context: { timestamp: "2026-06-05T00:00:00.000Z", title: "private@example.com", url: "https://chatgpt.com/c/private" }
    };

    const report = await chatgpt.createReport(result, { destDir: dir });

    expect(report.ok).toBe(true);
    const body = await readFile(report.data!.path, "utf8");
    expect(body).toContain("[redacted:");
    expect(body).not.toContain("private@example.com");
    expect(body).not.toContain("/example/user/secret");
    expect(body).not.toContain("token_12345678901234567890123456789012");
    expect(body).not.toContain("customer-contract-private.pdf");
    expect(body).not.toContain("private@example.com-contract.pdf");
    expect(body).toContain("\"status\": \"ok\"");
  });

  it("summarizes and redacts report values through the reports namespace", async () => {
    const chatgpt = createChatGPT();
    const result: CommandResult<unknown> = {
      ok: false,
      status: "blocked",
      warnings: ["private@example.com"],
      blocker: { kind: "unknown", message: "private@example.com" },
      context: { timestamp: "2026-06-05T00:00:00.000Z", title: "private@example.com" }
    };

    const summary = await chatgpt.reports.summarize(result);
    const redacted = await chatgpt.reports.redact({ text: "private@example.com" });

    expect(summary.ok).toBe(true);
    expect(JSON.stringify(summary.data)).not.toContain("private@example.com");
    expect(redacted.data).toEqual({ text: "[redacted:19 chars]" });
  });

  it("doctor reports upload permission remediation", async () => {
    const page = fakeChatGPTPage();
    const browser: BrowserLike = { name: "chrome", tabs: { selected: () => page } };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({ check: ["bridge", "login", "upload"] });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.bridge?.status).toBe("ok");
    expect(result.data?.checks.login?.status).toBe("ok");
    expect(result.data?.checks.upload?.remediation?.join(" ")).toContain("Codex Settings > Computer Use > Chrome");
    expect(result.data?.checks.upload?.remediation?.join(" ")).toContain("Allow access to file URLs");
  });

  it("doctor explains ordinary-shell bridge blockers and live bootstrap recovery", async () => {
    const chatgpt = createChatGPT({ now: () => new Date("2026-06-06T00:00:00.000Z") });

    const result = await chatgpt.doctor({ check: ["bridge"] });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.bridge).toMatchObject({
      status: "blocked",
      message: expect.stringContaining("ordinary shell")
    });
    expect(result.data?.checks.bridge?.message).toContain("setupBrowserRuntime");
    expect(result.data?.checks.bridge?.remediation?.join(" ")).toContain("scripts/http_stdio_relay.mjs");
  });

  it("doctor does not show bridge bootstrap remediation when ChatGPT login is required", async () => {
    const browser: BrowserLike = { name: "chrome", tabs: { selected: () => fakeLoginPage() } };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({ check: ["bridge", "login"] });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.bridge).toMatchObject({
      status: "ok",
      message: expect.stringContaining("login is required")
    });
    expect(result.data?.checks.bridge?.remediation).toBeUndefined();
    expect(result.data?.checks.login).toMatchObject({
      status: "blocked",
      remediation: [expect.stringContaining("sign in")]
    });
  });
});

function fakeChatGPTPage(): PageLike {
  return {
    url: () => "https://chatgpt.com/",
    title: async () => "ChatGPT",
    content: async () => "<main>New chat Search chats Chat with ChatGPT</main>",
    locator: () => ({ count: async () => 0 }),
    waitForEvent: async () => ({})
  };
}

function fakeLoginPage(): PageLike {
  return {
    url: () => "https://chatgpt.com/",
    title: async () => "ChatGPT",
    content: async () => "<main>Welcome back. Sign in to continue to ChatGPT.</main>",
    locator: () => ({ count: async () => 0 }),
    waitForEvent: async () => ({})
  };
}
