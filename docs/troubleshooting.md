---
title: Troubleshooting
date: 2026-06-06
type: reference
status: draft
---

# Troubleshooting

## `browser_bridge_unavailable`

Expected from ordinary shells. Use it as a diagnostic that the command failed safely before touching browser state.

For a real browser run, verify:

- Chrome is open and signed in to ChatGPT.
- The host runtime exposes `globalThis.agent`.
- The browser bridge can claim or open a visible ChatGPT tab.

## Python Backend Bundle Missing

Run from `packages/node`:

```bash
npm ci
npm run bundle:backend
```

Then rerun the Python smoke from `packages/python`.

## Selector Drift

Treat selector drift as a product-change blocker. Capture the smallest public-safe reproduction and update selectors/tests together.

## Doctor Preflight

Run `doctor({ check: ["bridge", "login", "upload"] })` before long workflows when browser state or permissions are uncertain. Use opt-in checks such as `existing_tab`, `artifacts`, `localization`, and `reports` before targeted workflows. The `localization` check verifies registry readiness, not full localized selector coverage. The `file_preflight` check is currently a scaffold and does not replace upload/file validation.

## Attachment Path Rejected

If a Windows-looking path is rejected on macOS/Linux, do not retry with the same string. Convert it to the backend host's real path, for example `/home/you/file.pdf` for a Linux/WSL backend. The backend rejects ambiguous Windows forms such as `C:Users\you\file.pdf`, root-relative paths like `\tmp\file.pdf`, and empty or relative paths.

## File Upload Blocked

Check both permission gates:

1. Chrome `chrome://extensions` > Codex/browser bridge extension > **Details** > **Allow access to file URLs**.
2. Codex settings > **Computer Use > Google Chrome > Permissions > Uploads**.

The SDK should report a structured permission blocker when either gate is missing. Do not retry uploads repeatedly without changing the permission state.
