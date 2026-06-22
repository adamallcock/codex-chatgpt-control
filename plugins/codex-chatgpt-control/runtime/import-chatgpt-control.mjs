import { pathToFileURL } from "node:url";

function installNoiseFilter() {
  if (globalThis.__codexChatGPTControlNoiseFilterInstalled) return;
  globalThis.__codexChatGPTControlNoiseFilterInstalled = true;
  const originalWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const text = args.map((arg) => String(arg)).join(" ");
    if (text.includes("[Statsig]") && text.includes("making requests too frequently")) return;
    originalWarn(...args);
  };
}

export async function importChatGPTControl({ cacheBust = true } = {}) {
  installNoiseFilter();
  const runtimeUrl = new URL("./node/codex-chatgpt-control.bundle.mjs", import.meta.url);
  const href = cacheBust
    ? `${runtimeUrl.href}?t=${Date.now()}`
    : runtimeUrl.href;
  return import(href);
}

export function backendBundleUrl() {
  return pathToFileURL(new URL("./node/codex-chatgpt-control-backend.mjs", import.meta.url).pathname).href;
}
