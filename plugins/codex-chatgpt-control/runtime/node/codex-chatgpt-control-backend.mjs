#!/usr/bin/env node

// src/backend/stdio-server.ts
import { createInterface } from "node:readline";

// src/commands/artifacts.ts
import { copyFile, mkdir as mkdir2, stat as stat2, writeFile } from "node:fs/promises";
import { basename as basename2, join as join2, resolve as resolve2 } from "node:path";

// src/browser/downloads.ts
import { mkdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

// src/commands/timeouts.ts
async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), Math.max(0, timeoutMs));
      })
    ]);
  } finally {
    if (timeout !== void 0) clearTimeout(timeout);
  }
}
function localGuardTimeout(timeoutMs, capMs) {
  return Math.max(1, Math.min(timeoutMs ?? capMs, capMs));
}

// src/browser/downloads.ts
async function waitForDownloadFromClick(page, click, destDir, timeoutMs) {
  const absoluteDest = resolve(destDir);
  await mkdir(absoluteDest, { recursive: true });
  const downloadPromise = page.waitForEvent?.("download", { timeout: timeoutMs, timeoutMs });
  if (downloadPromise === void 0) {
    throw new Error("The active browser page does not expose download events.");
  }
  await withTimeout(
    click(),
    localGuardTimeout(timeoutMs, 1e4),
    "Download control click did not complete before the local guard timeout."
  );
  const download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename?.() ?? `chatgpt-download-${Date.now()}`;
  const targetPath = join(absoluteDest, basename(suggestedFilename));
  if (typeof download.saveAs === "function") {
    await download.saveAs(targetPath);
  } else {
    throw new Error("The browser download object does not expose saveAs().");
  }
  const saved = await stat(targetPath);
  if (saved.size <= 0) {
    throw new Error(`Downloaded file is empty: ${targetPath}`);
  }
  return {
    path: targetPath,
    suggestedFilename,
    bytes: saved.size
  };
}

// src/safety/redaction.ts
var EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
var PHONE_RE = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
var TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
var PATH_RE = /(?:\/Users\/|\/home\/|\/example\/user\/)[^\s"'<>]+/g;
function redactSensitiveText(text) {
  return text.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, "[redacted-phone]").replace(PATH_RE, "[redacted-path]").replace(TOKEN_RE, "[redacted-token]");
}
function compactVisibleText(text, maxLength = 1e3) {
  const compacted = redactSensitiveText(text.replace(/\s+/g, " ").trim());
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, maxLength - 1)}...`;
}

// src/safety/blockers.ts
var RULES = [
  {
    kind: "login_required",
    message: "ChatGPT requires the user to sign in before continuing.",
    patterns: [/\blog\s?in\b/i, /\bsign\s?in\b/i, /\bwelcome back\b/i]
  },
  {
    kind: "captcha",
    message: "ChatGPT is showing a captcha or suspicious-activity challenge.",
    patterns: [/\bcaptcha\b/i, /verify (?:you are|that you are) human/i, /suspicious activity/i]
  },
  {
    kind: "rate_limit",
    message: "ChatGPT is rate limited or out of usage for this account.",
    patterns: [/usage limit/i, /rate limit/i, /try again later/i, /too many requests/i]
  },
  {
    kind: "permission",
    message: "File upload permission is required. Ask the user to enable both: Codex Settings > Computer Use > Chrome > Permissions > Uploads, and Chrome chrome://extensions > Codex extension > Details > Allow access to file URLs.",
    patterns: [/allow access to file urls/i, /file upload permission/i, /fileChooser\.setFiles/i]
  },
  {
    kind: "permission",
    message: "A browser or ChatGPT permission is required before continuing.",
    patterns: [/permission denied/i, /browser blocked/i]
  },
  {
    kind: "upload_failed",
    message: "ChatGPT reported a file upload failure.",
    patterns: [/upload failed/i, /could(?: not|n't) upload/i, /unsupported file/i, /file is too large/i]
  },
  {
    kind: "download_unavailable",
    message: "No downloadable file or download control is visible.",
    patterns: [/download unavailable/i, /no download/i]
  },
  {
    kind: "not_found",
    message: "The requested ChatGPT conversation or page was not found.",
    patterns: [/conversation not found/i, /404/i, /page not found/i]
  }
];
function classifyVisibleText(text) {
  const visibleText = compactVisibleText(text);
  const lowerable = visibleText.length > 0 ? visibleText : text;
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(lowerable))) {
      return { kind: rule.kind, message: rule.message, visibleText };
    }
  }
  if (/\b(confirm|continue|cancel|dismiss)\b/i.test(lowerable) && /\bdialog\b|\bmodal\b/i.test(lowerable)) {
    return {
      kind: "modal",
      message: "ChatGPT is showing a modal dialog that may require user action.",
      visibleText
    };
  }
  return void 0;
}

// src/browser/page-state.ts
function parseConversationId(url) {
  const match = /\/c\/([A-Za-z0-9-]+)/.exec(url);
  return match?.[1];
}
async function readPageState(page) {
  const rawUrl = typeof page.url === "function" ? await Promise.resolve(page.url()).catch(() => "") : "";
  const url = typeof rawUrl === "string" ? rawUrl : "";
  const rawTitle = typeof page.title === "function" ? await page.title().catch(() => void 0) : void 0;
  const title = typeof rawTitle === "string" ? rawTitle : void 0;
  const visibleText = await readVisibleText(page);
  const blocker = classifyVisibleText(visibleText);
  const signedIn = isLikelySignedIn(visibleText) && blocker?.kind !== "login_required";
  const conversationId = parseConversationId(url);
  const state = {
    url,
    visibleText: compactVisibleText(visibleText),
    signedIn
  };
  if (conversationId !== void 0) {
    state.conversationId = conversationId;
  }
  if (title !== void 0) {
    state.title = title;
  }
  if (blocker !== void 0) {
    state.blocker = blocker;
  }
  return state;
}
async function readVisibleText(page) {
  if (typeof page.evaluate === "function") {
    try {
      return await withTimeout(
        page.evaluate(() => document.body?.innerText ?? ""),
        1e3,
        "Timed out while reading visible page text."
      );
    } catch {
    }
  }
  if (typeof page.content === "function") {
    try {
      const html = await withTimeout(
        page.content(),
        1e3,
        "Timed out while reading page content."
      );
      return htmlToText(html);
    } catch {
      return "";
    }
  }
  return "";
}
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
function isLikelySignedIn(visibleText) {
  return /\b(New chat|Search chats|Chat with ChatGPT|Recents|Projects)\b/i.test(visibleText);
}

// src/dom/artifacts.ts
async function listPageArtifacts(page, args = {}) {
  const timeoutMs = localGuardTimeout(args.timeoutMs, 5e3);
  let artifacts;
  let evaluateError;
  if (typeof page.evaluate === "function") {
    artifacts = await withTimeout(
      page.evaluate(() => {
        const images = Array.from(document.querySelectorAll("main img"));
        return images.map((image, index) => {
          const rect = image.getBoundingClientRect();
          const style = window.getComputedStyle(image);
          const width = Math.round(rect.width || image.naturalWidth || image.width || 0);
          const height = Math.round(rect.height || image.naturalHeight || image.height || 0);
          const alt = image.getAttribute("alt") ?? void 0;
          const src = image.currentSrc || image.src || void 0;
          const ariaLabel = image.getAttribute("aria-label") ?? image.closest("[aria-label]")?.getAttribute("aria-label") ?? void 0;
          const visible = width > 0 && height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
          const likelyGenerated = visible && !image.closest("nav, aside, header, footer, form, [contenteditable='true'], textarea") && (width >= 96 || height >= 96 || /^data:image\//i.test(src ?? "") || /^blob:/i.test(src ?? "") || /\b(generated|image|photo|picture)\b/i.test(`${alt ?? ""} ${ariaLabel ?? ""}`));
          if (!likelyGenerated) return void 0;
          const container = image.closest("figure, [data-testid*='image' i], [aria-label*='image' i], [role='group'], [data-testid^='conversation-turn']") ?? image.parentElement;
          const scopedDownload = container?.querySelector("a[download], button[aria-label*='Download' i], a[aria-label*='Download' i]");
          const globalDownload = document.querySelector("main button[aria-label*='Download image' i], main a[aria-label*='Download image' i]");
          const turnNode = image.closest("[data-testid^='conversation-turn']");
          const artifact = {
            kind: "image",
            index,
            visible,
            width,
            height,
            downloadAvailable: Boolean(scopedDownload ?? globalDownload),
            selectorProvenance: "main generated image"
          };
          if (alt !== void 0) artifact.alt = alt;
          if (ariaLabel !== void 0) artifact.ariaLabel = ariaLabel;
          const safeSrc = safeArtifactSrc(src);
          if (safeSrc !== void 0) artifact.src = safeSrc;
          const turnId = turnNode?.getAttribute("data-testid") ?? void 0;
          if (turnId !== void 0) artifact.turnId = turnId;
          return artifact;
        }).filter((artifact) => artifact !== void 0);
      }),
      timeoutMs,
      "Timed out while inspecting visible ChatGPT artifacts."
    ).catch((error) => {
      evaluateError = error;
      return void 0;
    });
  }
  if (artifacts === void 0 && typeof page.content !== "function" && evaluateError !== void 0) {
    throw evaluateError;
  }
  const filtered = filterArtifacts(artifacts ?? await listArtifactsFromContent(page, timeoutMs), args);
  return filtered.map((artifact, index) => ({ ...artifact, index }));
}
async function readLatestImageDataUrl(page, timeoutMs) {
  const guardMs = localGuardTimeout(timeoutMs, 5e3);
  if (typeof page.evaluate === "function") {
    const fromDom = await withTimeout(
      page.evaluate(async () => {
        const images = Array.from(document.querySelectorAll("main img"));
        const candidates = images.filter((image2) => {
          const rect = image2.getBoundingClientRect();
          const width = rect.width || image2.naturalWidth || image2.width || 0;
          const height = rect.height || image2.naturalHeight || image2.height || 0;
          const src2 = image2.currentSrc || image2.src || "";
          const label = `${image2.getAttribute("alt") ?? ""} ${image2.closest("[aria-label]")?.getAttribute("aria-label") ?? ""}`;
          return !image2.closest("nav, aside, header, footer, form, [contenteditable='true'], textarea") && (width >= 96 || height >= 96 || /^data:image\//i.test(src2) || /^blob:/i.test(src2) || /\b(generated|image|photo|picture)\b/i.test(label));
        });
        const image = candidates.at(-1);
        if (image === void 0) return void 0;
        const src = image.currentSrc || image.src;
        if (/^data:image\//i.test(src)) {
          const alt = image.getAttribute("alt") ?? void 0;
          return alt === void 0 ? { dataUrl: src } : { dataUrl: src, alt };
        }
        if (/^(blob:|https?:)/i.test(src)) {
          const response = await fetch(src);
          const blob = await response.blob();
          const dataUrl = await new Promise((resolve4, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve4(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error("FileReader failed."));
            reader.readAsDataURL(blob);
          });
          const alt = image.getAttribute("alt") ?? void 0;
          return alt === void 0 ? { dataUrl } : { dataUrl, alt };
        }
        return void 0;
      }),
      guardMs,
      "Timed out while reading the visible generated image source."
    ).catch(() => void 0);
    if (fromDom !== void 0) return fromDom;
  }
  const html = await readContentWithTimeout(page, guardMs).catch(() => void 0);
  if (html === void 0) return void 0;
  const artifact = parseArtifactsFromHtml(html).at(-1);
  if (artifact?.src === void 0 || !/^data:image\//i.test(artifact.src)) return void 0;
  return artifact.alt === void 0 ? { dataUrl: artifact.src } : { dataUrl: artifact.src, alt: artifact.alt };
}
async function listArtifactsFromContent(page, timeoutMs) {
  const html = await readContentWithTimeout(page, timeoutMs).catch(() => void 0);
  return html === void 0 ? [] : parseArtifactsFromHtml(html);
}
function parseArtifactsFromHtml(html) {
  const hasDownload = /<a\b[^>]*\sdownload(?:\s|=|>)/i.test(html) || /\baria-label=["'][^"']*download[^"']*["']/i.test(html);
  const artifacts = [];
  const imagePattern = /<img\b[^>]*>/gi;
  let match;
  while ((match = imagePattern.exec(html)) !== null) {
    const tag = match[0] ?? "";
    const src = attr(tag, "src");
    const alt = attr(tag, "alt");
    const ariaLabel = attr(tag, "aria-label");
    const width = numberAttr(tag, "width");
    const height = numberAttr(tag, "height");
    const label = `${alt ?? ""} ${ariaLabel ?? ""}`;
    const likelyGenerated = (width ?? 0) >= 96 || (height ?? 0) >= 96 || /^data:image\//i.test(src ?? "") || /^blob:/i.test(src ?? "") || /\b(generated|image|photo|picture)\b/i.test(label);
    if (!likelyGenerated) continue;
    const artifact = {
      kind: "image",
      index: artifacts.length,
      visible: true,
      downloadAvailable: hasDownload,
      selectorProvenance: "main generated image"
    };
    const safeSrc = safeArtifactSrc(src);
    if (safeSrc !== void 0) artifact.src = safeSrc;
    if (alt !== void 0) artifact.alt = alt;
    if (ariaLabel !== void 0) artifact.ariaLabel = ariaLabel;
    if (width !== void 0) artifact.width = width;
    if (height !== void 0) artifact.height = height;
    artifacts.push(artifact);
  }
  return artifacts;
}
function filterArtifacts(artifacts, args) {
  const kind = args.kind ?? "image";
  const max = args.max ?? artifacts.length;
  return artifacts.filter((artifact) => artifact.kind === kind).slice(-max);
}
async function readContentWithTimeout(page, timeoutMs) {
  if (typeof page.content !== "function") return "";
  return withTimeout(page.content(), timeoutMs, "Timed out while reading ChatGPT page content.");
}
function attr(tag, name) {
  const match = new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i").exec(tag);
  return match?.[2];
}
function numberAttr(tag, name) {
  const value = attr(tag, name);
  if (value === void 0) return void 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function safeArtifactSrc(src) {
  if (src === void 0) return void 0;
  if (/^https:\/\/chatgpt\.com\/backend-api\/estuary\/content\b/i.test(src)) {
    return void 0;
  }
  return src;
}

// src/dom/selectors.ts
var cssSelectors = {
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
  ].join(", "),
  generatedArtifactDownloadControls: [
    "main figure button[aria-label*='Download' i]",
    "main figure a[aria-label*='Download' i]",
    "main [data-testid*='image' i] button[aria-label*='Download' i]",
    "main [data-testid*='image' i] a[aria-label*='Download' i]",
    "main [aria-label*='image' i] button[aria-label*='Download' i]",
    "main [aria-label*='image' i] a[aria-label*='Download' i]",
    "main button[aria-label='Download image' i]",
    "main a[aria-label='Download image' i]",
    "main a[download][href^='blob:']",
    "main a[download][href^='data:image/']"
  ].join(", ")
};
function composerTextbox(page) {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "[contenteditable='true'], textarea");
  }
  return page.getByRole("textbox", { name: "Chat with ChatGPT" });
}
function sendButton(page) {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button[aria-label*='Send']");
  }
  return page.getByRole("button", { name: "Send prompt" });
}
function searchChatsButton(page) {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button");
  }
  return page.getByRole("button", { name: "Search chats" });
}
function searchChatsInput(page) {
  if (typeof page.getByPlaceholder === "function") {
    return page.getByPlaceholder("Search chats...");
  }
  return requiredLocator(page, "input[placeholder*='Search chats']");
}
function newChatButton(page) {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "a[href='/'], button");
  }
  return page.getByRole("button", { name: "New chat" });
}
function addFilesButton(page) {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button[aria-label*='Add']");
  }
  return page.getByRole("button", { name: "Add files and more" });
}
function copyResponseButtons(page) {
  if (typeof page.getByRole !== "function") {
    return requiredLocator(page, "button[aria-label*='Copy response']");
  }
  return page.getByRole("button", { name: "Copy response" });
}
function requiredLocator(page, selector) {
  if (typeof page.locator !== "function") {
    throw new Error(`Page does not support locator("${selector}")`);
  }
  return page.locator(selector);
}

// src/errors.ts
var BROWSER_BRIDGE_UNAVAILABLE_MESSAGE = "Codex cannot access the ChatGPT browser bridge from this backend process. In an ordinary shell this is expected; for a live Codex Chrome run, bootstrap the Chrome plugin runtime with setupBrowserRuntime({ globals: globalThis }) before using globalThis.agent.";
var BROWSER_BRIDGE_REMEDIATION = [
  {
    label: "Ordinary shell",
    instruction: "Treat browser_bridge_unavailable from a plain shell as an expected protocol/blocker-path result, not proof that Chrome, ChatGPT, or the Codex extension is broken.",
    userActionRequired: false
  },
  {
    label: "Codex Chrome bootstrap",
    instruction: 'For a live run, initialize the Chrome plugin runtime in node_repl with setupBrowserRuntime({ globals: globalThis }), then set globalThis.browser = await agent.browsers.get("extension") before calling createChatGPT({ agent: globalThis.agent }).',
    userActionRequired: false
  },
  {
    label: "Python live bridge",
    instruction: "For Python browser-bridge smokes, keep the bridge-hosted Node backend JS execution alive and run scripts/http_stdio_relay.mjs with CHATGPT_BROWSER_BACKEND_HTTP_URL; a plain Python-spawned Node subprocess cannot inherit globalThis.agent.",
    userActionRequired: false
  },
  {
    label: "Extension availability",
    instruction: "If this command was already running inside a bootstrapped bridge host, verify the Codex Chrome extension is installed and enabled, then restart Chrome or Codex before retrying.",
    userActionRequired: true
  }
];
var ChatGPTControlError = class extends Error {
  constructor(message, kind, recoverable, visibleText, blockerDetails = {}) {
    super(message);
    this.kind = kind;
    this.recoverable = recoverable;
    this.visibleText = visibleText;
    this.blockerDetails = blockerDetails;
    this.name = new.target.name;
  }
  kind;
  recoverable;
  visibleText;
  blockerDetails;
};
var BrowserBridgeUnavailableError = class extends ChatGPTControlError {
  constructor(message = BROWSER_BRIDGE_UNAVAILABLE_MESSAGE) {
    super(message, "browser_bridge_unavailable", true, void 0, {
      code: "codex_chrome_bridge_unavailable",
      remediation: BROWSER_BRIDGE_REMEDIATION
    });
  }
};
var LoginRequiredError = class extends ChatGPTControlError {
  constructor(visibleText) {
    super("ChatGPT login is required before this command can continue.", "login_required", true, visibleText);
  }
};
function contextNow(partial = {}) {
  return {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    ...partial
  };
}
function resultOk(data, context = {}, warnings = []) {
  return {
    ok: true,
    status: "ok",
    data,
    warnings,
    context: contextNow(context)
  };
}
function resultError(error, context = {}, recoverable = error instanceof ChatGPTControlError ? error.recoverable : false) {
  const blocker = error instanceof ChatGPTControlError ? error.visibleText === void 0 ? {
    kind: error.kind,
    message: error.message,
    ...error.blockerDetails
  } : {
    kind: error.kind,
    message: error.message,
    visibleText: error.visibleText,
    ...error.blockerDetails
  } : void 0;
  const result = {
    ok: false,
    status: blocker ? "blocked" : "error",
    warnings: [],
    error: {
      name: error.name,
      message: error.message,
      recoverable
    },
    context: contextNow(context)
  };
  if (blocker !== void 0) {
    result.blocker = blocker;
  }
  return result;
}

// src/dom/visible-text.ts
function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}
function normalizeLineBreaks(text) {
  return text.replace(/\r\n?/g, "\n");
}
function decodeBasicEntities(text) {
  return text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function stripTags(html) {
  return normalizeWhitespace(
    decodeBasicEntities(
      html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<button[\s\S]*?<\/button>/gi, " ").replace(/<nav[\s\S]*?<\/nav>/gi, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<[^>]+>/g, " ")
    )
  );
}
function normalizeLabel(text) {
  return normalizeWhitespace(text).toLowerCase();
}

// src/dom/message-format.ts
var VOID_TAGS = /* @__PURE__ */ new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
var SKIPPED_TAGS = /* @__PURE__ */ new Set(["button", "nav", "script", "style", "svg"]);
var BLOCK_TAGS = /* @__PURE__ */ new Set([
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
function normalizeResponseFormat(format) {
  if (format === void 0 || format === "markdown") return "markdown";
  if (format === "text") return "normalized_text";
  return format;
}
function extractRoleMessageHtml(html) {
  const root = parseHtmlFragment(html);
  const messages = [];
  walkElementsWithAncestors(root, [], (element, ancestors) => {
    const role = element.attrs["data-message-author-role"];
    if (role === "user" || role === "assistant") {
      const metadataElement = [...ancestors].reverse().find((ancestor) => ancestor.attrs["data-testid"]?.startsWith("conversation-turn")) ?? element;
      messages.push({ role, html: serializeChildren(element), metadataHtml: serializeNode(metadataElement) });
    }
  });
  return messages;
}
function formatMessageHtml(html, requestedFormat = "markdown", maxChars, metadataHtml) {
  const format = normalizeResponseFormat(requestedFormat);
  const root = parseHtmlFragment(html);
  const meaningfulChildren = stripIgnorableNodes(root.children);
  const blocks = extractBlocks(meaningfulChildren);
  const markdown = clamp(blocksToMarkdown(blocks), maxChars);
  const visibleText = clamp(blocksToPlainText(blocks), maxChars);
  const normalizedText = clamp(normalizeWhitespace(visibleText), maxChars);
  const citations = collectCitations(meaningfulChildren);
  const codeBlocks = blocks.flatMap((block) => block.type === "code" ? [codeBlockFromBlock(block)] : []);
  const tables = blocks.flatMap((block) => block.type === "table" ? [tableFromBlock(block)] : []);
  const metadata = extractResponseMetadata(metadataHtml ?? html);
  const content = {
    text: textForFormat(format, { markdown, visibleText, normalizedText, html }),
    format,
    source: "semantic_dom",
    fidelity: fidelityForDomFormat(format)
  };
  const warnings = warningsForDomFormat(format);
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
  if (metadata.branch !== void 0) content.branch = metadata.branch;
  if (metadata.actions.length > 0) content.actions = metadata.actions;
  if (metadata.thoughtDurationText !== void 0) content.thoughtDurationText = metadata.thoughtDurationText;
  if (metadata.sourcesAvailable === true) content.sourcesAvailable = true;
  return content;
}
function formatClipboardMarkdown(text, maxChars, requestedFormat = "markdown") {
  const format = normalizeResponseFormat(requestedFormat);
  const markdown = clamp(normalizeLineBreaks(text).trim(), maxChars);
  const visibleText = markdown;
  const normalizedText = clamp(normalizeWhitespace(markdown), maxChars);
  const content = {
    text: textForFormat(format, { markdown, visibleText, normalizedText, html: markdown }),
    format,
    source: "clipboard",
    fidelity: "clipboard_markdown"
  };
  if (format === "markdown" || format === "all") content.markdown = markdown;
  if (format === "visible_text" || format === "all") content.visibleText = visibleText;
  if (format === "normalized_text" || format === "all") content.normalizedText = normalizedText;
  return content;
}
function fidelityForDomFormat(format) {
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
function warningsForDomFormat(format) {
  if (format !== "markdown" && format !== "all") {
    return [];
  }
  return ["Markdown was reconstructed from visible DOM semantics; use response.copy for clipboard Markdown when exact copy fidelity is required."];
}
function textForFormat(format, values) {
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
function parseHtmlFragment(html) {
  const root = { type: "element", tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const tokenRe = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;
  for (const match of html.matchAll(tokenRe)) {
    const token = match[0];
    const parent = stack.at(-1) ?? root;
    if (token.startsWith("<!--") || token.startsWith("<!")) {
      continue;
    }
    if (token.startsWith("</")) {
      const tag = /^<\/\s*([a-zA-Z0-9-]+)/.exec(token)?.[1]?.toLowerCase();
      if (tag === void 0) continue;
      while (stack.length > 1) {
        const current = stack.pop();
        if (current?.tag === tag) break;
      }
      continue;
    }
    if (token.startsWith("<")) {
      const tag = /^<\s*([a-zA-Z0-9-]+)/.exec(token)?.[1]?.toLowerCase();
      if (tag === void 0) continue;
      const element = {
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
function parseAttrs(token) {
  const attrs = {};
  const attrText = token.replace(/^<\s*[^\s/>]+/, "").replace(/\/?>$/, "");
  const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const match of attrText.matchAll(attrRe)) {
    const key = match[1]?.toLowerCase();
    if (key === void 0) continue;
    attrs[key] = decodeBasicEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}
function walkElements(element, visit) {
  visit(element);
  for (const child of element.children) {
    if (child.type === "element") walkElements(child, visit);
  }
}
function walkElementsWithAncestors(element, ancestors, visit) {
  visit(element, ancestors);
  for (const child of element.children) {
    if (child.type === "element") walkElementsWithAncestors(child, [...ancestors, element], visit);
  }
}
function serializeChildren(element) {
  return element.children.map(serializeNode).join("");
}
function serializeNode(node) {
  if (node.type === "text") return escapeHtml(node.text);
  const attrs = Object.entries(node.attrs).map(([key, value]) => value.length > 0 ? ` ${key}="${escapeAttr(value)}"` : ` ${key}`).join("");
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${serializeChildren(node)}</${node.tag}>`;
}
function stripIgnorableNodes(nodes) {
  return nodes.filter((node) => {
    if (node.type === "text") return node.text.trim().length > 0;
    return !SKIPPED_TAGS.has(node.tag) && nodeText(node).trim().length > 0;
  });
}
function extractBlocks(nodes) {
  const blocks = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const text = normalizeWhitespace(node.text);
      if (text.length > 0) blocks.push({ type: "paragraph", text });
      continue;
    }
    if (SKIPPED_TAGS.has(node.tag)) continue;
    blocks.push(...elementToBlocks(node));
  }
  return blocks.filter((block) => blockToPlainText(block).length > 0);
}
function elementToBlocks(element) {
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
      items: element.children.filter((child) => child.type === "element" && child.tag === "li").map((item) => markdownForListItem(item)).filter(Boolean)
    }];
  }
  if (element.tag === "pre") {
    const code = firstElement(element, "code") ?? element;
    const language = languageFromClass(code.attrs.class);
    const text2 = normalizeLineBreaks(nodeText(code)).replace(/^\n+|\n+$/g, "");
    const block = language === void 0 ? { type: "code", text: text2 } : { type: "code", language, text: text2 };
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
function markdownForListItem(item) {
  const childBlocks = extractBlocks(item.children);
  if (childBlocks.length === 0) return inlineMarkdown(item.children);
  if (childBlocks.length === 1 && childBlocks[0]?.type === "paragraph") return childBlocks[0].text;
  return blocksToMarkdown(childBlocks);
}
function tableBlock(table) {
  const rows = descendants(table, "tr").map((row) => row.children.filter((child) => child.type === "element" && (child.tag === "th" || child.tag === "td"))).filter((cells) => cells.length > 0);
  const firstHeaderRow = rows.find((cells) => cells.some((cell) => cell.tag === "th"));
  const headers = (firstHeaderRow ?? rows[0] ?? []).map((cell) => inlineText(cell.children));
  const bodyRows = rows.filter((cells) => cells !== firstHeaderRow).map((cells) => cells.map((cell) => inlineText(cell.children)));
  return { type: "table", headers, rows: bodyRows };
}
function inlineMarkdown(nodes) {
  return normalizeInline(
    nodes.map((node) => {
      if (node.type === "text") return node.text;
      if (SKIPPED_TAGS.has(node.tag)) return "";
      const child = inlineMarkdown(node.children);
      switch (node.tag) {
        case "a": {
          const href = node.attrs.href;
          if (href === void 0 || href.length === 0) return child;
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
function inlineText(nodes) {
  return normalizeInline(
    nodes.map((node) => {
      if (node.type === "text") return node.text;
      if (SKIPPED_TAGS.has(node.tag)) return "";
      if (node.tag === "br") return "\n";
      return inlineText(node.children);
    }).join("")
  );
}
function blocksToMarkdown(blocks) {
  return blocks.map(blockToMarkdown).filter(Boolean).join("\n\n").trim();
}
function blockToMarkdown(block) {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(Math.min(Math.max(block.depth, 1), 6))} ${block.text}`;
    case "paragraph":
      return block.text;
    case "list":
      return block.items.map((item, index) => block.ordered ? `${index + 1}. ${item}` : `- ${item}`).join("\n");
    case "code":
      return `\`\`\`${block.language ?? ""}
${block.text}
\`\`\``;
    case "table":
      return tableToMarkdown(block);
    case "quote":
      return block.text.split("\n").map((line) => `> ${line}`).join("\n");
    case "unknown":
      return block.text;
  }
}
function tableToMarkdown(table) {
  const width = Math.max(table.headers.length, ...table.rows.map((row) => row.length), 1);
  const headers = padCells(table.headers, width);
  const rows = table.rows.map((row) => padCells(row, width));
  return [
    markdownTableRow(headers),
    markdownTableRow(headers.map(() => "---")),
    ...rows.map(markdownTableRow)
  ].join("\n");
}
function markdownTableRow(cells) {
  return `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`;
}
function padCells(cells, width) {
  return Array.from({ length: width }, (_, index) => cells[index] ?? "");
}
function blocksToPlainText(blocks) {
  return blocks.map(blockToPlainText).filter(Boolean).join("\n").trim();
}
function blockToPlainText(block) {
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
      return [block.headers.join(" "), ...block.rows.map((row) => row.join(" "))].join("\n");
  }
}
function inlineMarkdownToPlainText(text) {
  return normalizeWhitespace(text.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1"));
}
function collectCitations(nodes) {
  const citations = [];
  for (const node of nodes) {
    if (node.type === "text" || SKIPPED_TAGS.has(node.tag)) continue;
    if (node.tag === "a" && node.attrs.href !== void 0 && node.attrs.href.length > 0) {
      const text = inlineText(node.children) || node.attrs.href;
      citations.push({ text, href: node.attrs.href });
    }
    citations.push(...collectCitations(node.children));
  }
  return citations;
}
function extractResponseMetadata(html) {
  const root = parseHtmlFragment(html);
  const text = normalizeWhitespace(metadataNodeText(root));
  const actions = collectResponseActions(root);
  const branch = extractBranchState(text, actions);
  const thoughtDurationText = /\bThought for\s+[^.。!?]+?(?=(?:\s+\d+\s*\/\s*\d+)|\s+Sources\b|$)/i.exec(text)?.[0];
  const sourcesAvailable = actions.some((action) => action.type === "sources") || /\bSources\b/i.test(text);
  return {
    ...branch === void 0 ? {} : { branch },
    actions,
    ...thoughtDurationText === void 0 ? {} : { thoughtDurationText },
    ...sourcesAvailable ? { sourcesAvailable: true } : {}
  };
}
function collectResponseActions(root) {
  const actions = [];
  walkElements(root, (element) => {
    if (element.tag !== "button" && element.tag !== "div") return;
    const ariaLabel = element.attrs["aria-label"];
    const text = inlineText(element.children);
    const label = normalizeWhitespace(ariaLabel ?? text);
    const type = responseActionType(label);
    if (type === void 0) return;
    const action = { type, label };
    if (ariaLabel !== void 0) action.ariaLabel = ariaLabel;
    if (text.length > 0) action.text = text;
    if (element.attrs["data-testid"] !== void 0) action.testId = element.attrs["data-testid"];
    if (element.attrs.disabled !== void 0 || element.attrs["aria-disabled"] === "true") action.disabled = true;
    actions.push(action);
  });
  return dedupeActions(actions);
}
function responseActionType(label) {
  if (/^previous response$/i.test(label)) return "previous_response";
  if (/^next response$/i.test(label)) return "next_response";
  if (/^copy response$/i.test(label)) return "copy_response";
  if (/^sources$/i.test(label) || /\bSources\b/.test(label)) return "sources";
  if (/^good response$/i.test(label)) return "good_response";
  if (/^bad response$/i.test(label)) return "bad_response";
  if (/^more actions$/i.test(label)) return "more_actions";
  return void 0;
}
function dedupeActions(actions) {
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const action of actions) {
    const key = `${action.type}:${action.label}:${action.testId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(action);
  }
  return unique;
}
function extractBranchState(text, actions) {
  const match = /\b(\d+)\s*\/\s*(\d+)\b/.exec(text);
  if (match === null) return void 0;
  const current = Number(match[1]);
  const total = Number(match[2]);
  const branch = { label: match[0] };
  if (Number.isFinite(current)) branch.current = current;
  if (Number.isFinite(total)) branch.total = total;
  const previous = actions.find((action) => action.type === "previous_response");
  const next = actions.find((action) => action.type === "next_response");
  if (previous !== void 0) branch.canGoPrevious = previous.disabled !== true;
  if (next !== void 0) branch.canGoNext = next.disabled !== true;
  return branch;
}
function codeBlockFromBlock(block) {
  return block.language === void 0 ? { text: block.text } : { language: block.language, text: block.text };
}
function tableFromBlock(block) {
  return { headers: block.headers, rows: block.rows };
}
function firstElement(element, tag) {
  for (const child of element.children) {
    if (child.type === "element") {
      if (child.tag === tag) return child;
      const nested = firstElement(child, tag);
      if (nested !== void 0) return nested;
    }
  }
  return void 0;
}
function descendants(element, tag) {
  const found = [];
  walkElements(element, (child) => {
    if (child.tag === tag) found.push(child);
  });
  return found;
}
function hasBlockChild(element) {
  return element.children.some((child) => child.type === "element" && BLOCK_TAGS.has(child.tag));
}
function nodeText(node) {
  if (node.type === "text") return node.text;
  if (SKIPPED_TAGS.has(node.tag)) return "";
  if (node.tag === "br") return "\n";
  return node.children.map(nodeText).join("");
}
function metadataNodeText(node) {
  if (node.type === "text") return node.text;
  if (node.tag === "script" || node.tag === "style" || node.tag === "svg") return "";
  if (node.tag === "br") return "\n";
  return node.children.map(metadataNodeText).join(" ");
}
function languageFromClass(className) {
  return className?.split(/\s+/).find((name) => name.startsWith("language-"))?.slice("language-".length);
}
function normalizeInline(text) {
  return decodeBasicEntities(text).replace(/[ \t\r\n]+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}
function clamp(text, maxChars) {
  if (maxChars === void 0 || text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars));
}
function escapeMarkdownLinkText(text) {
  return text.replace(/]/g, "\\]");
}
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

// src/dom/messages.ts
function extractMessagesFromHtml(html, args = {}) {
  return extractRoleMessageHtml(html).filter((message) => args.role === void 0 || message.role === args.role).map((message) => normalizeExtractedMessage(message, args));
}
async function readMessages(page, args = {}) {
  if (typeof page.evaluate === "function") {
    const messages = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
      return nodes.map((node) => {
        const role = node.getAttribute("data-message-author-role");
        if (role !== "user" && role !== "assistant") {
          return void 0;
        }
        return {
          role,
          html: node.innerHTML,
          metadataHtml: node.closest("[data-testid^='conversation-turn']")?.outerHTML ?? node.outerHTML
        };
      }).filter(Boolean);
    });
    return messages.filter((message) => args.role === void 0 || message.role === args.role).map((message) => normalizeExtractedMessage(message, args));
  }
  if (typeof page.content === "function") {
    const html = await page.content();
    return extractMessagesFromHtml(html, args);
  }
  return [];
}
async function readLatestMessage(page, role = "assistant", format = "markdown", maxChars) {
  if (typeof page.evaluate === "function") {
    const message = await page.evaluate((wantedRole) => {
      const nodes = Array.from(document.querySelectorAll(`[data-message-author-role="${wantedRole}"]`));
      const node = nodes.at(-1);
      if (node === void 0) return void 0;
      return {
        role: wantedRole,
        html: node.innerHTML,
        metadataHtml: node.closest("[data-testid^='conversation-turn']")?.outerHTML ?? node.outerHTML
      };
    }, role).catch(() => void 0);
    if (message !== void 0) {
      const args2 = { role, format };
      if (maxChars !== void 0) args2.maxChars = maxChars;
      return normalizeExtractedMessage(message, args2);
    }
    return void 0;
  }
  const args = { role, format };
  if (maxChars !== void 0) args.maxChars = maxChars;
  const messages = await readMessages(page, args);
  return messages.at(-1);
}
async function readLatestMessageText(page, role = "assistant") {
  if (typeof page.evaluate === "function") {
    return page.evaluate((wantedRole) => {
      const nodes = Array.from(document.querySelectorAll(`[data-message-author-role="${wantedRole}"]`));
      const node = nodes.at(-1);
      return node?.innerText ?? node?.textContent ?? void 0;
    }, role).catch(() => void 0);
  }
  return readLatestMessage(page, role, "normalized_text").then((message) => message?.text).catch(() => void 0);
}
async function readLatestMessageTextSnapshot(page, role) {
  if (typeof page.evaluate === "function") {
    return page.evaluate((wantedRole) => {
      const allNodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
      const roleNodes = allNodes.filter((node) => node.getAttribute("data-message-author-role") === wantedRole);
      const latest = roleNodes.at(-1);
      const latestText2 = latest?.innerText ?? latest?.textContent ?? void 0;
      const snapshot2 = { turnCount: allNodes.length };
      if (latestText2 !== void 0) snapshot2.latestText = latestText2;
      return snapshot2;
    }, role);
  }
  const messages = await readMessages(page, { role, format: "normalized_text" });
  const allMessages = await readMessages(page, { format: "normalized_text" });
  const snapshot = { turnCount: allMessages.length };
  const latestText = messages.at(-1)?.text;
  if (latestText !== void 0) snapshot.latestText = latestText;
  return snapshot;
}
function isTransientAssistantText(text) {
  const normalized = normalizeWhitespace(text).replace(/[.。…]+$/g, "").trim().toLowerCase();
  return normalized === "thinking" || normalized === "reasoning" || normalized === "searching" || normalized === "searching the web" || /^analyzing (?:the )?images?$/.test(normalized) || /^processing (?:the )?images?$/.test(normalized) || /^reading (?:the )?images?$/.test(normalized);
}
function countMessages(messages, role) {
  return role === void 0 ? messages.length : messages.filter((message) => message.role === role).length;
}
async function countPageMessages(page, role) {
  if (typeof page.evaluate === "function") {
    return page.evaluate((wantedRole) => {
      const selector = wantedRole === void 0 ? "[data-message-author-role]" : `[data-message-author-role="${wantedRole}"]`;
      return document.querySelectorAll(selector).length;
    }, role);
  }
  return countMessages(await readMessages(page), role);
}
function normalizeExtractedMessage(message, args = {}) {
  const metadataHtml = message.role === "assistant" ? message.metadataHtml : void 0;
  const content = formatMessageHtml(message.html, normalizeResponseFormat(args.format), args.maxChars, metadataHtml);
  return { role: message.role, ...content };
}

// src/commands/context.ts
async function contextFromPage(page, partial = {}) {
  if (page === void 0) {
    return { timestamp: (/* @__PURE__ */ new Date()).toISOString(), ...partial };
  }
  const url = typeof page.url === "function" ? await Promise.resolve(page.url()).catch(() => partial.url) : partial.url;
  const title = typeof page.title === "function" ? await page.title().catch(() => void 0) : partial.title;
  const [turnCount, assistantTurnCount] = await Promise.all([
    withTimeout(countPageMessages(page), 1e3, "Timed out while counting page messages.").catch(() => partial.turnCount),
    withTimeout(countPageMessages(page, "assistant"), 1e3, "Timed out while counting assistant messages.").catch(() => partial.assistantTurnCount)
  ]);
  const conversationId = url !== void 0 ? parseConversationId(url) : partial.conversationId;
  const context = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    ...partial
  };
  if (url !== void 0) {
    context.url = url;
  }
  if (title !== void 0) {
    context.title = title;
  }
  if (turnCount !== void 0) {
    context.turnCount = turnCount;
  }
  if (assistantTurnCount !== void 0) {
    context.assistantTurnCount = assistantTurnCount;
  }
  if (conversationId !== void 0) {
    context.conversationId = conversationId;
  }
  return context;
}

// src/browser/attach.ts
var CHATGPT_HOME = "https://chatgpt.com/";
var CHATGPT_HOSTS = /* @__PURE__ */ new Set(["chatgpt.com", "www.chatgpt.com", "chat.openai.com"]);
async function attachChatGPTBrowser(env, args = {}) {
  const browser = await getBrowser(env);
  const page = await getOrCreateChatGPTPage(browser, env, args);
  const state = await readPageState(page);
  if (state.blocker?.kind === "login_required") {
    throw new LoginRequiredError(state.blocker.visibleText);
  }
  const attached = {
    browser,
    page,
    browserName: browser.name ?? "chrome"
  };
  const tabId = getTabId(page);
  if (tabId !== void 0) {
    attached.tabId = tabId;
  }
  return attached;
}
async function getBrowser(env) {
  if (env.browser !== void 0) {
    return env.browser;
  }
  const anyEnv = env;
  const agent = env.agent ?? anyEnv.agent ?? globalThis.agent;
  const browsers = agent?.browsers;
  if (browsers !== void 0 && typeof browsers === "object") {
    const maybeBrowser = await tryBrowserGetPreferredListed(browsers) ?? await tryBrowserGet(browsers, "extension") ?? await tryBrowserGet(browsers, "chrome");
    if (maybeBrowser !== void 0) {
      return maybeBrowser;
    }
  }
  throw new BrowserBridgeUnavailableError();
}
async function tryBrowserGet(browsers, name) {
  const get = browsers.get;
  if (typeof get !== "function") {
    return void 0;
  }
  try {
    const browser = await get.call(browsers, name);
    return normalizeBrowser(browser);
  } catch {
    return void 0;
  }
}
async function tryBrowserGetPreferredListed(browsers) {
  const list = browsers.list;
  const get = browsers.get;
  if (typeof list !== "function" || typeof get !== "function") {
    return void 0;
  }
  try {
    const available = await list.call(browsers);
    const preferred = available.find((browser2) => browser2.type === "extension") ?? available.find((browser2) => typeof browser2.name === "string" && /chrome/i.test(browser2.name)) ?? available[0];
    const id = preferred?.id;
    if (typeof id !== "string") {
      return void 0;
    }
    const browser = await get.call(browsers, id);
    return normalizeBrowser(browser);
  } catch {
    return void 0;
  }
}
async function getOrCreateChatGPTPage(browser, env, args) {
  const targetUrl = args.url ?? CHATGPT_HOME;
  const explicitExistingPolicy = normalizeExplicitExistingTabPolicy(args);
  if (env.page !== void 0) {
    const cached = normalizePage(env.page);
    if (await cachedPageMatchesBootstrapArgs(cached, args, explicitExistingPolicy)) {
      return cached;
    }
  }
  if (explicitExistingPolicy !== void 0) {
    const existing = await selectExistingTab(browser, explicitExistingPolicy);
    if (existing !== void 0) {
      return existing;
    }
    const ifMissing = explicitExistingPolicy.ifMissing ?? "block";
    if (ifMissing === "block") {
      throw new ExistingTabSelectionError(
        "No already-open ChatGPT tab matched the requested existing-tab target.",
        "existing_tab_not_found"
      );
    }
    const missingUrl = ifMissing === "open" ? urlFromExistingTarget(explicitExistingPolicy.target) ?? targetUrl : targetUrl;
    const created2 = await createTab(browser, missingUrl);
    if (created2 !== void 0) {
      return created2;
    }
    throw new BrowserBridgeUnavailableError("Codex can access a browser object, but no tab creation API was found.");
  }
  if (args.preferExistingTab !== false) {
    const existing = await findExistingChatGPTTab(browser);
    if (existing !== void 0) {
      return existing;
    }
  }
  const created = await createTab(browser, targetUrl);
  if (created !== void 0) {
    return created;
  }
  throw new BrowserBridgeUnavailableError("Codex can access a browser object, but no tab creation API was found.");
}
async function cachedPageMatchesBootstrapArgs(page, args, explicitExistingPolicy) {
  if (explicitExistingPolicy !== void 0) {
    return pageMatchesExistingTarget(page, explicitExistingPolicy);
  }
  if (args.url !== void 0) {
    const currentUrl = await Promise.resolve(page.url?.()).catch(() => void 0);
    return urlMatches(currentUrl, args.url);
  }
  return true;
}
function normalizeExplicitExistingTabPolicy(args) {
  if (args.existingTab === void 0) {
    return void 0;
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
    return void 0;
  }
  return {
    requireChatGPT: true,
    ifMissing: "block",
    ifMultiple: args.existingTab.target?.type === "selected" ? "first" : "block",
    ...args.existingTab
  };
}
async function selectExistingTab(browser, policy) {
  const userMatch = await selectExistingUserTab(browser, policy);
  if (userMatch !== void 0) {
    return userMatch;
  }
  if (policy.target?.type === "selected" && typeof browser.tabs?.selected === "function") {
    const selected = await Promise.resolve(browser.tabs.selected.call(browser.tabs)).catch(() => void 0);
    if (selected !== void 0) {
      const normalized = normalizePage(selected);
      if (await pageMatchesExistingTarget(normalized, policy)) {
        return normalized;
      }
    }
  }
  if (policy.target?.type === "tabId" && typeof browser.tabs?.get === "function") {
    const tab = await Promise.resolve(browser.tabs.get.call(browser.tabs, policy.target.tabId)).catch(() => void 0);
    if (tab !== void 0) {
      const normalized = normalizePage(tab);
      if (await pageMatchesExistingTarget(normalized, policy)) {
        return normalized;
      }
    }
  }
  return void 0;
}
async function selectExistingUserTab(browser, policy) {
  const openTabs = browser.user?.openTabs;
  const claimTab = browser.user?.claimTab;
  if (typeof openTabs !== "function" || typeof claimTab !== "function") {
    return void 0;
  }
  const tabs = await Promise.resolve(openTabs.call(browser.user)).catch(() => []);
  const matches = tabs.filter((tab) => userTabMatchesTarget(tab, policy));
  if (matches.length === 0) {
    return void 0;
  }
  if (matches.length > 1 && (policy.ifMultiple ?? "block") !== "first") {
    throw new ExistingTabSelectionError(
      "Multiple already-open ChatGPT tabs matched the requested existing-tab target.",
      "existing_tab_ambiguous",
      matches
    );
  }
  const selected = matches[0];
  return normalizePage(await claimTab.call(browser.user, selected));
}
function userTabMatchesTarget(tab, policy) {
  const target = policy.target ?? { type: "selected", host: "chatgpt" };
  const requireChatGPT = policy.requireChatGPT ?? targetRequiresChatGPT(target);
  if (requireChatGPT && !isChatGPTUrl(tab.url)) {
    return false;
  }
  switch (target.type) {
    case "selected":
      return target.host === void 0 || target.host === "chatgpt" ? isChatGPTUrl(tab.url) : true;
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
async function pageMatchesExistingTarget(page, policy) {
  const url = await Promise.resolve(page.url?.()).catch(() => void 0);
  const title = await Promise.resolve(page.title?.()).catch(() => void 0);
  const tab = { id: getTabId(page) ?? "" };
  if (url !== void 0) tab.url = url;
  if (title !== void 0) tab.title = title;
  return userTabMatchesTarget(tab, policy);
}
async function findExistingChatGPTTab(browser) {
  const userTab = await selectExistingUserTab(browser, {
    target: { type: "selected", host: "chatgpt" },
    ifMultiple: "first",
    requireChatGPT: true
  });
  if (userTab !== void 0) {
    return userTab;
  }
  const selected = browser.tabs?.selected;
  if (typeof selected === "function") {
    try {
      const current = await selected.call(browser.tabs);
      if (current !== void 0) {
        const normalized2 = normalizePage(current);
        try {
          if ((await normalized2.url?.())?.includes("chatgpt.com") === true) {
            return normalized2;
          }
        } catch {
        }
      }
    } catch {
    }
  }
  const list = browser.tabs?.list;
  if (typeof list !== "function") {
    return void 0;
  }
  const tabs = await list.call(browser.tabs);
  const normalized = await Promise.all(tabs.map((tab) => hydrateTab(browser, tab)));
  for (const tab of normalized) {
    try {
      if ((await tab.url?.())?.includes("chatgpt.com") === true) {
        return tab;
      }
    } catch {
    }
  }
  return void 0;
}
var ExistingTabSelectionError = class extends ChatGPTControlError {
  constructor(message, code, candidates = []) {
    super(message, "not_found", true, void 0, {
      code,
      candidates: candidates.map((tab) => ({ label: userTabCandidateLabel(tab) })),
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
};
function targetRequiresChatGPT(target) {
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
function isChatGPTUrl(url) {
  if (url === void 0) {
    return false;
  }
  try {
    return CHATGPT_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
function urlMatches(actual, expected) {
  if (actual === void 0) {
    return false;
  }
  const actualConversationId = parseConversationId(actual);
  const expectedConversationId = parseConversationId(expected);
  if (actualConversationId !== void 0 || expectedConversationId !== void 0) {
    return actualConversationId !== void 0 && actualConversationId === expectedConversationId;
  }
  return normalizeUrl(actual) === normalizeUrl(expected);
}
function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}
function titleMatches(actual, expected, exact) {
  if (actual === void 0) {
    return false;
  }
  const normalizedActual = normalizeText(actual);
  const normalizedExpected = normalizeText(expected);
  return exact ? normalizedActual === normalizedExpected : normalizedActual.includes(normalizedExpected);
}
function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
function urlFromExistingTarget(target) {
  if (target === void 0) {
    return void 0;
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
      return void 0;
  }
}
function userTabCandidateLabel(tab) {
  return `tab ${tab.id} - ${tab.title ?? "Untitled"} - ${tab.url ?? "unknown URL"}`;
}
async function createTab(browser, url) {
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
  return void 0;
}
async function ensurePageAt(page, url) {
  const currentUrl = await Promise.resolve(page.url?.()).catch(() => "");
  if (currentUrl?.includes("chatgpt.com") === true) {
    return;
  }
  if (typeof page.goto === "function") {
    await page.goto(url);
  }
}
function normalizeBrowser(browser) {
  if (browser === void 0 || browser === null || typeof browser !== "object") {
    return void 0;
  }
  return browser;
}
async function hydrateTab(browser, pageOrTab) {
  const maybe = pageOrTab;
  if (maybe.playwright === void 0 && typeof maybe.id === "string" && typeof browser.tabs?.get === "function") {
    try {
      return normalizePage(await browser.tabs.get(maybe.id));
    } catch {
      return normalizePage(pageOrTab);
    }
  }
  return normalizePage(pageOrTab);
}
function normalizePage(pageOrTab) {
  const maybe = pageOrTab;
  const playwright = maybe.playwright ?? maybe.page;
  if (playwright !== void 0 && typeof playwright === "object") {
    return new Proxy(playwright, {
      get(target, prop) {
        if (prop in target) {
          const value2 = target[prop];
          return typeof value2 === "function" ? value2.bind(target) : value2;
        }
        const value = maybe[prop];
        return typeof value === "function" ? value.bind(maybe) : value;
      }
    });
  }
  if (typeof maybe.url === "string") {
    return {
      ...maybe,
      url: () => maybe.url,
      title: async () => typeof maybe.title === "string" ? maybe.title : ""
    };
  }
  return pageOrTab;
}
function getTabId(page) {
  const maybe = page;
  const id = maybe.id ?? maybe.tabId;
  return typeof id === "string" ? id : void 0;
}

// src/commands/session.ts
async function bootstrap(env, args = {}) {
  try {
    const attached = await attachChatGPTBrowser(env, args);
    env.browser = attached.browser;
    env.page = attached.page;
    const state = await readPageState(attached.page);
    const data = {
      browserName: attached.browserName,
      tabId: attached.tabId ?? "unknown",
      url: state.url,
      loggedIn: state.signedIn
    };
    const context = attached.tabId === void 0 ? { browserName: attached.browserName } : { browserName: attached.browserName, tabId: attached.tabId };
    return resultOk(data, await contextFromPage(attached.page, context));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)));
  }
}

// src/commands/artifacts.ts
async function listLatestArtifacts(env, args = {}) {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  try {
    const artifacts = await listPageArtifactsWithBridgeFallback(env, page, args);
    return resultOk(artifactListData(artifacts), await contextFromPage(page));
  } catch (error) {
    return artifactSelectorBlocker(error, await contextFromPage(page));
  }
}
async function waitForArtifact(env, args = {}) {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  const timeoutMs = args.timeoutMs ?? 12e4;
  const stableMs = args.stableMs ?? 1e3;
  const pollMs = args.pollMs ?? 750;
  const started = Date.now();
  const afterArtifactCount = args.afterArtifactCount ?? 0;
  let lastSignature = "";
  let lastChangedAt = Date.now();
  let latestArtifacts = [];
  while (Date.now() - started < timeoutMs) {
    const state = await withTimeout(readPageState(page), localGuardTimeout(timeoutMs, 5e3), "Timed out while reading ChatGPT page state.").catch(() => void 0);
    if (state?.blocker !== void 0 && state.blocker.kind !== "modal") {
      return {
        ok: false,
        status: "blocked",
        warnings: [],
        blocker: state.blocker,
        context: await contextFromPage(page)
      };
    }
    try {
      latestArtifacts = await listPageArtifactsWithBridgeFallback(env, page, args);
    } catch (error) {
      return artifactSelectorBlocker(error, await contextFromPage(page));
    }
    const latest2 = latestArtifacts.at(-1);
    const signature = JSON.stringify({
      count: latestArtifacts.length,
      src: latest2?.src,
      width: latest2?.width,
      height: latest2?.height,
      downloadAvailable: latest2?.downloadAvailable
    });
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastChangedAt = Date.now();
    }
    const targetReached = latestArtifacts.length > afterArtifactCount && latest2 !== void 0 && (args.requireDownload !== true || latest2.downloadAvailable);
    if (targetReached && Date.now() - lastChangedAt >= stableMs && !await hasStopControl(page, timeoutMs)) {
      return resultOk(
        {
          complete: true,
          count: latestArtifacts.length,
          latest: latest2,
          elapsedMs: Date.now() - started
        },
        await contextFromPage(page)
      );
    }
    await sleep(page, pollMs);
  }
  const data = {
    complete: false,
    count: latestArtifacts.length,
    elapsedMs: Date.now() - started
  };
  const latest = latestArtifacts.at(-1);
  if (latest !== void 0) data.latest = latest;
  return {
    ok: false,
    status: "timeout",
    data,
    warnings: [],
    blocker: {
      kind: "artifact_unavailable",
      code: args.requireDownload === true ? "artifact_download_not_ready" : "artifact_not_ready",
      message: args.requireDownload === true ? "No generated artifact with a visible download affordance appeared before the timeout." : "No generated artifact appeared before the timeout.",
      resumable: true
    },
    context: await contextFromPage(page)
  };
}
async function downloadLatestArtifact(env, args) {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  const timeoutMs = args.timeoutMs ?? 12e4;
  if (args.prefer !== "visible_image_source") {
    const byDownload = await tryDownloadControl(page, args, timeoutMs);
    if (byDownload.ok || args.prefer === "download_control") {
      return byDownload;
    }
  }
  try {
    const byImageSource = await saveLatestVisibleImageSource(page, args.destDir, timeoutMs);
    if (byImageSource !== void 0) {
      return resultOk(byImageSource, await contextFromPage(page));
    }
  } catch (error) {
    return artifactDownloadBlocker(error, await contextFromPage(page));
  }
  try {
    const byPageAssets = await saveLatestPageAssetImage(env, page, args.destDir, timeoutMs);
    if (byPageAssets !== void 0) {
      return resultOk(byPageAssets, await contextFromPage(page));
    }
  } catch (error) {
    return artifactDownloadBlocker(error, await contextFromPage(page));
  }
  return artifactDownloadBlocker(
    new Error("No visible generated image source was available to save."),
    await contextFromPage(page)
  );
}
async function locatorCountWithTimeout(locator, timeoutMs, code) {
  if (locator === void 0 || typeof locator.count !== "function") {
    return 0;
  }
  return withTimeout(
    locator.count(),
    timeoutMs,
    `${code}: locator count did not complete before the local guard timeout.`
  );
}
async function tryDownloadControl(page, args, timeoutMs) {
  try {
    const controls = requiredLocator(page, cssSelectors.generatedArtifactDownloadControls);
    const count = await locatorCountWithTimeout(controls, localGuardTimeout(timeoutMs, 5e3), "artifact_download_control_timeout");
    if (count === 0) {
      return artifactDownloadBlocker(new Error("No visible generated-image download control was found."), await contextFromPage(page));
    }
    const target = controls.last?.() ?? controls;
    const downloaded = await waitForDownloadFromClick(
      page,
      async () => {
        await target.click?.({ timeoutMs: localGuardTimeout(timeoutMs, 1e4) });
      },
      args.destDir,
      timeoutMs
    );
    return resultOk(downloaded, await contextFromPage(page));
  } catch (error) {
    return artifactDownloadBlocker(error, await contextFromPage(page));
  }
}
async function saveLatestVisibleImageSource(page, destDir, timeoutMs) {
  const source = await readLatestImageDataUrl(page, timeoutMs);
  if (source === void 0) return void 0;
  const parsed = parseDataUrl(source.dataUrl);
  if (parsed === void 0) return void 0;
  const absoluteDest = resolve2(destDir);
  await mkdir2(absoluteDest, { recursive: true });
  const suggestedFilename = `generated-image-${Date.now()}.${extensionForMime(parsed.mimeType)}`;
  const path = join2(absoluteDest, suggestedFilename);
  await writeFile(path, parsed.bytes);
  const saved = await stat2(path);
  if (saved.size <= 0) {
    throw new Error(`Generated image artifact file is empty: ${path}`);
  }
  return { path, suggestedFilename, bytes: saved.size };
}
async function listPageArtifactsWithBridgeFallback(env, page, args) {
  try {
    const artifacts = await listPageArtifacts(page, args);
    if (artifacts.length > 0) {
      return artifacts;
    }
    const fromAssets = await listPageAssetArtifacts(env, page, args, args.timeoutMs).catch(() => []);
    return fromAssets.length > 0 ? fromAssets : artifacts;
  } catch (error) {
    const fromAssets = await listPageAssetArtifacts(env, page, args, args.timeoutMs).catch(() => []);
    if (fromAssets.length > 0) {
      return fromAssets;
    }
    throw error;
  }
}
async function listPageAssetArtifacts(env, page, args, timeoutMs) {
  const inventory = await readPageAssetsInventory(page, timeoutMs).catch(() => void 0) ?? await withTemporaryBridgeOwnedPage(env, page, timeoutMs, async (freshPage) => {
    return await readPageAssetsInventory(freshPage, timeoutMs).catch(() => void 0);
  });
  if (inventory === void 0) return [];
  const artifacts = inventory.assets.filter((asset) => asset.kind === "image").filter((asset) => !isInlineSvgAsset(asset) && isLikelyRasterImageAsset(asset)).map((asset, index) => {
    const artifact = {
      kind: "image",
      index,
      visible: true,
      downloadAvailable: true,
      selectorProvenance: "pageAssets image inventory"
    };
    const src = safeArtifactSrc2(asset.url);
    if (src !== void 0) artifact.src = src;
    return artifact;
  });
  const max = args.max ?? artifacts.length;
  return artifacts.filter((artifact) => artifact.kind === (args.kind ?? "image")).slice(-max).map((artifact, index) => ({ ...artifact, index }));
}
async function saveLatestPageAssetImage(env, page, destDir, timeoutMs) {
  return await saveLatestPageAssetImageFromPage(page, destDir, timeoutMs).catch(() => void 0) ?? await withTemporaryBridgeOwnedPage(env, page, timeoutMs, async (freshPage) => {
    return await saveLatestPageAssetImageFromPage(freshPage, destDir, timeoutMs).catch(() => void 0);
  });
}
async function saveLatestPageAssetImageFromPage(page, destDir, timeoutMs) {
  const capability = await getPageAssetsCapability(page);
  if (capability === void 0) return void 0;
  const inventory = await withTimeout(
    capability.list(),
    localGuardTimeout(timeoutMs, 15e3),
    "Timed out while listing page assets for generated image download."
  );
  const candidateIds = inventory.assets.filter((asset2) => asset2.kind === "image").filter((asset2) => !isInlineSvgAsset(asset2) && isLikelyRasterImageAsset(asset2)).map((asset2) => asset2.id);
  if (candidateIds.length === 0) return void 0;
  const bundled = await withTimeout(
    capability.bundle({ assetIds: candidateIds, inventoryId: inventory.id, kinds: ["image"] }),
    localGuardTimeout(timeoutMs, 3e4),
    "Timed out while bundling generated image page asset."
  );
  const asset = bundled.assets.filter((item) => !isInlineSvgAsset(item) && isLikelyRasterImageAsset(item)).at(-1);
  if (asset === void 0) return void 0;
  const absoluteDest = resolve2(destDir);
  await mkdir2(absoluteDest, { recursive: true });
  const suggestedFilename = `generated-image-${Date.now()}.${extensionForMime(asset.contentType ?? "image/png")}`;
  const path = join2(absoluteDest, suggestedFilename);
  await copyFile(asset.path, path);
  const saved = await stat2(path);
  if (saved.size <= 0) {
    throw new Error(`Generated image artifact file is empty: ${path}`);
  }
  return { path, suggestedFilename, bytes: saved.size };
}
async function readPageAssetsInventory(page, timeoutMs) {
  const capability = await getPageAssetsCapability(page);
  if (capability === void 0) return void 0;
  return await withTimeout(
    capability.list(),
    localGuardTimeout(timeoutMs, 15e3),
    "Timed out while listing page assets for generated artifacts."
  );
}
async function getPageAssetsCapability(page) {
  const capabilities = page.capabilities;
  const get = capabilities?.get;
  if (typeof get !== "function") return void 0;
  const capability = await get.call(capabilities, "pageAssets");
  if (!isPageAssetsCapability(capability)) return void 0;
  return capability;
}
async function withTemporaryBridgeOwnedPage(env, currentPage, timeoutMs, callback) {
  const url = await currentPageUrl(currentPage);
  if (url === void 0 || !/^https:\/\/chatgpt\.com\/c\//i.test(url)) return void 0;
  const freshPage = await openTemporaryPage(env, url, timeoutMs);
  if (freshPage === void 0) return void 0;
  try {
    await settlePage(freshPage, localGuardTimeout(timeoutMs, 5e3));
    return await callback(freshPage);
  } finally {
    await closeTemporaryPage(freshPage).catch(() => void 0);
  }
}
async function openTemporaryPage(env, url, timeoutMs) {
  const browser = env.browser;
  if (browser === void 0) return void 0;
  let page;
  if (typeof browser.tabs?.create === "function") {
    page = await Promise.resolve(browser.tabs.create.call(browser.tabs, url));
  } else if (typeof browser.tabs?.new === "function") {
    page = await Promise.resolve(browser.tabs.new.call(browser.tabs));
    if (typeof page?.goto === "function") {
      await withTimeout(
        page.goto(url),
        localGuardTimeout(timeoutMs, 2e4),
        "Timed out while opening generated image conversation in a temporary bridge tab."
      ).catch(() => void 0);
    }
  } else if (typeof browser.newPage === "function") {
    page = await Promise.resolve(browser.newPage.call(browser));
    if (typeof page?.goto === "function") {
      await withTimeout(
        page.goto(url),
        localGuardTimeout(timeoutMs, 2e4),
        "Timed out while opening generated image conversation in a temporary bridge page."
      ).catch(() => void 0);
    }
  }
  return page;
}
async function settlePage(page, timeoutMs) {
  const waitForTimeout = page.waitForTimeout ?? page.playwright?.waitForTimeout;
  if (typeof waitForTimeout !== "function") return;
  await withTimeout(
    waitForTimeout.call(page.waitForTimeout === waitForTimeout ? page : page.playwright, Math.min(timeoutMs, 5e3)),
    timeoutMs,
    "Timed out while waiting for temporary bridge tab to settle."
  ).catch(() => void 0);
}
async function closeTemporaryPage(page) {
  if (typeof page.close === "function") {
    await page.close();
  }
}
async function currentPageUrl(page) {
  const value = await Promise.resolve(page.url?.()).catch(() => void 0);
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function isPageAssetsCapability(value) {
  return typeof value === "object" && value !== null && typeof value.list === "function" && typeof value.bundle === "function";
}
function isLikelyRasterImageAsset(asset) {
  const contentType = asset.contentType ?? "";
  if (/^image\/(png|jpe?g|webp|gif|avif)$/i.test(contentType)) return true;
  const name = asset.name ?? basename2(asset.path ?? "");
  const url = asset.url ?? "";
  return /\.(png|jpe?g|webp|gif|avif)(?:$|[?#])/i.test(name) || /\.(png|jpe?g|webp|gif|avif)(?:$|[?#])/i.test(url) || contentType === "" && !isInlineSvgAsset(asset);
}
function isInlineSvgAsset(asset) {
  return /^inline-svg:/i.test(asset.url ?? "") || /svg/i.test(asset.contentType ?? "") || /\.svg(?:$|[?#])/i.test(asset.name ?? "") || /\.svg(?:$|[?#])/i.test(asset.path ?? "");
}
function safeArtifactSrc2(src) {
  if (src === void 0) return void 0;
  if (/^https:\/\/chatgpt\.com\/backend-api\/estuary\/content\b/i.test(src)) {
    return void 0;
  }
  return src;
}
function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(dataUrl);
  if (match === null || match[1] === void 0 || match[2] === void 0) return void 0;
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64") };
}
function extensionForMime(mimeType) {
  if (/jpeg|jpg/i.test(mimeType)) return "jpg";
  if (/webp/i.test(mimeType)) return "webp";
  if (/gif/i.test(mimeType)) return "gif";
  return "png";
}
function artifactListData(artifacts) {
  const data = {
    count: artifacts.length,
    artifacts
  };
  const latest = artifacts.at(-1);
  if (latest !== void 0) data.latest = latest;
  return data;
}
function artifactSelectorBlocker(error, context) {
  return {
    ok: false,
    status: "blocked",
    warnings: [],
    blocker: {
      kind: "artifact_selector_drift",
      code: "artifact_dom_timeout",
      message: `Generated artifact detection could not inspect the ChatGPT page: ${error instanceof Error ? error.message : String(error)}`,
      resumable: true
    },
    context
  };
}
function artifactDownloadBlocker(error, context) {
  return {
    ok: false,
    status: "unsupported",
    warnings: [],
    blocker: {
      kind: "artifact_download_unavailable",
      code: "artifact_download_unavailable",
      message: `No downloadable generated artifact could be saved from the visible ChatGPT page: ${error instanceof Error ? error.message : String(error)}`,
      resumable: true
    },
    context
  };
}
async function ensurePage(env) {
  if (env.page !== void 0) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
}
async function hasStopControl(page, timeoutMs) {
  if (typeof page.evaluate !== "function") return false;
  return withTimeout(
    page.evaluate(() => /\b(stop generating|stop streaming|cancel)\b/i.test(document.body?.innerText ?? "")),
    localGuardTimeout(timeoutMs, 2e3),
    "Timed out while checking ChatGPT stop controls."
  ).catch(() => false);
}
async function sleep(page, ms) {
  if (typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(ms);
    return;
  }
  await new Promise((resolve4) => setTimeout(resolve4, ms));
}

// src/commands/files.ts
import { access, readFile, stat as stat3 } from "node:fs/promises";
import { basename as basename3, resolve as resolve3 } from "node:path";
import { constants } from "node:fs";
var CODEX_UPLOAD_PERMISSION_FIX = "Codex Settings > Computer Use > Chrome > Permissions > Uploads: set to Always allow, or add chatgpt.com to the allowed upload domains.";
var CHROME_FILE_URL_PERMISSION_FIX = "Chrome chrome://extensions > Codex extension > Details: enable Allow access to file URLs.";
async function validateAttachPaths(paths) {
  const files = [];
  for (const path of paths) {
    if (!path.startsWith("/")) {
      throw new Error(`File attachment path must be absolute: ${path}`);
    }
    const absolute = resolve3(path);
    await access(absolute, constants.R_OK);
    const fileStat = await stat3(absolute);
    if (!fileStat.isFile()) {
      throw new Error(`Attachment path is not a file: ${absolute}`);
    }
    files.push({
      path: absolute,
      name: basename3(absolute),
      bytes: fileStat.size
    });
  }
  return files;
}
async function attachFiles(env, args) {
  const boot = await ensurePage2(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  try {
    const files = await validateAttachPaths(args.paths);
    await uploadFiles(page, files, args.timeoutMs ?? 3e4);
    await page.waitForTimeout?.(args.timeoutMs === void 0 ? 1e3 : Math.min(args.timeoutMs, 3e3));
    return resultOk({ files }, await contextFromPage(page));
  } catch (error) {
    if (isUploadBridgeBlocker(error)) {
      return {
        ok: false,
        status: "blocked",
        warnings: [],
        blocker: {
          kind: "permission",
          code: "upload_permission_required",
          message: uploadPermissionMessage(error),
          visibleText: uploadPermissionDetails(error),
          remediation: uploadPermissionRemediation(),
          resumable: true
        },
        context: await contextFromPage(page)
      };
    }
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}
async function uploadFiles(page, files, timeoutMs) {
  const paths = files.map((file) => file.path);
  const errors = [];
  const attempts = [
    {
      name: "visible-chatgpt-file-input",
      run: async () => {
        await clickFileChooserTarget(page, "#upload-files", paths, timeoutMs, { requireVisible: true });
      }
    },
    {
      name: "add-photos-files-menu-item",
      run: async () => {
        await clickChatGPTAddPhotosMenuItem(page, paths, timeoutMs);
      }
    },
    {
      name: "generic-add-files-button",
      run: async () => {
        await clickFileChooserLocator(page, addFilesButton(page), paths, timeoutMs);
      }
    },
    {
      name: "direct-file-input-set",
      run: async () => {
        await setHiddenFileInput(page, files);
      }
    }
  ];
  for (const attempt of attempts) {
    try {
      await attempt.run();
      return;
    } catch (error) {
      errors.push(`${attempt.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No ChatGPT upload path completed.
${errors.join("\n")}`);
}
async function clickChatGPTAddPhotosMenuItem(page, paths, timeoutMs) {
  const menuItem = requiredLocator(page, "div[role='menuitem']").filter?.({ hasText: "Add photos & files" });
  if (await locatorCount(menuItem) !== 1) {
    const plusButton = requiredLocator(page, "#composer-plus-btn, button[aria-label='Add files and more']");
    if (await locatorCount(plusButton) !== 1) {
      throw new Error("ChatGPT Add files button was not uniquely available.");
    }
    await plusButton.click?.({ timeoutMs: Math.min(timeoutMs, 1e4) });
    await page.waitForTimeout?.(250);
  }
  const refreshedMenuItem = requiredLocator(page, "div[role='menuitem']").filter?.({ hasText: "Add photos & files" });
  await clickFileChooserLocator(page, refreshedMenuItem, paths, timeoutMs);
}
async function clickFileChooserTarget(page, selector, paths, timeoutMs, options = {}) {
  const locator = requiredLocator(page, selector);
  if (await locatorCount(locator) !== 1) {
    throw new Error(`Upload target was not uniquely available: ${selector}`);
  }
  if (options.requireVisible === true && locator.isVisible !== void 0 && !await locator.isVisible({ timeoutMs: 1e3 })) {
    throw new Error(`Upload target is hidden: ${selector}`);
  }
  await clickFileChooserLocator(page, locator, paths, timeoutMs);
}
async function clickFileChooserLocator(page, locator, paths, timeoutMs) {
  if (locator === void 0) {
    throw new Error("Upload locator was not available.");
  }
  if (typeof page.waitForEvent !== "function") {
    throw new Error("The active browser page does not expose file chooser events.");
  }
  if (typeof locator.click !== "function") {
    throw new Error("Upload locator does not expose click().");
  }
  const chooserPromise = waitForFileChooser(page, timeoutMs);
  try {
    await locator.click({ timeoutMs: Math.min(timeoutMs, 1e4) });
  } catch (error) {
    await chooserPromise.catch(() => void 0);
    throw error;
  }
  const chooser = await chooserPromise;
  await validateChooserMultiplicity(chooser, paths);
  try {
    await chooser.setFiles(paths);
  } catch (error) {
    throw new Error(`fileChooser.setFiles failed. ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function waitForFileChooser(page, timeoutMs) {
  const rawChooser = await page.waitForEvent?.("filechooser", {
    timeout: timeoutMs,
    timeoutMs
  });
  if (!isFileChooserLike(rawChooser)) {
    throw new Error("File chooser event did not return a setFiles-capable chooser.");
  }
  return rawChooser;
}
async function validateChooserMultiplicity(chooser, paths) {
  if (paths.length <= 1 || typeof chooser.isMultiple !== "function") {
    return;
  }
  const isMultiple = await chooser.isMultiple();
  if (!isMultiple) {
    throw new Error("The active ChatGPT file chooser only accepts one file.");
  }
}
function isFileChooserLike(value) {
  return value !== null && typeof value === "object" && typeof value.setFiles === "function";
}
async function locatorCount(locator) {
  if (locator === void 0 || typeof locator.count !== "function") {
    return 0;
  }
  return locator.count();
}
async function downloadLatestFile(env, args) {
  const boot = await ensurePage2(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  try {
    const controls = requiredLocator(page, cssSelectors.downloadControls);
    let count;
    try {
      count = await locatorCountWithTimeout(controls, localGuardTimeout(args.timeoutMs, 5e3), "download_control_timeout");
    } catch (error) {
      return {
        ok: false,
        status: "unsupported",
        warnings: [],
        blocker: {
          kind: "download_unavailable",
          code: "download_control_timeout",
          message: `No visible ChatGPT download control could be counted before the local guard timeout: ${error instanceof Error ? error.message : String(error)}`,
          resumable: true
        },
        context: await contextFromPage(page)
      };
    }
    if (count === 0) {
      const artifactDownload = await downloadLatestArtifact(env, args);
      if (artifactDownload.ok) {
        return artifactDownload;
      }
      return {
        ok: false,
        status: "unsupported",
        warnings: [],
        blocker: {
          kind: "download_unavailable",
          message: "No visible ChatGPT download control was found."
        },
        context: await contextFromPage(page)
      };
    }
    const target = args.from === "visible_conversation" ? controls.last?.() ?? controls : controls.last?.() ?? controls;
    const downloaded = await waitForDownloadFromClick(
      page,
      async () => {
        await target.click?.();
      },
      args.destDir,
      args.timeoutMs ?? 12e4
    );
    return resultOk(downloaded, await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}
async function setHiddenFileInput(page, files) {
  if (page === void 0) {
    throw new Error("No active page is available for file upload.");
  }
  const input = requiredLocator(page, cssSelectors.hiddenFileInputs).last?.() ?? requiredLocator(page, cssSelectors.hiddenFileInputs);
  if (typeof input.setInputFiles !== "function") {
    await setFilesViaDomDataTransfer(page, files);
    return;
  }
  await input.setInputFiles(files.map((file) => file.path));
}
async function ensurePage2(env) {
  if (env.page !== void 0) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
}
async function setFilesViaDomDataTransfer(page, files) {
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const maxInlineBytes = 25 * 1024 * 1024;
  if (totalBytes > maxInlineBytes) {
    throw new Error(`No file chooser or setInputFiles support is available for large uploads. ${CODEX_UPLOAD_PERMISSION_FIX} ${CHROME_FILE_URL_PERMISSION_FIX}`);
  }
  if (typeof page.evaluate !== "function") {
    throw new Error(`No file chooser, setInputFiles, or page.evaluate support is available for file upload. ${CODEX_UPLOAD_PERMISSION_FIX} ${CHROME_FILE_URL_PERMISSION_FIX}`);
  }
  const payload = await Promise.all(files.map(async (file) => ({
    name: file.name,
    bytesBase64: (await readFile(file.path)).toString("base64"),
    type: guessMimeType(file.name)
  })));
  await page.evaluate(
    async (payload2) => {
      const input = document.querySelector("#upload-files") || document.querySelector("input[type='file']:not([accept='image/*'])") || document.querySelector("input[type='file']");
      if (!input) {
        throw new Error("No ChatGPT file input found in the DOM.");
      }
      const dataTransfer = new DataTransfer();
      for (const item of payload2) {
        const binary = atob(item.bytesBase64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        dataTransfer.items.add(new File([bytes], item.name, { type: item.type }));
      }
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    payload
  );
}
function guessMimeType(name) {
  if (/\.txt$/i.test(name)) return "text/plain";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.md$/i.test(name)) return "text/markdown";
  return "application/octet-stream";
}
function isUploadBridgeBlocker(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /DataTransfer is not a constructor|No file chooser|setInputFiles|Allow access to file URLs|file upload|fileChooser\.setFiles failed|Not allowed|No ChatGPT upload path completed/i.test(message);
}
function uploadPermissionMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/fileChooser\.setFiles failed|Not allowed/i.test(message)) {
    return `ChatGPT's file chooser opened, but Chrome refused the local file handoff. Ask the user to enable both upload permission gates, then retry: ${CODEX_UPLOAD_PERMISSION_FIX} ${CHROME_FILE_URL_PERMISSION_FIX}`;
  }
  if (/Browser Use rejected|requested that files not be uploaded|upload files|permission denied|browser blocked/i.test(message)) {
    return `Codex/Chrome upload permission is blocking file attachment. Ask the user to enable both upload permission gates, then retry: ${CODEX_UPLOAD_PERMISSION_FIX} ${CHROME_FILE_URL_PERMISSION_FIX}`;
  }
  return `File upload is not available until both upload permission gates are enabled. Ask the user to enable them, then retry: ${CODEX_UPLOAD_PERMISSION_FIX} ${CHROME_FILE_URL_PERMISSION_FIX}`;
}
function uploadPermissionDetails(error) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "Upload permission troubleshooting:",
    `1. ${CODEX_UPLOAD_PERMISSION_FIX}`,
    `2. ${CHROME_FILE_URL_PERMISSION_FIX}`,
    "Observed failure:",
    message
  ].join("\n");
}
function uploadPermissionRemediation() {
  return [
    {
      label: "Codex Chrome uploads",
      instruction: CODEX_UPLOAD_PERMISSION_FIX,
      userActionRequired: true
    },
    {
      label: "Chrome file URLs",
      instruction: CHROME_FILE_URL_PERMISSION_FIX,
      userActionRequired: true
    }
  ];
}

// src/browser/clipboard.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
async function readSystemClipboard() {
  if (typeof process === "undefined" || process.platform !== "darwin") {
    return void 0;
  }
  try {
    const { stdout } = await execFileAsync("pbpaste", [], { timeout: 2e3, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch {
    return void 0;
  }
}
async function waitForClipboardChange(before, timeoutMs, pollMs = 150) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = await readSystemClipboard();
    if (current !== void 0 && current.length > 0 && current !== before) {
      return current;
    }
    await new Promise((resolve4) => setTimeout(resolve4, pollMs));
  }
  return void 0;
}

// src/commands/doctor.ts
var DEFAULT_CHECKS = ["bridge", "login", "upload", "download", "clipboard", "modes", "tools", "selectors"];
var UPLOAD_REMEDIATION = [
  "Codex Settings > Computer Use > Chrome > Permissions > Uploads: set to Always allow, or add chatgpt.com to the allowed upload domains.",
  "Chrome chrome://extensions > Codex extension > Details: enable Allow access to file URLs."
];
async function doctor(env, args = {}) {
  const wanted = args.check ?? DEFAULT_CHECKS;
  const checks = {};
  const boot = await bootstrap(env, { preferExistingTab: true, timeoutMs: 3e4 });
  for (const check of wanted) {
    switch (check) {
      case "bridge":
        checks.bridge = boot.ok ? ok("Chrome bridge is available.") : bridgeCheck(boot);
        break;
      case "login":
        checks.login = await loginCheck(env, boot);
        break;
      case "upload":
        checks.upload = uploadCheck(env);
        break;
      case "download":
        checks.download = downloadCheck(env);
        break;
      case "clipboard":
        checks.clipboard = await clipboardCheck();
        break;
      case "modes":
        checks.modes = selectorCheck(env, "Mode/tool selection requires role/text selectors in the current ChatGPT page.");
        break;
      case "tools":
        checks.tools = selectorCheck(env, "Tool selection requires role/text selectors in the current ChatGPT page.");
        break;
      case "selectors":
        checks.selectors = selectorCheck(env, "Basic page selectors are available.");
        break;
    }
  }
  const ready = Object.values(checks).every((check) => check?.status === "ok" || check?.status === "unknown");
  return resultOk({ ready, checks }, await contextFromPage(env.page));
}
function bridgeCheck(boot) {
  if (boot.blocker?.kind === "browser_bridge_unavailable") {
    return blocked(boot.blocker.message, bridgeRemediation(boot));
  }
  if (boot.blocker?.kind === "login_required") {
    return ok("Chrome bridge is available; ChatGPT login is required before browser-control commands can continue.");
  }
  if (boot.blocker !== void 0) {
    return unknown(`Chrome bridge responded, but bootstrap is blocked by ${boot.blocker.kind}: ${boot.blocker.message}`);
  }
  return blocked(boot.error?.message ?? "Chrome bridge is unavailable.");
}
async function loginCheck(env, boot) {
  if (!boot.ok && boot.blocker?.kind === "login_required") {
    return blocked("ChatGPT login is required.", ["Ask the user to sign in to ChatGPT in Chrome, then retry."]);
  }
  if (env.page === void 0) {
    return boot.ok ? ok("Bootstrap completed; login appears usable.") : blocked("Cannot determine login because bootstrap failed.");
  }
  const state = await readPageState(env.page).catch(() => void 0);
  if (state?.blocker?.kind === "login_required") {
    return blocked("ChatGPT login is required.", ["Ask the user to sign in to ChatGPT in Chrome, then retry."]);
  }
  return state?.signedIn === true ? ok("ChatGPT appears signed in.") : unknown("Could not prove signed-in state from the visible page.");
}
function uploadCheck(env) {
  const page = env.page;
  if (page === void 0) {
    return unknown("Upload readiness requires a bootstrapped ChatGPT page.", UPLOAD_REMEDIATION);
  }
  if (typeof page.waitForEvent !== "function" && typeof page.evaluate !== "function") {
    return blocked("The active browser page exposes no upload-capable file chooser or DOM fallback.", UPLOAD_REMEDIATION);
  }
  return unknown("Upload permissions can only be proven by a live attach attempt.", UPLOAD_REMEDIATION);
}
function downloadCheck(env) {
  const page = env.page;
  if (page === void 0) return unknown("Download readiness requires a bootstrapped ChatGPT page.");
  return typeof page.waitForEvent === "function" ? ok("Browser download events are available.") : unsupported("The active browser page does not expose download events.");
}
async function clipboardCheck() {
  const value = await readSystemClipboard();
  return value === void 0 ? unknown("System clipboard could not be read; response.copy will use DOM fallback if copy does not change.") : ok("System clipboard can be read.");
}
function selectorCheck(env, message) {
  const page = env.page;
  if (page === void 0) return unknown("Selector readiness requires a bootstrapped ChatGPT page.");
  return typeof page.locator === "function" || typeof page.getByRole === "function" ? ok(message) : unsupported("The active page object does not expose locator or role selector helpers.");
}
function bridgeRemediation(boot) {
  const remediation = boot.blocker?.remediation ?? BROWSER_BRIDGE_REMEDIATION;
  return remediation.map((step) => `${step.label}: ${step.instruction}`);
}
function ok(message) {
  return { status: "ok", message };
}
function blocked(message, remediation) {
  return remediation === void 0 ? { status: "blocked", message } : { status: "blocked", message, remediation };
}
function unsupported(message, remediation) {
  return remediation === void 0 ? { status: "unsupported", message } : { status: "unsupported", message, remediation };
}
function unknown(message, remediation) {
  return remediation === void 0 ? { status: "unknown", message } : { status: "unknown", message, remediation };
}

// src/commands/output.ts
function commandOutputText(data) {
  if (!isRecord(data)) return void 0;
  const responseText = data.responseText;
  if (typeof responseText === "string") return responseText;
  const role = data.role;
  const text = data.text;
  if (typeof text === "string" && role !== "user") return text;
  const markdown = data.markdown;
  if (typeof markdown === "string") return markdown;
  for (const [key, value] of Object.entries(data)) {
    if (key === "prompt" || key === "input") continue;
    const nested = commandOutputText(value);
    if (nested !== void 0) return nested;
  }
  return void 0;
}
function withCommandOutputText(result) {
  if (result.output_text !== void 0) return result;
  const outputText = commandOutputText(result.data);
  return outputText === void 0 ? result : { ...result, output_text: outputText };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/commands/messages.ts
function isResponseComplete(snapshot) {
  return snapshot.latestText.trim().length > 0 && !isTransientAssistantText(snapshot.latestText) && snapshot.textStableForMs >= snapshot.stableMs && !snapshot.hasStopButton && snapshot.hasResponseActions;
}
async function composeMessage(env, args) {
  const boot = await ensurePage3(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  try {
    const textbox = composerTextbox(page);
    const text = args.mode === "append" ? `${await readLocatorText(textbox)}${args.text}` : args.text;
    await textbox.click?.();
    await textbox.fill?.(text);
    const actual = normalizeWhitespace(await readLocatorText(textbox));
    const wanted = normalizeWhitespace(text);
    if (actual !== wanted && actual.length > 0) {
      return {
        ok: false,
        status: "error",
        warnings: [],
        error: {
          name: "ComposerVerificationError",
          message: "Composer text did not match the requested prompt after fill.",
          recoverable: true
        },
        context: await contextFromPage(page)
      };
    }
    return resultOk({ text }, await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}
async function submitMessage(env, args = {}) {
  const boot = await ensurePage3(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  const previousTurnCount = args.previousTurnCount ?? await countPageMessages(page).catch(() => void 0);
  try {
    try {
      await sendButton(page).click?.();
    } catch {
      await page.keyboard?.press?.("Enter");
    }
    const userTurn = await waitForSubmittedUserTurn(page, args.text, previousTurnCount, args.timeoutMs ?? 3e4);
    if (userTurn === void 0) {
      const latestUser = await readLatestMessage(page, "user", "normalized_text");
      if (submittedUserTurnMatches(latestUser?.text, args.text)) {
        return resultOk(
          submitData(latestUser?.text, await countPageMessages(page).catch(() => void 0)),
          await contextFromPage(page)
        );
      }
      return {
        ok: false,
        status: "timeout",
        warnings: [],
        error: {
          name: "SubmitTimeout",
          message: "No matching submitted user turn appeared before the timeout.",
          recoverable: true
        },
        context: await contextFromPage(page)
      };
    }
    return resultOk(
      submitData(userTurn, await countPageMessages(page).catch(() => void 0)),
      await contextFromPage(page)
    );
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}
async function waitForMessage(env, args = {}) {
  const boot = await ensurePage3(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  const timeoutMs = args.timeoutMs ?? (args.mode === "deep_research" ? 18e5 : 12e4);
  const stableMs = args.stableMs ?? (args.mode === "deep_research" ? 1e4 : 2e3);
  const pollMs = args.pollMs ?? 750;
  const started = Date.now();
  let lastTargetText = "";
  let lastChangedAt = Date.now();
  let latestAssistantCount = await countPageMessages(page, "assistant").catch(() => 0);
  while (Date.now() - started < timeoutMs) {
    const state = await readPageState(page).catch(() => void 0);
    if (state?.blocker !== void 0 && state.blocker.kind !== "modal") {
      return {
        ok: false,
        status: "blocked",
        warnings: [],
        blocker: state.blocker,
        context: await contextFromPage(page)
      };
    }
    const progress = await readAssistantProgressSnapshot(page).catch(() => fallbackAssistantProgressSnapshot(page, latestAssistantCount));
    latestAssistantCount = progress.assistantTurnCount;
    const targetReached = waitTargetReached(args, progress);
    const latestText = targetReached ? normalizeWhitespace(progress.latestText ?? "") : "";
    if (latestText !== lastTargetText) {
      lastTargetText = latestText;
      lastChangedAt = Date.now();
    }
    const snapshot = {
      latestText,
      stableMs,
      textStableForMs: Date.now() - lastChangedAt,
      hasStopButton: await hasStopControl2(page),
      hasResponseActions: await hasResponseActions(page)
    };
    if (targetReached && isResponseComplete(snapshot)) {
      return withCommandOutputText(resultOk(
        { complete: true, responseText: latestText, assistantTurnCount: latestAssistantCount, elapsedMs: Date.now() - started },
        await contextFromPage(page)
      ));
    }
    await sleep2(page, pollMs);
  }
  if (lastTargetText.length > 0) {
    return withCommandOutputText({
      ok: false,
      status: "partial",
      data: {
        complete: false,
        responseText: lastTargetText,
        assistantTurnCount: latestAssistantCount,
        elapsedMs: Date.now() - started
      },
      warnings: ["Timed out after receiving partial assistant text."],
      context: await contextFromPage(page)
    });
  }
  return {
    ok: false,
    status: "timeout",
    warnings: [],
    error: {
      name: "WaitTimeout",
      message: "No assistant response appeared before the timeout.",
      recoverable: true
    },
    context: await contextFromPage(page)
  };
}
async function readLatest(env, args = {}) {
  const boot = await ensurePage3(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  const role = args.role ?? "assistant";
  const format = args.format ?? "markdown";
  const latest = await readLatestMessage(page, role, format, args.maxChars);
  if (latest === void 0) {
    return {
      ok: false,
      status: "not_found",
      warnings: [],
      blocker: {
        kind: "not_found",
        message: `No ${role} message is currently loaded.`
      },
      context: await contextFromPage(page)
    };
  }
  const data = { role, text: latest.text, format: latest.format };
  if (latest.source !== void 0) data.source = latest.source;
  if (latest.fidelity !== void 0) data.fidelity = latest.fidelity;
  if (latest.warnings !== void 0) data.warnings = latest.warnings;
  if (latest.markdown !== void 0) data.markdown = latest.markdown;
  if (latest.visibleText !== void 0) data.visibleText = latest.visibleText;
  if (latest.normalizedText !== void 0) data.normalizedText = latest.normalizedText;
  if (latest.html !== void 0) data.html = latest.html;
  if (latest.blocks !== void 0) data.blocks = latest.blocks;
  if (latest.citations !== void 0) data.citations = latest.citations;
  if (latest.codeBlocks !== void 0) data.codeBlocks = latest.codeBlocks;
  if (latest.tables !== void 0) data.tables = latest.tables;
  if (latest.branch !== void 0) data.branch = latest.branch;
  if (latest.actions !== void 0) data.actions = latest.actions;
  if (latest.thoughtDurationText !== void 0) data.thoughtDurationText = latest.thoughtDurationText;
  if (latest.sourcesAvailable !== void 0) data.sourcesAvailable = latest.sourcesAvailable;
  return withCommandOutputText(resultOk(data, await contextFromPage(page), data.warnings ?? []));
}
async function askMessage(env, args) {
  const boot = await ensurePage3(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  const beforeTurnCount = await countPageMessages(page).catch(() => void 0);
  const beforeAssistantTurnCount = await countPageMessages(page, "assistant").catch(() => void 0);
  const composeArgs = { text: args.text, mode: "replace" };
  if (args.timeoutMs !== void 0) {
    composeArgs.timeoutMs = args.timeoutMs;
  }
  const compose = await composeMessage(env, composeArgs);
  if (!compose.ok) {
    return forwardFailure(compose);
  }
  const submitArgs = { text: args.text };
  if (beforeTurnCount !== void 0) {
    submitArgs.previousTurnCount = beforeTurnCount;
  }
  if (args.timeoutMs !== void 0) {
    submitArgs.timeoutMs = args.timeoutMs;
  }
  const submit = await submitMessage(env, submitArgs);
  if (!submit.ok) {
    return forwardFailure(submit);
  }
  const readRequested = args.read === true || typeof args.read === "object";
  let waitResult;
  let waitFailure;
  if (args.wait === true || typeof args.wait === "object") {
    const waitArgs = typeof args.wait === "object" ? { ...args.wait } : {};
    if (beforeTurnCount !== void 0) {
      waitArgs.afterTurnCount = beforeTurnCount;
    }
    if (beforeAssistantTurnCount !== void 0) {
      waitArgs.afterAssistantTurnCount = beforeAssistantTurnCount;
    }
    waitResult = await waitForMessage(env, waitArgs);
    if (!waitResult.ok && waitResult.status !== "partial") {
      if (!readRequested || readRole(args.read) === "user") {
        return forwardFailure(waitResult);
      }
      waitFailure = waitResult;
    }
  }
  let responseText = waitResult?.data?.responseText;
  const warnings = [];
  if (readRequested) {
    const read = await readLatest(env, typeof args.read === "object" ? args.read : {});
    if (read.ok) {
      if (waitFailure !== void 0 && !readCapturedNewAssistantTurn(read, beforeTurnCount, beforeAssistantTurnCount)) {
        return forwardFailure(waitFailure);
      }
      responseText = read.data?.text;
      if (waitFailure !== void 0) {
        warnings.push(
          ...waitFailure.warnings,
          `Assistant response was read after ${waitFailure.status}, but completion was not confirmed by the wait step.`
        );
      }
    } else if (responseText === void 0) {
      return forwardFailure(waitFailure ?? read);
    }
  }
  if (waitFailure !== void 0 && responseText === void 0) {
    return forwardFailure(waitFailure);
  }
  const state = await readPageState(page).catch(() => void 0);
  const data = { prompt: args.text };
  const complete = waitResult?.data?.complete ?? (waitResult === void 0 ? void 0 : false);
  if (complete !== void 0) {
    data.complete = complete;
  }
  if (responseText !== void 0) {
    data.responseText = responseText;
  }
  if (state?.conversationId !== void 0) {
    data.conversationId = state.conversationId;
  }
  if (state?.title !== void 0) {
    data.title = state.title;
  }
  return withCommandOutputText(resultOk(data, await contextFromPage(page), warnings));
}
async function waitAndRead(env, args = {}) {
  const wait = await waitForMessage(env, args);
  if (!wait.ok && wait.status !== "partial") {
    return forwardFailure(wait);
  }
  const read = await readLatest(env, args);
  if (!read.ok) {
    if (wait.data?.responseText !== void 0) {
      return withCommandOutputText({
        ok: wait.ok,
        status: wait.status,
        data: {
          prompt: "",
          responseText: wait.data.responseText,
          complete: wait.data.complete
        },
        warnings: wait.warnings,
        context: wait.context
      });
    }
    return forwardFailure(read);
  }
  return withCommandOutputText(resultOk(askReadData("", read.data?.text, wait.data?.complete), read.context, wait.warnings));
}
async function ensurePage3(env) {
  if (env.page !== void 0) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
}
async function waitForSubmittedUserTurn(page, text, previousTurnCount, timeoutMs) {
  const started = Date.now();
  const wanted = text === void 0 ? void 0 : normalizeWhitespace(text);
  while (Date.now() - started < timeoutMs) {
    const snapshot = await readLatestMessageTextSnapshot(page, "user").catch(() => void 0);
    const latestText = snapshot?.latestText;
    const turnCount = snapshot?.turnCount;
    const countIncreased = previousTurnCount === void 0 || turnCount !== void 0 && turnCount > previousTurnCount;
    const latestMatches = submittedUserTurnMatches(latestText, wanted);
    if (latestText !== void 0 && countIncreased && latestMatches) {
      return latestText;
    }
    await sleep2(page, 250);
  }
  return void 0;
}
function submittedUserTurnMatches(actual, wanted) {
  if (wanted === void 0) {
    return actual !== void 0 && normalizeWhitespace(actual).length > 0;
  }
  const normalizedActual = normalizeWhitespace(actual ?? "");
  const normalizedWanted = normalizeWhitespace(wanted);
  if (normalizedActual === normalizedWanted || normalizedActual.includes(normalizedWanted)) {
    return true;
  }
  const renderedActual = normalizeSubmittedTurnRenderedText(actual ?? "");
  const renderedWanted = normalizeSubmittedTurnRenderedText(wanted);
  if (renderedActual === renderedWanted || renderedActual.includes(renderedWanted)) {
    return true;
  }
  const structuralActual = normalizeSubmittedTurnText(actual ?? "");
  const structuralWanted = normalizeSubmittedTurnText(wanted);
  if (structuralActual === structuralWanted || structuralActual.includes(structuralWanted)) {
    return true;
  }
  const structuralActualWithoutLanguage = normalizeSubmittedTurnText(actual ?? "", false);
  const structuralWantedWithoutLanguage = normalizeSubmittedTurnText(wanted, false);
  return structuralActualWithoutLanguage === structuralWantedWithoutLanguage || structuralActualWithoutLanguage.includes(structuralWantedWithoutLanguage);
}
function normalizeSubmittedTurnRenderedText(text) {
  return normalizeWhitespace(renderSubmittedTurnMarkdownSyntax(text));
}
function normalizeSubmittedTurnText(text, preserveFenceLanguage = true) {
  return normalizeWhitespace(
    renderSubmittedTurnMarkdownSyntax(text, preserveFenceLanguage).replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/^\s*[-*+]\s+/gm, "").replace(/\|/g, " ").replace(/(?:^|\s)-{3,}(?:\s|$)/g, " ")
  );
}
function renderSubmittedTurnMarkdownSyntax(text, preserveFenceLanguage = true) {
  return normalizeLineBreaks(text).replace(/```[ \t]*([a-z0-9_+#.-]+)?/gi, (_match, language) => language && preserveFenceLanguage ? `
${language}
` : "\n").replace(/~~~[ \t]*([a-z0-9_+#.-]+)?/gi, (_match, language) => language && preserveFenceLanguage ? `
${language}
` : "\n").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/_([^_]+)_/g, "$1");
}
async function hasStopControl2(page) {
  if (typeof page.evaluate === "function") {
    return page.evaluate(() => {
      const text = document.body?.innerText ?? "";
      return /\b(stop generating|stop streaming|cancel)\b/i.test(text);
    }).catch(() => false);
  }
  return false;
}
async function hasResponseActions(page) {
  try {
    const copyButtons = copyResponseButtons(page);
    const count = await copyButtons.count?.();
    if (count !== void 0) {
      return count > 0;
    }
    return await copyButtons.isVisible?.() === true;
  } catch {
    if (typeof page.evaluate === "function") {
      return page.evaluate(() => /\b(Copy response|More actions)\b/i.test(document.body?.innerText ?? "")).catch(() => false);
    }
    return true;
  }
}
async function readAssistantProgressSnapshot(page) {
  if (typeof page.evaluate === "function") {
    return page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
      const assistantNodes = nodes.filter((node) => node.getAttribute("data-message-author-role") === "assistant");
      const latestAssistant = assistantNodes.at(-1);
      const latestAssistantTurnIndex = latestAssistant === void 0 ? void 0 : nodes.indexOf(latestAssistant) + 1;
      const snapshot = {
        turnCount: nodes.length,
        assistantTurnCount: assistantNodes.length
      };
      const latestText = latestAssistant?.innerText ?? latestAssistant?.textContent ?? void 0;
      if (latestText !== void 0) snapshot.latestText = latestText;
      if (latestAssistantTurnIndex !== void 0) snapshot.latestAssistantTurnIndex = latestAssistantTurnIndex;
      return snapshot;
    });
  }
  return fallbackAssistantProgressSnapshot(page, 0);
}
async function fallbackAssistantProgressSnapshot(page, previousAssistantTurnCount) {
  const messages = await readMessages(page, { format: "normalized_text" }).catch(() => void 0);
  if (messages !== void 0) {
    let latestAssistantTurnIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") {
        latestAssistantTurnIndex = index;
        break;
      }
    }
    const assistantMessages = messages.filter((message) => message.role === "assistant");
    const snapshot2 = {
      turnCount: messages.length,
      assistantTurnCount: assistantMessages.length
    };
    const latestAssistant = latestAssistantTurnIndex === -1 ? void 0 : messages[latestAssistantTurnIndex];
    if (latestAssistant?.text !== void 0) snapshot2.latestText = latestAssistant.text;
    if (latestAssistantTurnIndex !== -1) snapshot2.latestAssistantTurnIndex = latestAssistantTurnIndex + 1;
    return snapshot2;
  }
  const snapshot = {
    assistantTurnCount: await countPageMessages(page, "assistant").catch(() => previousAssistantTurnCount)
  };
  const latestText = await readLatestMessageText(page, "assistant").catch(() => void 0);
  const turnCount = await countPageMessages(page).catch(() => void 0);
  if (latestText !== void 0) snapshot.latestText = latestText;
  if (turnCount !== void 0) snapshot.turnCount = turnCount;
  return snapshot;
}
function waitTargetReached(args, snapshot) {
  const assistantTargetReached = args.afterAssistantTurnCount === void 0 || snapshot.assistantTurnCount > args.afterAssistantTurnCount;
  const turnTargetReached = args.afterTurnCount === void 0 || (snapshot.latestAssistantTurnIndex !== void 0 ? snapshot.latestAssistantTurnIndex > args.afterTurnCount : snapshot.turnCount !== void 0 && snapshot.turnCount > args.afterTurnCount);
  return assistantTargetReached && turnTargetReached;
}
async function readLocatorText(locator) {
  if (typeof locator.innerText === "function") {
    return locator.innerText().catch(() => "");
  }
  if (typeof locator.textContent === "function") {
    return locator.textContent().then((text) => text ?? "").catch(() => "");
  }
  return "";
}
async function sleep2(page, ms) {
  if (typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(ms);
    return;
  }
  await new Promise((resolve4) => setTimeout(resolve4, ms));
}
function submitData(userTurnText, turnCount) {
  const data = { submitted: true };
  if (userTurnText !== void 0) {
    data.userTurnText = userTurnText;
  }
  if (turnCount !== void 0) {
    data.turnCount = turnCount;
  }
  return data;
}
function askReadData(prompt, responseText, complete) {
  const data = { prompt };
  if (responseText !== void 0) {
    data.responseText = responseText;
  }
  if (complete !== void 0) {
    data.complete = complete;
  }
  return data;
}
function readRole(read) {
  return typeof read === "object" ? read.role : void 0;
}
function readCapturedNewAssistantTurn(read, beforeTurnCount, beforeAssistantTurnCount) {
  const assistantAdvanced = beforeAssistantTurnCount === void 0 || read.context.assistantTurnCount !== void 0 && read.context.assistantTurnCount > beforeAssistantTurnCount;
  const turnAdvanced = beforeTurnCount === void 0 || read.context.turnCount !== void 0 && read.context.turnCount > beforeTurnCount;
  return assistantAdvanced && turnAdvanced;
}
function forwardFailure(result) {
  const forwarded = {
    ok: false,
    status: result.status,
    warnings: result.warnings,
    context: result.context
  };
  if (result.error !== void 0) {
    forwarded.error = result.error;
  }
  if (result.blocker !== void 0) {
    forwarded.blocker = result.blocker;
  }
  if (result.steps !== void 0) {
    forwarded.steps = result.steps;
  }
  return forwarded;
}

// src/dom/menus.ts
function extractMenuItemsFromText(text) {
  return text.split(/\n| {2,}| • /).map((label) => normalizeWhitespace(label)).filter(Boolean).map((label) => ({ label, normalized: normalizeLabel(label) }));
}
async function enumerateVisibleMenuItems(page) {
  if (typeof page.evaluate === "function") {
    const labels = await page.evaluate(() => {
      const roleItems = Array.from(document.querySelectorAll("[role='menuitem'], [role='menuitemradio'], [role='option']")).map((node) => node.innerText ?? node.textContent ?? "").filter(Boolean);
      if (roleItems.length > 0) {
        return { labels: roleItems, split: false };
      }
      const menus = Array.from(document.querySelectorAll("[role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]")).map((node) => node.innerText ?? node.textContent ?? "").filter(Boolean);
      return { labels: menus, split: true };
    });
    return labels.split ? labels.labels.flatMap((label) => extractMenuItemsFromText(label)) : labels.labels.map((label) => normalizeWhitespace(label)).filter(Boolean).map((label) => ({ label, normalized: normalizeLabel(label) }));
  }
  return [];
}
function findUniqueMenuItem(items, wanted) {
  const normalized = normalizeLabel(wanted);
  const exact = items.filter((item) => item.normalized === normalized);
  if (exact.length === 1) {
    return exact[0];
  }
  const fuzzy = items.filter((item) => item.normalized.includes(normalized));
  return fuzzy.length === 1 ? fuzzy[0] : void 0;
}

// src/commands/modes.ts
var DEFAULT_MODE_EFFORT = "Thinking";
var CURRENT_MODE_LABELS = ["Latest", "Instant", "Thinking", "Extended", "Pro"];
var MODE_OPENER_LABELS = [...CURRENT_MODE_LABELS.filter((label) => label !== "Pro"), "Configure"];
async function setMode(env, args) {
  const boot = await ensurePage4(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  try {
    const requested = requestedModeLabels(args);
    const opened = await waitForModeMenu(page, requested, args.timeoutMs ?? 3e4);
    if (opened.alreadySelected.length === requested.length) {
      return resultOk({ selected: opened.alreadySelected, candidates: opened.modeButtons }, await contextFromPage(page));
    }
    if (!opened.opened) {
      return selectorDrift(page, "No unique ChatGPT mode menu opener was found.");
    }
    await page.waitForTimeout?.(250);
    const candidates = await enumerateVisibleMenuItems(page);
    const selected = [];
    for (const item of requested) {
      const match = findUniqueMenuItem(candidates, item);
      if (match === void 0) {
        const candidateLabels = candidates.map((candidate) => candidate.label);
        return {
          ok: false,
          status: "unsupported",
          warnings: [],
          blocker: selectorDriftBlocker(`Mode option "${item}" was not found or was ambiguous.`, candidateLabels),
          context: await contextFromPage(page)
        };
      }
      if (!await clickMenuItem(page, match.label)) {
        return selectorDrift(page, `Mode option "${match.label}" was visible but could not be clicked.`, candidates.map((candidate) => candidate.label));
      }
      selected.push(match.label);
    }
    return resultOk({ selected, candidates: candidates.map((candidate) => candidate.label) }, await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}
async function waitForModeMenu(page, requested, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let modeButtons = [];
  do {
    modeButtons = await visibleModeButtonLabelList(page);
    const alreadySelected = findAlreadySelectedModes(modeButtons, requested);
    if (alreadySelected.length === requested.length) {
      return { opened: false, alreadySelected, modeButtons };
    }
    const openMenuItems = await enumerateVisibleMenuItems(page);
    if (looksLikeModeMenu(openMenuItems.map((item) => item.label))) {
      return { opened: true, alreadySelected: [], modeButtons };
    }
    if (await clickModeOpener(page, modeButtons)) {
      return { opened: true, alreadySelected: [], modeButtons };
    }
    if (Date.now() >= deadline) {
      break;
    }
    await page.waitForTimeout?.(250);
  } while (true);
  return { opened: false, alreadySelected: [], modeButtons };
}
async function selectTool(env, args) {
  const boot = await ensurePage4(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  try {
    const opened = await clickFirstUniqueButton(page, ["Add files and more", "Add files", "Add photos"]);
    if (!opened) {
      return selectorDrift(page, "No unique ChatGPT tool menu opener was found.");
    }
    await page.waitForTimeout?.(250);
    const candidates = await enumerateVisibleMenuItems(page);
    const wanted = toolLabel(args.tool);
    const match = findUniqueMenuItem(candidates, wanted);
    if (match === void 0) {
      const candidateLabels = candidates.map((candidate) => candidate.label);
      return {
        ok: false,
        status: "unsupported",
        warnings: [],
        blocker: selectorDriftBlocker(`Tool "${wanted}" was not found or was ambiguous.`, candidateLabels),
        context: await contextFromPage(page)
      };
    }
    if (!await clickMenuItem(page, match.label)) {
      return selectorDrift(page, `Tool "${match.label}" was visible but could not be clicked.`, candidates.map((candidate) => candidate.label));
    }
    return resultOk({ selected: match.label, candidates: candidates.map((candidate) => candidate.label) }, await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}
async function ensurePage4(env) {
  if (env.page !== void 0) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
}
async function clickFirstUniqueButton(page, labels) {
  for (const label of labels) {
    const roleLocator = page.getByRole?.("button", { name: label, exact: true });
    if (await clickIfUnique(roleLocator)) {
      return true;
    }
    const textLocator = page.locator?.("button, [role='button']")?.filter?.({ hasText: label });
    if (await clickIfUnique(textLocator)) {
      return true;
    }
  }
  return false;
}
async function clickModeOpener(page, modeButtons) {
  if (await clickFirstUniqueButton(page, modeButtons)) {
    return true;
  }
  return clickFirstUniqueButton(page, MODE_OPENER_LABELS);
}
function looksLikeModeMenu(labels) {
  return labels.some((label) => {
    const normalized = normalizeLabel(label);
    return CURRENT_MODE_LABELS.some((modeLabel) => visibleLabelMatches(normalized, normalizeLabel(modeLabel)));
  });
}
async function clickMenuItem(page, label) {
  if (await clickModelSwitcherMenuItem(page, label)) {
    return true;
  }
  if (await clickMenuItemByDom(page, label)) {
    return true;
  }
  const roleLocator = page.locator?.("[role='menuitem'], [role='menuitemradio'], [role='option']")?.filter?.({ hasText: label });
  if (await clickIfUnique(roleLocator)) {
    return true;
  }
  const textLocator = page.getByText?.(label, { exact: true });
  return clickIfUnique(textLocator);
}
async function clickModelSwitcherMenuItem(page, label) {
  if (typeof page.evaluate !== "function" || typeof page.locator !== "function") {
    return false;
  }
  const testId = await page.evaluate((wanted) => {
    const normalizedWanted = wanted.replace(/\s+/g, " ").trim().toLowerCase();
    const candidates = Array.from(document.querySelectorAll("[data-testid^='model-switcher-']"));
    const matches = candidates.filter((node) => {
      const element = node;
      const candidateTestId = element.getAttribute("data-testid") ?? "";
      if (candidateTestId.endsWith("-effort")) return false;
      const text = (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      return text === normalizedWanted;
    }).map((node) => node.getAttribute("data-testid")).filter((value) => value !== null);
    return matches.length === 1 ? matches[0] : void 0;
  }, label).catch(() => void 0);
  if (testId === void 0) {
    return false;
  }
  return clickIfUnique(page.locator(`[data-testid="${escapeAttributeValue(testId)}"]`));
}
async function clickMenuItemByDom(page, label) {
  if (typeof page.evaluate !== "function") {
    return false;
  }
  return page.evaluate((wanted) => {
    const normalizedWanted = wanted.replace(/\s+/g, " ").trim().toLowerCase();
    const candidates = Array.from(document.querySelectorAll("[role='menuitem'], [role='menuitemradio'], [role='option']"));
    const matches = candidates.filter((node) => {
      const element = node;
      const text = (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      return text === normalizedWanted;
    });
    if (matches.length !== 1) return false;
    matches[0].click();
    return true;
  }, label).catch(() => false);
}
async function clickIfUnique(locator) {
  if (locator === void 0 || typeof locator.count !== "function" || typeof locator.click !== "function") {
    return false;
  }
  const count = await locator.count().catch(() => 0);
  if (count !== 1) {
    return false;
  }
  await locator.click();
  return true;
}
function toolLabel(tool) {
  switch (tool) {
    case "web_search":
      return "Web search";
    case "deep_research":
      return "Deep research";
    case "create_image":
      return "Create image";
    default:
      return tool;
  }
}
function requestedModeLabels(args) {
  const requested = [args.model, args.effort].filter((value) => value !== void 0);
  return requested.length > 0 ? requested : [DEFAULT_MODE_EFFORT];
}
function findUniqueVisibleLabel(labels, wanted) {
  const normalized = normalizeLabel(wanted);
  const exact = labels.filter((label) => normalizeLabel(label) === normalized);
  if (exact.length === 1) {
    return exact[0];
  }
  const fuzzy = labels.filter((label) => visibleLabelMatches(normalizeLabel(label), normalized));
  return fuzzy.length === 1 ? fuzzy[0] : void 0;
}
function visibleLabelMatches(label, wanted) {
  if (wanted.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(wanted)}([^a-z0-9]|$)`, "i").test(label);
  }
  return label.includes(wanted);
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function escapeAttributeValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function findAlreadySelectedModes(visibleButtons, requested) {
  return requested.map((label) => findUniqueVisibleLabel(visibleButtons, label)).filter((label) => label !== void 0);
}
async function selectorDrift(page, message, candidates) {
  const visibleText = candidates?.join("\n") ?? await visibleButtonLabels(page);
  return {
    ok: false,
    status: "unsupported",
    warnings: [],
    blocker: selectorDriftBlocker(message, candidates, visibleText),
    context: await contextFromPage(page)
  };
}
function selectorDriftBlocker(message, candidates, visibleText = candidates?.join("\n") ?? "") {
  const candidateLabels = candidates ?? visibleText.split("\n").map((label) => label.trim()).filter(Boolean).slice(0, 30);
  const blocker = {
    kind: "selector_drift",
    code: "visible_candidate_not_found",
    message,
    visibleText,
    resumable: false
  };
  if (candidateLabels.length > 0) {
    blocker.candidates = candidateLabels.map((label) => ({ label }));
  }
  return blocker;
}
async function visibleButtonLabels(page) {
  return (await visibleButtonLabelList(page)).join("\n");
}
async function visibleButtonLabelList(page) {
  if (typeof page.evaluate !== "function") {
    return [];
  }
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("button, [role='button']")).map((node) => {
      const element = node;
      return element.getAttribute("aria-label") ?? element.innerText ?? element.textContent ?? "";
    }).map((text) => text.trim()).filter(Boolean).slice(0, 30);
  }).then((labels) => labels.map(normalizeWhitespace)).catch(() => []);
}
async function visibleModeButtonLabelList(page) {
  if (typeof page.evaluate !== "function") {
    return [];
  }
  return page.evaluate((modeLabels) => {
    const normalizedModeLabels = modeLabels.map((label) => label.toLowerCase());
    const tokenMatches = (text, token) => {
      if (token.length <= 3) {
        return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, "i").test(text);
      }
      return text.includes(token);
    };
    return Array.from(document.querySelectorAll("button, [role='button']")).map((node) => {
      const element = node;
      const visibleText = (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
      const ariaLabel = (element.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
      const label = visibleText.length > 0 ? visibleText : ariaLabel;
      const testId = element.getAttribute("data-testid") ?? "";
      if (testId === "accounts-profile-button") return "";
      if (/open profile menu/i.test(label)) return "";
      if (visibleText.length === 0 && /feedback|conversation options|dismiss/i.test(ariaLabel)) return "";
      const normalized = label.toLowerCase();
      if (!normalizedModeLabels.some((modeLabel) => tokenMatches(normalized, modeLabel))) return "";
      return label;
    }).filter(Boolean).slice(0, 30);
  }, CURRENT_MODE_LABELS).then((labels) => labels.map(normalizeWhitespace)).catch(() => []);
}

// src/commands/reports.ts
import { mkdir as mkdir3, stat as stat4, writeFile as writeFile2 } from "node:fs/promises";
import { join as join3 } from "node:path";

// src/safety/report-redaction.ts
var DEFAULT_MAX_PREVIEW_CHARS = 240;
var DEFAULT_MAX_DEPTH = 8;
var DEFAULT_MAX_ARRAY_ITEMS = 40;
var DEFAULT_MAX_OBJECT_ENTRIES = 80;
function redactReportValue(value, options = {}) {
  return redactValue(value, normalizeOptions(options), 0, /* @__PURE__ */ new WeakSet(), void 0);
}
function redactValue(value, options, depth, seen, key) {
  if (value === void 0 || value === null) return value;
  if (typeof value === "string") {
    if (!options.includeContent && key !== void 0 && isSafeControlStringKey(key)) {
      return value;
    }
    if (!options.includeContent) return `[redacted:${value.length} chars]`;
    return compactVisibleText(redactSensitiveText(value), options.maxPreviewChars);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return redactSensitiveText(String(value));
  if (seen.has(value)) return "[redacted:cycle]";
  if (depth >= options.maxDepth) return "[redacted:max-depth]";
  if (!options.includeContent && key !== void 0 && isHeavyContentKey(key)) {
    return summarizeHeavyValue(value);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, options.maxArrayItems).map((item) => redactValue(item, options, depth + 1, seen, key));
      if (value.length > options.maxArrayItems) {
        items.push(`[redacted:${value.length - options.maxArrayItems} more items]`);
      }
      return items;
    }
    const entries = Object.entries(value);
    const kept = entries.slice(0, options.maxObjectEntries).map(([childKey, child]) => [
      childKey,
      redactValue(child, options, depth + 1, seen, childKey)
    ]);
    if (entries.length > options.maxObjectEntries) {
      kept.push(["__redactedMoreEntries", entries.length - options.maxObjectEntries]);
    }
    return Object.fromEntries(kept);
  } finally {
    seen.delete(value);
  }
}
function normalizeOptions(options) {
  return {
    includeContent: options.includeContent === true,
    maxPreviewChars: options.maxPreviewChars ?? DEFAULT_MAX_PREVIEW_CHARS,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxArrayItems: options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS,
    maxObjectEntries: options.maxObjectEntries ?? DEFAULT_MAX_OBJECT_ENTRIES
  };
}
function isHeavyContentKey(key) {
  return /^(text|markdown|html|visibleText|normalizedText|responseText|output_text|outputText|finalOutput|prompt|blocks|tables|codeBlocks|dataPreview)$/i.test(key);
}
function summarizeHeavyValue(value) {
  if (Array.isArray(value)) return `[redacted-array:${value.length} items]`;
  return "[redacted-object]";
}
function isSafeControlStringKey(key) {
  return /^(schemaVersion|status|startedAt|endedAt|createdAt|timestamp|requiredFailures)$/i.test(key);
}

// src/commands/reports.ts
async function createRunReport(env, result, options = {}) {
  try {
    const destDir = options.destDir ?? "reports/runs";
    await mkdir3(destDir, { recursive: true });
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const safeBase = sanitizeBasename(options.basename ?? "chatgpt-run-report");
    const path = join3(destDir, `${stamp}-${safeBase}.json`);
    const includeContent = options.includeContent === true;
    const summary = redactReportValue({
      ok: result.ok,
      status: result.status,
      warnings: result.warnings,
      blocker: result.blocker,
      error: result.error,
      context: result.context,
      reportPath: result.reportPath
    }, options);
    const report2 = {
      schemaVersion: 1,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      includeContent,
      summary,
      steps: result.steps?.map((step) => ({
        ...step,
        dataPreview: redactReportValue(step.dataPreview, options)
      })),
      data: redactReportValue(result.data, options)
    };
    await writeFile2(path, `${JSON.stringify(report2, null, 2)}
`, "utf8");
    const saved = await stat4(path);
    return resultOk({ path, bytes: saved.size, includeContent }, await contextFromPage(env.page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(env.page));
  }
}
function sanitizeBasename(name) {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "chatgpt-run-report";
}

// src/commands/response-actions.ts
async function copyResponse(env, args = {}) {
  const boot = await ensurePage5(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  try {
    if (args.prefer !== "dom") {
      const before = await readClipboard(env);
      const buttons = copyResponseButtons(page);
      const target = args.which === void 0 || args.which === "latest" ? buttons.last?.() ?? buttons : buttons.nth?.(args.which.assistantIndex) ?? buttons;
      await target.click?.();
      const copied = await waitForClipboard(env, before, args.timeoutMs ?? 3e3);
      if (copied !== void 0) {
        const requestedFormat = normalizeResponseFormat(args.format);
        if (requestedFormat === "html" || requestedFormat === "blocks" || requestedFormat === "all") {
          const latest2 = await readSelectedAssistantMessage(page, args.which, requestedFormat);
          if (latest2 !== void 0) {
            const fallbackReason = `Clipboard copy succeeded, but ${formatLabel(requestedFormat)} requires DOM extraction.`;
            const data3 = copiedResponseFromExtracted(latest2, "dom", fallbackReason);
            data3.markdown = formatClipboardMarkdown(copied).markdown ?? copied;
            data3.warnings = [...data3.warnings ?? [], fallbackReason];
            return withCommandOutputText(resultOk(data3, await contextFromPage(page), data3.warnings));
          }
          const warning = `Clipboard copy succeeded, but ${formatLabel(requestedFormat)} requires DOM extraction and no assistant DOM message was available; returned clipboard Markdown instead.`;
          const data2 = {
            ...formatClipboardMarkdown(copied, void 0, "markdown"),
            source: "clipboard",
            fallbackReason: warning,
            warnings: [warning]
          };
          return withCommandOutputText(resultOk(data2, await contextFromPage(page), [warning]));
        }
        const metadata = await readSelectedAssistantMessage(page, args.which, "markdown").catch(() => void 0);
        const data = {
          ...formatClipboardMarkdown(copied, void 0, args.format),
          source: "clipboard"
        };
        mergeResponseMetadata(data, metadata);
        return withCommandOutputText(resultOk(
          data,
          await contextFromPage(page)
        ));
      }
    }
    const latest = await readSelectedAssistantMessage(page, args.which, args.format ?? "markdown");
    if (latest !== void 0) {
      const fallbackReason = args.prefer === "dom" ? `Returned DOM-derived ${formatLabel(latest.format)} because clipboard copy was not requested.` : "System clipboard did not change; returned DOM-derived response content.";
      const data = copiedResponseFromExtracted(latest, "dom", fallbackReason);
      return withCommandOutputText(resultOk(
        data,
        await contextFromPage(page),
        data.warnings ?? [fallbackReason]
      ));
    }
    return {
      ok: false,
      status: "not_found",
      warnings: [],
      blocker: {
        kind: "not_found",
        message: "No assistant response was available to copy."
      },
      context: await contextFromPage(page)
    };
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}
function readClipboard(env) {
  return env.clipboard?.read() ?? readSystemClipboard();
}
function waitForClipboard(env, before, timeoutMs) {
  return env.clipboard?.waitForChange(before, timeoutMs) ?? waitForClipboardChange(before, timeoutMs);
}
async function readSelectedAssistantMessage(page, which, format = "markdown") {
  if (which === void 0 || which === "latest") {
    return readLatestMessage(page, "assistant", format);
  }
  const messages = await readMessages(page, { role: "assistant", format });
  return messages.at(which.assistantIndex);
}
function formatLabel(format) {
  return format === "markdown" ? "Markdown" : format.replaceAll("_", " ");
}
function copiedResponseFromExtracted(latest, source, fallbackReason) {
  const data = {
    text: latest.text,
    format: latest.format,
    source
  };
  if (latest.fidelity !== void 0) data.fidelity = latest.fidelity;
  if (latest.warnings !== void 0 || fallbackReason !== void 0) {
    data.warnings = [...latest.warnings ?? [], ...fallbackReason === void 0 ? [] : [fallbackReason]];
  }
  if (fallbackReason !== void 0) data.fallbackReason = fallbackReason;
  mergeResponseMetadata(data, latest);
  return data;
}
function mergeResponseMetadata(data, latest) {
  if (latest === void 0) return;
  if (latest.markdown !== void 0 && data.markdown === void 0) data.markdown = latest.markdown;
  if (latest.visibleText !== void 0) data.visibleText = latest.visibleText;
  if (latest.normalizedText !== void 0) data.normalizedText = latest.normalizedText;
  if (latest.html !== void 0) data.html = latest.html;
  if (latest.blocks !== void 0) data.blocks = latest.blocks;
  if (latest.citations !== void 0) data.citations = latest.citations;
  if (latest.codeBlocks !== void 0) data.codeBlocks = latest.codeBlocks;
  if (latest.tables !== void 0) data.tables = latest.tables;
  if (latest.branch !== void 0) data.branch = latest.branch;
  if (latest.actions !== void 0) data.actions = latest.actions;
  if (latest.thoughtDurationText !== void 0) data.thoughtDurationText = latest.thoughtDurationText;
  if (latest.sourcesAvailable !== void 0) data.sourcesAvailable = latest.sourcesAvailable;
}
async function ensurePage5(env) {
  if (env.page !== void 0) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
}

// src/safety/risk.ts
var commandRisk = {
  "session.bootstrap": "low",
  "threads.search": "medium",
  "threads.open": "medium",
  "threads.new": "low",
  "messages.compose": "low",
  "messages.submit": "medium",
  "messages.ask": "medium",
  "messages.wait": "low",
  "messages.readLatest": "medium",
  "messages.waitAndRead": "medium",
  "artifacts.listLatest": "medium",
  "artifacts.wait": "low",
  "artifacts.downloadLatest": "medium",
  "files.attach": "medium",
  "files.downloadLatest": "medium",
  "response.copy": "medium",
  "modes.set": "medium",
  "tools.select": "medium",
  "threads.delete": "high",
  "threads.archive": "high",
  "threads.share": "high",
  "settings.change": "high",
  "apps.connect": "high"
};
function riskForCommand(command) {
  return commandRisk[command] ?? "high";
}

// src/commands/registry.ts
var descriptors = [
  workflow("ask", "Ask ChatGPT in a new or selected thread, optionally with files, wait/read, downloads, and reports.", [
    `await chatgpt.ask({ prompt: "reply with the word hi", wait: true, read: true });`
  ]),
  workflow("askInThread", "Open or claim an existing thread by URL, conversation id, title, or search query, then ask and read.", [
    `await chatgpt.askInThread({ thread: { type: "search", query: "Naming macOS Utility" }, prompt: "Continue." });`,
    `await chatgpt.askInThread({ thread: { type: "url", url: "https://chatgpt.com/c/<conversation-id>" }, existingTab: true, prompt: "Continue." });`
  ]),
  workflow("askWithFiles", "Attach absolute local file paths, optionally set mode, ask, wait, and read.", [
    `await chatgpt.askWithFiles({ thread: { type: "url", url: "https://chatgpt.com/c/<conversation-id>" }, existingTab: true, mode: { effort: "Thinking" }, files: ["/absolute/path/brief.md"], prompt: "Summarize this.", wait: true, read: { format: "markdown" } });`
  ]),
  workflow("askAndDownload", "Ask ChatGPT to produce a visible downloadable output and save the latest exposed file.", [
    `await chatgpt.askAndDownload({ prompt: "Create a CSV.", download: { destDir: "/tmp/out" }, wait: true });`
  ]),
  workflow("runMessages", "Run sequential prompts where later prompts can use earlier step data.", [
    `await chatgpt.runMessages({ messages: [{ id: "first", prompt: "alpha" }, { id: "second", prompt: "beta" }] });`
  ]),
  workflow("runner.run", "Agents-style facade: run a visible ChatGPT browser-control agent against input, files, thread, existing-tab, mode, and response options.", [
    `const agent = chatgpt.agent({ name: "reviewer", instructions: "Review deeply." }); await chatgpt.runner.run(agent, { input: "Review this.", thread: { type: "new" } });`,
    `await chatgpt.runner.run(agent, { input: "Continue.", thread: { type: "url", url: "https://chatgpt.com/c/<conversation-id>" }, existingTab: true });`
  ]),
  workflow("responses.create", "Narrow Responses-shaped adapter over the visible ChatGPT browser-control runner; rejects unsupported API-only fields before prompt submission.", [
    `await chatgpt.responses.create({ input: "Summarize.", thread: { type: "current" }, text: { format: "markdown" }, stream: false });`
  ]),
  workflow("copyLatest", "Copy or DOM-read the latest assistant response with Markdown-first fidelity.", [
    `await chatgpt.copyLatest({ prefer: "clipboard" });`
  ]),
  workflow("runPlan", "Execute an inline SequencePlan or named macro through the existing sequence engine.", [
    `await chatgpt.runPlan({ name: "new-ask-read", input: { prompt: "hi" } });`
  ]),
  workflow("new-ask-read", "Named macro: open a new thread, ask, wait, and read Markdown.", [
    `await chatgpt.runPlan({ name: "new-ask-read", input: { prompt: "hi" } });`
  ]),
  workflow("find-open-ask-read", "Named macro: search history, open the first match, ask, wait, and read Markdown.", [
    `await chatgpt.runPlan({ name: "find-open-ask-read", input: { query: "SDK Design Proposal", prompt: "Continue." } });`
  ]),
  workflow("find-open-copy-latest", "Named macro: search history, open the first match, and copy/read the latest response.", [
    `await chatgpt.runPlan({ name: "find-open-copy-latest", input: { query: "SDK Design Proposal" } });`
  ]),
  workflow("attach-ask-read", "Named macro: open a new thread, attach files, ask, wait, and read Markdown.", [
    `await chatgpt.runPlan({ name: "attach-ask-read", input: { files: ["/absolute/path.md"], prompt: "Summarize." } });`
  ]),
  workflow("ask-and-download", "Named macro: ask in a new thread and download the latest file affordance.", [
    `await chatgpt.runPlan({ name: "ask-and-download", input: { prompt: "Create a CSV.", destDir: "/tmp/out" } });`
  ]),
  workflow("two-turn", "Named macro: run two sequential prompts in a new thread.", [
    `await chatgpt.runPlan({ name: "two-turn", input: { first: "alpha", second: "beta" } });`
  ]),
  diagnostic("doctor-upload", "Named macro: preflight bridge, login, and upload permission remediation.", [
    `await chatgpt.runPlan({ name: "doctor-upload" });`
  ]),
  report("redacted-run-report", "Named macro: create a redacted report for a supplied CommandResult.", [
    `await chatgpt.runPlan({ name: "redacted-run-report", input: { result } });`
  ]),
  diagnostic("doctor", "Preflight browser bridge, login, upload, download, clipboard, mode, and tool readiness.", [
    `await chatgpt.doctor({ check: ["bridge", "login", "upload"] });`
  ]),
  report("createReport", "Write a durable redacted run report for a command result.", [
    `await chatgpt.createReport(result, { destDir: "/tmp/reports" });`
  ]),
  primitive("session.bootstrap", "Attach to ChatGPT in Chrome and detect login/blocker state.", 3e4),
  primitive("threads.new", "Open a new ChatGPT thread.", 3e4),
  primitive("threads.search", "Search visible ChatGPT history by query.", 3e4),
  primitive("threads.open", "Open a thread by URL, conversation id, title, or search result.", 3e4),
  primitive("messages.compose", "Fill the composer without submitting.", 3e4),
  primitive("messages.submit", "Submit the current composer contents.", 3e4),
  primitive("messages.ask", "Compose, submit, optionally wait, and optionally read.", 12e4),
  primitive("messages.wait", "Wait for the latest assistant response to stabilize.", 12e4),
  primitive("messages.readLatest", "Read the latest message as Markdown, normalized text, blocks, or HTML.", 3e4),
  primitive("messages.waitAndRead", "Wait for completion and read the latest message.", 12e4),
  primitive("artifacts.listLatest", "Detect the latest visible generated ChatGPT artifact, such as an image-only result.", 3e4),
  primitive("artifacts.wait", "Wait for a visible generated ChatGPT artifact to appear and stabilize.", 12e4),
  primitive("artifacts.downloadLatest", "Download or save the latest visible generated ChatGPT artifact.", 12e4),
  primitive("files.attach", "Attach absolute local file paths through visible ChatGPT upload controls.", 18e4),
  primitive("files.downloadLatest", "Download the latest visible ChatGPT file affordance.", 12e4),
  primitive("response.copy", "Click Copy response and return clipboard Markdown, with DOM fallback.", 5e3),
  primitive("modes.set", "Select a visible model or effort candidate when unambiguous.", 3e4),
  primitive("tools.select", "Select a visible ChatGPT tool when unambiguous.", 3e4)
];
function commandDescriptors() {
  return descriptors.map(cloneDescriptor);
}
function describeCommand(name) {
  const descriptor = descriptors.find((item) => item.name === name);
  if (descriptor === void 0) return void 0;
  return cloneDescriptor(descriptor);
}
function helpText(topic) {
  if (topic !== void 0) {
    const descriptor = describeCommand(topic);
    if (descriptor === void 0) return `No ChatGPT browser-control command is registered as "${topic}".`;
    return [
      `${descriptor.name} (${descriptor.layer}, ${descriptor.risk} risk)`,
      descriptor.summary,
      descriptor.defaultTimeoutMs === void 0 ? void 0 : `Default timeout: ${descriptor.defaultTimeoutMs} ms`,
      Object.keys(descriptor.args).length === 0 ? void 0 : `Args: ${Object.entries(descriptor.args).map(([name, description]) => `${name} (${description})`).join(", ")}`,
      Object.keys(descriptor.defaults).length === 0 ? void 0 : `Defaults: ${JSON.stringify(descriptor.defaults)}`,
      `Retry policy: ${descriptor.retryPolicy}`,
      descriptor.blockers.length === 0 ? void 0 : `Blockers: ${descriptor.blockers.join(", ")}`,
      descriptor.examples.length === 0 ? void 0 : `Example: ${descriptor.examples[0]}`
    ].filter((line) => line !== void 0).join("\n");
  }
  const grouped = groupByLayer(descriptors);
  return [
    "ChatGPT browser-control SDK commands",
    "",
    ...["workflow", "diagnostic", "report", "primitive"].flatMap((layer) => [
      `${layer}:`,
      ...(grouped[layer] ?? []).map((descriptor) => `- ${descriptor.name}: ${descriptor.summary}`)
    ])
  ].join("\n");
}
function workflow(name, summary, examples) {
  return {
    name,
    layer: "workflow",
    summary,
    risk: "medium",
    defaultTimeoutMs: 12e4,
    args: workflowArgs(name),
    defaults: workflowDefaults(name),
    retryPolicy: "Return structured CommandResult failures; do not resubmit prompts unless the sequence policy permits unmatched-turn recovery.",
    blockers: commonBlockers(),
    examples
  };
}
function diagnostic(name, summary, examples) {
  return {
    name,
    layer: "diagnostic",
    summary,
    risk: "low",
    defaultTimeoutMs: 3e4,
    args: diagnosticArgs(name),
    defaults: {},
    retryPolicy: "Return structured readiness checks; retry only after the reported blocker or permission setting changes.",
    blockers: ["browser_bridge_unavailable", "login_required", "selector_drift"],
    examples
  };
}
function report(name, summary, examples) {
  return {
    name,
    layer: "report",
    summary,
    risk: "low",
    defaultTimeoutMs: 5e3,
    args: reportArgs(name),
    defaults: { includeContent: false, maxPreviewChars: 240 },
    retryPolicy: "Do not retry blindly; preserve redaction defaults and report filesystem errors as CommandResult failures.",
    blockers: ["permission"],
    examples
  };
}
function primitive(name, summary, defaultTimeoutMs) {
  return {
    name,
    layer: "primitive",
    summary,
    risk: riskForCommand(name),
    defaultTimeoutMs,
    args: primitiveArgs(name),
    defaults: {},
    retryPolicy: "Return structured CommandResult failures; retry only when the blocker is recoverable and no duplicate prompt will be submitted.",
    blockers: primitiveBlockers(name),
    examples: primitiveExamples(name)
  };
}
function workflowArgs(name) {
  if (name === "find-open-copy-latest") return { query: "history search query" };
  if (name === "find-open-ask-read") return { query: "history search query", prompt: "message to send" };
  if (name === "attach-ask-read") return { files: "absolute local file paths", prompt: "message to send" };
  if (name === "ask-and-download") return { prompt: "message to send", destDir: "download destination directory" };
  if (name === "two-turn") return { first: "first message", second: "second message" };
  if (name === "new-ask-read") return { prompt: "message to send" };
  if (name === "askWithFiles") {
    return {
      files: "absolute local file paths to attach before submitting",
      prompt: "message to send after files are attached",
      thread: "optional thread selector",
      existingTab: "true or explicit policy to claim a user-open Chrome tab instead of opening a replacement",
      mode: 'optional visible mode selection, e.g. { effort: "Thinking" }',
      wait: "true or wait options; defaults to true",
      read: 'true or read options such as { format: "markdown" }; defaults to Markdown',
      report: "optional redacted report settings"
    };
  }
  return {
    prompt: "message to send or workflow-specific input",
    thread: "optional thread selector",
    existingTab: "true or explicit policy to claim a user-open Chrome tab instead of opening a replacement",
    report: "optional redacted report settings"
  };
}
function workflowDefaults(name) {
  if (name === "copyLatest" || name === "find-open-copy-latest") return { prefer: "clipboard", format: "markdown" };
  if (name === "runPlan") return {};
  return { wait: true, read: { format: "markdown" } };
}
function diagnosticArgs(name) {
  if (name === "doctor-upload") return {};
  return { check: "optional list of readiness checks" };
}
function reportArgs(name) {
  if (name === "redacted-run-report") return { result: "CommandResult to persist" };
  return { result: "CommandResult to persist", destDir: "optional report directory" };
}
function primitiveArgs(name) {
  if (name === "messages.readLatest") return { role: "assistant or user", format: "markdown, normalized_text, visible_text, html, blocks, or all" };
  if (name === "artifacts.listLatest") return { kind: "artifact kind; currently image", max: "maximum artifacts to return" };
  if (name === "artifacts.wait") return { kind: "artifact kind; currently image", afterArtifactCount: "baseline artifact count", requireDownload: "wait until a download affordance is visible" };
  if (name === "artifacts.downloadLatest") return { destDir: "download destination directory", prefer: "download_control or visible_image_source" };
  if (name === "response.copy") return { prefer: "clipboard or dom", format: "markdown, normalized_text, visible_text, html, blocks, or all" };
  if (name.startsWith("threads.search")) return { query: "history search query" };
  if (name.startsWith("files.attach")) return { paths: "absolute local file paths" };
  if (name === "modes.set") {
    return {
      effort: "visible effort label such as Thinking or Extended",
      model: "visible model label such as Instant, Pro, or another available model",
      timeoutMs: "optional timeout for opening and selecting the visible mode menu"
    };
  }
  return {};
}
function primitiveExamples(name) {
  if (name === "modes.set") {
    return [
      `await chatgpt.modes.set({ effort: "Thinking" });`,
      `await chatgpt.askWithFiles({ mode: { effort: "Thinking" }, files: ["/absolute/path.jpg"], prompt: "Describe this image.", wait: true });`
    ];
  }
  if (name === "files.attach") {
    return [`await chatgpt.files.attach({ paths: ["/absolute/path.jpg"] });`];
  }
  if (name.startsWith("artifacts.")) {
    return [`await chatgpt.artifacts.downloadLatest({ destDir: "/tmp/out" });`];
  }
  return [];
}
function primitiveBlockers(name) {
  if (name.startsWith("files.attach")) return ["browser_bridge_unavailable", "login_required", "permission", "upload_failed"];
  if (name.startsWith("files.download")) return ["browser_bridge_unavailable", "login_required", "download_unavailable"];
  if (name.startsWith("artifacts.")) return ["browser_bridge_unavailable", "login_required", "artifact_unavailable", "artifact_selector_drift", "artifact_download_unavailable"];
  if (name.startsWith("modes.") || name.startsWith("tools.")) return ["browser_bridge_unavailable", "login_required", "selector_drift"];
  return commonBlockers();
}
function commonBlockers() {
  return ["browser_bridge_unavailable", "login_required", "captcha", "rate_limit", "selector_drift"];
}
function groupByLayer(items) {
  return items.reduce((grouped, item) => {
    grouped[item.layer].push(item);
    return grouped;
  }, { workflow: [], primitive: [], diagnostic: [], report: [] });
}
function cloneDescriptor(descriptor) {
  return {
    ...descriptor,
    args: { ...descriptor.args },
    defaults: { ...descriptor.defaults },
    blockers: [...descriptor.blockers],
    examples: [...descriptor.examples]
  };
}

// src/commands/threads.ts
var CHATGPT_HOME2 = "https://chatgpt.com/";
function extractThreadSearchResultsFromHtml(html) {
  const anchors = html.matchAll(/<a\b(?<attrs>[^>]*\bhref=["'](?<href>\/c\/[^"']+)["'][^>]*)>(?<body>[\s\S]*?)<\/a>/gi);
  const results = [];
  for (const anchor of anchors) {
    const href = anchor.groups?.href;
    const body = anchor.groups?.body ?? "";
    if (href === void 0) {
      continue;
    }
    const lines = extractBlockTexts(body);
    const fallback = normalizeWhitespace(stripTags(body));
    const title = lines[0] ?? fallback;
    if (title.length === 0) {
      continue;
    }
    const result = { title, href };
    const conversationId = parseConversationId(href);
    if (conversationId !== void 0) {
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
async function searchThreads(env, args) {
  const boot = await ensurePage6(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  try {
    const warnings = [];
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
async function newThread(env, args = {}) {
  const boot = await ensurePage6(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  try {
    try {
      await newChatButton(page).click?.();
    } catch {
      await page.goto?.(CHATGPT_HOME2, { waitUntil: "domcontentloaded", timeout: args.timeoutMs ?? 3e4 });
    }
    await page.waitForTimeout?.(500);
    const state = await readPageState(page);
    return resultOk(openThreadData(state.url, state.conversationId, state.title), await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}
async function openThread(env, args, previousResults) {
  const boot = await ensurePage6(env);
  if (!boot.ok) {
    return boot;
  }
  const page = env.page;
  try {
    const target = await resolveOpenTarget(env, args, previousResults);
    if (target === void 0) {
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
    if (target.href !== void 0 && target.href.startsWith("/")) {
      await page.goto?.(new URL(target.href, CHATGPT_HOME2).toString(), { waitUntil: "domcontentloaded", timeout: args.timeoutMs ?? 3e4 });
    } else {
      await page.goto?.(target.href ?? target.url, { waitUntil: "domcontentloaded", timeout: args.timeoutMs ?? 3e4 });
    }
    await waitForThreadHydrated(page, args.timeoutMs ?? 3e4, parseConversationId(target.url));
    const state = await readPageState(page);
    return resultOk(
      openThreadData(state.url, state.conversationId, state.title ?? target.title),
      await contextFromPage(page)
    );
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}
async function ensurePage6(env) {
  if (env.page !== void 0) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
}
async function resolveOpenTarget(env, args, previousResults) {
  if (args.url !== void 0) {
    return { url: args.url };
  }
  if (args.conversationId !== void 0) {
    return { url: new URL(`/c/${args.conversationId}`, CHATGPT_HOME2).toString() };
  }
  if (args.fromStep !== void 0 && previousResults !== void 0) {
    const previous = previousResults.get(args.fromStep);
    const data = previous?.data;
    const selected = selectSearchResult(data?.results ?? [], args.select ?? "first");
    if (selected !== void 0) {
      return { href: selected.href, url: new URL(selected.href, CHATGPT_HOME2).toString(), title: selected.title };
    }
  }
  if (args.title !== void 0) {
    const search = await searchThreads(env, { query: args.title, limit: 10 });
    const selected = selectSearchResult(search.data?.results ?? [], { title: args.title }) ?? search.data?.results[0];
    if (selected !== void 0) {
      return { href: selected.href, url: new URL(selected.href, CHATGPT_HOME2).toString(), title: selected.title };
    }
  }
  return void 0;
}
function selectSearchResult(results, select = "first") {
  if (select === "first") {
    return results[0];
  }
  if (select !== void 0 && "index" in select) {
    return results[select.index];
  }
  if (select !== void 0 && "title" in select) {
    const wanted = normalizeForMatch(select.title);
    return results.find((result) => normalizeForMatch(result.title) === wanted) ?? results.find((result) => normalizeForMatch(result.title).includes(wanted));
  }
  return void 0;
}
async function extractThreadSearchResultsFromPage(page) {
  if (page === void 0) {
    return [];
  }
  if (typeof page.evaluate === "function") {
    const raw = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href^='/c/']")).map((anchor) => ({
        href: anchor.getAttribute("href") ?? "",
        text: anchor.innerText ?? anchor.textContent ?? ""
      })).filter((item) => item.href.length > 0 && item.text.trim().length > 0);
    });
    return dedupeResults(raw.map((item) => {
      const lines = item.text.split(/\n+/).map((line) => normalizeWhitespace(line)).filter(Boolean);
      const result = {
        title: lines[0] ?? normalizeWhitespace(item.text),
        href: item.href
      };
      const conversationId = parseConversationId(item.href);
      if (conversationId !== void 0) {
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
function dedupeResults(results) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
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
function normalizeForMatch(text) {
  return normalizeWhitespace(text).toLowerCase();
}
async function openSearchUI(page) {
  try {
    await searchChatsButton(page).click?.();
    await page.waitForTimeout?.(250);
    return;
  } catch {
  }
  if (typeof page.evaluate === "function") {
    try {
      await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll("button")).find((candidate) => /Search chats/i.test(candidate.innerText ?? candidate.textContent ?? ""));
        button?.click();
      });
      await page.waitForTimeout?.(250);
      return;
    } catch {
    }
  }
  await page.keyboard?.press?.("Meta+K");
  await page.waitForTimeout?.(250);
}
async function fillSearchQuery(page, query) {
  const attempts = [
    async () => searchChatsInput(page).fill?.(query),
    async () => page.getByRole?.("textbox", { name: "Search chats" }).fill?.(query),
    async () => page.getByRole?.("textbox", { name: /Search chats/i }).fill?.(query),
    async () => requiredLocator(page, "input[placeholder*='Search'], [role='dialog'] input").fill?.(query)
  ];
  let lastError;
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
function openThreadData(url, conversationId, title) {
  const data = { url };
  if (conversationId !== void 0) {
    data.conversationId = conversationId;
  }
  if (title !== void 0) {
    data.title = title;
  }
  return data;
}
function extractBlockTexts(html) {
  const chunks = Array.from(html.matchAll(/<(?:div|span|p|h[1-6])\b[^>]*>([\s\S]*?)<\/(?:div|span|p|h[1-6])>/gi)).map((match) => stripTags(match[1] ?? "")).filter(Boolean);
  if (chunks.length > 0) {
    return chunks;
  }
  const fallback = stripTags(html);
  return fallback.length > 0 ? [fallback] : [];
}
function filterResultsByQuery(results, query) {
  const wanted = normalizeForMatch(query);
  return results.filter((result) => {
    const haystack = normalizeForMatch(`${result.title} ${result.snippet ?? ""}`);
    return haystack.includes(wanted) || wanted.includes(normalizeForMatch(result.title));
  });
}
async function waitForThreadHydrated(page, timeoutMs, expectedConversationId) {
  const started = Date.now();
  await page.waitForTimeout?.(1e3);
  while (Date.now() - started < timeoutMs) {
    const url = typeof page.url === "function" ? await Promise.resolve(page.url()).catch(() => "") : "";
    const urlMatches2 = expectedConversationId === void 0 || url.includes(expectedConversationId);
    const count = await countPageMessages(page).catch(() => 0);
    const latestAssistantText = await readLatestMessageText(page, "assistant").catch(() => void 0);
    const title = typeof page.title === "function" ? await page.title().catch(() => "") : "";
    if (urlMatches2 && ((latestAssistantText?.trim().length ?? 0) > 0 || count > 0 && title.length > 0 && title !== "ChatGPT")) {
      await page.waitForTimeout?.(250);
      return;
    }
    await page.waitForTimeout?.(500);
  }
}

// src/commands/sequence.ts
var defaultSequencePolicy = {
  stopOnError: true,
  returnPartial: true,
  defaultTimeoutMs: 12e4,
  screenshotOnBlocker: true,
  allowPromptResubmit: "only_if_no_matching_user_turn"
};
async function runSequence(plan, env = {}) {
  return runSequenceWithExecutor(plan, executeStep, env);
}
async function runSequenceWithExecutor(plan, executor, env = {}) {
  const policy = normalizePolicy(plan.policy);
  const stepResults = [];
  const values = /* @__PURE__ */ new Map();
  const input = plan.input ?? {};
  for (const step of plan.steps) {
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const resolvedStep = resolveStepArgs(step, values, input);
    const result = await executor(resolvedStep, env, values, policy);
    values.set(step.id, result);
    stepResults.push(toStepResult(step, result, startedAt));
    if (!result.ok && policy.stopOnError) {
      return sequenceFailure(result, values, stepResults, policy);
    }
  }
  const lastStep = plan.steps.at(-1);
  const finalResult = lastStep === void 0 ? okSequenceResult(values, stepResults) : values.get(lastStep.id);
  if (finalResult === void 0) {
    return okSequenceResult(values, stepResults);
  }
  return withCommandOutputText({ ...finalResult, steps: stepResults });
}
async function executeStep(step, env, previousResults) {
  switch (step.command) {
    case "session.bootstrap":
      return bootstrap(env, step.args);
    case "threads.search":
      return searchThreads(env, step.args);
    case "threads.open":
      return openThread(env, step.args, previousResults);
    case "threads.new":
      return newThread(env, step.args);
    case "messages.compose":
      return composeMessage(env, step.args);
    case "messages.submit":
      return submitMessage(env, step.args);
    case "messages.ask":
      return askMessage(env, step.args);
    case "messages.wait":
      return waitForMessage(env, step.args);
    case "messages.readLatest":
      return readLatest(env, step.args);
    case "messages.waitAndRead":
      return waitAndRead(env, step.args);
    case "artifacts.listLatest":
      return listLatestArtifacts(env, step.args);
    case "artifacts.wait":
      return waitForArtifact(env, step.args);
    case "artifacts.downloadLatest":
      return downloadLatestArtifact(env, step.args);
    case "files.attach":
      return attachFiles(env, step.args);
    case "files.downloadLatest":
      return downloadLatestFile(env, step.args);
    case "response.copy":
      return copyResponse(env, step.args);
    case "modes.set":
      return setMode(env, step.args);
    case "tools.select":
      return selectTool(env, step.args);
  }
}
function normalizePolicy(policy) {
  return { ...defaultSequencePolicy, ...policy ?? {} };
}
function resolveStepArgs(step, previousResults, input = {}) {
  if (!("args" in step) || step.args === void 0) {
    return step;
  }
  return {
    ...step,
    args: resolveValue(step.args, previousResults, input)
  };
}
function resolveVariableReference(reference, previousResults, input = {}) {
  const match = /^\$\{([^}]+)\}$/.exec(reference);
  if (match === null) {
    return reference;
  }
  const path = match[1];
  if (path === void 0 || path.length === 0) {
    throw new Error("Empty variable reference is not allowed.");
  }
  if (path.includes("__proto__") || path.includes("prototype") || path.includes("constructor")) {
    throw new Error(`Unsafe variable reference rejected: ${path}`);
  }
  const [root, ...segments] = tokenizePath(path);
  let current;
  if (root === "input") {
    current = input;
  } else if (root !== void 0 && previousResults.has(root)) {
    current = previousResults.get(root);
  } else {
    throw new Error(`Unknown variable root: ${root ?? ""}`);
  }
  for (const segment of segments) {
    current = readPathSegment(current, segment);
  }
  return current;
}
function resolveValue(value, previousResults, input) {
  if (typeof value === "string") {
    return resolveVariableReference(value, previousResults, input);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, previousResults, input));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, resolveValue(child, previousResults, input)])
    );
  }
  return value;
}
function tokenizePath(path) {
  const segments = [];
  for (const part of path.split(".")) {
    const head = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(part)?.[1];
    if (head === void 0) {
      throw new Error(`Invalid variable path segment: ${part}`);
    }
    segments.push(head);
    for (const indexMatch of part.matchAll(/\[(\d+)\]/g)) {
      segments.push(indexMatch[1]);
    }
    const consumed = `${head}${Array.from(part.matchAll(/\[(\d+)\]/g)).map((match) => `[${match[1]}]`).join("")}`;
    if (consumed !== part) {
      throw new Error(`Invalid variable path segment: ${part}`);
    }
  }
  return segments;
}
function readPathSegment(value, segment) {
  if (value === null || value === void 0) {
    return void 0;
  }
  if (Array.isArray(value)) {
    const index = Number(segment);
    if (!Number.isInteger(index)) {
      throw new Error(`Array segment must be numeric: ${segment}`);
    }
    return value[index];
  }
  if (typeof value === "object") {
    return value[segment];
  }
  return void 0;
}
function toStepResult(step, result, startedAt) {
  const stepResult = {
    id: step.id,
    command: step.command,
    status: result.status,
    ok: result.ok,
    startedAt,
    endedAt: (/* @__PURE__ */ new Date()).toISOString(),
    warnings: result.warnings
  };
  const dataPreview = previewData(result.data);
  if (dataPreview !== void 0) {
    stepResult.dataPreview = dataPreview;
  }
  return stepResult;
}
function previewData(data) {
  if (data === void 0) {
    return void 0;
  }
  if (typeof data === "string") {
    return data.length > 120 ? `${data.slice(0, 119)}...` : data;
  }
  if (Array.isArray(data)) {
    return { type: "array", length: data.length };
  }
  if (typeof data === "object" && data !== null) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => {
        if (/text|prompt|response/i.test(key) && typeof value === "string") {
          return [key, value.length > 120 ? `${value.slice(0, 119)}...` : value];
        }
        return [key, value];
      })
    );
  }
  return data;
}
function sequenceFailure(result, values, stepResults, policy) {
  const failure = {
    ok: false,
    status: policy.returnPartial ? "partial" : result.status,
    data: collectSequenceData(values),
    warnings: collectWarnings(stepResults, result.warnings),
    context: result.context,
    steps: stepResults
  };
  if (result.error !== void 0) {
    failure.error = result.error;
  }
  if (result.blocker !== void 0) {
    failure.blocker = result.blocker;
  }
  return withCommandOutputText(failure);
}
function okSequenceResult(values, stepResults) {
  return withCommandOutputText({
    ok: true,
    status: "ok",
    data: collectSequenceData(values),
    warnings: collectWarnings(stepResults),
    context: { timestamp: (/* @__PURE__ */ new Date()).toISOString() },
    steps: stepResults
  });
}
function collectSequenceData(values) {
  return Object.fromEntries(
    Array.from(values.entries()).map(([id, result]) => [id, result.data])
  );
}
function collectWarnings(stepResults, extra = []) {
  return [...stepResults.flatMap((step) => step.warnings), ...extra];
}

// src/runner/agent.ts
function createChatGPTAgent(config) {
  const name = config.name.trim();
  if (name.length === 0) {
    throw new Error("ChatGPT agent name must be a non-empty string.");
  }
  return {
    kind: "chatgpt_browser_agent",
    name,
    ...config.instructions === void 0 ? {} : { instructions: config.instructions },
    instructionsMode: config.instructionsMode ?? "visible_prefix",
    defaults: { ...config.defaults ?? {} },
    tools: [...config.tools ?? []],
    guardrails: [...config.guardrails ?? []],
    ...config.output === void 0 ? {} : { output: config.output },
    ...config.metadata === void 0 ? {} : { metadata: { ...config.metadata } }
  };
}

// src/runner/resume.ts
var NEVER_AUTO_RESUME = /* @__PURE__ */ new Set([
  "captcha",
  "login_required",
  "rate_limit",
  "selector_drift",
  "unknown"
]);
function resumeDecisionForBlocker(blocker, stateId) {
  if (blocker === void 0) {
    return { supported: false, reason: "This result has no resumable browser-control blocker." };
  }
  if (NEVER_AUTO_RESUME.has(blocker.kind)) {
    return { supported: false, reason: "This blocker is not safe to resume automatically." };
  }
  if (blocker.resumable === true) {
    return stateId === void 0 ? { supported: true } : { supported: true, stateId };
  }
  return { supported: false, reason: "The underlying browser-control command did not mark this blocker as resumable." };
}
function augmentCommandBlocker(blocker) {
  const augmented = { ...blocker };
  if (augmented.resumable === void 0) {
    augmented.resumable = blocker.kind === "confirmation" || blocker.kind === "permission";
  }
  return augmented;
}

// src/runner/interruptions.ts
function interruptionFromCommandResult(result, command) {
  if (!isInterruptingResult(result)) {
    return void 0;
  }
  const id = `interruption-${Date.now().toString(36)}`;
  const blocker = result.blocker === void 0 ? void 0 : augmentCommandBlocker(result.blocker);
  const remediation = blocker?.remediation ?? [];
  const interruption = {
    id,
    type: interruptionType(result, blocker),
    status: result.status,
    message: blocker?.message ?? result.error?.message ?? result.status,
    resume: resumeDecisionForBlocker(blocker, id)
  };
  if (blocker !== void 0) {
    interruption.blocker = blocker;
    if (blocker.fieldPath !== void 0) interruption.fieldPath = blocker.fieldPath;
  }
  if (command !== void 0) interruption.command = command;
  if (remediation.length > 0) {
    interruption.fix = {
      summary: "Resolve the reported blocker before resuming.",
      steps: remediation.map((step) => step.instruction)
    };
  }
  return interruption;
}
function isInterruptingResult(result) {
  return result.blocker !== void 0 || result.status === "needs_confirmation" || result.status === "unsupported" || result.status === "timeout";
}
function interruptionType(result, blocker) {
  switch (blocker?.kind) {
    case "confirmation":
      return "approval_required";
    case "permission":
    case "upload_failed":
    case "download_unavailable":
      return "permission_required";
    case "login_required":
      return "login_required";
    case "captcha":
      return "captcha";
    case "rate_limit":
      return "rate_limit";
    case "selector_drift":
      return "selector_drift";
    case "browser_bridge_unavailable":
    case "not_found":
    case "modal":
    case "unknown":
    case void 0:
      break;
  }
  if (result.status === "needs_confirmation") return "approval_required";
  if (result.status === "timeout") return "timeout";
  return "unsupported";
}

// src/runner/result.ts
function toRunResult(agent, result) {
  const outputText = extractOutputText(result.data);
  const finalOutput = parseFinalOutput(agent, outputText);
  const interruption = interruptionFromCommandResult(result, failedCommand(result));
  const interruptions = interruption === void 0 ? [] : [interruption];
  const output = runItemsFromResult(result, outputText);
  const state = runStateFromResult(result, interruptions);
  const data = { outputText };
  if (finalOutput !== void 0) data.finalOutput = finalOutput;
  const thread = threadRefFromContext(result.context);
  if (thread !== void 0) data.thread = thread;
  if (result.reportPath !== void 0) data.reportPath = result.reportPath;
  const mapped = {
    ...result,
    data,
    output_text: outputText,
    output,
    newItems: output,
    interruptions,
    state,
    activeAgentName: agent.name,
    lastAgentName: agent.name
  };
  if (finalOutput !== void 0) mapped.finalOutput = finalOutput;
  return mapped;
}
function extractOutputText(data) {
  if (!isRecord2(data)) return "";
  if (typeof data.responseText === "string") return data.responseText;
  if (typeof data.text === "string") return data.text;
  for (const value of Object.values(data)) {
    const nested = extractOutputText(value);
    if (nested.length > 0) return nested;
  }
  return "";
}
function parseFinalOutput(agent, outputText) {
  if (outputText.length === 0) return void 0;
  if (agent.output?.parse === "json") {
    try {
      return JSON.parse(outputText);
    } catch {
      return agent.output.onParseError === "return_text" ? outputText : void 0;
    }
  }
  return outputText;
}
function runItemsFromResult(result, outputText) {
  const items = messageItemsFromData(result.data);
  if (!items.some((item) => item.type === "message.completed") && outputText.length > 0) {
    items.push({ type: "message.completed", role: "assistant", output_text: outputText, format: "markdown" });
  }
  if (result.blocker !== void 0) {
    items.push({ type: "run.blocked", blocker: augmentCommandBlocker(result.blocker) });
  }
  return items;
}
function messageItemsFromData(data) {
  if (!isRecord2(data)) return [];
  const items = [];
  if (typeof data.prompt === "string" && data.prompt.length > 0) {
    items.push({
      type: "message.submitted",
      role: "user",
      preview: data.prompt.length > 160 ? `${data.prompt.slice(0, 159)}...` : data.prompt,
      redacted: true
    });
  }
  if (typeof data.responseText === "string" && data.responseText.length > 0) {
    items.push({ type: "message.completed", role: "assistant", output_text: data.responseText, format: "markdown" });
  }
  if (items.length > 0) return items;
  for (const value of Object.values(data)) {
    const nested = messageItemsFromData(value);
    if (nested.length > 0) return nested;
  }
  return [];
}
function runStateFromResult(result, interruptions) {
  const resumable = interruptions.some((interruption) => interruption.resume.supported);
  const firstResume = interruptions.find((interruption) => interruption.resume.supported)?.resume;
  const state = {
    id: firstResume?.supported === true && firstResume.stateId !== void 0 ? firstResume.stateId : `run_${Date.now().toString(36)}`,
    resumable
  };
  const thread = threadRefFromContext(result.context);
  if (thread !== void 0) state.thread = thread;
  return state;
}
function threadRefFromContext(context) {
  const thread = {};
  if (context.url !== void 0) thread.url = context.url;
  if (context.conversationId !== void 0) thread.conversationId = context.conversationId;
  if (context.title !== void 0) thread.title = context.title;
  return Object.keys(thread).length === 0 ? void 0 : thread;
}
function failedCommand(result) {
  if (result.steps === void 0) return void 0;
  for (let index = result.steps.length - 1; index >= 0; index -= 1) {
    const step = result.steps[index];
    if (step?.ok === false) return step.command;
  }
  return void 0;
}
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// src/runner/responses.ts
var acceptedTopLevelFields = /* @__PURE__ */ new Set([
  "input",
  "thread",
  "existingTab",
  "preferExistingTab",
  "attachments",
  "mode",
  "tools",
  "text",
  "stream",
  "report",
  "instructions",
  "instructionsMode"
]);
var unsupportedAlternatives = {
  model: "Use mode for visible ChatGPT UI mode preference. This does not select an API model.",
  temperature: "No browser-control equivalent. ChatGPT web does not expose API temperature.",
  top_p: "No browser-control equivalent. ChatGPT web does not expose API nucleus sampling.",
  seed: "No browser-control equivalent. Visible ChatGPT web does not expose deterministic API seeds.",
  logprobs: "No browser-control equivalent. Visible ChatGPT web does not expose token log probabilities.",
  top_logprobs: "No browser-control equivalent. Visible ChatGPT web does not expose token log probabilities.",
  previous_response_id: 'Use thread: { type: "conversationId", conversationId } or a ChatGPT thread URL.',
  store: "No browser-control equivalent. Use visible ChatGPT settings or temporary chat controls when implemented.",
  service_tier: "No browser-control equivalent. Visible ChatGPT web does not expose API service tiers.",
  max_output_tokens: "Use response.maxChars/read maxChars for capture limits. This does not control model generation.",
  parallel_tool_calls: "No browser-control equivalent. Visible ChatGPT browser control selects visible tools sequentially.",
  truncation: "No browser-control equivalent. Use prompt design and response capture limits instead."
};
var responseFormats = /* @__PURE__ */ new Set([
  "markdown",
  "text",
  "normalized_text",
  "visible_text",
  "html",
  "blocks",
  "all"
]);
function validateResponsesCreateArgs(args) {
  const unsupported2 = [];
  for (const [path, alternative] of Object.entries(unsupportedAlternatives)) {
    if (args[path] !== void 0) {
      unsupported2.push(apiOnlyField(path, alternative));
    }
  }
  for (const path of Object.keys(args)) {
    if (!acceptedTopLevelFields.has(path) && unsupportedAlternatives[path] === void 0) {
      unsupported2.push({
        path,
        reason: "This field is not part of the narrow ChatGPT browser-control Responses adapter.",
        alternative: "Use chatgpt.runner.run(...) for lower-level browser-control options."
      });
    }
  }
  if (args.input === void 0) {
    unsupported2.push({
      path: "input",
      reason: "Responses adapter calls must include visible input text or input items.",
      alternative: 'Provide input: "your visible prompt".'
    });
  }
  if (args.stream !== void 0 && args.stream !== false) {
    unsupported2.push({
      path: "stream",
      reason: "This adapter stage supports only non-streaming calls.",
      alternative: "Set stream: false, or use the runner milestone stream when enabled."
    });
  }
  if (args.instructions !== void 0 && args.instructionsMode !== "visible_prefix") {
    unsupported2.push({
      path: "instructions",
      reason: "Responses API instructions are hidden context, but ChatGPT browser control can only submit visible text.",
      alternative: 'Set instructionsMode: "visible_prefix" to send instructions visibly.'
    });
  }
  if (args.instructionsMode !== void 0 && args.instructionsMode !== "visible_prefix") {
    unsupported2.push({
      path: "instructionsMode",
      reason: "Only explicit visible-prefix instructions are supported by this adapter.",
      alternative: 'Use instructionsMode: "visible_prefix" or omit instructionsMode.'
    });
  }
  if (isRecord3(args.text)) {
    const format = args.text.format;
    if (format !== void 0 && (typeof format !== "string" || !responseFormats.has(format))) {
      unsupported2.push({
        path: "text.format",
        reason: "The requested response text format is not supported by ChatGPT browser-control capture.",
        alternative: "Use markdown, visible_text, normalized_text, html, blocks, or all."
      });
    }
    for (const path of Object.keys(args.text)) {
      if (path !== "format") {
        unsupported2.push({
          path: `text.${path}`,
          reason: "Only text.format is supported by the narrow Responses adapter.",
          alternative: "Use chatgpt.runner.run(...) for lower-level browser-control options."
        });
      }
    }
  }
  return unsupported2.length === 0 ? { ok: true, unsupported: [] } : { ok: false, unsupported: unsupported2 };
}
function responsesCreateArgsToRunInput(args) {
  const runInput2 = {
    input: args.input,
    response: { format: args.text?.format ?? "markdown" }
  };
  if (args.thread !== void 0) runInput2.thread = args.thread;
  if (args.existingTab !== void 0) runInput2.existingTab = args.existingTab;
  if (args.preferExistingTab !== void 0) runInput2.preferExistingTab = args.preferExistingTab;
  if (args.attachments !== void 0) runInput2.attachments = args.attachments;
  if (args.mode !== void 0) runInput2.mode = args.mode;
  if (args.tools !== void 0) runInput2.tools = args.tools;
  if (args.report !== void 0) runInput2.report = args.report;
  return runInput2;
}
function responseFromRunResult(result, now = /* @__PURE__ */ new Date()) {
  const browserControl = {
    visibleUi: true,
    resultStatus: result.status
  };
  if (result.data?.thread !== void 0) browserControl.thread = result.data.thread;
  const reportPath = result.data?.reportPath ?? result.reportPath;
  if (reportPath !== void 0) browserControl.reportPath = reportPath;
  return {
    id: responseId(now),
    object: "chatgpt.browser.response",
    created_at: Math.floor(now.getTime() / 1e3),
    status: result.status,
    output_text: result.output_text,
    output: result.output,
    browser_control: browserControl
  };
}
function unsupportedResponse(unsupported2, now = /* @__PURE__ */ new Date()) {
  return {
    id: responseId(now),
    object: "chatgpt.browser.response",
    created_at: Math.floor(now.getTime() / 1e3),
    status: "unsupported",
    output_text: "",
    output: [],
    browser_control: {
      visibleUi: true,
      resultStatus: "unsupported",
      unsupported: unsupported2
    }
  };
}
function apiOnlyField(path, alternative) {
  return {
    path,
    reason: "This is an OpenAI API field that visible ChatGPT browser control cannot honestly support.",
    alternative
  };
}
function responseId(now) {
  return `chatgpt-browser-${now.getTime().toString(36)}`;
}
function isRecord3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// src/runner/stream.ts
function createMilestoneStream(run) {
  const queue = [];
  let resolveNext;
  let finished = false;
  const completed = run((event) => {
    queue.push(event);
    resolveNext?.();
    resolveNext = void 0;
  }).finally(() => {
    finished = true;
    resolveNext?.();
    resolveNext = void 0;
  });
  return {
    completed,
    async *[Symbol.asyncIterator]() {
      while (!finished || queue.length > 0) {
        const next = queue.shift();
        if (next !== void 0) {
          yield next;
          continue;
        }
        await new Promise((resolve4) => {
          resolveNext = resolve4;
        });
      }
    }
  };
}
function streamFromRunResult(run) {
  return createMilestoneStream(async (emit) => {
    const result = await run();
    for (const item of result.newItems) {
      emit(runItemStreamEvent(item));
    }
    return result;
  });
}
function runItemStreamEvent(item) {
  return {
    type: "run_item_stream_event",
    name: runItemEventName(item),
    item
  };
}
function runItemEventName(item) {
  switch (item.type) {
    case "thread.opened":
      return "thread_opened";
    case "mode.selected":
      return "mode_selected";
    case "tool.selected":
      return "tool_selected";
    case "file.attached":
      return "file_attached";
    case "message.submitted":
      return "message_submitted";
    case "message.completed":
      return "message_completed";
    case "file.downloaded":
      return "file_downloaded";
    case "approval.required":
    case "run.blocked":
      return "run_blocked";
  }
}

// src/client.ts
function createChatGPT(options = {}) {
  const env = runtimeEnv(options);
  const limits = normalizeLimits(options.limits);
  const runnerRun = ((agent, input, runnerOptions) => {
    const run = () => runAgentWorkflow(agent, input, env, limits, options.defaults, options.reporting);
    return runnerOptions?.stream === true ? streamFromRunResult(run) : run();
  });
  const runner = {
    run: runnerRun,
    plan: (agent, input) => planAgentWorkflow(agent, input, options.defaults)
  };
  return {
    agent: (config) => createChatGPTAgent(config),
    run: runner.run,
    runner,
    responses: {
      create: (args) => createResponse(args, runner, env.now)
    },
    ask: (args) => runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting)),
    askInThread: (args) => runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting)),
    askWithFiles: (args) => runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting)),
    askAndDownload: (args) => runGuarded(planAskWorkflow(args, options.defaults), env, limits, reportOptions(args.report, options.reporting)),
    runMessages: (args) => runGuarded(planRunMessages(args, options.defaults), env, limits, reportOptions(args.report, options.reporting)),
    openThread: (thread) => runSequence(planOpenThread(thread), env),
    readLatest: (args) => readLatest(env, args),
    copyLatest: (args) => copyResponse(env, args),
    downloadLatest: (args) => downloadLatestFile(env, args),
    runPlan: (plan) => runPlanInvocation(plan, env, limits, options.defaults, options.reporting),
    doctor: (args) => doctor(env, args),
    createReport: (result, args) => createRunReport(env, result, args ?? options.reporting ?? {}),
    reports: {
      create: (result, args) => createRunReport(env, result, args ?? options.reporting ?? {}),
      redact: async (value, args) => resultOk(redactReportValue(value, args), {}),
      summarize: async (result, args) => resultOk(redactReportValue(resultSummary(result), args), {})
    },
    plan: (name, args) => planByName(name, args, options.defaults),
    commands: (filter) => commandDescriptors().filter((descriptor) => filter?.layer === void 0 || descriptor.layer === filter.layer),
    describe: (name) => describeCommand(name),
    help: (topic) => helpText(topic),
    session: {
      bootstrap: (args) => bootstrap(env, args)
    },
    threads: {
      new: (args) => newThread(env, args),
      search: (args) => searchThreads(env, args),
      open: (args) => openThread(env, args)
    },
    messages: {
      compose: (args) => composeMessage(env, args),
      submit: (args) => submitMessage(env, args),
      ask: (args) => askMessage(env, args),
      wait: (args) => waitForMessage(env, args),
      readLatest: (args) => readLatest(env, args),
      waitAndRead: (args) => waitAndRead(env, args)
    },
    files: {
      attach: (args) => attachFiles(env, args),
      downloadLatest: (args) => downloadLatestFile(env, args)
    },
    artifacts: {
      listLatest: (args) => listLatestArtifacts(env, args),
      wait: (args) => waitForArtifact(env, args),
      downloadLatest: (args) => downloadLatestArtifact(env, args)
    },
    modes: {
      set: (args) => setMode(env, args)
    },
    tools: {
      select: (args) => selectTool(env, args)
    },
    response: {
      copy: (args) => copyResponse(env, args)
    }
  };
}
async function runGuarded(plan, env, limits, report2) {
  const budget = checkRunBudget(plan, limits);
  if (budget !== void 0) return budget;
  const result = await runSequence(plan, env);
  if (report2 === void 0 || report2.enabled === false) return result;
  const reportResult = await createRunReport(env, result, capReportOptions(report2, limits));
  if (reportResult.ok && reportResult.data !== void 0) {
    if (reportResult.data.bytes > limits.maxReportBytesPerRun) {
      const overBudget = {
        ok: false,
        status: "needs_confirmation",
        warnings: [`Run report exceeded byte budget after creation: ${reportResult.data.bytes}/${limits.maxReportBytesPerRun}.`],
        reportPath: reportResult.data.path,
        blocker: {
          kind: "confirmation",
          code: "report_byte_budget_exceeded",
          fieldPath: "limits.maxReportBytesPerRun",
          message: `Workflow "${plan.name}" created a report larger than the configured budget (${reportResult.data.bytes}/${limits.maxReportBytesPerRun} bytes). Ask the user before preserving or sharing it.`,
          remediation: [
            {
              label: "Confirm report retention",
              instruction: "Ask the user whether to keep this report, increase maxReportBytesPerRun, or rerun with a smaller report preview.",
              userActionRequired: true
            }
          ],
          resumable: true
        },
        context: result.context
      };
      if (result.steps !== void 0) overBudget.steps = result.steps;
      return overBudget;
    }
    return {
      ...result,
      reportPath: reportResult.data.path,
      warnings: [...result.warnings, ...reportResult.warnings]
    };
  }
  return {
    ...result,
    warnings: [
      ...result.warnings,
      `Run report creation failed: ${reportResult.error?.message ?? reportResult.blocker?.message ?? reportResult.status}`
    ]
  };
}
function normalizeLimits(limits) {
  return {
    maxPromptsPerRun: limits?.maxPromptsPerRun ?? 5,
    maxThreadsOpenedPerRun: limits?.maxThreadsOpenedPerRun ?? 3,
    maxMessagesReadPerRun: limits?.maxMessagesReadPerRun ?? 10,
    maxReportBytesPerRun: limits?.maxReportBytesPerRun ?? 2e6,
    maxReportPreviewChars: limits?.maxReportPreviewChars ?? 240
  };
}
function checkRunBudget(plan, limits) {
  const prompts = plan.steps.filter((step) => step.command === "messages.ask" || step.command === "messages.submit").length;
  const threads = plan.steps.filter((step) => step.command === "threads.new" || step.command === "threads.open").length;
  const reads = plan.steps.filter((step) => step.command === "messages.readLatest" || step.command === "messages.waitAndRead" || step.command === "response.copy").length + plan.steps.filter((step) => step.command === "messages.ask" && askStepReads(step.args)).length;
  const violations = [];
  if (prompts > limits.maxPromptsPerRun) violations.push(`prompts ${prompts}/${limits.maxPromptsPerRun}`);
  if (threads > limits.maxThreadsOpenedPerRun) violations.push(`threads ${threads}/${limits.maxThreadsOpenedPerRun}`);
  if (reads > limits.maxMessagesReadPerRun) violations.push(`reads ${reads}/${limits.maxMessagesReadPerRun}`);
  if (violations.length === 0) return void 0;
  return {
    ok: false,
    status: "needs_confirmation",
    warnings: [],
    blocker: {
      kind: "confirmation",
      code: "run_budget_exceeded",
      fieldPath: "limits",
      message: `Workflow "${plan.name}" exceeds ChatGPT browser-control run budget: ${violations.join(", ")}. Ask the user to confirm a bounded exception.`,
      remediation: [
        {
          label: "Confirm bounded run",
          instruction: "Ask the user to approve this specific over-budget run, or reduce the number of prompts, thread opens, or message reads.",
          userActionRequired: true
        }
      ],
      resumable: true
    },
    context: { timestamp: (/* @__PURE__ */ new Date()).toISOString() }
  };
}
function askStepReads(args) {
  return args.read === true || typeof args.read === "object";
}
function reportOptions(request, defaults) {
  if (request === false) return void 0;
  if (request === true) return { ...defaults ?? {}, enabled: true };
  if (request !== void 0) return { ...defaults ?? {}, ...request, enabled: request.enabled ?? true };
  return defaults?.enabled === true ? defaults : void 0;
}
function capReportOptions(report2, limits) {
  return {
    ...report2,
    maxPreviewChars: Math.min(report2.maxPreviewChars ?? limits.maxReportPreviewChars, limits.maxReportPreviewChars)
  };
}
async function createResponse(args, runner, now) {
  const validation = validateResponsesCreateArgs(args);
  const timestamp = now?.() ?? /* @__PURE__ */ new Date();
  if (!validation.ok) {
    return unsupportedResponse(validation.unsupported, timestamp);
  }
  const responseArgs = args;
  const agentConfig2 = {
    name: "responses-adapter",
    instructionsMode: responseArgs.instructionsMode === "visible_prefix" ? "visible_prefix" : "metadata_only"
  };
  if (typeof responseArgs.instructions === "string") {
    agentConfig2.instructions = responseArgs.instructions;
  }
  const agent = createChatGPTAgent(agentConfig2);
  const result = await runner.run(agent, responsesCreateArgsToRunInput(responseArgs));
  return responseFromRunResult(result, now?.() ?? timestamp);
}
async function runAgentWorkflow(agent, input, env, limits, defaults, reporting) {
  try {
    const normalized = normalizeRunnerInput(agent, input);
    const plan = planAgentWorkflowFromNormalized(agent, normalized, defaults);
    const report2 = reportOptions(normalized.report ?? agent.defaults.report, reporting);
    const result = await runGuarded(plan, env, limits, report2);
    return toRunResult(agent, result);
  } catch (error) {
    return toRunResult(agent, resultError(error instanceof Error ? error : new Error(String(error)), {}));
  }
}
function planAgentWorkflow(agent, input, defaults = {}) {
  return planAgentWorkflowFromNormalized(agent, normalizeRunnerInput(agent, input), defaults);
}
function planAgentWorkflowFromNormalized(agent, input, defaults = {}) {
  const wait = input.wait ?? agent.defaults.wait ?? defaults.wait ?? true;
  const read = input.read ?? agent.defaults.read ?? defaults.read ?? { format: "markdown" };
  const thread = input.thread ?? agent.defaults.thread ?? { type: "new" };
  const artifactDownload = input.download !== void 0 && input.download !== false && usesCreateImageTool(input.tools);
  const steps = [
    bootstrapStepForWorkflow(
      thread,
      input.existingTab ?? agent.defaults.existingTab ?? defaults.existingTab,
      input.preferExistingTab ?? agent.defaults.preferExistingTab ?? defaults.preferExistingTab
    ),
    ...threadSteps(thread)
  ];
  const mode = input.mode ?? agent.defaults.mode ?? defaults.mode;
  if (mode !== void 0) {
    steps.push({ id: "mode", command: "modes.set", args: mode });
  }
  for (const [index, tool] of input.tools.entries()) {
    steps.push({ id: `tool${index + 1}`, command: "tools.select", args: tool });
  }
  if (input.files.length > 0) {
    steps.push({ id: "attach", command: "files.attach", args: { paths: input.files } });
  }
  if (artifactDownload) {
    steps.push({ id: "artifactBaseline", command: "artifacts.listLatest", args: { kind: "image" } });
  }
  if (agent.instructionsMode === "visible_setup_message" && hasInstructions(agent)) {
    steps.push({
      id: "agent_setup",
      command: "messages.ask",
      args: {
        text: renderAgentSetupMessage(agent),
        wait,
        read: false
      }
    });
  }
  steps.push({
    id: "ask",
    command: "messages.ask",
    args: {
      text: renderRunnerPrompt(agent, input.prompt),
      wait: artifactDownload ? false : wait,
      read: artifactDownload ? false : read
    }
  });
  if (artifactDownload) {
    steps.push({
      id: "artifact",
      command: "artifacts.wait",
      args: artifactWaitArgs(wait, input.download === false ? void 0 : input.download)
    });
  }
  if (input.copy !== void 0 && input.copy !== false) {
    steps.push({ id: "copy", command: "response.copy", args: input.copy });
  }
  if (input.download !== void 0 && input.download !== false) {
    steps.push({ id: "download", command: artifactDownload ? "artifacts.downloadLatest" : "files.downloadLatest", args: input.download });
  }
  return {
    name: `agent-run:${agent.name}`,
    policy: { stopOnError: true, returnPartial: true },
    steps
  };
}
function normalizeRunnerInput(agent, input) {
  const args = typeof input === "string" ? { input } : input;
  const collected = collectRunnerInput(args.input);
  const attachments = normalizeRunnerAttachments(args.attachments);
  const mode = args.mode;
  const normalized = {
    prompt: collected.prompt,
    tools: args.tools ?? [],
    files: [...collected.files, ...attachments]
  };
  if (args.thread !== void 0) normalized.thread = args.thread;
  if (args.existingTab !== void 0) normalized.existingTab = args.existingTab;
  if (args.preferExistingTab !== void 0) normalized.preferExistingTab = args.preferExistingTab;
  if (mode !== void 0) normalized.mode = mode;
  if (args.response !== void 0) normalized.read = args.response;
  if (args.download !== void 0) normalized.download = args.download;
  if (args.copy !== void 0) normalized.copy = args.copy;
  if (args.report !== void 0) normalized.report = args.report;
  if (normalized.prompt.trim().length === 0) {
    throw new Error(`ChatGPT runner input for agent "${agent.name}" must include non-empty visible text.`);
  }
  return normalized;
}
function collectRunnerInput(input) {
  if (typeof input === "string") {
    return { prompt: input, files: [] };
  }
  const visibleInstructions = [];
  const userText = [];
  const files = [];
  for (const item of input) {
    switch (item.type) {
      case "input_text":
        userText.push(item.text);
        break;
      case "visible_instruction":
        visibleInstructions.push(item.text);
        break;
      case "input_file":
        files.push(item.path);
        if (item.description !== void 0 && item.description.trim().length > 0) {
          userText.push(`Attached file context: ${item.description.trim()}`);
        }
        break;
    }
  }
  const parts = [];
  if (visibleInstructions.length > 0) {
    parts.push(`<visible_instructions>
${visibleInstructions.join("\n")}
</visible_instructions>`);
  }
  if (userText.length > 0) {
    parts.push(userText.join("\n\n"));
  }
  return { prompt: parts.join("\n\n"), files };
}
function normalizeRunnerAttachments(attachments) {
  return (attachments ?? []).map((attachment) => attachment.path);
}
function renderRunnerPrompt(agent, prompt) {
  if (agent.instructionsMode !== "visible_prefix" || !hasInstructions(agent)) {
    return prompt;
  }
  return `${renderAgentInstructionBlock(agent)}

<user_request>
${prompt}
</user_request>`;
}
function renderAgentSetupMessage(agent) {
  return `${renderAgentInstructionBlock(agent)}

Acknowledge these visible setup instructions briefly, then wait for the next user request.`;
}
function renderAgentInstructionBlock(agent) {
  return [
    "<chatgpt_browser_agent>",
    `Agent name: ${agent.name}`,
    "Instructions:",
    agent.instructions ?? "",
    "</chatgpt_browser_agent>"
  ].join("\n");
}
function hasInstructions(agent) {
  return (agent.instructions ?? "").trim().length > 0;
}
async function runPlanInvocation(plan, env, limits, defaults, reporting) {
  try {
    if (!("steps" in plan) && plan.name === "doctor-upload") {
      const result = await doctor(env, { check: ["bridge", "login", "upload"] });
      return maybeAttachReport(env, result, reportOptions(plan.report, reporting), limits);
    }
    if (!("steps" in plan) && plan.name === "redacted-run-report") {
      const input = isRecord4(plan.input) ? plan.input : {};
      const result = input.result;
      if (!isCommandResult(result)) {
        throw new Error('Named workflow "redacted-run-report" requires input.result to be a CommandResult.');
      }
      return createRunReport(env, result, capReportOptions(reportOptions(plan.report, reporting) ?? {}, limits));
    }
    const resolved = "steps" in plan ? plan : resolvePlan(plan, defaults);
    return runGuarded(resolved, env, limits, reportOptions("report" in plan ? plan.report : void 0, reporting));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), {});
  }
}
async function maybeAttachReport(env, result, report2, limits) {
  if (report2 === void 0 || report2.enabled === false) return result;
  const reportResult = await createRunReport(env, result, capReportOptions(report2, limits));
  if (!reportResult.ok || reportResult.data === void 0) return result;
  return { ...result, reportPath: reportResult.data.path };
}
function runtimeEnv(options) {
  const env = {};
  if (options.agent !== void 0) env.agent = options.agent;
  if (options.browser !== void 0) env.browser = options.browser;
  if (options.page !== void 0) env.page = options.page;
  if (options.clipboard !== void 0) env.clipboard = options.clipboard;
  if (options.now !== void 0) env.now = options.now;
  return env;
}
function planAskWorkflow(args, defaults = {}) {
  const thread = args.thread ?? { type: "new" };
  const steps = [
    bootstrapStepForWorkflow(
      thread,
      args.existingTab ?? defaults.existingTab,
      args.preferExistingTab ?? defaults.preferExistingTab
    ),
    ...threadSteps(thread)
  ];
  const mode = args.mode ?? defaults.mode;
  if (mode !== void 0) {
    steps.push({ id: "mode", command: "modes.set", args: mode });
  }
  for (const [index, tool] of (args.tools ?? []).entries()) {
    steps.push({ id: `tool${index + 1}`, command: "tools.select", args: tool });
  }
  const files = normalizeFileInputs([...args.files ?? [], ...args.attachments ?? []]);
  if (files.length > 0) {
    steps.push({ id: "attach", command: "files.attach", args: { paths: files } });
  }
  const artifactDownload = args.download !== void 0 && usesCreateImageTool(args.tools ?? []);
  if (artifactDownload) {
    steps.push({ id: "artifactBaseline", command: "artifacts.listLatest", args: { kind: "image" } });
  }
  steps.push({
    id: "ask",
    command: "messages.ask",
    args: {
      text: args.prompt,
      wait: artifactDownload ? false : args.wait ?? defaults.wait ?? true,
      read: artifactDownload ? false : args.read ?? defaults.read ?? { format: "markdown" }
    }
  });
  if (args.download !== void 0) {
    if (artifactDownload) {
      steps.push({
        id: "artifact",
        command: "artifacts.wait",
        args: artifactWaitArgs(args.wait ?? defaults.wait ?? true, args.download)
      });
    }
    steps.push({ id: "download", command: artifactDownload ? "artifacts.downloadLatest" : "files.downloadLatest", args: args.download });
  }
  return {
    name: args.download === void 0 ? "ask" : "ask-and-download",
    policy: { stopOnError: true, returnPartial: true },
    steps
  };
}
function usesCreateImageTool(tools) {
  return tools.some((tool) => normalizeToolName(tool.tool) === "create_image");
}
function normalizeToolName(tool) {
  return tool.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
function artifactWaitArgs(wait, download) {
  const args = {
    kind: "image",
    afterArtifactCount: "${artifactBaseline.data.count}",
    requireDownload: true
  };
  if (typeof wait === "object") {
    if (wait.timeoutMs !== void 0) args.timeoutMs = wait.timeoutMs;
    if (wait.stableMs !== void 0) args.stableMs = wait.stableMs;
    if (wait.pollMs !== void 0) args.pollMs = wait.pollMs;
  }
  if (args.timeoutMs === void 0 && download?.timeoutMs !== void 0) {
    args.timeoutMs = download.timeoutMs;
  }
  return args;
}
function planRunMessages(args, defaults = {}) {
  const thread = args.thread ?? { type: "new" };
  const steps = [
    bootstrapStepForWorkflow(
      thread,
      args.existingTab ?? defaults.existingTab,
      args.preferExistingTab ?? defaults.preferExistingTab
    ),
    ...threadSteps(thread)
  ];
  const mode = args.mode ?? defaults.mode;
  if (mode !== void 0) {
    steps.push({ id: "mode", command: "modes.set", args: mode });
  }
  args.messages.forEach((message, index) => {
    steps.push({
      id: message.id ?? `message${index + 1}`,
      command: "messages.ask",
      args: {
        text: message.prompt,
        wait: message.wait ?? defaults.wait ?? true,
        read: message.read ?? defaults.read ?? { format: "markdown" }
      }
    });
  });
  return { name: "run-messages", policy: { stopOnError: true, returnPartial: true }, steps };
}
function planOpenThread(thread) {
  return {
    name: "open-thread",
    policy: { stopOnError: true, returnPartial: true },
    steps: [
      { id: "bootstrap", command: "session.bootstrap" },
      ...threadSteps(thread)
    ]
  };
}
function planByName(name, args, defaults = {}) {
  const input = isRecord4(args) ? args : {};
  switch (name) {
    case "new-ask-read":
      return planAskWorkflow({ prompt: stringInput(input, "prompt"), thread: { type: "new" } }, defaults);
    case "find-open-copy-latest":
      return {
        name,
        steps: [
          { id: "bootstrap", command: "session.bootstrap" },
          { id: "find", command: "threads.search", args: { query: stringInput(input, "query"), limit: 5 } },
          { id: "open", command: "threads.open", args: { fromStep: "find", select: "first" } },
          { id: "copy", command: "response.copy", args: { which: "latest" } }
        ]
      };
    case "find-open-ask-read":
      return planAskWorkflow({
        prompt: stringInput(input, "prompt"),
        thread: { type: "search", query: stringInput(input, "query"), select: "first" }
      }, defaults);
    case "attach-ask-read":
      return planAskWorkflow({
        prompt: stringInput(input, "prompt"),
        thread: { type: "new" },
        files: arrayInput(input, "files").map(String)
      }, defaults);
    case "ask-and-download":
      return planAskWorkflow({
        prompt: stringInput(input, "prompt"),
        thread: { type: "new" },
        download: { destDir: stringInput(input, "destDir") }
      }, defaults);
    case "two-turn":
      return planRunMessages({
        thread: { type: "new" },
        messages: [
          { id: "first", prompt: stringInput(input, "first") },
          { id: "second", prompt: stringInput(input, "second") }
        ]
      }, defaults);
    default:
      return void 0;
  }
}
function resolvePlan(plan, defaults = {}) {
  if ("steps" in plan) return plan;
  const resolved = planByName(plan.name, plan.input, defaults);
  if (resolved === void 0) {
    throw new Error(`Unknown ChatGPT workflow plan: ${plan.name}`);
  }
  return resolved;
}
function resultSummary(result) {
  return {
    ok: result.ok,
    status: result.status,
    warnings: result.warnings,
    blocker: result.blocker,
    error: result.error,
    context: result.context,
    reportPath: result.reportPath
  };
}
function isCommandResult(value) {
  return isRecord4(value) && typeof value.ok === "boolean" && typeof value.status === "string" && Array.isArray(value.warnings) && isRecord4(value.context) && typeof value.context.timestamp === "string";
}
function bootstrapStepForWorkflow(thread, existingTab, preferExistingTab) {
  const args = bootstrapArgsForWorkflow(thread, existingTab, preferExistingTab);
  if (args === void 0) {
    return { id: "bootstrap", command: "session.bootstrap" };
  }
  return { id: "bootstrap", command: "session.bootstrap", args };
}
function bootstrapArgsForWorkflow(thread, existingTab, preferExistingTab) {
  const args = {};
  if (existingTab !== void 0) {
    args.existingTab = existingTab === true ? existingTabPolicyFromThread(thread) : existingTab;
  }
  if (preferExistingTab !== void 0) {
    args.preferExistingTab = preferExistingTab;
  }
  return Object.keys(args).length === 0 ? void 0 : args;
}
function existingTabPolicyFromThread(thread) {
  const target = existingTabTargetFromThread(thread);
  if (target === void 0) {
    return {
      target: { type: "selected", host: "chatgpt" },
      ifMissing: "block",
      ifMultiple: "first",
      requireChatGPT: true
    };
  }
  return {
    target,
    ifMissing: "block",
    ifMultiple: target.type === "selected" ? "first" : "block",
    requireChatGPT: true
  };
}
function existingTabTargetFromThread(thread) {
  if (isTypedThread(thread)) {
    switch (thread.type) {
      case "new":
      case "search":
        return void 0;
      case "current":
        return { type: "selected", host: "chatgpt" };
      case "url":
        return { type: "url", url: thread.url };
      case "conversationId":
      case "conversation_id":
        return { type: "conversationId", conversationId: thread.conversationId };
      case "title":
        return { type: "title", title: thread.title, exact: false };
    }
  }
  if (thread.url !== void 0) return { type: "url", url: thread.url };
  if (thread.conversationId !== void 0) return { type: "conversationId", conversationId: thread.conversationId };
  if (thread.title !== void 0) return { type: "title", title: thread.title, exact: false };
  return void 0;
}
function threadSteps(thread) {
  if (isTypedThread(thread)) {
    switch (thread.type) {
      case "new":
        return [{ id: "new", command: "threads.new" }];
      case "current":
        return [];
      case "url":
        return [{ id: "open", command: "threads.open", args: { url: thread.url } }];
      case "conversationId":
        return [{ id: "open", command: "threads.open", args: { conversationId: thread.conversationId } }];
      case "conversation_id":
        return [{ id: "open", command: "threads.open", args: { conversationId: thread.conversationId } }];
      case "search":
        return [
          { id: "find", command: "threads.search", args: { query: thread.query, limit: thread.limit ?? 5 } },
          { id: "open", command: "threads.open", args: { fromStep: "find", select: thread.select ?? "first" } }
        ];
      case "title":
        return [{ id: "open", command: "threads.open", args: { title: thread.title } }];
    }
  }
  if (thread.url !== void 0) return [{ id: "open", command: "threads.open", args: { url: thread.url } }];
  if (thread.conversationId !== void 0) return [{ id: "open", command: "threads.open", args: { conversationId: thread.conversationId } }];
  const query = thread.query ?? thread.title;
  if (query === void 0) return [];
  return [
    { id: "find", command: "threads.search", args: { query, limit: 5 } },
    { id: "open", command: "threads.open", args: { fromStep: "find", select: thread.title === void 0 ? "first" : { title: thread.title } } }
  ];
}
function isTypedThread(thread) {
  return "type" in thread;
}
function normalizeFileInputs(files) {
  return files.map((file) => typeof file === "string" ? file : file.path);
}
function isRecord4(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function stringInput(input, key) {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Named workflow input "${key}" must be a non-empty string.`);
  }
  return value;
}
function arrayInput(input, key) {
  const value = input[key];
  if (!Array.isArray(value)) {
    throw new Error(`Named workflow input "${key}" must be an array.`);
  }
  return value;
}

// src/backend/protocol.ts
var BACKEND_REQUEST_SCHEMA_VERSION = "chatgpt.browser_control.backend_request.v1";
var BACKEND_RESPONSE_SCHEMA_VERSION = "chatgpt.browser_control.backend_response.v1";
var BACKEND_EVENT_SCHEMA_VERSION = "chatgpt.browser_control.backend_event.v1";
var backendCommands = [
  "backend.version",
  "backend.health",
  "backend.capabilities",
  "runner.run",
  "runner.plan",
  "runner.stream",
  "responses.create",
  "ask",
  "askInThread",
  "askWithFiles",
  "askAndDownload",
  "runMessages",
  "openThread",
  "readLatest",
  "copyLatest",
  "downloadLatest",
  "runPlan",
  "doctor",
  "createReport",
  "reports.create",
  "reports.redact",
  "reports.summarize",
  "commands",
  "describe",
  "help",
  "session.bootstrap",
  "threads.new",
  "threads.search",
  "threads.open",
  "messages.compose",
  "messages.submit",
  "messages.ask",
  "messages.wait",
  "messages.readLatest",
  "messages.waitAndRead",
  "artifacts.listLatest",
  "artifacts.wait",
  "artifacts.downloadLatest",
  "files.attach",
  "files.downloadLatest",
  "modes.set",
  "tools.select",
  "response.copy"
];
var ProtocolError = class extends Error {
  constructor(code, message, recoverable) {
    super(message);
    this.code = code;
    this.recoverable = recoverable;
    this.name = "ProtocolError";
  }
  code;
  recoverable;
};
var commandSet = new Set(backendCommands);
function parseBackendRequest(raw) {
  if (!isRecord5(raw)) {
    throw new ProtocolError("invalid_request", "Backend request must be an object.", false);
  }
  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== BACKEND_REQUEST_SCHEMA_VERSION) {
    throw new ProtocolError(
      "unsupported_schema_version",
      `Unsupported backend request schemaVersion: ${String(schemaVersion)}`,
      false
    );
  }
  const command = raw.command;
  if (typeof command !== "string" || !commandSet.has(command)) {
    throw new ProtocolError("unknown_command", `Unknown backend command: ${String(command)}`, false);
  }
  const request = {
    schemaVersion: BACKEND_REQUEST_SCHEMA_VERSION,
    command,
    payload: normalizePayload(raw.payload)
  };
  if (raw.requestId !== void 0) {
    if (typeof raw.requestId !== "string" || raw.requestId.length === 0) {
      throw new ProtocolError("invalid_request", "Backend request requestId must be a non-empty string when provided.", false);
    }
    request.requestId = raw.requestId;
  }
  return request;
}
function backendResponseOk(requestId, result) {
  const response = {
    schemaVersion: BACKEND_RESPONSE_SCHEMA_VERSION,
    ok: true,
    result
  };
  if (requestId !== void 0) response.requestId = requestId;
  return response;
}
function backendResponseError(requestId, error) {
  const response = {
    schemaVersion: BACKEND_RESPONSE_SCHEMA_VERSION,
    ok: false,
    error: {
      code: error instanceof ProtocolError ? error.code : "invalid_request",
      message: error.message,
      recoverable: error instanceof ProtocolError ? error.recoverable : false
    }
  };
  if (requestId !== void 0) response.requestId = requestId;
  return response;
}
function backendEvent(requestId, payload) {
  const event = {
    schemaVersion: BACKEND_EVENT_SCHEMA_VERSION,
    ...payload
  };
  if (requestId !== void 0) event.requestId = requestId;
  return event;
}
function backendEventCompleted(requestId, result) {
  return backendEvent(requestId, { type: "completed", result });
}
function normalizePayload(value) {
  if (value === void 0) return {};
  if (!isRecord5(value)) {
    throw new ProtocolError("invalid_request", "Backend request payload must be an object when provided.", false);
  }
  return value;
}
function isRecord5(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// src/backend/session.ts
var BackendSession = class {
  constructor(options = {}) {
    this.options = options;
  }
  options;
  clientInstance;
  async dispatch(request) {
    try {
      const result = await dispatchBackendCommand(this.client(), request);
      return backendResponseOk(request.requestId, result);
    } catch (error) {
      return backendResponseError(request.requestId, error instanceof Error ? error : new Error(String(error)));
    }
  }
  async *stream(request) {
    try {
      if (request.command !== "runner.stream") {
        const response = await this.dispatch(request);
        if (response.ok) {
          yield backendEventCompleted(request.requestId, response.result);
        } else {
          yield backendEvent(request.requestId, { type: "error", error: response.error });
        }
        return;
      }
      const payload = request.payload;
      const agent = this.client().agent(agentConfig(payload));
      const stream = this.client().runner.run(agent, runInput(payload), { stream: true });
      for await (const event of stream) {
        yield backendEvent(request.requestId, {
          type: "run_item_stream_event",
          name: event.name,
          item: event.item
        });
      }
      yield backendEventCompleted(request.requestId, await stream.completed);
    } catch (error) {
      const protocolError = error instanceof ProtocolError ? error : new ProtocolError("invalid_request", error instanceof Error ? error.message : String(error), false);
      yield backendEvent(request.requestId, {
        type: "error",
        error: {
          code: protocolError.code,
          message: protocolError.message,
          recoverable: protocolError.recoverable
        }
      });
    }
  }
  client() {
    this.clientInstance ??= createChatGPT(this.options);
    return this.clientInstance;
  }
};
async function dispatchBackendCommand(client, request) {
  const payload = request.payload;
  switch (request.command) {
    case "backend.version":
      return {
        name: "codex-chatgpt-control-backend",
        runtime: "node",
        protocolVersion: BACKEND_REQUEST_SCHEMA_VERSION
      };
    case "backend.health":
      return {
        ok: true,
        status: "ok",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
    case "backend.capabilities":
      return backendCapabilities();
    case "runner.run": {
      const agent = client.agent(agentConfig(payload));
      return client.runner.run(agent, runInput(payload));
    }
    case "runner.plan": {
      const agent = client.agent(agentConfig(payload));
      return client.runner.plan(agent, runInput(payload));
    }
    case "responses.create":
      return client.responses.create(payload);
    case "commands":
      return client.commands(commandFilter(payload));
    case "describe":
      return client.describe(requiredString(payload, "name"));
    case "help":
      return client.help(optionalString(payload, "topic"));
    case "doctor":
      return client.doctor(payload);
    case "ask":
      return client.ask(payload);
    case "askInThread":
      return client.askInThread(payload);
    case "askWithFiles":
      return client.askWithFiles(payload);
    case "askAndDownload":
      return client.askAndDownload(payload);
    case "runMessages":
      return client.runMessages(payload);
    case "openThread":
      return client.openThread(payload);
    case "readLatest":
      return client.readLatest(emptyToUndefined(payload));
    case "copyLatest":
      return client.copyLatest(emptyToUndefined(payload));
    case "downloadLatest":
      return client.downloadLatest(payload);
    case "runPlan":
      return client.runPlan(runPlanPayload(payload));
    case "createReport":
      return client.createReport(
        requiredRecord(payload, "result"),
        optionalRecord(payload, "args")
      );
    case "reports.create":
      return client.reports.create(
        requiredRecord(payload, "result"),
        optionalRecord(payload, "args")
      );
    case "reports.redact":
      return client.reports.redact(
        payload.value,
        optionalRecord(payload, "args")
      );
    case "reports.summarize":
      return client.reports.summarize(
        requiredRecord(payload, "result"),
        optionalRecord(payload, "args")
      );
    case "session.bootstrap":
      return client.session.bootstrap(emptyToUndefined(payload));
    case "threads.new":
      return client.threads.new(emptyToUndefined(payload));
    case "threads.search":
      return client.threads.search(payload);
    case "threads.open":
      return client.threads.open(payload);
    case "messages.compose":
      return client.messages.compose(payload);
    case "messages.submit":
      return client.messages.submit(emptyToUndefined(payload));
    case "messages.ask":
      return client.messages.ask(payload);
    case "messages.wait":
      return client.messages.wait(emptyToUndefined(payload));
    case "messages.readLatest":
      return client.messages.readLatest(emptyToUndefined(payload));
    case "messages.waitAndRead":
      return client.messages.waitAndRead(payload);
    case "artifacts.listLatest":
      return client.artifacts.listLatest(emptyToUndefined(payload));
    case "artifacts.wait":
      return client.artifacts.wait(emptyToUndefined(payload));
    case "artifacts.downloadLatest":
      return client.artifacts.downloadLatest(payload);
    case "files.attach":
      return client.files.attach(payload);
    case "files.downloadLatest":
      return client.files.downloadLatest(payload);
    case "modes.set":
      return client.modes.set(payload);
    case "tools.select":
      return client.tools.select(payload);
    case "response.copy":
      return client.response.copy(emptyToUndefined(payload));
  }
}
function backendCapabilities() {
  return {
    protocolVersion: BACKEND_REQUEST_SCHEMA_VERSION,
    commands: [...backendCommands],
    transports: ["stdio"],
    streaming: {
      modes: ["ndjson"],
      tokenDeltas: false
    }
  };
}
function agentConfig(payload) {
  return requiredRecord(payload, "agent");
}
function runInput(payload) {
  if (!Object.hasOwn(payload, "input")) {
    throw new ProtocolError("invalid_request", "Backend runner command requires payload.input.", false);
  }
  return payload.input;
}
function runPlanPayload(payload) {
  if (isRecord6(payload.plan)) return payload.plan;
  return payload;
}
function commandFilter(payload) {
  if (isRecord6(payload.filter)) return payload.filter;
  return Object.keys(payload).length === 0 ? void 0 : payload;
}
function requiredString(payload, key) {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError("invalid_request", `Backend command requires payload.${key} as a non-empty string.`, false);
  }
  return value;
}
function optionalString(payload, key) {
  const value = payload[key];
  if (value === void 0) return void 0;
  if (typeof value !== "string") {
    throw new ProtocolError("invalid_request", `Backend command payload.${key} must be a string when provided.`, false);
  }
  return value;
}
function requiredRecord(payload, key) {
  const value = payload[key];
  if (!isRecord6(value)) {
    throw new ProtocolError("invalid_request", `Backend command requires payload.${key} as an object.`, false);
  }
  return value;
}
function optionalRecord(payload, key) {
  const value = payload[key];
  if (value === void 0) return void 0;
  if (!isRecord6(value)) {
    throw new ProtocolError("invalid_request", `Backend command payload.${key} must be an object when provided.`, false);
  }
  return value;
}
function emptyToUndefined(payload) {
  return Object.keys(payload).length === 0 ? void 0 : payload;
}
function isRecord6(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// src/backend/stdio-server.ts
async function runBackendStdioServer(options) {
  const session = options.session ?? new BackendSession();
  const lines = createInterface({
    input: options.input,
    crlfDelay: Infinity
  });
  const writeJson = createJsonLineWriter(options.output);
  const tasks = /* @__PURE__ */ new Set();
  for await (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const task = handleLine(session, trimmed, writeJson, options.error);
    tasks.add(task);
    void task.finally(() => {
      tasks.delete(task);
    }).catch(() => {
    });
  }
  await Promise.allSettled(tasks);
}
async function handleLine(session, line, writeJson, error) {
  let request;
  try {
    const raw = JSON.parse(line);
    request = parseBackendRequest(raw);
    if (request.command === "runner.stream") {
      for await (const event of session.stream(request)) {
        await writeJson(event);
      }
      return;
    }
    await writeJson(await session.dispatch(request));
  } catch (caught) {
    const response = backendResponseError(request?.requestId ?? requestIdFromLine(line), normalizeError(caught));
    await writeJson(response);
    if (!(caught instanceof ProtocolError)) {
      await writeDiagnostic(error, caught);
    }
  }
}
function normalizeError(error) {
  if (error instanceof SyntaxError) {
    return new ProtocolError("invalid_request", `Invalid JSON backend request line: ${error.message}`, false);
  }
  if (error instanceof Error) return error;
  return new ProtocolError("invalid_request", String(error), false);
}
function requestIdFromLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (isRecord7(parsed) && typeof parsed.requestId === "string" && parsed.requestId.length > 0) {
      return parsed.requestId;
    }
  } catch {
    return void 0;
  }
  return void 0;
}
function createJsonLineWriter(output) {
  let tail = Promise.resolve();
  return (value) => {
    const next = tail.then(() => writeLine(output, JSON.stringify(value)));
    tail = next.catch(() => {
    });
    return next;
  };
}
async function writeDiagnostic(error, value) {
  if (error === void 0) return;
  const message = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  await writeLine(error, message);
}
async function writeLine(output, line) {
  if (output.write(`${line}
`)) return;
  await new Promise((resolve4) => {
    output.once("drain", resolve4);
  });
}
function isRecord7(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// src/scripts/backend-server.ts
await runBackendStdioServer({
  input: process.stdin,
  output: process.stdout,
  error: process.stderr
});
