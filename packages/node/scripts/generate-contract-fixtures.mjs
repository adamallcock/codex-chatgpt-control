import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FIXED_ISO = "2026-06-06T00:00:00.000Z";
const FIXED_DATE = new Date(FIXED_ISO);

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const contractRoot = join(root, "contracts", "v1");
const fixturesDir = join(contractRoot, "fixtures");
const manifestPath = join(contractRoot, "manifest.json");
const reportFixtureDir = join(root, "reports", "contract-fixtures");
const doctorScenarioReportDir = "/tmp/codex-chatgpt-control/reports/contract-fixtures/missing-doctor-reports";

const {
  createChatGPT,
  BackendSession,
  BACKEND_REQUEST_SCHEMA_VERSION,
  BROWSER_BRIDGE_UNAVAILABLE_MESSAGE
} = await loadBuiltSdk();

mkdirSync(fixturesDir, { recursive: true });

const generatedFixtures = [];
const chatgpt = createChatGPT({ now: () => FIXED_DATE });
rmSync(reportFixtureDir, { recursive: true, force: true });
rmSync(doctorScenarioReportDir, { recursive: true, force: true });

const BLOCKER_EXPLANATION_PROFILES = [
  { kind: "browser_bridge_unavailable", title: "Browser bridge unavailable", category: "environment", severity: "blocked", userActionRequired: false },
  { kind: "login_required", title: "Login required", category: "auth", severity: "action_required", userActionRequired: true },
  { kind: "captcha", title: "Captcha or human verification required", category: "auth", severity: "action_required", userActionRequired: true },
  { kind: "rate_limit", title: "Rate limited", category: "auth", severity: "action_required", userActionRequired: true },
  { kind: "modal", title: "Modal is blocking the page", category: "runtime", severity: "action_required", userActionRequired: true },
  { kind: "permission", title: "Permission required", category: "permission", severity: "action_required", userActionRequired: true },
  { kind: "confirmation", title: "Confirmation required", category: "user_confirmation", severity: "action_required", userActionRequired: true },
  { kind: "selector_drift", title: "Selector drift", category: "ui_drift", severity: "blocked", userActionRequired: false },
  { kind: "artifact_unavailable", title: "Artifact unavailable", category: "artifact", severity: "warning", userActionRequired: false },
  { kind: "artifact_selector_drift", title: "Artifact selector drift", category: "ui_drift", severity: "blocked", userActionRequired: false },
  { kind: "artifact_download_unavailable", title: "Artifact download unavailable", category: "download", severity: "warning", userActionRequired: false },
  { kind: "download_unavailable", title: "Download unavailable", category: "download", severity: "warning", userActionRequired: false },
  { kind: "upload_failed", title: "Upload failed", category: "upload", severity: "action_required", userActionRequired: true },
  { kind: "not_found", title: "Target not found", category: "not_found", severity: "warning", userActionRequired: false },
  { kind: "unknown", title: "Unknown blocker", category: "unknown", severity: "blocked", userActionRequired: false }
];

await writeGeneratedFixture(
  "backend-runner-plan-request.json",
  "backendRequest",
  "backend_runner_plan_request",
  backendRequest("runner.plan", {
    agent: { name: "visible-prefix-agent", instructionsMode: "visible_prefix" },
    input: "Assess the SDK architecture."
  })
);
await writeGeneratedFixture("backend-version.json", "backendResponse", "backend_version", await backendResponse("backend.version"));
await writeGeneratedFixture("backend-capabilities.json", "capabilities", "backend_capabilities", await backendResult("backend.capabilities"));
await writeGeneratedFixture("backend-error-missing-run-input.json", "backendResponse", "backend_error_missing_run_input", await backendResponse("runner.run", {
  agent: { name: "invalid-run-agent" }
}));
await writeGeneratedFixture(
  "backend-error-event-missing-stream-input.json",
  "backendEvent",
  "backend_error_event_missing_stream_input",
  (await backendStream("runner.stream", { agent: { name: "invalid-stream-agent" } }))[0]
);

await writeGeneratedFixture(
  "runner-visible-prefix-plan.json",
  "sequencePlan",
  "runner_visible_prefix_plan",
  await backendResult("runner.plan", {
    agent: {
      name: "visible-prefix-agent",
      instructions: "Answer with terse implementation guidance.",
      instructionsMode: "visible_prefix"
    },
    input: "Assess the SDK architecture."
  })
);

await writeGeneratedFixture(
  "runner-visible-setup-plan.json",
  "sequencePlan",
  "runner_visible_setup_plan",
  await backendResult("runner.plan", {
    agent: {
      name: "visible-setup-agent",
      instructions: "Maintain a careful review checklist.",
      instructionsMode: "visible_setup_message"
    },
    input: "Review parity gates."
  })
);

await writeGeneratedFixture(
  "runner-metadata-only-plan.json",
  "sequencePlan",
  "runner_metadata_only_plan",
  await backendResult("runner.plan", {
    agent: {
      name: "metadata-agent",
      instructions: "This should not become visible prompt text.",
      instructionsMode: "metadata_only"
    },
    input: {
      input: "Summarize visible-only behavior.",
      thread: { type: "conversationId", conversationId: "conv_metadata_123" },
      response: { format: "markdown" }
    }
  })
);

await writeGeneratedFixture(
  "runner-full-agent-config.json",
  "agent",
  "runner_full_agent_config",
  chatgpt.agent({
    name: "parity-reviewer",
    instructions: "Use visible ChatGPT browser control honestly.",
    instructionsMode: "visible_prefix",
    defaults: {
      thread: { type: "new" },
      wait: { stableMs: 0, pollMs: 0, timeoutMs: 100 },
      read: { format: "markdown" },
      report: { enabled: false }
    },
    tools: [
      { name: "web search", command: "tools.select", risk: "medium" }
    ],
    guardrails: [
      { name: "no hidden prompt claims", scope: "input" },
      { name: "redact report previews", scope: "report" }
    ],
    output: {
      parse: "json",
      onParseError: "error",
      sample: { verdict: "ok" }
    },
    metadata: {
      fixture: "runner_full_agent_config",
      stability: "deterministic"
    }
  })
);

await writeGeneratedFixture(
  "runner-input-items-and-files-plan.json",
  "sequencePlan",
  "runner_input_items_and_files",
  await backendResult("runner.plan", {
    agent: {
      name: "file-agent",
      instructions: "Use the attached file context.",
      instructionsMode: "visible_prefix",
      defaults: { wait: false, read: { format: "markdown" } }
    },
    input: {
      input: [
        { type: "visible_instruction", text: "Use concise bullets." },
        { type: "input_text", text: "Review the implementation handoff." },
        { type: "input_file", path: "/tmp/contract-fixtures/handoff.md", description: "SDK parity handoff." }
      ],
      attachments: [
        { path: "/tmp/contract-fixtures/context.json", description: "Structured context." }
      ],
      mode: { model: "auto" },
      tools: [{ tool: "web_search", ifUnavailable: "skip" }],
      response: { format: "markdown" }
    }
  })
);

await writeGeneratedFixture(
  "runner-budget-blocker.json",
  "runResult",
  "runner_budget_blocker",
  runResultFixture(await backendResult(
    "runner.run",
    {
      agent: { name: "budget-agent" },
      input: "This should be blocked before browser access."
    },
    { limits: { maxPromptsPerRun: 0 } }
  ))
);

await writeGeneratedFixture(
  "run-browser-bridge-blocker.json",
  "runResult",
  "run_browser_bridge_blocker",
  runResultFixture(await backendResult("runner.run", {
    agent: { name: "reviewer" },
    input: "Reply with hi."
  }))
);

await writeGeneratedFixture(
  "output-json-parse-success.json",
  "runResult",
  "output_json_parse_success",
  runResultFixture(await backendResult(
    "runner.run",
    {
      agent: {
        name: "json-agent",
        defaults: { wait: { stableMs: 0, pollMs: 0, timeoutMs: 100 }, read: { format: "markdown" } },
        output: { parse: "json", onParseError: "error" }
      },
      input: "Return a JSON verdict."
    },
    { browser: fakeBrowser({ assistantText: "{\"verdict\":\"ok\",\"score\":1}" }) }
  ))
);

await writeGeneratedFixture(
  "responses-hidden-instructions-unsupported.json",
  "response",
  "responses_hidden_instructions_unsupported",
  responseFixture(await backendResult("responses.create", {
    input: "Visible request.",
    instructions: "Hidden instruction request."
  }))
);

await writeGeneratedFixture(
  "responses-unknown-field-unsupported.json",
  "response",
  "responses_unknown_field_unsupported",
  responseFixture(await backendResult("responses.create", {
    input: "Visible request.",
    unknown_control: true
  }))
);

await writeGeneratedFixture(
  "responses-unsupported-previous-response-id.json",
  "response",
  "responses_unsupported_previous_response_id",
  responseFixture(await backendResult("responses.create", {
    input: "Visible request.",
    previous_response_id: "resp_123"
  }))
);

await writeGeneratedFixture(
  "responses-unsupported-temperature.json",
  "response",
  "responses_unsupported_temperature",
  responseFixture(await backendResult("responses.create", {
    input: "Visible request.",
    temperature: 0.2
  }))
);

await writeGeneratedFixture("command-descriptors.json", "backendResponse", "command_descriptors", await backendResponse("commands"));
await writeGeneratedFixture(
  "blocker-explanation-profiles.json",
  "backendResponse",
  "blocker_explanation_profiles",
  {
    schemaVersion: "chatgpt.browser_control.backend_response.v1",
    requestId: "req_blocker_explanation_profiles",
    ok: true,
    result: {
      profiles: BLOCKER_EXPLANATION_PROFILES
    }
  }
);
await writeGeneratedFixture("describe-runner-run.json", "commandDescriptor", "describe_runner_run", await backendResult("describe", { name: "runner.run" }));
await writeGeneratedFixture("help-root.json", "backendResponse", "help_root", await backendResponse("help"));

await writeGeneratedFixture(
  "doctor-bridge-upload.json",
  "commandResult",
  "doctor_bridge_upload",
  commandResultFixture(await backendResult("doctor", { check: ["bridge", "upload"] }))
);

await writeGeneratedFixture(
  "doctor-scenario-preflight.json",
  "commandResult",
  "doctor_scenario_preflight",
  commandResultFixture(await backendResult(
    "doctor",
    {
      check: ["existing_tab", "localization", "reports", "file_preflight"],
      existingTab: {
        target: { type: "conversationId", conversationId: "abc-123" },
        ifMissing: "block"
      },
      files: ["/absolute/host/path/spec.md"],
      report: { destDir: doctorScenarioReportDir }
    },
    {
      browser: fakeExistingTabsBrowser([
        { id: "other", url: "https://chatgpt.com/c/other", title: "Other Chat" }
      ])
    }
  ))
);

await writeGeneratedFixture(
  "workflow-ask-success.json",
  "commandResult",
  "workflow_ask_success",
  commandResultFixture(await backendResult(
    "ask",
    {
      prompt: "Reply with hi.",
      wait: { stableMs: 0, pollMs: 0, timeoutMs: 100 },
      read: { format: "normalized_text" }
    },
    { browser: fakeBrowser({ assistantText: "hi" }) }
  ))
);

await writeGeneratedFixture(
  "primitive-bootstrap-blocker.json",
  "commandResult",
  "primitive_bootstrap_blocker",
  commandResultFixture(await backendResult("session.bootstrap"))
);

await writeGeneratedFixture(
  "existing-tab-diagnostics-blocker.json",
  "commandResult",
  "existing_tab_diagnostics_blocker",
  commandResultFixture(await backendResult(
    "session.bootstrap",
    {
      existingTab: {
        target: { type: "conversationId", conversationId: "abc-123" },
        ifMissing: "block"
      }
    },
    {
      browser: fakeExistingTabsBrowser([
        { id: "other", url: "https://chatgpt.com/c/other", title: "Other Chat" }
      ])
    }
  ))
);

await writeGeneratedFixture(
  "named-plan-two-turn.json",
  "sequencePlan",
  "named_plan_two_turn",
  chatgpt.plan("two-turn", { first: "First visible turn.", second: "Second visible turn." })
);

await writeGeneratedFixture(
  "report-redaction-default.json",
  "commandResult",
  "report_redaction_default",
  commandResultFixture(await backendResult("reports.redact", {
    value: {
      prompt: "private@example.com",
      file: "/example/user/secret/contract.pdf",
      token: "token_12345678901234567890123456789012"
    }
  }))
);

await writeGeneratedFixture(
  "reports-create-redacted.json",
  "commandResult",
  "reports_create_redacted",
  commandResultFixture(await backendResult("reports.create", {
    result: {
      ok: true,
      status: "ok",
      data: {
        responseText: "private@example.com /example/user/private/report.txt token_12345678901234567890123456789012"
      },
      warnings: [],
      context: { timestamp: FIXED_ISO, url: "https://chatgpt.com/c/report-fixture" }
    },
    args: {
      destDir: reportFixtureDir,
      basename: "contract-report",
      includeContent: false
    }
  }))
);

await writeGeneratedFixture(
  "reports-summarize-redacted.json",
  "commandResult",
  "reports_summarize_redacted",
  commandResultFixture(await backendResult("reports.summarize", {
    result: {
      ok: false,
      status: "blocked",
      warnings: ["contains sensitive preview"],
      blocker: {
        kind: "browser_bridge_unavailable",
        message: BROWSER_BRIDGE_UNAVAILABLE_MESSAGE,
        visibleText: "private@example.com"
      },
      context: { timestamp: FIXED_ISO }
    }
  }))
);

await writeGeneratedNdjsonFixture(
  "stream-submitted-completed.ndjson",
  "backendEvent",
  "stream_submitted_completed",
  await backendStream(
    "runner.stream",
    {
      agent: {
        name: "stream-agent",
        defaults: { wait: { stableMs: 0, pollMs: 0, timeoutMs: 100 }, read: { format: "markdown" } }
      },
      input: "Return the word done."
    },
    { browser: fakeBrowser({ assistantText: "done" }) }
  )
);

await writeGeneratedNdjsonFixture(
  "stream-blocked.ndjson",
  "backendEvent",
  "stream_blocked",
  await backendStream("runner.stream", {
    agent: { name: "reviewer" },
    input: "Reply with hi."
  })
);

writeManifest();

console.log(`Generated ${generatedFixtures.length} contract fixtures.`);

async function loadBuiltSdk() {
  const indexPath = join(root, "dist", "src", "index.js");
  const sessionPath = join(root, "dist", "src", "backend", "session.js");
  const protocolPath = join(root, "dist", "src", "backend", "protocol.js");
  if (!existsSync(indexPath) || !existsSync(sessionPath) || !existsSync(protocolPath)) {
    throw new Error("Built SDK output is missing. Run `npm run build` before generating contract fixtures.");
  }

  const [indexModule, sessionModule, protocolModule] = await Promise.all([
    import(pathToFileURL(indexPath).href),
    import(pathToFileURL(sessionPath).href),
    import(pathToFileURL(protocolPath).href)
  ]);

  return {
    createChatGPT: indexModule.createChatGPT,
    BackendSession: sessionModule.BackendSession,
    BACKEND_REQUEST_SCHEMA_VERSION: protocolModule.BACKEND_REQUEST_SCHEMA_VERSION,
    BROWSER_BRIDGE_UNAVAILABLE_MESSAGE: indexModule.BROWSER_BRIDGE_UNAVAILABLE_MESSAGE
  };
}

async function backendResponse(command, payload = {}, options = {}) {
  const session = new BackendSession({ now: () => FIXED_DATE, ...options });
  return normalizeFixtureValue(await session.dispatch(backendRequest(command, payload)));
}

async function backendResult(command, payload = {}, options = {}) {
  const response = await backendResponse(command, payload, options);
  if (response.ok !== true) {
    throw new Error(`${command} fixture generation failed: ${response.error?.message ?? "unknown backend error"}`);
  }
  return response.result;
}

async function backendStream(command, payload = {}, options = {}) {
  const session = new BackendSession({ now: () => FIXED_DATE, ...options });
  const events = [];
  for await (const event of session.stream(backendRequest(command, payload))) {
    events.push(normalizeFixtureValue(event));
  }
  return events;
}

function backendRequest(command, payload) {
  return {
    schemaVersion: BACKEND_REQUEST_SCHEMA_VERSION,
    requestId: `req_${command.replace(/[^a-z0-9]+/gi, "_")}`,
    command,
    payload
  };
}

async function writeGeneratedFixture(file, schema, caseName, value) {
  generatedFixtures.push({ file, schema, case: caseName });
  writeFileSync(join(fixturesDir, file), `${canonicalJson(value)}\n`);
}

async function writeGeneratedNdjsonFixture(file, schema, caseName, events) {
  generatedFixtures.push({ file, schema, case: caseName });
  writeFileSync(join(fixturesDir, file), `${events.map(event => JSON.stringify(normalizeFixtureValue(event))).join("\n")}\n`);
}

function runResultFixture(result) {
  return {
    schemaVersion: "chatgpt.browser_control.run_result.v1",
    result
  };
}

function responseFixture(response) {
  return {
    schemaVersion: "chatgpt.browser_control.response.v1",
    response
  };
}

function commandResultFixture(result) {
  return {
    schemaVersion: "chatgpt.browser_control.command_result.v1",
    result
  };
}

function writeManifest() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.schemas = sortObjectKeys({
    ...manifest.schemas,
    commandResult: "schemas/command-result.schema.json",
    sequencePlan: "schemas/sequence-plan.schema.json",
    agent: "schemas/agent.schema.json"
  });

  const fixturesByFile = new Map(manifest.fixtures.map(fixture => [fixture.file, fixture]));
  for (const fixture of generatedFixtures) {
    fixturesByFile.set(fixture.file, fixture);
  }
  manifest.fixtures = [...fixturesByFile.values()].sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(manifestPath, `${canonicalJson(manifest)}\n`);
}

function fakeBrowser({ assistantText }) {
  const page = fakeChatGPTPage({ assistantText });
  return {
    name: "chrome",
    tabs: {
      selected: () => page
    }
  };
}

function fakeExistingTabsBrowser(tabs) {
  return {
    name: "chrome",
    user: {
      openTabs: async () => tabs,
      claimTab: async () => {
        throw new Error("claimTab should not be called while generating a missing existing-tab fixture.");
      }
    }
  };
}

function fakeChatGPTPage({ assistantText }) {
  let currentUrl = "https://chatgpt.com/";
  let composerText = "";
  let submittedPrompt = "";

  const emptyLocator = {
    count: async () => 0,
    isVisible: async () => false,
    first: () => emptyLocator,
    last: () => emptyLocator,
    nth: () => emptyLocator
  };

  const textbox = {
    click: async () => {},
    fill: async value => {
      composerText = value;
    },
    innerText: async () => composerText,
    textContent: async () => composerText
  };

  const sendButton = {
    click: async () => {
      submittedPrompt = composerText;
    },
    count: async () => 1,
    isVisible: async () => true
  };

  const newChatButton = {
    click: async () => {
      currentUrl = "https://chatgpt.com/";
      composerText = "";
      submittedPrompt = "";
    },
    count: async () => 1,
    isVisible: async () => true
  };

  const copyButton = {
    count: async () => submittedPrompt.length > 0 ? 1 : 0,
    isVisible: async () => submittedPrompt.length > 0
  };

  return {
    url: () => currentUrl,
    title: async () => "ChatGPT",
    goto: async url => {
      currentUrl = String(url);
    },
    content: async () => renderFakeChatGPTHtml(submittedPrompt, assistantText),
    evaluate: async (fn, arg) => {
      const previousDocument = globalThis.document;
      try {
        globalThis.document = {
          body: { innerText: "New chat\nSearch chats\nThinking\nChat with ChatGPT" },
          querySelectorAll: selector => {
            if (selector === "button, [role='button']") {
              return ["New chat", "Search chats", "Thinking", "Send prompt"].map(label => ({
                getAttribute: () => undefined,
                innerText: label,
                textContent: label
              }));
            }
            const roleMatch = selector.match(/^\[data-message-author-role(?:="([^"]+)")?\]$/);
            if (roleMatch !== null) {
              const wantedRole = roleMatch[1];
              return fakeMessageNodes(submittedPrompt, assistantText)
                .filter(node => wantedRole === undefined || node.getAttribute("data-message-author-role") === wantedRole);
            }
            return [];
          }
        };
        return await fn(arg);
      } finally {
        globalThis.document = previousDocument;
      }
    },
    locator: () => emptyLocator,
    getByRole: (role, options = {}) => {
      const name = options.name;
      if (role === "textbox" && roleNameMatches(name, "Chat with ChatGPT")) return textbox;
      if (role === "button" && roleNameMatches(name, "Send prompt")) return sendButton;
      if (role === "button" && roleNameMatches(name, "New chat")) return newChatButton;
      if (role === "button" && roleNameMatches(name, "Copy response")) return copyButton;
      return emptyLocator;
    },
    waitForTimeout: async () => {},
    waitForEvent: async () => ({})
  };
}

function fakeMessageNodes(prompt, assistantText) {
  if (prompt.length === 0) return [];
  return [
    fakeMessageNode("user", prompt, 1),
    fakeMessageNode("assistant", assistantText, 2)
  ];
}

function fakeMessageNode(role, text, turn) {
  const html = escapeHtml(text);
  const turnNode = {
    outerHTML: `<div data-testid="conversation-turn-${turn}"><div data-message-author-role="${role}">${html}</div></div>`
  };
  return {
    getAttribute: name => name === "data-message-author-role" ? role : undefined,
    innerHTML: html,
    innerText: text,
    textContent: text,
    outerHTML: `<div data-message-author-role="${role}">${html}</div>`,
    closest: selector => selector === "[data-testid^='conversation-turn']" ? turnNode : null
  };
}

function renderFakeChatGPTHtml(prompt, assistantText) {
  const turns = prompt.length === 0
    ? ""
    : [
        `<div data-testid="conversation-turn-1"><div data-message-author-role="user">${escapeHtml(prompt)}</div></div>`,
        `<div data-testid="conversation-turn-2"><div data-message-author-role="assistant">${escapeHtml(assistantText)}</div><button aria-label="Copy response">Copy response</button></div>`
      ].join("");

  return [
    "<main>",
    "<button>New chat</button>",
    "<button>Search chats</button>",
    "<button>Thinking</button>",
    "<label>Chat with ChatGPT</label>",
    turns,
    "</main>"
  ].join("");
}

function roleNameMatches(name, expected) {
  if (typeof name === "string") return name === expected;
  if (name instanceof RegExp) return name.test(expected);
  return false;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function canonicalJson(value) {
  return JSON.stringify(normalizeFixtureValue(value), null, 2);
}

function normalizeFixtureValue(value) {
  if (value === null || typeof value !== "object") {
    return normalizePrimitive(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => normalizeFixtureValue(item));
  }
  return sortObjectKeys(Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, normalizeFixtureValue(child)])
  ));
}

function normalizePrimitive(value) {
  if (typeof value !== "string") return value;
  const normalized = value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, FIXED_ISO);
  if (normalized !== value) return normalizePrimitive(normalized);
  if (/^run_[a-z0-9]{8,}$/i.test(value)) return "run_fixed";
  if (/^interruption-[a-z0-9]+$/i.test(value)) return "interruption_fixed";
  if (normalized.includes("/reports/contract-fixtures/") && normalized.includes("contract-report")) {
    if (normalized.endsWith(".meta.json")) {
      return "/tmp/codex-chatgpt-control/reports/contract-fixtures/fixed-contract-report.json.meta.json";
    }
    return "/tmp/codex-chatgpt-control/reports/contract-fixtures/fixed-contract-report.json";
  }
  return normalized;
}

function sortObjectKeys(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
