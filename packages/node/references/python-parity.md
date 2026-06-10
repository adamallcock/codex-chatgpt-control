# Python Parity

The Python package is a parity client over the TypeScript browser-control runtime. Keep browser automation owned by `packages/node/`; keep Python synchronized through the versioned wire contract in `contracts/v1/`.

## Contract

- Shared fixtures live in `contracts/v1/fixtures/`.
- `npm run contract:validate` validates every fixture against JSON Schema.
- `npm run parity:fixtures` enforces fixture shape, stream settlement, and wire-field casing.
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

Generated-image behavior stays owned by the TypeScript runtime. Python exposes
the same backend commands through `chatgpt.artifacts.list_latest(...)`,
`chatgpt.artifacts.wait(...)`, and `chatgpt.artifacts.download_latest(...)`.
Those methods forward to `artifacts.listLatest`, `artifacts.wait`, and
`artifacts.downloadLatest`; they do not duplicate DOM or selector logic.
If the TypeScript runtime recovers a generated image by reopening a stalled
claimed conversation in a temporary bridge-owned tab and exporting through
`pageAssets`, Python observes the same command result through the backend
protocol without any Python-side browser logic.

Blocker explainability follows the same rule. TypeScript owns blocker creation,
runner interruption decisions, and existing-tab diagnostics. Python exposes
`explain_blocker(...)` over the backend blocker dictionary and is checked against
the shared `blocker-explanation-profiles.json` and
`existing-tab-diagnostics-blocker.json` contract fixtures.

## Host-Local Attachment Paths

Python does not reinterpret attachment paths. It sends the path string to the Node backend, and the backend validates the path against its own host operating system. Attachment paths must be absolute on the backend host. On macOS/Linux/WSL backends, use POSIX paths such as `/example/user/file.pdf` or `/mnt/c/example/user/file.pdf`. On Windows backends, use fully qualified paths such as `C:\Users\you\file.pdf` or UNC paths such as `\\server\share\file.pdf`. Drive-relative paths, root-relative paths, and Windows-looking paths sent to a POSIX backend are rejected before filesystem access.

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

`stream-*.ndjson` fixtures are milestone streams. They are not token streams. The final `completed` event contains a normal `ChatGPTRunResult` wire object, including blockers when the run cannot proceed.

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
- `NodeSidecarTransport.run(...)` remains as a compatibility wrapper over backend `runner.run`.
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
const { setupBrowserRuntime } = await import("/example/user/.codex/plugins/cache/openai-bundled/chrome/26.602.40724/scripts/browser-client.mjs");
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
