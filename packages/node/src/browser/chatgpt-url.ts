export const CHATGPT_HOME = "https://chatgpt.com/";

const CHATGPT_HOSTS = new Set(["chatgpt.com", "www.chatgpt.com", "chat.openai.com"]);

/**
 * Accept only the visible ChatGPT HTTPS origins supported by this SDK.
 * URL credentials and non-default ports are rejected even when the hostname
 * itself is allowlisted.
 */
export function isChatGPTUrl(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && CHATGPT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function requireChatGPTUrl(value: string, label: string): string {
  if (!isChatGPTUrl(value)) {
    throw new Error(`${label} must use HTTPS on an allowlisted ChatGPT origin with the default port.`);
  }
  return value;
}

/** Public context for ChatGPT's signed attachment endpoint, never its token. */
export function chatGPTAttachmentContextUrl(value: string | undefined): string | undefined {
  if (!isChatGPTUrl(value)) return undefined;
  const url = new URL(value!);
  if (url.pathname !== "/backend-api/estuary/content") return undefined;
  return `${url.origin}${url.pathname}`;
}
