import { describe, expect, it } from "vitest";
import { readPageState } from "../../src/browser/page-state.js";
import type { PageLike } from "../../src/types.js";

describe("readPageState", () => {
  it("treats Japanese signed-in navigation markers as logged in", async () => {
    const page: PageLike = {
      evaluate: async <T>(): Promise<T> => "ChatGPT\n新しいチャット\nチャットを検索\nライブラリ\nプロジェクト" as T,
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/?temporary-chat=true"
    };

    const state = await readPageState(page);

    expect(state.signedIn).toBe(true);
    expect(state.blocker).toBeUndefined();
  });
});
