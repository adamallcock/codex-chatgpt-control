---
title: Release Process
date: 2026-06-06
type: runbook
status: draft
---

# Release Process

## Source Alpha

1. Keep the private repository as the source of truth and publish only from the
   generated public repository.
2. Run deterministic Node and Python parity gates.
3. Build and validate the Codex plugin runtime:

   ```bash
   npm run plugin:build
   npm run plugin:check
   npm run plugin:validate
   ```

4. Verify no live reports, thread URLs, credentials, or local paths are committed.

## Public Mirror Regeneration

The public repository is generated from the private source tree. Regenerate it
from the private repository and land changes through a public pull request so
contributors can review the public-facing history.

1. In the private repository, confirm source changes are merged and clean.
2. Rebuild plugin runtime bundles before export when runtime code changed:

   ```bash
   node tools/public-export/root/scripts/build-plugin-runtime.mjs --root .
   node tools/public-export/root/scripts/check-plugin-runtime.mjs --root .
   ```

3. Run the exporter check:

   ```bash
   # From the private repository root.
   node tools/public-export/export-public.mjs --check
   ```

4. Generate into a public branch, not public `main`:

   ```bash
   git switch -c codex/public-export-<topic>
   node /path/to/private/tools/public-export/export-public.mjs --write
   ```

5. Split the generated public diff into public-readable commits. Prefer
   feature groups such as runtime behavior, localization, diagnostics,
   contracts, docs, and plugin runtime bundles. Avoid one opaque `chore`
   commit when public contributors cannot see the private source commits.
6. Validate the public branch:

   ```bash
   # From the generated public checkout.
   npm run node:build
   npm run python:compile
   npm run node:contracts
   npm run plugin:validate
   npm run node:bundle
   npm run plugin:check
   ```

7. Open a public PR with a self-contained summary and merge with a normal merge
   commit when the split commit stack should remain visible.

## Codex Plugin Alpha

1. Confirm the marketplace file is present at `.agents/plugins/marketplace.json`.
2. Confirm the plugin manifest is present at `plugins/codex-chatgpt-control/.codex-plugin/plugin.json`.
3. Confirm the plugin exposes exactly three V1 skills:
   - `codex-chatgpt-control`
   - `chatgpt-delegate`
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

## Trusted Publishing

npm and PyPI releases are published from `.github/workflows/release.yml` using
GitHub Actions OIDC trusted publishing. Do not store npm or PyPI API tokens in
GitHub secrets for this workflow.

The registry-side trusted publisher configuration must match the public
repository exactly:

- Repository: `adamallcock/codex-chatgpt-control`
- Workflow filename: `release.yml`
- Environment: `release`
- npm package: `codex-chatgpt-control`
- PyPI project: `codex-chatgpt-control`

The `release` GitHub environment should require human approval. That keeps tag
creation reversible until the protected publish jobs start, while still making
the package upload itself reproducible and tokenless.

## Release Tag Flow

1. Merge the generated public PR after required public checks pass.
2. Confirm versions and registry availability on public `main`:

   ```bash
   npm run release:check-version
   npm run release:check-names
   ```

3. Create and push a `v*` tag that matches the Node package version:

   ```bash
   git tag v0.5.0-alpha.1
   git push origin v0.5.0-alpha.1
   ```

4. Approve the `release` environment deployment in GitHub Actions.
5. Let the workflow publish npm and PyPI independently. If one registry publish
   succeeds and the other fails, rerun only the failed job.
6. Verify the published packages:

   ```bash
   npm view codex-chatgpt-control version dist-tags --json
   python - <<'PY'
   import json, urllib.request
   with urllib.request.urlopen("https://pypi.org/pypi/codex-chatgpt-control/json", timeout=10) as r:
       data = json.load(r)
   print(data["info"]["version"])
   PY
   ```

## npm Alpha

1. Recheck registry state immediately before publishing:

   ```bash
   npm run release:check-version
   npm run release:check-names
   ```

2. Build and inspect the package allowlist:

   ```bash
   npm --prefix packages/node ci
   npm run node:build
   npm run node:bundle
   npm run release:check-node-pack
   ```

3. Publish through the release workflow with `--tag next`; do not publish local
   shells unless the trusted-publishing path is unavailable and the release
   owner explicitly approves a one-off fallback.

## PyPI Alpha

Best-practice backend story: keep the Node runtime as the authoritative browser backend and make Python a protocol client that launches or connects to an explicit sidecar command. For alpha, require a separately installed or locally built Node backend command. For beta, add a Python helper that discovers a trusted installed backend, such as the npm package binary or an explicitly configured command. Avoid silently embedding stale generated JavaScript in the wheel unless the export, versioning, and smoke tests prove the embedded backend and Python protocol are in lockstep.

1. Recheck registry state immediately before publishing:

   ```bash
   npm run release:check-version
   npm run release:check-names
   ```

2. Build wheel and sdist from `packages/python`.
3. Run `twine check`:

   ```bash
   python -m pip install --upgrade build twine
   rm -rf dist/python
   npm run release:build-python
   npm run release:check-python
   ```

4. Install the wheel in a fresh virtual environment.
5. Publish through the release workflow using PyPI trusted publishing.
