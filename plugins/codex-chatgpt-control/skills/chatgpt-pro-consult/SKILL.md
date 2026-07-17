---
name: chatgpt-pro-consult
description: Backward-compatible alias for a visible Chat consultation with the Pro intelligence setting; prefer chatgpt-delegate for new Chat or Work delegation workflows.
---

# ChatGPT Pro Consult

This is a backward-compatible skill alias. Prefer `chatgpt-delegate` for new work because it chooses between Chat, Work, and official Codex based on the job and uses the strict `experience`/`configuration` APIs.

Use this alias when an existing workflow or user explicitly requests the visible Chat `Pro` intelligence setting for a focused consultation. Typical uses are critical review, synthesis, planning review, and a long-form second opinion through the user's ChatGPT subscription.

This skill is a thin workflow over the `codex-chatgpt-control` plugin. Use the snippets below for ordinary consults, but switch to the full `codex-chatgpt-control` skill as soon as bridge bootstrap, tab reuse, file attach, send, wait, read, or selector diagnosis becomes the main issue.

## Guardrails

- This sends prompt and attachment content to ChatGPT web. Do not send secrets, credentials, private source material, financial details, legal evidence, medical details, or sensitive personal data unless the user clearly approved that disclosure.
- Use only visible ChatGPT web through the Codex/browser bridge. Do not replicate private ChatGPT network calls, read cookies, inspect localStorage/sessionStorage, or extract hidden auth headers.
- Make Pro selection explicit with `experience: "chat"` and `configuration: { intelligence: "Pro" }`. The strict configuration API handles older and newer visible pickers and verifies the postcondition. If the SDK cannot verify Pro, stop and report the blocker and visible candidate labels.
- Call `experience.open({ experience: "chat" })` through the workflow even when
  Work is currently visible; do not assume the current ChatGPT pane is Chat.
- Prefer a fresh thread unless the user asked to continue a specific ChatGPT thread.
- Return Markdown by default. Use redacted reports by default; raw prompt/response content is opt-in only.
- Treat ChatGPT Pro output as another model's judgment, not verified truth. Verify current, legal, medical, financial, or high-stakes claims with primary sources.
- Keep each Codex tool call below the host call ceiling. Do not ask one JS call to wait for a long Pro response. Submit the prompt under Pro first, then poll/read in bounded chunks.

## Staged Consult Boundary

Use the submit-then-poll pattern in this skill for expensive visible-browser work:

- Pro consultations.
- File-backed consults.
- Long Thinking or Deep Research-style answers.
- Recovery after a submit, wait, or read call times out.
- Any result whose `completionState` is `generating` or whose `generationActive` flag is true.

Do not force this staged protocol into ordinary short SDK calls. For normal `chatgpt.ask(...)`, short `askInThread(...)`, quick reads, and exact-string smokes, the smoother one-call `wait: true` / `read: true` flow is still the right default. Switch to staged recovery only when the answer is likely to exceed the Codex tool-call ceiling or when a partial/timeout result proves the prompt may already be submitted.

## Runtime Loader

Resolve relative paths from this `SKILL.md` directory. The plugin runtime loader lives at:

```text
../../runtime/import-chatgpt-control.mjs
```

From a bridge-enabled Codex Node runtime:

```js
const loaderUrl = new URL(
  "../../runtime/import-chatgpt-control.mjs",
  "file:///absolute/path/to/plugins/codex-chatgpt-control/skills/chatgpt-pro-consult/SKILL.md"
);
const { importChatGPTControl } = await import(`${loaderUrl.href}?t=${Date.now()}`);
const { createChatGPT } = await importChatGPTControl();

const chatgpt = createChatGPT({
  agent: globalThis.agent,
  reporting: { enabled: true, includeContent: false }
});
```

Do not import from an older manually installed skill runtime; the plugin-bundled runtime is the intended source.

## Bridge Bootstrap Handoff

This skill assumes the Codex Chrome bridge is already available in the JS runtime. If `globalThis.agent` is missing, do not stop after reporting `hasAgent: false`; initialize the Chrome plugin runtime using the bootstrap steps from the `codex-chatgpt-control` skill, then retry the consult.

After bootstrap, verify both values before using the snippets below:

```js
JSON.stringify({
  hasAgent: !!globalThis.agent,
  hasBrowser: !!globalThis.browser
}, null, 2);
```

Only report `browser_bridge_unavailable` after the browser-control bootstrap itself fails or the bridge remains unavailable. If `messages.ask`, `messages.wait`, `messages.status`, `messages.readLatest`, `messages.waitAndRead`, mode selection, file attach, or existing-tab selection returns a partial/timeout result, preserve the raw structured result and continue under the full browser-control skill. The Pro wrapper is for consult intent; browser-control is the source of truth for low-level diagnosis.

## Quick Consult

```js
const POLL_CHUNK = {
  timeoutMs: 25_000,
  stableMs: 1_500,
  pollMs: 750,
  mode: "deep_research"
};

function isStillRunning(data) {
  return data?.completionState === "generating" || data?.generationActive === true;
}

const pro = chatgpt.agent({
  name: "chatgpt-pro-consultant",
  instructions: [
    "You are being consulted as ChatGPT Pro from a visible ChatGPT web session.",
    "Be critical, constructive, specific, and evidence-aware.",
    "Call out assumptions, risks, missing information, and concrete next steps.",
    "Return clear Markdown."
  ].join("\n"),
  defaults: {
    wait: false,
    read: false,
    report: { enabled: true, includeContent: false }
  }
});

async function readBoundedProAnswer() {
  const read = await chatgpt.messages.waitAndRead({
    ...POLL_CHUNK,
    role: "assistant",
    format: "markdown"
  });

  if (
    read.ok &&
    read.data?.complete !== false &&
    !isStillRunning(read.data)
  ) {
    return { status: "complete", read };
  }

  const progress = await chatgpt.messages.status({ maxPreviewChars: 500 });
  return {
    status: isStillRunning(progress.data) ? "pro_still_running" : "read_incomplete",
    read,
    progress
  };
}

const submitted = await chatgpt.runner.run(pro, {
  input: "Review this plan and recommend improvements:\n\n...",
  thread: { type: "new" },
  experience: "chat",
  configuration: { intelligence: "Pro" },
  report: { enabled: true, includeContent: false }
});

const configurationStep = submitted.steps?.find(step => step.id === "configuration");
if (!submitted.ok || configurationStep?.ok === false || configurationStep?.dataPreview?.verified !== true) {
  console.log(JSON.stringify({
    status: "blocked_before_submit_or_configuration_unverified",
    thread: submitted.state?.thread ?? submitted.data?.thread,
    configurationStep,
    interruptions: submitted.interruptions
  }, null, 2));
} else {
  const answer = await readBoundedProAnswer();

  if (answer.status !== "complete") {
    console.log(JSON.stringify({
      status: answer.status,
      message: "Prompt is already submitted. Do not resubmit; poll/read this same thread again.",
      thread: submitted.state?.thread ?? submitted.data?.thread,
      configurationStep,
      progress: answer.progress,
      read: answer.read
    }, null, 2));
  } else {
    console.log(answer.read.data?.responseText ?? "");
  }
}
```

Before describing the answer as a Pro-setting consultation, inspect `configurationStep`. It must succeed with `dataPreview.verified === true`. Do not infer an underlying model solely from the visible label. Do not pass `response` on the submit run; response formatting belongs on the separate bounded poll. If the poll times out, returns `partial`, or reports `pro_still_running`, do not submit the prompt again; reuse the same open thread and run another bounded `messages.status` / `messages.waitAndRead` call.

## Running Or Partial Results

Treat these as in-progress, not as final answers:

- `status: "partial"` with non-empty `output_text`.
- `data.complete === false`.
- `data.completionState === "generating"`.
- `data.generationActive === true`.

Use a compact status check when you need to know whether Pro is still working:

```js
const status = await chatgpt.messages.status({ maxPreviewChars: 500 });
console.log(JSON.stringify(status, null, 2));
```

If `completionState` is `generating` or `generationActive` is true, report that ChatGPT Pro is still running and poll the same thread again later. Only treat an answer as final when the wait/read result is complete or when status/read evidence shows generation has stopped.

If a caller prefers a direct polling loop over `messages.wait` instead of `messages.status`, pass `responseContent: "metadata"` so partial and timeout results return compact `data.responseChars` / `data.responseSha256` metadata instead of the full growing answer body; call `messages.readLatest` once completion is confirmed.

## With Files

Attach only files the user has approved sending to ChatGPT:

```js
const result = await chatgpt.runner.run(pro, {
  input: [
    {
      type: "input_text",
      text: "Critique these materials and return a prioritized action plan."
    },
    { type: "input_file", path: "/absolute/path/to/plan.md" },
    { type: "input_file", path: "/absolute/path/to/current-shape.md" }
  ],
  thread: { type: "new" },
  experience: "chat",
  configuration: { intelligence: "Pro" },
  report: { enabled: true, includeContent: false }
});
```

Use the same submit-then-poll pattern as Quick Consult. File-backed Pro answers can run longer than one Codex tool call, so keep `pro.defaults.wait` and `pro.defaults.read` disabled and recover the answer with bounded `messages.status` / `messages.waitAndRead` calls.

## Continue A Known Thread

Use this only when the user gives a specific thread URL, conversation id, title, or search query:

```js
const result = await chatgpt.runner.run(pro, {
  input: "Please continue from the latest answer and critique the updated plan.",
  thread: {
    type: "url",
    url: "https://chatgpt.com/c/..."
  },
  experience: "chat",
  configuration: { intelligence: "Pro" }
});
```

Search fallback:

```js
const result = await chatgpt.runner.run(pro, {
  input: "Read the current context in this thread and give a fresh review.",
  thread: { type: "search", query: "SDK Design Proposal", select: "first" },
  experience: "chat",
  configuration: { intelligence: "Pro" }
});
```

## Recover A Timed-Out Consult

If the submit call timed out after opening a thread, first recover from the current ChatGPT tab instead of creating a duplicate prompt:

```js
const status = await chatgpt.messages.status({ maxPreviewChars: 500 });
if (isStillRunning(status.data)) {
  console.log(JSON.stringify({
    status: "pro_still_running",
    message: "ChatGPT Pro is still generating. Do not resubmit; poll this same thread again.",
    progress: status
  }, null, 2));
} else {
  const read = await chatgpt.messages.waitAndRead({
    timeoutMs: 25_000,
    stableMs: 1_500,
    pollMs: 750,
    role: "assistant",
    format: "markdown",
    mode: "deep_research"
  });

  console.log(read.ok ? read.data?.responseText : JSON.stringify(read, null, 2));
}
```

If the browser bridge itself needs inspection after a timeout, bootstrap the Chrome runtime from the `codex-chatgpt-control` skill and use `browser.tabs.*`; the bridge does not expose top-level `browser.list` or `browser.selected`.

## Blockers

If a run fails, report the structured blocker instead of retrying blindly.

- `browser_bridge_unavailable`: the active runtime does not expose the Codex Chrome bridge after running the browser-control bootstrap. Report the bootstrap error and whether `hasAgent` and `hasBrowser` are true.
- `login_required`: ask the user to log in to ChatGPT in Chrome.
- `selector_drift` during configuration: report that the visible Pro setting was unavailable or unverified and include `candidates`.
- `file_permission`: tell the user to enable both Codex Chrome upload permission and Chrome extension file URL access before retrying file attach.
- `rate_limited`, `captcha`, or account-level confirmation: stop and ask the user to resolve it manually.

Upload permission fixes:

1. Codex Settings > Computer Use > Chrome > Permissions > Uploads.
2. Chrome `chrome://extensions` > Codex extension > Details > Allow access to file URLs.

See `references/consult-patterns.md` for request framing and output handling.

## Output Contract

When reporting back to the user:

- Say that the answer used the verified visible Chat Pro setting; do not claim a specific underlying model unless separately verified from a current authoritative source.
- Summarize the most useful findings; include the full Markdown if the user asked for the full response.
- Include any blockers, warnings, thread URL, downloaded files, or redacted report path when present.
- Do not present delegated claims as verified facts unless you independently verified them.
