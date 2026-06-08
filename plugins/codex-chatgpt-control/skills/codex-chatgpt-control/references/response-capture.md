# Response Capture

Use Markdown for human-readable output and saved artifacts.

Response capture may come from clipboard copy or DOM reconstruction. Preserve SDK fields such as:

- `source`
- `fidelity`
- `warnings`
- `branch`
- `actions`
- `thoughtDurationText`
- `sourcesAvailable`

Use `normalized_text` only for compact smoke assertions, polling checks, or simple exact-string tests.

Reports should be redacted by default:

```js
report: { enabled: true, includeContent: false }
```

Raw prompt or response content is opt-in only. Never persist credentials, auth codes, account identifiers, private source material, or sensitive personal data in reports.
