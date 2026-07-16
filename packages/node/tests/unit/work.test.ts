import { describe, expect, it } from "vitest";
import { startWork, workStatus } from "../../src/commands/work.js";
import type { LocatorLike, PageLike } from "../../src/types.js";

describe("Work task orchestration", () => {
  it("fills the Work composer and submits a new task exactly once", async () => {
    const page = workPage();

    const result = await startWork({ page }, {
      prompt: "Build and test the polyglot release.",
      timeoutMs: 100
    });

    expect(result.ok).toBe(true);
    expect(result.data?.submitted.userTurnText).toBe("Build and test the polyglot release.");
    expect(page.sendClickCount()).toBe(1);
    expect(result.warnings.join(" ")).toContain("will not blindly resubmit");
  });

  it("blocks instead of submitting into an existing task when no new-task control is available", async () => {
    const page = workPage({ existingTurns: 2, existingAssistantTurns: 1 });

    const result = await startWork({ page }, {
      prompt: "This must not be appended accidentally.",
      timeoutMs: 100
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      code: "work_new_task_control_not_found",
      resumable: true
    });
    expect(page.sendClickCount()).toBe(0);
  });

  it("allows an explicit current-task continuation without changing the default", async () => {
    const page = workPage({ existingTurns: 2, existingAssistantTurns: 1 });

    const result = await startWork({ page }, {
      prompt: "Continue this task intentionally.",
      newTask: false,
      timeoutMs: 100
    });

    expect(result.ok).toBe(true);
    expect(result.data?.task.baselineTurnCount).toBe(2);
    expect(page.sendClickCount()).toBe(1);
  });

  it("keeps frequent Work status polling lightweight by default", async () => {
    const page = workPage({ existingTurns: 2, existingAssistantTurns: 1 });

    const result = await workStatus({ page });

    expect(result.ok).toBe(true);
    expect(result.data?.experience).toBe("work");
    expect(result.data?.artifacts).toBeUndefined();
    expect(page.artifactScanCount()).toBe(0);
  });

  it("enumerates artifacts only when Work status explicitly requests them", async () => {
    const page = workPage({ existingTurns: 2, existingAssistantTurns: 1 });

    const result = await workStatus({ page }, { includeArtifacts: true });

    expect(result.ok).toBe(true);
    expect(result.data?.artifacts).toEqual({ count: 0, artifacts: [] });
    expect(page.artifactScanCount()).toBe(1);
  });

  it("returns a resumable partial wait result without resubmitting the Work task", async () => {
    const page = workPage({ partialAssistantText: "Partial analysis" });

    const result = await startWork({ page }, {
      prompt: "Run a long analysis once.",
      wait: { timeoutMs: 5, pollMs: 1, stableMs: 100 },
      timeoutMs: 100
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("partial");
    expect(result.output_text).toBe("Partial analysis");
    expect(result.warnings.join(" ")).toContain("submitted exactly once");
    expect(page.sendClickCount()).toBe(1);
  });
});

type TestWorkPage = PageLike & {
  sendClickCount: () => number;
  artifactScanCount: () => number;
};

function workPage({
  existingTurns = 0,
  existingAssistantTurns = 0,
  partialAssistantText = ""
}: {
  existingTurns?: number;
  existingAssistantTurns?: number;
  partialAssistantText?: string;
} = {}): TestWorkPage {
  let composerText = "";
  let submittedPrompt = "";
  let sendClicks = 0;
  let artifactScans = 0;

  const empty: LocatorLike = {
    count: async () => 0,
    isVisible: async () => false
  };
  const textbox: LocatorLike = {
    click: async () => {},
    fill: async value => {
      composerText = value;
    },
    innerText: async () => composerText,
    textContent: async () => composerText
  };
  const send: LocatorLike = {
    count: async () => 1,
    isVisible: async () => true,
    evaluate: async <T>() => ({
      disabled: false,
      busy: false,
      label: "Send prompt"
    } as T),
    click: async () => {
      sendClicks += 1;
      submittedPrompt = composerText;
    }
  };

  const hasPartialAssistant = () => submittedPrompt.length > 0 && partialAssistantText.length > 0;
  const currentAssistantCount = () => existingAssistantTurns + (hasPartialAssistant() ? 1 : 0);
  const currentTurnCount = () =>
    existingTurns
    + (submittedPrompt.length > 0 ? 1 : 0)
    + (hasPartialAssistant() ? 1 : 0);

  return {
    sendClickCount: () => sendClicks,
    artifactScanCount: () => artifactScans,
    url: () => "https://chatgpt.com/work",
    title: async () => "ChatGPT Work",
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
      const source = String(fn);
      if (source.includes("composerRoots") && source.includes("mainControls")) {
        return {
          composerLabels: ["Work on anything"],
          mainControls: ["5.6 Sol Light"],
          mainText: "Work on anything"
        } as T;
      }
      if (source.includes("__combinedWaitSnapshot")) {
        return {
          turnCount: currentTurnCount(),
          assistantTurnCount: currentAssistantCount(),
          text: {
            length: hasPartialAssistant() ? partialAssistantText.length : 0,
            hash: "811c9dc5",
            transient: false
          },
          generation: {
            active: hasPartialAssistant(),
            stopped: false,
            signals: hasPartialAssistant() ? ["stop generating"] : []
          },
          hasResponseActions: false
        } as T;
      }
      if (source.includes("document.querySelectorAll(\"main img\")")) {
        artifactScans += 1;
        return [] as T;
      }
      if (source.includes("document.querySelectorAll(selector).length")) {
        if (arg === "assistant") return currentAssistantCount() as T;
        if (arg === "user") return (currentTurnCount() - currentAssistantCount()) as T;
        return currentTurnCount() as T;
      }
      if (source.includes("roleNodes")) {
        const snapshot: { latestText?: string; turnCount: number } = {
          turnCount: currentTurnCount()
        };
        if (arg === "user" && submittedPrompt.length > 0) {
          snapshot.latestText = submittedPrompt;
        } else if (arg === "assistant" && hasPartialAssistant()) {
          snapshot.latestText = partialAssistantText;
        }
        return snapshot as T;
      }
      if (source.includes("node?.innerText") && arg === "assistant") {
        return (hasPartialAssistant() ? partialAssistantText : undefined) as T;
      }
      if (source.includes("visibleButtons") && source.includes("matchingSignals")) {
        return {
          active: hasPartialAssistant(),
          stopped: false,
          signals: hasPartialAssistant() ? ["stop generating"] : []
        } as T;
      }
      if (source.includes("document.body?.innerText")) {
        return "Work on anything" as T;
      }
      throw new Error(`Unexpected evaluate call: ${source}`);
    },
    getByRole: (role, options = {}) => {
      const name = options.name;
      if (role === "textbox" && roleNameMatches(name, "Work on anything")) return textbox;
      if (role === "button" && roleNameMatches(name, "Send prompt")) return send;
      return empty;
    },
    waitForTimeout: async () => {}
  };
}

function roleNameMatches(name: unknown, expected: string): boolean {
  if (typeof name === "string") return name === expected;
  if (name instanceof RegExp) return name.test(expected);
  return false;
}
