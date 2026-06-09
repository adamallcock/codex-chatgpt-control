---
title: Browser Bridge
date: 2026-06-06
type: reference
status: draft
---

# Browser Bridge

Browser-required operations need a compatible bridge that exposes a visible ChatGPT tab to the SDK runtime.

Ordinary shell runs are still useful. They validate the backend protocol and should produce structured `browser_bridge_unavailable` blockers for commands that require a real browser.

When using a Codex-hosted browser bridge, initialize the bridge in the host runtime, then pass that agent object to `createChatGPT({ agent })`. Keep bridge-hosted backend processes alive while Python clients call through relays; if the host call exits, browser operations can lose their execution context.

## Runtime Requirements

Deterministic tests and protocol checks need only local language runtimes:

- Node.js 20 or newer
- npm
- Python 3.10 or newer for the Python client

Real ChatGPT control additionally needs:

- Chrome with a signed-in visible ChatGPT web session
- a compatible Codex/browser bridge exposing `globalThis.agent`
- permission to operate or open a visible ChatGPT tab
- explicit user approval for prompts, files, downloads, and account-affecting actions

`globalThis.agent` is host-provided. The SDK does not create or fake a browser bridge from an ordinary shell.

## Host-Local Attachment Paths

Attachment paths must be absolute on the machine running the Node backend. On Linux/WSL backends, use paths such as `/home/you/file.pdf` or `/mnt/c/work/file.pdf`. On Windows backends, use fully qualified paths such as `C:\Users\you\file.pdf` or UNC paths such as `\\server\share\file.pdf`. The backend rejects ambiguous Windows forms and rejects Windows-looking paths when the backend host is POSIX.

## File Upload Permissions

File attachments require both permission gates:

1. Chrome extension gate: open `chrome://extensions`, select the Codex/browser bridge extension, open **Details**, and enable **Allow access to file URLs**.
2. Codex app gate: in Codex settings, allow Google Chrome uploads under **Computer Use > Google Chrome > Permissions > Uploads**.

If either gate is missing, upload workflows should return a structured permission blocker instead of retrying.
