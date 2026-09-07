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

`status: "partial"` is the required result for incomplete response capture. A partial result may still include `output_text` and `data.responseText`, but consumers must treat that text as incomplete until a later wait confirms completion. Common causes are wait timeout after partial assistant text, active generation controls such as `Stop answering`, stopped-generation markers such as `Stopped thinking`, or a read fallback after the wait step could not confirm completion. Message command data may include `submissionState`, `completionState`, `generationActive`, and `generationSignals`; `completionState: "generating"` or `generationActive: true` is explicit evidence that the visible ChatGPT turn is still running. For status-only polling, `messages.wait` accepts `responseContent: "metadata"`; partial and completed wait results then omit assistant text and instead return compact metadata such as `data.responseChars` and `data.responseSha256`. Intentional capture clipping uses `data.captureLimit` plus warnings; it is separate from ChatGPT generation length.

Use `messages.status({ maxPreviewChars })` for a compact latest-assistant progress snapshot when a host tool-call ceiling is shorter than the expected ChatGPT generation. It returns counts, latest-assistant preview length, `completionState`, `generationActive`, and generation signals without treating partial text as final, and without the cost of a full `readLatest`/`wait` probe.

Use `messages.stop({ confirmStop: true })` only after the caller explicitly decides that the current visible response should stop. It clicks one uniquely scoped, visible stop control and succeeds only after generation is observed inactive. Without the exact boolean `confirmStop: true`, it returns `needs_confirmation`; if generation is observably inactive, it is a no-op. An unavailable or ambiguous control, an uninspectable generation state, or an unverified postcondition fails closed.

If the Stop activation starts but its completion races the command deadline, the result is `status: "timeout"` with blocker code `stop_generation_unverified` and `resumable: false`. The browser-native deadline terminates the request before the command returns, so it cannot click later; the click may already have taken effect before termination. Inspect the current visible generation state and never retry Stop automatically.

## Streaming

Streaming commands emit backend event lines until `completed` or `error`.

```json
{
  "schemaVersion": "chatgpt.browser_control.backend_event.v1",
  "requestId": "req_stream",
  "type": "run_item_stream_event",
  "name": "message_in_progress",
  "item": {
    "type": "message.in_progress",
    "completionState": "generating"
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

Streaming is milestone streaming only. It does not promise token deltas or OpenAI API stream-event parity. Partial assistant text is emitted as `message_in_progress`; only completion-confirmed output is emitted as `message_completed`.

Persistent clients perform one single-flight `backend.hello` negotiation before
admitting multiplexed work. When the backend advertises request-ID-scoped unary
and stream multiplexing, one lifecycle-owned reader routes every response and
event to its exact `requestId`; compatible older backends remain single-flight.
Cancellation and timeout retain a bounded late-output tombstone. A record for a
known tombstone is drained, while an unknown request ID quarantines and recycles
the connection rather than being guessed into an active route.

The transport retains a bounded, redacted `backend_compatibility.v1` snapshot for
the current backend generation. Protocol or capability incompatibility rejects
the hello before any browser command is admitted. Compatible package, runtime,
and build differences are warnings rather than an exact package-version gate;
the report includes a `build_digest_mismatch` warning even when package versions
match. Missing provenance is reported as `unknown`, never inferred, and the
snapshot contains no command list, prompts, paths, secrets, or provider output.

Backpressure is bounded by both event count and encoded UTF-8 bytes. Overflow
fails only the affected stream route and leaves unrelated correlated routes
usable. The Node and Python clients bound aggregate queued stdin frames by
count and bytes, and both clients bound aggregate caller/control route
admissions with `maxInFlight`/`max_in_flight` (default `256`, minimum `2`) across
handshake probes, waiting legacy slots, pending unary routes, async
pre-reservations, and streams. During negotiation gaps where the handshake is
unknown/in progress and no control route is currently charged, caller
reservations use at most `maxInFlight - 1` slots so the transport can always
admit the next hello/legacy control probe. Once a control route is charged, it
counts as one ordinary live route and callers can use the full configured
bound; the virtual headroom returns between sequential legacy probes. Saturation
is rejected before request-ID
reservation and every terminal, cancellation, timeout, queued-never-started
release, and recycle path releases its live slot. The client rechecks route
ownership immediately before writing, so a request canceled while queued is never written later. If a started stdin write
does not settle, the child is recycled; at most one unresolved generation may
be detached, and a second unresolved generation fails closed until teardown
settles. These are transport liveness guards, not proof that a browser mutation
did or did not occur.

## Required Backend Commands

The backend must support:

- lifecycle: `backend.version`, `backend.health`, `backend.capabilities`
- runner: `runner.run`, `runner.plan`, `runner.stream`
- Responses adapter: `responses.create`
- workflows: `ask`, `askInThread`, `askWithFiles`, `askAndDownload`, `runMessages`, `openThread`, `runPlan`
- diagnostics: `doctor`
- reports: `createReport`, `reports.create`, `reports.redact`, `reports.summarize`
- command discovery: `commands`, `describe`, `help`
- primitives: `session.bootstrap`, `experience.detect`, `experience.open`, `configuration.inspect`, `configuration.apply`, `work.start`, `work.status`, `work.wait`, `work.steer`, `work.readLatest`, `threads.*`, `messages.*`, `artifacts.*`, `files.preflight`, `files.attach`, `files.downloadLatest`, `projects.sources.list`, `projects.sources.planAdd`, `projects.sources.add`, `modes.set`, `modes.get`, `tools.select`, `response.copy`

`experience.detect` and `configuration.inspect` are non-mutating capability
discovery. `configuration.apply` is strict by default and must verify the final
visible state. `work.start` defaults to a fresh task and must not append to a
loaded task unless the caller explicitly passes `newTask: false`. A partial or
timeout Work result is recovered through status/wait/read on the same task, not
by resubmitting the original prompt.

`doctor` returns a normal `CommandResult` whose `data.checks` map is extensible. Scenario checks such as `existing_tab`, `artifacts`, `file_preflight`, `localization`, and `reports` may add optional `code`, `blockerKind`, `nextCommand`, and JSON `details` fields to individual check entries while preserving the existing `status`, `message`, and `remediation` fields.
The additive `compatibility` check is browser-free and exposes the retained
report in `details`; warning and unknown provenance map to an `unknown` check,
while a rejected negotiation maps to `blocked` and makes the report not ready.

## Transactional operations (v1)

The additive operation surface uses four strict backend commands:
`operations.submit`, `operations.collect`, `operations.inspect`, and
`operations.control`. Their request and result schemas, caller-owned
`operationId` rules, fresh-handle recovery, and privacy boundary are defined in
[the transactional operations reference](2026-08-16-transactional-operations.md).

These commands are not aliases for `messages.submit`, `messages.wait`, or the
legacy workflow runner. `operations.submit` creates/reconciles one journal
record and returns an accepted/completed/blocked/uncertain envelope;
`operations.collect` observes only that operation's owned turn;
`operations.inspect` is browser-free durable inspection; and `operations.control`
binds one Stop or Work steer to a generating parent handle. `operations.run`
is an SDK composition, not a fifth wire command.

`operations.inspect` is browser-free and may include the same additive
`compatibility` report projected from the lifecycle-owned transport. It does not
reopen a tab or perform a browser read.

Transactional wire validation rejects unsupported fields before browser use.
The backend redacts adapter/journal failures at the protocol boundary so raw
prompts, local paths, URLs, and provider-private diagnostics do not cross the
NDJSON response. With no custom adapter seam, the default client constructs a
lazy request-local ChatGPT adapter after journal admission and fails closed if
the bridge, authenticated target evidence, or required provider primitive is
unavailable. A custom adapter configuration must supply the complete adapter
factory set; neither path falls back to a legacy sequence.

The default local journal requires real process identity, platform-appropriate
file ownership, and process-liveness authority. It validates those host
capabilities before creating journal directories or touching the browser. When
they are unavailable and no explicit journal service is configured, an
operation-aware high-level `ask` returns the normal command
result shape with `status: "blocked"`, `blocker.kind: "unknown"`,
`blocker.code: "journal_runtime_unavailable"`, `blocker.resumable: false`, and
`error.recoverable: false`. The bounded remediation uses the established
`label`, `instruction`, and `userActionRequired` fields. This is an unavailable
runtime result, not evidence of composer drift or a successful submission.
The shared `journal-runtime-unavailable.json` fixture is generated through the
public facade and preserves that result across Python decoding.

As verified on 2026-09-06, the restricted Codex JavaScript host used for issue
41 exposes its browser bridge but does not expose the required process APIs.
It can run compatibility workflows, but its default local journal is
unavailable. An explicitly started normal Node journal service supplies durable
storage and signing through the authenticated private-file connection while
browser actions remain in the active bridge host. Configure
`operations.journalService.descriptorPath` as described in the
[journal service runbook](2026-09-06-journal-service.md). A plain Node subprocess
still cannot inherit the browser bridge. Do not substitute PID or owner values,
install a fake `process`, disable ownership checks, or infer that an unknown
lock owner is dead. An automatic retry or a new operation ID cannot repair a
missing host capability.

`operations.collect` optionally accepts `pollIntervalMs`, an integer from `0`
through `60000`. It controls only the interval between bounded observation
attempts. Poll sleeps occur outside browser/tab transactions.

## Host-Local Attachment Paths

Attachment paths are interpreted on the machine running the Node backend. Use an absolute path in that host operating system's native form. On macOS/Linux/WSL, use paths such as `/example/user/file.pdf`, `/home/you/file.pdf`, or `/mnt/c/example/user/file.pdf`. On Windows backend hosts, use fully qualified paths such as `C:\Users\you\file.pdf` or UNC paths such as `\\server\share\file.pdf`. Drive-relative paths like `C:Users\you\file.pdf`, root-relative paths like `\tmp\file.pdf`, and Windows-looking paths sent to a POSIX backend are rejected before filesystem access.

Use `files.preflight` for non-mutating local validation before browser upload workflows. It validates absolute paths, existence, readability, file-vs-directory status, configurable per-file and total byte limits, duplicate basenames, duplicate resolved paths, zero-byte files, and extension-based MIME/category guesses. Zero-byte files are blocked before browser interaction because ChatGPT rejects empty attachments. By default the command does not open ChatGPT, perform a live upload, read file contents for MIME detection, or return file-content fingerprints. Callers may pass `includeHashes: true` to include SHA-256 metadata for local diagnostics; file contents are never returned. `askWithFiles` and `files.attach` run the same preflight before upload attempts so obvious local file failures stop before browser interaction.

`files.attach` accepts `includeDiagnostics: true` to return metadata-only upload diagnostics in `data.diagnostics`: the preflight result plus the browser input's selected file names and sizes when the DOM exposes them. Pair `includeDiagnostics: true` with `includeHashes: true` when diagnosing whether a non-empty local file became an empty browser-side `File`; do not persist these diagnostics in public reports unless the user has approved content fingerprint metadata.

Once the native file handoff starts, any timeout, bridge error, or missing post-handoff composer evidence is indeterminate: `files.attach` returns `status: "partial"`, blocker code `attachment_outcome_indeterminate`, and `resumable: false`. Browser-native deadlines terminate the handoff request before the command returns, so it cannot mutate later; the file may already be present. Inspect the current composer, do not submit, and never retry the attachment automatically.

The Codex Chrome chooser intentionally exposes `isMultiple()` and `setFiles()` but no backing-element accessor. Before accepting that opaque chooser, the Node runtime proves the initiating input or control belongs to the unique active composer; the CDP fallback independently resolves and clicks that exact unique input. Browser providers that expose a chooser backing element receive an additional identity cross-check before handoff.

## Project Sources

Project Sources V1 is a narrow visible-UI surface for ChatGPT Project URLs such as `https://chatgpt.com/g/g-p-.../project`.

- `projects.sources.list` opens or claims the Project Sources UI and returns source names plus coarse statuses only.
- `projects.sources.planAdd` validates explicit local file paths with the same metadata-only preflight used by `files.preflight`, batches the upload plan, and does not open ChatGPT.
- `projects.sources.add` is append-only and requires `confirmMutation: true`; without it, the command returns a `needs_confirmation` blocker with the dry-run plan.

The implementation normalizes nested project chat URLs back to the project page before operating. It does not delete, replace, sync repository trees, read cookies/storage/auth headers, call private ChatGPT endpoints, or read source file contents while planning. Confirmed upload uses visible browser file chooser primitives and diffs before/after source names to report added sources.

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

`files.downloadLatest` preserves the existing file-link behavior, recognizes
filename-labelled buttons in the latest assistant turn, opens ChatGPT's artifact
preview, and then activates its visible Download control. `filenamePattern` is
an optional case-insensitive regular expression that prevents a different file
or image fallback from being accepted as the requested output. When the browser
bridge exposes only a completed local download `path()`, the runtime copies that
file into `destDir`; bridges exposing `saveAs()` remain supported. Without a
filename pattern, the command falls back to generated-artifact download only
when no conventional ChatGPT file affordance is visible. Artifact failures are
reported as structured blockers such as
`artifact_unavailable`, `artifact_selector_drift`, or
`artifact_download_unavailable`, not protocol errors.

After a visible download activation, the runtime requires the browser bridge's
native completion receipt within the operation deadline. An unverified
completion returns `download_receipt_timeout` with kind `download_unavailable`,
status `blocked`, and nonresumable/nonrecoverable flags. It does not retry the
activation or switch download strategies, and preserves existing browser
downloads. A bridge that cannot expose a native receipt remains unsupported
for verified download completion.

A structurally identified Chrome error page with the exact
`ERR_BLOCKED_BY_CLIENT` code returns `download_blocked_by_browser` with the same
`download_unavailable` kind, blocked status, and nonresumable/nonrecoverable
flags. Text mentioning that code in a normal conversation is not browser-error
evidence. The runtime does not retry the activation or bypass browser
restrictions; the caller receives no successful download receipt and completion
remains unverified. This browser-error observation is distinct from a native
receipt timeout.

Other native event or activation failures return `download_receipt_failed`
with the same blocked and nonretryable semantics. A fixed message replaces
native error details, which may include sensitive download URLs. The runtime
supplies no successful receipt and does not switch to another strategy after
an uncertain activation.

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

Important: in Codex, `globalThis.agent` is not present until the Chrome plugin runtime is bootstrapped. Do not diagnose bridge availability by checking `globalThis.agent` in an ordinary shell or before assigning the object returned by the Chrome plugin's `setupBrowserRuntime()`.

The live Chrome bootstrap is:

```js
const { setupBrowserRuntime } = await import("/absolute/path/to/the/current/chrome/scripts/browser-client.mjs");
globalThis.agent = await setupBrowserRuntime();
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

## Transactional Live Qualification

Compatibility live smokes and release canaries do not qualify submit-once
behavior. The additive Node live scenario `transactional-submit-once` is
explicitly enabled with `CHATGPT_E2E_TRANSACTIONAL=1`; select that scenario
alone when using `CHATGPT_E2E_SCENARIOS` or the live-smoke module's scenario
filter. In a supported host with an already initialized browser bridge:

```javascript
const selected = smoke.filterScenarios(smoke.optionalScenarios, "transactional-submit-once");
const run = await smoke.runLiveSmoke({
  agent,
  browser,
  reportDir: "/absolute/path/to/local/reports/live-smoke",
  env: {
    CHATGPT_E2E_TRANSACTIONAL: "1",
    // Optional when the browser host requires the separate journal service.
    CHATGPT_E2E_JOURNAL_DESCRIPTOR: "/absolute/private/session/connection.json"
  }
}, selected);
const qualified = run.results.length === 1 && run.results[0].status === "pass";
```

Here `smoke` is the imported `codex-chatgpt-control-live-smoke.bundle.mjs`.
The scenario creates one synthetic Chat conversation using the public `ask`
facade and the default production runtime, with a fresh UUID, zero files, and a
multiline prompt. It performs submit-only, bounded collect, owned-receipt
verification, and a same-ID replay only after a completed receipt. It verifies
one satisfied Send action, the same operation/request/target handle, and exactly
one user/assistant exchange in the same established conversation before and
after replay. For `ambiguous_submit` only, it may make one observation-only
same-ID recovery after inspection proves the matching target and a durable
`observe_only_after_intent` Send action at the `send_may_have_occurred` boundary.
It then verifies the same action and intent survived recovery. Other blockers
stop qualification; there is no blind resubmission or replacement operation ID.
Reports contain only structural evidence, response length/hash, and fixed
status codes.

This scenario is optional, so inspect its own `status`; an empty
`requiredFailures` list does not establish a pass. A missing host capability,
pending collect, absent receipt, or changed turn count fails qualification.
Without the explicit service, the restricted Codex host described above fails
with `journal_runtime_unavailable`. Configuring the service makes that host
eligible for this qualification; the scenario must still pass submit, collect,
receipt and replay checks. A successful journal connection alone does not
qualify browser behavior. Python fixture and facade checks validate result
preservation; Python operation-aware relay qualification remains a separate
gate requiring a live bridge-hosted Node backend and a permitted transport to
that backend.

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

Create the backend server and wait on it in the **same** bridge-hosted JS execution. A server created in one Node REPL call cannot be kept bridge-capable by waiting in a second call. That single execution must remain active for the duration of the Python smoke. The relay path is:

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
npm run docs:drift
npm run parity:fixtures
npm run parity:suite
npm run test:backend-conformance
```

Python must also load and round-trip the same fixtures through Pydantic models. Any future backend implementation should pass these fixtures before claiming compatibility.

## Restricted-host journal authority

The Node backend can use an explicit asynchronous journal service while keeping browser control in its active host. See [the journal service runbook](2026-09-06-journal-service.md) for startup, recovery, transport boundaries, and the intentional TypeScript host API asymmetry. Operation wire shapes and Python facades are unchanged. The private-file transport rejects Windows with `journal_rpc_unsupported_platform` before filesystem access; the existing local Node journal path is unchanged.
