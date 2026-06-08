import { pathToFileURL } from "node:url";

export async function importChatGPTControl({ cacheBust = true } = {}) {
  const runtimeUrl = new URL("./node/codex-chatgpt-control.bundle.mjs", import.meta.url);
  const href = cacheBust
    ? `${runtimeUrl.href}?t=${Date.now()}`
    : runtimeUrl.href;
  return import(href);
}

export function backendBundleUrl() {
  return pathToFileURL(new URL("./node/codex-chatgpt-control-backend.mjs", import.meta.url).pathname).href;
}
