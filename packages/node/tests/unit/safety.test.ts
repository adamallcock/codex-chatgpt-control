import { describe, expect, it } from "vitest";
import { requireConfirmation } from "../../src/commands/confirmations.js";
import { createMemoryLogger } from "../../src/logger.js";
import { classifyVisibleText } from "../../src/safety/blockers.js";
import { readPageState } from "../../src/browser/page-state.js";
import { redactSensitiveText } from "../../src/safety/redaction.js";
import { isHighRiskCommand, riskForCommand } from "../../src/safety/risk.js";

describe("classifyVisibleText", () => {
  it("detects login required", () => {
    expect(classifyVisibleText("Welcome back Log in Sign up")?.kind).toBe("login_required");
  });

  it("detects rate limits", () => {
    expect(classifyVisibleText("You've reached your usage limit. Try again later.")?.kind).toBe("rate_limit");
  });

  it("detects upload failures", () => {
    expect(classifyVisibleText("Upload failed. This file is too large.")?.kind).toBe("upload_failed");
  });

  it("returns undefined for ordinary chat text", () => {
    expect(classifyVisibleText("New chat Search chats Chat with ChatGPT")).toBeUndefined();
  });
});

describe("readPageState blocker scoping", () => {
  it("does not treat a fallback warning quoted in a user message as a system blocker", async () => {
    let evaluations = 0;
    const state = await readPageState({
      url: () => "https://chatgpt.com/c/review",
      title: async () => "Review",
      evaluate: async <T>(): Promise<T> => {
        evaluations += 1;
        return (evaluations === 1
          ? "New chat Search chats Responses will use a smaller model."
          : { text: "", hasConversationMessages: true }) as T;
      }
    });

    expect(state.blocker).toBeUndefined();
  });

  it("still detects the same warning in a system banner", async () => {
    let evaluations = 0;
    const state = await readPageState({
      url: () => "https://chatgpt.com/c/review",
      title: async () => "Review",
      evaluate: async <T>(): Promise<T> => {
        evaluations += 1;
        return (evaluations === 1
          ? "New chat Search chats Responses will use a smaller model."
          : { text: "Responses will use a smaller model.", hasConversationMessages: true }) as T;
      }
    });

    expect(state.blocker?.kind).toBe("model_fallback");
  });
});

describe("risk and confirmation guards", () => {
  it("marks destructive commands as high risk", () => {
    expect(riskForCommand("threads.delete")).toBe("high");
    expect(isHighRiskCommand("threads.delete")).toBe(true);
  });

  it("requires exact confirmation metadata", () => {
    const result = requireConfirmation(undefined, {
      targetKind: "thread",
      targetDisplayName: "Naming macOS Utility",
      action: "delete"
    });
    expect(result?.status).toBe("needs_confirmation");
  });
});

describe("logger redaction", () => {
  it("redacts sensitive strings before storing events", () => {
    const logger = createMemoryLogger();
    logger.log({
      level: "info",
      event: "test",
      message: "Email adam@example.com token abcdefghijklmnopqrstuvwxyzABCDEFG1234567890",
      timestamp: "t"
    });

    expect(logger.events[0]?.message).toContain("[redacted-email]");
    expect(logger.events[0]?.message).toContain("[redacted-token]");
  });
});

describe("redactSensitiveText", () => {
  it("redacts emails, token-like strings, and user paths", () => {
    const redacted = redactSensitiveText(
      "adam@example.com /example/user/Desktop/file.txt abcdefghijklmnopqrstuvwxyzABCDEFG1234567890"
    );

    expect(redacted).toContain("[redacted-email]");
    expect(redacted).toContain("[redacted-path]");
    expect(redacted).toContain("[redacted-token]");
  });
});
