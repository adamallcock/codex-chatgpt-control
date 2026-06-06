# codex-chatgpt-control

[![Node CI](https://github.com/adamallcock/codex-chatgpt-control/actions/workflows/node.yml/badge.svg)](https://github.com/adamallcock/codex-chatgpt-control/actions/workflows/node.yml)
[![Parity CI](https://github.com/adamallcock/codex-chatgpt-control/actions/workflows/parity.yml/badge.svg)](https://github.com/adamallcock/codex-chatgpt-control/actions/workflows/parity.yml)

Unofficial alpha SDK facade for Codex agents that need to run user-directed workflows in a visible ChatGPT web session.

- **Visible-session only:** drives chatgpt.com through a compatible Codex/browser bridge and user-visible UI controls, including file uploads and visible downloads where available.
- **Workflow primitives, not a ChatGPT API:** supports prompts, thread workflows, response capture, structured blockers, and redacted run reports without private endpoint access.
- **Narrow by design:** built for Codex -> browser -> chatgpt.com workflows; it is not a generic browser automation framework, scraping tool, OpenAI API wrapper, or official OpenAI project.

This project is not affiliated with, endorsed by, or sponsored by OpenAI.

## Status

This repository is public-source alpha preparation. npm and PyPI packages are not published yet. The Node package is the runtime authority; the Python package is a parity client over the same backend protocol.

## Repository Layout

```text
packages/node/      TypeScript runtime, contracts, backend server, tests
packages/python/    Python parity client, examples, tests
docs/               Public architecture, safety, bridge, and release notes
.github/workflows/  Deterministic CI gates
```

## Development

Run deterministic Node gates:

```bash
cd packages/node
npm ci
npm test
npm run build
npm run bundle
npm run bundle:backend
npm run contract:validate
npm run parity:fixtures
```

Run deterministic Python gates after the backend bundle exists:

```bash
cd packages/python
python -m pip install -e .[dev]
python -m unittest discover -s tests
python -m compileall -q src examples
python -m pyright --pythonpath "$(which python)" src tests
python scripts/live_smoke.py --mode ordinary-shell
```

Ordinary-shell smoke checks are expected to return structured browser-bridge blockers for browser-required actions. A real ChatGPT run requires a compatible visible browser session and bridge.

## Packages

- npm target: `codex-chatgpt-control`
- PyPI target: `codex-chatgpt-control`
- Python import: `codex_chatgpt_control`

The package manifests intentionally stay alpha-gated. Remove npm `"private": true` only when the package allowlist, install smoke, and trusted publisher setup are complete.

## Safety

Do not use this project to bypass login, access hidden endpoints, scrape private data, or automate activity outside a user-directed visible session. See [docs/safety.md](docs/safety.md) and [SECURITY.md](SECURITY.md).
