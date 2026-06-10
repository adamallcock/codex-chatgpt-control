import { parseConversationId, readPageState } from "../browser/page-state.js";
import { resultError, resultOk } from "../errors.js";
import { countPageMessages, readLatestMessageText } from "../dom/messages.js";
import { requiredLocator, searchChatsButton, searchChatsInput, newChatButton } from "../dom/selectors.js";
import { normalizeWhitespace, stripTags } from "../dom/visible-text.js";
import type {
  CommandResult,
  NewThreadArgs,
  OpenThreadArgs,
  OpenThreadData,
  RuntimeEnv,
  SearchThreadsArgs,
  SearchThreadsData,
  ThreadSearchResult
} from "../types.js";
import { contextFromPage } from "./context.js";
import { bootstrap } from "./session.js";

const CHATGPT_HOME = "https://chatgpt.com/";

export function extractThreadSearchResultsFromHtml(html: string): ThreadSearchResult[] {
  const anchors = html.matchAll(/<a\b(?<attrs>[^>]*\bhref=["'](?<href>\/c\/[^"']+)["'][^>]*)>(?<body>[\s\S]*?)<\/a>/gi);
  const results: ThreadSearchResult[] = [];

  for (const anchor of anchors) {
    const href = anchor.groups?.href;
    const body = anchor.groups?.body ?? "";
    if (href === undefined) {
      continue;
    }

    const lines = extractBlockTexts(body);
    const fallback = normalizeWhitespace(stripTags(body));
    const title = lines[0] ?? fallback;
    if (title.length === 0) {
      continue;
    }

    const result: ThreadSearchResult = { title, href };
    const conversationId = parseConversationId(href);
    if (conversationId !== undefined) {
      result.conversationId = conversationId;
    }
    const snippet = lines.slice(1).join(" ");
    if (snippet.length > 0) {
      result.snippet = snippet;
    }
    results.push(result);
  }

  return dedupeResults(results);
}

export async function searchThreads(
  env: RuntimeEnv,
  args: SearchThreadsArgs
): Promise<CommandResult<SearchThreadsData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<SearchThreadsData>;
  }

  const page = env.page!;

  try {
    const warnings: string[] = [];
    try {
      await openSearchUI(page);
      await fillSearchQuery(page, args.query);
      await page.waitForTimeout?.(350);
    } catch (error) {
      warnings.push(`Search modal was not usable; fell back to visible sidebar links. ${error instanceof Error ? error.message : String(error)}`);
    }

    const results = filterResultsByQuery(await extractThreadSearchResultsFromPage(page), args.query);
    const limited = results.slice(0, args.limit ?? results.length);
    return resultOk({ query: args.query, results: limited }, await contextFromPage(page), warnings);
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

export async function newThread(env: RuntimeEnv, args: NewThreadArgs = {}): Promise<CommandResult<OpenThreadData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<OpenThreadData>;
  }

  const page = env.page!;
  try {
    try {
      await newChatButton(page).click?.();
    } catch {
      await page.goto?.(CHATGPT_HOME, { waitUntil: "domcontentloaded", timeout: args.timeoutMs ?? 30000 });
    }
    await page.waitForTimeout?.(500);
    const state = await readPageState(page);
    return resultOk(openThreadData(state.url, state.conversationId, state.title), await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

export async function openThread(
  env: RuntimeEnv,
  args: OpenThreadArgs,
  previousResults?: Map<string, CommandResult<unknown>>
): Promise<CommandResult<OpenThreadData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<OpenThreadData>;
  }

  const page = env.page!;

  try {
    const target = await resolveOpenTarget(env, args, previousResults);
    if (target === undefined) {
      return {
        ok: false,
        status: "not_found",
        warnings: [],
        blocker: {
          kind: "not_found",
          message: "No thread target could be resolved from the provided arguments."
        },
        context: await contextFromPage(page)
      };
    }

    if (target.href !== undefined && target.href.startsWith("/")) {
      await page.goto?.(new URL(target.href, CHATGPT_HOME).toString(), { waitUntil: "domcontentloaded", timeout: args.timeoutMs ?? 30000 });
    } else {
      await page.goto?.(target.href ?? target.url, { waitUntil: "domcontentloaded", timeout: args.timeoutMs ?? 30000 });
    }

    await waitForThreadHydrated(page, args.timeoutMs ?? 30000, parseConversationId(target.url));
    const state = await readPageState(page);
    return resultOk(
      openThreadData(state.url, state.conversationId, state.title ?? target.title),
      await contextFromPage(page)
    );
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

async function ensurePage(env: RuntimeEnv): Promise<CommandResult<unknown>> {
  if (env.page !== undefined) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
}

async function resolveOpenTarget(
  env: RuntimeEnv,
  args: OpenThreadArgs,
  previousResults?: Map<string, CommandResult<unknown>>
): Promise<{ href?: string; url: string; title?: string } | undefined> {
  if (args.url !== undefined) {
    return { url: args.url };
  }
  if (args.conversationId !== undefined) {
    return { url: new URL(`/c/${args.conversationId}`, CHATGPT_HOME).toString() };
  }

  if (args.fromStep !== undefined && previousResults !== undefined) {
    const previous = previousResults.get(args.fromStep);
    const data = previous?.data as SearchThreadsData | undefined;
    const selected = selectSearchResult(data?.results ?? [], args.select ?? "first");
    if (selected !== undefined) {
      return { href: selected.href, url: new URL(selected.href, CHATGPT_HOME).toString(), title: selected.title };
    }
  }

  if (args.title !== undefined) {
    const search = await searchThreads(env, { query: args.title, limit: 10 });
    const selected = selectSearchResult(search.data?.results ?? [], { title: args.title }) ?? search.data?.results[0];
    if (selected !== undefined) {
      return { href: selected.href, url: new URL(selected.href, CHATGPT_HOME).toString(), title: selected.title };
    }
  }

  return undefined;
}

export function selectSearchResult(
  results: ThreadSearchResult[],
  select: OpenThreadArgs["select"] = "first"
): ThreadSearchResult | undefined {
  if (select === "first") {
    return results[0];
  }
  if (select !== undefined && "index" in select) {
    return results[select.index];
  }
  if (select !== undefined && "title" in select) {
    const wanted = normalizeForMatch(select.title);
    return results.find(result => normalizeForMatch(result.title) === wanted)
      ?? results.find(result => normalizeForMatch(result.title).includes(wanted));
  }
  return undefined;
}

async function extractThreadSearchResultsFromPage(page: RuntimeEnv["page"]): Promise<ThreadSearchResult[]> {
  if (page === undefined) {
    return [];
  }

  if (typeof page.evaluate === "function") {
    const raw = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href^='/c/']"))
        .map(anchor => ({
          href: anchor.getAttribute("href") ?? "",
          text: (anchor as HTMLElement).innerText ?? anchor.textContent ?? ""
        }))
        .filter(item => item.href.length > 0 && item.text.trim().length > 0);
    });

    return dedupeResults(raw.map(item => {
      const lines = item.text.split(/\n+/).map(line => normalizeWhitespace(line)).filter(Boolean);
      const result: ThreadSearchResult = {
        title: lines[0] ?? normalizeWhitespace(item.text),
        href: item.href
      };
      const conversationId = parseConversationId(item.href);
      if (conversationId !== undefined) {
        result.conversationId = conversationId;
      }
      const snippet = lines.slice(1).join(" ");
      if (snippet.length > 0) {
        result.snippet = snippet;
      }
      return result;
    }));
  }

  if (typeof page.content === "function") {
    return extractThreadSearchResultsFromHtml(await page.content());
  }

  return [];
}

function dedupeResults(results: ThreadSearchResult[]): ThreadSearchResult[] {
  const seen = new Set<string>();
  const deduped: ThreadSearchResult[] = [];

  for (const result of results) {
    const key = result.conversationId ?? result.href;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

function normalizeForMatch(text: string): string {
  return normalizeWhitespace(text).toLowerCase();
}

async function openSearchUI(page: NonNullable<RuntimeEnv["page"]>): Promise<void> {
  try {
    await searchChatsButton(page).click?.();
    await page.waitForTimeout?.(250);
    return;
  } catch {
    // Fall through to DOM click.
  }

  if (typeof page.evaluate === "function") {
    try {
      await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll("button"))
          .find(candidate => /Search chats/i.test((candidate as HTMLElement).innerText ?? candidate.textContent ?? ""));
        (button as HTMLButtonElement | undefined)?.click();
      });
      await page.waitForTimeout?.(250);
      return;
    } catch {
      // Fall through to keyboard shortcut.
    }
  }

  await page.keyboard?.press?.("Meta+K");
  await page.waitForTimeout?.(250);
}

async function fillSearchQuery(page: NonNullable<RuntimeEnv["page"]>, query: string): Promise<void> {
  const attempts = [
    async () => searchChatsInput(page).fill?.(query),
    async () => page.getByRole?.("textbox", { name: "Search chats" }).fill?.(query),
    async () => page.getByRole?.("textbox", { name: /Search chats/i }).fill?.(query),
    async () => requiredLocator(page, "input[placeholder*='Search'], [role='dialog'] input").fill?.(query)
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await attempt();
      return;
    } catch (error) {
      lastError = error;
      await page.keyboard?.press?.("Meta+K");
      await page.waitForTimeout?.(250);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to fill ChatGPT search input.");
}

function openThreadData(url: string, conversationId?: string, title?: string): OpenThreadData {
  const data: OpenThreadData = { url };
  if (conversationId !== undefined) {
    data.conversationId = conversationId;
  }
  if (title !== undefined) {
    data.title = title;
  }
  return data;
}

function extractBlockTexts(html: string): string[] {
  const chunks = Array.from(html.matchAll(/<(?:div|span|p|h[1-6])\b[^>]*>([\s\S]*?)<\/(?:div|span|p|h[1-6])>/gi))
    .map(match => stripTags(match[1] ?? ""))
    .filter(Boolean);

  if (chunks.length > 0) {
    return chunks;
  }

  const fallback = stripTags(html);
  return fallback.length > 0 ? [fallback] : [];
}

function filterResultsByQuery(results: ThreadSearchResult[], query: string): ThreadSearchResult[] {
  const wanted = normalizeForMatch(query);
  return results.filter(result => {
    const haystack = normalizeForMatch(`${result.title} ${result.snippet ?? ""}`);
    return haystack.includes(wanted) || wanted.includes(normalizeForMatch(result.title));
  });
}

async function waitForThreadHydrated(
  page: NonNullable<RuntimeEnv["page"]>,
  timeoutMs: number,
  expectedConversationId?: string
): Promise<void> {
  const started = Date.now();
  await page.waitForTimeout?.(1000);
  while (Date.now() - started < timeoutMs) {
    const url = typeof page.url === "function" ? await Promise.resolve(page.url()).catch(() => "") : "";
    const urlMatches = expectedConversationId === undefined || url.includes(expectedConversationId);
    const count = await countPageMessages(page).catch(() => 0);
    const latestAssistantText = await readLatestMessageText(page, "assistant").catch(() => undefined);
    const title = typeof page.title === "function" ? await page.title().catch(() => "") : "";
    if (urlMatches && ((latestAssistantText?.trim().length ?? 0) > 0 || (count > 0 && title.length > 0 && title !== "ChatGPT"))) {
      await page.waitForTimeout?.(250);
      return;
    }
    await page.waitForTimeout?.(500);
  }
}
