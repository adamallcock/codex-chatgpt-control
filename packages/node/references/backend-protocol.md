# Backend Protocol

The local backend is a long-lived language-neutral service. The initial implementation is Node/TypeScript, exposed over stdio NDJSON.

This is the contract that keeps Node and Python deeply in sync:

```text
Node in-process SDK
Node backend client
Python SDK
Future SDKs
  -> backend protocol
  -> compatible browser-control backend
  -> browser bridge
  -> chatgpt.com
```

The current live backend is Node-backed. A future Python-native backend can replace it by implementing this protocol and passing the same contract fixtures and smoke gates.

## Stdio Transport

Each request is one JSON line on stdin. Backend stdout is reserved for protocol JSON only; diagnostics go to stderr.

```json
{
  "schemaVersion": "chatgpt.browser_control.backend_request.v1",
  "requestId": "req_1",
  "command": "backend.health",
  "payload": {}
}
```

Each non-streaming response is one JSON line:

```json
{
  "schemaVersion": "chatgpt.browser_control.backend_response.v1",
  "requestId": "req_1",
  "ok": true,
  "result": {
    "ok": true,
    "status": "ok"
  }
}
```

Protocol errors use the same response envelope:

```json
{
  "schemaVersion": "chatgpt.browser_control.backend_response.v1",
  "requestId": "req_1",
  "ok": false,
  "error": {
    "code": "unknown_command",
    "message": "Unknown backend command: runner.nope",
    "recoverable": false
  }
}
```

Current protocol error codes are:

- `invalid_request`
- `unsupported_schema_version`
- `unknown_command`

Browser-control blockers are not protocol errors. They are normal command or runner results with `status: "blocked"`, `status: "partial"`, or `status: "needs_confirmation"` plus blocker/interruption details.

## Streaming

Streaming commands emit backend event lines until `completed` or `error`.

```json
{
  "schemaVersion": "chatgpt.browser_control.backend_event.v1",
  "requestId": "req_stream",
  "type": "run_item_stream_event",
  "name": "message_completed",
  "item": {
    "type": "message.completed"
  }
}
```

The final event contains a normal runner result:

```json
{
  "schemaVersion": "chatgpt.browser_control.backend_event.v1",
  "requestId": "req_stream",
  "type": "completed",
  "result": {
    "status": "ok",
    "output_text": "hi"
  }
}
```

Streaming is milestone streaming only. It does not promise token deltas or OpenAI API stream-event parity.

## Required Backend Commands

The backend must support:

- lifecycle: `backend.version`, `backend.health`, `backend.capabilities`
- runner: `runner.run`, `runner.plan`, `runner.stream`
- Responses adapter: `responses.create`
- workflows: `ask`, `askInThread`, `askWithFiles`, `askAndDownload`, `runMessages`, `openThread`, `runPlan`
- diagnostics: `doctor`
- reports: `createReport`, `reports.create`, `reports.redact`, `reports.summarize`
- command discovery: `commands`, `describe`, `help`
- primitives: `session.bootstrap`, `threads.*`, `messages.*`, `artifacts.*`, `files.preflight`, `files.attach`, `files.downloadLatest`, `modes.set`, `tools.select`, `response.copy`

`doctor` returns a normal `CommandResult` whose `data.checks` map is extensible. Scenario checks such as `existing_tab`, `artifacts`, `file_preflight`, `localization`, and `reports` may add optional `code`, `blockerKind`, `nextCommand`, and JSON `details` fields to individual check entries while preserving the existing `status`, `message`, and `remediation` fields.

## Host-Local Attachment Paths

Attachment paths are interpreted on the machine running the Node backend. Use an absolute path in that host operating system's native form. On macOS/Linux/WSL, use paths such as `/example/user/file.pdf`, `/home/you/file.pdf`, or `/mnt/c/example/user/file.pdf`. On Windows backend hosts, use fully qualified paths such as `C:\Users\you\file.pdf` or UNC paths such as `\\server\share\file.pdf`. Drive-relative paths like `C:Users\you\file.pdf`, root-relative paths like `\tmp\file.pdf`, and Windows-looking paths sent to a POSIX backend are rejected before filesystem access.

Use `files.preflight` for non-mutating local validation before browser upload workflows. It validates absolute paths, existence, readability, file-vs-directory status, configurable per-file and total byte limits, duplicate basenames, duplicate resolved paths, zero-byte files, and extension-based MIME/category guesses. It does not open ChatGPT, perform a live upload, or read file contents for MIME detection. `askWithFiles` and `files.attach` run the same preflight before upload attempts so obvious local file failures stop before browser interaction.

## Generated Artifacts

Generated images are represented as visible artifacts, not assistant text. A
ChatGPT image-only result can be complete even when `messages.readLatest` returns
`not_found` and `assistantTurnCount` is `0`.

Use the artifact primitives for this surface:

- `artifacts.listLatest` detects visible generated artifacts.
- `artifacts.wait` waits for a generated artifact to appear and stabilize.
- `artifacts.downloadLatest` downloads via a visible artifact affordance, or
  saves a visible image source when no browser download event fires.

When a claimed user-open ChatGPT tab stalls bridge page inspection, artifact
commands may recover by opening the same saved `https://chatgpt.com/c/...`
conversation in a temporary bridge-owned tab and using the bridge `pageAssets`
capability to inventory and bundle the latest non-SVG image asset. This is an
implementation detail of the TypeScript runtime; the wire command and result
shape are unchanged.

`files.downloadLatest` preserves the existing file-link behavior and falls back
to generated-artifact download only when no conventional ChatGPT file affordance
is visible. Artifact failures are reported as structured blockers such as
`artifact_unavailable`, `artifact_selector_drift`, or
`artifact_download_unavailable`, not protocol errors.

`session.bootstrap` accepts `existingTab` for explicit reuse of a user-open Chrome tab before any read or prompt step. The wire shape is shared by TypeScript and Python:

```json
{
  "existingTab": {
    "target": { "type": "selected", "host": "chatgpt" },
    "ifMissing": "block"
  }
}
```

Other supported targets are `{ "type": "url", "url": "https://chatgpt.com/c/..." }`, `{ "type": "conversationId", "conversationId": "..." }`, and `{ "type": "tabId", "tabId": "..." }`. Explicit existing-tab reuse blocks by default when no matching tab is open. `ifMissing: "open"` may open URL or conversation-id targets, but selected-tab and tab-id targets remain claim-only because there is no deterministic URL to create.

`backend.capabilities` is the source of truth for supported commands, transports, and stream modes. The current backend advertises:

```json
{
  "protocolVersion": "chatgpt.browser_control.backend_request.v1",
  "transports": ["stdio"],
  "streaming": {
    "modes": ["ndjson"],
    "tokenDeltas": false
  }
}
```

## HTTP/SSE Status

HTTP/SSE is deferred in this phase. Stdio NDJSON is the default long-lived local transport because it has no port allocation, no browser-origin surface, and no local network security prompt. It also covers the current streaming requirement through backend event lines.

Any future HTTP/SSE implementation must use the same request, response, event, capabilities, fixture, and conformance shapes. It should add `http` and `sse` capabilities only after transport-specific tests pass.

## Runtime Boundary

Python is a native SDK facade over the protocol. The current browser-control runtime is still Node-backed.

An ordinary shell can launch:

```bash
node ../node/dist/codex-chatgpt-control-backend.mjs
```

That is enough to validate protocol shape, command dispatch, contracts, and blocker handling. It is not enough to guarantee live ChatGPT control, because a plain subprocess does not automatically inherit Codex's JavaScript `globalThis.agent` browser bridge.

For live browser control, the backend process must have access to a compatible browser bridge through one of the backend runtime options:

- Codex-hosted JavaScript runtime with `globalThis.agent`.
- Explicit `RuntimeEnv.browser` or `RuntimeEnv.page` in a future embedding.
- A future Python-native/native-host/CDP backend that implements this same protocol.

Important: in Codex, `globalThis.agent` is not present until the Chrome plugin runtime is bootstrapped. Do not diagnose bridge availability by checking `globalThis.agent` in an ordinary shell or before calling the Chrome plugin's `setupBrowserRuntime({ globals: globalThis })`.

The live Chrome bootstrap is:

```js
const { setupBrowserRuntime } = await import("/example/user/.codex/plugins/cache/openai-bundled/chrome/26.602.40724/scripts/browser-client.mjs");
await setupBrowserRuntime({ globals: globalThis });
globalThis.browser = await agent.browsers.get("extension");
```

## Ordinary-Shell Smoke

Run from `packages/node`:

```bash
npm run bundle:backend
```

Run from `packages/python`:

```bash
python scripts/live_smoke.py --mode ordinary-shell
```

In an ordinary shell without Codex browser bridge access, browser-required commands must return a structured `browser_bridge_unavailable` blocker. This is a successful smoke result when the backend process stays alive and protocol calls such as `backend.health` and `commands` succeed.

## Browser-Bridge Smoke

Run only when intentionally operating a backend with live browser access:

```bash
python scripts/live_smoke.py --mode browser-bridge
```

Use `CHATGPT_BROWSER_BACKEND_COMMAND` or `--backend-command` when the bridge-enabled backend is not the default bundle:

```bash
CHATGPT_BROWSER_BACKEND_COMMAND="node /absolute/path/to/bridge-enabled-backend.mjs" \
python scripts/live_smoke.py --mode browser-bridge
```

When the bridge-enabled backend is running inside an active Codex Chrome-plugin JS execution rather than a standalone process, run Python through the stdio relay:

```bash
CHATGPT_BROWSER_BACKEND_HTTP_URL=http://127.0.0.1:<relay-port> \
python scripts/live_smoke.py \
  --mode browser-bridge \
  --backend-command "node scripts/http_stdio_relay.mjs"
```

The bridge-hosted JS execution must remain active for the duration of the Python smoke. The relay path is:

```text
Python SDK -> stdio relay -> bridge-hosted Node backend -> Codex Chrome bridge -> ChatGPT
```

The smoke covers `runner.run`, `runner.run_streamed`, `responses.create`, named `run_plan`, and redacted `reports.create`. It writes redacted JSON summaries and does not persist raw prompt/response content by default.

## Untrusted Output And Integrity

Assistant output captured from ChatGPT is untrusted third-party content. Runner results with non-empty `output_text` expose `data.untrustedOutput`; Responses-shaped results expose the same object at `browser_control.untrustedOutput`.

The envelope schema is:

```json
{
  "schemaVersion": "chatgpt.browser_control.untrusted_output_return.v1",
  "trusted": false,
  "source": "chatgpt",
  "capturedAt": "2026-06-06T00:00:00.000Z",
  "contentSha256": "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
  "contentBytes": 2,
  "inline": true,
  "maxInlineBytes": 12000,
  "rendered": "UNTRUSTED OUTPUT RETURN ENVELOPE\n..."
}
```

Use `rendered` when handing the captured answer to another agent, tool, or prompt. It places routing and hash metadata before the body, tells the consumer not to execute embedded instructions, and uses a markdown fence longer than any backtick run inside the content. Outputs larger than the inline byte guard are not inlined; the envelope points at the persisted output path when one is available.

Run report creation writes a sibling `*.meta.json` sidecar by default:

```json
{
  "schemaVersion": "chatgpt.browser_control.integrity.v1",
  "target": {
    "path": "reports/runs/run.json",
    "bytes": 123,
    "sha256": "..."
  },
  "output": {
    "untrusted": true,
    "bytes": 2,
    "sha256": "..."
  },
  "inputs": []
}
```

The sidecar hashes the report file, normalized prompt text when available, untrusted output text when available, and configured input file paths. Consumers that cross a process or trust boundary should rehash the sidecar targets before acting on the report. Report writes are atomic and refuse to overwrite an existing target path.

## Contract Fixtures

Shared fixtures live under:

```text
contracts/v1/
```

Required gates:

```bash
npm run contract:validate
npm run parity:fixtures
npm run test:backend-conformance
```

Python must also load and round-trip the same fixtures through Pydantic models. Any future backend implementation should pass these fixtures before claiming compatibility.
