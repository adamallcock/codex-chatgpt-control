import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const FIXED_ISO = "2026-06-06T00:00:00.000Z";
const FIXED_DATE = new Date(FIXED_ISO);

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const contractRoot = join(root, "contracts", "v1");
const fixturesDir = join(contractRoot, "fixtures");
const manifestPath = join(contractRoot, "manifest.json");
const reportFixtureDir = join(root, "reports", "contract-fixtures");
const doctorScenarioReportDir = join(tmpdir(), "codex-chatgpt-control", "reports", "contract-fixtures", "missing-doctor-reports");
const filePreflightFixtureDir = join(tmpdir(), "codex-chatgpt-control", "file-preflight-contract-fixtures");

const {
  createChatGPT,
  OperationJournal,
  OperationJournalError,
  BackendSession,
  BACKEND_REQUEST_SCHEMA_VERSION,
  BROWSER_BRIDGE_UNAVAILABLE_MESSAGE
} = await loadBuiltSdk();

mkdirSync(fixturesDir, { recursive: true });

const generatedFixtures = [];
const chatgpt = createChatGPT({ now: () => FIXED_DATE });
rmSync(reportFixtureDir, { recursive: true, force: true });
rmSync(doctorScenarioReportDir, { recursive: true, force: true });
rmSync(filePreflightFixtureDir, { recursive: true, force: true });
mkdirSync(filePreflightFixtureDir, { recursive: true });
const filePreflightSpecPath = join(filePreflightFixtureDir, "spec.md");
const filePreflightContextPath = join(filePreflightFixtureDir, "context.json");
writeFileSync(filePreflightSpecPath, "hello");
writeFileSync(filePreflightContextPath, "{\"ok\":true}");

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
await writeGeneratedFixture(
  "messages-stop-needs-confirmation.json",
  "backendResponse",
  "messages_stop_needs_confirmation",
  await backendResponse("messages.stop")
);
await writeGeneratedFixture(
  "messages-stop-noop.json",
  "backendResponse",
  "messages_stop_noop",
  await backendResponse("messages.stop", { confirmStop: true }, {
    page: {
      url: () => "https://chatgpt.com/c/contract-stop-noop",
      title: async () => "ChatGPT",
      content: async () => '<main><div data-message-author-role="assistant">Completed answer.</div></main>'
    }
  })
);
{
  let generating = true;
  const stopControl = {
    count: async () => 1,
    isVisible: async () => true,
    evaluate: async () => true,
    click: async () => { generating = false; }
  };
  await writeGeneratedFixture(
    "messages-stop-success.json",
    "backendResponse",
    "messages_stop_success",
    await backendResponse("messages.stop", { confirmStop: true }, {
      page: {
        url: () => "https://chatgpt.com/c/contract-stop-success",
        title: async () => "ChatGPT",
        content: async () => generating
          ? '<form><textarea></textarea><button aria-label="Stop answering"></button></form>'
          : '<main><div data-message-author-role="assistant">Partial answer retained.</div></main>',
        getByRole: () => stopControl,
        waitForTimeout: async () => undefined
      }
    })
  );
}
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
      files: [filePreflightSpecPath, filePreflightContextPath],
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
  "files-preflight-success.json",
  "commandResult",
  "files_preflight_success",
  commandResultFixture(await backendResult(
    "files.preflight",
    {
      paths: [filePreflightSpecPath, filePreflightContextPath]
    }
  ))
);

await writeGeneratedFixture(
  "project-sources-plan-add.json",
  "commandResult",
  "project_sources_plan_add",
  commandResultFixture(await backendResult(
    "projects.sources.planAdd",
    {
      projectUrl: "https://chatgpt.com/g/g-p-example/project",
      files: [filePreflightSpecPath, filePreflightContextPath],
      batchSize: 1
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
        responseText: "private@example.com /tmp/private/report.txt token_12345678901234567890123456789012"
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

// Exercise the default public facade in a capability-missing test host. The
// process descriptor is restored before generation continues; no identity is
// substituted and the journal must fail before creating state or using a tab.
{
  const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
  const fixtureClient = createChatGPT({ now: () => FIXED_DATE });
  let result;
  try {
    Object.defineProperty(globalThis, "process", { configurable: true, value: undefined });
    result = await fixtureClient.ask({
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      prompt: "Journal runtime capability fixture.",
      thread: { type: "new" },
      wait: false,
      read: false
    });
  } finally {
    if (processDescriptor === undefined) delete globalThis.process;
    else Object.defineProperty(globalThis, "process", processDescriptor);
  }
  if (result?.status !== "blocked" || result.blocker?.code !== "journal_runtime_unavailable") {
    throw new Error("Default transactional facade did not report the journal runtime capability blocker.");
  }
  await writeGeneratedFixture(
    "journal-runtime-unavailable.json",
    "commandResult",
    "journal_runtime_unavailable",
    commandResultFixture(result)
  );
}

// Exercise public high-level typed authority failures. Transport uncertainty
// and platform preflight have integration tests; fixtures lock the wire result.
for (const [code, file, caseName, status] of [
  ["journal_rpc_outcome_indeterminate", "journal-rpc-indeterminate.json", "journal_rpc_indeterminate", "partial"],
  ["journal_rpc_unsupported_platform", "journal-rpc-unsupported-platform.json", "journal_rpc_unsupported_platform", "blocked"]
]) {
  const fixtureClient = createChatGPT({
    now: () => FIXED_DATE,
    operations: { stateRoot: join(filePreflightFixtureDir, caseName) }
  });
  const original = Object.getOwnPropertyDescriptor(OperationJournal.prototype, "submitRequestDigest");
  let result;
  try {
    Object.defineProperty(OperationJournal.prototype, "submitRequestDigest", {
      configurable: true, value: async () => {
        throw new OperationJournalError(code, "Private transport details must be redacted.");
      }
    });
    result = await fixtureClient.ask({
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      prompt: "Journal authority acknowledgement fixture.", thread: { type: "new" }, wait: false, read: false
    });
  } finally {
    Object.defineProperty(OperationJournal.prototype, "submitRequestDigest", original);
  }
  if (result.status !== status || result.blocker?.code !== code
    || result.blocker.resumable !== false || result.error?.recoverable !== false) {
    throw new Error("Transactional facade did not preserve the journal authority failure result.");
  }
  await writeGeneratedFixture(file, "commandResult", caseName, commandResultFixture(result));
}

// A browser may complete a download without returning its receipt. Preserve
// the bounded no-retry outcome through the actual backend command envelope.
{
  let clicks = 0;
  const control = { count: async () => 1, last: () => control, click: async () => { clicks += 1; } };
  const result = await backendResult("artifacts.downloadLatest", {
    destDir: join(filePreflightFixtureDir, "download-receipt"), timeoutMs: 50
  }, { page: {
    url: () => "https://chatgpt.com/c/synthetic-download",
    content: async () => "<main></main>",
    locator: () => control,
    waitForEvent: () => new Promise(() => {})
  } });
  if (clicks !== 1 || result.blocker?.code !== "download_receipt_timeout"
    || result.blocker.resumable !== false || result.error?.recoverable !== false) {
    throw new Error("Download receipt fixture did not preserve the bounded no-retry result.");
  }
  await writeGeneratedFixture("download-receipt-timeout.json", "commandResult", "download_receipt_timeout", commandResultFixture(result));
}

// Preserve a browser error observed during download through the backend envelope.
// A successful click is not a successful receipt and must not start a fallback.
{
  let clicks = 0;
  const control = { count: async () => 1, last: () => control, click: async () => { clicks += 1; } };
  const result = await backendResult("artifacts.downloadLatest", {
    destDir: join(filePreflightFixtureDir, "download-browser-blocked"), timeoutMs: 100
  }, { page: {
    url: () => "https://chatgpt.com/c/synthetic-download",
    content: async () => "<main></main>",
    locator: () => control,
    evaluate: async (fn) => fn.name === "inspectBrowserDownloadError"
      ? (clicks === 0 ? "unavailable" : "blocked_by_client")
      : undefined,
    waitForEvent: () => new Promise(() => {})
  } });
  if (clicks !== 1 || result.ok !== false || result.status !== "blocked"
    || result.data !== undefined || result.blocker?.kind !== "download_unavailable"
    || result.blocker.code !== "download_blocked_by_browser"
    || result.blocker.resumable !== false || result.error?.recoverable !== false
    || result.error.name !== "DownloadBrowserBlockedError") {
    throw new Error("Browser-blocked download fixture did not preserve the no-retry result without a receipt.");
  }
  await writeGeneratedFixture("download-blocked-by-browser.json", "commandResult", "download_blocked_by_browser", commandResultFixture(result));
}

// Native transport errors may contain sensitive download details. Preserve a
// fixed terminal message and never fall back after an uncertain activation.
{
  let clicks = 0;
  let rejectReceipt;
  const control = { count: async () => 1, last: () => control, click: async () => {
    clicks += 1;
    rejectReceipt(new Error("Private transport details must be redacted."));
  } };
  const result = await backendResult("artifacts.downloadLatest", {
    destDir: join(filePreflightFixtureDir, "download-receipt-failed"), timeoutMs: 100
  }, { page: {
    url: () => "https://chatgpt.com/c/synthetic-download",
    content: async () => "<main></main>",
    locator: () => control,
    waitForEvent: () => new Promise((_resolve, reject) => { rejectReceipt = reject; })
  } });
  if (clicks !== 1 || result.ok !== false || result.status !== "blocked"
    || result.data !== undefined || result.blocker?.kind !== "download_unavailable"
    || result.blocker.code !== "download_receipt_failed"
    || result.blocker.resumable !== false || result.error?.recoverable !== false
    || result.error.name !== "DownloadReceiptFailedError"
    || JSON.stringify(result).includes("Private transport")) {
    throw new Error("Download failure fixture did not preserve the sanitized no-retry result.");
  }
  await writeGeneratedFixture("download-receipt-failed.json", "commandResult", "download_receipt_failed", commandResultFixture(result));
}

// Result envelopes are generated from the checked-in redacted examples until
// the operation backend adapters own their fixture builders. Keeping them in
// this generator still makes the manifest/fixture set deterministic and gives
// contract generation an explicit registration point for the versioned wire
// surface. These values contain handles, digests, and bounded metadata only.
for (const [file, schema, caseName] of [
  ["operation-submit-result.json", "operationSubmitResult", "operation_submit_result"],
  ["operation-collect-result.json", "operationCollectResult", "operation_collect_result"],
  ["operation-inspect-result.json", "operationInspectResult", "operation_inspect_result"],
  ["operation-control-result.json", "operationControlResult", "operation_control_result"]
]) {
  await writeGeneratedFixture(file, schema, caseName, JSON.parse(readFileSync(join(fixturesDir, file), "utf8")));
}

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
    OperationJournal: indexModule.OperationJournal,
    OperationJournalError: indexModule.OperationJournalError,
    BackendSession: sessionModule.BackendSession,
    BACKEND_REQUEST_SCHEMA_VERSION: protocolModule.BACKEND_REQUEST_SCHEMA_VERSION,
    BROWSER_BRIDGE_UNAVAILABLE_MESSAGE: indexModule.BROWSER_BRIDGE_UNAVAILABLE_MESSAGE
  };
}

async function backendResponse(command, payload = {}, options = {}) {
  const session = new BackendSession(fixtureBackendSessionOptions(options));
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
  const session = new BackendSession(fixtureBackendSessionOptions(options));
  const events = [];
  for await (const event of session.stream(backendRequest(command, payload))) {
    events.push(normalizeFixtureValue(event));
  }
  return events;
}

function fixtureBackendSessionOptions(options = {}) {
  const { backendIdentity, ...rest } = options;
  return {
    now: () => FIXED_DATE,
    ...rest,
    backendIdentity: {
      backendSessionId: "fixture-backend-session",
      packageName: "codex-chatgpt-control",
      packageVersion: "unknown",
      runtimeVersion: "fixture-runtime",
      buildDigest: "unknown",
      ...backendIdentity
    }
  };
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
  const normalizedPath = value.replaceAll("\\", "/");
  const temporaryRoot = tmpdir().replaceAll("\\", "/").replace(/\/$/, "");
  if (normalizedPath.startsWith(`${temporaryRoot}/codex-chatgpt-control/`)) {
    return `/tmp/codex-chatgpt-control/${normalizedPath.slice(`${temporaryRoot}/codex-chatgpt-control/`.length)}`;
  }
  const normalized = value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, FIXED_ISO);
  if (normalized !== value) return normalizePrimitive(normalized);
  if (/^run_[a-z0-9]{8,}$/i.test(value)) return "run_fixed";
  if (/^interruption-[a-z0-9]+$/i.test(value)) return "interruption_fixed";
  const comparablePath = normalized.replaceAll("\\", "/");
  if (comparablePath.includes("/reports/contract-fixtures/") && comparablePath.includes("contract-report")) {
    if (comparablePath.endsWith(".meta.json")) {
      return "/tmp/codex-chatgpt-control/reports/contract-fixtures/fixed-contract-report.json.meta.json";
    }
    return "/tmp/codex-chatgpt-control/reports/contract-fixtures/fixed-contract-report.json";
  }
  return normalized;
}

function sortObjectKeys(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
