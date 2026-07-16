# Agents Runner

`ChatGPTAgent` is a browser-control task profile for operating visible ChatGPT web. It is not an OpenAI API Agent, not a model instance, and not a hidden system-prompt container.

`instructions` are visible by default through `instructionsMode: "visible_prefix"`.

Use:

```ts
const chatgpt = createChatGPT({ agent: globalThis.agent });
const reviewer = chatgpt.agent({ name: "reviewer", instructions: "Review deeply." });
const plan = chatgpt.runner.plan(reviewer, {
  input: "Review this design.",
  thread: { type: "new" },
  experience: "chat"
});
const result = await chatgpt.runner.run(reviewer, {
  input: "Review this design.",
  thread: { type: "new" },
  experience: "chat",
  configuration: { intelligence: "Pro" }
});
```

`instructionsMode` controls how instructions are exposed to visible ChatGPT:

- `visible_prefix`: include instructions in the same submitted user message.
- `visible_setup_message`: submit instructions as a separate visible setup turn before the user request.
- `metadata_only`: keep instructions local; they are not sent to ChatGPT.

`runner.run()` returns a `ChatGPTRunResult` with `output_text`, `finalOutput`, `output`, `interruptions`, and `state`. Browser-control blockers are surfaced as resumable interruptions when the underlying command can be retried after user approval, login, or permission repair.

`experience` and `configuration` are visible product preferences. When present,
the plan emits `experience.open` and strict `configuration.apply` steps before
the prompt. Successful results expose `experience.opened` and
`configuration.applied` milestone items. The legacy `mode` input remains
supported, but new callers should use the surface-aware fields. If both are
present, `configuration` takes precedence and the legacy `mode` request is not
executed.

For milestone streaming, call `chatgpt.runner.run(agent, input, { stream: true })` and iterate events before awaiting `stream.completed`. This is milestone streaming only, not token-delta streaming.

Do not pass API-only model controls such as `temperature`, `logprobs`, `seed`, or hidden system instructions.
