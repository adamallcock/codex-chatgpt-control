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
3. Verify no live reports, thread URLs, credentials, or local paths are committed.

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
