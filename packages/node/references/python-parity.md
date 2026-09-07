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

Negotiated compatibility is also shared contract behavior. The Node and Python
transports retain a bounded `BackendCompatibilityReport` for the current
backend generation and expose it through `compatibility_report()` (or the
TypeScript equivalent). Protocol/capability rejection blocks before browser
commands; package, runtime, and build differences are precise warnings, not an
exact package-version requirement. A matching package version with a different
build digest remains a `build_digest_mismatch` warning. Unknown provenance stays
unknown. The report is redacted and contains no command list, prompt, path,
secret, or provider output.

## Transactional operations parity

The direct v1 operation surface is shared by TypeScript and Python through the
same strict wire schemas and backend commands:

- `operations.submit`
- `operations.collect`
- `operations.inspect`
- `operations.control`

Python exposes sync `OperationsClient` and async `AsyncOperationsClient` on the
`ChatGPT`/`AsyncChatGPT` facades. Their keyword aliases are idiomatic
snake_case (`operation_id`, `response_content`, `timeout_ms`,
`control_action_id`), but `to_wire()` always emits the TypeScript-compatible
camelCase fields. Every envelope validates operation ID, request digest, fresh
handle, target binding, receipt/blocker identity, and mutation-boundary
monotonicity before returning to the caller. `run()` is local composition of
one submit and at most one collect; it is not a fifth backend command.
`operations.inspect` projects the transport compatibility snapshot into its
additive `compatibility` field without browser access. `doctor` exposes the same
report in its browser-free `compatibility` check; a warning or unknown
provenance is diagnostic and does not block readiness, while rejected
negotiation is blocked.

The immutable submit capture contract is exposed as
`OperationDurableCapturePolicy` (with the `OperationCapturePolicyState` alias)
and is serialized as the path-free `capturePolicy` object on created/state
records. It contains only `responseContent`, `responseFormat` (defaulting to
`markdown`), and `artifacts`; request-local `outputDirectory` is never accepted
on a durable model. A recovered `transfer` policy remains a transfer
obligation until a new request-local destination is explicitly authorized.

This direct parity does not make Python a second browser runtime. The current
backend remains Node-backed and, with no custom seam, creates the same lazy
request-local ChatGPT adapter as the TypeScript client. Browser-touching calls
still require a bridge-enabled runtime, authenticated target evidence, and the
required provider primitives. `inspect` is browser-free; an ordinary
Python-spawned Node process cannot inherit Codex's in-process bridge, so
ordinary-shell checks can exercise request/result validation and structured
blockers without claiming live ChatGPT control. Raw
`liveResponse` content is explicitly ephemeral and is never accepted into a
durable receipt or operation state.

Operation-aware Python `ask` preserves the Node host blocker
`journal_runtime_unavailable` as a `CommandResult` with `status == "blocked"`,
`blocker["kind"] == "unknown"`, `blocker["resumable"] == False`, and
`error["recoverable"] == False`, including the existing remediation fields.
Sync and async facades return it after one backend request; they do not replace
it with transport uncertainty, retry, or open another operation. The shared
`journal-runtime-unavailable.json` fixture covers exact wire round-tripping.
No Python model or browser implementation change is needed because the
TypeScript journal remains authoritative.

The default local journal requires real process identity, platform-appropriate
ownership, and process-liveness APIs before filesystem or browser mutation.
The restricted Codex JavaScript host observed on 2026-09-06 lacks those APIs
even though its browser bridge works. Configure the explicit journal service
on its bridge-hosted Node `BackendSession` to provide storage and signing from
a normal Node process. The Python facade and operation protocol stay unchanged.
A Python-to-Node relay alone cannot supply journal authority, and a plain Node
subprocess cannot inherit the browser bridge. Do not spoof process identity,
weaken ownership/lock checks, or retry with a new UUID.

The TypeScript and Python high-level Runner and Responses adapters now have an
explicit caller-owned operation-ID opt-in. Python accepts the idiomatic
`operation_id` keyword (or the `operation_id`/`operationId` member of the
runner input), validates it and all supported combinations before backend
traffic, then routes exactly one submit followed by at most one collect through
the shared operation facade. Legacy calls with no operation ID retain their
existing `runner.run`/`responses.create` transport path. Returned run/response
data carries the validated operation ID and fresh handle; pending, blocked, and
uncertain operation envelopes remain partial/blocked results with their
contract blocker, while identity mismatches fail closed. The full request,
recovery, coordinator, privacy, and compatibility boundary is documented in
[Transactional browser operations](2026-08-16-transactional-operations.md).

Direct Python `collect`/`run` expose `poll_interval_ms`; transactional Runner
wait objects additionally accept `pollMs`, `poll_ms`, `pollIntervalMs`, or
`poll_interval_ms` when aliases agree. The wire field is `pollIntervalMs`, its
range is the inclusive integer interval `0..60000`, and sleeping never holds a
browser/tab coordinator transaction.

Incomplete response capture is also shared contract behavior. Python must preserve `status == "partial"`, `output_text`, warnings, and any nested `data.captureLimit` dictionaries exactly as the TypeScript backend returns them. `partial` is not a protocol error: callers should inspect `data.complete` and run another wait/read on the same thread when they need final output.

For long-answer polling, Python forwards `response_content="metadata"` to the shared wire field `responseContent: "metadata"` on `messages.wait`. The TypeScript backend then omits assistant text from wait results and returns compact metadata such as `data.responseChars` and `data.responseSha256`; Python must preserve those fields without trying to reconstruct omitted content.

Python exposes the explicit stop primitive as `chatgpt.messages.stop(confirm_stop=True)`, mapping to `messages.stop` with `confirmStop: true`. The TypeScript backend owns visible-control selection, the single operation deadline, and inactive-state verification; Python adds no independent browser behavior.

Python preserves the backend's indeterminate Stop result exactly: `status == "timeout"`, blocker code `stop_generation_unverified`, and `resumable == False`. The browser request is terminated at its native deadline and cannot click later, but the click may already have taken effect. Python callers must inspect the visible state and must not retry automatically.

Generated-image behavior stays owned by the TypeScript runtime. Python exposes
the same backend commands through `chatgpt.artifacts.list_latest(...)`,
`chatgpt.artifacts.wait(...)`, and `chatgpt.artifacts.download_latest(...)`.
Those methods forward to `artifacts.listLatest`, `artifacts.wait`, and
`artifacts.downloadLatest`; they do not duplicate DOM or selector logic.

Python preserves the backend's `download_receipt_timeout` blocker when native
browser download completion cannot be verified within the deadline. The result
is blocked, nonresumable and nonrecoverable; the facade does not retry the
activation or select an alternate download path. Existing browser downloads
remain in place. Python also preserves `download_blocked_by_browser` when the
TypeScript runtime identifies Chrome's `ERR_BLOCKED_BY_CLIENT` error page. It
is a blocked, nonresumable, nonrecoverable command result with no download
receipt; Python does not retry or duplicate the browser-error detection. The
shared `download-blocked-by-browser.json` fixture and Python snapshot test lock
this behavior without adding wire fields or Python-specific browser logic.
The `download-receipt-failed.json` fixture also preserves the sanitized
`download_receipt_failed` result from native event or activation failures:
blocked status, no receipt, and false resumable/recoverable flags. Python keeps
the fixed backend message and never reconstructs native error details or
retries an uncertain activation.

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

Python also preserves a post-handoff attachment uncertainty as `status == "partial"`, blocker code `attachment_outcome_indeterminate`, and `resumable == False`. Callers must inspect the current composer, must not submit, and must not automatically repeat the file handoff.

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

## Transactional Qualification Is Separate

The opt-in Node scenario `transactional-submit-once` uses the default public
runtime with `CHATGPT_E2E_TRANSACTIONAL=1`. It verifies a fresh-ID multiline,
zero-file ask, owned collection, a completed receipt, and same-ID replay with
one Send and one user/assistant exchange. One `ambiguous_submit` recovery is
permitted only after proving the existing observation-only Send intent and
matching target; other blockers stop qualification. See [Transactional Live Qualification](backend-protocol.md#transactional-live-qualification)
for selection and report checks. A host blocker is a failed qualification,
even when ordinary-shell blocker handling or compatibility browser smokes
pass.

Python's existing `scripts/live_smoke.py --mode browser-bridge` matrix omits
operation IDs and therefore covers compatibility workflows. Its success does
not establish transactional parity. This patch adds shared-fixture and
sync/async `ask` preservation coverage; full Python operation-aware relay
qualification remains a separate gate. It requires a bridge-hosted Node backend
with either a supported local journal or the configured journal service, plus
a permitted Python-to-backend transport. The existing HTTP test relay is
unavailable where that browser host forbids local sockets; filesystem journal
transport does not itself provide a Python backend relay. Keep browser
interaction and ownership verification in TypeScript rather than adding Python
DOM selectors.

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
const { setupBrowserRuntime } = await import("/absolute/path/to/the/current/chrome/scripts/browser-client.mjs");
globalThis.agent = await setupBrowserRuntime();
globalThis.browser = await agent.browsers.get("extension");
```

Then run the backend server inside that active JS execution context and point Python at the stdio-to-HTTP relay:

```bash
CHATGPT_BROWSER_BACKEND_HTTP_URL=http://127.0.0.1:<relay-port> \
python scripts/live_smoke.py \
  --mode browser-bridge \
  --backend-command "node scripts/http_stdio_relay.mjs"
```

Create the backend server and wait on it in the **same** bridge-hosted JS execution. Starting the server in one Node REPL call and trying to keep it alive with a second call does not preserve the first call's browser execution context. Keep that single execution active while Python runs. If it returns first, the browser client no longer has an active execution context and operations can fail with `node_repl exec context not found`.

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

## Restricted-host journal authority

The Node backend can use an explicit asynchronous journal service while keeping browser control in its active host. See [the journal service runbook](2026-09-06-journal-service.md) for startup, recovery, transport boundaries, and the intentional TypeScript host API asymmetry. Operation wire shapes and Python facades are unchanged. Python preserves `journal_rpc_unsupported_platform` when the Node backend rejects the private-file transport on Windows; it does not bypass the platform guard. Existing local Node journal behavior on Windows is unchanged.
