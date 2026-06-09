import { describe, expect, it } from "vitest";
import { bootstrap } from "../../src/commands/session.js";
import type { BrowserLike, PageLike } from "../../src/types.js";

describe("existing Chrome tab bootstrap", () => {
  it("claims the most recent open user ChatGPT tab for selected existing-tab mode", async () => {
    const claimed: unknown[] = [];
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "user-tab-1", url: "https://chatgpt.com/c/abc-123", title: "SDK Review" }
        ],
        claimTab: async tab => {
          claimed.push(tab);
          return fakeChatGPTPage("user-tab-1", "https://chatgpt.com/c/abc-123", "SDK Review");
        }
      }
    };

    const result = await bootstrap({ browser }, {
      existingTab: {
        target: { type: "selected", host: "chatgpt" },
        ifMissing: "block"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.context.tabId).toBe("user-tab-1");
    expect(result.context.conversationId).toBe("abc-123");
    expect(claimed).toEqual([
      { id: "user-tab-1", url: "https://chatgpt.com/c/abc-123", title: "SDK Review" }
    ]);
  });

  it("uses user-open Chrome tabs for default preferred existing-tab discovery", async () => {
    const claimed: unknown[] = [];
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "user-tab-1", url: "https://chatgpt.com/c/abc-123", title: "SDK Review" }
        ],
        claimTab: async tab => {
          claimed.push(tab);
          return fakeChatGPTPage("user-tab-1", "https://chatgpt.com/c/abc-123", "SDK Review");
        }
      },
      tabs: {
        list: async () => []
      }
    };

    const result = await bootstrap({ browser }, { preferExistingTab: true });

    expect(result.ok).toBe(true);
    expect(result.context.tabId).toBe("user-tab-1");
    expect(claimed).toEqual([
      { id: "user-tab-1", url: "https://chatgpt.com/c/abc-123", title: "SDK Review" }
    ]);
  });

  it("opens a new ChatGPT tab when preferExistingTab is false", async () => {
    const claimed: unknown[] = [];
    const created: string[] = [];
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "user-tab-1", url: "https://chatgpt.com/c/abc-123", title: "SDK Review" }
        ],
        claimTab: async tab => {
          claimed.push(tab);
          return fakeChatGPTPage("user-tab-1", "https://chatgpt.com/c/abc-123", "SDK Review");
        }
      },
      tabs: {
        create: async url => {
          created.push(url);
          return fakeChatGPTPage("created-tab", url, "ChatGPT");
        }
      }
    };

    const result = await bootstrap({ browser }, { preferExistingTab: false });

    expect(result.ok).toBe(true);
    expect(result.context.tabId).toBe("created-tab");
    expect(claimed).toEqual([]);
    expect(created).toEqual(["https://chatgpt.com/"]);
  });

  it("does not reuse a cached page when preferExistingTab is false", async () => {
    const created: string[] = [];
    const cachedPage = fakeChatGPTPage("cached", "https://chatgpt.com/c/abc-123", "SDK Review");
    const browser: BrowserLike = {
      name: "chrome",
      tabs: {
        create: async url => {
          created.push(url);
          return fakeChatGPTPage("created-tab", url, "ChatGPT");
        }
      }
    };

    const result = await bootstrap({ browser, page: cachedPage }, { preferExistingTab: false });

    expect(result.ok).toBe(true);
    expect(result.context.tabId).toBe("created-tab");
    expect(created).toEqual(["https://chatgpt.com/"]);
  });

  it("claims an exact open user ChatGPT tab by conversation id without navigating", async () => {
    const claimed: unknown[] = [];
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "other", url: "https://chatgpt.com/c/other", title: "Other Chat" },
          { id: "target", url: "https://chatgpt.com/c/abc-123", title: "SDK Review" }
        ],
        claimTab: async tab => {
          claimed.push(tab);
          return fakeChatGPTPage("target", "https://chatgpt.com/c/abc-123", "SDK Review");
        }
      }
    };

    const result = await bootstrap({ browser }, {
      existingTab: {
        target: { type: "conversationId", conversationId: "abc-123" },
        ifMissing: "block"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.context.tabId).toBe("target");
    expect(claimed).toEqual([
      { id: "target", url: "https://chatgpt.com/c/abc-123", title: "SDK Review" }
    ]);
  });

  it("does not require sidebar signed-in chrome for narrow conversation tabs", async () => {
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "narrow", url: "https://chatgpt.com/c/abc-123", title: "ChatGPT" }
        ],
        claimTab: async () => fakeNarrowChatGPTPage("narrow", "https://chatgpt.com/c/abc-123", "ChatGPT")
      }
    };

    const result = await bootstrap({ browser }, {
      existingTab: {
        target: { type: "conversationId", conversationId: "abc-123" },
        ifMissing: "block"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.context.tabId).toBe("narrow");
    expect(result.context.conversationId).toBe("abc-123");
    expect(result.data?.loggedIn).toBe(false);
  });

  it("does not let a stale cached page bypass an explicit existing-tab claim", async () => {
    const claimed: unknown[] = [];
    const stalePage = {
      id: "stale",
      url: () => undefined as unknown as string,
      title: async () => "Stale tab",
      content: async () => "",
      locator: () => ({ count: async () => 0 })
    } as PageLike;
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "target", url: "https://chatgpt.com/c/abc-123", title: "SDK Review" }
        ],
        claimTab: async tab => {
          claimed.push(tab);
          return fakeChatGPTPage("target", "https://chatgpt.com/c/abc-123", "SDK Review");
        }
      }
    };

    const result = await bootstrap({ browser, page: stalePage }, {
      existingTab: {
        target: { type: "conversationId", conversationId: "abc-123" },
        ifMissing: "block"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.context.tabId).toBe("target");
    expect(result.context.conversationId).toBe("abc-123");
    expect(claimed).toEqual([
      { id: "target", url: "https://chatgpt.com/c/abc-123", title: "SDK Review" }
    ]);
  });

  it("blocks when an explicit existing conversation target is not open", async () => {
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "other", url: "https://chatgpt.com/c/other", title: "Other Chat" }
        ],
        claimTab: async () => fakeChatGPTPage("other", "https://chatgpt.com/c/other", "Other Chat")
      }
    };

    const result = await bootstrap({ browser }, {
      existingTab: {
        target: { type: "conversationId", conversationId: "abc-123" },
        ifMissing: "block"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      kind: "not_found",
      code: "existing_tab_not_found"
    });
  });

  it("blocks ambiguous title matches with metadata-only candidates by default", async () => {
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "one", url: "https://chatgpt.com/c/one", title: "SDK Review" },
          { id: "two", url: "https://chatgpt.com/c/two", title: "SDK Review" }
        ],
        claimTab: async () => fakeChatGPTPage("one", "https://chatgpt.com/c/one", "SDK Review")
      }
    };

    const result = await bootstrap({ browser }, {
      existingTab: {
        target: { type: "title", title: "SDK Review" },
        ifMissing: "block"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      kind: "not_found",
      code: "existing_tab_ambiguous"
    });
    expect(result.blocker?.candidates?.map(candidate => candidate.label)).toEqual([
      "tab one - SDK Review - https://chatgpt.com/c/one",
      "tab two - SDK Review - https://chatgpt.com/c/two"
    ]);
  });
});

function fakeChatGPTPage(id: string, url: string, title: string): PageLike {
  return {
    id,
    url: () => url,
    title: async () => title,
    content: async () => "<main>New chat Search chats Chat with ChatGPT</main>",
    locator: () => ({ count: async () => 0 }),
    waitForEvent: async () => ({})
  } as PageLike;
}

function fakeNarrowChatGPTPage(id: string, url: string, title: string): PageLike {
  return {
    id,
    url: () => url,
    title: async () => title,
    content: async () => [
      "<main>",
      "<a>Skip to content</a>",
      "<div data-message-author-role=\"user\">say hi</div>",
      "<div data-message-author-role=\"assistant\">hi</div>",
      "<footer>ChatGPT is AI and can make mistakes. Check important info.</footer>",
      "</main>"
    ].join(""),
    locator: () => ({ count: async () => 0 }),
    waitForEvent: async () => ({})
  } as PageLike;
}
