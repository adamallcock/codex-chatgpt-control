import { describe, expect, it } from "vitest";
import { getMode, selectTool, setMode } from "../../src/commands/modes.js";
import type { LocatorLike, PageLike } from "../../src/types.js";

describe("mode and tool selection blockers", () => {
  it("treats a requested visible mode button as already selected when no opener is available", async () => {
    const page = buttonOnlyPage(["Ask anything", "Pro", "Temporary chat"]);

    const result = await setMode({ page }, { model: "Pro", timeoutMs: 0 });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Pro"],
      candidates: ["Pro"]
    });
  });

  it("does not open the current mode button when the requested mode is already selected", async () => {
    const page = selectedModePage(["Ask anything", "Pro", "Temporary chat"], ["Configure..."]);

    const result = await setMode({ page }, { model: "Pro", timeoutMs: 0 });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Pro"],
      candidates: ["Pro"]
    });
  });

  it("does not treat the Pro account/profile label as satisfying a Pro request", async () => {
    const page = buttonOnlyPage([
      "Open sidebar",
      "Search chats",
      "Projects",
      "Adam Allcock Pro, open profile menu",
      "Send prompt"
    ]);

    const result = await setMode({ page }, { model: "Pro", timeoutMs: 0 });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "visible_candidate_not_found",
      message: "No unique ChatGPT mode menu opener was found."
    });
  });

  it("does not treat Projects as a selected Pro mode", async () => {
    const page = buttonOnlyPage(["Open sidebar", "Search chats", "Projects", "Send prompt"]);

    const result = await setMode({ page }, { model: "Pro", timeoutMs: 0 });

    expect(result.ok).toBe(false);
    expect(result.blocker?.message).toBe("No unique ChatGPT mode menu opener was found.");
  });

  it("defaults to Thinking when no mode preference is provided", async () => {
    const page = menuPage(["Instant", "Thinking", "Pro"], ["Thinking"]);

    const result = await setMode({ page }, {});

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Thinking"],
      candidates: ["Instant", "Thinking", "Pro"]
    });
  });

  it("selects Pro from the live ChatGPT menuitemradio row shape", async () => {
    const page = menuPage(
      ["Instant", "Thinking • Extended", "Pro • Extended", "Configure..."],
      [],
      { "Pro • Extended": "model-switcher-gpt-5-5-pro" }
    );

    const result = await setMode({ page }, { model: "Pro" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Pro • Extended"],
      candidates: ["Instant", "Thinking • Extended", "Pro • Extended", "Configure..."]
    });
  });

  it("accepts Pro bullet Extended as a direct model alias", async () => {
    const page = menuPage(
      ["Instant", "Thinking • Extended", "Pro • Extended"],
      ["Pro • Extended"],
      { "Pro • Extended": "model-switcher-gpt-5-5-pro" }
    );

    const result = await setMode({ page }, { model: "Pro • Extended" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Pro • Extended"],
      candidates: ["Instant", "Thinking • Extended", "Pro • Extended"]
    });
  });

  it("opens the new intelligence picker from the current High button and selects Pro", async () => {
    const page = intelligencePickerPage({ current: "High" });

    const result = await setMode({ page }, { model: "Pro" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Pro"],
      candidates: ["Instant", "Medium", "High", "Extra High", "Pro", "GPT-5.5"]
    });
  });

  it("selects a nested model version from the new intelligence picker", async () => {
    const page = intelligencePickerPage({ current: "High" });

    const result = await setMode({ page }, { intelligence: "Pro", modelVersion: "5.4" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Pro", "5.4"],
      candidates: ["Instant", "Medium", "High", "Extra High", "Pro", "GPT-5.5", "5.5", "5.4", "5.3", "5.2", "4.5", "o3"]
    });
  });

  it("selects localized Pro by intelligence menu position for legacy model requests", async () => {
    const labels = ["فوری", "متوسط", "بالا", "بسیار زیاد", "حرفه‌ای"];
    const page = intelligencePickerPage({ current: "بالا", labels });

    const result = await setMode({ page }, { model: "Pro" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["حرفه‌ای"],
      candidates: ["فوری", "متوسط", "بالا", "بسیار زیاد", "حرفه‌ای", "GPT-5.5"]
    });
  });

  it("matches fullwidth compatibility-form mode labels via NFKC folding", async () => {
    const page = menuPage(["Ｐｒｏ", "Thinking"], ["Ｐｒｏ"]);

    const result = await setMode({ page }, { model: "Pro" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Ｐｒｏ"],
      candidates: ["Ｐｒｏ", "Thinking"]
    });
  });

  it("selects a localized semantic mode without relying on menu position", async () => {
    const page = menuPage(["حرفه‌ای"], ["حرفه‌ای"]);

    const result = await setMode({ page }, { model: "Pro" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["حرفه‌ای"],
      candidates: ["حرفه‌ای"]
    });
  });

  it("selects a localized high intelligence row from semantic labels", async () => {
    const page = menuPage(["متوسط", "بالا"], ["بالا"]);

    const result = await setMode({ page }, { intelligence: "high" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["بالا"],
      candidates: ["متوسط", "بالا"]
    });
  });

  it("does not select a project action row for a short Pro model request", async () => {
    const page = menuPage(["Move to project"], ["Move to project"]);

    const result = await setMode({ page }, { model: "Pro" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "visible_candidate_not_found",
      candidates: [{ label: "Move to project" }]
    });
  });

  it("rejects a visible thread action menu before attempting mode selection", async () => {
    const page = menuPage(["Share", "Rename", "Move to project"], ["Move to project"]);

    const result = await setMode({ page }, { model: "Pro" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "visible_candidate_not_found",
      message: "Visible menu appears to be a thread/action menu, not the ChatGPT mode menu.",
      candidates: [{ label: "Share" }, { label: "Rename" }, { label: "Move to project" }]
    });
  });

  it("does not select a pinned thread action whose title contains Pro", async () => {
    const page = menuPage([
      "Unpin Shortage Generation Request",
      "Pin CopyBench Pro Consultation"
    ], ["Pin CopyBench Pro Consultation"]);

    const result = await setMode({ page }, { model: "Pro" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "visible_candidate_not_found",
      message: "Visible menu appears to be a thread/action menu, not the ChatGPT mode menu.",
      candidates: [
        { label: "Unpin Shortage Generation Request" },
        { label: "Pin CopyBench Pro Consultation" }
      ]
    });
  });

  it("rejects a pinned thread action even when its title contains a full mode word", async () => {
    const page = menuPage([
      "Unpin Weekly Standup",
      "Pin Extended Warranty Notes"
    ], ["Pin Extended Warranty Notes"]);

    const result = await setMode({ page }, { effort: "Extended" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "visible_candidate_not_found",
      message: "Visible menu appears to be a thread/action menu, not the ChatGPT mode menu."
    });
  });

  it("still selects the real mode row when a pinned thread with a mode word shares the menu", async () => {
    const page = menuPage([
      "Pin CopyBench Pro Consultation",
      "Instant",
      "Thinking",
      "Pro"
    ], ["Pro"]);

    const result = await setMode({ page }, { model: "Pro" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Pro"],
      candidates: ["Pin CopyBench Pro Consultation", "Instant", "Thinking", "Pro"]
    });
  });

  it("warns when a selected mode is not reflected by visible composer controls", async () => {
    const page = menuPage(["Instant", "Thinking", "Pro"], ["Thinking"]);

    const result = await setMode({ page }, { effort: "Thinking" });

    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toContain("Mode selection is unverified");
  });

  it("does not warn when the composer reflects the selected mode", async () => {
    const page = intelligencePickerPage({ current: "High" });

    const result = await setMode({ page }, { model: "Pro" });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("reads visible mode labels without changing them", async () => {
    const page = buttonOnlyPage(["New chat", "Thinking", "Send prompt"]);

    const result = await getMode({ page });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ modes: ["Thinking"] });
    expect(result.warnings).toEqual([]);
  });

  it("reports when no mode-labelled control is visible to read", async () => {
    const page = buttonOnlyPage(["New chat", "Send prompt"]);

    const result = await getMode({ page });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ modes: [] });
    expect(result.warnings.join(" ")).toContain("could not be read");
  });

  it("does not reject a model-version-only menu as the wrong menu", async () => {
    const page = menuPage(["5.5", "5.4"], ["5.4"]);

    const result = await setMode({ page }, { version: "5.4" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["5.4"],
      candidates: ["5.5", "5.4"]
    });
  });

  it("selects nested model versions after localized intelligence selection", async () => {
    const labels = ["فوری", "متوسط", "بالا", "بسیار زیاد", "حرفه‌ای"];
    const page = intelligencePickerPage({ current: "بالا", labels });

    const result = await setMode({ page }, { intelligence: "Pro", modelVersion: "5.4" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["حرفه‌ای", "5.4"],
      candidates: ["فوری", "متوسط", "بالا", "بسیار زیاد", "حرفه‌ای", "GPT-5.5", "5.5", "5.4", "5.3", "5.2", "4.5", "o3"]
    });
  });

  it("opens nested model versions by pointer movement when the submenu row is hover-triggered", async () => {
    const page = intelligencePickerPage({ current: "High", versionSubmenuTrigger: "pointer" });

    const result = await setMode({ page }, { intelligence: "Pro", modelVersion: "5.4" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Pro", "5.4"],
      candidates: ["Instant", "Medium", "High", "Extra High", "Pro", "GPT-5.5", "5.5", "5.4", "5.3", "5.2", "4.5", "o3"]
    });
  });

  it("reopens the picker for model versions when selecting intelligence closes the menu", async () => {
    const page = intelligencePickerPage({ current: "High", closeOnIntelligenceSelection: true });

    const result = await setMode({ page }, { intelligence: "Pro", modelVersion: "5.4" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Pro", "5.4"],
      candidates: ["Instant", "Medium", "High", "Extra High", "Pro", "GPT-5.5", "5.5", "5.4", "5.3", "5.2", "4.5", "o3"]
    });
  });

  it("returns nested candidates when a requested model version is unavailable", async () => {
    const page = intelligencePickerPage({ current: "Pro" });

    const result = await setMode({ page }, { version: "6.0" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "visible_candidate_not_found",
      candidates: [
        { label: "Instant" },
        { label: "Medium" },
        { label: "High" },
        { label: "Extra High" },
        { label: "Pro" },
        { label: "GPT-5.5" },
        { label: "5.5" },
        { label: "5.4" },
        { label: "5.3" },
        { label: "5.2" },
        { label: "4.5" },
        { label: "o3" }
      ]
    });
  });

  it("does not report a model-family submenu opener as a selected model version", async () => {
    const page = intelligencePickerPage({
      current: "Pro",
      versionFamilyLabel: "GPT-5.6 Sol"
    });

    const result = await setMode({ page }, { modelVersion: "GPT-5.6 Sol" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(result.blocker?.message).toContain('Model version "GPT-5.6 Sol"');
    expect(result.blocker?.candidates).toContainEqual({ label: "5.5" });
  });

  it("selects a same-label model child without counting its parent submenu opener", async () => {
    const page = intelligencePickerPage({
      current: "Pro",
      versionFamilyLabel: "GPT-5.6 Sol",
      versionLabels: ["GPT-5.6 Sol", "5.5"]
    });

    const result = await setMode({ page }, { modelVersion: "GPT-5.6 Sol" });

    expect(result.ok).toBe(true);
    expect(result.data?.selected).toEqual(["GPT-5.6 Sol"]);
  });

  it("waits for the mode opener after a new thread render", async () => {
    const page = delayedModeOpenerPage();

    const result = await setMode({ page }, { model: "Pro", timeoutMs: 1000 });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Extended Pro"],
      candidates: ["Extended Pro"]
    });
  });

  it("ignores aria-only Pro feedback when defaulting to Thinking", async () => {
    const page = modeButtonMenuPage(
      [{ aria: "Pro feedback" }, { text: "Extended Pro" }],
      ["Instant", "Thinking • Extended", "Pro • Extended"],
      { "Thinking • Extended": "model-switcher-gpt-5-5-thinking" }
    );

    const result = await setMode({ page }, {});

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Thinking • Extended"],
      candidates: ["Instant", "Thinking • Extended", "Pro • Extended"]
    });
  });

  it("returns visible candidates when a requested mode cannot be selected", async () => {
    const page = menuPage(["Instant", "Thinking", "Pro"]);

    const result = await setMode({ page }, { effort: "Deepest" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "visible_candidate_not_found",
      resumable: false,
      candidates: [{ label: "Instant" }, { label: "Thinking" }, { label: "Pro" }]
    });
  });

  it("returns visible candidates when a requested tool cannot be selected", async () => {
    const page = menuPage(["Add photos & files", "Create image"]);

    const result = await selectTool({ page }, { tool: "deep_research" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "visible_candidate_not_found",
      resumable: false,
      candidates: [{ label: "Add photos & files" }, { label: "Create image" }]
    });
  });

  it("returns visible button candidates when the mode opener cannot be selected", async () => {
    const page = buttonOnlyPage(["Ask anything", "Search chats", "Temporary chat"]);

    const result = await setMode({ page }, { effort: "Thinking", timeoutMs: 0 });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "visible_candidate_not_found",
      resumable: false,
      candidates: [{ label: "Ask anything" }, { label: "Search chats" }, { label: "Temporary chat" }]
    });
  });
});

function menuPage(
  menuLabels: string[],
  clickableLabels: string[] = [],
  menuTestIds: Record<string, string> = {}
): PageLike {
  const opener: LocatorLike = {
    count: async () => 1,
    click: async () => {}
  };
  const missingMenuItem: LocatorLike = {
    count: async () => 0,
    click: async () => {},
    filter: () => missingMenuItem
  };
  const clickableMenuItem: LocatorLike = {
    count: async () => 1,
    click: async () => {},
    filter: () => clickableMenuItem
  };
  const testIdLocator = (selector: string): LocatorLike => {
    const matchingTestId = Object.values(menuTestIds).find(testId => selector.includes(`"${testId}"`));
    return matchingTestId !== undefined ? clickableMenuItem : missingMenuItem;
  };
  return {
    getByRole: () => opener,
    getByText: label => clickableLabels.includes(String(label)) ? clickableMenuItem : missingMenuItem,
    locator: selector => {
      const byTestId = testIdLocator(selector);
      if (byTestId === clickableMenuItem) {
        return byTestId;
      }
      return {
        ...missingMenuItem,
        filter: options => {
          const wanted = String((options as { hasText?: unknown } | undefined)?.hasText ?? "");
          return clickableLabels.includes(wanted) ? clickableMenuItem : missingMenuItem;
        }
      };
    },
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      const previousDocument = globalThis.document;
      try {
        globalThis.document = {
          querySelectorAll: (selector: string) => selector.includes("menuitem") || selector.includes("option")
            ? menuLabels.map(label => ({
              getAttribute: (name: string) => name === "data-testid" ? menuTestIds[label] : undefined,
              innerText: label,
              textContent: label
            }))
            : selector.includes("data-testid")
              ? menuLabels
                .filter(label => menuTestIds[label] !== undefined)
                .map(label => ({
                  getAttribute: (name: string) => name === "data-testid" ? menuTestIds[label] : undefined,
                  innerText: label,
                  textContent: label
                }))
            : []
        } as unknown as Document;
        return await fn(arg as A);
      } finally {
        globalThis.document = previousDocument;
      }
    },
    waitForTimeout: async () => {},
    title: async () => "ChatGPT",
    url: () => "https://chatgpt.com/"
  };
}

function delayedModeOpenerPage(): PageLike {
  let scans = 0;
  const opener: LocatorLike = {
    count: async () => scans > 1 ? 1 : 0,
    click: async () => {},
    filter: () => opener
  };
  return {
    getByRole: (_role, options) => {
      const name = String((options as { name?: unknown } | undefined)?.name ?? "");
      return name === "Extended Pro" ? opener : { ...opener, count: async () => 0 };
    },
    getByText: () => ({ ...opener, count: async () => 0 }),
    locator: selector => ({
      ...opener,
      filter: options => {
        const wanted = String((options as { hasText?: unknown } | undefined)?.hasText ?? "");
        return selector === "button, [role='button']" && wanted === "Extended Pro" ? opener : { ...opener, count: async () => 0 };
      }
    }),
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      scans += 1;
      const previousDocument = globalThis.document;
      try {
        globalThis.document = {
          querySelectorAll: (selector: string) => selector === "button, [role='button']" && scans > 1
            ? [{ getAttribute: () => undefined, innerText: "Extended Pro", textContent: "Extended Pro" }]
            : []
        } as unknown as Document;
        return await fn(arg as A);
      } finally {
        globalThis.document = previousDocument;
      }
    },
    waitForTimeout: async () => {},
    title: async () => "ChatGPT",
    url: () => "https://chatgpt.com/"
  };
}

function modeButtonMenuPage(
  buttons: Array<{ text?: string; aria?: string; testid?: string }>,
  menuLabels: string[],
  menuTestIds: Record<string, string> = {}
): PageLike {
  let opened = false;
  const missing: LocatorLike = {
    count: async () => 0,
    click: async () => {},
    filter: () => missing
  };
  const opener: LocatorLike = {
    count: async () => 1,
    click: async () => {
      opened = true;
    },
    filter: () => opener
  };
  const clickable: LocatorLike = {
    count: async () => 1,
    click: async () => {},
    filter: () => clickable
  };
  return {
    getByRole: (_role, options) => {
      const name = String((options as { name?: unknown } | undefined)?.name ?? "");
      return buttons.some(button => (button.text ?? button.aria ?? "") === name) ? opener : missing;
    },
    getByText: label => menuLabels.includes(String(label)) ? clickable : missing,
    locator: selector => {
      const matchingTestId = Object.values(menuTestIds).find(testId => selector.includes(`"${testId}"`));
      if (matchingTestId !== undefined) return clickable;
      return {
        ...missing,
        filter: options => {
          const wanted = String((options as { hasText?: unknown } | undefined)?.hasText ?? "");
          return selector === "button, [role='button']" && buttons.some(button => (button.text ?? "").includes(wanted)) ? opener : missing;
        }
      };
    },
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      const previousDocument = globalThis.document;
      try {
        globalThis.document = {
          querySelectorAll: (selector: string) => {
            if (selector === "button, [role='button']") {
              return buttons.map(button => ({
                getAttribute: (name: string) => name === "aria-label" ? button.aria : name === "data-testid" ? button.testid : undefined,
                innerText: button.text,
                textContent: button.text
              }));
            }
            if (opened && (selector.includes("menuitem") || selector.includes("option") || selector.includes("data-testid"))) {
              return menuLabels.map(label => ({
                getAttribute: (name: string) => name === "data-testid" ? menuTestIds[label] : undefined,
                innerText: label,
                textContent: label
              }));
            }
            return [];
          }
        } as unknown as Document;
        return await fn(arg as A);
      } finally {
        globalThis.document = previousDocument;
      }
    },
    waitForTimeout: async () => {},
    title: async () => "ChatGPT",
    url: () => "https://chatgpt.com/"
  };
}

function buttonOnlyPage(buttonLabels: string[]): PageLike {
  const missingButton: LocatorLike = {
    count: async () => 0,
    click: async () => {},
    filter: () => missingButton
  };
  return {
    getByRole: () => missingButton,
    locator: () => missingButton,
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      const previousDocument = globalThis.document;
      try {
        globalThis.document = {
          querySelectorAll: (selector: string) => selector === "button, [role='button']"
            ? buttonLabels.map(label => ({ getAttribute: () => undefined, innerText: label, textContent: label }))
            : []
        } as unknown as Document;
        return await fn(arg as A);
      } finally {
        globalThis.document = previousDocument;
      }
    },
    waitForTimeout: async () => {},
    title: async () => "ChatGPT",
    url: () => "https://chatgpt.com/"
  };
}

function selectedModePage(buttonLabels: string[], menuLabels: string[]): PageLike {
  let opened = false;
  const opener: LocatorLike = {
    count: async () => 1,
    click: async () => {
      opened = true;
    },
    filter: () => opener
  };
  const missing: LocatorLike = {
    count: async () => 0,
    click: async () => {},
    filter: () => missing
  };
  return {
    getByRole: (_role, options) => {
      const name = String((options as { name?: unknown } | undefined)?.name ?? "");
      return buttonLabels.includes(name) ? opener : missing;
    },
    getByText: () => missing,
    locator: selector => ({
      ...missing,
      filter: options => {
        const wanted = String((options as { hasText?: unknown } | undefined)?.hasText ?? "");
        return selector === "button, [role='button']" && buttonLabels.some(label => label.includes(wanted)) ? opener : missing;
      }
    }),
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      try {
        globalThis.document = {
          querySelectorAll: (selector: string) => {
            if (selector === "button, [role='button']") {
              return buttonLabels.map(label => ({ getAttribute: () => undefined, innerText: label, textContent: label }));
            }
            if (opened && (selector.includes("menuitem") || selector.includes("option"))) {
              return menuLabels.map(label => ({ innerText: label, textContent: label }));
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
    },
    waitForTimeout: async () => {},
    title: async () => "ChatGPT",
    url: () => "https://chatgpt.com/"
  };
}

type FakeMenuItem = {
  label: string;
  role: "menuitem" | "menuitemradio";
  checked?: boolean;
  hasPopup?: boolean;
  rect?: { left: number; top: number; width: number; height: number };
};

function intelligencePickerPage({
  current,
  labels = ["Instant", "Medium", "High", "Extra High", "Pro"],
  closeOnIntelligenceSelection = false,
  versionSubmenuTrigger = "click",
  versionFamilyLabel = "GPT-5.5",
  versionLabels = ["5.5", "5.4", "5.3", "5.2", "4.5", "o3"]
}: {
  current: string;
  labels?: string[];
  closeOnIntelligenceSelection?: boolean;
  versionSubmenuTrigger?: "click" | "pointer";
  versionFamilyLabel?: string;
  versionLabels?: string[];
}): PageLike {
  let currentLabel = current;
  let mainOpen = false;
  let modelSubmenuOpen = false;
  const gptRowRect = { left: 80, top: 220, width: 120, height: 36 };
  const mainItems: FakeMenuItem[] = [
    { label: labels[0] ?? "Instant", role: "menuitemradio", checked: current === (labels[0] ?? "Instant") },
    { label: labels[1] ?? "Medium", role: "menuitemradio", checked: current === (labels[1] ?? "Medium") },
    { label: labels[2] ?? "High", role: "menuitemradio", checked: current === (labels[2] ?? "High") },
    { label: labels[3] ?? "Extra High", role: "menuitemradio", checked: current === (labels[3] ?? "Extra High") },
    { label: labels[4] ?? "Pro", role: "menuitemradio", checked: current === (labels[4] ?? "Pro") },
    { label: versionFamilyLabel, role: "menuitem", hasPopup: true, rect: gptRowRect }
  ];
  const versionItems: FakeMenuItem[] = versionLabels.map((label, index) => ({
    label,
    role: "menuitemradio",
    checked: index === 0
  }));
  const missing: LocatorLike = {
    count: async () => 0,
    click: async () => {},
    filter: () => missing
  };
  const opener: LocatorLike = {
    count: async () => 1,
    click: async () => {
      mainOpen = true;
    },
    filter: () => opener
  };
  const locatorForItem = (label: string, role?: string): LocatorLike => {
    const item = [...mainItems, ...versionItems].find(candidate =>
      candidate.label === label
      && (role === undefined || candidate.role === role)
    );
    if (item === undefined || (!mainOpen && mainItems.includes(item)) || (!modelSubmenuOpen && versionItems.includes(item))) {
      return missing;
    }
    return {
      count: async () => 1,
      click: async () => {
        if (item.label === versionFamilyLabel && versionSubmenuTrigger === "click") {
          modelSubmenuOpen = true;
        } else if (mainItems.includes(item) && item.role === "menuitemradio") {
          currentLabel = item.label;
          if (closeOnIntelligenceSelection) {
            mainOpen = false;
            modelSubmenuOpen = false;
          }
        }
      },
      filter: () => locatorForItem(label, role)
    };
  };

  return {
    getByRole: (role, options) => {
      const name = String((options as { name?: unknown } | undefined)?.name ?? "");
      return role === "button" && name === currentLabel ? opener : locatorForItem(name, role);
    },
    getByText: label => locatorForItem(String(label)),
    locator: selector => ({
      ...missing,
      filter: options => {
        const wanted = String((options as { hasText?: unknown } | undefined)?.hasText ?? "");
        if (selector === "button, [role='button']" && wanted === currentLabel) {
          return opener;
        }
        return locatorForItem(wanted);
      }
    }),
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      try {
        globalThis.document = {
          querySelectorAll: (selector: string) => {
            if (selector === "button, [role='button']") {
              return [fakeElement({ label: currentLabel })];
            }
            if (selector.includes("menuitem") || selector.includes("option")) {
              if (!mainOpen) return [];
              return [
                ...mainItems.map(item => fakeElement(item)),
                ...(modelSubmenuOpen ? versionItems.map(item => fakeElement(item)) : [])
              ];
            }
            if (selector.includes("data-testid")) {
              return [];
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
    },
    cua: {
      move: async ({ x, y }) => {
        const centerX = gptRowRect.left + gptRowRect.width / 2;
        const centerY = gptRowRect.top + gptRowRect.height / 2;
        if (versionSubmenuTrigger === "pointer" && Math.abs(x - centerX) <= 1 && Math.abs(y - centerY) <= 1) {
          modelSubmenuOpen = true;
        }
      }
    },
    waitForTimeout: async () => {},
    title: async () => "ChatGPT",
    url: () => "https://chatgpt.com/"
  };
}

function fakeElement(item: Partial<FakeMenuItem> & { label: string }): Element {
  return {
    getAttribute: (name: string) => {
      if (name === "role") return item.role;
      if (name === "aria-checked" && item.checked !== undefined) return item.checked ? "true" : "false";
      if (name === "aria-haspopup" && item.hasPopup === true) return "menu";
      if (name === "aria-expanded" && item.hasPopup === true) return "false";
      return undefined;
    },
    getBoundingClientRect: () => ({
      left: item.rect?.left ?? 0,
      top: item.rect?.top ?? 0,
      width: item.rect?.width ?? 0,
      height: item.rect?.height ?? 0,
      right: (item.rect?.left ?? 0) + (item.rect?.width ?? 0),
      bottom: (item.rect?.top ?? 0) + (item.rect?.height ?? 0),
      x: item.rect?.left ?? 0,
      y: item.rect?.top ?? 0,
      toJSON: () => ({})
    }),
    innerText: item.label,
    textContent: item.label
  } as unknown as Element;
}
