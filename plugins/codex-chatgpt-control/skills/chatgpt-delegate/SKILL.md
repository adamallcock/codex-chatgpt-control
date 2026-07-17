---
name: chatgpt-delegate
description: Use when Codex should delegate a visible, user-directed task to ChatGPT Chat or Work, including configuration discovery, long-running Work progress, steering, response capture, files, and artifacts.
---

# ChatGPT Delegate

Use this skill for outcome-oriented delegation to the visible ChatGPT product. Choose Chat for a conversational answer or review. Choose Work for a longer task with progress, steering, files, or deliverable artifacts. Use the official Codex SDK or CLI—not this skill—for repository editing, terminal execution, sandboxing, and code deployment.

This is a workflow over the `codex-chatgpt-control` plugin. It operates visible UI only and must not call private ChatGPT endpoints, inspect credentials or browser storage, bypass login or confirmation, or submit sensitive material without the user's approval.

## Runtime Loader

Resolve relative paths from this `SKILL.md`. Load the plugin-bundled runtime:

```js
const loaderUrl = new URL(
  "../../runtime/import-chatgpt-control.mjs",
  "file:///absolute/path/to/plugins/codex-chatgpt-control/skills/chatgpt-delegate/SKILL.md"
);
const { importChatGPTControl } = await import(`${loaderUrl.href}?t=${Date.now()}`);
const { createChatGPT } = await importChatGPTControl();

const chatgpt = createChatGPT({
  agent: globalThis.agent,
  reporting: { enabled: true, includeContent: false }
});
```

If `globalThis.agent` is absent, use the bridge-bootstrap instructions in the broad `codex-chatgpt-control` skill. An ordinary-shell `browser_bridge_unavailable` result is expected and should be reported, not worked around.

## Choose The Experience

- `chat`: reviews, questions, synthesis, brainstorming, search-oriented answers, or continuing an existing conversation.
- `work`: longer research or production tasks that benefit from progress checks, steering, files, or artifacts.
- official Codex: local code changes, commands, tests, branches, deployments, or repository-native agents.

Do not choose a surface solely from a model name. Availability varies by account, workspace, locale, and rollout. Inspect the visible capability graph and apply only controls that are actually present.

When the user requests Chat or Work, call `experience.open` for that surface
before inspecting configuration or submitting. Do not assume the currently
visible pane is the requested one. The SDK handles the current Chat/Work radio
selector and returning from an active Work task to the home selector, while
retaining compatibility fallbacks for older UI shapes.

```js
const detected = await chatgpt.experience.detect();
const configuration = await chatgpt.configuration.inspect({
  experience: detected.data?.experience === "unknown"
    ? undefined
    : detected.data?.experience
});
```

## Chat Delegation

Use the runner for a visible Chat review:

```js
const reviewer = chatgpt.agent({
  name: "chatgpt-reviewer",
  instructions: [
    "Be critical, constructive, specific, and evidence-aware.",
    "Call out assumptions, risks, and concrete next steps.",
    "Return clear Markdown."
  ].join("\n"),
  defaults: {
    experience: "chat",
    wait: false,
    read: false,
    report: { enabled: true, includeContent: false }
  }
});

const submitted = await chatgpt.runner.run(reviewer, {
  input: "Review this plan:\n\n...",
  thread: { type: "new" },
  experience: "chat",
  configuration: { intelligence: "Pro" }
});
```

The configuration is a visible preference, not a guaranteed underlying model identifier. Inspect the `configuration` sequence step and require `verified: true` before claiming that the requested setting was active. If the account does not expose that option, report the structured blocker and visible candidates.

For long answers, submit once and poll the same thread:

```js
const progress = await chatgpt.messages.status({ maxPreviewChars: 500 });
const read = await chatgpt.messages.waitAndRead({
  timeoutMs: 25_000,
  stableMs: 1_500,
  pollMs: 750,
  role: "assistant",
  format: "markdown"
});
```

`partial`, `completionState: "generating"`, or `generationActive: true` means the prompt may already be running. Never resubmit it blindly.

## Work Delegation

Start a fresh Work task with explicit, strictly verified configuration:

```js
const started = await chatgpt.work.start({
  prompt: "Research the options and produce a decision-ready implementation brief.",
  newTask: true,
  configuration: {
    model: "GPT-5.6 Sol",
    effort: "High",
    speed: "Standard"
  },
  wait: false,
  read: false
});
```

`newTask` defaults to `true`. If an existing task is loaded and no unique new-task control can be verified, the SDK blocks rather than appending the prompt accidentally. Pass `newTask: false` only when intentionally continuing the currently visible Work task.

Poll without resubmission:

```js
const status = await chatgpt.work.status({ includeArtifacts: true });
const waited = await chatgpt.work.wait({
  timeoutMs: 25_000,
  stableMs: 1_500,
  pollMs: 750,
  responseContent: "metadata"
});
```

Steer the same task:

```js
await chatgpt.work.steer({
  prompt: "Prioritize the migration risks and add a two-week execution sequence.",
  wait: false,
  read: false
});
```

Read the latest response and enumerate artifacts:

```js
const latest = await chatgpt.work.readLatest({ format: "markdown" });
const artifacts = await chatgpt.work.artifacts.listLatest({});
```

Use `chatgpt.work.artifacts.wait(...)` and `downloadLatest(...)` for visible downloadable deliverables. Attach only user-approved absolute host-local paths.

## Compatibility

The legacy `mode` runner input, `chatgpt.modes.set/get`, and `chatgpt-pro-consult` skill still work for existing callers. New work should use `experience` plus `configuration`, because Chat and Work expose different nested axes and strict postcondition verification.

## Blockers And Reporting

Stop and report:

- `browser_bridge_unavailable`
- `login_required`
- `captcha`
- `rate_limit`
- `permission`
- `needs_confirmation`
- `selector_drift`

Preserve the SDK's real `ok`, `status`, `warnings`, `blocker`, `error`, `steps`, and task/thread reference. Do not wrap a failed result as success. Reports remain redacted by default.

Treat delegated output as another model's judgment, not verified truth. Verify current or high-stakes claims with primary sources.
