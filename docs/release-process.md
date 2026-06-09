---
title: Release Process
date: 2026-06-06
type: runbook
status: draft
---

# Release Process

## Source Alpha

1. Keep the repository public and packages unpublished.
2. Run deterministic Node and Python parity gates.
3. Build and validate the Codex plugin runtime:

   ```bash
   npm run plugin:build
   npm run plugin:check
   npm run plugin:validate
   ```

4. Verify no live reports, thread URLs, credentials, or local paths are committed.

## Codex Plugin Alpha

1. Confirm the marketplace file is present at `.agents/plugins/marketplace.json`.
2. Confirm the plugin manifest is present at `plugins/codex-chatgpt-control/.codex-plugin/plugin.json`.
3. Confirm the plugin exposes exactly two V1 skills:
   - `codex-chatgpt-control`
   - `chatgpt-pro-consult`
4. Install locally from the checkout:

   ```bash
   codex plugin marketplace add .
   codex plugin add codex-chatgpt-control@codex-chatgpt-control
   ```

   If the marketplace already exists under a different local name, use
   `codex plugin marketplace list` and reinstall from that configured name.

5. Start a new Codex thread and verify the plugin skills are discoverable.
6. In an ordinary shell, browser-required commands should return a structured
   `browser_bridge_unavailable` blocker rather than faking browser access.
7. Run live ChatGPT smoke tests only with explicit approval and non-sensitive
   prompts.

## npm Alpha

1. Recheck registry state immediately before publishing:

   ```bash
   npm run release:check-names
   ```

2. Remove `"private": true` from `packages/node/package.json`.
3. Run `npm pack --dry-run --json` and inspect the allowlist.
4. Install the packed tarball in a fresh temp project.
5. Publish with an alpha tag only after trusted publishing or login is ready.

## PyPI Alpha

Best-practice backend story: keep the Node runtime as the authoritative browser backend and make Python a protocol client that launches or connects to an explicit sidecar command. For alpha, require a separately installed or locally built Node backend command. For beta, add a Python helper that discovers a trusted installed backend, such as the npm package binary or an explicitly configured command. Avoid silently embedding stale generated JavaScript in the wheel unless the export, versioning, and smoke tests prove the embedded backend and Python protocol are in lockstep.

1. Recheck registry state immediately before publishing:

   ```bash
   npm run release:check-names
   ```

2. Build wheel and sdist from `packages/python`.
3. Run `twine check`.
4. Install the wheel in a fresh virtual environment.
5. Publish `0.1.0a1` only after the backend distribution story is documented and tested.
