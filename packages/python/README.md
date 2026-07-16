# codex-chatgpt-control Python SDK

Python parity client for controlling visible ChatGPT Chat and Work through the shared Node backend protocol.

Unofficial project: not affiliated with, endorsed by, or sponsored by OpenAI. This is not an OpenAI API wrapper and does not call hidden or private ChatGPT endpoints.

```text
Python SDK -> backend protocol -> Node runtime -> browser bridge -> visible chatgpt.com session
```

The current browser-control runtime is Node/TypeScript. Python talks to it through a long-lived local stdio backend service. This is intentionally not a pure-Python browser-control runtime yet.

## Install

```bash
python -m pip install --pre codex-chatgpt-control
```

The Python package needs a Node backend command for browser-control workflows. Install or build the Node package too:

```bash
npm install codex-chatgpt-control@next
```

## Development Install

Build the backend bundle first:

```bash
cd ../node
npm ci
npm run bundle:backend
```

Install the Python package:

```bash
cd ../python
python -m pip install -e .[dev]
```

## Sync Usage

```python
from codex_chatgpt_control import Agent, BackendClient, Runner, StdioBackendTransport

backend = BackendClient(StdioBackendTransport(
    command=["node", "../node/dist/codex-chatgpt-control-backend.mjs"]
))
runner = Runner(backend)
agent = Agent(name="reviewer", instructions="Review carefully.")

try:
    result = runner.run_sync(agent, {
        "input": "Reply with hi.",
        "thread": {"type": "new"},
        "response": {"format": "markdown"},
    })
finally:
    backend.close()

print(result.status)
print(result.output_text)
```

## Agents-Style API

The Python SDK exposes OpenAI Agents SDK-inspired names where they fit the visible-session product:

- `Agent`
- `Runner.run`
- `Runner.run_sync`
- `Runner.run_streamed`
- `RunResult`
- `RunResultStreaming`

The semantics are browser-control semantics, not OpenAI API semantics. Instructions are visible by default and are submitted to ChatGPT web as prompt text unless `instructions_mode="metadata_only"` is used.

## Product-Specific API

The `ChatGPT` facade exposes workflows and primitive command groups:

- `chatgpt.responses.create(...)`
- `chatgpt.ask(...)`, `ask_in_thread(...)`, `ask_with_files(...)`
- `chatgpt.run_plan({"name": "new-ask-read", ...})`
- `chatgpt.doctor(...)`
- `chatgpt.reports.create(...)`
- `chatgpt.session`, `experience`, `configuration`, `work`, `threads`, `messages`, `artifacts`, `files`, `projects.sources`, `modes`, `tools`, `response`
- `chatgpt.commands()`, `describe(...)`, `help(...)`
- `chatgpt.explain_blocker(result_or_blocker, ...)` and module-level `explain_blocker(...)`

Unsupported OpenAI API-only Responses fields, such as `model`, `temperature`, and `previous_response_id`, return explicit unsupported responses instead of silently submitting misleading prompts.

Inspect and control Chat or Work with the same sync/async surface:

```python
surface = chatgpt.experience.detect()
capabilities = chatgpt.configuration.inspect(experience="work")

applied = chatgpt.configuration.apply(
    experience="work",
    desired={
        "model": "GPT-5.6 Sol",
        "effort": "High",
        "speed": "Standard",
    },
    strict=True,
)

started = chatgpt.work.start(
    prompt="Produce a decision-ready implementation brief.",
    new_task=True,
    wait=False,
    read=False,
)
```

Use `work.status`, `work.wait`, `work.steer`, `work.read_latest`, and
`work.artifacts` after submission. Legacy `modes` APIs remain available for
existing callers.

## Blocker Explainability

`explain_blocker(...)` preserves backend blocker dictionaries and returns structured fields plus Markdown for logs or CLI output:

```python
result = chatgpt.session.bootstrap(existing_tab=True)
if not result.ok:
    explanation = chatgpt.explain_blocker(result, command="session.bootstrap")
    print(explanation["markdown"])
```

Existing-tab blockers expose only safe metadata: requested target, candidate tab IDs, URLs, titles, conversation IDs, omitted candidate count, and mismatch reason. They do not include page text or chat content.

## Host-Local Attachment Paths

The Python client does not normalize attachment paths. It forwards them to the Node backend. Use the path form for the backend host, not necessarily the Python caller host. If Python is running on WSL but the backend is running in Windows, pass a Windows path. If the backend is running in WSL/Linux, pass a Linux path such as `/home/you/file.pdf`.

Validate local file metadata without opening ChatGPT:

```python
preflight = chatgpt.files.preflight(paths=["/absolute/host/path/to/report.pdf"])
if not preflight.ok:
    print(preflight.blocker)
```

Plan append-only ChatGPT Project Sources changes before mutating a project:

```python
plan = chatgpt.projects.sources.plan_add(
    project_url="https://chatgpt.com/g/g-p-example/project",
    files=["/absolute/host/path/to/source.md"],
)

added = chatgpt.projects.sources.add(
    project_url="https://chatgpt.com/g/g-p-example/project",
    files=["/absolute/host/path/to/source.md"],
    confirm_mutation=True,
)
```

`plan_add` validates explicit local file metadata without reading file contents or opening ChatGPT. `add` is append-only and returns `needs_confirmation` unless `confirm_mutation=True` is supplied.

## Backend And Browser Bridge

Ordinary shells can launch the backend and validate the protocol. Browser-required calls need a compatible browser bridge.

Without a bridge, live browser operations should return:

```json
{
  "kind": "browser_bridge_unavailable"
}
```

That blocker is expected in ordinary shells. A real live browser pass requires a backend command with bridge access. A plain Python-spawned Node subprocess does not automatically inherit a Codex browser bridge.

Override the backend command when needed:

```bash
CHATGPT_BROWSER_BACKEND_COMMAND="node /absolute/path/to/bridge-enabled-backend.mjs" \
python scripts/live_smoke.py --mode browser-bridge
```

## Validation

Run from `packages/python`:

```bash
python -m unittest discover -s tests
python -m compileall -q src examples
python -m pyright src tests
python scripts/live_smoke.py --mode ordinary-shell
```

The ordinary-shell smoke succeeds when the backend stays alive, `backend.health` succeeds, command descriptors load, and browser-required calls return `browser_bridge_unavailable`.
