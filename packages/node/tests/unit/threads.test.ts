import { describe, expect, it } from "vitest";
import { openThread } from "../../src/commands/threads.js";
import type { PageLike } from "../../src/types.js";

describe("thread commands", () => {
  it("does not reload when already on the target conversation", async () => {
    const targetUrl = "https://chatgpt.com/c/abc-123";
    const gotoCalls: string[] = [];
    const page: PageLike = {
      url: () => targetUrl,
      goto: async url => {
        gotoCalls.push(url);
      },
      title: async () => "Existing thread",
      content: async () => [
        "<main>",
        "<div data-message-author-role=\"user\">hello</div>",
        "<div data-message-author-role=\"assistant\">hi</div>",
        "</main>"
      ].join(""),
      waitForTimeout: async () => {}
    };

    const result = await openThread({ page }, { conversationId: "abc-123", timeoutMs: 10 });

    expect(result.ok).toBe(true);
    expect(result.data?.conversationId).toBe("abc-123");
    expect(gotoCalls).toEqual([]);
  });

  it("navigates when the current tab is on a different conversation", async () => {
    const gotoCalls: string[] = [];
    let currentUrl = "https://chatgpt.com/c/other";
    const page: PageLike = {
      url: () => currentUrl,
      goto: async url => {
        gotoCalls.push(url);
        currentUrl = url;
      },
      title: async () => "Target thread",
      content: async () => [
        "<main>",
        "<div data-message-author-role=\"assistant\">target answer</div>",
        "</main>"
      ].join(""),
      waitForTimeout: async () => {}
    };

    const result = await openThread({ page }, { conversationId: "abc-123", timeoutMs: 10 });

    expect(result.ok).toBe(true);
    expect(result.data?.conversationId).toBe("abc-123");
    expect(gotoCalls).toEqual(["https://chatgpt.com/c/abc-123"]);
  });
});
