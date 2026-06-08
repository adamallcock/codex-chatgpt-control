# File Uploads

Attach only files the user has approved sending to ChatGPT web.

File workflows require two independent permission gates:

1. Chrome extension gate: `chrome://extensions` > Codex/browser bridge extension > Details > `Allow access to file URLs`.
2. Codex app gate: Codex settings > `Computer Use > Google Chrome > Permissions > Uploads`.

If either gate is missing, stop and report the blocker. Do not repeatedly retry the same attach command.

Use redacted reports by default:

```js
await chatgpt.askWithFiles({
  thread: { type: "new" },
  files: ["/absolute/path/to/approved-file.pdf"],
  prompt: "Review this file and summarize key risks.",
  wait: true,
  read: { format: "markdown" },
  report: { enabled: true, includeContent: false }
});
```

For long file-backed answers, submit first and then poll/read in bounded chunks rather than keeping one tool call open indefinitely.
