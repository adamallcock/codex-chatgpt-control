import type {
  ResponseAction,
  ResponseBlock,
  ResponseBranchState,
  ResponseCaptureLimit,
  ResponseCaptureFidelity,
  ResponseCaptureSource,
  ResponseCitation,
  ResponseCodeBlock,
  ResponseFormat,
  ResponseTable
} from "../types.js";
import { decodeBasicEntities, normalizeLineBreaks, normalizeWhitespace } from "./visible-text.js";

export type NormalizedResponseFormat = Exclude<ResponseFormat, "text">;

export type FormattedMessageContent = {
  text: string;
  format: NormalizedResponseFormat;
  source?: ResponseCaptureSource;
  fidelity?: ResponseCaptureFidelity;
  captureLimit?: ResponseCaptureLimit;
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

export type RoleMessageHtml = {
  role: "user" | "assistant";
  html: string;
  metadataHtml?: string;
};

type HtmlNode = HtmlElement | HtmlText;

type HtmlElement = {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
};

type HtmlText = {
  type: "text";
  text: string;
};

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const SKIPPED_TAGS = new Set(["button", "nav", "script", "style", "svg"]);
const BLOCK_TAGS = new Set([
  "article",
  "blockquote",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul"
]);

export function normalizeResponseFormat(format: ResponseFormat | undefined): NormalizedResponseFormat {
  if (format === undefined || format === "markdown") return "markdown";
  if (format === "text") return "normalized_text";
  return format;
}

export function extractRoleMessageHtml(html: string): RoleMessageHtml[] {
  const root = parseHtmlFragment(html);
  const messages: RoleMessageHtml[] = [];
  walkElementsWithAncestors(root, [], (element, ancestors) => {
    const role = element.attrs["data-message-author-role"];
    if (role === "user" || role === "assistant") {
      const metadataElement = [...ancestors]
        .reverse()
        .find(ancestor => ancestor.attrs["data-testid"]?.startsWith("conversation-turn")) ?? element;
      messages.push({ role, html: serializeChildren(element), metadataHtml: serializeNode(metadataElement) });
    }
  });
  return messages;
}

export function formatMessageHtml(
  html: string,
  requestedFormat: ResponseFormat | undefined = "markdown",
  maxChars?: number,
  metadataHtml?: string
): FormattedMessageContent {
  const format = normalizeResponseFormat(requestedFormat);
  const root = parseHtmlFragment(html);
  const meaningfulChildren = stripIgnorableNodes(root.children);
  const blocks = extractBlocks(meaningfulChildren);
  const rawMarkdown = blocksToMarkdown(blocks);
  const rawVisibleText = blocksToPlainText(blocks);
  const rawNormalizedText = normalizeWhitespace(rawVisibleText);
  const markdownCapture = applyCaptureLimit(rawMarkdown, maxChars);
  const visibleTextCapture = applyCaptureLimit(rawVisibleText, maxChars);
  const normalizedTextCapture = applyCaptureLimit(rawNormalizedText, maxChars);
  const markdown = markdownCapture.text;
  const visibleText = visibleTextCapture.text;
  const normalizedText = normalizedTextCapture.text;
  const citations = collectCitations(meaningfulChildren);
  const codeBlocks = blocks.flatMap(block => block.type === "code" ? [codeBlockFromBlock(block)] : []);
  const tables = blocks.flatMap(block => block.type === "table" ? [tableFromBlock(block)] : []);
  const metadata = extractResponseMetadata(metadataHtml ?? html);
  const captureLimit = captureLimitForFormat(format, {
    markdown: markdownCapture.captureLimit,
    visibleText: visibleTextCapture.captureLimit,
    normalizedText: normalizedTextCapture.captureLimit,
    html: applyCaptureLimit(html, maxChars).captureLimit
  });

  const content: FormattedMessageContent = {
    text: textForFormat(format, { markdown, visibleText, normalizedText, html }),
    format,
    source: "semantic_dom",
    fidelity: fidelityForDomFormat(format)
  };
  if (captureLimit !== undefined) content.captureLimit = captureLimit;
  const warnings = warningsForDomFormat(format);
  if (captureLimit?.clipped === true) warnings.push(captureLimitWarning(captureLimit));
  if (warnings.length > 0) content.warnings = warnings;

  if (format === "markdown" || format === "all") content.markdown = markdown;
  if (format === "visible_text" || format === "all") content.visibleText = visibleText;
  if (format === "normalized_text" || format === "all") content.normalizedText = normalizedText;
  if (format === "html" || format === "all") content.html = html;
  if (format === "blocks" || format === "all") content.blocks = blocks;
  if ((format === "markdown" || format === "blocks" || format === "all") && citations.length > 0) {
    content.citations = citations;
  }
  if ((format === "markdown" || format === "blocks" || format === "all") && codeBlocks.length > 0) {
    content.codeBlocks = codeBlocks;
  }
  if ((format === "markdown" || format === "blocks" || format === "all") && tables.length > 0) {
    content.tables = tables;
  }
  if (metadata.branch !== undefined) content.branch = metadata.branch;
  if (metadata.actions.length > 0) content.actions = metadata.actions;
  if (metadata.thoughtDurationText !== undefined) content.thoughtDurationText = metadata.thoughtDurationText;
  if (metadata.sourcesAvailable === true) content.sourcesAvailable = true;

  return content;
}

export function formatClipboardMarkdown(
  text: string,
  maxChars?: number,
  requestedFormat: ResponseFormat | undefined = "markdown"
): FormattedMessageContent {
  const format = normalizeResponseFormat(requestedFormat);
  const rawMarkdown = normalizeLineBreaks(text).trim();
  const rawNormalizedText = normalizeWhitespace(rawMarkdown);
  const markdownCapture = applyCaptureLimit(rawMarkdown, maxChars);
  const normalizedTextCapture = applyCaptureLimit(rawNormalizedText, maxChars);
  const markdown = markdownCapture.text;
  const visibleText = markdown;
  const normalizedText = normalizedTextCapture.text;
  const captureLimit = captureLimitForFormat(format, {
    markdown: markdownCapture.captureLimit,
    visibleText: markdownCapture.captureLimit,
    normalizedText: normalizedTextCapture.captureLimit,
    html: markdownCapture.captureLimit
  });
  const content: FormattedMessageContent = {
    text: textForFormat(format, { markdown, visibleText, normalizedText, html: markdown }),
    format,
    source: "clipboard",
    fidelity: "clipboard_markdown"
  };
  if (captureLimit !== undefined) content.captureLimit = captureLimit;
  if (captureLimit?.clipped === true) content.warnings = [captureLimitWarning(captureLimit)];
  if (format === "markdown" || format === "all") content.markdown = markdown;
  if (format === "visible_text" || format === "all") content.visibleText = visibleText;
  if (format === "normalized_text" || format === "all") content.normalizedText = normalizedText;
  return content;
}

function fidelityForDomFormat(format: NormalizedResponseFormat): ResponseCaptureFidelity {
  switch (format) {
    case "markdown":
      return "semantic_markdown";
    case "visible_text":
      return "visible_text";
    case "normalized_text":
      return "normalized_text";
    case "html":
      return "html";
    case "blocks":
      return "blocks";
    case "all":
      return "all";
  }
}

function warningsForDomFormat(format: NormalizedResponseFormat): string[] {
  if (format !== "markdown" && format !== "all") {
    return [];
  }
  return ["Markdown was reconstructed from visible DOM semantics; use response.copy for clipboard Markdown when exact copy fidelity is required."];
}

function applyCaptureLimit(text: string, maxChars: number | undefined): { text: string; captureLimit?: ResponseCaptureLimit } {
  if (maxChars === undefined) {
    return { text };
  }
  const captureLimit: ResponseCaptureLimit = {
    maxChars,
    originalChars: text.length,
    clipped: text.length > maxChars
  };
  return {
    text: captureLimit.clipped ? text.slice(0, maxChars) : text,
    captureLimit
  };
}

function captureLimitForFormat(
  format: NormalizedResponseFormat,
  limits: {
    markdown?: ResponseCaptureLimit | undefined;
    visibleText?: ResponseCaptureLimit | undefined;
    normalizedText?: ResponseCaptureLimit | undefined;
    html?: ResponseCaptureLimit | undefined;
  }
): ResponseCaptureLimit | undefined {
  switch (format) {
    case "markdown":
      return limits.markdown;
    case "visible_text":
      return limits.visibleText;
    case "normalized_text":
      return limits.normalizedText;
    case "html":
      return limits.html;
    case "blocks":
    case "all":
      return limits.markdown;
  }
}

function captureLimitWarning(captureLimit: ResponseCaptureLimit): string {
  return `Response captured text was clipped by maxChars=${captureLimit.maxChars} from ${captureLimit.originalChars} characters.`;
}

function textForFormat(
  format: NormalizedResponseFormat,
  values: { markdown: string; visibleText: string; normalizedText: string; html: string }
): string {
  switch (format) {
    case "markdown":
      return values.markdown;
    case "visible_text":
      return values.visibleText;
    case "normalized_text":
      return values.normalizedText;
    case "html":
      return values.normalizedText;
    case "blocks":
      return values.markdown;
    case "all":
      return values.markdown;
  }
}

function parseHtmlFragment(html: string): HtmlElement {
  const root: HtmlElement = { type: "element", tag: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const tokenRe = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;

  for (const match of html.matchAll(tokenRe)) {
    const token = match[0];
    const parent = stack.at(-1) ?? root;
    if (token.startsWith("<!--") || token.startsWith("<!")) {
      continue;
    }

    if (token.startsWith("</")) {
      const tag = /^<\/\s*([a-zA-Z0-9-]+)/.exec(token)?.[1]?.toLowerCase();
      if (tag === undefined) continue;
      while (stack.length > 1) {
        const current = stack.pop();
        if (current?.tag === tag) break;
      }
      continue;
    }

    if (token.startsWith("<")) {
      const tag = /^<\s*([a-zA-Z0-9-]+)/.exec(token)?.[1]?.toLowerCase();
      if (tag === undefined) continue;
      const element: HtmlElement = {
        type: "element",
        tag,
        attrs: parseAttrs(token),
        children: []
      };
      parent.children.push(element);
      if (!VOID_TAGS.has(tag) && !/\/\s*>$/.test(token)) {
        stack.push(element);
      }
      continue;
    }

    parent.children.push({ type: "text", text: decodeBasicEntities(token) });
  }

  return root;
}

function parseAttrs(token: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrText = token.replace(/^<\s*[^\s/>]+/, "").replace(/\/?>$/, "");
  const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const match of attrText.matchAll(attrRe)) {
    const key = match[1]?.toLowerCase();
    if (key === undefined) continue;
    attrs[key] = decodeBasicEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function walkElements(element: HtmlElement, visit: (element: HtmlElement) => void): void {
  visit(element);
  for (const child of element.children) {
    if (child.type === "element") walkElements(child, visit);
  }
}

function walkElementsWithAncestors(
  element: HtmlElement,
  ancestors: HtmlElement[],
  visit: (element: HtmlElement, ancestors: HtmlElement[]) => void
): void {
  visit(element, ancestors);
  for (const child of element.children) {
    if (child.type === "element") walkElementsWithAncestors(child, [...ancestors, element], visit);
  }
}

function serializeChildren(element: HtmlElement): string {
  return element.children.map(serializeNode).join("");
}

function serializeNode(node: HtmlNode): string {
  if (node.type === "text") return escapeHtml(node.text);
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => value.length > 0 ? ` ${key}="${escapeAttr(value)}"` : ` ${key}`)
    .join("");
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${serializeChildren(node)}</${node.tag}>`;
}

function stripIgnorableNodes(nodes: HtmlNode[]): HtmlNode[] {
  return nodes.filter(node => {
    if (node.type === "text") return node.text.trim().length > 0;
    return !SKIPPED_TAGS.has(node.tag) && nodeText(node).trim().length > 0;
  });
}

function extractBlocks(nodes: HtmlNode[]): ResponseBlock[] {
  const blocks: ResponseBlock[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const text = normalizeWhitespace(node.text);
      if (text.length > 0) blocks.push({ type: "paragraph", text });
      continue;
    }
    if (SKIPPED_TAGS.has(node.tag)) continue;
    blocks.push(...elementToBlocks(node));
  }
  return blocks.filter(block => blockToPlainText(block).length > 0);
}

function elementToBlocks(element: HtmlElement): ResponseBlock[] {
  if (/^h[1-6]$/.test(element.tag)) {
    return [{ type: "heading", depth: Number(element.tag.slice(1)), text: inlineText(element.children) }];
  }

  if (element.tag === "p") {
    return [{ type: "paragraph", text: inlineMarkdown(element.children) }];
  }

  if (element.tag === "ul" || element.tag === "ol") {
    return [{
      type: "list",
      ordered: element.tag === "ol",
      items: element.children
        .filter((child): child is HtmlElement => child.type === "element" && child.tag === "li")
        .map(item => markdownForListItem(item))
        .filter(Boolean)
    }];
  }

  if (element.tag === "pre") {
    const code = firstElement(element, "code") ?? element;
    const language = languageFromClass(code.attrs.class);
    const text = normalizeLineBreaks(nodeText(code)).replace(/^\n+|\n+$/g, "");
    const block: ResponseBlock = language === undefined
      ? { type: "code", text }
      : { type: "code", language, text };
    return [block];
  }

  if (element.tag === "table") {
    return [tableBlock(element)];
  }

  if (element.tag === "blockquote") {
    return [{ type: "quote", text: inlineMarkdown(element.children) }];
  }

  if (element.tag === "br") {
    return [];
  }

  const childBlocks = extractBlocks(element.children);
  if (childBlocks.length > 0 && hasBlockChild(element)) {
    return childBlocks;
  }

  const text = inlineMarkdown(element.children);
  return text.length > 0 ? [{ type: "paragraph", text }] : [];
}

function markdownForListItem(item: HtmlElement): string {
  const childBlocks = extractBlocks(item.children);
  if (childBlocks.length === 0) return inlineMarkdown(item.children);
  if (childBlocks.length === 1 && childBlocks[0]?.type === "paragraph") return childBlocks[0].text;
  return blocksToMarkdown(childBlocks);
}

function tableBlock(table: HtmlElement): ResponseBlock {
  const rows = descendants(table, "tr")
    .map(row => row.children.filter((child): child is HtmlElement => child.type === "element" && (child.tag === "th" || child.tag === "td")))
    .filter(cells => cells.length > 0);
  const firstHeaderRow = rows.find(cells => cells.some(cell => cell.tag === "th"));
  const headers = (firstHeaderRow ?? rows[0] ?? []).map(cell => inlineText(cell.children));
  const bodyRows = rows
    .filter(cells => cells !== firstHeaderRow)
    .map(cells => cells.map(cell => inlineText(cell.children)));
  return { type: "table", headers, rows: bodyRows };
}

function inlineMarkdown(nodes: HtmlNode[]): string {
  return normalizeInline(
    nodes.map(node => {
      if (node.type === "text") return node.text;
      if (SKIPPED_TAGS.has(node.tag)) return "";
      const child = inlineMarkdown(node.children);
      switch (node.tag) {
        case "a": {
          const href = node.attrs.href;
          if (href === undefined || href.length === 0) return child;
          const label = child.length > 0 ? child : href;
          return `[${escapeMarkdownLinkText(label)}](${href})`;
        }
        case "code":
          return `\`${nodeText(node).trim()}\``;
        case "strong":
        case "b":
          return child.length > 0 ? `**${child}**` : "";
        case "em":
        case "i":
          return child.length > 0 ? `*${child}*` : "";
        case "br":
          return "\n";
        default:
          return child;
      }
    }).join("")
  );
}

function inlineText(nodes: HtmlNode[]): string {
  return normalizeInline(
    nodes.map(node => {
      if (node.type === "text") return node.text;
      if (SKIPPED_TAGS.has(node.tag)) return "";
      if (node.tag === "br") return "\n";
      return inlineText(node.children);
    }).join("")
  );
}

function blocksToMarkdown(blocks: ResponseBlock[]): string {
  return blocks.map(blockToMarkdown).filter(Boolean).join("\n\n").trim();
}

function blockToMarkdown(block: ResponseBlock): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(Math.min(Math.max(block.depth, 1), 6))} ${block.text}`;
    case "paragraph":
      return block.text;
    case "list":
      return block.items.map((item, index) => block.ordered ? `${index + 1}. ${item}` : `- ${item}`).join("\n");
    case "code":
      return `\`\`\`${block.language ?? ""}\n${block.text}\n\`\`\``;
    case "table":
      return tableToMarkdown(block);
    case "quote":
      return block.text.split("\n").map(line => `> ${line}`).join("\n");
    case "unknown":
      return block.text;
  }
}

function tableToMarkdown(table: ResponseTable): string {
  const width = Math.max(table.headers.length, ...table.rows.map(row => row.length), 1);
  const headers = padCells(table.headers, width);
  const rows = table.rows.map(row => padCells(row, width));
  return [
    markdownTableRow(headers),
    markdownTableRow(headers.map(() => "---")),
    ...rows.map(markdownTableRow)
  ].join("\n");
}

function markdownTableRow(cells: string[]): string {
  return `| ${cells.map(cell => cell.replace(/\|/g, "\\|")).join(" | ")} |`;
}

function padCells(cells: string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => cells[index] ?? "");
}

function blocksToPlainText(blocks: ResponseBlock[]): string {
  return blocks.map(blockToPlainText).filter(Boolean).join("\n").trim();
}

function blockToPlainText(block: ResponseBlock): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "quote":
    case "unknown":
      return inlineMarkdownToPlainText(block.text);
    case "list":
      return block.items.map(inlineMarkdownToPlainText).join("\n");
    case "code":
      return block.text;
    case "table":
      return [block.headers.join(" "), ...block.rows.map(row => row.join(" "))].join("\n");
  }
}

function inlineMarkdownToPlainText(text: string): string {
  return normalizeWhitespace(text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1"));
}

function collectCitations(nodes: HtmlNode[]): ResponseCitation[] {
  const citations: ResponseCitation[] = [];
  for (const node of nodes) {
    if (node.type === "text" || SKIPPED_TAGS.has(node.tag)) continue;
    if (node.tag === "a" && node.attrs.href !== undefined && node.attrs.href.length > 0) {
      const text = inlineText(node.children) || node.attrs.href;
      citations.push({ text, href: node.attrs.href });
    }
    citations.push(...collectCitations(node.children));
  }
  return citations;
}

function extractResponseMetadata(html: string): {
  branch?: ResponseBranchState;
  actions: ResponseAction[];
  thoughtDurationText?: string;
  sourcesAvailable?: boolean;
} {
  const root = parseHtmlFragment(html);
  const text = normalizeWhitespace(metadataNodeText(root));
  const actions = collectResponseActions(root);
  const branch = extractBranchState(text, actions);
  const thoughtDurationText = /\bThought for\s+[^.。!?]+?(?=(?:\s+\d+\s*\/\s*\d+)|\s+Sources\b|$)/i.exec(text)?.[0];
  const sourcesAvailable = actions.some(action => action.type === "sources") || /\bSources\b/i.test(text);
  return {
    ...(branch === undefined ? {} : { branch }),
    actions,
    ...(thoughtDurationText === undefined ? {} : { thoughtDurationText }),
    ...(sourcesAvailable ? { sourcesAvailable: true } : {})
  };
}

function collectResponseActions(root: HtmlElement): ResponseAction[] {
  const actions: ResponseAction[] = [];
  walkElements(root, element => {
    if (element.tag !== "button" && element.tag !== "div") return;
    const ariaLabel = element.attrs["aria-label"];
    const text = inlineText(element.children);
    const label = normalizeWhitespace(ariaLabel ?? text);
    const type = responseActionType(label);
    if (type === undefined) return;
    const action: ResponseAction = { type, label };
    if (ariaLabel !== undefined) action.ariaLabel = ariaLabel;
    if (text.length > 0) action.text = text;
    if (element.attrs["data-testid"] !== undefined) action.testId = element.attrs["data-testid"];
    if (element.attrs.disabled !== undefined || element.attrs["aria-disabled"] === "true") action.disabled = true;
    actions.push(action);
  });
  return dedupeActions(actions);
}

function responseActionType(label: string): ResponseAction["type"] | undefined {
  if (/^previous response$/i.test(label)) return "previous_response";
  if (/^next response$/i.test(label)) return "next_response";
  if (/^copy response$/i.test(label)) return "copy_response";
  if (/^sources$/i.test(label) || /\bSources\b/.test(label)) return "sources";
  if (/^good response$/i.test(label)) return "good_response";
  if (/^bad response$/i.test(label)) return "bad_response";
  if (/^more actions$/i.test(label)) return "more_actions";
  return undefined;
}

function dedupeActions(actions: ResponseAction[]): ResponseAction[] {
  const seen = new Set<string>();
  const unique: ResponseAction[] = [];
  for (const action of actions) {
    const key = `${action.type}:${action.label}:${action.testId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(action);
  }
  return unique;
}

function extractBranchState(text: string, actions: ResponseAction[]): ResponseBranchState | undefined {
  const match = /\b(\d+)\s*\/\s*(\d+)\b/.exec(text);
  if (match === null) return undefined;
  const current = Number(match[1]);
  const total = Number(match[2]);
  const branch: ResponseBranchState = { label: match[0] };
  if (Number.isFinite(current)) branch.current = current;
  if (Number.isFinite(total)) branch.total = total;
  const previous = actions.find(action => action.type === "previous_response");
  const next = actions.find(action => action.type === "next_response");
  if (previous !== undefined) branch.canGoPrevious = previous.disabled !== true;
  if (next !== undefined) branch.canGoNext = next.disabled !== true;
  return branch;
}

function codeBlockFromBlock(block: ResponseBlock & { type: "code" }): ResponseCodeBlock {
  return block.language === undefined ? { text: block.text } : { language: block.language, text: block.text };
}

function tableFromBlock(block: ResponseBlock & { type: "table" }): ResponseTable {
  return { headers: block.headers, rows: block.rows };
}

function firstElement(element: HtmlElement, tag: string): HtmlElement | undefined {
  for (const child of element.children) {
    if (child.type === "element") {
      if (child.tag === tag) return child;
      const nested = firstElement(child, tag);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function descendants(element: HtmlElement, tag: string): HtmlElement[] {
  const found: HtmlElement[] = [];
  walkElements(element, child => {
    if (child.tag === tag) found.push(child);
  });
  return found;
}

function hasBlockChild(element: HtmlElement): boolean {
  return element.children.some(child => child.type === "element" && BLOCK_TAGS.has(child.tag));
}

function nodeText(node: HtmlNode): string {
  if (node.type === "text") return node.text;
  if (SKIPPED_TAGS.has(node.tag)) return "";
  if (node.tag === "br") return "\n";
  return node.children.map(nodeText).join("");
}

function metadataNodeText(node: HtmlNode): string {
  if (node.type === "text") return node.text;
  if (node.tag === "script" || node.tag === "style" || node.tag === "svg") return "";
  if (node.tag === "br") return "\n";
  return node.children.map(metadataNodeText).join(" ");
}

function languageFromClass(className: string | undefined): string | undefined {
  return className?.split(/\s+/).find(name => name.startsWith("language-"))?.slice("language-".length);
}

function normalizeInline(text: string): string {
  return decodeBasicEntities(text)
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/]/g, "\\]");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}
