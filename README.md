# codex-chatgpt-control

[![CI](https://img.shields.io/github/actions/workflow/status/adamallcock/codex-chatgpt-control/parity.yml?branch=main&label=CI&logo=github)](https://github.com/adamallcock/codex-chatgpt-control/actions/workflows/parity.yml)
[![npm](https://img.shields.io/npm/v/codex-chatgpt-control?logo=npm)](https://www.npmjs.com/package/codex-chatgpt-control)
[![PyPI](https://img.shields.io/pypi/v/codex-chatgpt-control?logo=pypi)](https://pypi.org/project/codex-chatgpt-control/)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![Node](https://img.shields.io/badge/Node-20%2B-green)

Unofficial alpha SDK facade for Codex agents that need to run user-directed workflows in a visible ChatGPT web session.

## Why This Exists

This project exists because Codex and ChatGPT are useful in different parts of the same work loop. Codex is the execution environment: it can read and edit the local repo, run commands, test changes, and prepare branches. ChatGPT, meanwhile, may expose different frontier models, Pro-tier reasoning modes, larger context windows, canvases, connectors, browsing/research tools, memory, or company knowledge at any given time.

In practice, that means a user can end up doing real work by hand across two surfaces:

> I am flicking between Codex for execution, and ChatGPT with Pro for deep planning, information gathering, consensus building, branding, and research tasks.

`codex-chatgpt-control` turns that manual tab switch into a structured, visible, user-directed bridge. It lets an agent stay inside Codex while asking ChatGPT web to help with the kinds of work where ChatGPT may currently be the stronger product surface: deep planning, long-context review, research synthesis, naming, positioning, brainstorming, design critique, and second-opinion analysis.

- **Keep Codex as home base:** preserve the local execution loop while optionally consulting ChatGPT web for planning or research-heavy steps.
- **Visible-session only:** drive chatgpt.com through a compatible Codex/browser bridge and user-visible UI controls, including file uploads and visible downloads where available.
- **Workflow primitives, not a ChatGPT API:** support prompts, thread workflows, response capture, clear stop reasons, and privacy-preserving local reports without private endpoint access.
- **Narrow by design:** built for Codex -> browser -> chatgpt.com workflows; it is not a generic browser automation framework, scraping tool, OpenAI API wrapper, or official OpenAI project.

This project is not affiliated with, endorsed by, or sponsored by OpenAI.

## What This Is For

Use `codex-chatgpt-control` when a Codex-style agent needs to work with the real ChatGPT web product that the user can see:

- start or continue visible ChatGPT threads
- submit prompts and read Markdown responses
- attach approved local files through visible upload controls
- download visible generated files
- tell the agent exactly why it could not continue when ChatGPT needs login, captcha, permissions, or UI review
- save local run reports that omit prompt and response content by default

This project deliberately does not provide hidden ChatGPT access, account automation, or a replacement for the OpenAI API.

## Install

Node:

```bash
npm install codex-chatgpt-control
```

Python:

```bash
python -m pip install codex-chatgpt-control
```

The Node package is the browser-control runtime authority. The Python package is a parity client over the same local backend protocol.

## Codex Desktop Setup

This repo includes a public Codex skill at [skills/codex-chatgpt-control/SKILL.md](skills/codex-chatgpt-control/SKILL.md). It is the quickest way to make Codex Desktop agents use this SDK consistently instead of hand-rolling browser commands.

Install it into a local Codex skills directory:

```bash
mkdir -p ~/.codex/skills/codex-chatgpt-control
rsync -a skills/codex-chatgpt-control/ ~/.codex/skills/codex-chatgpt-control/
```

Then add a short instruction to any repo where agents should be allowed to consult ChatGPT web:

```markdown
When a task would benefit from the visible ChatGPT web product, use the
codex-chatgpt-control skill and SDK. Keep the workflow visible and
user-directed. If I say a ChatGPT thread is already open, reuse that tab with
existingTab/existing_tab instead of opening a replacement. If the browser bridge
or ChatGPT UI is unavailable, report the SDK stop reason and do not retry
blindly.
```

The skill is an agent-facing operating guide. It does not bundle a browser bridge, credentials, or ChatGPT account access. Install the npm package or build the Node runtime from source before using browser-control workflows.

## Node Quick Start

Use the SDK from a Codex/browser-bridge host that provides `globalThis.agent`:

```ts
import { createChatGPT } from "codex-chatgpt-control";

const chatgpt = createChatGPT({ agent: globalThis.agent });
const reviewer = chatgpt.agent({
  name: "reviewer",
  instructions: "Review carefully and return Markdown."
});

const result = await chatgpt.runner.run(reviewer, {
  input: "Reply with a one-sentence summary of this project.",
  thread: { type: "new" },
  response: { format: "markdown" }
});

console.log(result.output_text);
```

Continue a user-open ChatGPT thread without replacing the tab:

```ts
await chatgpt.askInThread({
  thread: { type: "url", url: "https://chatgpt.com/c/<conversation-id>" },
  existingTab: true,
  prompt: "Continue from the latest answer.",
  wait: true,
  read: { format: "markdown" }
});
```

If you run browser-required commands from an ordinary shell, the safe expected result is a structured `browser_bridge_unavailable` blocker. That means the protocol path is working, but no visible browser bridge was available to the process.

## Python Quick Start

The Python package talks to the Node backend. Build or install a backend command first, then point Python at it:

```bash
python -m pip install codex-chatgpt-control
npm install codex-chatgpt-control
```

```python
from codex_chatgpt_control import Agent, BackendClient, Runner, StdioBackendTransport

backend = BackendClient(StdioBackendTransport(
    command=["npx", "--yes", "--package", "codex-chatgpt-control", "codex-chatgpt-control-backend"]
))
runner = Runner(backend)

try:
    result = runner.run_sync(
        Agent(name="reviewer", instructions="Review carefully."),
        {
            "input": "Reply with hi.",
            "thread": {"type": "new"},
            "response": {"format": "markdown"},
        },
    )
finally:
    backend.close()

print(result.status)
print(result.output_text)
```

The Python package is a protocol client. The current browser runtime is still Node-backed.

## Quick Start From Source

Clone the repo and build the Node runtime:

```bash
git clone https://github.com/adamallcock/codex-chatgpt-control.git
cd codex-chatgpt-control/packages/node
npm ci
npm test
npm run build
npm run bundle
npm run bundle:backend
```

Use the built source bundle from a Codex/browser-bridge host:

```ts
import { createChatGPT } from "./dist/codex-chatgpt-control.bundle.mjs";

const chatgpt = createChatGPT({ agent: globalThis.agent });
```

## SDK Shape

The main Node entrypoint is `createChatGPT({ agent })`. It exposes:

- `chatgpt.agent(...)` and `chatgpt.runner.run(...)` for Agents-style visible-session workflows.
- `chatgpt.ask(...)`, `askInThread(...)`, `askWithFiles(...)`, and `askAndDownload(...)` for common task flows.
- `chatgpt.responses.create(...)` for a narrow Responses-shaped adapter over the same visible browser runner.
- Primitive groups for `session`, `threads`, `messages`, `files`, `modes`, `tools`, and `response`.
- Discovery helpers: `chatgpt.help()`, `chatgpt.commands()`, and `chatgpt.describe(name)`.
- Local run reports through `chatgpt.createReport(...)` and `chatgpt.reports`; prompt and response content is omitted unless explicitly enabled.

Useful repo links:

- [Bundled Codex skill](skills/codex-chatgpt-control/SKILL.md)
- [Architecture](docs/architecture.md)
- [Browser bridge](docs/browser-bridge.md)
- [Safety model](docs/safety.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Release process](docs/release-process.md)
- [Python examples](packages/python/examples/)

## Runtime Requirements

For deterministic tests and ordinary-shell protocol checks:

- Node.js 20 or newer for `packages/node`
- Python 3.10 or newer for `packages/python`
- npm for Node dependency installation
- Python virtualenv tooling for Python development

For real ChatGPT browser control:

- a signed-in ChatGPT web session in Chrome
- a compatible Codex/browser bridge that exposes `globalThis.agent`
- a visible browser tab or permission to open one
- user approval for prompts, files, downloads, and any account-affecting action

`globalThis.agent` is not created by this package. It must come from the host runtime, such as a Codex environment with a compatible browser bridge. The SDK refuses to fake this path: ordinary shell runs should return `browser_bridge_unavailable` for browser-required operations.

### Local File Upload Requirements

File attachments need two separate permission gates:

1. **Chrome extension gate:** open `chrome://extensions`, choose the Codex/browser bridge extension, open **Details**, and enable **Allow access to file URLs**.
2. **Codex app gate:** in Codex settings, allow Google Chrome uploads under **Computer Use > Google Chrome > Permissions > Uploads**. Choose the most restrictive setting that still fits your workflow; for unattended local smoke tests, use the setting that always allows uploads.

If either gate is missing, file upload workflows should stop with a structured permission blocker instead of retrying blindly.

## Repository Layout

```text
skills/             Public Codex skill for agent-facing usage
packages/node/      TypeScript runtime, contracts, backend server, tests
packages/python/    Python parity client, examples, tests
docs/               Public architecture, safety, bridge, and release notes
.github/workflows/  Deterministic CI gates
```

## Development

Run deterministic Node gates:

```bash
cd packages/node
npm ci
npm test
npm run build
npm run bundle
npm run bundle:backend
npm run contract:validate
npm run parity:fixtures
```

Run deterministic Python gates after the backend bundle exists:

```bash
cd packages/python
python -m pip install -e .[dev]
python -m unittest discover -s tests
python -m compileall -q src examples
python -m pyright --pythonpath "$(which python)" src tests
python scripts/live_smoke.py --mode ordinary-shell
```

Ordinary-shell smoke checks are expected to return structured browser-bridge blockers for browser-required actions. A real ChatGPT run requires a compatible visible browser session and bridge.

## Package Coordinates

- npm package: [`codex-chatgpt-control`](https://www.npmjs.com/package/codex-chatgpt-control)
- PyPI package: [`codex-chatgpt-control`](https://pypi.org/project/codex-chatgpt-control/)
- Node import: `import { createChatGPT } from "codex-chatgpt-control";`
- Python import: `import codex_chatgpt_control`

## Safety

Do not use this project to bypass login, access hidden endpoints, scrape private data, or automate activity outside a user-directed visible session. See [docs/safety.md](docs/safety.md) and [SECURITY.md](SECURITY.md).
