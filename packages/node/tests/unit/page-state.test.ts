import { describe, expect, it } from "vitest";
import { readPageState } from "../../src/browser/page-state.js";
import type { PageLike } from "../../src/types.js";

describe("readPageState", () => {
  it("does not treat signed-in settings text as a login blocker", async () => {
    const state = await readPageState(textPage(
      "Chat history New chat Search chats Library Projects Security and login"
    ));

    expect(state.signedIn).toBe(true);
    expect(state.blocker).toBeUndefined();
  });

  it("still reports login blockers when signed-in markers are absent", async () => {
    const state = await readPageState(textPage("Welcome back Log in Sign up"));

    expect(state.signedIn).toBe(false);
    expect(state.blocker?.kind).toBe("login_required");
  });
});

function textPage(text: string): PageLike {
  return {
    url: () => "https://chatgpt.com/",
    title: () => Promise.resolve("ChatGPT"),
    evaluate: async <T>() => text as T
  };
}
