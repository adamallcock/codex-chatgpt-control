# Bridge Bootstrap

Use this reference when `globalThis.agent` is missing, when the Chrome bridge state is unclear, or when a user says an existing ChatGPT tab is already open.

In a true Codex Chrome-plugin run, initialize the Chrome plugin runtime before using the SDK:

```js
const { setupBrowserRuntime } = await import("/absolute/path/to/browser-client.mjs");
await setupBrowserRuntime({ globals: globalThis });
globalThis.browser = await agent.browsers.get("extension");
```

After bootstrap:

```js
JSON.stringify({
  hasAgent: !!globalThis.agent,
  hasBrowser: !!globalThis.browser
}, null, 2);
```

Only report `browser_bridge_unavailable` after bootstrap fails or the bridge remains unavailable.

Do not use `browser.tabs.list()` or `browser.tabs.selected()` alone to decide a user-open ChatGPT tab is unavailable. Those APIs can be sparse for user-open tabs. Prefer SDK `existingTab` options or lower-level `browser.user.openTabs()` and `browser.user.claimTab()` when exact user-open tab reuse matters.
