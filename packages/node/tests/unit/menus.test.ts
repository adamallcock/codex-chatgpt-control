import { describe, expect, it } from "vitest";
import { visibleLabelMatches } from "../../src/dom/label-match.js";
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

  it("does not let short Pro matching select project menu rows", () => {
    const items = extractMenuItemsFromText("Move to project");
    expect(findUniqueMenuItem(items, "Pro")).toBeUndefined();
  });

  it("matches short labels only on token boundaries", () => {
    expect(visibleLabelMatches("Pro", "Pro")).toBe(true);
    expect(visibleLabelMatches("Pro Extended", "Pro")).toBe(true);
    expect(visibleLabelMatches("Move to project", "Pro")).toBe(false);
    expect(visibleLabelMatches("Projects", "Pro")).toBe(false);
  });

  it("matches CJK labels by exact alias or meaningful substring only", () => {
    expect(visibleLabelMatches("专业", "专业")).toBe(true);
    expect(visibleLabelMatches("专业模式", "专业")).toBe(true);
    expect(visibleLabelMatches("项目", "专业")).toBe(false);
  });
});
