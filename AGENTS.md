# codex-chatgpt-control Agent Instructions

## Public Repo Boundary

- This is a public alpha SDK for user-directed workflows in visible ChatGPT web
  sessions. Keep all guidance safe for public contributors.
- Do not add private OpenAI account details, cookies, tokens, internal browser
  bridge state, unpublished package credentials, or private run transcripts to
  the repo.
- This project is unofficial. Do not phrase docs, package metadata, or examples
  as if the project is endorsed by OpenAI.

## Architecture

- The Node package is the runtime authority for browser control, backend
  commands, live-smoke orchestration, safety redaction, and contract fixtures.
- The Python package is a parity client over the same backend protocol. It
  should not diverge into a separate browser automation implementation.
- Shared behavior changes must update contracts, fixtures, docs, examples, and
  both language surfaces when applicable.

## Safety Model

- Keep the visible-session boundary: this is not a scraping framework, private
  ChatGPT API wrapper, background automation service, or bulk extraction tool.
- Live browser tests can touch a real user session. Run them only when the user
  asks for live validation or when the task clearly requires it.
- Redact prompts, responses, filenames, account identifiers, and local paths in
  reports unless the user explicitly wants a local private artifact.

## Local Commands

From the repository root:

```bash
npm run node:test
npm run node:build
npm run node:bundle
npm run node:contracts
npm run python:test
npm run python:compile
npm run release:check-names
```

For Node package work:

```bash
cd packages/node
npm test
npm run build
npm run bundle
npm run bundle:backend
npm run contract:validate
npm run parity:fixtures
npm run test:backend-conformance
```

For Python package work:

```bash
cd packages/python
python -m pip install -e ".[dev]"
python -m unittest discover -s tests
python -m compileall -q src examples
```

## Definition Of Done

- The narrow visible-session safety model is preserved.
- Node/Python parity has been checked for API, protocol, fixture, and docs
  changes.
- The smallest meaningful tests pass, and broader contract/parity gates pass
  for shared behavior changes.
- Any live-smoke blocker is reported as a blocker path, not papered over with
  cached or unrelated browser evidence.
