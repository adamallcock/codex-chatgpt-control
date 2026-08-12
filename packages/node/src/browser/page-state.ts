import type { BlockerKind, PageLike } from "../types.js";
import { classifyVisibleText } from "../safety/blockers.js";
import { compactVisibleText } from "../safety/redaction.js";
import { escapeRegExp, localeLabels } from "../dom/locale-labels.js";
import { withTimeout } from "../commands/timeouts.js";

export type PageState = {
  url: string;
  conversationId?: string;
  title?: string;
  visibleText: string;
  signedIn: boolean;
  blocker?: { kind: BlockerKind; message: string; visibleText?: string };
};

export function parseConversationId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url, "https://chatgpt.com");
  } catch {
    return undefined;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] !== "c" || segments[1] === undefined || segments[1].length === 0) {
    return undefined;
  }
  return segments[1];
}

export async function readPageState(page: PageLike): Promise<PageState> {
  const rawUrl = typeof page.url === "function" ? await Promise.resolve(page.url()).catch(() => "") : "";
  const url = typeof rawUrl === "string" ? rawUrl : "";
  const rawTitle = typeof page.title === "function" ? await page.title().catch(() => undefined) : undefined;
  const title = typeof rawTitle === "string" ? rawTitle : undefined;
  const visibleText = await readVisibleText(page);
  const blockerSurface = await readBlockerSurface(page);
  const fullPageBlocker = classifyVisibleText(visibleText);
  const classifiedBlocker = blockerSurface.hasConversationMessages
    ? classifyVisibleText(blockerSurface.text)
    : (classifyVisibleText(blockerSurface.text) ?? fullPageBlocker);
  const loginWall = classifiedBlocker?.kind === "login_required" && isLikelyLoginWall(visibleText);
  const signedIn = isLikelySignedIn(visibleText) && !loginWall;
  const blocker = classifiedBlocker?.kind === "login_required" && signedIn
    ? undefined
    : classifiedBlocker;
  const conversationId = parseConversationId(url);

  const state: PageState = {
    url,
    visibleText: compactVisibleText(visibleText),
    signedIn
  };

  if (conversationId !== undefined) {
    state.conversationId = conversationId;
  }

  if (title !== undefined) {
    state.title = title;
  }

  if (blocker !== undefined) {
    state.blocker = blocker;
  }

  return state;
}

export async function readVisibleText(page: PageLike): Promise<string> {
  if (typeof page.evaluate === "function") {
    try {
      return await withTimeout(
        page.evaluate(() => document.body?.innerText ?? ""),
        1000,
        "Timed out while reading visible page text."
      );
    } catch {
      // Fall back to content parsing below.
    }
  }

  if (typeof page.content === "function") {
    try {
      const html = await withTimeout(
        page.content(),
        1000,
        "Timed out while reading page content."
      );
      return htmlToText(html);
    } catch {
      return "";
    }
  }

  return "";
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelySignedIn(visibleText: string): boolean {
  const markers = localeLabels.signedInMarkers.map(escapeRegExp).join("|");
  return new RegExp(`\\b(${markers})\\b`, "i").test(visibleText);
}

async function readBlockerSurface(page: PageLike): Promise<{ text: string; hasConversationMessages: boolean }> {
  if (typeof page.evaluate === "function") {
    try {
      return await withTimeout(page.evaluate(() => {
        const messageSelector = "[data-message-author-role], [data-testid^='conversation-turn']";
        const systemSelector = [
          "[role='alert']",
          "[role='status']",
          "[role='dialog']",
          "[aria-live='assertive']",
          "[data-testid*='toast' i]",
          "[data-testid*='banner' i]",
          "[class*='toast' i]",
          "[class*='banner' i]"
        ].join(", ");
        const text = Array.from(document.querySelectorAll(systemSelector))
          .filter(element => element.closest(messageSelector) === null)
          .map(element => `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""}`)
          .join(" ");
        return {
          text,
          hasConversationMessages: document.querySelector(messageSelector) !== null
        };
      }), 1000, "Timed out while reading system blocker surfaces.");
    } catch {
      // Fall through to content parsing.
    }
  }
  if (typeof page.content === "function") {
    try {
      const html = await withTimeout(page.content(), 1000, "Timed out while reading blocker surfaces.");
      const hasConversationMessages = /data-message-author-role=|data-testid=["']conversation-turn/i.test(html);
      const withoutMessages = html.replace(/<([a-z0-9-]+)\b[^>]*(?:data-message-author-role|data-testid=["']conversation-turn)[^>]*>[\s\S]*?<\/\1>/gi, " ");
      return { text: htmlToText(withoutMessages), hasConversationMessages };
    } catch {
      // Return an empty scoped surface below.
    }
  }
  return { text: "", hasConversationMessages: false };
}

function isLikelyLoginWall(visibleText: string): boolean {
  const labels = localeLabels.loginBlocker.map(escapeRegExp).join("|");
  const matches = visibleText.match(new RegExp(`(?:${labels})`, "gi")) ?? [];
  return matches.length >= 2 || /\bsign\s?up\b|\bcreate (?:an )?account\b/i.test(visibleText);
}
