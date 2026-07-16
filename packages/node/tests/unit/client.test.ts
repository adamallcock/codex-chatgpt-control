import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    expect(chatgpt.describe("files.preflight")).toMatchObject({
      layer: "primitive",
      risk: "low",
      blockers: expect.arrayContaining(["not_found", "permission", "upload_failed"])
    });
    expect(chatgpt.describe("modes.get")).toMatchObject({
      layer: "primitive",
      risk: "low",
      blockers: expect.arrayContaining(["selector_drift"])
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
    expect(typeof chatgpt.messages.status).toBe("function");
    expect(typeof chatgpt.artifacts.downloadLatest).toBe("function");
    expect(typeof chatgpt.files.preflight).toBe("function");
    expect(typeof chatgpt.files.attach).toBe("function");
    expect(typeof chatgpt.response.copy).toBe("function");
  });

  it("plans create-image downloads through artifact primitives", () => {
    const chatgpt = createChatGPT();
    const agent = chatgpt.agent({
      name: "image-agent",
      defaults: { wait: { timeoutMs: 120000, stableMs: 0, pollMs: 1 } }
    });

    const plan = chatgpt.runner.plan(agent, {
      input: "Create an image of a golden dog on grass.",
      tools: [{ tool: "create_image" }],
      download: { destDir: "/tmp/generated" }
    });

    expect(plan.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.new",
      "tools.select",
      "artifacts.listLatest",
      "messages.ask",
      "artifacts.wait",
      "artifacts.downloadLatest"
    ]);
    expect(plan.steps.find(step => step.id === "ask")).toMatchObject({
      command: "messages.ask",
      args: {
        wait: false,
        read: false
      }
    });
    expect(plan.steps.find(step => step.id === "artifact")).toMatchObject({
      command: "artifacts.wait",
      args: {
        kind: "image",
        afterArtifactCount: "${artifactBaseline.data.count}",
        requireDownload: true,
        timeoutMs: 120000,
        stableMs: 0,
        pollMs: 1
      }
    });
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

  it("plans existingTab reuse as an exact URL claim for high-level runner calls", () => {
    const chatgpt = createChatGPT();
    const agent = chatgpt.agent({ name: "existing-tab-agent" });

    const plan = chatgpt.runner.plan(agent, {
      input: "Continue.",
      thread: { type: "url", url: "https://chatgpt.com/c/abc-123" },
      existingTab: true
    });

    expect(plan.steps[0]).toEqual({
      id: "bootstrap",
      command: "session.bootstrap",
      args: {
        existingTab: {
          target: { type: "url", url: "https://chatgpt.com/c/abc-123" },
          ifMissing: "block",
          ifMultiple: "block",
          requireChatGPT: true
        }
      }
    });
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

  it("doctor preserves the lightweight default checks", async () => {
    const page = fakeChatGPTPage();
    const browser: BrowserLike = { name: "chrome", tabs: { selected: () => page } };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor();

    expect(result.ok).toBe(true);
    expect(Object.keys(result.data?.checks ?? {})).toEqual([
      "bridge",
      "login",
      "upload",
      "download",
      "clipboard",
      "modes",
      "tools",
      "selectors"
    ]);
    expect(result.data?.checks).not.toHaveProperty("existing_tab");
    expect(result.data?.checks).not.toHaveProperty("artifacts");
    expect(result.data?.checks).not.toHaveProperty("file_preflight");
    expect(result.data?.checks).not.toHaveProperty("localization");
    expect(result.data?.checks).not.toHaveProperty("reports");
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

  it("doctor reports missing existing-tab targets without opening or claiming a tab", async () => {
    const claimed: unknown[] = [];
    const created: string[] = [];
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "other", url: "https://chatgpt.com/c/other", title: "Other Chat" }
        ],
        claimTab: async tab => {
          claimed.push(tab);
          throw new Error("claimTab should not be called for a missing existing-tab target.");
        }
      },
      tabs: {
        create: async url => {
          created.push(url);
          return fakeChatGPTPage();
        }
      }
    };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({
      check: ["existing_tab"],
      existingTab: {
        target: { type: "conversationId", conversationId: "abc-123" },
        ifMissing: "block"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.data?.ready).toBe(false);
    expect(result.data?.checks.existing_tab).toMatchObject({
      status: "blocked",
      blockerKind: "not_found",
      code: "existing_tab_not_found",
      nextCommand: "session.bootstrap",
      details: {
        existingTab: {
          requestedTarget: {
            type: "conversationId",
            conversationId: "abc-123"
          },
          mismatchReason: "conversation_id_mismatch",
          chatgptTabCount: 1
        }
      }
    });
    expect(claimed).toEqual([]);
    expect(created).toEqual([]);
  });

  it("doctor reuses exact existing-tab bootstrap for other requested bootstrap checks", async () => {
    const claimed: string[] = [];
    const selected: string[] = [];
    const created: string[] = [];
    const pages = new Map([
      ["other", fakeChatGPTPage("https://chatgpt.com/c/other")],
      ["target", fakeChatGPTPage("https://chatgpt.com/c/target")]
    ]);
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "other", url: "https://chatgpt.com/c/other", title: "Other Chat" },
          { id: "target", url: "https://chatgpt.com/c/target", title: "Target Chat" }
        ],
        claimTab: async tab => {
          const tabId = typeof tab === "string" ? tab : tab.id;
          const tabUrl = typeof tab === "string" ? undefined : tab.url;
          claimed.push(tabId);
          return pages.get(tabId) ?? fakeChatGPTPage(tabUrl);
        }
      },
      tabs: {
        selected: () => {
          selected.push("selected");
          return pages.get("other")!;
        },
        create: async url => {
          created.push(url);
          return fakeChatGPTPage(url);
        }
      }
    };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({
      check: ["bridge", "existing_tab"],
      existingTab: {
        target: { type: "conversationId", conversationId: "target" },
        ifMissing: "block"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.bridge?.status).toBe("ok");
    expect(result.data?.checks.existing_tab?.status).toBe("ok");
    expect(claimed).toEqual(["target"]);
    expect(selected).toEqual([]);
    expect(created).toEqual([]);
  });

  it("doctor reports ambiguous existing-tab targets with metadata-only candidates", async () => {
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "one", url: "https://chatgpt.com/c/one", title: "SDK Review" },
          { id: "two", url: "https://chatgpt.com/c/two", title: "SDK Review" }
        ],
        claimTab: async () => {
          throw new Error("claimTab should not be called for ambiguous existing-tab targets.");
        }
      }
    };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({
      check: ["existing_tab"],
      existingTab: {
        target: { type: "title", title: "SDK Review" },
        ifMultiple: "block"
      }
    });

    expect(result.data?.checks.existing_tab).toMatchObject({
      status: "blocked",
      code: "existing_tab_ambiguous",
      details: {
        existingTab: {
          mismatchReason: "multiple_candidates",
          candidateTabs: [
            {
              id: "one",
              url: "https://chatgpt.com/c/one",
              title: "SDK Review",
              conversationId: "one"
            },
            {
              id: "two",
              url: "https://chatgpt.com/c/two",
              title: "SDK Review",
              conversationId: "two"
            }
          ]
        }
      }
    });
  });

  it("doctor verifies localization registry readiness without a browser bridge", async () => {
    const chatgpt = createChatGPT();

    const result = await chatgpt.doctor({ check: ["localization"] });

    expect(result.ok).toBe(true);
    expect(result.data?.ready).toBe(true);
    expect(result.data?.checks.localization).toMatchObject({
      status: "unknown",
      message: expect.stringContaining("registry-only"),
      details: {
        englishCanonicalPresent: true,
        requiredKeysMissing: [],
        runtimeSelectorCoverage: "registry_only_stage_2",
        runningStateLabelCoverage: {
          support: "partial",
          nonEnglishStopControlLocaleCount: expect.any(Number),
          nonEnglishStoppedAssistantLocaleCount: 0,
          stopControlCandidateCount: expect.any(Number),
          stoppedAssistantCandidateCount: expect.any(Number)
        },
        toolIds: expect.arrayContaining(["web_search", "deep_research", "create_image"])
      }
    });
    const coverage = result.data?.checks.localization?.details?.runningStateLabelCoverage as {
      nonEnglishLocaleCount?: number;
      nonEnglishStopControlLocaleCount?: number;
    } | undefined;
    expect(coverage?.nonEnglishStopControlLocaleCount).toBe(coverage?.nonEnglishLocaleCount);
  });

  it("doctor verifies report output policy and existing directory writability", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-doctor-reports-"));
    const chatgpt = createChatGPT();

    const result = await chatgpt.doctor({
      check: ["reports"],
      report: { destDir: dir }
    });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.reports).toMatchObject({
      status: "ok",
      message: expect.stringContaining("writable"),
      details: {
        destDir: dir,
        includeContent: false,
        redactionDefault: true
      }
    });
  });

  it("doctor reports when requested report policy persists raw content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-doctor-reports-raw-"));
    const chatgpt = createChatGPT();

    const result = await chatgpt.doctor({
      check: ["reports"],
      report: { destDir: dir, includeContent: true }
    });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.reports).toMatchObject({
      status: "ok",
      message: expect.stringContaining("raw content persistence is enabled"),
      details: {
        destDir: dir,
        includeContent: true,
        redactionDefault: false
      }
    });
    expect(result.data?.checks.reports?.message).not.toContain("redaction is enabled");
  });

  it("askWithFiles stops on local file preflight blockers before opening a browser", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-preflight-client-missing-"));
    const missing = join(dir, "missing.md");
    const opened: string[] = [];
    const browser: BrowserLike = {
      name: "chrome",
      tabs: {
        selected: () => {
          throw new Error("selected tab should not be read when file preflight fails.");
        },
        create: async url => {
          opened.push(url);
          return fakeChatGPTPage();
        }
      }
    };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.askWithFiles({
      prompt: "summarize",
      files: [missing],
      wait: false,
      read: false
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("not_found");
    expect(result.blocker).toMatchObject({
      kind: "not_found",
      code: "file_missing",
      fieldPath: "paths[0]"
    });
    expect(result.steps).toBeUndefined();
    expect(opened).toEqual([]);
  });

  it("doctor validates file preflight metadata without opening a browser", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-doctor-file-preflight-"));
    const file = join(dir, "spec.md");
    await writeFile(file, "hello");
    const opened: string[] = [];
    const browser: BrowserLike = {
      name: "chrome",
      tabs: {
        create: async url => {
          opened.push(url);
          return fakeChatGPTPage();
        }
      }
    };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({
      check: ["file_preflight"],
      files: [file]
    });

    expect(result.ok).toBe(true);
    expect(result.data?.ready).toBe(true);
    expect(result.data?.checks.file_preflight).toMatchObject({
      status: "ok",
      details: {
        pathCount: 1,
        totalBytes: 5,
        files: [
          {
            name: "spec.md",
            bytes: 5,
            extension: ".md",
            mimeType: "text/markdown",
            category: "text"
          }
        ]
      }
    });
    expect(opened).toEqual([]);
  });

  it("doctor reports artifact primitive readiness without requesting generation", async () => {
    const page = fakeChatGPTPage();
    const chatgpt = createChatGPT({ page });

    const result = await chatgpt.doctor({ check: ["artifacts"] });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.artifacts).toMatchObject({
      status: "ok",
      details: {
        pageAvailable: true,
        selectorsAvailable: true,
        downloadEventsAvailable: true
      }
    });
  });

  it("blocks direct primitives when the claimed tab changes after bootstrap", async () => {
    const page = fakeChatGPTPage() as PageLike;
    page.id = "tab-1";
    const browser: BrowserLike = { name: "chrome", tabs: { selected: () => page } };
    const chatgpt = createChatGPT({ browser });

    const boot = await chatgpt.session.bootstrap({ preferExistingTab: true });
    page.id = "tab-2";
    const result = await chatgpt.messages.status();

    expect(boot.ok).toBe(true);
    expect(boot.context.tabId).toBe("tab-1");
    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "tab_affinity_lost"
    });
  });
});

function fakeChatGPTPage(url = "https://chatgpt.com/"): PageLike {
  return {
    url: () => url,
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
