import { describe, expect, it } from "vitest";
import { localeCoverageSummary, localeLabels } from "../../src/dom/locale/index.js";
import { en } from "../../src/dom/locale/en.js";
import type { LocaleStrings, ModeOptionId } from "../../src/dom/locale/types.js";

const norm = (value: string | readonly string[]): string[] =>
  typeof value === "string" ? [value] : [...value];

/**
 * Regression guard (locale-count-agnostic): English is canonical and must stay PRESENT and
 * FIRST in every combined candidate list, regardless of how many locales are registered.
 * Driven from `en.ts` directly so it can never drift from the canonical source.
 */
describe("localeLabels — English canonical preserved", () => {
  const nonToolKeys = (Object.keys(en) as Array<keyof LocaleStrings>)
    .filter((key): key is Exclude<
      keyof LocaleStrings,
      "tools" | "modeOptions" | "experienceOptions" | "configurationAxes" | "configurationOptions"
    > =>
      key !== "tools"
      && key !== "modeOptions"
      && key !== "experienceOptions"
      && key !== "configurationAxes"
      && key !== "configurationOptions"
    );

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

  for (const id of [
    "latest",
    "instant",
    "thinking",
    "extended",
    "medium",
    "high",
    "extraHigh",
    "pro",
  ] as const satisfies readonly ModeOptionId[]) {
    it(`modeOptions.${id} begins with the English values`, () => {
      const expected = norm(en.modeOptions[id]);
      const actual = localeLabels.modeOptions[id] ?? [];
      expect(actual.slice(0, expected.length)).toEqual(expected);
    });
  }

  for (const [group, values] of [
    ["experienceOptions", en.experienceOptions],
    ["configurationAxes", en.configurationAxes],
    ["configurationOptions", en.configurationOptions],
  ] as const) {
    for (const [id, english] of Object.entries(values)) {
      it(`${group}.${id} begins with the English values`, () => {
        const expected = norm(english);
        const actual = localeLabels[group][id as never] as string[];
        expect(actual.slice(0, expected.length)).toEqual(expected);
      });
    }
  }

  it("contains no duplicate candidates in any list", () => {
    const lists = [
      ...nonToolKeys.map(key => localeLabels[key]),
      ...Object.values(localeLabels.tools),
      ...Object.values(localeLabels.modeOptions),
      ...Object.values(localeLabels.experienceOptions),
      ...Object.values(localeLabels.configurationAxes),
      ...Object.values(localeLabels.configurationOptions)
    ];
    for (const list of lists) {
      expect(new Set(list).size, list.join("|")).toBe(list.length);
    }
  });

  it("includes observed localized Intelligence picker labels", () => {
    expect(localeLabels.modeLabels).toEqual(expect.arrayContaining([
      "Sofort",
      "Mittel",
      "Hoch",
      "Extra hoch",
      "Moyen",
      "Avancé",
      "Très élevé",
    ]));
    expect(localeLabels.modeOptions.pro).toEqual(expect.arrayContaining([
      "Pro Extended",
      "Pro • Extended",
      "حرفه‌ای",
      "专业",
    ]));
    expect(localeLabels.modeOptions.high).toEqual(expect.arrayContaining([
      "بالا",
      "高级",
    ]));
  });

  it("reports running-state locale coverage separately from flattened labels", () => {
    expect(localeCoverageSummary.registeredLocaleCount).toBeGreaterThan(1);
    expect(localeCoverageSummary.nonEnglishLocaleCount).toBe(localeCoverageSummary.registeredLocaleCount - 1);
    expect(localeCoverageSummary.runningState.stopControlLocaleCount).toBeGreaterThanOrEqual(1);
    expect(localeCoverageSummary.runningState.stoppedAssistantLocaleCount).toBeGreaterThanOrEqual(1);
    expect(localeCoverageSummary.runningState.nonEnglishStopControlLocaleCount)
      .toBe(localeCoverageSummary.nonEnglishLocaleCount);
    expect(localeCoverageSummary.runningState.nonEnglishStoppedAssistantLocaleCount)
      .toBeLessThanOrEqual(localeCoverageSummary.nonEnglishLocaleCount);
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
    "projectSourcesTab",
    "projectSourcesAddSource",
    "projectSourcesUploadFiles",
    "copyResponse",
    "download",
    "downloadImage",
    "imageContainerHint",
    "modeLabels",
    "modeOptions",
    "modeOpenerExtra",
    "signedInMarkers",
    "transientAssistant",
    "stopControl",
    "stoppedAssistant",
    "responseActions",
    "loginBlocker",
    "captchaBlocker",
    "rateLimitBlocker",
  ];

  const requiredToolIds = ["web_search", "deep_research", "create_image"] as const;
  const requiredModeIds: readonly ModeOptionId[] = [
    "latest",
    "instant",
    "thinking",
    "extended",
    "medium",
    "high",
    "extraHigh",
    "pro",
  ];

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

  it("has every required semantic mode id", () => {
    for (const id of requiredModeIds) {
      expect(Object.prototype.hasOwnProperty.call(en.modeOptions, id), `en.modeOptions.${id} is present`).toBe(true);
    }
  });
});
