---
title: Plugin Privacy
date: 2026-06-08
type: reference
status: draft
---

# Plugin Privacy

`codex-chatgpt-control` is designed for visible, user-directed ChatGPT web workflows from Codex.

The plugin does not provide hidden ChatGPT access, does not call private ChatGPT endpoints, and does not read cookies, localStorage, sessionStorage, hidden auth headers, or tokens. It operates through visible browser controls exposed by a compatible Codex/browser bridge.

Prompt text, approved attachments, and visible browser content may be sent to ChatGPT web when the user asks Codex to run a ChatGPT workflow. Do not use the plugin with secrets, credentials, private source material, account identifiers, legal evidence, medical details, financial details, or sensitive personal data unless the user has clearly approved that disclosure.

Local run reports are redacted by default. Raw prompt and response content is opt-in only.

The plugin does not include a hosted backend service. Browser access, ChatGPT login state, and product permissions remain controlled by the user's local Codex, Chrome, and ChatGPT setup.
