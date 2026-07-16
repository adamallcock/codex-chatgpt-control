# codex-chatgpt-control

TypeScript runtime for controlling visible ChatGPT Chat and Work through a compatible browser bridge.

Unofficial project: not affiliated with, endorsed by, or sponsored by OpenAI. This is not an OpenAI API wrapper and does not call hidden or private ChatGPT endpoints. Browser-required calls need a visible session and should fail with a clear machine-readable reason when the bridge is unavailable.

## Install

```bash
npm install codex-chatgpt-control@next
```

## Usage

```ts
import { createChatGPT } from "codex-chatgpt-control";

const chatgpt = createChatGPT({ agent: globalThis.agent });
const reviewer = chatgpt.agent({
  name: "reviewer",
  instructions: "Review carefully and return Markdown."
});

const result = await chatgpt.runner.run(reviewer, {
  input: "Review this design.",
  thread: { type: "new" },
  experience: "chat",
  response: { format: "markdown" }
});
```

Inspect the visible surface and apply verified configuration:

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

Start a fresh Work task once, then poll or steer it:

```ts
await chatgpt.work.start({
  prompt: "Produce a decision-ready implementation brief.",
  newTask: true,
  wait: false,
  read: false
});

await chatgpt.work.status({ includeArtifacts: true });
await chatgpt.work.steer({
  prompt: "Add a prioritized migration sequence.",
  wait: false,
  read: false
});
```

Legacy `mode` inputs and `modes.set/get` remain supported. New code should use
`experience` and strict `configuration` because Chat and Work expose different
nested axes.

Reuse a user-open ChatGPT thread without replacing the tab:

```ts
await chatgpt.askInThread({
  thread: { type: "url", url: "https://chatgpt.com/c/<conversation-id>" },
  existingTab: true,
  prompt: "Continue from the latest answer.",
  wait: true,
  read: { format: "markdown" }
});
```

Attach local files with host-local absolute paths:

```ts
const preflight = await chatgpt.files.preflight({
  paths: ["/absolute/host/path/to/report.pdf"]
});

await chatgpt.askWithFiles({
  files: ["/absolute/host/path/to/report.pdf"],
  prompt: "Summarize this report.",
  wait: true,
  read: { format: "markdown" }
});

await chatgpt.askWithFiles({
  files: [String.raw`C:\Users\you\Documents\report.pdf`],
  prompt: "Summarize this report.",
  wait: true,
  read: { format: "markdown" }
});
```

Use the second example only when the backend process itself is running on Windows. If the backend runs in WSL/Linux, pass the WSL/Linux path, such as `/home/you/Documents/report.pdf`.

Plan append-only ChatGPT Project Sources changes before mutating a project:

```ts
const plan = await chatgpt.projects.sources.planAdd({
  projectUrl: "https://chatgpt.com/g/g-p-example/project",
  files: ["/absolute/host/path/to/source.md"]
});

const added = await chatgpt.projects.sources.add({
  projectUrl: "https://chatgpt.com/g/g-p-example/project",
  files: ["/absolute/host/path/to/source.md"],
  confirmMutation: true
});
```

`planAdd` validates explicit local file metadata without reading file contents or opening ChatGPT. `add` is append-only and returns `needs_confirmation` unless `confirmMutation: true` is supplied.

Explain structured blockers before deciding whether to retry:

```ts
const result = await chatgpt.session.bootstrap({ existingTab: true });
if (!result.ok) {
  const explanation = chatgpt.explainBlocker(result, { command: "session.bootstrap" });
  console.log(explanation.markdown);
}
```

`explainBlocker` preserves the original `result.blocker` fields and adds conservative retry/resume guidance. Existing-tab blockers include metadata such as requested target, candidate tab IDs, URLs, titles, conversation IDs, and mismatch reason; they do not include page text or chat content.

## Validation

Run deterministic gates:

```bash
npm test
npm run build
npm run bundle
npm run bundle:backend
npm run contract:validate
npm run docs:drift
npm run parity:fixtures
npm run parity:suite
```
