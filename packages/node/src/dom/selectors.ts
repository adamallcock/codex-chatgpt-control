import type { LocatorLike, PageLike } from "../types.js";

export const cssSelectors = {
  assistantMessages: "[data-message-author-role='assistant']",
  userMessages: "[data-message-author-role='user']",
  roleMessages: "[data-message-author-role]",
  conversationTurns: "[data-testid^='conversation-turn']",
  hiddenFileInputs: "input[type='file']",
  downloadControls: [
    "main [data-message-author-role='assistant'] a[download]",
    "main [data-message-author-role='assistant'] a[href*='/backend-api/files/']",
    "main [data-message-author-role='assistant'] button[aria-label*='Download']",
    "main [data-message-author-role='assistant'] a[aria-label*='Download']",
    "main a[download]",
    "main a[href*='/backend-api/files/']"
  ].join(", "),
  generatedArtifactDownloadControls: [
    "main figure button[aria-label*='Download' i]",
    "main figure a[aria-label*='Download' i]",
    "main [data-testid*='image' i] button[aria-label*='Download' i]",
    "main [data-testid*='image' i] a[aria-label*='Download' i]",
    "main [aria-label*='image' i] button[aria-label*='Download' i]",
    "main [aria-label*='image' i] a[aria-label*='Download' i]",
    "main button[aria-label='Download image' i]",
    "main a[aria-label='Download image' i]",
    "main a[download][href^='blob:']",
    "main a[download][href^='data:image/']"
  ].join(", ")
} as const;

export function composerTextbox(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "[contenteditable='true'], textarea");
  }
  return page.getByRole("textbox", { name: "Chat with ChatGPT" });
}

export function sendButton(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button[aria-label*='Send']");
  }
  return page.getByRole("button", { name: "Send prompt" });
}

export function searchChatsButton(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button");
  }
  return page.getByRole("button", { name: "Search chats" });
}

export function searchChatsInput(page: PageLike): LocatorLike {
  if (typeof page.getByPlaceholder === "function") {
    return page.getByPlaceholder("Search chats...");
  }
  return requiredLocator(page, "input[placeholder*='Search chats']");
}

export function newChatButton(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "a[href='/'], button");
  }
  return page.getByRole("button", { name: "New chat" });
}

export function addFilesButton(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button[aria-label*='Add']");
  }
  return page.getByRole("button", { name: "Add files and more" });
}

export function copyResponseButtons(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button[aria-label*='Copy response']");
  }
  return page.getByRole("button", { name: "Copy response" });
}

export function assistantMessageNodes(page: PageLike): LocatorLike {
  return requiredLocator(page, cssSelectors.assistantMessages);
}

export function userMessageNodes(page: PageLike): LocatorLike {
  return requiredLocator(page, cssSelectors.userMessages);
}

export function roleMessageNodes(page: PageLike): LocatorLike {
  return requiredLocator(page, cssSelectors.roleMessages);
}

export function requiredLocator(page: PageLike, selector: string): LocatorLike {
  if (typeof page.locator !== "function") {
    throw new Error(`Page does not support locator("${selector}")`);
  }
  return page.locator(selector);
}
