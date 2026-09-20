import { describe, it, expect } from "vitest";
import { composerTextbox } from "../../src/dom/selectors.js";
import { labelOrPrefixPattern, localeLabels } from "../../src/dom/locale-labels.js";
import { classifyVisibleText } from "../../src/safety/blockers.js";
import { composeMessage } from "../../src/commands/messages.js";
import type { LocatorLike, PageLike } from "../../src/types.js";

/** Captures the accessible-name pattern `composerTextbox` hands to `getByRole`. */
function composerNamePattern(): RegExp {
  let name: unknown;
  const locator: LocatorLike = { count: async () => 1 };
  composerTextbox({
    getByRole: (_role: string, options?: Record<string, unknown>) => {
      name = options?.name;
      return locator;
    }
  } as PageLike);

  expect(name).toBeInstanceOf(RegExp);
  return name as RegExp;
}

function composerPage(textbox: LocatorLike): PageLike {
  return {
    getByRole: () => textbox,
    url: () => "https://chatgpt.com/g/g-p-test/project",
    content: async () => "<main></main>",
    // Keeps the settle poll from sleeping in real time.
    waitForTimeout: async () => {}
  };
}

describe("project composer selection", () => {
  it("matches a project composer whose accessible name carries the project name", () => {
    const pattern = composerNamePattern();

    expect(pattern.test("New chat in Synthetic Project")).toBe(true);
    expect(pattern.test("New chat in 合成项目")).toBe(true);
  });

  it("still matches the plain Chat and Work composers", () => {
    const pattern = composerNamePattern();

    expect(pattern.test("Ask ChatGPT")).toBe(true);
    expect(pattern.test("Work on anything")).toBe(true);
    expect(pattern.test("Mit ChatGPT chatten")).toBe(true);
  });

  it("does not match unrelated textboxes", () => {
    const pattern = composerNamePattern();

    expect(pattern.test("Search chats")).toBe(false);
    expect(pattern.test("Search projects")).toBe(false);
    // A bare prefix with no project name is not a project composer.
    expect(pattern.test("New chat in")).toBe(false);
    // The prefix is start-anchored, so it cannot match mid-name.
    expect(pattern.test("Move to New chat in Synthetic Project")).toBe(false);
  });

  it("drives the prefix from the locale registry rather than a hardcoded literal", () => {
    expect(localeLabels.projectComposerPrefixes).toContain("New chat in");

    // A locale contributing its own observed prefix is matched by the same mechanism.
    const localized = labelOrPrefixPattern(["Ask ChatGPT"], ["Neuer Chat in"]);
    expect(localized.test("Neuer Chat in Projekt Alpha")).toBe(true);
    expect(localized.test("Neuer Chat")).toBe(false);
  });
});

describe("visible-text not-found classification", () => {
  it("treats a standalone 404 as a missing page", () => {
    expect(classifyVisibleText("404 Not Found")?.kind).toBe("not_found");
    expect(classifyVisibleText("Page not found")?.kind).toBe("not_found");
  });

  it("does not treat digits inside longer tokens as a missing page", () => {
    expect(classifyVisibleText("Review GSE240401 JSON")).toBeUndefined();
    expect(classifyVisibleText("Order #1404 shipped")).toBeUndefined();
    expect(classifyVisibleText("error404page")).toBeUndefined();
  });
});

describe("composer fill verification", () => {
  it("fails closed when the fill never lands in the composer", async () => {
    const textbox: LocatorLike = {
      count: async () => 1,
      click: async () => {},
      fill: async () => {},
      innerText: async () => ""
    };

    const result = await composeMessage({ page: composerPage(textbox) }, { text: "synthetic prompt" });

    expect(result.ok).toBe(false);
    expect(result.error?.name).toBe("ComposerVerificationError");
  });

  it("accepts a fill the editor only reflects after a tick", async () => {
    let pending = "";
    let reads = 0;
    const textbox: LocatorLike = {
      count: async () => 1,
      click: async () => {},
      fill: async text => {
        pending = text;
      },
      // Mimics an editor that has not reconciled its DOM when fill() resolves.
      innerText: async () => {
        reads += 1;
        return reads > 2 ? pending : "";
      }
    };

    const result = await composeMessage({ page: composerPage(textbox) }, { text: "synthetic prompt" });

    expect(result.ok).toBe(true);
    expect(result.data?.text).toBe("synthetic prompt");
  });

  it("reads a textarea composer through its value rather than its text", async () => {
    let value = "";
    const textbox: LocatorLike = {
      count: async () => 1,
      click: async () => {},
      fill: async text => {
        value = text;
      },
      // A <textarea> keeps its text in value; innerText stays empty.
      innerText: async () => "",
      inputValue: async () => value
    };

    const result = await composeMessage({ page: composerPage(textbox) }, { text: "synthetic prompt" });

    expect(result.ok).toBe(true);
    expect(result.data?.text).toBe("synthetic prompt");
  });
});
