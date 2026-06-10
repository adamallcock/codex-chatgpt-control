import type {
  PageLike,
  ResponseAction,
  ResponseBlock,
  ResponseBranchState,
  ResponseCaptureFidelity,
  ResponseCaptureSource,
  ResponseCitation,
  ResponseCodeBlock,
  ResponseFormat,
  ResponseTable
} from "../types.js";
import { extractRoleMessageHtml, formatMessageHtml, normalizeResponseFormat } from "./message-format.js";
import { normalizeWhitespace } from "./visible-text.js";

export type MessageRole = "user" | "assistant";

export type ExtractedMessage = {
  role: MessageRole;
  text: string;
  format: Exclude<ResponseFormat, "text">;
  source?: ResponseCaptureSource;
  fidelity?: ResponseCaptureFidelity;
  warnings?: string[];
  markdown?: string;
  visibleText?: string;
  normalizedText?: string;
  html?: string;
  blocks?: ResponseBlock[];
  citations?: ResponseCitation[];
  codeBlocks?: ResponseCodeBlock[];
  tables?: ResponseTable[];
  branch?: ResponseBranchState;
  actions?: ResponseAction[];
  thoughtDurationText?: string;
  sourcesAvailable?: boolean;
};

export type ReadMessagesArgs = {
  role?: MessageRole;
  scope?: "visible" | "loaded";
  format?: ResponseFormat;
  maxChars?: number;
};

export type LatestMessageTextSnapshot = {
  latestText?: string;
  turnCount: number;
};

export function extractMessagesFromHtml(html: string, args: ReadMessagesArgs = {}): ExtractedMessage[] {
  return extractRoleMessageHtml(html)
    .filter(message => args.role === undefined || message.role === args.role)
    .map(message => normalizeExtractedMessage(message, args));
}

export async function readMessages(page: PageLike, args: ReadMessagesArgs = {}): Promise<ExtractedMessage[]> {
  if (typeof page.evaluate === "function") {
    const messages = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
      return nodes
        .map(node => {
          const role = node.getAttribute("data-message-author-role");
          if (role !== "user" && role !== "assistant") {
            return undefined;
          }
          return {
            role,
            html: node.innerHTML,
            metadataHtml: (node.closest("[data-testid^='conversation-turn']") as HTMLElement | null)?.outerHTML ?? node.outerHTML
          };
        })
        .filter(Boolean) as Array<{ role: "user" | "assistant"; html: string; metadataHtml?: string }>;
    });

    return messages
      .filter(message => args.role === undefined || message.role === args.role)
      .map(message => normalizeExtractedMessage(message, args));
  }

  if (typeof page.content === "function") {
    const html = await page.content();
    return extractMessagesFromHtml(html, args);
  }

  return [];
}

export async function readLatestMessage(
  page: PageLike,
  role: MessageRole = "assistant",
  format: ResponseFormat = "markdown",
  maxChars?: number
): Promise<ExtractedMessage | undefined> {
  if (typeof page.evaluate === "function") {
    const message = await page.evaluate((wantedRole: MessageRole) => {
      const nodes = Array.from(document.querySelectorAll(`[data-message-author-role="${wantedRole}"]`));
      const node = nodes.at(-1);
      if (node === undefined) return undefined;
      return {
        role: wantedRole,
        html: node.innerHTML,
        metadataHtml: (node.closest("[data-testid^='conversation-turn']") as HTMLElement | null)?.outerHTML ?? node.outerHTML
      };
    }, role).catch(() => undefined);

    if (message !== undefined) {
      const args: ReadMessagesArgs = { role, format };
      if (maxChars !== undefined) args.maxChars = maxChars;
      return normalizeExtractedMessage(message, args);
    }
    return undefined;
  }

  const args: ReadMessagesArgs = { role, format };
  if (maxChars !== undefined) args.maxChars = maxChars;
  const messages = await readMessages(page, args);
  return messages.at(-1);
}

export async function readLatestMessageText(
  page: PageLike,
  role: MessageRole = "assistant"
): Promise<string | undefined> {
  if (typeof page.evaluate === "function") {
    return page.evaluate((wantedRole: MessageRole) => {
      const nodes = Array.from(document.querySelectorAll(`[data-message-author-role="${wantedRole}"]`));
      const node = nodes.at(-1) as HTMLElement | undefined;
      return node?.innerText ?? node?.textContent ?? undefined;
    }, role).catch(() => undefined);
  }

  return readLatestMessage(page, role, "normalized_text")
    .then(message => message?.text)
    .catch(() => undefined);
}

export async function readLatestMessageTextSnapshot(
  page: PageLike,
  role: MessageRole
): Promise<LatestMessageTextSnapshot> {
  if (typeof page.evaluate === "function") {
    return page.evaluate((wantedRole: MessageRole) => {
      const allNodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
      const roleNodes = allNodes.filter(node => node.getAttribute("data-message-author-role") === wantedRole);
      const latest = roleNodes.at(-1) as HTMLElement | undefined;
      const latestText = latest?.innerText ?? latest?.textContent ?? undefined;
      const snapshot: { latestText?: string; turnCount: number } = { turnCount: allNodes.length };
      if (latestText !== undefined) snapshot.latestText = latestText;
      return snapshot;
    }, role);
  }

  const messages = await readMessages(page, { role, format: "normalized_text" });
  const allMessages = await readMessages(page, { format: "normalized_text" });
  const snapshot: LatestMessageTextSnapshot = { turnCount: allMessages.length };
  const latestText = messages.at(-1)?.text;
  if (latestText !== undefined) snapshot.latestText = latestText;
  return snapshot;
}

export function isTransientAssistantText(text: string): boolean {
  const normalized = normalizeWhitespace(text)
    .replace(/[.。…]+$/g, "")
    .trim()
    .toLowerCase();

  return normalized === "thinking"
    || normalized === "reasoning"
    || normalized === "searching"
    || normalized === "searching the web"
    || /^analyzing (?:the )?images?$/.test(normalized)
    || /^processing (?:the )?images?$/.test(normalized)
    || /^reading (?:the )?images?$/.test(normalized);
}

export function countMessages(messages: ExtractedMessage[], role?: MessageRole): number {
  return role === undefined ? messages.length : messages.filter(message => message.role === role).length;
}

export async function countPageMessages(page: PageLike, role?: MessageRole): Promise<number> {
  if (typeof page.evaluate === "function") {
    return page.evaluate((wantedRole: MessageRole | undefined) => {
      const selector = wantedRole === undefined
        ? "[data-message-author-role]"
        : `[data-message-author-role="${wantedRole}"]`;
      return document.querySelectorAll(selector).length;
    }, role);
  }

  return countMessages(await readMessages(page), role);
}

function normalizeExtractedMessage(
  message: { role: MessageRole; html: string; metadataHtml?: string },
  args: ReadMessagesArgs = {}
): ExtractedMessage {
  const metadataHtml = message.role === "assistant" ? message.metadataHtml : undefined;
  const content = formatMessageHtml(message.html, normalizeResponseFormat(args.format), args.maxChars, metadataHtml);
  return { role: message.role, ...content };
}
