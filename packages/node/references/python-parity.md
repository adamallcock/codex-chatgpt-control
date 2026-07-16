# Python Parity

The Python package is a parity client over the TypeScript browser-control runtime. Keep browser automation owned by `packages/node/`; keep Python synchronized through the versioned wire contract in `contracts/v1/`.

## Contract

- Shared fixtures live in `contracts/v1/fixtures/`.
- `npm run contract:validate` validates every fixture against JSON Schema.
- `npm run parity:fixtures` enforces fixture shape, stream settlement, and wire-field casing.
- `npm run docs:drift` checks backend commands, command descriptors, blocker coverage, generated troubleshooting sections, Python facade coverage, and public-export doc anchors.
- `npm run parity:suite` validates `contracts/v1/parity-suite.json`, which ties every public backend command and fixture to TypeScript tests, Python tests, docs, and deterministic CI gates.
- Python tests load the same manifest and round-trip every JSON fixture through Pydantic models.

Wire fields stay TypeScript-compatible. Python exposes idiomatic aliases:

| Wire | Python |
| --- | --- |
| `finalOutput` | `final_output` |
| `newItems` | `new_items` |
| `activeAgentName` | `active_agent_name` |
| `lastAgentName` | `last_agent_name` |
| `nextStepId` | `next_step_id` |
| `browser_control.untrustedOutput` | `response.untrusted_output` |
| `metaPath` | `meta_path` |
| `mimeType` | `mime_type` |
| `totalBytes` | `total_bytes` |
| `projectUrl` | `project_url` |
| `displayPath` | `display_path` |
| `selectorProfile` | `selector_profile` |
| `newTask` | `new_task` |
| `includeArtifacts` | `include_artifacts` |

Incomplete response capture is also shared contract behavior. Python must preserve `status == "partial"`, `output_text`, warnings, and any nested `data.captureLimit` dictionaries exactly as the TypeScript backend returns them. `partial` is not a protocol error: callers should inspect `data.complete` and run another wait/read on the same thread when they need final output.

For long-answer polling, Python forwards `response_content="metadata"` to the shared wire field `responseContent: "metadata"` on `messages.wait`. The TypeScript backend then omits assistant text from wait results and returns compact metadata such as `data.responseChars` and `data.responseSha256`; Python must preserve those fields without trying to reconstruct omitted content.

Generated-image behavior stays owned by the TypeScript runtime. Python exposes
the same backend commands through `chatgpt.artifacts.list_latest(...)`,
`chatgpt.artifacts.wait(...)`, and `chatgpt.artifacts.download_latest(...)`.
Those methods forward to `artifacts.listLatest`, `artifacts.wait`, and
`artifacts.downloadLatest`; they do not duplicate DOM or selector logic.
If the TypeScript runtime recovers a generated image by reopening a stalled
claimed conversation in a temporary bridge-owned tab and exporting through
`pageAssets`, Python observes the same command result through the backend
protocol without any Python-side browser logic.

Chat/Work behavior follows the same authority boundary. Python exposes matching
sync and async `experience`, `configuration`, and `work` groups, but surface
detection, selector profiles, configuration state machines, submit-once Work
semantics, and artifact extraction remain owned by TypeScript. Nested Python
dictionaries and model instances are recursively converted from snake_case to
the camelCase wire contract.

Blocker explainability follows the same rule. TypeScript owns blocker creation,
runner interruption decisions, and existing-tab diagnostics. Python exposes
`explain_blocker(...)` over the backend blocker dictionary and is checked against
the shared `blocker-explanation-profiles.json` and
`existing-tab-diagnostics-blocker.json` contract fixtures.

## Host-Local Attachment Paths

Python does not reinterpret attachment paths. It sends the path string to the Node backend, and the backend validates the path against its own host operating system. Attachment paths must be absolute on the backend host. On macOS/Linux/WSL backends, use POSIX paths such as `/example/user/file.pdf` or `/mnt/c/example/user/file.pdf`. On Windows backends, use fully qualified paths such as `C:\Users\you\file.pdf` or UNC paths such as `\\server\share\file.pdf`. Drive-relative paths, root-relative paths, and Windows-looking paths sent to a POSIX backend are rejected before filesystem access.

Python exposes the backend-visible `files.preflight` command as `chatgpt.files.preflight(...)`. It returns the same `CommandResult` as TypeScript and can be decoded with `FilePreflightData` when callers want typed metadata. The command validates paths, readability, file-vs-directory status, size limits, duplicate basenames, duplicate resolved paths, zero-byte files, and extension-based MIME/category guesses without opening ChatGPT or reading file contents for MIME detection. Zero-byte files are blocked before browser interaction. Optional `include_hashes=True` / wire `includeHashes: true` adds SHA-256 metadata to `FilePreflightFile.sha256` for local diagnostics; file contents are never returned.

## Project Sources

Python exposes the protocol-visible Project Sources commands through `chatgpt.projects.sources`:

- `list(project_url=...)` maps to `projects.sources.list`.
- `plan_add(project_url=..., files=[...])` maps to `projects.sources.planAdd`.
- `add(project_url=..., files=[...], confirm_mutation=True)` maps to `projects.sources.add`.

Python does not duplicate DOM or upload logic. Project URL normalization, visible Sources UI selection, source-list extraction, confirmation blockers, upload batching, and before/after diffing are owned by the TypeScript backend. `ProjectSourcesAddPlanData` and `ProjectSourcesListData` provide typed Pydantic aliases for callers that want to decode command `data`.

## Sync Python

```python
from codex_chatgpt_control import ChatGPT, NodeSidecarTransport

chatgpt = ChatGPT(
    transport=NodeSidecarTransport(
        command=["node", "dist/codex-chatgpt-control-backend.mjs"]
    )
)
agent = chatgpt.agent(name="reviewer", instructions="Review deeply.")
result = chatgpt.runner.run(agent, input="Reply with hi.")

print(result.output_text)
print(result.final_output)
```

## Async Python

```python
from codex_chatgpt_control import AsyncChatGPT

chatgpt = AsyncChatGPT(transport=my_async_transport)
agent = chatgpt.agent(name="reviewer", instructions="Review deeply.")
result = await chatgpt.runner.run(agent, input="Reply with hi.")
```

## Responses Fixture Shape

```python
from codex_chatgpt_control import ChatGPTResponse

response = ChatGPTResponse.from_wire(payload["response"])
unsupported = response.unsupported_fields
safe_handoff = response.untrusted_output
```

Unsupported OpenAI API-only fields stay explicit in `browser_control.unsupported[]`; the Python adapter must not submit them silently.

Successful Responses and runner fixtures may include `untrustedOutput`, a no-execute return envelope for handing captured ChatGPT output to another agent, tool, or prompt. It is metadata and framing around `output_text`; it does not make the raw answer trusted.

Python also exposes the same pure helper surface for local consumers:

```python
from codex_chatgpt_control import (
    render_untrusted_output_return_envelope,
    verify_integrity_sidecar,
)

safe = render_untrusted_output_return_envelope(
    output_text=response.output_text,
    source="chatgpt",
    captured_at="2026-06-09T20:00:00.000Z",
)
```

Report results may include `metaPath` plus `integrity` metadata. Python exposes those as `RunReportData.meta_path` and `RunReportData.integrity`; consumers can call `verify_integrity_sidecar(...)` before trusting persisted report paths across a process boundary.

## Streaming

`stream-*.ndjson` fixtures are milestone streams. They are not token streams. The final `completed` event contains a normal `ChatGPTRunResult` wire object, including blockers when the run cannot proceed. Running partial assistant text uses `message.in_progress` / `message_in_progress`; completion-confirmed assistant output uses `message.completed` / `message_completed`.

```python
from codex_chatgpt_control import ChatGPTStreamEvent

event = ChatGPTStreamEvent.from_wire(payload)
if event.type == "completed" and event.result is not None:
    print(event.result.status)
```

## Required Gates

Run from `packages/node`:

```bash
npm run bundle:backend
npm run contract:validate
npm run docs:drift
npm run parity:fixtures
npm run parity:suite
npm run test:backend-conformance
npm test -- tests/unit/contract-fixtures.test.ts
```

Run from `packages/python`:

```bash
python -m pip install -e ".[dev]"
python -m unittest discover -s tests
python -m compileall -q src
python -m pyright src tests
python scripts/live_smoke.py --mode ordinary-shell
```

## Backend Runtime

Python is a native SDK facade over the local backend protocol. The initial browser-control runtime is still the TypeScript backend service:

- `dist/codex-chatgpt-control-backend.mjs` is the stdio backend bundle.
- `BackendClient` and `StdioBackendTransport` keep Python backend calls long-lived.
- `NodeSidecarTransport.run(...)` remains as a compatibility wrapper over backend `runner.run`. By default each call spawns and tears down its own backend subprocess; use it as a context manager (or call `open()`/`close()`) to reuse one persistent backend process across calls in multi-command workflows. Transport-level failures close the persistent session; protocol-level errors keep it open.
- Ordinary-shell smoke passes when browser-required calls return structured `browser_bridge_unavailable`.
- Browser-bridge runtime smoke remains explicitly gated because it can operate a real ChatGPT session.

## Browser-Bridge Smoke

Run this only when you intentionally want Python to drive a live backend with browser access:

```bash
python scripts/live_smoke.py --mode browser-bridge
```

The command covers:

- `runner.run` new ask/read.
- `runner.run_streamed` milestone streaming.
- `responses.create` basic.
- `run_plan` named `new-ask-read`.
- `reports.create` redacted report output.

The default backend command is the Node stdio bundle:

```text
../node/dist/codex-chatgpt-control-backend.mjs
```

That default is enough for protocol validation and structured blockers, but a plain subprocess cannot inherit Codex's JavaScript `globalThis.agent` browser bridge. For a true live browser pass, point Python at a stdio backend command that already runs in a bridge-enabled host:

```bash
CHATGPT_BROWSER_BACKEND_COMMAND="node /absolute/path/to/bridge-enabled-backend.mjs" \
python scripts/live_smoke.py --mode browser-bridge
```

### Codex Chrome Plugin Relay

When the live backend is hosted inside the Codex Chrome plugin runtime, do not test bridge availability from a normal shell or an unbootstrapped Node REPL. First initialize the Chrome runtime:

```js
const { setupBrowserRuntime } = await import("/example/user/.codex/plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs");
await setupBrowserRuntime({ globals: globalThis });
globalThis.browser = await agent.browsers.get("extension");
```

Then run the backend server inside that active JS execution context and point Python at the stdio-to-HTTP relay:

```bash
CHATGPT_BROWSER_BACKEND_HTTP_URL=http://127.0.0.1:<relay-port> \
python scripts/live_smoke.py \
  --mode browser-bridge \
  --backend-command "node scripts/http_stdio_relay.mjs"
```

Keep the bridge-hosted JS execution active while Python runs. If that JS execution returns first, the browser client no longer has an active execution context and operations can fail with `node_repl exec context not found`.

This is the intended live test chain:

```text
Python SDK -> scripts/http_stdio_relay.mjs -> bridge-hosted Node backend -> Codex Chrome bridge -> ChatGPT
```

Smoke output is a redacted JSON summary. It reports output matches and lengths, not raw prompts or raw responses. Exit codes are:

| Code | Meaning |
| --- | --- |
| `0` | All browser-bridge scenarios passed. |
| `1` | At least one scenario failed unexpectedly. |
| `2` | Scenarios recorded documented blockers such as `browser_bridge_unavailable`, `login_required`, or `selector_drift`. |
