import { describe, expect, it } from "vitest";
import { parseConversationId } from "../../src/browser/page-state.js";
import { ensureConversationTarget } from "../../src/commands/conversation.js";
import type { PageLike } from "../../src/types.js";

describe("conversation navigation", () => {
  it("parses exact conversation ids from the URL path and accepts hashes", () => {
    expect(parseConversationId("https://chatgpt.com/c/6a2b2771-7810-83ea-83eb-cb9e31ca01f5#settings"))
      .toBe("6a2b2771-7810-83ea-83eb-cb9e31ca01f5");
    expect(parseConversationId("/c/6a2b2771-7810-83ea-83eb-cb9e31ca01f5?model=gpt"))
      .toBe("6a2b2771-7810-83ea-83eb-cb9e31ca01f5");
  });

  it("does not parse conversation ids from query strings or hashes", () => {
    expect(parseConversationId("https://chatgpt.com/?next=/c/6a2b2771-7810-83ea-83eb-cb9e31ca01f5"))
      .toBeUndefined();
    expect(parseConversationId("https://chatgpt.com/c/other-thread#target=/c/6a2b2771-7810-83ea-83eb-cb9e31ca01f5"))
      .toBe("other-thread");
  });

  it("does not reload when the current page is already on the target conversation", async () => {
    const page = conversationPage("https://chatgpt.com/c/6a2b2771-7810-83ea-83eb-cb9e31ca01f5#settings");

    const result = await ensureConversationTarget(page, {
      url: "https://chatgpt.com/c/6a2b2771-7810-83ea-83eb-cb9e31ca01f5"
    }, { timeoutMs: 0 });

    expect(result).toEqual({
      navigated: false,
      expectedConversationId: "6a2b2771-7810-83ea-83eb-cb9e31ca01f5",
      targetUrl: "https://chatgpt.com/c/6a2b2771-7810-83ea-83eb-cb9e31ca01f5"
    });
    expect(page.gotoCalls).toEqual([]);
    expect(page.evaluateCalls).toBeGreaterThan(0);
  });

  it("navigates when the target id only appears in routing metadata", async () => {
    const page = conversationPage("https://chatgpt.com/?next=/c/6a2b2771-7810-83ea-83eb-cb9e31ca01f5");

    const result = await ensureConversationTarget(page, {
      url: "https://chatgpt.com/c/6a2b2771-7810-83ea-83eb-cb9e31ca01f5"
    }, { timeoutMs: 0 });

    expect(result.navigated).toBe(true);
    expect(page.gotoCalls).toEqual(["https://chatgpt.com/c/6a2b2771-7810-83ea-83eb-cb9e31ca01f5"]);
  });
});

type ConversationPage = PageLike & {
  gotoCalls: string[];
  evaluateCalls: number;
  waitForTimeoutCalls: number[];
};

function conversationPage(initialUrl: string): ConversationPage {
  let currentUrl = initialUrl;
  const gotoCalls: string[] = [];
  const waitForTimeoutCalls: number[] = [];
  let evaluateCalls = 0;
  return {
    gotoCalls,
    get evaluateCalls() {
      return evaluateCalls;
    },
    waitForTimeoutCalls,
    url: () => currentUrl,
    goto: async (url: string) => {
      gotoCalls.push(url);
      currentUrl = url;
    },
    waitForTimeout: async (ms?: number) => {
      waitForTimeoutCalls.push(ms ?? 0);
    },
    title: async () => "Existing conversation",
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      evaluateCalls += 1;
      const previousDocument = globalThis.document;
      try {
        globalThis.document = {
          querySelectorAll: () => [],
          body: { innerText: "Existing assistant answer" }
        } as unknown as Document;
        return await fn(arg as A);
      } finally {
        globalThis.document = previousDocument;
      }
    }
  };
}
