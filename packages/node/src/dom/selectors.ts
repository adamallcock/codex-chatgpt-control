import type { LocatorLike, PageLike } from "../types.js";
import { anyLabelPattern, localeLabels } from "./locale-labels.js";

// Language-sensitive label tokens are sourced from the locale registry; the structural
// clauses (download attributes, file-backend hrefs, blob/data sources) are language-agnostic
// and stay literal. For a single English candidate the generated selectors are identical to
// the previous hand-written ones.
const downloadControlClauses = [
  "main [data-message-author-role='assistant'] a[download]",
  "main [data-message-author-role='assistant'] a[href*='/backend-api/files/']",
  ...localeLabels.download.flatMap(label => [
    `main [data-message-author-role='assistant'] button[aria-label*='${label}']`,
    `main [data-message-author-role='assistant'] a[aria-label*='${label}']`
  ]),
  "main a[download]",
  "main a[href*='/backend-api/files/']"
];

const generatedArtifactDownloadClauses = [
  ...localeLabels.download.flatMap(label => [
    `main figure button[aria-label*='${label}' i]`,
    `main figure a[aria-label*='${label}' i]`
  ]),
  ...localeLabels.imageContainerHint.flatMap(hint =>
    localeLabels.download.flatMap(label => [
      `main [data-testid*='${hint}' i] button[aria-label*='${label}' i]`,
      `main [data-testid*='${hint}' i] a[aria-label*='${label}' i]`,
      `main [aria-label*='${hint}' i] button[aria-label*='${label}' i]`,
      `main [aria-label*='${hint}' i] a[aria-label*='${label}' i]`
    ])
  ),
  ...localeLabels.downloadImage.flatMap(label => [
    `main button[aria-label='${label}' i]`,
    `main a[aria-label='${label}' i]`
  ]),
  "main a[download][href^='blob:']",
  "main a[download][href^='data:image/']"
];

export const cssSelectors = {
  assistantMessages: "[data-message-author-role='assistant']",
  userMessages: "[data-message-author-role='user']",
  roleMessages: "[data-message-author-role]",
  conversationTurns: "[data-testid^='conversation-turn']",
  hiddenFileInputs: "input[type='file']",
  downloadControls: downloadControlClauses.join(", "),
  generatedArtifactDownloadControls: generatedArtifactDownloadClauses.join(", ")
} as const;

export function composerTextbox(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "[contenteditable='true'], textarea");
  }
  return page.getByRole("textbox", { name: anyLabelPattern(localeLabels.composerTextbox) });
}

export function sendButton(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button[aria-label*='Send']");
  }
  return page.getByRole("button", { name: anyLabelPattern(localeLabels.sendButton) });
}

export function searchChatsButton(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button");
  }
  return page.getByRole("button", { name: anyLabelPattern(localeLabels.searchChatsButton) });
}

export function searchChatsInput(page: PageLike): LocatorLike {
  if (typeof page.getByPlaceholder === "function") {
    return page.getByPlaceholder(anyLabelPattern(localeLabels.searchChatsPlaceholder));
  }
  return requiredLocator(page, "input[placeholder*='Search chats']");
}

export function newChatButton(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "a[href='/'], button");
  }
  return page.getByRole("button", { name: anyLabelPattern(localeLabels.newChat) });
}

export function addFilesButton(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button[aria-label*='Add']");
  }
  return page.getByRole("button", { name: anyLabelPattern(localeLabels.addFilesButton) });
}

export function copyResponseButtons(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button[aria-label*='Copy response']");
  }
  return page.getByRole("button", { name: anyLabelPattern(localeLabels.copyResponse) });
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
