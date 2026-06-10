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
  if (typeof page.locator !== "function" && typeof page.getByRole === "function") {
    return page.getByRole("textbox", { name: anyLabelPattern(localeLabels.composerTextbox) });
  }
  if (typeof page.getByRole === "function") {
    return page.getByRole("textbox", { name: anyLabelPattern(localeLabels.composerTextbox) });
  }
  return requiredLocator(page, "#prompt-textarea, textarea, [contenteditable='true'], [role='textbox']");
}

export function sendButton(page: PageLike): LocatorLike {
  const selector = [
    "button[data-testid='send-button']",
    "button[aria-label='Send prompt']",
    "button[aria-label='Send message']",
    "button[aria-label='送信']",
    "button[aria-label='メッセージを送信する']"
  ].join(", ");
  const role = typeof page.getByRole === "function"
    ? page.getByRole("button", { name: anyLabelPattern(localeLabels.sendButton) })
    : undefined;
  if (typeof page.locator !== "function") {
    if (role !== undefined) return role;
    return requiredLocator(page, selector);
  }
  if (typeof page.getByRole === "function") {
    return page.getByRole("button", { name: anyLabelPattern(localeLabels.sendButton) });
  }
  return requiredLocator(page, selector);
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
  const selector = [
    "a[href='/']",
    "button[aria-label='New chat']",
    "a[aria-label='New chat']",
    "button[aria-label='新しいチャット']",
    "a[aria-label='新しいチャット']"
  ].join(", ");
  const role = typeof page.getByRole === "function"
    ? page.getByRole("button", { name: anyLabelPattern(localeLabels.newChat) })
    : undefined;
  if (typeof page.locator !== "function") {
    if (role !== undefined) return role;
    return requiredLocator(page, selector);
  }
  if (typeof page.getByRole === "function") {
    return page.getByRole("button", { name: anyLabelPattern(localeLabels.newChat) });
  }
  return requiredLocator(page, selector);
}

export function addFilesButton(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button[aria-label*='Add']");
  }
  return page.getByRole("button", { name: anyLabelPattern(localeLabels.addFilesButton) });
}

export function copyResponseButtons(page: PageLike): LocatorLike {
  const selector = [
    "button[data-testid='copy-turn-action-button']",
    "button[aria-label*='Copy response']",
    "button[aria-label*='回答をコピー']",
    "button[aria-label*='応答をコピー']",
    "button[aria-label*='レスポンスをコピー']"
  ].join(", ");
  const role = typeof page.getByRole === "function"
    ? page.getByRole("button", { name: /Copy response|回答をコピー|応答をコピー|レスポンスをコピー/i })
    : undefined;
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, selector);
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

function fallbackLocator(primary: LocatorLike, fallback: LocatorLike | undefined, label: string): LocatorLike {
  return {
    ...primary,
    click: async options => {
      try {
        if (primary.click !== undefined) return await primary.click(options);
      } catch {
        // Fall back to the secondary locator below.
      }
      if (fallback?.click !== undefined) return await fallback.click(options);
      throw new Error(`${label} locator does not expose click().`);
    },
    count: async () => {
      const primaryCount = await primary.count?.().catch(() => undefined);
      if (primaryCount !== undefined && primaryCount > 0) return primaryCount;
      return await fallback?.count?.().catch(() => undefined) ?? primaryCount ?? 0;
    },
    isVisible: async options => {
      const primaryVisible = await primary.isVisible?.(options).catch(() => undefined);
      if (primaryVisible === true) return true;
      return await fallback?.isVisible?.(options).catch(() => undefined) ?? primaryVisible ?? false;
    }
  };
}
