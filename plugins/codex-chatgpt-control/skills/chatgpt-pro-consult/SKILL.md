---
name: chatgpt-pro-consult
description: Use when Codex should consult ChatGPT Pro through the user's logged-in visible ChatGPT web session for a second opinion, critique, synthesis, planning review, or model-to-model comparison using the codex-chatgpt-control plugin.
---

# ChatGPT Pro Consult

Use this skill when the user wants a focused ChatGPT Pro consultation, not general ChatGPT browser automation. Typical uses: ask Pro for a critical review, compare plans, synthesize approved context, review an implementation approach, or get a second opinion through the user's ChatGPT subscription.

This skill is a thin workflow over the `codex-chatgpt-control` plugin. Use the snippets below for ordinary consults, but switch to the full `codex-chatgpt-control` skill as soon as bridge bootstrap, tab reuse, file attach, send, wait, read, or selector diagnosis becomes the main issue.

## Guardrails

- This sends prompt and attachment content to ChatGPT web. Do not send secrets, credentials, private source material, financial details, legal evidence, medical details, or sensitive personal data unless the user clearly approved that disclosure.
- Use only visible ChatGPT web through the Codex/browser bridge. Do not replicate private ChatGPT network calls, read cookies, inspect localStorage/sessionStorage, or extract hidden auth headers.
- Make Pro selection explicit with `mode: { model: "Pro" }`. If the SDK cannot select Pro, stop and report the blocker and visible candidate labels.
- Prefer a fresh thread unless the user asked to continue a specific ChatGPT thread.
- Return Markdown by default. Use redacted reports by default; raw prompt/response content is opt-in only.
- Treat ChatGPT Pro output as another model's judgment, not verified truth. Verify current, legal, medical, financial, or high-stakes claims with primary sources.
- Keep each Codex tool call bounded. Submit the prompt under Pro first, then poll/read in chunks.

## Runtime Loader

Resolve relative paths from this `SKILL.md` directory. The plugin runtime loader lives at:

```text
../../runtime/import-chatgpt-control.mjs
```

From a bridge-enabled Codex Node runtime:

```js
const loaderUrl = new URL(
  "../../runtime/import-chatgpt-control.mjs",
  "file:///absolute/path/to/plugins/codex-chatgpt-control/skills/chatgpt-pro-consult/SKILL.md"
);
const { importChatGPTControl } = await import(`${loaderUrl.href}?t=${Date.now()}`);
const { createChatGPT } = await importChatGPTControl();

const chatgpt = createChatGPT({
  agent: globalThis.agent,
  reporting: { enabled: true, includeContent: false }
});
```

Do not import from an older manually installed skill runtime; the plugin-bundled runtime is the intended source.

## Quick Consult

```js
const TOOL_CALL_SAFE_WAIT = {
  timeoutMs: 90_000,
  stableMs: 2_000,
  pollMs: 750,
  mode: "deep_research"
};

const pro = chatgpt.agent({
  name: "chatgpt-pro-consultant",
  instructions: [
    "You are being consulted as ChatGPT Pro from a visible ChatGPT web session.",
    "Be critical, constructive, specific, and evidence-aware.",
    "Call out assumptions, risks, missing information, and concrete next steps.",
    "Return clear Markdown."
  ].join("\n"),
  defaults: {
    wait: false,
    read: false,
    report: { enabled: true, includeContent: false }
  }
});

const submitted = await chatgpt.runner.run(pro, {
  input: "Review this plan and recommend improvements:\n\n...",
  thread: { type: "new" },
  mode: { model: "Pro" },
  report: { enabled: true, includeContent: false }
});

const modeStep = submitted.steps?.find(step => step.id === "mode");
if (!submitted.ok || modeStep?.ok === false) {
  console.log(JSON.stringify({
    status: "blocked_before_submit_or_mode_unclean",
    thread: submitted.state?.thread ?? submitted.data?.thread,
    modeStep,
    interruptions: submitted.interruptions
  }, null, 2));
} else {
  const read = await chatgpt.messages.waitAndRead({
    ...TOOL_CALL_SAFE_WAIT,
    role: "assistant",
    format: "markdown"
  });

  if (!read.ok) {
    console.log(JSON.stringify({
      status: "submitted_wait_pending",
      message: "Prompt is already submitted. Do not resubmit; run messages.waitAndRead again against this same thread.",
      thread: submitted.state?.thread ?? submitted.data?.thread,
      modeStep,
      read
    }, null, 2));
  } else {
    console.log(read.data?.responseText ?? "");
  }
}
```

Before trusting the answer, inspect `modeStep`. A clean Pro consult must show the mode step succeeded and selected a Pro-labelled model or mode.

## With Approved Files

```js
const submitted = await chatgpt.runner.run(pro, {
  input: [
    {
      type: "input_text",
      text: "Critique these materials and return a prioritized action plan."
    },
    { type: "input_file", path: "/absolute/path/to/approved-plan.md" }
  ],
  thread: { type: "new" },
  mode: { model: "Pro" },
  report: { enabled: true, includeContent: false }
});
```

Use the same submit-then-poll pattern as Quick Consult. File-backed Pro answers can run longer than one Codex tool call.

## Continue A Known Thread

Use this only when the user gives a specific thread URL, conversation id, title, or search query:

```js
await chatgpt.runner.run(pro, {
  input: "Please continue from the latest answer and critique the updated plan.",
  thread: {
    type: "url",
    url: "https://chatgpt.com/c/..."
  },
  existingTab: true,
  mode: { model: "Pro" }
});
```

## Blockers

If a run fails, report the structured blocker instead of retrying blindly.

- `browser_bridge_unavailable`: bootstrap failed or the bridge remains unavailable.
- `login_required`: ask the user to log in to ChatGPT in Chrome.
- `selector_drift` during mode selection: report that Pro was not selectable and include candidates.
- `file_permission`: tell the user to enable both Codex Chrome upload permission and Chrome extension file URL access.
- `rate_limited`, `captcha`, or account-level confirmation: stop and ask the user to resolve it manually.

See `references/consult-patterns.md` for request framing and output handling.

## Output Contract

When reporting back to the user:

- Say that the answer is from ChatGPT Pro through visible ChatGPT web.
- Summarize the most useful findings; include the full Markdown if requested.
- Include blockers, warnings, thread URL, downloaded files, or redacted report path when present.
- Do not present ChatGPT Pro claims as verified facts unless independently verified.
