import { BrowserBridgeUnavailableError, ChatGPTControlError, LoginRequiredError, SelectorDriftError } from "../errors.js";
import type { BootstrapArgs, BrowserLike, BrowserUserTabInfo, ExistingTabPolicy, ExistingTabTarget, PageLike, RuntimeEnv } from "../types.js";
import { parseConversationId, readPageState } from "./page-state.js";

const CHATGPT_HOME = "https://chatgpt.com/";
const CHATGPT_HOSTS = new Set(["chatgpt.com", "www.chatgpt.com", "chat.openai.com"]);

export type AttachedBrowser = {
  browser: BrowserLike;
  page: PageLike;
  browserName: string;
  tabId?: string;
};

export async function attachChatGPTBrowser(
  env: RuntimeEnv,
  args: BootstrapArgs = {}
): Promise<AttachedBrowser> {
  const browser = await getBrowser(env);
  const page = await getOrCreateChatGPTPage(browser, env, args);
  const state = await readPageState(page);

  if (state.blocker?.kind === "login_required") {
    throw new LoginRequiredError(state.blocker.visibleText);
  }

  if (state.url.includes("chatgpt.com") && !state.signedIn && state.visibleText.length > 0) {
    throw new SelectorDriftError("ChatGPT loaded, but no signed-in ChatGPT controls were recognized.", state.visibleText);
  }

  const attached: AttachedBrowser = {
    browser,
    page,
    browserName: browser.name ?? "chrome"
  };

  const tabId = getTabId(page);
  if (tabId !== undefined) {
    attached.tabId = tabId;
  }

  return attached;
}

async function getBrowser(env: RuntimeEnv): Promise<BrowserLike> {
  if (env.browser !== undefined) {
    return env.browser;
  }

  const anyEnv = env as Record<string, unknown>;
  const agent = env.agent ?? anyEnv.agent ?? (globalThis as Record<string, unknown>).agent;
  const browsers = (agent as { browsers?: unknown } | undefined)?.browsers;

  if (browsers !== undefined && typeof browsers === "object") {
    const maybeBrowser = await tryBrowserGetPreferredListed(browsers)
      ?? await tryBrowserGet(browsers, "extension")
      ?? await tryBrowserGet(browsers, "chrome");

    if (maybeBrowser !== undefined) {
      return maybeBrowser;
    }
  }

  throw new BrowserBridgeUnavailableError();
}

async function tryBrowserGet(browsers: unknown, name: string): Promise<BrowserLike | undefined> {
  const get = (browsers as { get?: (browserName: string) => Promise<unknown> | unknown }).get;
  if (typeof get !== "function") {
    return undefined;
  }

  try {
    const browser = await get.call(browsers, name);
    return normalizeBrowser(browser);
  } catch {
    return undefined;
  }
}

async function tryBrowserGetFirst(browsers: unknown): Promise<BrowserLike | undefined> {
  const list = (browsers as { list?: () => Promise<unknown[]> | unknown[] }).list;
  const get = (browsers as { get?: (browserName: string) => Promise<unknown> | unknown }).get;

  if (typeof list !== "function" || typeof get !== "function") {
    return undefined;
  }

  try {
    const names = await list.call(browsers);
    const first = names.find(name => typeof name === "string") as string | undefined;
    if (first === undefined) {
      return undefined;
    }
    const browser = await get.call(browsers, first);
    return normalizeBrowser(browser);
  } catch {
    return undefined;
  }
}

async function tryBrowserGetPreferredListed(browsers: unknown): Promise<BrowserLike | undefined> {
  const list = (browsers as { list?: () => Promise<Array<Record<string, unknown>>> | Array<Record<string, unknown>> }).list;
  const get = (browsers as { get?: (browserName: string) => Promise<unknown> | unknown }).get;

  if (typeof list !== "function" || typeof get !== "function") {
    return undefined;
  }

  try {
    const available = await list.call(browsers);
    const preferred = available.find(browser => browser.type === "extension")
      ?? available.find(browser => typeof browser.name === "string" && /chrome/i.test(browser.name))
      ?? available[0];
    const id = preferred?.id;
    if (typeof id !== "string") {
      return undefined;
    }
    const browser = await get.call(browsers, id);
    return normalizeBrowser(browser);
  } catch {
    return undefined;
  }
}

async function getOrCreateChatGPTPage(
  browser: BrowserLike,
  env: RuntimeEnv,
  args: BootstrapArgs
): Promise<PageLike> {
  if (env.page !== undefined) {
    return normalizePage(env.page);
  }

  const targetUrl = args.url ?? CHATGPT_HOME;
  const explicitExistingPolicy = normalizeExplicitExistingTabPolicy(args);
  if (explicitExistingPolicy !== undefined) {
    const existing = await selectExistingTab(browser, explicitExistingPolicy);
    if (existing !== undefined) {
      return existing;
    }

    const ifMissing = explicitExistingPolicy.ifMissing ?? "block";
    if (ifMissing === "block") {
      throw new ExistingTabSelectionError(
        "No already-open ChatGPT tab matched the requested existing-tab target.",
        "existing_tab_not_found"
      );
    }
    const missingUrl = ifMissing === "open"
      ? urlFromExistingTarget(explicitExistingPolicy.target) ?? targetUrl
      : targetUrl;
    const created = await createTab(browser, missingUrl);
    if (created !== undefined) {
      return created;
    }
    throw new BrowserBridgeUnavailableError("Codex can access a browser object, but no tab creation API was found.");
  }

  if (args.preferExistingTab !== false) {
    const existing = await findExistingChatGPTTab(browser);
    if (existing !== undefined) {
      return existing;
    }
  }

  const created = await createTab(browser, targetUrl);
  if (created !== undefined) {
    return created;
  }

  throw new BrowserBridgeUnavailableError("Codex can access a browser object, but no tab creation API was found.");
}

function normalizeExplicitExistingTabPolicy(args: BootstrapArgs): ExistingTabPolicy | undefined {
  if (args.existingTab === undefined) {
    return undefined;
  }
  if (args.existingTab === true) {
    return {
      target: { type: "selected", host: "chatgpt" },
      ifMissing: "create",
      ifMultiple: "first",
      requireChatGPT: true
    };
  }
  if (args.existingTab === false) {
    return undefined;
  }
  return {
    requireChatGPT: true,
    ifMissing: "block",
    ifMultiple: args.existingTab.target?.type === "selected" ? "first" : "block",
    ...args.existingTab
  };
}

async function selectExistingTab(browser: BrowserLike, policy: ExistingTabPolicy): Promise<PageLike | undefined> {
  const userMatch = await selectExistingUserTab(browser, policy);
  if (userMatch !== undefined) {
    return userMatch;
  }

  if (policy.target?.type === "selected" && typeof browser.tabs?.selected === "function") {
    const selected = await Promise.resolve(browser.tabs.selected.call(browser.tabs)).catch(() => undefined);
    if (selected !== undefined) {
      const normalized = normalizePage(selected);
      if (await pageMatchesExistingTarget(normalized, policy)) {
        return normalized;
      }
    }
  }

  if (policy.target?.type === "tabId" && typeof browser.tabs?.get === "function") {
    const tab = await Promise.resolve(browser.tabs.get.call(browser.tabs, policy.target.tabId)).catch(() => undefined);
    if (tab !== undefined) {
      const normalized = normalizePage(tab);
      if (await pageMatchesExistingTarget(normalized, policy)) {
        return normalized;
      }
    }
  }

  return undefined;
}

async function selectExistingUserTab(browser: BrowserLike, policy: ExistingTabPolicy): Promise<PageLike | undefined> {
  const openTabs = browser.user?.openTabs;
  const claimTab = browser.user?.claimTab;
  if (typeof openTabs !== "function" || typeof claimTab !== "function") {
    return undefined;
  }

  const tabs = await Promise.resolve(openTabs.call(browser.user)).catch(() => []);
  const matches = tabs.filter(tab => userTabMatchesTarget(tab, policy));

  if (matches.length === 0) {
    return undefined;
  }

  if (matches.length > 1 && (policy.ifMultiple ?? "block") !== "first") {
    throw new ExistingTabSelectionError(
      "Multiple already-open ChatGPT tabs matched the requested existing-tab target.",
      "existing_tab_ambiguous",
      matches
    );
  }

  const selected = matches[0]!;
  return normalizePage(await claimTab.call(browser.user, selected));
}

function userTabMatchesTarget(tab: BrowserUserTabInfo, policy: ExistingTabPolicy): boolean {
  const target = policy.target ?? { type: "selected", host: "chatgpt" };
  const requireChatGPT = policy.requireChatGPT ?? targetRequiresChatGPT(target);
  if (requireChatGPT && !isChatGPTUrl(tab.url)) {
    return false;
  }

  switch (target.type) {
    case "selected":
      return target.host === undefined || target.host === "chatgpt" ? isChatGPTUrl(tab.url) : true;
    case "tabId":
      return tab.id === target.tabId;
    case "conversationId":
    case "conversation_id":
      return parseConversationId(tab.url ?? "") === target.conversationId;
    case "url":
      return urlMatches(tab.url, target.url);
    case "title":
      return titleMatches(tab.title, target.title, target.exact ?? true);
  }
}

async function pageMatchesExistingTarget(page: PageLike, policy: ExistingTabPolicy): Promise<boolean> {
  const url = await Promise.resolve(page.url?.()).catch(() => undefined);
  const title = await Promise.resolve(page.title?.()).catch(() => undefined);
  const tab: BrowserUserTabInfo = { id: getTabId(page) ?? "" };
  if (url !== undefined) tab.url = url;
  if (title !== undefined) tab.title = title;
  return userTabMatchesTarget(tab, policy);
}

async function findExistingChatGPTTab(browser: BrowserLike): Promise<PageLike | undefined> {
  const selected = browser.tabs?.selected;
  if (typeof selected === "function") {
    try {
      const current = await selected.call(browser.tabs);
      if (current !== undefined) {
        const normalized = normalizePage(current);
        try {
          if ((await normalized.url?.())?.includes("chatgpt.com") === true) {
            return normalized;
          }
        } catch {
          // Continue to full tab list.
        }
      }
    } catch {
      // No selected tab is a normal fresh-browser state.
    }
  }

  const list = browser.tabs?.list;
  if (typeof list !== "function") {
    return undefined;
  }

  const tabs = await list.call(browser.tabs);
  const normalized = await Promise.all(tabs.map(tab => hydrateTab(browser, tab)));
  for (const tab of normalized) {
    try {
      if ((await tab.url?.())?.includes("chatgpt.com") === true) {
        return tab;
      }
    } catch {
      // Keep looking.
    }
  }
  return undefined;
}

class ExistingTabSelectionError extends ChatGPTControlError {
  constructor(message: string, code: string, candidates: BrowserUserTabInfo[] = []) {
    super(message, "not_found", true, undefined, {
      code,
      candidates: candidates.map(tab => ({ label: userTabCandidateLabel(tab) })),
      remediation: [
        {
          label: "Choose an exact tab",
          instruction: "Use the selected tab, a ChatGPT conversation URL, conversation ID, or a tab id returned by openTabs().",
          userActionRequired: false
        },
        {
          label: "Allow opening",
          instruction: "Rerun with open-if-missing only if it is acceptable to open or create a ChatGPT tab instead of reusing an already-open one.",
          userActionRequired: false
        }
      ]
    });
  }
}

function targetRequiresChatGPT(target: ExistingTabTarget): boolean {
  switch (target.type) {
    case "selected":
      return target.host === "chatgpt";
    case "tabId":
    case "title":
      return true;
    case "conversationId":
    case "conversation_id":
    case "url":
      return true;
  }
}

function isChatGPTUrl(url: string | undefined): boolean {
  if (url === undefined) {
    return false;
  }
  try {
    return CHATGPT_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function urlMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) {
    return false;
  }
  const actualConversationId = parseConversationId(actual);
  const expectedConversationId = parseConversationId(expected);
  if (actualConversationId !== undefined || expectedConversationId !== undefined) {
    return actualConversationId !== undefined && actualConversationId === expectedConversationId;
  }
  return normalizeUrl(actual) === normalizeUrl(expected);
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function titleMatches(actual: string | undefined, expected: string, exact: boolean): boolean {
  if (actual === undefined) {
    return false;
  }
  const normalizedActual = normalizeText(actual);
  const normalizedExpected = normalizeText(expected);
  return exact ? normalizedActual === normalizedExpected : normalizedActual.includes(normalizedExpected);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function urlFromExistingTarget(target: ExistingTabTarget | undefined): string | undefined {
  if (target === undefined) {
    return undefined;
  }
  switch (target.type) {
    case "url":
      return target.url;
    case "conversationId":
    case "conversation_id":
      return new URL(`/c/${target.conversationId}`, CHATGPT_HOME).toString();
    case "selected":
    case "tabId":
    case "title":
      return undefined;
  }
}

function userTabCandidateLabel(tab: BrowserUserTabInfo): string {
  return `tab ${tab.id} - ${tab.title ?? "Untitled"} - ${tab.url ?? "unknown URL"}`;
}

async function createTab(browser: BrowserLike, url: string): Promise<PageLike | undefined> {
  if (typeof browser.tabs?.create === "function") {
    const tab = await browser.tabs.create(url);
    const page = await hydrateTab(browser, tab);
    await ensurePageAt(page, url);
    return page;
  }

  if (typeof browser.tabs?.new === "function") {
    const tab = await browser.tabs.new(url);
    const page = await hydrateTab(browser, tab);
    await ensurePageAt(page, url);
    return page;
  }

  if (typeof browser.newPage === "function") {
    const page = normalizePage(await browser.newPage());
    if (typeof page.goto === "function") {
      await page.goto(url);
    }
    return page;
  }

  return undefined;
}

async function ensurePageAt(page: PageLike, url: string): Promise<void> {
  const currentUrl = await Promise.resolve(page.url?.()).catch(() => "");
  if (currentUrl?.includes("chatgpt.com") === true) {
    return;
  }
  if (typeof page.goto === "function") {
    await page.goto(url);
  }
}

function normalizeBrowser(browser: unknown): BrowserLike | undefined {
  if (browser === undefined || browser === null || typeof browser !== "object") {
    return undefined;
  }

  return browser as BrowserLike;
}

async function hydrateTab(browser: BrowserLike, pageOrTab: unknown): Promise<PageLike> {
  const maybe = pageOrTab as Record<string, unknown>;
  if (maybe.playwright === undefined && typeof maybe.id === "string" && typeof browser.tabs?.get === "function") {
    try {
      return normalizePage(await browser.tabs.get(maybe.id));
    } catch {
      return normalizePage(pageOrTab);
    }
  }
  return normalizePage(pageOrTab);
}

function normalizePage(pageOrTab: unknown): PageLike {
  const maybe = pageOrTab as Record<string, unknown>;
  const playwright = maybe.playwright ?? maybe.page;
  if (playwright !== undefined && typeof playwright === "object") {
    return new Proxy(playwright as Record<string, unknown>, {
      get(target, prop) {
        if (prop in target) {
          const value = target[prop as keyof typeof target];
          return typeof value === "function" ? value.bind(target) : value;
        }
        const value = maybe[prop as keyof typeof maybe];
        return typeof value === "function" ? value.bind(maybe) : value;
      }
    }) as PageLike;
  }

  if (typeof maybe.url === "string") {
    return {
      ...maybe,
      url: () => maybe.url as string,
      title: async () => typeof maybe.title === "string" ? maybe.title : ""
    } as PageLike;
  }

  return pageOrTab as PageLike;
}

function getTabId(page: PageLike): string | undefined {
  const maybe = page as Record<string, unknown>;
  const id = maybe.id ?? maybe.tabId;
  return typeof id === "string" ? id : undefined;
}
