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
