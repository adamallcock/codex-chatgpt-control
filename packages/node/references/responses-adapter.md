# Responses Adapter

`chatgpt.responses.create()` is a narrow convenience wrapper around visible ChatGPT browser control. It returns a Responses-shaped object with `object: "chatgpt.browser.response"`, but it is not the OpenAI Responses API and does not support hidden model controls.

Accepted fields:

- `input`
- `thread`
- `existingTab`
- `preferExistingTab`
- `experience`
- `configuration`
- `attachments`
- `mode` (legacy compatibility)
- `tools`
- `text.format`
- `stream: false`
- `report`
- `instructions` only with `instructionsMode: "visible_prefix"`

Rejected API-only fields return `status: "unsupported"` before any prompt is submitted. The response includes `browser_control.unsupported[]` with `path`, `reason`, and `alternative`.

```ts
const response = await chatgpt.responses.create({
  input: "Summarize the latest plan.",
  thread: { type: "conversationId", conversationId: "abc-123" },
  experience: "chat",
  configuration: { intelligence: "High" },
  text: { format: "markdown" },
  stream: false
});
```

`experience` and `configuration` represent visible product controls, not API
model selection. Configuration is strict through the runner plan and must
verify the visible postcondition. Existing callers may continue to pass
`mode`; new callers should prefer the surface-aware fields.

Use `chatgpt.runner.run()` for lower-level browser-control workflows, multi-step command planning, attachments, downloads, reports, and explicit interruption handling.
