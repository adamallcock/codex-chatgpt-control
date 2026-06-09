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
  ].join(", ")
} as const;

export function composerTextbox(page: PageLike): LocatorLike {
  if (typeof page.locator !== "function" && typeof page.getByRole === "function") {
    return page.getByRole("textbox", { name: "Chat with ChatGPT" });
  }
  const css = requiredLocator(page, "#prompt-textarea, textarea, [contenteditable='true'], [role='textbox']");
  const role = typeof page.getByRole === "function"
    ? page.getByRole("textbox", { name: "Chat with ChatGPT" })
    : undefined;
  return {
    ...css,
    click: async options => {
      try {
        if (css.click !== undefined) return await css.click(options);
      } catch {
        // Fall back to the role locator below.
      }
      return await role?.click?.(options);
    },
    fill: async (value, options) => {
      try {
        if (css.fill !== undefined) return await css.fill(value, options);
      } catch {
        // Fall back to the role locator below.
      }
      return await role?.fill?.(value, options);
    },
    innerText: async options => {
      try {
        if (css.innerText !== undefined) return await css.innerText(options);
      } catch {
        // Fall back to the role locator below.
      }
      return await role?.innerText?.(options) ?? "";
    },
    textContent: async options => {
      try {
        if (css.textContent !== undefined) return await css.textContent(options);
      } catch {
        // Fall back to the role locator below.
      }
      return await role?.textContent?.(options) ?? null;
    }
  };
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
    ? page.getByRole("button", { name: "Send prompt" })
    : undefined;
  if (typeof page.locator !== "function") {
    if (role !== undefined) return role;
    return requiredLocator(page, selector);
  }
  const css = requiredLocator(page, selector);
  return {
    ...css,
    click: async options => {
      try {
        if (css.click !== undefined) return await css.click(options);
      } catch {
        // Fall back to the role locator below.
      }
      if (role?.click !== undefined) return await role.click(options);
      throw new Error("Send button locator does not expose click().");
    },
    count: async () => {
      const cssCount = await css.count?.().catch(() => undefined);
      if (cssCount !== undefined && cssCount > 0) return cssCount;
      return await role?.count?.().catch(() => undefined) ?? cssCount ?? 0;
    },
    isVisible: async () => {
      const cssVisible = await css.isVisible?.().catch(() => undefined);
      if (cssVisible === true) return true;
      return await role?.isVisible?.().catch(() => undefined) ?? cssVisible ?? false;
    }
  };
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
  const selector = [
    "a[href='/']",
    "button[aria-label='New chat']",
    "a[aria-label='New chat']",
    "button[aria-label='新しいチャット']",
    "a[aria-label='新しいチャット']"
  ].join(", ");
  const role = typeof page.getByRole === "function"
    ? page.getByRole("button", { name: "New chat" })
    : undefined;
  if (typeof page.locator !== "function") {
    if (role !== undefined) return role;
    return requiredLocator(page, selector);
  }
  const css = requiredLocator(page, selector);
  return {
    ...css,
    click: options => (css.click ?? role?.click)?.(options) ?? Promise.reject(new Error("New chat locator does not expose click().")),
    count: async () => {
      const cssCount = await css.count?.().catch(() => undefined);
      if (cssCount !== undefined && cssCount > 0) return cssCount;
      return await role?.count?.().catch(() => undefined) ?? cssCount ?? 0;
    },
    isVisible: async options => {
      const cssVisible = await css.isVisible?.(options).catch(() => undefined);
      if (cssVisible === true) return true;
      return await role?.isVisible?.(options).catch(() => undefined) ?? cssVisible ?? false;
    }
  };
}

export function addFilesButton(page: PageLike): LocatorLike {
  return requiredLocator(page, "#composer-plus-btn, button[aria-label='Add files and more'], button[aria-label='ファイルの追加など']");
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
  if (typeof page.locator !== "function") {
    return role!;
  }
  const css = requiredLocator(page, selector);
  return {
    ...css,
    click: async options => {
      try {
        if (css.click !== undefined) return await css.click(options);
      } catch {
        // Fall back to the role locator below.
      }
      if (role?.click !== undefined) return await role.click(options);
      throw new Error("Copy response locator does not expose click().");
    },
    count: async () => {
      const cssCount = await css.count?.().catch(() => undefined);
      if (cssCount !== undefined && cssCount > 0) return cssCount;
      return await role?.count?.().catch(() => undefined) ?? cssCount ?? 0;
    },
    isVisible: async options => {
      const cssVisible = await css.isVisible?.(options).catch(() => undefined);
      if (cssVisible === true) return true;
      return await role?.isVisible?.(options).catch(() => undefined) ?? cssVisible ?? false;
    },
    nth: index => {
      const cssNth = css.nth?.(index) ?? css;
      const roleNth = role?.nth?.(index) ?? role;
      return fallbackLocator(cssNth, roleNth, "Copy response");
    },
    last: () => {
      const cssLast = css.last?.() ?? css;
      const roleLast = role?.last?.() ?? role;
      return fallbackLocator(cssLast, roleLast, "Copy response");
    },
    first: () => {
      const cssFirst = css.first?.() ?? css;
      const roleFirst = role?.first?.() ?? role;
      return fallbackLocator(cssFirst, roleFirst, "Copy response");
    }
  };
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
