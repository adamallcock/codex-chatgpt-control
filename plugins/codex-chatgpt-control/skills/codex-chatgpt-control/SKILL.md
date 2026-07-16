---
name: codex-chatgpt-control
description: Use when Codex agents need to operate visible ChatGPT Chat or Work through the codex-chatgpt-control plugin, including verified configuration, prompts, tasks, progress, steering, files, artifacts, reports, blockers, live smokes, or SDK source work.
---

# ChatGPT Surface Control

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
9. Route local repository editing, terminal execution, testing, and deployment to official Codex capabilities. This plugin controls visible ChatGPT Chat and Work; it does not replace Codex.

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
  experience: "chat",
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

## Chat And Work Surfaces

Detect the visible surface and inspect its actual capability graph:

```js
const surface = await chatgpt.experience.detect();
const configuration = await chatgpt.configuration.inspect({
  experience: surface.data?.experience === "unknown"
    ? undefined
    : surface.data?.experience
});
```

Open a surface explicitly and apply only verified visible controls:

```js
await chatgpt.experience.open({ experience: "work" });
await chatgpt.configuration.apply({
  experience: "work",
  desired: {
    model: "GPT-5.6 Sol",
    effort: "High",
    speed: "Standard"
  },
  strict: true
});
```

Selector profiles describe observed UI shapes (`chat_legacy_v1`, `chat_simplified_v1`, `work_basic_v1`, and `work_advanced_v1`). They are not plan or entitlement labels. Treat unavailable controls and rollout differences as structured results instead of guessing.

Start Work exactly once, then poll or steer the same task:

```js
const started = await chatgpt.work.start({
  prompt: "Produce a decision-ready implementation brief.",
  newTask: true,
  wait: false,
  read: false
});

const status = await chatgpt.work.status({ includeArtifacts: true });
await chatgpt.work.steer({
  prompt: "Add a prioritized migration sequence.",
  wait: false,
  read: false
});
const latest = await chatgpt.work.readLatest({ format: "markdown" });
```

`newTask` defaults to true. When an existing Work task is loaded and no unique new-task control can be verified, the SDK blocks instead of appending accidentally. Never resubmit a task after a partial or timeout result; use `work.status`, `work.wait`, or `work.readLatest`.

Use `chatgpt-delegate` for the focused surface-neutral delegation workflow. `chatgpt-pro-consult`, `mode`, and `modes.set/get` remain compatibility aliases for existing callers; new work should use `experience` and `configuration`.

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

For long Chat, Work, Thinking, Deep Research, or file-backed answers, poll with `chatgpt.messages.wait({ responseContent: "metadata", ... })` or `chatgpt.work.wait(...)` so repeated partial polls return status metadata instead of re-emitting the growing answer body. Call the matching `readLatest({ format: "markdown" })` once completion is confirmed.

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
