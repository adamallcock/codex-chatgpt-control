import { describe, expect, it } from "vitest";
import { fnv1a32Hex, readWaitDomSnapshot, waitTextMetadata } from "../../src/dom/wait-snapshot.js";
import type { PageLike } from "../../src/types.js";

describe("wait snapshot metadata", () => {
  it("hashes normalized text deterministically", () => {
    const metadata = waitTextMetadata("  Hello   world  ");
    expect(metadata.length).toBe("Hello world".length);
    expect(metadata.hash).toBe(fnv1a32Hex("Hello world"));
    expect(metadata.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(metadata.transient).toBe(false);
    expect(waitTextMetadata("Hello world!").hash).not.toBe(metadata.hash);
    expect(waitTextMetadata(undefined)).toEqual({ length: 0, hash: fnv1a32Hex(""), transient: false });
  });

  it("flags transient placeholder text", () => {
    expect(waitTextMetadata("Thinking...").transient).toBe(true);
    expect(waitTextMetadata("Analyzing image").transient).toBe(true);
    expect(waitTextMetadata("A finished answer.").transient).toBe(false);
  });

  it("computes the same metadata in-page as the SDK-side helper", async () => {
    const assistantText = "The   final answer\nwith two lines";
    const page = domBackedPage({
      assistantText,
      stopButtonText: "Stop generating",
      actionButtonText: "Copy response"
    });

    const snapshot = await readWaitDomSnapshot(page);

    expect(snapshot).toBeDefined();
    expect(snapshot?.turnCount).toBe(2);
    expect(snapshot?.assistantTurnCount).toBe(1);
    expect(snapshot?.latestAssistantTurnIndex).toBe(2);
    expect(snapshot?.text).toEqual(waitTextMetadata(assistantText));
    expect(snapshot?.generation.active).toBe(true);
    expect(snapshot?.generation.stopped).toBe(false);
    expect(snapshot?.hasResponseActions).toBe(true);
  });

  it("reports transient placeholders and idle generation from the page", async () => {
    const page = domBackedPage({
      assistantText: "Thinking...",
      actionButtonText: "Copy response"
    });

    const snapshot = await readWaitDomSnapshot(page);

    expect(snapshot?.text.transient).toBe(true);
    expect(snapshot?.text).toEqual(waitTextMetadata("Thinking..."));
    expect(snapshot?.generation.active).toBe(false);
  });

  it("returns undefined response actions when no conversation turn markers exist", async () => {
    const page = domBackedPage({
      assistantText: "Answer without turn testids",
      includeTurnMarkers: false
    });

    const snapshot = await readWaitDomSnapshot(page);

    expect(snapshot?.hasResponseActions).toBeUndefined();
  });
});

type FakeButton = {
  innerText: string;
  textContent: string;
  disabled: boolean;
  getAttribute: (name: string) => string | null;
};

function fakeButton(text: string): FakeButton {
  return {
    innerText: text,
    textContent: text,
    disabled: false,
    getAttribute: () => null
  };
}

function fakeMessageNode(role: "user" | "assistant", text: string) {
  return {
    getAttribute: (name: string) => name === "data-message-author-role" ? role : null,
    innerText: text,
    textContent: text
  };
}

function domBackedPage({
  assistantText,
  stopButtonText,
  actionButtonText,
  includeTurnMarkers = true
}: {
  assistantText: string;
  stopButtonText?: string;
  actionButtonText?: string;
  includeTurnMarkers?: boolean;
}): PageLike {
  const userNode = fakeMessageNode("user", "The question");
  const assistantNode = fakeMessageNode("assistant", assistantText);
  const buttons: FakeButton[] = [
    ...(stopButtonText === undefined ? [] : [fakeButton(stopButtonText)]),
    ...(actionButtonText === undefined ? [] : [fakeButton(actionButtonText)])
  ];
  const turn = {
    querySelector: (selector: string) => selector.includes("assistant") ? assistantNode : null,
    querySelectorAll: (selector: string) => selector === "button" && actionButtonText !== undefined
      ? [fakeButton(actionButtonText)]
      : []
  };

  return {
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      try {
        globalThis.document = {
          body: { innerText: "New chat Chat with ChatGPT" },
          querySelectorAll: (selector: string) => {
            if (selector === "[data-message-author-role]") {
              return [userNode, assistantNode];
            }
            if (selector === "button") {
              return buttons;
            }
            if (selector.includes("conversation-turn")) {
              return includeTurnMarkers ? [turn] : [];
            }
            return [];
          }
        } as unknown as Document;
        globalThis.window = {
          getComputedStyle: () => ({ display: "block", opacity: "1", visibility: "visible" })
        } as unknown as Window & typeof globalThis;
        return await fn(arg as A);
      } finally {
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
      }
    }
  };
}
