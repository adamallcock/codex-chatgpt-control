import { describe, expect, it } from "vitest";
import { selectTool, setMode } from "../../src/commands/modes.js";
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

  it("selects the combined Pro extended row for Japanese Pro review mode", async () => {
    const page = menuPage(
      ["Instant", "Thinking", "Pro・拡張", "標準", "拡張"],
      ["Pro・拡張"],
      { "Pro・拡張": "model-switcher-gpt-5-5-pro" }
    );

    const result = await setMode({ page }, { model: "Pro", effort: "拡張" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Pro・拡張"],
      candidates: ["Instant", "Thinking", "Pro・拡張", "標準", "拡張"]
    });
  });

  it("does not confuse Japanese prompt/project/profile labels with Pro mode", async () => {
    const page = modeButtonMenuPage(
      [
        { aria: "プロンプトを送信する", testid: "send-button" },
        { text: "プロジェクト" },
        { text: "赤津元武 Pro", aria: "赤津元武 Proさんのプロファイルメニューを開く", testid: "accounts-profile-button" },
        { text: "Thinking" }
      ],
      ["Instant", "Thinking", "Pro・拡張", "標準", "拡張"],
      { "Pro・拡張": "model-switcher-gpt-5-5-pro" }
    );

    const result = await setMode({ page }, { model: "Pro", effort: "拡張" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["Pro・拡張"],
      candidates: ["Instant", "Thinking", "Pro・拡張", "標準", "拡張"]
    });
  });

  it("accepts the Japanese selected label shown after choosing Pro extended", async () => {
    const page = selectedModePage(["じっくり思考 Pro"], ["Instant", "Thinking", "Pro • 拡張"]);

    const result = await setMode({ page }, { model: "Pro", effort: "拡張", timeoutMs: 0 });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["じっくり思考 Pro"],
      candidates: ["じっくり思考 Pro"]
    });
  });

  it("refreshes menu candidates after selecting a Pro row with an effort submenu", async () => {
    const page = proSubmenuModePage();

    const result = await setMode({ page }, { model: "Pro", effort: "拡張", timeoutMs: 1000 });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      selected: ["じっくり思考 Pro"],
      candidates: ["Instant", "Thinking", "Pro", "設定する...", "標準", "拡張"]
    });
  });

  it("blocks when a clicked mode does not become the visible selected mode", async () => {
    const page = nonReflectingModeMenuPage(["Instant", "Thinking", "Pro"], ["Pro"]);

    const result = await setMode({ page }, { model: "Pro", timeoutMs: 1000 });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "visible_candidate_not_found",
      message: "Requested ChatGPT mode was clicked, but the final selected mode could not be verified."
    });
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
  const selectedLabels = new Set<string>();
  const opener: LocatorLike = {
    count: async () => 1,
    click: async () => {}
  };
  const missingMenuItem: LocatorLike = {
    count: async () => 0,
    click: async () => {},
    filter: () => missingMenuItem
  };
  const clickableMenuItem = (label: string): LocatorLike => ({
    count: async () => 1,
    click: async () => {
      selectedLabels.add(label);
    },
    filter: () => clickableMenuItem(label)
  });
  const testIdLocator = (selector: string): LocatorLike => {
    const matchingLabel = Object.entries(menuTestIds).find(([, testId]) => selector.includes(`"${testId}"`))?.[0];
    return matchingLabel !== undefined ? clickableMenuItem(matchingLabel) : missingMenuItem;
  };
  return {
    getByRole: () => opener,
    getByText: label => clickableLabels.includes(String(label)) ? clickableMenuItem(String(label)) : missingMenuItem,
    locator: selector => {
      const byTestId = testIdLocator(selector);
      if (byTestId !== missingMenuItem) {
        return byTestId;
      }
      return {
        ...missingMenuItem,
        filter: options => {
          const wanted = String((options as { hasText?: unknown } | undefined)?.hasText ?? "");
          return clickableLabels.includes(wanted) ? clickableMenuItem(wanted) : missingMenuItem;
        }
      };
    },
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      const previousDocument = globalThis.document;
      try {
        globalThis.document = {
          querySelectorAll: (selector: string) => selector === "button, [role='button']"
            ? Array.from(selectedLabels).map(label => ({ getAttribute: () => undefined, innerText: label, textContent: label }))
            : selector.includes("menuitem") || selector.includes("option")
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

function nonReflectingModeMenuPage(menuLabels: string[], clickableLabels: string[]): PageLike {
  const opener: LocatorLike = {
    count: async () => 1,
    click: async () => {},
    filter: () => opener
  };
  const missing: LocatorLike = {
    count: async () => 0,
    click: async () => {},
    filter: () => missing
  };
  const clickable: LocatorLike = {
    count: async () => 1,
    click: async () => {},
    filter: () => clickable
  };
  return {
    getByRole: () => opener,
    getByText: label => clickableLabels.includes(String(label)) ? clickable : missing,
    locator: selector => ({
      ...missing,
      filter: options => {
        const wanted = String((options as { hasText?: unknown } | undefined)?.hasText ?? "");
        return selector !== "button, [role='button']" && clickableLabels.includes(wanted) ? clickable : missing;
      }
    }),
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      const previousDocument = globalThis.document;
      try {
        globalThis.document = {
          querySelectorAll: (selector: string) => selector.includes("menuitem") || selector.includes("option")
            ? menuLabels.map(label => ({ getAttribute: () => undefined, innerText: label, textContent: label }))
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

function proSubmenuModePage(): PageLike {
  let submenuOpen = false;
  const selectedLabels = new Set<string>();
  const opener: LocatorLike = {
    count: async () => 1,
    click: async () => {},
    filter: () => opener
  };
  const missing: LocatorLike = {
    count: async () => 0,
    click: async () => {},
    filter: () => missing
  };
  const clickable = (label: string): LocatorLike => ({
    count: async () => 1,
    click: async () => {
      if (label === "Pro") {
        submenuOpen = true;
      }
      if (label === "拡張") {
        selectedLabels.add("じっくり思考 Pro");
      }
    },
    filter: () => clickable(label)
  });
  const visibleMenuLabels = () => submenuOpen
    ? ["Instant", "Thinking", "Pro", "設定する...", "標準", "拡張"]
    : ["Instant", "Thinking", "Pro", "設定する..."];
  return {
    getByRole: () => opener,
    getByText: label => visibleMenuLabels().includes(String(label)) ? clickable(String(label)) : missing,
    locator: () => ({
      ...missing,
      filter: options => {
        const wanted = String((options as { hasText?: unknown } | undefined)?.hasText ?? "");
        return visibleMenuLabels().includes(wanted) ? clickable(wanted) : missing;
      }
    }),
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      const previousDocument = globalThis.document;
      try {
        globalThis.document = {
          querySelectorAll: (selector: string) => {
            if (selector === "button, [role='button']") {
              return Array.from(selectedLabels).map(label => ({ getAttribute: () => undefined, innerText: label, textContent: label }));
            }
            if (selector.includes("menuitem") || selector.includes("option")) {
              return visibleMenuLabels().map(label => ({ getAttribute: () => undefined, innerText: label, textContent: label }));
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

function modeButtonMenuPage(
  buttons: Array<{ text?: string; aria?: string; testid?: string }>,
  menuLabels: string[],
  menuTestIds: Record<string, string> = {}
): PageLike {
  let opened = false;
  const selectedLabels = new Set<string>();
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
  const clickable = (label: string): LocatorLike => ({
    count: async () => 1,
    click: async () => {
      selectedLabels.add(label);
    },
    filter: () => clickable(label)
  });
  return {
    getByRole: (_role, options) => {
      const name = String((options as { name?: unknown } | undefined)?.name ?? "");
      return buttons.some(button => (button.text ?? button.aria ?? "") === name) ? opener : missing;
    },
    getByText: label => menuLabels.includes(String(label)) ? clickable(String(label)) : missing,
    locator: selector => {
      const matchingLabel = Object.entries(menuTestIds).find(([, testId]) => selector.includes(`"${testId}"`))?.[0];
      if (matchingLabel !== undefined) return clickable(matchingLabel);
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
              return [
                ...buttons.map(button => ({
                getAttribute: (name: string) => name === "aria-label" ? button.aria : name === "data-testid" ? button.testid : undefined,
                innerText: button.text,
                textContent: button.text
                })),
                ...Array.from(selectedLabels).map(label => ({ getAttribute: () => undefined, innerText: label, textContent: label }))
              ];
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
