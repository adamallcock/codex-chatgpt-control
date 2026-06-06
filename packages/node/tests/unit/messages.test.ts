import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { askMessage, readLatest, submittedUserTurnMatches, waitForMessage } from "../../src/commands/messages.js";
import { copyResponse } from "../../src/commands/response-actions.js";
import {
  countMessages,
  extractMessagesFromHtml,
  isTransientAssistantText,
  readLatestMessage,
  readLatestMessageText,
  readLatestMessageTextSnapshot
} from "../../src/dom/messages.js";
import type { LocatorLike, PageLike } from "../../src/types.js";

describe("extractMessagesFromHtml", () => {
  it("extracts ordered user and assistant messages", () => {
    const html = readFileSync("tests/fixtures/chat-basic.html", "utf8");
    const messages = extractMessagesFromHtml(html);

    expect(messages).toMatchObject([
      { role: "user", text: "reply with the word hi", format: "markdown", markdown: "reply with the word hi" },
      { role: "assistant", text: "hi", format: "markdown", markdown: "hi" }
    ]);
    expect(messages[0]?.actions).toBeUndefined();
  });

  it("counts messages by role", () => {
    const html = readFileSync("tests/fixtures/chat-basic.html", "utf8");
    const messages = extractMessagesFromHtml(html);

    expect(countMessages(messages)).toBe(2);
    expect(countMessages(messages, "assistant")).toBe(1);
  });

  it("detects transient assistant status text", () => {
    expect(isTransientAssistantText("Thinking")).toBe(true);
    expect(isTransientAssistantText("Thinking...")).toBe(true);
    expect(isTransientAssistantText("hi")).toBe(false);
  });

  it("matches user turns that include attachment-rendered text", () => {
    expect(submittedUserTurnMatches("chatgpt-live-smoke-single.txt Reply with the attached filename only.", "Reply with the attached filename only.")).toBe(true);
    expect(submittedUserTurnMatches("reply with the word hi", "reply with the word hi")).toBe(true);
    expect(submittedUserTurnMatches("different prompt", "reply with the word hi")).toBe(false);
  });

  it("matches rendered Markdown user turns against raw prompt text", () => {
    const rawPrompt = [
      "Respond with exactly this Markdown structure and no extra prose:",
      "",
      "## Format Fidelity",
      "",
      "- Markdown default",
      "- Structure preserved",
      "",
      "```ts",
      "const format = \"markdown\";",
      "```",
      "",
      "| Format | Purpose |",
      "| --- | --- |",
      "| markdown | reports |"
    ].join("\n");
    const renderedTurn = [
      "Respond with exactly this Markdown structure and no extra prose:",
      "Format Fidelity",
      "Markdown default",
      "Structure preserved",
      "const format = \"markdown\";",
      "Format Purpose",
      "markdown reports"
    ].join(" ");

    expect(submittedUserTurnMatches(renderedTurn, rawPrompt)).toBe(true);
  });

  it("matches ChatGPT-rendered code-fence prompts during submit confirmation", () => {
    const rawPrompt = [
      "Respond with exactly this Markdown structure and no extra prose:",
      "",
      "## Format Fidelity",
      "",
      "- Markdown default",
      "- Structure preserved",
      "",
      "```ts",
      "const format = \"markdown\";",
      "```",
      "",
      "| Format | Purpose |",
      "| --- | --- |",
      "| markdown | reports |"
    ].join("\n");
    const renderedTurn = "Respond with exactly this Markdown structure and no extra prose: ## Format Fidelity - Markdown default - Structure preserved ts const format = \"markdown\"; | Format | Purpose | | --- | --- | | markdown | reports |";

    expect(submittedUserTurnMatches(renderedTurn, rawPrompt)).toBe(true);
  });

  it("reads latest user text snapshots without serializing message HTML", async () => {
    let evaluatedSource = "";
    const page: PageLike = {
      evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, _arg?: A): Promise<T> => {
        evaluatedSource = String(fn);
        return { latestText: "latest prompt", turnCount: 4 } as T;
      }
    };

    const snapshot = await readLatestMessageTextSnapshot(page, "user");

    expect(snapshot).toEqual({ latestText: "latest prompt", turnCount: 4 });
    expect(evaluatedSource).not.toContain("innerHTML");
    expect(evaluatedSource).not.toContain("outerHTML");
  });

  it("reads latest assistant text for hydration probes without semantic extraction", async () => {
    let evaluatedSource = "";
    const page: PageLike = {
      evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, _arg?: A): Promise<T> => {
        evaluatedSource = String(fn);
        return "latest assistant response" as T;
      }
    };

    const text = await readLatestMessageText(page, "assistant");

    expect(text).toBe("latest assistant response");
    expect(evaluatedSource).not.toContain("innerHTML");
    expect(evaluatedSource).not.toContain("outerHTML");
    expect(evaluatedSource).not.toContain("formatMessageHtml");
  });

  it("waits for a new assistant turn instead of accepting pre-existing assistant text", async () => {
    const page = scriptedWaitPage([
      {
        totalCount: 3,
        assistantCount: 1,
        latestAssistantText: "old stable answer",
        hasStopControl: false,
        hasResponseActions: true
      },
      {
        totalCount: 4,
        assistantCount: 2,
        latestAssistantText: "new answer",
        hasStopControl: false,
        hasResponseActions: true
      }
    ]);

    const result = await waitForMessage({ page }, {
      afterAssistantTurnCount: 1,
      timeoutMs: 100,
      stableMs: 0,
      pollMs: 1
    });

    expect(result.ok).toBe(true);
    expect(result.output_text).toBe("new answer");
    expect(result.data?.responseText).toBe("new answer");
    expect(result.data?.assistantTurnCount).toBe(2);
  });

  it("requires the latest assistant turn to be after the requested total turn baseline", async () => {
    const page = scriptedWaitPage([
      {
        totalCount: 3,
        assistantCount: 1,
        latestAssistantTurnIndex: 2,
        latestAssistantText: "old answer before baseline",
        hasStopControl: false,
        hasResponseActions: true
      },
      {
        totalCount: 4,
        assistantCount: 1,
        latestAssistantTurnIndex: 2,
        latestAssistantText: "old answer before baseline",
        hasStopControl: false,
        hasResponseActions: true
      },
      {
        totalCount: 5,
        assistantCount: 2,
        latestAssistantTurnIndex: 5,
        latestAssistantText: "assistant answer after baseline",
        hasStopControl: false,
        hasResponseActions: true
      }
    ]);

    const result = await waitForMessage({ page }, {
      afterTurnCount: 3,
      timeoutMs: 100,
      stableMs: 0,
      pollMs: 1
    });

    expect(result.ok).toBe(true);
    expect(result.output_text).toBe("assistant answer after baseline");
    expect(result.data?.responseText).toBe("assistant answer after baseline");
    expect(result.data?.assistantTurnCount).toBe(2);
  });

  it("falls back to a guarded read when wait misses a submitted assistant turn", async () => {
    const page = askWaitFallbackPage("Reply exactly fallback-ok.", "fallback-ok");

    const result = await askMessage({ page }, {
      text: "Reply exactly fallback-ok.",
      wait: { timeoutMs: 5, stableMs: 0, pollMs: 1 },
      read: { format: "normalized_text" }
    });

    expect(result.ok).toBe(true);
    expect(result.output_text).toBe("fallback-ok");
    expect(result.data?.responseText).toBe("fallback-ok");
    expect(result.data?.complete).toBe(false);
    expect(result.warnings.join(" ")).toContain("completion was not confirmed");
  });

  it("extracts assistant Markdown by default without flattening structure", () => {
    const html = readFileSync("tests/fixtures/chat-rich-response.html", "utf8");
    const messages = extractMessagesFromHtml(html);
    const assistant = messages.at(-1);

    expect(assistant?.format).toBe("markdown");
    expect(assistant?.markdown).toContain("## Design Proposal");
    expect(assistant?.markdown).toContain("- Prefer Markdown by default.");
    expect(assistant?.markdown).toContain("1. Capture response.");
    expect(assistant?.markdown).toContain("```ts\nconst result = await chatgpt.readLatest();");
    expect(assistant?.markdown).toContain("| Format | Use |");
    expect(assistant?.markdown).toContain("[the docs](https://example.com/docs)");
    expect(assistant?.markdown).toContain("> Preserve structure.");
    expect(assistant?.text).toBe(assistant?.markdown);
    expect(assistant?.text).not.toContain("Design Proposal Use readLatest");
  });

  it("keeps explicit normalized text available for assertions", () => {
    const html = readFileSync("tests/fixtures/chat-rich-response.html", "utf8");
    const messages = extractMessagesFromHtml(html, { format: "normalized_text" });
    const assistant = messages.at(-1);

    expect(assistant?.format).toBe("normalized_text");
    expect(assistant?.text).toContain("Design Proposal Use readLatest for structured capture.");
    expect(assistant?.text).not.toContain("\n");
    expect(assistant?.markdown).toBeUndefined();
  });

  it("supports visible text, html, all, and legacy text response modes", () => {
    const html = readFileSync("tests/fixtures/chat-rich-response.html", "utf8");
    const visible = extractMessagesFromHtml(html, { role: "assistant", format: "visible_text" }).at(-1);
    const rawHtml = extractMessagesFromHtml(html, { role: "assistant", format: "html" }).at(-1);
    const all = extractMessagesFromHtml(html, { role: "assistant", format: "all" }).at(-1);
    const legacyText = extractMessagesFromHtml(html, { role: "assistant", format: "text" }).at(-1);

    expect(visible?.format).toBe("visible_text");
    expect(visible?.visibleText).toContain("Design Proposal");
    expect(rawHtml?.format).toBe("html");
    expect(rawHtml?.html).toContain("<h2>Design Proposal</h2>");
    expect(all?.format).toBe("all");
    expect(all?.markdown).toContain("## Design Proposal");
    expect(all?.blocks?.length).toBeGreaterThan(0);
    expect(legacyText?.format).toBe("normalized_text");
    expect(legacyText?.text).not.toContain("\n");
  });

  it("returns structured blocks for agent consumers", () => {
    const html = readFileSync("tests/fixtures/chat-rich-response.html", "utf8");
    const messages = extractMessagesFromHtml(html, { format: "blocks" });
    const assistant = messages.at(-1);

    expect(assistant?.format).toBe("blocks");
    expect(assistant?.blocks?.map(block => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "code",
      "table",
      "paragraph",
      "quote"
    ]);
    expect(assistant?.citations).toEqual([
      { text: "the docs", href: "https://example.com/docs" },
      { text: "1", href: "https://example.com/source" }
    ]);
    expect(assistant?.codeBlocks).toEqual([
      { language: "ts", text: "const result = await chatgpt.readLatest();\nconsole.log(result.data?.markdown);" }
    ]);
    expect(assistant?.branch).toEqual({
      label: "2/2",
      current: 2,
      total: 2,
      canGoPrevious: true,
      canGoNext: false
    });
    expect(assistant?.actions?.map(action => action.type)).toEqual([
      "copy_response",
      "previous_response",
      "next_response",
      "copy_response",
      "sources"
    ]);
    expect(assistant?.thoughtDurationText).toBe("Thought for 6m 44s");
    expect(assistant?.sourcesAvailable).toBe(true);
  });

  it("can read latest Markdown from a page content fallback", async () => {
    const html = readFileSync("tests/fixtures/chat-rich-response.html", "utf8");
    const latest = await readLatestMessage({ content: async () => html });

    expect(latest?.format).toBe("markdown");
    expect(latest?.text).toContain("## Design Proposal");
  });

  it("readLatest defaults to Markdown at the command boundary", async () => {
    const html = readFileSync("tests/fixtures/chat-rich-response.html", "utf8");
    const result = await readLatest({
      page: contentPage(html)
    });

    expect(result.ok).toBe(true);
    expect(result.data?.format).toBe("markdown");
    expect(result.data?.source).toBe("semantic_dom");
    expect(result.data?.fidelity).toBe("semantic_markdown");
    expect(result.data?.warnings?.join(" ")).toContain("DOM semantics");
    expect(result.warnings.join(" ")).toContain("DOM semantics");
    expect(result.data?.markdown).toContain("## Design Proposal");
    expect(result.output_text).toBe(result.data?.text);
    expect(result.data?.text).toBe(result.data?.markdown);
    expect(result.data?.branch?.label).toBe("2/2");
    expect(result.data?.actions?.some(action => action.type === "sources")).toBe(true);
  });

  it("copyResponse can intentionally use DOM Markdown fallback", async () => {
    const html = readFileSync("tests/fixtures/chat-rich-response.html", "utf8");
    const result = await copyResponse({
      page: contentPage(html)
    }, { prefer: "dom" });

    expect(result.ok).toBe(true);
    expect(result.data?.source).toBe("dom");
    expect(result.data?.format).toBe("markdown");
    expect(result.data?.markdown).toContain("```ts");
    expect(result.output_text).toBe(result.data?.text);
    expect(result.data?.branch?.canGoNext).toBe(false);
    expect(result.data?.sourcesAvailable).toBe(true);
    expect(result.warnings).toContain("Returned DOM-derived Markdown because clipboard copy was not requested.");
  });

  it("copyResponse returns clipboard Markdown with DOM metadata on success", async () => {
    const html = readFileSync("tests/fixtures/chat-rich-response.html", "utf8");
    let clicked = false;
    const result = await copyResponse({
      page: contentPage(html, () => { clicked = true; }),
      clipboard: {
        read: async () => "before",
        waitForChange: async () => [
          "## Design Proposal",
          "",
          "- Clipboard Markdown",
          "",
          "```ts",
          "const copied = true;",
          "```"
        ].join("\n")
      }
    });

    expect(clicked).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.data?.source).toBe("clipboard");
    expect(result.data?.fidelity).toBe("clipboard_markdown");
    expect(result.data?.format).toBe("markdown");
    expect(result.data?.markdown).toContain("- Clipboard Markdown");
    expect(result.output_text).toBe(result.data?.text);
    expect(result.data?.branch?.label).toBe("2/2");
    expect(result.data?.actions?.some(action => action.type === "sources")).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("copyResponse uses DOM extraction for html format requests", async () => {
    const html = readFileSync("tests/fixtures/chat-rich-response.html", "utf8");
    const result = await copyResponse({
      page: contentPage(html),
      clipboard: {
        read: async () => "before",
        waitForChange: async () => "## Clipboard markdown"
      }
    }, { format: "html" });

    expect(result.ok).toBe(true);
    expect(result.data?.source).toBe("dom");
    expect(result.data?.format).toBe("html");
    expect(result.data?.html).toContain("<h2>Design Proposal</h2>");
    expect(result.data?.markdown).toBe("## Clipboard markdown");
    expect(result.warnings.join(" ")).toContain("requires DOM extraction");
  });

  it("copyResponse downgrades structured copy requests when DOM extraction is unavailable", async () => {
    const result = await copyResponse({
      page: contentPage("<main></main>"),
      clipboard: {
        read: async () => "before",
        waitForChange: async () => "## Clipboard markdown"
      }
    }, { format: "blocks" });

    expect(result.ok).toBe(true);
    expect(result.data?.source).toBe("clipboard");
    expect(result.data?.format).toBe("markdown");
    expect(result.data?.markdown).toBe("## Clipboard markdown");
    expect(result.data?.blocks).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("returned clipboard Markdown instead");
  });

  it("copyResponse merges metadata from the selected assistant index", async () => {
    const result = await copyResponse({
      page: contentPage(twoAssistantTurnsHtml()),
      clipboard: {
        read: async () => "before",
        waitForChange: async () => "## Clipboard from first"
      }
    }, { which: { assistantIndex: 0 } });

    expect(result.ok).toBe(true);
    expect(result.data?.source).toBe("clipboard");
    expect(result.data?.markdown).toBe("## Clipboard from first");
    expect(result.data?.thoughtDurationText).toBe("Thought for 1s");
    expect(result.data?.branch?.label).toBe("1/2");
    expect(result.data?.sourcesAvailable).toBe(true);
  });

  it("copyResponse DOM fallback uses the selected assistant index", async () => {
    const result = await copyResponse({
      page: contentPage(twoAssistantTurnsHtml())
    }, { prefer: "dom", which: { assistantIndex: 0 } });

    expect(result.ok).toBe(true);
    expect(result.data?.source).toBe("dom");
    expect(result.data?.markdown).toContain("## First Response");
    expect(result.data?.markdown).not.toContain("## Second Response");
    expect(result.data?.branch?.label).toBe("1/2");
  });
});

function contentPage(html: string, onClick?: () => void): PageLike {
  const locator: LocatorLike = {
    last: () => locator,
    click: async () => {
      onClick?.();
    }
  };

  return {
    content: async () => html,
    locator: () => locator,
    title: async () => "ChatGPT",
    url: () => "https://chatgpt.com/c/test"
  };
}

function askWaitFallbackPage(prompt: string, answer: string): PageLike {
  let composerText = "";
  let submitted = false;
  const textbox: LocatorLike = {
    click: async () => {},
    fill: async text => {
      composerText = text;
    },
    innerText: async () => composerText
  };
  const send: LocatorLike = {
    click: async () => {
      submitted = true;
    }
  };
  const noResponseActions: LocatorLike = {
    count: async () => 0,
    isVisible: async () => false
  };

  return {
    content: async () => chatHtml(fallbackTurns(submitted, prompt, answer)),
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
      const source = String(fn);
      const totalCount = submitted ? 4 : 2;
      const assistantCount = submitted ? 2 : 1;
      const userCount = submitted ? 2 : 1;

      if (source.includes("document.querySelectorAll(selector).length")) {
        if (arg === "assistant") return assistantCount as T;
        if (arg === "user") return userCount as T;
        return totalCount as T;
      }
      if (source.includes("roleNodes")) {
        const snapshot: { latestText?: string; turnCount: number } = { turnCount: totalCount };
        snapshot.latestText = arg === "user"
          ? submitted ? prompt : "Earlier question."
          : submitted ? answer : "Earlier answer.";
        return snapshot as T;
      }
      if (source.includes("assistantNodes") && source.includes("latestAssistantTurnIndex")) {
        return {
          turnCount: totalCount,
          assistantTurnCount: assistantCount,
          latestAssistantTurnIndex: submitted ? 4 : 2
        } as T;
      }
      if (source.includes("metadataHtml")) {
        const role = arg === "user" ? "user" : "assistant";
        const text = role === "user"
          ? submitted ? prompt : "Earlier question."
          : submitted ? answer : "Earlier answer.";
        const html = `<p>${text}</p>`;
        return { role, html, metadataHtml: html } as T;
      }
      if (source.includes("node?.innerText")) {
        return (arg === "user"
          ? submitted ? prompt : "Earlier question."
          : submitted ? answer : "Earlier answer.") as T;
      }
      if (source.includes("stop generating")) {
        return false as T;
      }
      if (source.includes("document.body?.innerText")) {
        return "New chat Chat with ChatGPT" as T;
      }

      throw new Error(`Unexpected evaluate call: ${source}`);
    },
    getByRole: (role, options) => {
      const name = String(options?.name ?? "");
      if (role === "textbox") return textbox;
      if (role === "button" && /Send prompt/.test(name)) return send;
      if (role === "button" && /Copy response/.test(name)) return noResponseActions;
      return noResponseActions;
    },
    title: async () => "ChatGPT",
    url: () => "https://chatgpt.com/c/fallback",
    waitForTimeout: async () => {}
  };
}

function fallbackTurns(submitted: boolean, prompt: string, answer: string): Array<["user" | "assistant", string]> {
  return submitted
    ? [
      ["user", "Earlier question."],
      ["assistant", "Earlier answer."],
      ["user", prompt],
      ["assistant", answer]
    ]
    : [
      ["user", "Earlier question."],
      ["assistant", "Earlier answer."]
    ];
}

function chatHtml(turns: Array<["user" | "assistant", string]>): string {
  return [
    "<main><nav>New chat</nav>",
    ...turns.map(([role, text], index) => [
      `<div data-testid="conversation-turn-${index + 1}">`,
      `<div data-message-author-role="${role}">`,
      text,
      "</div>",
      "</div>"
    ].join("")),
    "</main>"
  ].join("");
}

type WaitSnapshot = {
  totalCount: number;
  assistantCount: number;
  latestAssistantTurnIndex?: number;
  latestAssistantText: string;
  hasStopControl: boolean;
  hasResponseActions: boolean;
};

function scriptedWaitPage(snapshots: WaitSnapshot[]): PageLike {
  let index = 0;
  const current = () => snapshots[Math.min(index, snapshots.length - 1)]!;

  return {
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
      const source = String(fn);
      const snapshot = current();

      if (source.includes("stop generating")) {
        return snapshot.hasStopControl as T;
      }
      if (source.includes("latestAssistantTurnIndex")) {
        const progress: {
          latestText: string;
          turnCount: number;
          assistantTurnCount: number;
          latestAssistantTurnIndex?: number;
        } = {
          latestText: snapshot.latestAssistantText,
          turnCount: snapshot.totalCount,
          assistantTurnCount: snapshot.assistantCount
        };
        progress.latestAssistantTurnIndex = snapshot.latestAssistantTurnIndex ?? snapshot.totalCount;
        return progress as T;
      }
      if (source.includes("node?.innerText")) {
        return snapshot.latestAssistantText as T;
      }
      if (source.includes("document.querySelectorAll(selector).length")) {
        if (arg === "assistant") return snapshot.assistantCount as T;
        if (arg === "user") return (snapshot.totalCount - snapshot.assistantCount) as T;
        return snapshot.totalCount as T;
      }
      if (source.includes("document.body?.innerText")) {
        const text = snapshot.hasStopControl ? "New chat Stop generating Copy response" : "New chat Copy response";
        return text as T;
      }

      throw new Error(`Unexpected evaluate call: ${source}`);
    },
    getByRole: () => ({
      count: async () => current().hasResponseActions ? 1 : 0,
      isVisible: async () => current().hasResponseActions
    }),
    title: async () => "ChatGPT",
    url: () => "https://chatgpt.com/c/test",
    waitForTimeout: async () => {
      index += 1;
    }
  };
}

function twoAssistantTurnsHtml(): string {
  return `
    <main>
      <div data-testid="conversation-turn-1">
        <div data-message-author-role="assistant">
          <h2>First Response</h2>
          <p>First body.</p>
        </div>
        <div aria-label="Response actions">
          <button>Thought for 1s</button>
          <span>1/2</span>
          <button aria-label="First source">Sources</button>
        </div>
      </div>
      <div data-testid="conversation-turn-2">
        <div data-message-author-role="assistant">
          <h2>Second Response</h2>
          <p>Second body.</p>
        </div>
        <div aria-label="Response actions">
          <button>Thought for 2s</button>
          <span>2/2</span>
          <button aria-label="Second source">Sources</button>
        </div>
      </div>
    </main>
  `;
}
