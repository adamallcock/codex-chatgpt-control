# codex-chatgpt-control

[![CI](https://img.shields.io/github/actions/workflow/status/adamallcock/codex-chatgpt-control/parity.yml?branch=main&label=CI&logo=github)](https://github.com/adamallcock/codex-chatgpt-control/actions/workflows/parity.yml)
[![npm](https://img.shields.io/npm/v/codex-chatgpt-control?logo=npm)](https://www.npmjs.com/package/codex-chatgpt-control)
[![PyPI](https://img.shields.io/pypi/v/codex-chatgpt-control?logo=pypi)](https://pypi.org/project/codex-chatgpt-control/)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![Node](https://img.shields.io/badge/Node-20%2B-green)

Unofficial alpha SDK for agents that need to delegate user-directed workflows to the visible ChatGPT Chat and Work experiences.

https://github.com/user-attachments/assets/6ca38f2d-6646-490d-8e4d-8a6dc21e926f


## Why This Exists

This project exists because one desktop shell can still contain distinct execution experiences. Codex is the supported home for local repository work: editing, commands, tests, branches, and deployment. Visible ChatGPT Chat and Work carry different conversation/task state, controls, files, progress, and artifacts.

In practice, that means a user can still end up moving work by hand across product surfaces:

> I am using Codex for local execution, Chat for conversational review, and Work for longer tasks and deliverables.

`codex-chatgpt-control` turns that handoff into a structured, visible, user-directed bridge. It detects Chat versus Work, inspects the controls actually available to the signed-in user, applies configuration with postcondition verification, and preserves thread/task identity while waiting, steering, reading, and retrieving artifacts.

- **Keep Codex as home base:** preserve the supported local execution loop while delegating suitable review, research, or deliverable work to visible ChatGPT.
- **Treat Chat and Work as capabilities, not model folklore:** discover each surface and its nested configuration instead of assuming one flat picker.
- **Submit once:** separate Work start, status, wait, steer, read, and artifact operations so timeouts do not create duplicate tasks.
- **Visible-session only:** drive chatgpt.com through a compatible Codex/browser bridge and user-visible UI controls, including file uploads and visible downloads where available.
- **Workflow primitives, not a ChatGPT API:** support prompts, thread workflows, response capture, clear stop reasons, and privacy-preserving local reports without private endpoint access.
- **Narrow by design:** built for agent -> browser -> chatgpt.com workflows; it is not a generic browser automation framework, scraping tool, OpenAI API wrapper, official OpenAI project, or replacement for the official Codex SDK.

This project is not affiliated with, endorsed by, or sponsored by OpenAI.

## What This Is For

Use `codex-chatgpt-control` when a Codex-style agent needs to work with the real ChatGPT web product that the user can see:

- detect and open Chat or Work
- inspect available model/intelligence/effort/speed controls without mutation
- apply explicit visible configuration and verify the final state
- start or continue visible ChatGPT threads
- start, poll, steer, and read visible Work tasks
- submit prompts and read Markdown responses
- attach approved local files through visible upload controls
- download visible generated files and artifacts
- wait for and download image-only generated artifacts
- tell the agent exactly why it could not continue when ChatGPT needs login, captcha, permissions, or UI review
- save local run reports that omit prompt and response content by default

This project deliberately does not provide hidden ChatGPT access, account automation, a replacement for the OpenAI API, or a replacement for the official Codex SDK/CLI.

-----

## Install

Node:

```bash
npm install codex-chatgpt-control@next
```

Python:

```bash
python -m pip install --pre codex-chatgpt-control
```

The Node package is the browser-control runtime authority. The Python package is a parity client over the same local backend protocol.

The project is prerelease software. npm prereleases are published under
`next`, so plain `npm install codex-chatgpt-control` may intentionally resolve
to an older `latest` release.

## Codex Desktop Setup

This repo includes a Codex plugin at [plugins/codex-chatgpt-control](plugins/codex-chatgpt-control). It is the easiest way to make Codex Desktop agents use this SDK consistently instead of hand-rolling browser commands.

Install the repository as a Codex plugin marketplace and add the plugin:

```bash
codex plugin marketplace add adamallcock/codex-chatgpt-control --ref main
codex plugin add codex-chatgpt-control@codex-chatgpt-control
```

When a new version ships, refresh the marketplace snapshot and reinstall the plugin, then start a new Codex thread so updated skill metadata is loaded:

```bash
codex plugin marketplace upgrade codex-chatgpt-control
codex plugin add codex-chatgpt-control@codex-chatgpt-control
```

The plugin contains:

- `codex-chatgpt-control`: the broad visible Chat/Work workflow and diagnostics skill.
- `chatgpt-delegate`: the preferred surface-neutral Chat/Work delegation workflow.
- `chatgpt-pro-consult`: a backward-compatible visible Chat Pro-setting alias.
- bundled Node runtime files for bridge-enabled imports.

Manual skill-only install is still available as a fallback at [skills/codex-chatgpt-control/SKILL.md](skills/codex-chatgpt-control/SKILL.md):

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

The plugin and skill are agent-facing operating guides plus local runtime bundles. They do not bundle a browser bridge, credentials, or ChatGPT account access. Real browser workflows still require a compatible Codex/browser bridge and a visible signed-in ChatGPT web session.

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
  experience: "chat",
  response: { format: "markdown" }
});

console.log(result.output_text);
```

Inspect and apply visible configuration:

```ts
const surface = await chatgpt.experience.detect();
const capabilities = await chatgpt.configuration.inspect();

await chatgpt.configuration.apply({
  experience: "work",
  desired: {
    model: "GPT-5.6 Sol",
    effort: "High",
    speed: "Standard"
  },
  strict: true
});
```

Start Work once, then poll or steer the same task:

```ts
const started = await chatgpt.work.start({
  prompt: "Produce a decision-ready implementation brief.",
  newTask: true,
  wait: false,
  read: false
});

const status = await chatgpt.work.status({ includeArtifacts: true });
await chatgpt.work.steer({
  prompt: "Add a prioritized migration sequence.",
  wait: false,
  read: false
});
const latest = await chatgpt.work.readLatest({ format: "markdown" });
```

`newTask` defaults to true. If a current Work task is loaded and no unique
new-task control can be verified, the SDK blocks instead of appending
accidentally. After a partial or timeout result, use `work.status`,
`work.wait`, or `work.readLatest`; do not resubmit the original task.

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

Download an image-only generation through the artifact primitives:

```ts
await chatgpt.artifacts.wait({
  kind: "image",
  requireDownload: true
});

const downloaded = await chatgpt.artifacts.downloadLatest({
  destDir: "/absolute/output/dir"
});
```

Generated images are artifacts, not assistant text. `messages.readLatest()` can
correctly return `not_found` for an image-only result while
`artifacts.downloadLatest()` still saves the image. If a claimed user-open tab's
bridge session is stale, artifact export may recover by reopening the same saved
`https://chatgpt.com/c/...` conversation in a temporary bridge-owned tab and
using the bridge page-assets inventory. This recovery is fallback-only; normal
text/thread commands do not automatically replace the user's tab.

## Python Quick Start

The Python package talks to the Node backend. Build or install a backend command first, then point Python at it:

```bash
python -m pip install --pre codex-chatgpt-control
npm install codex-chatgpt-control@next
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

-----

![codex-chatgpt-control visible-session bridge banner](assets/readme/codex-chatgpt-control-readme-banner.png)

## SDK Shape

The main Node entrypoint is `createChatGPT({ agent })`. It exposes:

- `chatgpt.agent(...)` and `chatgpt.runner.run(...)` for Agents-style visible-session workflows.
- `chatgpt.ask(...)`, `askInThread(...)`, `askWithFiles(...)`, and `askAndDownload(...)` for common task flows.
- `chatgpt.responses.create(...)` for a narrow Responses-shaped adapter over the same visible browser runner.
- Primitive groups for `session`, `experience`, `configuration`, `work`, `threads`, `messages`, `artifacts`, `files`, `modes`, `tools`, and `response`.
- Discovery helpers: `chatgpt.help()`, `chatgpt.commands()`, and `chatgpt.describe(name)`.
- Local run reports through `chatgpt.createReport(...)` and `chatgpt.reports`; prompt and response content is omitted unless explicitly enabled.

Useful repo links:

- [Bundled Codex skill](skills/codex-chatgpt-control/SKILL.md)
- [Chat and Work migration](docs/chat-work-migration.md)
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

Attachment paths must be absolute on the machine running the Node backend. Use `/home/you/file.pdf` or `/mnt/c/work/file.pdf` for Linux/WSL backends. Use `C:\Users\you\file.pdf` or `\\server\share\file.pdf` for Windows backends. The backend rejects ambiguous Windows forms such as `C:Users\you\file.pdf` and rejects Windows-looking paths when the backend host is POSIX.

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

-----

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
npm run docs:drift
npm run parity:fixtures
npm run parity:suite
```

Run deterministic Python gates after the backend bundle exists:

```bash
cd packages/python
python -m pip install -e .[dev]
python -m unittest discover -s tests
python -m compileall -q src examples
python -m pyright src tests
python scripts/live_smoke.py --mode ordinary-shell
```

Ordinary-shell smoke checks are expected to return structured browser-bridge blockers for browser-required actions. A real ChatGPT run requires a compatible visible browser session and bridge.

To prepare a sanitized locale/rollout fixture draft from an already-open
authorized ChatGPT tab:

```bash
cd packages/node
npm run capture:surface-profile -- --id work-basic-en --locale en-US
```

The draft defaults to `unverified`, strips conversation identity/content, and
must pass contract validation and human review before being committed.

## Package Coordinates

- npm package: [`codex-chatgpt-control`](https://www.npmjs.com/package/codex-chatgpt-control)
- PyPI package: [`codex-chatgpt-control`](https://pypi.org/project/codex-chatgpt-control/)
- Node import: `import { createChatGPT } from "codex-chatgpt-control";`
- Python import: `import codex_chatgpt_control`

## Safety

Do not use this project to bypass login, access hidden endpoints, scrape private data, or automate activity outside a user-directed visible session. See [docs/safety.md](docs/safety.md) and [SECURITY.md](SECURITY.md).
