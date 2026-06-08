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
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "[contenteditable='true'], textarea");
  }
  return firstRoleLocator(page, "textbox", ["Chat with ChatGPT", "与 ChatGPT 聊天"]);
}

export function sendButton(page: PageLike): LocatorLike {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button[aria-label*='Send']");
  }
  return firstRoleLocator(page, "button", ["Send prompt", "发送提示"]);
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

function firstRoleLocator(page: PageLike, role: string, names: string[]): LocatorLike {
  const locators = names.map(name => page.getByRole!(role, { name }));
  return {
    click: options => withFirstLocator(locators, locator => locator.click?.(options)),
    fill: (value, options) => withFirstLocator(locators, locator => locator.fill?.(value, options)),
    textContent: options => withFirstLocator(locators, locator => locator.textContent?.(options)),
    innerText: options => withFirstLocator(locators, locator => locator.innerText?.(options)),
    innerHTML: options => withFirstLocator(locators, locator => locator.innerHTML?.(options)),
    count: async () => {
      let total = 0;
      for (const locator of locators) {
        total += await locator.count?.().catch(() => 0) ?? 0;
      }
      return total;
    },
    first: () => firstRoleLocator(page, role, names).nth?.(0) ?? locators[0]!,
    last: () => locators.at(-1)?.last?.() ?? locators.at(-1)!,
    nth: index => locators[index]?.nth?.(index) ?? locators[index] ?? locators[0]!,
    isVisible: options => withFirstLocator(locators, locator => locator.isVisible?.(options)),
    evaluate: fn => withFirstLocator(locators, locator => locator.evaluate?.(fn)),
    locator: selector => withFirstLocatorSync(locators, locator => locator.locator?.(selector)),
    filter: options => withFirstLocatorSync(locators, locator => locator.filter?.(options)),
    getByRole: (nestedRole, options) => withFirstLocatorSync(locators, locator => locator.getByRole?.(nestedRole, options)),
    getByText: (text, options) => withFirstLocatorSync(locators, locator => locator.getByText?.(text, options)),
    setInputFiles: paths => withFirstLocator(locators, locator => locator.setInputFiles?.(paths))
  };
}

async function withFirstLocator<T>(
  locators: LocatorLike[],
  action: (locator: LocatorLike) => Promise<T> | undefined
): Promise<T> {
  const locator = await resolveFirstLocator(locators);
  const result = action(locator);
  if (result === undefined) {
    throw new Error("Matched locator does not support the requested action.");
  }
  return result;
}

function withFirstLocatorSync(
  locators: LocatorLike[],
  action: (locator: LocatorLike) => LocatorLike | undefined
): LocatorLike {
  for (const locator of locators) {
    const result = action(locator);
    if (result !== undefined) return result;
  }
  return locators[0]!;
}

async function resolveFirstLocator(locators: LocatorLike[]): Promise<LocatorLike> {
  for (const locator of locators) {
    if (locator.count === undefined) return locator;
    const count = await locator.count().catch(() => 0);
    if (count > 0) return locator;
  }
  return locators[0]!;
}
