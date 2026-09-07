import { describe, expect, it, vi } from "vitest";
import { chatGPTAttachmentContextUrl } from "../../src/browser/chatgpt-url.js";
import { readPageState } from "../../src/browser/page-state.js";
import { createChatGPT } from "../../src/client.js";
import { contextFromPage } from "../../src/commands/context.js";
import { ensurePage } from "../../src/commands/session.js";
import type { LocatorLike, PageLike } from "../../src/types.js";

const safeUrl = "https://chatgpt.com/backend-api/estuary/content";
const signedUrl = `${safeUrl}?id=private-file&sig=synthetic-signature-secret&password=synthetic-password#private-fragment`;

function attachmentPage(): PageLike & { title: ReturnType<typeof vi.fn>; content: ReturnType<typeof vi.fn> } {
  return {
    id: "attachment-tab",
    url: () => signedUrl,
    title: vi.fn(async () => signedUrl),
    content: vi.fn(async () => signedUrl)
  };
}

function expectNoAttachmentSecrets(result: unknown) {
  const serialized = JSON.stringify(result);
  for (const secret of [signedUrl, "synthetic-signature-secret", "synthetic-password", "private-file", "private-fragment"]) {
    expect(serialized).not.toContain(secret);
  }
}

describe("signed ChatGPT attachment URL privacy", () => {
  it.each(["chatgpt.com", "www.chatgpt.com", "chat.openai.com"])("sanitizes only the known endpoint on %s", host => {
    expect(chatGPTAttachmentContextUrl(signedUrl.replace("chatgpt.com", host)))
      .toBe(`https://${host}/backend-api/estuary/content`);
  });

  it("preserves the internal attachment URL without probing non-chat content", async () => {
    const page = attachmentPage();
    expect(await readPageState(page)).toEqual({ url: signedUrl, visibleText: "", signedIn: false });
    expect(page.title).not.toHaveBeenCalled();
    expect(page.content).not.toHaveBeenCalled();
  });

  it.each([false, true])("sanitizes caller-supplied attachment context even when minimal is %s", async minimal => {
    const page = attachmentPage();
    const context = await contextFromPage(minimal ? page : undefined, { url: signedUrl, tabId: "attachment-tab" }, { minimal });
    expect(context).toEqual({ url: safeUrl, tabId: "attachment-tab", timestamp: expect.any(String) });
    expectNoAttachmentSecrets(context);
    expect(page.title).not.toHaveBeenCalled();
    expect(page.content).not.toHaveBeenCalled();
  });

  it("does not echo an accepted-origin attachment URL from ensurePage", async () => {
    const page = attachmentPage();
    const result = await ensurePage({ page, expectedTabId: "attachment-tab" });
    expect(result).toMatchObject({ ok: true, context: { url: safeUrl, tabId: "attachment-tab" } });
    expectNoAttachmentSecrets(result);
    expect(page.title).not.toHaveBeenCalled();
    expect(page.content).not.toHaveBeenCalled();
  });

  it("sanitizes both public bootstrap URL fields without reading the attachment page", async () => {
    const page = attachmentPage();
    const result = await createChatGPT({ page, browser: { name: "chrome" } }).session.bootstrap();
    expect(result).toMatchObject({ ok: true, data: { url: safeUrl }, context: { url: safeUrl } });
    expectNoAttachmentSecrets(result);
    expect(page.title).not.toHaveBeenCalled();
    expect(page.content).not.toHaveBeenCalled();
  });

  it("keeps the actual attachment route private in a public browser-blocked download result", async () => {
    const page = attachmentPage();
    const click = vi.fn(async () => {});
    const waitForEvent = vi.fn(async () => ({}));
    const locator: LocatorLike = { count: async () => 1, click, last: () => locator };
    page.locator = () => locator;
    page.waitForEvent = waitForEvent;
    page.evaluate = async fn => (fn.name === "inspectBrowserDownloadError" ? "blocked_by_client" : []) as never;
    const result = await createChatGPT({ page }).files.downloadLatest({ destDir: "/unused-download-directory", timeoutMs: 1000 });
    expect(result).toMatchObject({ ok: false, status: "blocked", blocker: { code: "download_blocked_by_browser", resumable: false } });
    expectNoAttachmentSecrets(result);
    expect(page.title).not.toHaveBeenCalled();
    expect(page.content).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(waitForEvent).not.toHaveBeenCalled();
  });

  it.each([
    "https://chatgpt.com/c/synthetic-conversation?model=example#message",
    "https://chatgpt.com/?model=example",
    "https://chatgpt.com/backend-api/other-route?example=value"
  ])("preserves unrelated URL context: %s", async url => {
    expect(chatGPTAttachmentContextUrl(url)).toBeUndefined();
    const page: PageLike = { url: () => url, title: async () => "ChatGPT", content: async () => "<main></main>" };
    expect((await contextFromPage(page)).url).toBe(url);
  });
});
