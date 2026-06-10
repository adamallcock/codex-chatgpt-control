import { riskForCommand, type RiskLevel } from "../safety/risk.js";

export type CommandLayer = "workflow" | "primitive" | "diagnostic" | "report";

export type CommandDescriptor = {
  name: string;
  layer: CommandLayer;
  summary: string;
  risk: RiskLevel;
  defaultTimeoutMs?: number;
  args: Record<string, string>;
  defaults: Record<string, unknown>;
  retryPolicy: string;
  blockers: string[];
  examples: string[];
};

const descriptors: CommandDescriptor[] = [
  workflow("ask", "Ask ChatGPT in a new or selected thread, optionally with files, wait/read, downloads, and reports.", [
    `await chatgpt.ask({ prompt: "reply with the word hi", wait: true, read: true });`
  ]),
  workflow("askInThread", "Open or claim an existing thread by URL, conversation id, title, or search query, then ask and read.", [
    `await chatgpt.askInThread({ thread: { type: "search", query: "Naming macOS Utility" }, prompt: "Continue." });`,
    `await chatgpt.askInThread({ thread: { type: "url", url: "https://chatgpt.com/c/<conversation-id>" }, existingTab: true, prompt: "Continue." });`
  ]),
  workflow("askWithFiles", "Attach absolute local file paths, optionally set mode, ask, wait, and read.", [
    `await chatgpt.askWithFiles({ thread: { type: "url", url: "https://chatgpt.com/c/<conversation-id>" }, existingTab: true, mode: { effort: "Thinking" }, files: ["/absolute/host/path/brief.md"], prompt: "Summarize this.", wait: true, read: { format: "markdown" } });`
  ]),
  workflow("askAndDownload", "Ask ChatGPT to produce a visible downloadable output and save the latest exposed file.", [
    `await chatgpt.askAndDownload({ prompt: "Create a CSV.", download: { destDir: "/absolute/host/output" }, wait: true });`
  ]),
  workflow("runMessages", "Run sequential prompts where later prompts can use earlier step data.", [
    `await chatgpt.runMessages({ messages: [{ id: "first", prompt: "alpha" }, { id: "second", prompt: "beta" }] });`
  ]),
  workflow("runner.run", "Agents-style facade: run a visible ChatGPT browser-control agent against input, files, thread, existing-tab, mode, and response options.", [
    `const agent = chatgpt.agent({ name: "reviewer", instructions: "Review deeply." }); await chatgpt.runner.run(agent, { input: "Review this.", thread: { type: "new" } });`,
    `await chatgpt.runner.run(agent, { input: "Continue.", thread: { type: "url", url: "https://chatgpt.com/c/<conversation-id>" }, existingTab: true });`
  ]),
  workflow("responses.create", "Narrow Responses-shaped adapter over the visible ChatGPT browser-control runner; rejects unsupported API-only fields before prompt submission.", [
    `await chatgpt.responses.create({ input: "Summarize.", thread: { type: "current" }, text: { format: "markdown" }, stream: false });`
  ]),
  workflow("copyLatest", "Copy or DOM-read the latest assistant response with Markdown-first fidelity.", [
    `await chatgpt.copyLatest({ prefer: "clipboard" });`
  ]),
  workflow("runPlan", "Execute an inline SequencePlan or named macro through the existing sequence engine.", [
    `await chatgpt.runPlan({ name: "new-ask-read", input: { prompt: "hi" } });`
  ]),
  workflow("new-ask-read", "Named macro: open a new thread, ask, wait, and read Markdown.", [
    `await chatgpt.runPlan({ name: "new-ask-read", input: { prompt: "hi" } });`
  ]),
  workflow("find-open-ask-read", "Named macro: search history, open the first match, ask, wait, and read Markdown.", [
    `await chatgpt.runPlan({ name: "find-open-ask-read", input: { query: "SDK Design Proposal", prompt: "Continue." } });`
  ]),
  workflow("find-open-copy-latest", "Named macro: search history, open the first match, and copy/read the latest response.", [
    `await chatgpt.runPlan({ name: "find-open-copy-latest", input: { query: "SDK Design Proposal" } });`
  ]),
  workflow("attach-ask-read", "Named macro: open a new thread, attach files, ask, wait, and read Markdown.", [
    `await chatgpt.runPlan({ name: "attach-ask-read", input: { files: ["/absolute/host/path.md"], prompt: "Summarize." } });`
  ]),
  workflow("ask-and-download", "Named macro: ask in a new thread and download the latest file affordance.", [
    `await chatgpt.runPlan({ name: "ask-and-download", input: { prompt: "Create a CSV.", destDir: "/absolute/host/output" } });`
  ]),
  workflow("two-turn", "Named macro: run two sequential prompts in a new thread.", [
    `await chatgpt.runPlan({ name: "two-turn", input: { first: "alpha", second: "beta" } });`
  ]),
  diagnostic("doctor-upload", "Named macro: preflight bridge, login, and upload permission remediation.", [
    `await chatgpt.runPlan({ name: "doctor-upload" });`
  ]),
  report("redacted-run-report", "Named macro: create a redacted report for a supplied CommandResult.", [
    `await chatgpt.runPlan({ name: "redacted-run-report", input: { result } });`
  ]),
  diagnostic("doctor", "Preflight browser bridge, login, upload, existing-tab, artifact, localization, report, and selector readiness.", [
    `await chatgpt.doctor({ check: ["bridge", "login", "upload"] });`,
    `await chatgpt.doctor({ check: ["existing_tab"], existingTab: { target: { type: "conversationId", conversationId: "<conversation-id>" }, ifMissing: "block" } });`,
    `await chatgpt.doctor({ check: ["localization", "reports"], report: { destDir: "/absolute/host/reports" } });`
  ]),
  report("createReport", "Write a durable redacted run report for a command result.", [
    `await chatgpt.createReport(result, { destDir: "/absolute/host/reports" });`
  ]),
  primitive("session.bootstrap", "Attach to ChatGPT in Chrome and detect login/blocker state.", 30000),
  primitive("threads.new", "Open a new ChatGPT thread.", 30000),
  primitive("threads.search", "Search visible ChatGPT history by query.", 30000),
  primitive("threads.open", "Open a thread by URL, conversation id, title, or search result.", 30000),
  primitive("messages.compose", "Fill the composer without submitting.", 30000),
  primitive("messages.submit", "Submit the current composer contents.", 30000),
  primitive("messages.ask", "Compose, submit, optionally wait, and optionally read.", 120000),
  primitive("messages.wait", "Wait for the latest assistant response to stabilize.", 120000),
  primitive("messages.readLatest", "Read the latest message as Markdown, normalized text, blocks, or HTML.", 30000),
  primitive("messages.waitAndRead", "Wait for completion and read the latest message.", 120000),
  primitive("artifacts.listLatest", "Detect the latest visible generated ChatGPT artifact, such as an image-only result.", 30000),
  primitive("artifacts.wait", "Wait for a visible generated ChatGPT artifact to appear and stabilize.", 120000),
  primitive("artifacts.downloadLatest", "Download or save the latest visible generated ChatGPT artifact.", 120000),
  primitive("files.attach", "Attach absolute local file paths through visible ChatGPT upload controls.", 180000),
  primitive("files.downloadLatest", "Download the latest visible ChatGPT file affordance.", 120000),
  primitive("response.copy", "Click Copy response and return clipboard Markdown, with DOM fallback.", 5000),
  primitive("modes.set", "Select a visible model or effort candidate when unambiguous.", 30000),
  primitive("tools.select", "Select a visible ChatGPT tool when unambiguous.", 30000)
];

export function commandDescriptors(): CommandDescriptor[] {
  return descriptors.map(cloneDescriptor);
}

export function describeCommand(name: string): CommandDescriptor | undefined {
  const descriptor = descriptors.find(item => item.name === name);
  if (descriptor === undefined) return undefined;
  return cloneDescriptor(descriptor);
}

export function helpText(topic?: string): string {
  if (topic !== undefined) {
    const descriptor = describeCommand(topic);
    if (descriptor === undefined) return `No ChatGPT browser-control command is registered as "${topic}".`;
    return [
      `${descriptor.name} (${descriptor.layer}, ${descriptor.risk} risk)`,
      descriptor.summary,
      descriptor.defaultTimeoutMs === undefined ? undefined : `Default timeout: ${descriptor.defaultTimeoutMs} ms`,
      Object.keys(descriptor.args).length === 0 ? undefined : `Args: ${Object.entries(descriptor.args).map(([name, description]) => `${name} (${description})`).join(", ")}`,
      Object.keys(descriptor.defaults).length === 0 ? undefined : `Defaults: ${JSON.stringify(descriptor.defaults)}`,
      `Retry policy: ${descriptor.retryPolicy}`,
      descriptor.blockers.length === 0 ? undefined : `Blockers: ${descriptor.blockers.join(", ")}`,
      descriptor.examples.length === 0 ? undefined : `Example: ${descriptor.examples[0]}`
    ].filter((line): line is string => line !== undefined).join("\n");
  }

  const grouped = groupByLayer(descriptors);
  return [
    "ChatGPT browser-control SDK commands",
    "",
    ...(["workflow", "diagnostic", "report", "primitive"] as CommandLayer[])
      .flatMap(layer => [
        `${layer}:`,
        ...(grouped[layer] ?? []).map(descriptor => `- ${descriptor.name}: ${descriptor.summary}`)
      ])
  ].join("\n");
}

function workflow(name: string, summary: string, examples: string[]): CommandDescriptor {
  return {
    name,
    layer: "workflow",
    summary,
    risk: "medium",
    defaultTimeoutMs: 120000,
    args: workflowArgs(name),
    defaults: workflowDefaults(name),
    retryPolicy: "Return structured CommandResult failures; do not resubmit prompts unless the sequence policy permits unmatched-turn recovery.",
    blockers: commonBlockers(),
    examples
  };
}

function diagnostic(name: string, summary: string, examples: string[]): CommandDescriptor {
  return {
    name,
    layer: "diagnostic",
    summary,
    risk: "low",
    defaultTimeoutMs: 30000,
    args: diagnosticArgs(name),
    defaults: {},
    retryPolicy: "Return structured readiness checks; retry only after the reported blocker or permission setting changes.",
    blockers: ["browser_bridge_unavailable", "login_required", "selector_drift"],
    examples
  };
}

function report(name: string, summary: string, examples: string[]): CommandDescriptor {
  return {
    name,
    layer: "report",
    summary,
    risk: "low",
    defaultTimeoutMs: 5000,
    args: reportArgs(name),
    defaults: { includeContent: false, maxPreviewChars: 240 },
    retryPolicy: "Do not retry blindly; preserve redaction defaults and report filesystem errors as CommandResult failures.",
    blockers: ["permission"],
    examples
  };
}

function primitive(name: string, summary: string, defaultTimeoutMs: number): CommandDescriptor {
  return {
    name,
    layer: "primitive",
    summary,
    risk: riskForCommand(name),
    defaultTimeoutMs,
    args: primitiveArgs(name),
    defaults: {},
    retryPolicy: "Return structured CommandResult failures; retry only when the blocker is recoverable and no duplicate prompt will be submitted.",
    blockers: primitiveBlockers(name),
    examples: primitiveExamples(name)
  };
}

function workflowArgs(name: string): Record<string, string> {
  if (name === "find-open-copy-latest") return { query: "history search query" };
  if (name === "find-open-ask-read") return { query: "history search query", prompt: "message to send" };
  if (name === "attach-ask-read") return { files: "absolute local file paths", prompt: "message to send" };
  if (name === "ask-and-download") return { prompt: "message to send", destDir: "download destination directory" };
  if (name === "two-turn") return { first: "first message", second: "second message" };
  if (name === "new-ask-read") return { prompt: "message to send" };
  if (name === "askWithFiles") {
    return {
      files: "absolute local file paths to attach before submitting",
      prompt: "message to send after files are attached",
      thread: "optional thread selector",
      existingTab: "true or explicit policy to claim a user-open Chrome tab instead of opening a replacement",
      mode: "optional visible mode selection, e.g. { effort: \"Thinking\" }",
      wait: "true or wait options; defaults to true",
      read: "true or read options such as { format: \"markdown\" }; defaults to Markdown",
      report: "optional redacted report settings"
    };
  }
  return {
    prompt: "message to send or workflow-specific input",
    thread: "optional thread selector",
    existingTab: "true or explicit policy to claim a user-open Chrome tab instead of opening a replacement",
    report: "optional redacted report settings"
  };
}

function workflowDefaults(name: string): Record<string, unknown> {
  if (name === "copyLatest" || name === "find-open-copy-latest") return { prefer: "clipboard", format: "markdown" };
  if (name === "runPlan") return {};
  return { wait: true, read: { format: "markdown" } };
}

function diagnosticArgs(name: string): Record<string, string> {
  if (name === "doctor-upload") return {};
  return {
    check: "optional list of readiness checks",
    existingTab: "optional exact existing-tab policy for check: [\"existing_tab\"]",
    files: "optional file paths for the Stage 2 file_preflight scaffold",
    report: "optional report output policy for check: [\"reports\"]"
  };
}

function reportArgs(name: string): Record<string, string> {
  if (name === "redacted-run-report") return { result: "CommandResult to persist" };
  return { result: "CommandResult to persist", destDir: "optional report directory" };
}

function primitiveArgs(name: string): Record<string, string> {
  if (name === "messages.readLatest") return { role: "assistant or user", format: "markdown, normalized_text, visible_text, html, blocks, or all" };
  if (name === "artifacts.listLatest") return { kind: "artifact kind; currently image", max: "maximum artifacts to return" };
  if (name === "artifacts.wait") return { kind: "artifact kind; currently image", afterArtifactCount: "baseline artifact count", requireDownload: "wait until a download affordance is visible" };
  if (name === "artifacts.downloadLatest") return { destDir: "download destination directory", prefer: "download_control or visible_image_source" };
  if (name === "response.copy") return { prefer: "clipboard or dom", format: "markdown, normalized_text, visible_text, html, blocks, or all" };
  if (name.startsWith("threads.search")) return { query: "history search query" };
  if (name.startsWith("files.attach")) return { paths: "absolute local file paths" };
  if (name === "modes.set") {
    return {
      effort: "visible effort label such as Thinking or Extended",
      model: "visible model label such as Instant, Pro, or another available model",
      timeoutMs: "optional timeout for opening and selecting the visible mode menu"
    };
  }
  return {};
}

function primitiveExamples(name: string): string[] {
  if (name === "modes.set") {
    return [
      `await chatgpt.modes.set({ effort: "Thinking" });`,
      `await chatgpt.askWithFiles({ mode: { effort: "Thinking" }, files: ["/absolute/host/path.jpg"], prompt: "Describe this image.", wait: true });`
    ];
  }
  if (name === "files.attach") {
    return [
      `await chatgpt.files.attach({ paths: ["/absolute/host/path.jpg"] });`,
      String.raw`// On Windows backend hosts, use paths such as C:\Users\you\Pictures\image.jpg.`
    ];
  }
  if (name.startsWith("artifacts.")) {
    return [`await chatgpt.artifacts.downloadLatest({ destDir: "/absolute/host/output" });`];
  }
  return [];
}

function primitiveBlockers(name: string): string[] {
  if (name.startsWith("files.attach")) return ["browser_bridge_unavailable", "login_required", "permission", "upload_failed"];
  if (name.startsWith("files.download")) return ["browser_bridge_unavailable", "login_required", "download_unavailable"];
  if (name.startsWith("artifacts.")) return ["browser_bridge_unavailable", "login_required", "artifact_unavailable", "artifact_selector_drift", "artifact_download_unavailable"];
  if (name.startsWith("modes.") || name.startsWith("tools.")) return ["browser_bridge_unavailable", "login_required", "selector_drift"];
  return commonBlockers();
}

function commonBlockers(): string[] {
  return ["browser_bridge_unavailable", "login_required", "captcha", "rate_limit", "selector_drift"];
}

function groupByLayer(items: CommandDescriptor[]): Record<CommandLayer, CommandDescriptor[]> {
  return items.reduce<Record<CommandLayer, CommandDescriptor[]>>((grouped, item) => {
    grouped[item.layer].push(item);
    return grouped;
  }, { workflow: [], primitive: [], diagnostic: [], report: [] });
}

function cloneDescriptor(descriptor: CommandDescriptor): CommandDescriptor {
  return {
    ...descriptor,
    args: { ...descriptor.args },
    defaults: { ...descriptor.defaults },
    blockers: [...descriptor.blockers],
    examples: [...descriptor.examples]
  };
}
