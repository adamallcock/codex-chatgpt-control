# Troubleshooting

## `browser_bridge_unavailable`

The backend process does not have access to a browser bridge. This is expected when a live-smoke command runs from an ordinary shell: it proves the protocol stayed alive and surfaced a structured blocker.

The structured blocker should include `code: "codex_chrome_bridge_unavailable"` plus `blocker.remediation[]`. Agents should read those remediation steps before asking the user to restart Chrome or change permissions.

Do not conclude that Chrome or the extension is broken from a plain shell result, or from checking `globalThis.agent` before the Chrome plugin runtime is initialized. For a true Codex Chrome-plugin live run, bootstrap the runtime first:

```js
const { setupBrowserRuntime } = await import("/example/user/.codex/plugins/cache/openai-bundled/chrome/26.602.40724/scripts/browser-client.mjs");
await setupBrowserRuntime({ globals: globalThis });
globalThis.browser = await agent.browsers.get("extension");
```

If the command was intentionally running in a bridge-enabled host and still returns this blocker, verify that the Codex Chrome extension is installed and enabled, then restart Chrome or Codex if the backend is still unavailable. Do not keep retrying the same attach path indefinitely.

For Python live bridge smokes, a plain Python-spawned Node subprocess does not inherit Codex's in-process bridge. Use the relay into an active bridge-hosted backend:

```bash
CHATGPT_BROWSER_BACKEND_HTTP_URL=http://127.0.0.1:<relay-port> \
python scripts/live_smoke.py \
  --mode browser-bridge \
  --backend-command "node scripts/http_stdio_relay.mjs"
```

Keep the bridge-hosted JS execution active while Python runs. If that call returns first, browser operations can fail with `node_repl exec context not found`.

## `login_required`

The user needs to sign in to ChatGPT in Chrome. Stop and ask the user to complete login.

## `captcha`

Stop. Do not attempt bypass.

## `rate_limit`

Return the visible limit text and stop unless the user asks to wait or try a different path.

## `selector_drift`

The ChatGPT UI changed or the page loaded an unexpected surface. Return visible menu/button candidates and a screenshot/DOM summary if available.

Runner results surface this as `interruptions[0].type === "selector_drift"` with `blocker.candidates` when visible candidates were available. Do not retry automatically; ask the user or update selectors.

## File Upload Permission

File uploads have two separate permission gates:

1. Codex app settings for Chrome uploads must allow `chatgpt.com`, or uploads must be set to always allow.
2. Chrome's extension details page for the Codex extension may also need `Allow access to file URLs`.

If `fileChooser.setFiles` returns `Not allowed`, the ChatGPT chooser was reached but Chrome refused the local file handoff. Check both gates before retrying.

Agent-facing remediation text should name both settings:

> File upload is blocked by Chrome/Codex permissions. Ask the user to enable both: Codex Settings > Computer Use > Chrome > Permissions > Uploads, and Chrome chrome://extensions > Codex extension > Details > Allow access to file URLs. Then retry.

## Clipboard Unavailable

`response.copy` falls back to DOM text extraction when the macOS system clipboard does not change.

## Flattened Or Unreadable Response Capture

Use `readLatest({ format: "markdown" })`, `copyLatest()`, or the default SDK `read: true` path for human-readable responses. Use `format: "normalized_text"` only for exact-string assertions or polling. Check `data.source`, `data.fidelity`, and `data.warnings`: clipboard output is highest fidelity, while DOM Markdown is semantic reconstruction. If Markdown capture degrades, return the command warning and save the structured `blocks` or diagnostic `html` representation instead of silently writing flattened text as a Markdown report.

## Response Branch Ambiguity

When ChatGPT exposes previous/next response controls, `readLatest` and `copyLatest` include `branch.current`, `branch.total`, `actions`, and `thoughtDurationText` when visible. If the branch state is missing but the user expects a rerun or edited-message branch, reload the thread and read again before claiming to have captured the latest answer.

## Download Unavailable

The command only downloads visible files with a download affordance. If no download control exists, ask ChatGPT to create or expose the file again.

## Redacted Reports

`createReport`, `chatgpt.reports.*`, SDK workflow reports, and live-smoke reports redact raw prompt/response/file content by default. Use `includeContent: true` only when the user explicitly asks to persist raw content.

## Responses Adapter Unsupported Fields

`chatgpt.responses.create()` rejects OpenAI API-only fields such as `model`, `temperature`, `logprobs`, `previous_response_id`, `store`, and `max_output_tokens` before submitting a prompt. Inspect `browser_control.unsupported[]` for `path`, `reason`, and `alternative`.

## Runner Milestone Streaming

`chatgpt.runner.run(agent, input, { stream: true })` returns milestone events and `stream.completed`. It does not stream token deltas. If an agent expects API stream events, use `event.name` and `event.item.type` instead.

## Doctor Preflight

Run `doctor({ check: ["bridge", "login", "upload", "download", "clipboard"] })` before long workflows when the browser state or permissions are uncertain. Upload readiness may remain `unknown` until a live attach attempt, but the remediation should still name both upload permission gates.
