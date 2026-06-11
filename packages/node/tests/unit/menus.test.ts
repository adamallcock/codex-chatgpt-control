import { describe, expect, it } from "vitest";
import { extractMenuItemsFromText, findUniqueMenuItem } from "../../src/dom/menus.js";

describe("menu helpers", () => {
  it("normalizes bullet-separated menu labels", () => {
    expect(extractMenuItemsFromText("Latest • Instant • Extended").map(item => item.normalized)).toEqual([
      "latest",
      "instant",
      "extended"
    ]);
  });

  it("returns a unique fuzzy match", () => {
    const items = extractMenuItemsFromText("Web search\nDeep research\nCreate image");
    expect(findUniqueMenuItem(items, "deep")?.label).toBe("Deep research");
  });

  it("does not match short labels inside unrelated words", () => {
    const items = extractMenuItemsFromText("Share\nRename\nMove to project");

    expect(findUniqueMenuItem(items, "Pro")).toBeUndefined();
  });

  it("still matches short mode labels as visible label tokens", () => {
    const items = extractMenuItemsFromText("Instant\nMedium\nHigh\nExtra High\nPro Extended");

    expect(findUniqueMenuItem(items, "Pro")?.label).toBe("Pro Extended");
  });
});
