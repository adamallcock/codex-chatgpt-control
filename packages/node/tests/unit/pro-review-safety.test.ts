import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createChatGPT } from "../../src/client.js";
import { assertChatGPTHost } from "../../src/commands/session.js";
import { inspectComposer } from "../../src/commands/messages.js";
import { normalizePromptForHash } from "../../src/dom/visible-text.js";
import { readTemporaryChatState } from "../../src/commands/temporary.js";
import { verifyAttachedFiles } from "../../src/commands/files.js";
import type { LocatorLike, PageLike } from "../../src/types.js";

describe("ChatGPT Pro review safety primitives", () => {
  it("requires multiple pieces of evidence before Temporary Chat is verified on", async () => {
    const result = await readTemporaryChatState({
      page: documentPage([
        node({ label: "Temporary chat", attributes: { "aria-pressed": "true", "aria-checked": "true" } })
      ])
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      state: "on",
      confidence: "verified"
    });
  });

  it("does not treat a visible Temporary Chat button as verified when state evidence is missing", async () => {
    const result = await readTemporaryChatState({
      page: documentPage([
        node({ label: "Temporary chat" })
      ])
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      state: "unknown",
      candidates: ["Temporary chat"]
    });
  });

  it("treats localized turn-on labels as Temporary Chat off evidence", async () => {
    const result = await readTemporaryChatState({
      page: documentPage([
        node({ label: "一時チャットをオンにする" })
      ])
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      state: "off"
    });
  });

  it("requires localized turn-off labels plus another signal before Temporary Chat is verified on", async () => {
    const result = await readTemporaryChatState({
      page: documentPage([
        node({ label: "一時チャットをオフにする" })
      ], {
        url: "https://chatgpt.com/?temporary-chat=true"
      })
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      state: "on",
      confidence: "verified"
    });
  });

  it("accepts Temporary Chat URL plus an empty thread when the toggle is hidden", async () => {
    const result = await readTemporaryChatState({
      page: documentPage([], {
        url: "https://chatgpt.com/?temporary-chat=true"
      })
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      state: "on",
      confidence: "verified"
    });
  });

  it("blocks non-ChatGPT hosts", async () => {
    const result = await assertChatGPTHost({
      page: documentPage([], { url: "https://chatgpt.com.evil.example/" })
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatchObject({
      kind: "confirmation",
      code: "not_chatgpt_host"
    });
  });

  it("verifies exactly one expected visible attachment", async () => {
    const result = await verifyAttachedFiles({
      page: documentPage([
        node({ label: "review-pack.zip" })
      ])
    }, {
      expectedName: "review-pack.zip"
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      verified: true,
      visibleAttachments: ["review-pack.zip"]
    });
  });

  it("deduplicates delete-button labels for the same visible attachment", async () => {
    const result = await verifyAttachedFiles({
      page: documentPage([
        node({ label: "review-pack.zip" }),
        node({ label: "ファイル 1 を削除：review-pack.zip" })
      ])
    }, {
      expectedName: "review-pack.zip"
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      verified: true,
      visibleAttachments: ["review-pack.zip"]
    });
  });

  it("matches attachment names despite invisible label characters", async () => {
    const result = await verifyAttachedFiles({
      page: documentPage([
        node({ label: "review.zip\u200B" }),
        node({ label: "ファイル 1 を削除：review.zip\u200B" })
      ])
    }, {
      expectedName: "review.zip"
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      verified: true,
      visibleAttachments: ["review.zip"]
    });
  });

  it("blocks extra visible attachments", async () => {
    const result = await verifyAttachedFiles({
      page: documentPage([
        node({ label: "review-pack.zip" }),
        node({ label: "other.zip" })
      ])
    }, {
      expectedName: "review-pack.zip"
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "attachment_not_uniquely_verified"
    });
  });

  it("blocks composer text that does not match the expected hash", async () => {
    const page = documentPage([
      node({ label: "Send prompt" })
    ], {
      textboxText: "actual prompt"
    });

    const result = await inspectComposer({ page }, {
      expectedSha256: sha256("expected prompt")
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatchObject({
      kind: "confirmation",
      code: "composer_prompt_mismatch"
    });
  });

  it("matches composer prompts when ChatGPT DOM inserts extra blank lines", async () => {
    const expected = [
      "添付zipを読んで、ゼロベースで第三者レビューをしてください。",
      "",
      "## 見てほしいこと",
      "1. この設計で期待に近づいているか",
      "2. 安全guardに抜け漏れがないか",
      "",
      "## 制約",
      "- OSカーソル制御は禁止です。",
      "- 既存ChatGPTタブの上書きは禁止です。"
    ].join("\n");
    const composerText = [
      "添付zipを読んで、ゼロベースで第三者レビューをしてください。",
      "",
      "",
      "",
      "## 見てほしいこと",
      "",
      "1. この設計で期待に近づいているか",
      "",
      "2. 安全guardに抜け漏れがないか",
      "",
      "",
      "",
      "## 制約",
      "",
      "- OSカーソル制御は禁止です。",
      "",
      "- 既存ChatGPTタブの上書きは禁止です。"
    ].join("\n");
    const page = documentPage([
      node({ label: "Send prompt" })
    ], {
      textboxText: composerText
    });

    const result = await inspectComposer({ page }, {
      expectedSha256: sha256Prompt(expected)
    });

    expect(result.ok).toBe(true);
    expect(result.data?.matchesExpected).toBe(true);
  });

  it("rejects Pro review attachments that are not zip files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pro-review-zip-guard-"));
    const txtPath = join(dir, "review.txt");
    await writeFile(txtPath, "not a zip", "utf8");
    const chatgpt = createChatGPT();

    const result = await chatgpt.proReview.dryRun({
      zipPath: txtPath,
      prompt: "Review this package."
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("must be a .zip file");
  });

  it("rejects Pro review zip paths whose content is not zip-like", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pro-review-zip-signature-"));
    const zipPath = join(dir, "review.zip");
    await writeFile(zipPath, "not a zip", "utf8");
    const chatgpt = createChatGPT();

    const result = await chatgpt.proReview.dryRun({
      zipPath,
      prompt: "Review this package."
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("does not look like a zip file");
  });
});

type TestNodeOptions = {
  label: string;
  attributes?: Record<string, string>;
  className?: string;
};

function node(options: TestNodeOptions): HTMLElement {
  return {
    innerText: options.label,
    textContent: options.label,
    className: options.className ?? "",
    tagName: "BUTTON",
    getAttribute: (name: string) => options.attributes?.[name] ?? null,
    click: () => {}
  } as unknown as HTMLElement;
}

function documentPage(
  nodes: HTMLElement[],
  options: { url?: string; bodyText?: string; textboxText?: string } = {}
): PageLike {
  return {
    url: () => options.url ?? "https://chatgpt.com/",
    title: async () => "ChatGPT",
    getByRole: (role: string) => role === "textbox" ? testLocator(nodes, options) : { ...testLocator(nodes, options), count: async () => 1 },
    locator: (selector: string) => testLocator(nodes, options, selector),
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      const previousDocument = globalThis.document;
      try {
        globalThis.document = {
          body: { innerText: options.bodyText ?? "New chat Search chats Chat with ChatGPT" },
          location: { href: options.url ?? "https://chatgpt.com/" },
          querySelectorAll: () => nodes
        } as unknown as Document;
        return await fn(arg as A);
      } finally {
        globalThis.document = previousDocument;
      }
    },
    waitForTimeout: async () => {}
  };
}

function testLocator(
  nodes: HTMLElement[],
  options: { textboxText?: string },
  selector?: string
): LocatorLike {
  const selected = selector?.includes("aria-label=")
    ? nodes.filter(node => selector.includes(`aria-label="${node.getAttribute("aria-label") ?? ""}"`))
    : nodes;
  return {
    count: async () => selected.length,
    click: async () => {},
    innerText: async () => options.textboxText ?? "",
    textContent: async () => options.textboxText ?? null
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sha256Prompt(text: string): string {
  return sha256(normalizePromptForHash(text));
}
