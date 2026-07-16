---
title: Chat and Work Migration
date: 2026-07-16
type: migration
status: draft
---

# Chat and Work Migration

Version 0.5 evolves `codex-chatgpt-control` from a flat Chat mode adapter into a
visible surface-control SDK for Chat and Work. The change is additive: package
coordinates, imports, existing backend commands, workflow fields, and the
legacy Pro-consult skill remain available.

## Product Boundary

Use this SDK for visible, user-directed ChatGPT web state:

- Chat conversations and reviews
- Work tasks, progress, steering, responses, files, and artifacts
- capability discovery and verified visible configuration
- structured blockers and redacted diagnostics

Use official Codex capabilities for local repository editing, terminal
execution, tests, branches, sandboxing, and deployment.

## New Surface Model

```ts
const surface = await chatgpt.experience.detect();
const capabilities = await chatgpt.configuration.inspect();
```

The detector returns `chat`, `work`, or `unknown` plus an observed selector
profile:

- `chat_legacy_v1`
- `chat_simplified_v1`
- `work_basic_v1`
- `work_advanced_v1`
- `unknown`

Profiles describe UI shape, not subscription tier or entitlement. Availability
may vary by account, managed workspace, locale, region, experiment, and rollout.
Callers should use returned capabilities and blockers instead of inferring
support from a model name.

## Configuration

New code should replace flat `mode` assumptions with strict configuration:

```ts
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

The SDK changes one visible axis at a time, reopens nested controls when needed,
and inspects the surface again. Strict application blocks when the final visible
state does not verify every requested value.

If a workflow or runner input supplies both `configuration` and legacy `mode`,
`configuration` takes precedence and the compatibility field is not executed.
Pass only one in new code.

For Chat:

```ts
await chatgpt.configuration.apply({
  experience: "chat",
  desired: { intelligence: "Pro" },
  strict: true
});
```

Visible labels are not guaranteed underlying model identifiers. Do not claim an
effective model solely from DOM text.

## Work Lifecycle

```ts
const started = await chatgpt.work.start({
  prompt: "Produce a decision-ready implementation brief.",
  newTask: true,
  wait: false,
  read: false
});
```

`newTask` defaults to true. If an existing task is loaded and the SDK cannot
verify a unique new-task control, it blocks rather than appending accidentally.

After submission:

```ts
await chatgpt.work.status({ includeArtifacts: true });
await chatgpt.work.wait({ responseContent: "metadata" });
await chatgpt.work.steer({ prompt: "Prioritize the risks.", wait: false });
await chatgpt.work.readLatest({ format: "markdown" });
await chatgpt.work.artifacts.listLatest({});
```

Partial or timeout results may mean the task is already running. Reuse the same
task reference and never resubmit blindly.

## Compatibility

These remain supported:

- npm/PyPI name `codex-chatgpt-control`
- Node import `createChatGPT`
- Python import `codex_chatgpt_control`
- all pre-0.5 backend commands
- runner/workflow `mode`
- `chatgpt.modes.set()` and `chatgpt.modes.get()`
- `chatgpt-pro-consult`

Legacy mode APIs preserve their historical warning-oriented behavior. New code
that requires a verified postcondition should use `configuration.apply` with
`strict: true`.

The preferred focused skill is now `chatgpt-delegate`.
`chatgpt-pro-consult` remains a functional alias for an explicitly requested
visible Chat Pro-setting consultation.

## Python

Python provides matching sync and async `experience`, `configuration`, and
`work` groups. Snake-case inputs such as `new_task`, `timeout_ms`, and
`include_artifacts` are converted to the shared camel-case wire shape. Known
nested SDK fields such as `model_version` and `conversation_id` are converted
recursively; unknown user-owned dictionary keys are preserved verbatim.

## Locales And Rollouts

The semantic command and fixture structure is locale-ready, but each newly
observed label still needs sanitized evidence and a locale contribution. An
unknown or incomplete profile should return a structured `selector_drift` or
unverified capability result. The SDK does not spoof regions, infer plans, or
silently fall back to an unrelated control.
