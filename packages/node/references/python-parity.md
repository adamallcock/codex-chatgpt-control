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
```

Unsupported OpenAI API-only fields stay explicit in `browser_control.unsupported[]`; the Python adapter must not submit them silently.

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
python -m pyright --pythonpath "$(which python)" src tests
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
