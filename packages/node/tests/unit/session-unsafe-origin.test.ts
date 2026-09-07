import { describe, expect, it, vi } from "vitest";
import { ensurePage } from "../../src/commands/session.js";
import type { PageLike } from "../../src/types.js";

describe("unsafe-origin result privacy", () => {
  it.each([
    "https://estuary.openai.com/attachment/private-object?sig=synthetic-signature-secret#private-fragment",
    "https://synthetic-user:synthetic-password@chatgpt.com/c/private-conversation?sig=synthetic-signature-secret#private-fragment",
    "https://chatgpt.com:9443/c/private-conversation?sig=synthetic-signature-secret#private-fragment",
    "http://chatgpt.com/c/private-conversation?sig=synthetic-signature-secret#private-fragment",
    "https://chatgpt.com.attacker.invalid/private-object?sig=synthetic-signature-secret#private-fragment"
  ])("blocks rejected navigation without exposing its URL: %s", async rejectedUrl => {
    // A second URL read would hang, as can happen after native error navigation.
    const url = vi.fn<() => string | Promise<string>>()
      .mockImplementationOnce(() => rejectedUrl)
      .mockImplementation(() => new Promise<string>(() => {}));
    const title = vi.fn(async () => "private-title");
    const content = vi.fn(async () => "private-page-content");
    const page: PageLike = { id: "owned-tab", url, title, content };
    const result = await ensurePage({ page, expectedTabId: "owned-tab" });

    expect(result).toMatchObject({ ok: false, status: "blocked", blocker: { code: "unsafe_chatgpt_origin", kind: "selector_drift", resumable: false } });
    expect(result.context).toEqual({ tabId: "owned-tab", timestamp: expect.any(String) });
    const serialized = JSON.stringify(result);
    for (const secret of [rejectedUrl, "synthetic-signature-secret", "synthetic-user", "synthetic-password", "private-fragment", "private-object", "private-conversation", "private-title", "private-page-content"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(url).toHaveBeenCalledOnce();
    expect(title).not.toHaveBeenCalled();
    expect(content).not.toHaveBeenCalled();
  });

  it.each(["synchronous", "asynchronous"])("does not include a %s provider error or reread an unavailable URL", async errorType => {
    const error = new Error("https://synthetic-user:synthetic-password@estuary.openai.com/private-object?sig=synthetic-signature-secret#private-fragment");
    const url = vi.fn<() => string | Promise<string>>(() => {
      if (errorType === "synchronous") throw error;
      return Promise.reject(error);
    });
    const title = vi.fn(async () => "private title");
    const result = await ensurePage({ page: { url, title } });
    expect(result.blocker).toMatchObject({ code: "unsafe_chatgpt_origin", visibleText: "The current tab URL could not be verified." });
    for (const secret of ["synthetic-user", "synthetic-password", "synthetic-signature-secret", "private-object", "private-fragment"]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(result.context).toEqual({ timestamp: expect.any(String) });
    expect(url).toHaveBeenCalledOnce();
    expect(title).not.toHaveBeenCalled();
  });

  it.each(["https://chatgpt.com/c/synthetic-conversation", "https://www.chatgpt.com/c/synthetic-conversation", "https://chat.openai.com/c/synthetic-conversation"])("preserves accepted conversation URLs: %s", async url => {
    const page: PageLike = { id: "owned-tab", url: () => url, title: async () => "ChatGPT", content: async () => "<main></main>" };
    const result = await ensurePage({ page, expectedTabId: "owned-tab" });
    expect(result.ok).toBe(true);
    expect(result.blocker).toBeUndefined();
    expect(result.context).toMatchObject({ url, conversationId: "synthetic-conversation", tabId: "owned-tab", title: "ChatGPT" });
  });
});
