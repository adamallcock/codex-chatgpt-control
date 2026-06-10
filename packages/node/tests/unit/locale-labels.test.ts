import { describe, expect, it } from "vitest";
import { localeLabels } from "../../src/dom/locale-labels.js";
import { en } from "../../src/dom/locale/en.js";
import type { LocaleStrings } from "../../src/dom/locale/types.js";

const norm = (value: string | readonly string[]): string[] =>
  typeof value === "string" ? [value] : [...value];

/**
 * Regression guard (locale-count-agnostic): English is canonical and must stay PRESENT and
 * FIRST in every combined candidate list, regardless of how many locales are registered.
 * Driven from `en.ts` directly so it can never drift from the canonical source.
 */
describe("localeLabels — English canonical preserved", () => {
  const nonToolKeys = (Object.keys(en) as Array<keyof LocaleStrings>)
    .filter((key): key is Exclude<keyof LocaleStrings, "tools"> => key !== "tools");

  for (const key of nonToolKeys) {
    it(`${key} begins with the English values`, () => {
      const expected = norm(en[key]);
      expect(localeLabels[key].slice(0, expected.length)).toEqual(expected);
    });
  }

  for (const id of ["web_search", "deep_research", "create_image"] as const) {
    it(`tools.${id} begins with the English values`, () => {
      const expected = norm(en.tools[id]);
      const actual = localeLabels.tools[id] ?? [];
      expect(actual.slice(0, expected.length)).toEqual(expected);
    });
  }

  it("contains no duplicate candidates in any list", () => {
    const lists = [
      ...nonToolKeys.map(key => localeLabels[key]),
      ...Object.values(localeLabels.tools)
    ];
    for (const list of lists) {
      expect(new Set(list).size, list.join("|")).toBe(list.length);
    }
  });
});

describe("en locale — completeness", () => {
  /**
   * Prove that `en` provides every key defined by `LocaleStrings`. The `satisfies`
   * constraint in en.ts already enforces this at compile time; this test makes it
   * visible in the test report as well.
   */
  const requiredTopLevelKeys: Array<Exclude<keyof LocaleStrings, "tools">> = [
    "composerTextbox",
    "sendButton",
    "searchChatsButton",
    "searchChatsPlaceholder",
    "newChat",
    "addFilesButton",
    "addFilesOpenerCandidates",
    "addPhotosFilesMenuItem",
    "copyResponse",
    "download",
    "downloadImage",
    "imageContainerHint",
    "modeLabels",
    "modeOpenerExtra",
    "signedInMarkers",
    "transientAssistant",
    "stopControl",
    "responseActions",
    "loginBlocker",
    "captchaBlocker",
    "rateLimitBlocker",
  ];

  const requiredToolIds = ["web_search", "deep_research", "create_image"] as const;

  it("has every required top-level key", () => {
    for (const key of requiredTopLevelKeys) {
      expect(Object.prototype.hasOwnProperty.call(en, key), `en.${key} is present`).toBe(true);
    }
  });

  it("has the tools key", () => {
    expect(Object.prototype.hasOwnProperty.call(en, "tools")).toBe(true);
  });

  it("has every required tool id", () => {
    for (const id of requiredToolIds) {
      expect(Object.prototype.hasOwnProperty.call(en.tools, id), `en.tools.${id} is present`).toBe(true);
    }
  });
});
