import { parseConversationId } from "../browser/page-state.js";
import { countPageMessages, readLatestMessageText } from "../dom/messages.js";
import type { PageLike } from "../types.js";

const CHATGPT_HOME = "https://chatgpt.com/";

export type ConversationTarget = {
  href?: string;
  url: string;
};

export type EnsureConversationTargetOptions = {
  timeoutMs: number;
};

export type EnsureConversationTargetResult = {
  navigated: boolean;
  targetUrl: string;
  expectedConversationId?: string;
};

export async function ensureConversationTarget(
  page: PageLike,
  target: ConversationTarget,
  options: EnsureConversationTargetOptions
): Promise<EnsureConversationTargetResult> {
  const targetUrl = absoluteConversationUrl(target);
  const expectedConversationId = parseConversationId(targetUrl);
  const currentUrl = typeof page.url === "function" ? await Promise.resolve(page.url()).catch(() => "") : "";
  if (
    expectedConversationId !== undefined
    && parseConversationId(typeof currentUrl === "string" ? currentUrl : "") === expectedConversationId
  ) {
    await waitForConversationHydrated(page, options.timeoutMs, expectedConversationId);
    return ensureResult(false, targetUrl, expectedConversationId);
  }

  await page.goto?.(targetUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
  await waitForConversationHydrated(page, options.timeoutMs, expectedConversationId);
  return ensureResult(true, targetUrl, expectedConversationId);
}

export async function waitForConversationHydrated(
  page: PageLike,
  timeoutMs: number,
  expectedConversationId?: string
): Promise<void> {
  const started = Date.now();
  do {
    const url = typeof page.url === "function" ? await Promise.resolve(page.url()).catch(() => "") : "";
    const urlMatches = expectedConversationId === undefined || parseConversationId(typeof url === "string" ? url : "") === expectedConversationId;
    const count = await countPageMessages(page).catch(() => 0);
    const latestAssistantText = await readLatestMessageText(page, "assistant").catch(() => undefined);
    const title = typeof page.title === "function" ? await page.title().catch(() => "") : "";
    if (urlMatches && ((latestAssistantText?.trim().length ?? 0) > 0 || (count > 0 && title.length > 0 && title !== "ChatGPT"))) {
      await page.waitForTimeout?.(250);
      return;
    }
    await page.waitForTimeout?.(500);
  } while (Date.now() - started < timeoutMs);
}

function absoluteConversationUrl(target: ConversationTarget): string {
  if (target.href !== undefined && target.href.startsWith("/")) {
    return new URL(target.href, CHATGPT_HOME).toString();
  }
  return target.href ?? target.url;
}

function ensureResult(
  navigated: boolean,
  targetUrl: string,
  expectedConversationId?: string
): EnsureConversationTargetResult {
  const result: EnsureConversationTargetResult = { navigated, targetUrl };
  if (expectedConversationId !== undefined) {
    result.expectedConversationId = expectedConversationId;
  }
  return result;
}
