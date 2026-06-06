import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachAskRead,
  attachFiles,
  askMessage,
  bootstrap,
  composeMessage,
  createChatGPT,
  copyResponse,
  downloadLatestAttachment,
  newThread,
  openThread,
  readLatest,
  runSequence,
  searchThreads,
  selectTool,
  setMode,
  submitMessage,
  twoTurnExchange,
  waitAndRead,
  waitForMessage
} from "../../index.js";
import type {
  AskReadData,
  CommandResult,
  RuntimeEnv,
  SequencePlan,
  SequenceStepResult
} from "../../types.js";
import type { ChatGPTResponse } from "../../runner/types.js";
import { contextEnvFlag, contextEnvText } from "./harness.js";
import type { LiveSmokeContext, LiveSmokeScenario, LiveSmokeScenarioResult } from "./types.js";

type ScenarioBody = (context: LiveSmokeContext, meta: ScenarioMeta) => Promise<LiveSmokeScenarioResult>;

type ScenarioMeta = {
  name: string;
  required: boolean;
  startedAt: string;
  startedMs: number;
};

export const requiredScenarios: LiveSmokeScenario[] = [
  scenario("bootstrap-new-tab", true, () => true, async (context, meta) => {
    const env = envFor(context);
    const result = await bootstrap(env, { preferExistingTab: false, timeoutMs: 60000 });
    return result.ok && result.context.url?.includes("chatgpt.com") === true
      ? pass(meta, result)
      : fail(meta, result);
  }),
  scenario("bootstrap-reuse-tab", true, () => true, async (context, meta) => {
    const env = envFor(context);
    const created = await bootstrap(env, { preferExistingTab: false, timeoutMs: 60000 });
    if (!created.ok) return fail(meta, created);
    const reused = await bootstrap(env, { preferExistingTab: true, timeoutMs: 60000 });
    return reused.ok && reused.context.tabId === created.context.tabId
      ? pass(meta, reused, { createdTabId: created.context.tabId, reusedTabId: reused.context.tabId })
      : fail(meta, reused, { createdTabId: created.context.tabId, reusedTabId: reused.context.tabId });
  }),
  scenario("new-ask-read", true, () => true, async (context, meta) => {
    const env = await bootNewThread(context, meta);
    if ("status" in env) return env;
    const result = await askMessage(env, {
      text: "reply with the word hi",
      wait: { timeoutMs: 120000, stableMs: 2000 },
      read: true
    });
    return textEquals(okText(result), "hi") ? pass(meta, result) : fail(meta, result);
  }),
  scenario("compose-submit-wait-read", true, () => true, async (context, meta) => {
    const env = await bootNewThread(context, meta);
    if ("status" in env) return env;
    const text = "reply with the word hi";
    const composed = await composeMessage(env, { text });
    if (!composed.ok) return fail(meta, composed);
    const submitted = await submitMessage(env, { text, timeoutMs: 30000 });
    if (!submitted.ok) return fail(meta, submitted);
    const waited = await waitForMessage(env, { timeoutMs: 120000, stableMs: 2000 });
    if (!waited.ok) return fail(meta, waited);
    const read = await readLatest(env, { role: "assistant", format: "normalized_text" });
    return textEquals(read.data?.text, "hi") ? pass(meta, read) : fail(meta, read);
  }),
  scenario("wait-and-read", true, () => true, async (context, meta) => {
    const env = await bootNewThread(context, meta);
    if ("status" in env) return env;
    const asked = await askMessage(env, { text: "reply with the word hi", wait: false, read: false });
    if (!asked.ok) return fail(meta, asked);
    const result = await waitAndRead(env, { timeoutMs: 120000, stableMs: 2000, role: "assistant", format: "normalized_text" });
    return textEquals(okText(result), "hi") ? pass(meta, result) : fail(meta, result);
  }),
  scenario("format-fidelity-markdown-default", true, () => true, async (context, meta) => {
    const env = await bootNewThread(context, meta);
    if ("status" in env) return env;
    const prompt = [
      "Respond with exactly this Markdown structure and no extra prose:",
      "",
      "## Format Fidelity",
      "",
      "- Markdown default",
      "- Structure preserved",
      "",
      "```ts",
      "const format = \"markdown\";",
      "```",
      "",
      "| Format | Purpose |",
      "| --- | --- |",
      "| markdown | reports |"
    ].join("\n");
    const asked = await askMessage(env, {
      text: prompt,
      wait: { timeoutMs: 120000, stableMs: 2000 },
      read: false
    });
    if (!asked.ok) return fail(meta, asked);
    const result = await readLatest(env, { role: "assistant" });
    const markdown = result.data?.markdown ?? result.data?.text ?? "";
    if (!(result.ok
      && result.data?.format === "markdown"
      && markdown.includes("## Format Fidelity")
      && markdown.includes("- Markdown default")
      && markdown.includes("```")
      && markdown.includes("| Format | Purpose |"))) {
      return fail(meta, result, { markdownPreview: markdown.slice(0, 500), format: result.data?.format });
    }

    const copied = await copyResponse(env, { prefer: "clipboard", format: "markdown" });
    const copiedMarkdown = copied.data?.markdown ?? copied.data?.text ?? "";
    const copySourceOk = copied.data?.source === "clipboard"
      || (copied.data?.source === "dom" && copied.warnings.some(warning => warning.includes("clipboard") || warning.includes("DOM-derived")));
    return copied.ok
      && copySourceOk
      && copiedMarkdown.includes("## Format Fidelity")
      && copiedMarkdown.includes("- Markdown default")
      && copiedMarkdown.includes("```")
      && copiedMarkdown.includes("| Format | Purpose |")
      ? pass(meta, copied, { readSource: result.data?.source, copySource: copied.data?.source })
      : fail(meta, copied, { copiedPreview: copiedMarkdown.slice(0, 500), copySource: copied.data?.source });
  }),
  scenario("sdk-doctor", true, () => true, async (context, meta) => {
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const result = await chatgpt.doctor({ check: ["bridge", "login", "upload"] });
    const uploadRemediation = result.data?.checks.upload?.remediation?.join(" ") ?? "";
    return result.ok
      && result.data?.checks.bridge?.status === "ok"
      && result.data?.checks.login?.status !== "blocked"
      && uploadRemediation.includes("Codex Settings > Computer Use > Chrome")
      && uploadRemediation.includes("Allow access to file URLs")
      ? pass(meta, result)
      : fail(meta, result, { uploadRemediation });
  }),
  scenario("redacted-run-report", true, () => true, async (context, meta) => {
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const command: CommandResult<unknown> = {
      ok: true,
      status: "ok",
      data: {
        responseText: "private@example.com /example/user/private token_12345678901234567890123456789012"
      },
      warnings: [],
      context: { timestamp: meta.startedAt, url: "https://chatgpt.com/c/redacted-smoke" }
    };
    const result = await chatgpt.createReport(command, { destDir: context.reportDir, basename: "redacted-run-report" });
    const path = result.data?.path;
    const body = path === undefined ? "" : await readFile(path, "utf8").catch(() => "");
    return result.ok
      && body.includes("[redacted:")
      && !body.includes("private@example.com")
      && !body.includes("/example/user/private")
      ? pass(meta, result, { path })
      : fail(meta, result, { path, bodyPreview: body.slice(0, 500) });
  }),
  scenario("runner-new-ask-read", true, () => true, async (context, meta) => {
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const agent = chatgpt.agent({
      name: "live-smoke-runner",
      defaults: {
        wait: { timeoutMs: 120000, stableMs: 2000 },
        read: { format: "normalized_text" }
      }
    });
    const result = await chatgpt.runner.run(agent, {
      input: "reply with the word hi",
      thread: { type: "new" },
      response: { format: "normalized_text" }
    });
    return textEquals(result.output_text, "hi") ? pass(meta, result) : fail(meta, result);
  }),
  scenario("runner-attach-ask-read", true, () => true, async (context, meta) => {
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const agent = chatgpt.agent({
      name: "live-smoke-runner-attach",
      defaults: {
        wait: { timeoutMs: 180000, stableMs: 2000 },
        read: { format: "normalized_text" }
      }
    });
    const file = await tempFile("chatgpt-live-smoke-runner-attach.txt", "Runner attachment fixture.\n");
    const result = await chatgpt.runner.run(agent, {
      input: "Reply with the attached filename only.",
      thread: { type: "new" },
      attachments: [{ path: file }],
      response: { format: "normalized_text" }
    });
    return includesUploadedFilename(result.output_text, "chatgpt-live-smoke-runner-attach.txt") ? pass(meta, result) : fail(meta, result);
  }),
  scenario("runner-search-open-ask-read", true, () => true, async (context, meta) => {
    const query = requireInput(context.knownThreadQuery, "CHATGPT_SMOKE_QUERY");
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const agent = chatgpt.agent({
      name: "live-smoke-runner-search",
      defaults: {
        wait: { timeoutMs: 120000, stableMs: 2000 },
        read: { format: "normalized_text" }
      }
    });
    const result = await chatgpt.runner.run(agent, {
      input: "reply with the word hi",
      thread: { type: "search", query, select: "first" },
      response: { format: "normalized_text" }
    });
    return textEquals(result.output_text, "hi") ? pass(meta, result) : fail(meta, result);
  }),
  scenario("runner-two-turn", true, () => true, async (context, meta) => {
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const agent = chatgpt.agent({
      name: "live-smoke-runner-two-turn",
      defaults: {
        wait: { timeoutMs: 120000, stableMs: 2000 },
        read: { format: "normalized_text" }
      }
    });
    const first = await chatgpt.runner.run(agent, {
      input: "Reply with exactly alpha.",
      thread: { type: "new" },
      response: { format: "normalized_text" }
    });
    if (!textEquals(first.output_text, "alpha")) return fail(meta, first, { first: first.output_text });
    const second = await chatgpt.runner.run(agent, {
      input: "Reply with exactly beta.",
      thread: { type: "current" },
      response: { format: "normalized_text" }
    });
    return textEquals(second.output_text, "beta")
      ? pass(meta, second, { first: first.output_text, second: second.output_text })
      : fail(meta, second, { first: first.output_text, second: second.output_text });
  }),
  scenario("runner-report-redacted", true, () => true, async (context, meta) => {
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const agent = chatgpt.agent({
      name: "live-smoke-runner-report",
      defaults: {
        wait: { timeoutMs: 120000, stableMs: 2000 },
        read: { format: "normalized_text" }
      }
    });
    const secret = "runnerreportsecret";
    const result = await chatgpt.runner.run(agent, {
      input: `reply with the word ${secret}`,
      thread: { type: "new" },
      response: { format: "normalized_text" },
      report: { enabled: true, destDir: context.reportDir, basename: "runner-report-redacted", includeContent: false }
    });
    const path = result.data?.reportPath ?? result.reportPath;
    const body = path === undefined ? "" : await readFile(path, "utf8").catch(() => "");
    return result.ok
      && path !== undefined
      && body.includes("[redacted:")
      && !body.includes(secret)
      ? pass(meta, result, { path })
      : fail(meta, result, { path, bodyPreview: body.slice(0, 500), output: result.output_text });
  }),
  scenario("runner-mode-unavailable", true, () => true, async (context, meta) => {
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const agent = chatgpt.agent({ name: "live-smoke-runner-mode" });
    const result = await chatgpt.runner.run(agent, {
      input: "reply with hi",
      thread: { type: "new" },
      mode: { model: "definitely-not-a-visible-chatgpt-mode", timeoutMs: 30000 },
      response: { format: "normalized_text" }
    });
    const interruption = result.interruptions[0];
    return !result.ok
      && interruption?.type === "selector_drift"
      && (interruption.blocker?.candidates?.length ?? 0) > 0
      ? pass(meta, result, { candidates: interruption.blocker?.candidates })
      : fail(meta, result, { interruptions: result.interruptions });
  }),
  scenario("responses-create-basic", true, () => true, async (context, meta) => {
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const response = await chatgpt.responses.create({
      input: "reply with the word hi",
      thread: { type: "new" },
      text: { format: "normalized_text" },
      stream: false
    });
    const command = responseCommand(response);
    return response.object === "chatgpt.browser.response" && textEquals(response.output_text, "hi")
      ? pass(meta, command)
      : fail(meta, command);
  }),
  scenario("responses-unsupported-temperature", true, () => true, async (context, meta) => {
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const response = await chatgpt.responses.create({
      input: "hi",
      temperature: 0.2
    } as Record<string, unknown>);
    const command = responseCommand(response);
    const unsupported = response.browser_control.unsupported ?? [];
    return response.status === "unsupported" && unsupported.some(field => field.path === "temperature")
      ? pass(meta, command)
      : fail(meta, command);
  }),
  scenario("responses-unsupported-previous-response-id", true, () => true, async (context, meta) => {
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const response = await chatgpt.responses.create({
      input: "hi",
      previous_response_id: "resp_123"
    } as Record<string, unknown>);
    const command = responseCommand(response);
    const unsupported = response.browser_control.unsupported ?? [];
    return response.status === "unsupported"
      && unsupported.some(field => field.path === "previous_response_id" && field.alternative?.includes("thread") === true)
      ? pass(meta, command)
      : fail(meta, command);
  }),
  scenario("two-turn-exchange", true, () => true, async (context, meta) => {
    const env = await bootNewThread(context, meta);
    if ("status" in env) return env;
    const result = await twoTurnExchange({
      thread: {},
      text: "Reply with exactly alpha.",
      followupText: "Reply with exactly beta."
    }, env);
    const first = stepPreviewText(result.steps, "ask1");
    const second = okText(result);
    return result.ok && includesText(first, "alpha") && includesText(second, "beta")
      ? pass(meta, result, { firstPreview: first, secondPreview: second })
      : fail(meta, result, { firstPreview: first, secondPreview: second });
  }),
  scenario("search-open-read", true, () => true, async (context, meta) => {
    const query = requireInput(context.knownThreadQuery, "CHATGPT_SMOKE_QUERY");
    const env = await boot(context, meta);
    if ("status" in env) return env;
    const search = await searchThreads(env, { query, limit: 5 });
    if (!search.ok || search.data?.results[0] === undefined) return fail(meta, search);
    const opened = await openThread(env, { fromStep: "find", select: "first" }, new Map([["find", search]]));
    if (!opened.ok) return fail(meta, opened);
    const read = await readLatest(env, { role: "assistant", format: "normalized_text" });
    return read.ok && (read.data?.text.trim().length ?? 0) > 0 ? pass(meta, read) : fail(meta, read);
  }),
  scenario("open-by-url", true, () => true, async (context, meta) => {
    const url = requireInput(context.knownThreadUrl, "CHATGPT_SMOKE_THREAD_URL");
    const env = await boot(context, meta);
    if ("status" in env) return env;
    const opened = await openThread(env, { url, timeoutMs: 60000 });
    if (!opened.ok) return fail(meta, opened);
    const read = await readLatest(env, { role: "assistant", format: "normalized_text" });
    return read.ok && opened.context.url?.includes(url) === true && (read.data?.text.trim().length ?? 0) > 0
      ? pass(meta, read, { openedUrl: opened.context.url })
      : fail(meta, read, { openedUrl: opened.context.url });
  }),
  scenario("open-by-conversation-id", true, () => true, async (context, meta) => {
    const conversationId = requireInput(context.knownConversationId, "CHATGPT_SMOKE_CONVERSATION_ID");
    const env = await boot(context, meta);
    if ("status" in env) return env;
    const opened = await openThread(env, { conversationId, timeoutMs: 60000 });
    if (!opened.ok) return fail(meta, opened);
    const read = await readLatest(env, { role: "assistant", format: "normalized_text" });
    return read.ok && opened.context.url?.includes(conversationId) === true && (read.data?.text.trim().length ?? 0) > 0
      ? pass(meta, read, { openedUrl: opened.context.url })
      : fail(meta, read, { openedUrl: opened.context.url });
  }),
  scenario("sequence-variable-open", true, () => true, async (context, meta) => {
    const query = requireInput(context.knownThreadQuery, "CHATGPT_SMOKE_QUERY");
    const env = envFor(context);
    const plan: SequencePlan = {
      name: "live-smoke-sequence-variable-open",
      steps: [
        { id: "bootstrap", command: "session.bootstrap", args: { preferExistingTab: false, timeoutMs: 60000 } },
        { id: "find", command: "threads.search", args: { query, limit: 5 } },
        { id: "open", command: "threads.open", args: { conversationId: "${find.data.results[0].conversationId}", timeoutMs: 60000 } },
        { id: "read", command: "messages.readLatest", args: { role: "assistant", format: "normalized_text" } }
      ]
    };
    const result = await runSequence(plan, env);
    return result.ok && includesStep(result.steps, "read") && okText(result).trim().length > 0
      ? pass(meta, result)
      : fail(meta, result);
  }),
  scenario("copy-latest", true, () => true, async (context, meta) => {
    const url = requireInput(context.knownThreadUrl, "CHATGPT_SMOKE_THREAD_URL");
    const env = await boot(context, meta);
    if ("status" in env) return env;
    const opened = await openThread(env, { url, timeoutMs: 60000 });
    if (!opened.ok) return fail(meta, opened);
    const result = await copyResponse(env, { which: "latest", timeoutMs: 5000 });
    return result.ok && (result.data?.text.trim().length ?? 0) > 0
      ? pass(meta, result, { source: result.data?.source })
      : fail(meta, result);
  }),
  scenario("attach-one-file", true, () => true, async (context, meta) => {
    const env = await bootNewThread(context, meta);
    if ("status" in env) return env;
    const file = await tempFile("chatgpt-live-smoke-single.txt", "Single file fixture.\n");
    const attached = await attachFiles(env, { paths: [file], timeoutMs: 180000 });
    if (!attached.ok) return fail(meta, attached);
    const result = await askMessage(env, {
      text: "Reply with the attached filename only.",
      wait: { timeoutMs: 180000, stableMs: 2000 },
      read: true
    });
    return includesUploadedFilename(okText(result), "chatgpt-live-smoke-single.txt") ? pass(meta, result) : fail(meta, result);
  }),
  scenario("attach-two-files", true, () => true, async (context, meta) => {
    const env = await bootNewThread(context, meta);
    if ("status" in env) return env;
    const first = await tempFile("chatgpt-live-smoke-a.txt", "File A fixture.\n");
    const second = await tempFile("chatgpt-live-smoke-b.txt", "File B fixture.\n");
    const attached = await attachFiles(env, { paths: [first, second], timeoutMs: 180000 });
    if (!attached.ok) return fail(meta, attached);
    const result = await askMessage(env, {
      text: "Reply with both attached filenames only.",
      wait: { timeoutMs: 180000, stableMs: 2000 },
      read: true
    });
    const text = okText(result);
    return includesUploadedFilename(text, "chatgpt-live-smoke-a.txt") && includesUploadedFilename(text, "chatgpt-live-smoke-b.txt")
      ? pass(meta, result)
      : fail(meta, result);
  }),
  scenario("attach-ask-read", true, () => true, async (context, meta) => {
    const env = envFor(context);
    const file = await tempFile("chatgpt-live-smoke-helper.txt", "Helper fixture.\n");
    const result = await attachAskRead({
      thread: {},
      files: [file],
      text: "Reply with the attached filename only.",
      wait: { timeoutMs: 180000, stableMs: 2000 },
      read: true
    }, env);
    return includesUploadedFilename(okText(result), "chatgpt-live-smoke-helper.txt") ? pass(meta, result) : fail(meta, result);
  }),
  scenario("wait-timeout", true, () => true, async (context, meta) => {
    const env = await bootNewThread(context, meta);
    if ("status" in env) return env;
    const result = await waitForMessage(env, { timeoutMs: 1000, stableMs: 500, pollMs: 250 });
    return !result.ok && result.status === "timeout" ? pass(meta, result) : fail(meta, result);
  }),
  scenario("missing-thread", true, () => true, async (context, meta) => {
    const env = await boot(context, meta);
    if ("status" in env) return env;
    const title = `chatgpt-live-smoke-missing-${Date.now()}`;
    const result = await openThread(env, { title, timeoutMs: 30000 });
    return !result.ok && result.status === "not_found"
      ? pass(meta, result, { title })
      : fail(meta, result, { title });
  })
];

export const optionalScenarios: LiveSmokeScenario[] = [
  scenario("download-generated-file", false, context => contextEnvFlag(context, "CHATGPT_E2E_DOWNLOAD"), async (context, meta) => {
    const env = await bootNewThread(context, meta);
    if ("status" in env) return env;
    const asked = await askMessage(env, {
      text: "Create a tiny CSV file named chatgpt-live-smoke.csv containing one row with columns name,value and values smoke,1. Provide it as a downloadable file.",
      wait: { timeoutMs: 180000, stableMs: 3000 },
      read: true
    });
    if (!asked.ok) return fail(meta, asked);
    const result = await downloadLatestAttachment({ destDir: context.reportDir, timeoutMs: 120000 }, env);
    const path = typeof result.data === "object" && result.data !== null ? (result.data as { path?: string }).path : undefined;
    const bytes = path === undefined ? 0 : (await stat(path).catch(() => undefined))?.size ?? 0;
    return result.ok && bytes > 0 ? pass(meta, result, { path, bytes }) : fail(meta, result, { path, bytes });
  }),
  scenario("set-mode-visible", false, context => contextEnvText(context, "CHATGPT_E2E_MODE_LABEL") !== undefined, async (context, meta) => {
    const label = requireInput(contextEnvText(context, "CHATGPT_E2E_MODE_LABEL"), "CHATGPT_E2E_MODE_LABEL");
    const env = await boot(context, meta);
    if ("status" in env) return env;
    const result = await setMode(env, { model: label, timeoutMs: 30000 });
    return result.ok || result.status === "unsupported" ? pass(meta, result) : fail(meta, result);
  }),
  scenario("select-web-search", false, context => contextEnvFlag(context, "CHATGPT_E2E_WEB_SEARCH"), async (context, meta) => {
    const env = await bootNewThread(context, meta);
    if ("status" in env) return env;
    const selected = await selectTool(env, { tool: "web_search", timeoutMs: 30000 });
    if (!selected.ok && selected.status !== "unsupported") return fail(meta, selected);
    const asked = selected.ok
      ? await askMessage(env, { text: "reply with the word hi", wait: { timeoutMs: 120000, stableMs: 2000 }, read: true })
      : selected;
    return selected.status === "unsupported" || textEquals(okText(asked), "hi") ? pass(meta, asked) : fail(meta, asked);
  }),
  scenario("select-deep-research", false, context => contextEnvFlag(context, "CHATGPT_E2E_DEEP_RESEARCH"), async (context, meta) => selectToolScenario(context, meta, "deep_research")),
  scenario("select-create-image", false, context => contextEnvFlag(context, "CHATGPT_E2E_CREATE_IMAGE"), async (context, meta) => selectToolScenario(context, meta, "create_image")),
  scenario("login-required-manual", false, context => contextEnvFlag(context, "CHATGPT_E2E_LOGIN_PROFILE"), async (context, meta) => {
    const env = envFor(context);
    const result = await bootstrap(env, { preferExistingTab: false, timeoutMs: 60000 });
    return !result.ok && result.blocker?.kind === "login_required" ? pass(meta, result) : fail(meta, result);
  }),
  scenario("upload-permission-manual", false, context => contextEnvFlag(context, "CHATGPT_E2E_UPLOAD_PERMISSION_MANUAL"), async (context, meta) => {
    const env = await bootNewThread(context, meta);
    if ("status" in env) return env;
    const file = await tempFile("chatgpt-live-smoke-upload-blocker.txt", "Upload blocker fixture.\n");
    const result = await attachFiles(env, { paths: [file], timeoutMs: 60000 });
    return !result.ok && result.blocker?.kind === "permission" && /Uploads|Allow access to file URLs/i.test(result.blocker.message)
      ? pass(meta, result)
      : fail(meta, result);
  }),
  scenario("stream-milestones", false, context => contextEnvFlag(context, "CHATGPT_E2E_STREAM"), async (context, meta) => {
    const chatgpt = createChatGPT(clientOptionsFor(context));
    const agent = chatgpt.agent({
      name: "live-smoke-stream",
      defaults: {
        wait: { timeoutMs: 120000, stableMs: 2000 },
        read: { format: "normalized_text" }
      }
    });
    const stream = chatgpt.runner.run(agent, {
      input: "reply with the word hi",
      thread: { type: "new" },
      response: { format: "normalized_text" }
    }, { stream: true });
    const events: string[] = [];
    for await (const event of stream) {
      events.push(event.name);
    }
    const result = await stream.completed;
    return textEquals(result.output_text, "hi") && events.includes("message_completed")
      ? pass(meta, result, { events })
      : fail(meta, result, { events });
  })
];

function scenario(
  name: string,
  required: boolean,
  enabled: (context: LiveSmokeContext) => boolean,
  run: ScenarioBody
): LiveSmokeScenario {
  return {
    name,
    required,
    enabled,
    run: context => {
      const startedAt = new Date().toISOString();
      return run(context, { name, required, startedAt, startedMs: Date.now() });
    }
  };
}

async function selectToolScenario(
  context: LiveSmokeContext,
  meta: ScenarioMeta,
  tool: string
): Promise<LiveSmokeScenarioResult> {
  const env = await boot(context, meta);
  if ("status" in env) return env;
  const result = await selectTool(env, { tool, timeoutMs: 30000 });
  return result.ok || result.status === "unsupported" ? pass(meta, result) : fail(meta, result);
}

async function boot(context: LiveSmokeContext, meta: ScenarioMeta): Promise<RuntimeEnv | LiveSmokeScenarioResult> {
  const env = envFor(context);
  const booted = await bootstrap(env, { preferExistingTab: false, timeoutMs: 60000 });
  return booted.ok ? env : fail(meta, booted);
}

async function bootNewThread(context: LiveSmokeContext, meta: ScenarioMeta): Promise<RuntimeEnv | LiveSmokeScenarioResult> {
  const env = await boot(context, meta);
  if ("status" in env) return env;
  const created = await newThread(env);
  return created.ok ? env : fail(meta, created);
}

function envFor(context: LiveSmokeContext): RuntimeEnv {
  const env: RuntimeEnv = { agent: context.agent };
  if (context.browser !== undefined) {
    env.browser = context.browser;
  }
  return env;
}

function clientOptionsFor(context: LiveSmokeContext): RuntimeEnv {
  return envFor(context);
}

function pass(
  meta: ScenarioMeta,
  command: CommandResult<unknown>,
  details?: Record<string, unknown>
): LiveSmokeScenarioResult {
  return finish(meta, "pass", command, details);
}

function fail(
  meta: ScenarioMeta,
  command: CommandResult<unknown>,
  details?: Record<string, unknown>
): LiveSmokeScenarioResult {
  return finish(meta, "fail", command, details);
}

function finish(
  meta: ScenarioMeta,
  status: "pass" | "fail",
  command: CommandResult<unknown>,
  details?: Record<string, unknown>
): LiveSmokeScenarioResult {
  const result: LiveSmokeScenarioResult = {
    name: meta.name,
    status,
    required: meta.required,
    startedAt: meta.startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - meta.startedMs,
    command
  };
  if (details !== undefined) {
    result.details = details;
  }
  return result;
}

function requireInput(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Harness configuration missing ${name}. Set ${name} before running the required live smoke matrix.`);
  }
  return value;
}

function okText(result: CommandResult<unknown>): string {
  const data = result.data as Partial<AskReadData> & { text?: string; responseText?: string } | undefined;
  return data?.responseText ?? data?.text ?? "";
}

function textEquals(actual: string | undefined, expected: string): boolean {
  return normalize(actual) === normalize(expected);
}

function includesText(actual: string | undefined, expected: string): boolean {
  return normalize(actual).includes(normalize(expected));
}

function includesUploadedFilename(actual: string | undefined, expected: string): boolean {
  const normalizedActual = normalize(actual);
  const extensionIndex = expected.lastIndexOf(".");
  if (extensionIndex === -1) {
    return normalizedActual.includes(normalize(expected));
  }

  const stem = escapeRegExp(expected.slice(0, extensionIndex).toLowerCase());
  const extension = escapeRegExp(expected.slice(extensionIndex).toLowerCase());
  return new RegExp(`${stem}(?:\\(\\d+\\))?${extension}`).test(normalizedActual);
}

function normalize(text: string | undefined): string {
  return (text ?? "").trim().toLowerCase().replace(/[.!?]+$/g, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stepPreviewText(steps: SequenceStepResult[] | undefined, id: string): string {
  const preview = steps?.find(step => step.id === id)?.dataPreview;
  if (preview !== undefined && typeof preview === "object" && preview !== null) {
    const data = preview as { responseText?: unknown; text?: unknown };
    if (typeof data.responseText === "string") return data.responseText;
    if (typeof data.text === "string") return data.text;
  }
  return "";
}

function includesStep(steps: SequenceStepResult[] | undefined, id: string): boolean {
  return steps?.some(step => step.id === id && step.ok) === true;
}

function responseCommand(response: ChatGPTResponse): CommandResult<unknown> {
  return {
    ok: response.status === "ok",
    status: response.status,
    data: response,
    warnings: [],
    context: { timestamp: new Date(response.created_at * 1000).toISOString() }
  };
}

async function tempFile(name: string, body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "chatgpt-live-smoke-"));
  const file = join(dir, name);
  await writeFile(file, body, "utf8");
  return file;
}
