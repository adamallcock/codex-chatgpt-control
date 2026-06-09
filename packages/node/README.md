# codex-chatgpt-control

TypeScript runtime for Codex agents controlling visible ChatGPT web sessions through a compatible browser bridge.

Unofficial project: not affiliated with, endorsed by, or sponsored by OpenAI. This is not an OpenAI API wrapper and does not call hidden or private ChatGPT endpoints. Browser-required calls need a visible session and should fail with a clear machine-readable reason when the bridge is unavailable.

## Install

```bash
npm install codex-chatgpt-control
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
  response: { format: "markdown" }
});
```

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

## Validation

Run deterministic gates:

```bash
npm test
npm run build
npm run bundle
npm run bundle:backend
npm run contract:validate
npm run parity:fixtures
```
