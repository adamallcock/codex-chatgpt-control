# Contributing

Contributions should preserve the narrow scope: Codex agents controlling visible ChatGPT web sessions through explicit browser-bridge operations.

> **This repository is a generated mirror.** `docs/`, `packages/`, `plugins/`, `scripts/`
> and `skills/` are rebuilt in full from a private source repository on every release, so a
> pull request touching those paths cannot be merged here — the next export would overwrite
> it. Please open an issue describing the change instead; a patch or diff in the issue is
> very welcome, and fixes are applied upstream and ship in the next release.

Before opening a PR:

1. Run the Node deterministic gates in `packages/node`.
2. If Python contracts or models changed, run the Python parity gates in `packages/python`.
3. Keep examples synthetic and public-safe.
4. Do not commit live-smoke reports, browser state, credentials, or real ChatGPT thread URLs.

Design changes should update the relevant file under `docs/` or `packages/node/references/` so behavior does not live only in issue comments.
