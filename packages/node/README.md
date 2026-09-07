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

## Transactional operation preview

Supported Chat, Work, Runner, and Responses workflows accept an optional
caller-owned canonical UUID `operationId`. Supplying it opts that invocation
into durable submit-once recovery and exact-turn collection; omitting it keeps
the compatibility path.

```ts
const result = await chatgpt.ask({
  operationId: "123e4567-e89b-42d3-a456-426614174000",
  prompt: "Summarize the visible thread.",
  thread: { type: "conversationId", conversationId: "caller-owned-conversation-id" },
  wait: false,
  read: false
});
```

The direct `chatgpt.operations` surface exposes `submit`, `collect`, `inspect`,
`control`, and SDK-composed `run`. Persist and reuse the fresh returned handle
after partial or uncertain results; never retry the same logical Send under a
new ID. `operations.inspect` is browser-free. Browser-touching calls fail
closed when bridge access, target evidence, or a required provider primitive
is unavailable. See
[Transactional browser operations](references/2026-08-16-transactional-operations.md)
for request schemas, concurrency, recovery, privacy, transport bounds, and the
stricter transactional artifact-provider capability matrix.

If the browser host lacks process identity, start `codex-chatgpt-control-journal`
in an ordinary Node terminal with `--state-root /absolute/private/state` and
`--directory /absolute/private/new-session`. Then configure
`operations: { journalService: { descriptorPath: "/absolute/private/new-session/connection.json" } }`
on the browser client. The explicit private-file connection keeps browser
control in the active host and durable journal authority in the Node process.
Keep the descriptor secret and reuse the same operation identity after any
uncertain write. See [the journal service runbook](references/2026-09-06-journal-service.md)
for startup, recovery and qualification. Without a configured service, an
unsupported local journal returns `journal_runtime_unavailable` before browser
work.

The private-file journal service supports macOS/Linux. On Windows it returns
`journal_rpc_unsupported_platform` before filesystem access; the existing local
Node journal path is unchanged.

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
