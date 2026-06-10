---
name: codex-chatgpt-control
description: Use when Codex agents need to operate visible ChatGPT web sessions through the codex-chatgpt-control SDK, including prompts, threads, files, downloads, reports, browser bridge blockers, and local source smokes.
---

# codex-chatgpt-control

Use this skill when a user asks Codex to operate ChatGPT web through a visible browser session, or when a task involves the `codex-chatgpt-control` SDK.

This skill is for visible, user-directed ChatGPT workflows only. It is not an OpenAI API wrapper, does not call hidden ChatGPT endpoints, and must not bypass login, captcha, product permissions, file permissions, or user confirmation.

## Required Posture

1. Prefer the SDK facade from `createChatGPT({ agent })`.
2. Use ChatGPT web through a compatible Codex/browser bridge. Do not use private ChatGPT network calls.
3. Treat `globalThis.agent` as host-provided. If it is missing, report a bridge blocker rather than inventing browser state.
4. Stop on login, captcha, rate-limit, selector-drift, upload/download permission, or ambiguous confirmation blockers.
5. Ask for explicit user confirmation before public, destructive, third-party, paid, account-level, or externally visible actions.
6. Redact run reports by default. Raw prompt/response content is opt-in only.
7. Attach only files the user approved.

## Runtime Requirements

Deterministic local checks need:

- Node.js 20 or newer
- npm
- a source checkout of `codex-chatgpt-control`

Real browser-control runs also need:

- Chrome with a signed-in visible ChatGPT web session
- a compatible Codex/browser bridge exposing `globalThis.agent`
- permission to use or open a visible ChatGPT tab

Ordinary shells should not have `globalThis.agent`. A `browser_bridge_unavailable` blocker from an ordinary shell is an expected safe result for browser-required calls.

## File Upload Permissions

File attachment workflows need two separate permission gates:

1. Chrome extension gate: open `chrome://extensions`, choose the Codex/browser bridge extension, open **Details**, and enable **Allow access to file URLs**.
2. Codex app gate: in Codex settings, allow Google Chrome uploads under **Computer Use > Google Chrome > Permissions > Uploads**. Use the narrowest setting that fits the workflow; unattended smoke tests may need the always-allow setting.

If either gate is missing, stop with a permission blocker and tell the user which gate to check.

## Host-Local Attachment Paths

Attachment paths must be absolute on the machine running the Node backend. Use the path form for that host operating system. On Linux/WSL backends, use paths such as `/home/you/file.pdf` or `/mnt/c/work/file.pdf`. On Windows backends, use fully qualified paths such as `C:\Users\you\file.pdf`. If a Windows-looking path is rejected on macOS/Linux, do not retry with the same string. Convert it to the backend host's real path, for example `/home/you/file.pdf` for a Linux/WSL backend.

## Source Setup

From a source checkout:

```bash
cd packages/node
npm ci
npm test
npm run build
npm run bundle
npm run bundle:backend
```

Then use the built bundle from a bridge-enabled host runtime:

```ts
import { createChatGPT } from "/absolute/path/to/codex-chatgpt-control/packages/node/dist/codex-chatgpt-control.bundle.mjs";

const chatgpt = createChatGPT({ agent: globalThis.agent });
```

Prefer normal package imports in projects that depend on the published npm package:

```ts
import { createChatGPT } from "codex-chatgpt-control";
```

## Basic Runner Flow

```ts
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

```ts
await chatgpt.ask({
  prompt: "Reply with the word hi.",
  wait: true,
  read: { format: "markdown" }
});
```

Continue an existing thread:

```ts
await chatgpt.askInThread({
  thread: { type: "url", url: "https://chatgpt.com/c/<conversation-id>" },
  existingTab: true,
  prompt: "Continue from the latest answer.",
  wait: true,
  read: { format: "markdown" }
});
```

When the user says the ChatGPT thread is already open, pass `existingTab: true` or an exact existing-tab policy such as `existingTab: { url: "https://chatgpt.com/c/<conversation-id>" }`. A `thread: { type: "url" }` selector by itself means "navigate to this URL"; it does not express "claim the user-open tab".

Attach approved files:

```ts
await chatgpt.askWithFiles({
  thread: { type: "new" },
  files: ["/absolute/host/path/to/approved-file.pdf"],
  prompt: "Summarize this file.",
  wait: true,
  read: { format: "markdown" },
  report: { enabled: true, includeContent: false }
});
```

Run a diagnostic before long workflows:

```ts
const diagnostic = await chatgpt.doctor({
  check: ["bridge", "login", "upload", "download", "clipboard"]
});
```

Use opt-in scenario checks before targeted workflows:

```ts
await chatgpt.doctor({
  check: ["existing_tab"],
  existingTab: {
    target: { type: "conversationId", conversationId: "<conversation-id>" },
    ifMissing: "block"
  }
});

await chatgpt.doctor({
  check: ["localization", "reports"],
  report: { destDir: "/absolute/host/reports" }
});
```

`localization` verifies locale-registry readiness without changing the account language; it is not yet proof that every localized selector path is wired.

## Response Capture

Use Markdown by default for human-readable answers and saved artifacts:

```ts
const latest = await chatgpt.messages.waitAndRead({
  role: "assistant",
  format: "markdown"
});
```

Use `format: "normalized_text"` only for compact assertions, polling checks, or simple exact-string smoke tests.

## Python Client

The Python package is a protocol client over the Node backend. Build the backend first:

```bash
cd packages/node
npm run bundle:backend
```

Then run Python from `packages/python`:

```bash
python -m pip install -e .[dev]
python scripts/live_smoke.py --mode ordinary-shell
```

Point Python at an explicit backend command:

```python
from codex_chatgpt_control import Agent, BackendClient, Runner, StdioBackendTransport

backend = BackendClient(StdioBackendTransport(
    command=["node", "../node/dist/codex-chatgpt-control-backend.mjs"]
))
runner = Runner(backend)
```

## Blocker Handling

When a run fails, report the structured blocker. Do not retry blindly.

Common blockers:

- `browser_bridge_unavailable`: no bridge-enabled host runtime is available.
- `login_required`: the visible ChatGPT session is not signed in.
- `captcha`: user action is required.
- `permission`: upload/download/clipboard permission is missing.
- `selector_drift`: ChatGPT UI changed and selectors need review.
- `rate_limit`: wait or ask the user how to proceed.

## Validation

For source changes, run:

```bash
cd packages/node
npm test
npm run build
npm run bundle
npm run bundle:backend
npm run contract:validate
npm run parity:fixtures
```

For Python parity changes, also run:

```bash
cd packages/python
python -m unittest discover -s tests
python -m compileall -q src examples
python scripts/live_smoke.py --mode ordinary-shell
```
