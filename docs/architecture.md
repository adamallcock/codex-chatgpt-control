---
title: Architecture
date: 2026-06-06
type: reference
status: draft
---

# Architecture

`codex-chatgpt-control` is a visible Chat/Work surface SDK, not an API wrapper
or a replacement for official Codex.

```text
Agent -> SDK runner -> semantic Chat/Work controls -> browser bridge -> visible chatgpt.com session
```

The Node package owns browser automation, DOM interpretation, response capture, redaction, contract fixtures, and the local backend server. The Python package talks to that backend through a versioned protocol so Python can share runner semantics without duplicating browser-control logic.

The public contract lives under `packages/node/contracts/v1`. Tests in both languages validate that fixtures and model shapes stay aligned.

The semantic layer detects `chat`, `work`, or `unknown` and reports an observed
selector profile. Chat and Work configuration is represented as capability
axes rather than one flat model list. Strict mutations are verified by reading
the visible postcondition after selection.

Work execution is intentionally split into start, status, wait, steer, read,
and artifact operations. This preserves task identity and prevents an
ambiguous timeout from causing a duplicate submission.
