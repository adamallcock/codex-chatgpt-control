# codex-chatgpt-control

TypeScript runtime for Codex agents controlling visible ChatGPT web sessions through a compatible browser bridge.

Unofficial project: not affiliated with, endorsed by, or sponsored by OpenAI. This is not an OpenAI API wrapper and does not call hidden or private ChatGPT endpoints. Browser-required calls need a visible session and should return structured blockers when the bridge is unavailable.

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
