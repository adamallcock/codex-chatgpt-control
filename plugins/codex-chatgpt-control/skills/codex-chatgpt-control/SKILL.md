---
name: codex-chatgpt-control
description: Use when Codex agents need to operate visible ChatGPT web sessions through the codex-chatgpt-control plugin, including prompts, existing threads, files, downloads, reports, browser bridge blockers, live smokes, or SDK source work.
---

# Codex ChatGPT Control

Use this skill when a user asks Codex to work with ChatGPT web through a visible browser session, or when a task involves the `codex-chatgpt-control` SDK/plugin.

This skill is for visible, user-directed ChatGPT workflows only. It is not an OpenAI API wrapper, does not call hidden ChatGPT endpoints, and must not bypass login, captcha, product permissions, file permissions, or user confirmation.

## Required Posture

1. Prefer the plugin-bundled SDK facade from `createChatGPT({ agent })`.
2. Use ChatGPT web through a compatible Codex/browser bridge. Do not use private ChatGPT network calls.
3. Treat `globalThis.agent` as host-provided. If it is missing, bootstrap the Chrome plugin runtime when available; otherwise report a bridge blocker.
4. Stop on login, captcha, rate-limit, selector-drift, upload/download permission, or ambiguous confirmation blockers.
5. Ask for explicit user confirmation before public, destructive, third-party, paid, account-level, or externally visible actions.
6. Redact run reports by default. Raw prompt/response content is opt-in only.
7. Attach only files the user approved.
8. Load reference files only for the issue at hand; do not read every reference by default.

## Plugin Runtime

Resolve relative paths from this `SKILL.md` directory. The plugin runtime lives at:

```text
../../runtime/import-chatgpt-control.mjs
```

From a bridge-enabled Codex Node runtime:

```js
const loaderUrl = new URL(
  "../../runtime/import-chatgpt-control.mjs",
  "file:///absolute/path/to/plugins/codex-chatgpt-control/skills/codex-chatgpt-control/SKILL.md"
);
const { importChatGPTControl } = await import(`${loaderUrl.href}?t=${Date.now()}`);
const { createChatGPT } = await importChatGPTControl();

const chatgpt = createChatGPT({
  agent: globalThis.agent,
  reporting: { enabled: true, includeContent: false }
});
```

When using this installed plugin, do not import from an older manually installed skill runtime. Use the plugin-bundled runtime so the installed plugin and SDK stay in sync.

## Bridge Bootstrap

Ordinary shells should not have `globalThis.agent`. A `browser_bridge_unavailable` blocker from an ordinary shell is an expected safe result for browser-required calls.

For a true live Chrome bridge run from Codex, initialize the Chrome plugin runtime before using the SDK if `globalThis.agent` is missing. See `references/bridge-bootstrap.md` when bootstrap details are needed.

Do not diagnose user-open Chrome tab availability with `browser.tabs.list()` or `browser.tabs.selected()` alone. When the user says a ChatGPT thread is already open, use `existingTab: true`, an exact `existingTab` policy, or the SDK's existing-tab helpers.

## Basic Runner Flow

```js
const reviewer = chatgpt.agent({
  name: "reviewer",
  instructions: "Review carefully and return Markdown."
});

const result = await chatgpt.runner.run(reviewer, {
  input: "Review this design.",
  thread: { type: "new" },
  response: { format: "markdown" }
});

if (!result.ok) {
  console.log(JSON.stringify(result.interruptions ?? result, null, 2));
} else {
  console.log(result.output_text);
}
```

Instructions are visible prompt text by default. Use `instructionsMode` intentionally:

- `visible_prefix`: include instructions in the submitted user message.
- `visible_setup_message`: submit instructions as a separate visible setup turn.
- `metadata_only`: keep instructions local; they are not sent to ChatGPT.

## Common Workflows

Ask in a new or selected thread:

```js
await chatgpt.ask({
  prompt: "Reply with the word hi.",
  wait: true,
  read: { format: "markdown" }
});
```

Continue an existing thread:

```js
await chatgpt.askInThread({
  thread: { type: "url", url: "https://chatgpt.com/c/<conversation-id>" },
  existingTab: true,
  prompt: "Continue from the latest answer.",
  wait: true,
  read: { format: "markdown" }
});
```

Attach approved files:

```js
await chatgpt.askWithFiles({
  thread: { type: "new" },
  files: ["/absolute/path/to/approved-file.pdf"],
  prompt: "Summarize this file.",
  wait: true,
  read: { format: "markdown" },
  report: { enabled: true, includeContent: false }
});
```

Run a diagnostic before long workflows:

```js
const diagnostic = await chatgpt.doctor({
  check: ["bridge", "login", "upload", "download", "clipboard"]
});
```

## Response Capture

Use Markdown by default for human-readable answers and saved artifacts:

```js
const latest = await chatgpt.messages.waitAndRead({
  role: "assistant",
  format: "markdown"
});
```

Use `format: "normalized_text"` only for compact assertions, polling checks, or simple exact-string smoke tests.

See `references/response-capture.md` for fidelity warnings and report handling.

## File Upload Permissions

File attachment workflows need two separate permission gates:

1. Chrome extension gate: open `chrome://extensions`, choose the Codex/browser bridge extension, open Details, and enable `Allow access to file URLs`.
2. Codex app gate: in Codex settings, allow Google Chrome uploads under `Computer Use > Google Chrome > Permissions > Uploads`.

If either gate is missing, stop with a permission blocker and tell the user which gate to check. See `references/file-uploads.md`.

## Blocker Handling

When a run fails, report the structured blocker. Do not retry blindly.

Common blockers:

- `browser_bridge_unavailable`: no bridge-enabled host runtime is available.
- `login_required`: the visible ChatGPT session is not signed in.
- `captcha`: user action is required.
- `permission`: upload/download/clipboard permission is missing.
- `selector_drift`: ChatGPT UI changed and selectors need review.
- `rate_limit`: wait or ask the user how to proceed.
- `needs_confirmation`: the workflow requires explicit user confirmation.

See `references/troubleshooting.md` before diagnosing selector, tab-claim, upload, or bridge issues.

## Validation

For source changes, run the smallest meaningful gate first. For shared SDK/protocol/plugin changes, broaden to:

```bash
cd packages/node
npm run build
npm run bundle
npm run bundle:backend
npm run bundle:live-smoke
npm run contract:validate
npm run parity:fixtures
npm run test:backend-conformance
npm test
```

Plugin packaging gates:

```bash
node tools/public-export/root/scripts/build-plugin-runtime.mjs --root .
node tools/public-export/root/scripts/check-plugin-runtime.mjs --root .
node tools/public-export/root/scripts/validate-plugin-layout.mjs --root .
python3 /path/to/plugin-creator/scripts/validate_plugin.py plugins/codex-chatgpt-control
```

Use public-export validation before claiming the public plugin package is release-ready.
