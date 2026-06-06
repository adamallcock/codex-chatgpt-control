import { describe, expect, it } from "vitest";
import { requireConfirmation } from "../../src/commands/confirmations.js";
import { createMemoryLogger } from "../../src/logger.js";
import { classifyVisibleText } from "../../src/safety/blockers.js";
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
