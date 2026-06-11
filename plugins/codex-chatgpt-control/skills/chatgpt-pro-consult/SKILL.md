---
name: chatgpt-pro-consult
description: Use when Codex should consult ChatGPT Pro through the user's logged-in visible ChatGPT web session for a second opinion, critique, synthesis, planning review, or model-to-model comparison using the codex-chatgpt-control plugin.
---

# ChatGPT Pro Consult

Use this skill when the user wants a focused ChatGPT Pro consultation, not general ChatGPT browser automation. Typical uses: ask Pro for a critical review, compare plans, synthesize approved context, review an implementation approach, or get a second opinion through the user's ChatGPT subscription.

This skill is a thin workflow over the `codex-chatgpt-control` plugin. Use the snippets below for ordinary consults, but switch to the full `codex-chatgpt-control` skill as soon as bridge bootstrap, tab reuse, file attach, send, wait, read, or selector diagnosis becomes the main issue.

## Guardrails

- This sends prompt and attachment content to ChatGPT web. Do not send secrets, credentials, private source material, financial details, legal evidence, medical details, or sensitive personal data unless the user clearly approved that disclosure.
- Use only visible ChatGPT web through the Codex/browser bridge. Do not replicate private ChatGPT network calls, read cookies, inspect localStorage/sessionStorage, or extract hidden auth headers.
- Make Pro selection explicit with `mode: { model: "Pro" }`. If the SDK cannot select Pro, stop and report the blocker and visible candidate labels.
- Prefer a fresh thread unless the user asked to continue a specific ChatGPT thread.
- Return Markdown by default. Use redacted reports by default; raw prompt/response content is opt-in only.
- Treat ChatGPT Pro output as another model's judgment, not verified truth. Verify current, legal, medical, financial, or high-stakes claims with primary sources.
- Keep each Codex tool call bounded. Submit the prompt under Pro in one call, persist the thread metadata immediately, then poll/read in separate bounded calls. Never combine submit and read in one call.

## Timeout Layering

Three timeout layers apply to every consult; JS-level `timeoutMs` is the innermost and cannot extend the outer two:

1. Codex MCP `tools/call` cap (default 120s; `tool_timeout_sec` under `[mcp_servers.node_repl]` in `~/.codex/config.toml` raises it). When it fires, the tool call errors but the kernel usually keeps running, so variables often survive into the next call.
2. The `node_repl` `js` tool's `timeout_ms` argument (default 30000 ms). When it fires, the kernel resets and all variables are lost. Always pass an explicit `timeout_ms` on every `js` call that touches the browser, larger than any JS-level deadline.
3. SDK-level `timeoutMs` (for example `messages.waitAndRead`). Keep it at or below 75-90s so this is the layer that fires and returns a structured `timeout` or `partial` result.

Safe pattern: `timeoutMs: 75_000` in JS, `timeout_ms: 110000` on the `js` tool call.

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

## Quick Consult

Run each step as its own `node_repl` call with an explicit `timeout_ms` (110000 is a good default for browser steps).

Step 1 - preflight (after the Runtime Loader):

```js
var doctor = await chatgpt.doctor({ check: ["bridge", "login"] });
console.log(JSON.stringify({ ok: doctor.ok, status: doctor.status }, null, 2));
```

Stop on bridge or login blockers. If the previous turn left ChatGPT generating a long answer, the page may be slow; prefer plain sleeps between later read attempts over tight polling.

Step 2 - submit only, then validate mode and persist metadata in the same call:

```js
var pro = chatgpt.agent({
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

var submitted = await chatgpt.runner.run(pro, {
  input: "Review this plan and recommend improvements:\n\n...",
  thread: { type: "new" },
  mode: { model: "Pro" },
  report: { enabled: true, includeContent: false }
});

var modeStep = submitted.steps?.find(step => step.id === "mode");
var modeSelected = modeStep?.data?.selected ?? modeStep?.dataPreview?.selected ?? [];
var modeCandidates = modeStep?.data?.candidates ?? modeStep?.dataPreview?.candidates ?? [];
var PRO_LABEL = /(^|\s)pro(\s|$)/i;
var MODE_VOCAB = /^(auto|instant|medium|high|extra high|thinking( mini)?|latest|extended|standard pro|pro( extended)?|gpt[\s-].*|o\d+.*|\d+(\.\d+)?)$/i;
var proConfirmed = modeStep?.ok === true
  && modeCandidates.length > 0
  && modeCandidates.every(label => MODE_VOCAB.test(String(label).trim()))
  && modeSelected.some(label => PRO_LABEL.test(String(label)));

var consultMeta = {
  submittedOk: submitted.ok === true,
  proConfirmed,
  thread: submitted.state?.thread ?? submitted.data?.thread,
  modeSelected,
  modeCandidates,
  interruptions: submitted.interruptions ?? []
};
var fsMod = await import("node:fs");
fsMod.writeFileSync(`${nodeRepl.tmpDir}/chatgpt-consult-latest.json`, JSON.stringify(consultMeta, null, 2));
console.log(JSON.stringify(consultMeta, null, 2));
```

If `proConfirmed` is false, stop and report the blocker with `modeCandidates`. A candidates list containing thread-menu labels such as `Move to project`, `Share`, or `Rename` means mode selection hit the wrong menu; treat it as selector drift even if the step reports `ok: true`, and do not trust the run.

Step 3 - bounded read in a separate call. Repeat this call as needed; never resubmit:

```js
var read = await chatgpt.messages.waitAndRead({
  timeoutMs: 75_000,
  stableMs: 2_000,
  pollMs: 1_500,
  mode: "deep_research",
  role: "assistant",
  format: "markdown"
});
if (read.ok) {
  console.log(read.data?.responseText ?? "");
} else {
  console.log(JSON.stringify({
    status: "submitted_wait_pending",
    message: "Prompt is already submitted. Do not resubmit; run this read step again.",
    readStatus: read.status,
    partialChars: (read.data?.responseText ?? "").length
  }, null, 2));
}
```

Pro and Pro Extended answers can take many minutes. On `timeout` or `partial`, run Step 3 again; the submitted thread and the metadata file from Step 2 are the source of truth.

## With Approved Files

```js
const submitted = await chatgpt.runner.run(pro, {
  input: [
    {
      type: "input_text",
      text: "Critique these materials and return a prioritized action plan."
    },
    { type: "input_file", path: "/absolute/path/to/approved-plan.md" }
  ],
  thread: { type: "new" },
  mode: { model: "Pro" },
  report: { enabled: true, includeContent: false }
});
```

Use the same submit-then-poll pattern as Quick Consult. File-backed Pro answers can run longer than one Codex tool call.

## Continue A Known Thread

Use this only when the user gives a specific thread URL, conversation id, title, or search query:

```js
await chatgpt.runner.run(pro, {
  input: "Please continue from the latest answer and critique the updated plan.",
  thread: {
    type: "url",
    url: "https://chatgpt.com/c/..."
  },
  existingTab: true,
  mode: { model: "Pro" }
});
```

Existing-thread mode selection is higher risk than a fresh thread: a loaded conversation page has header/title menus that the mode opener can hit by mistake. Always apply the Step 2 `proConfirmed` validation; reject any mode step whose candidates are not model/mode labels.

## Recovery After Timeout

If a tool call times out or the kernel resets:

1. Check whether variables survived (`typeof submitted !== "undefined"`). If the kernel reset, reload `${nodeRepl.tmpDir}/chatgpt-consult-latest.json` for the thread URL and mode evidence.
2. Re-bootstrap the bridge if needed, then find the thread tab via `browser.user.openTabs()` by matching the `/c/<conversation-id>` URL.
3. Run one bounded `chatgpt.messages.readLatest({ role: "assistant", format: "markdown", maxChars: 4000 })`. Do not call `goto` on a tab already showing the thread, do not take full DOM snapshots of ChatGPT threads, and do not resubmit the prompt.
4. If reads still fail, report status `submitted-unread` with the thread URL, keep the tab open as a handoff, and let the user or a later session retrieve the answer. A confirmed-Pro submission with an unread answer is pending, not failed.

## Blockers

If a run fails, report the structured blocker instead of retrying blindly.

- `browser_bridge_unavailable`: bootstrap failed or the bridge remains unavailable.
- `login_required`: ask the user to log in to ChatGPT in Chrome.
- `selector_drift` during mode selection: report that Pro was not selectable and include candidates. This includes a mode step that "selected" a non-mode label (for example `Move to project`) from the wrong menu.
- repeated read timeouts after a confirmed Pro submission: report `submitted-unread` with the thread URL instead of `blocked`; do not resubmit.
- `file_permission`: tell the user to enable both Codex Chrome upload permission and Chrome extension file URL access.
- `rate_limited`, `captcha`, or account-level confirmation: stop and ask the user to resolve it manually.

See `references/consult-patterns.md` for request framing and output handling.

## Output Contract

When reporting back to the user:

- Say that the answer is from ChatGPT Pro through visible ChatGPT web.
- Summarize the most useful findings; include the full Markdown if requested.
- Include blockers, warnings, thread URL, downloaded files, or redacted report path when present.
- Do not present ChatGPT Pro claims as verified facts unless independently verified.
