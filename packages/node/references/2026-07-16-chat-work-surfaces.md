---
title: Chat and Work Surfaces
date: 2026-07-16
type: reference
status: draft
---

# Chat and Work Surfaces

The SDK models visible ChatGPT as capabilities discovered from the active
composer, controls, and URL—not as one flat model picker.

## Experiences And Profiles

Experiences:

- `chat`
- `work`
- `unknown`

Observed selector profiles:

- `chat_legacy_v1`
- `chat_simplified_v1`
- `work_basic_v1`
- `work_advanced_v1`
- `unknown`

Profiles describe UI shape. They must not be presented as subscription plans,
entitlements, regions, or guaranteed underlying models. Sanitized fixtures
store observed date, locale, provenance, scoped surface evidence, visible
configuration, and expected semantic output without conversation content.

## Configuration

Chat may expose intelligence and nested model/version controls. Work exposes
model, effort, and speed axes. Inspection reports available axes, active values,
visible options, selector profile, and evidence.

Strict application:

1. detects or opens the requested experience;
2. inspects the current state;
3. changes only requested axes;
4. reopens nested controls as required;
5. inspects again;
6. blocks if every requested value is not visibly verified.

Legacy `modes.set/get` and runner `mode` inputs remain supported. They preserve
their pre-0.5 warning-oriented behavior. New code requiring a verified
postcondition should use `configuration.apply({ strict: true })`.

## Work Lifecycle

`work.start` defaults to `newTask: true`. If messages are already loaded and a
unique new-task control cannot be verified, it blocks rather than submitting
into the current task. `newTask: false` is an explicit request to continue the
currently visible task.

Submission uses matching-turn recovery. A no-op send click may be retried only
while the prompt remains in the composer and no matching user turn exists.
After a partial or timeout result, callers must preserve the task/thread
identity and use:

- `work.status`
- `work.wait`
- `work.steer`
- `work.readLatest`
- `work.artifacts.*`

The original prompt must not be blindly resubmitted.

## Locale And Rollout Policy

Shared semantic types and profile fixtures make locale and rollout support
incremental. New labels require sanitized evidence plus locale-registry and
fixture updates. Unknown or absent controls return structured capability or
selector-drift results.

Use `npm run capture:surface-profile -- --id <normalized-id>` against an
already-open authorized tab to create a local `unverified` draft. The capture
is read-only with respect to configuration, strips conversation identity and
content, and requires explicit normalized metadata before a fixture can be
promoted to `current` or `compatibility`.

The SDK does not spoof regions, guess account plans, infer effective models from
one label, or claim support for a native desktop surface from web fixtures.
