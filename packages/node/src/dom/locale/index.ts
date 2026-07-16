/**
 * Centralized, locale-sensitive ChatGPT UI strings.
 *
 * Every entry is an ORDERED list of candidate strings. English is canonical and MUST
 * stay first: it is also the public API contract for mode/tool selection (callers pass
 * `effort: "Thinking"`, `tool: "web_search"`, etc.). Matchers iterate the whole list,
 * so localizing the SDK is just appending verified strings to these arrays — no selector
 * or command code needs to change.
 *
 * RULES
 * - Do NOT add unverified translations. A locale string is only valid once it has been
 *   observed in a real localized ChatGPT session. Guesses are worse than nothing because
 *   they mask the `selector_drift` blocker that is the designed recovery path.
 * - Keys are stable logical ids. The localized display text goes in the array; the key
 *   never changes.
 * - These are the visible/accessible-name surfaces only. Structural anchors (roles,
 *   element ids like `#composer-plus-btn`, `a[href^='/c/']`, `data-message-author-role`)
 *   are language-agnostic and live in the selectors directly.
 *
 * Structural-only blocker patterns stay literal in `safety/blockers.ts` on purpose:
 * numeric/HTTP codes (`404`), our own bridge error fragments (`fileChooser.setFiles`,
 * `permission denied`), and the modal heuristic are not ChatGPT-localized UI text.
 *
 * HOW TO ADD A NEW LANGUAGE
 * 1. Create `src/dom/locale/<bcp47>.ts` exporting a `const <bcp47>` that satisfies
 *    `LocaleContribution` (Partial — only include keys whose text differs from English).
 *    Example:
 *      import type { LocaleContribution } from "./types.js";
 *      export const de = {
 *        sendButton: ["Send prompt", "Nachricht senden"],
 *        // ...
 *      } satisfies LocaleContribution;
 * 2. Import it here and append it to the `locales` array below.
 *    Example:
 *      import { de } from "./de.js";
 *      const locales = [en, de] as const;
 */

import { en } from "./en.js";
import { de } from "./de.js";
import { esES } from "./es-ES.js";
import { frFR } from "./fr-FR.js";
import { zhHK } from "./zh-HK.js";
import { zhTW } from "./zh-TW.js";
import { ja } from "./ja.js";
import { it } from "./it.js";
import { vi } from "./vi.js";
import { am } from "./am.js";
import { ar } from "./ar.js";
import { bg } from "./bg.js";
import { bs } from "./bs.js";
import { ca } from "./ca.js";
import { cs } from "./cs.js";
import { da } from "./da.js";
import { el } from "./el.js";
import { es419 } from "./es-419.js";
import { et } from "./et.js";
import { fa } from "./fa.js";
import { fi } from "./fi.js";
import { frCA } from "./fr-CA.js";
import { gu } from "./gu.js";
import { hi } from "./hi.js";
import { hr } from "./hr.js";
import { hu } from "./hu.js";
import { hy } from "./hy.js";
import { id } from "./id.js";
import { is as isIS } from "./is.js";
import { ka } from "./ka.js";
import { kk } from "./kk.js";
import { kn } from "./kn.js";
import { ko } from "./ko.js";
import { lt } from "./lt.js";
import { zhHans } from "./zh-Hans.js";
import { ur } from "./ur.js";
import { uk } from "./uk.js";
import { ptBR } from "./pt-BR.js";
import { ptPT } from "./pt-PT.js";
import { pl } from "./pl.js";
import { sk } from "./sk.js";
import { ro } from "./ro.js";
import { nb } from "./nb.js";
import { ml } from "./ml.js";
import { ru } from "./ru.js";
import { pa } from "./pa.js";
import { mr } from "./mr.js";
import { tr } from "./tr.js";
import { sw } from "./sw.js";
import { te } from "./te.js";
import { tl } from "./tl.js";
import { th } from "./th.js";
import { bn } from "./bn.js";
import { ms } from "./ms.js";
import { so } from "./so.js";
import { nl } from "./nl.js";
import { sv } from "./sv.js";
import { lv } from "./lv.js";
import { mk } from "./mk.js";
import { sq } from "./sq.js";
import { sl } from "./sl.js";
import { sr } from "./sr.js";
import { mn } from "./mn.js";
import { my } from "./my.js";
import { ta } from "./ta.js";
import type {
  ConfigurationAxisLabelId,
  ConfigurationOptionId,
  ExperienceOptionId,
  LocaleContribution,
  LocaleStrings,
  ModeOptionId
} from "./types.js";

// --- Locale registration ---
// English MUST be first (canonical). Append additional locale objects here.
const locales: readonly (LocaleStrings | LocaleContribution)[] = [en, de, esES, frFR, zhHK, zhTW, ja, it, vi, am, ar, bg, bs, ca, cs, da, el, es419, et, fa, fi, frCA, gu, hi, hr, hu, hy, id, isIS, ka, kk, kn, ko, lt, zhHans, ur, uk, ptBR, ptPT, pl, sk, ro, nb, ml, ru, pa, mr, tr, sw, te, tl, th, bn, ms, so, nl, sv, lv, mk, sq, sl, sr, mn, my, ta] as const;

function hasLocaleKey(
  locale: LocaleStrings | LocaleContribution,
  key: keyof LocaleStrings
): boolean {
  const value = (locale as Record<string, unknown>)[key];
  if (typeof value === "string") return value.trim().length > 0;
  return Array.isArray(value) && value.some(candidate => typeof candidate === "string" && candidate.trim().length > 0);
}

function countLocalesWithKey(
  localeList: readonly (LocaleStrings | LocaleContribution)[],
  key: keyof LocaleStrings
): number {
  return localeList.filter(locale => hasLocaleKey(locale, key)).length;
}

export const localeCoverageSummary = {
  registeredLocaleCount: locales.length,
  nonEnglishLocaleCount: Math.max(0, locales.length - 1),
  runningState: {
    stopControlLocaleCount: countLocalesWithKey(locales, "stopControl"),
    stoppedAssistantLocaleCount: countLocalesWithKey(locales, "stoppedAssistant"),
    nonEnglishStopControlLocaleCount: countLocalesWithKey(locales.slice(1), "stopControl"),
    nonEnglishStoppedAssistantLocaleCount: countLocalesWithKey(locales.slice(1), "stoppedAssistant")
  }
} as const;

// --- Combiner ---

type ToolId = "web_search" | "deep_research" | "create_image";
const TOOL_IDS: ToolId[] = ["web_search", "deep_research", "create_image"];
const MODE_OPTION_IDS: ModeOptionId[] = [
  "latest",
  "instant",
  "thinking",
  "extended",
  "medium",
  "high",
  "extraHigh",
  "pro",
];
const EXPERIENCE_OPTION_IDS: ExperienceOptionId[] = ["chat", "work"];
const CONFIGURATION_AXIS_IDS: ConfigurationAxisLabelId[] = [
  "model",
  "intelligence",
  "effort",
  "speed",
  "advanced",
];
const CONFIGURATION_OPTION_IDS: ConfigurationOptionId[] = [
  "instant",
  "light",
  "medium",
  "high",
  "extraHigh",
  "max",
  "ultra",
  "pro",
  "standard",
  "fast",
];

/**
 * Flatten contributions for a single non-tools key, deduplicating strings while
 * preserving first-seen order (English first).
 */
function flattenKey(
  localeList: readonly (LocaleStrings | LocaleContribution)[],
  key: Exclude<keyof LocaleStrings, "tools">
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const locale of localeList) {
    const value = (locale as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    const candidates: readonly string[] = typeof value === "string" ? [value] : (value as readonly string[]);
    for (const candidate of candidates) {
      if (candidate.length > 0 && !seen.has(candidate)) {
        seen.add(candidate);
        result.push(candidate);
      }
    }
  }

  return result;
}

/**
 * Flatten contributions for a single tool id across all locales.
 */
function flattenTool(
  localeList: readonly (LocaleStrings | LocaleContribution)[],
  toolId: ToolId
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const locale of localeList) {
    const tools = (locale as Record<string, unknown>)["tools"] as
      | Partial<Record<ToolId, string | readonly string[]>>
      | undefined;
    if (tools === undefined || tools === null) continue;
    const value = tools[toolId];
    if (value === undefined || value === null) continue;
    const candidates: readonly string[] = typeof value === "string" ? [value] : (value as readonly string[]);
    for (const candidate of candidates) {
      if (candidate.length > 0 && !seen.has(candidate)) {
        seen.add(candidate);
        result.push(candidate);
      }
    }
  }

  return result;
}

/**
 * Flatten contributions for a single semantic mode id across all locales.
 */
function flattenModeOption(
  localeList: readonly (LocaleStrings | LocaleContribution)[],
  optionId: ModeOptionId
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const locale of localeList) {
    const modeOptions = (locale as Record<string, unknown>)["modeOptions"] as
      | Partial<Record<ModeOptionId, string | readonly string[]>>
      | undefined;
    if (modeOptions === undefined || modeOptions === null) continue;
    const value = modeOptions[optionId];
    if (value === undefined || value === null) continue;
    const candidates: readonly string[] = typeof value === "string" ? [value] : (value as readonly string[]);
    for (const candidate of candidates) {
      if (candidate.length > 0 && !seen.has(candidate)) {
        seen.add(candidate);
        result.push(candidate);
      }
    }
  }

  return result;
}

function flattenNestedLabel<TId extends string>(
  localeList: readonly (LocaleStrings | LocaleContribution)[],
  group: "experienceOptions" | "configurationAxes" | "configurationOptions",
  id: TId
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const locale of localeList) {
    const contribution = (locale as Record<string, unknown>)[group] as
      | Partial<Record<TId, string | readonly string[]>>
      | undefined;
    const value = contribution?.[id];
    if (value === undefined) continue;
    const candidates = typeof value === "string" ? [value] : value;
    for (const candidate of candidates) {
      if (candidate.length > 0 && !seen.has(candidate)) {
        seen.add(candidate);
        result.push(candidate);
      }
    }
  }

  return result;
}

// Build the combined localeLabels object by flattening all locales.
const nonToolKeys = [
  "composerTextbox",
  "workComposerTextbox",
  "newWork",
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
  "modeOpenerExtra",
  "threadActionMenuItems",
  "threadActionPrefixes",
  "signedInMarkers",
  "transientAssistant",
  "stopControl",
  "stoppedAssistant",
  "responseActions",
  "loginBlocker",
  "captchaBlocker",
  "rateLimitBlocker",
] as const satisfies ReadonlyArray<Exclude<
  keyof LocaleStrings,
  "tools" | "modeOptions" | "experienceOptions" | "configurationAxes" | "configurationOptions"
>>;

const builtLabels = Object.fromEntries(
  nonToolKeys.map(key => [key, flattenKey(locales, key)])
) as Record<(typeof nonToolKeys)[number], string[]>;

const builtTools = Object.fromEntries(
  TOOL_IDS.map(id => [id, flattenTool(locales, id)])
) as Record<ToolId, string[]>;

const builtModeOptions = Object.fromEntries(
  MODE_OPTION_IDS.map(id => [id, flattenModeOption(locales, id)])
) as Record<ModeOptionId, string[]>;
const builtExperienceOptions = Object.fromEntries(
  EXPERIENCE_OPTION_IDS.map(id => [id, flattenNestedLabel(locales, "experienceOptions", id)])
) as Record<ExperienceOptionId, string[]>;
const builtConfigurationAxes = Object.fromEntries(
  CONFIGURATION_AXIS_IDS.map(id => [id, flattenNestedLabel(locales, "configurationAxes", id)])
) as Record<ConfigurationAxisLabelId, string[]>;
const builtConfigurationOptions = Object.fromEntries(
  CONFIGURATION_OPTION_IDS.map(id => [id, flattenNestedLabel(locales, "configurationOptions", id)])
) as Record<ConfigurationOptionId, string[]>;

/**
 * The combined locale registry. Values are `string[]` (mutable; English-first; deduped).
 * Consumers treat this identically to the previous `as const` object — the array contents
 * are identical to the original English-only values unless additional locales are added.
 */
export const localeLabels: {
  composerTextbox: string[];
  workComposerTextbox: string[];
  newWork: string[];
  sendButton: string[];
  searchChatsButton: string[];
  searchChatsPlaceholder: string[];
  newChat: string[];
  addFilesButton: string[];
  addFilesOpenerCandidates: string[];
  addPhotosFilesMenuItem: string[];
  projectSourcesTab: string[];
  projectSourcesAddSource: string[];
  projectSourcesUploadFiles: string[];
  copyResponse: string[];
  download: string[];
  downloadImage: string[];
  imageContainerHint: string[];
  modeLabels: string[];
  modeOptions: Record<ModeOptionId, string[]>;
  modeOpenerExtra: string[];
  experienceOptions: Record<ExperienceOptionId, string[]>;
  configurationAxes: Record<ConfigurationAxisLabelId, string[]>;
  configurationOptions: Record<ConfigurationOptionId, string[]>;
  threadActionMenuItems: string[];
  threadActionPrefixes: string[];
  tools: Record<string, string[]>;
  signedInMarkers: string[];
  transientAssistant: string[];
  stopControl: string[];
  stoppedAssistant: string[];
  responseActions: string[];
  loginBlocker: string[];
  captchaBlocker: string[];
  rateLimitBlocker: string[];
} = {
  ...builtLabels,
  modeOptions: builtModeOptions,
  experienceOptions: builtExperienceOptions,
  configurationAxes: builtConfigurationAxes,
  configurationOptions: builtConfigurationOptions,
  tools: builtTools,
};

// --- Helpers (re-exported so the barrel and any direct locale/index imports both work) ---

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a case-insensitive RegExp that matches any of the candidate labels as a
 * substring. Suitable for Playwright `getByRole({ name })` and `getByPlaceholder()`,
 * which accept a RegExp and preserve the prior substring-match semantics for a single
 * English candidate while transparently supporting added locales.
 */
export function anyLabelPattern(candidates: readonly string[]): RegExp {
  return new RegExp(candidates.map(escapeRegExp).join("|"), "i");
}

export type {
  ConfigurationAxisContribution,
  ConfigurationAxisLabelId,
  ConfigurationAxisLabels,
  ConfigurationOptionContribution,
  ConfigurationOptionId,
  ConfigurationOptionLabels,
  ExperienceOptionContribution,
  ExperienceOptionId,
  ExperienceOptionLabels,
  LocaleContribution,
  LocaleStrings,
  ModeOptionContribution,
  ModeOptionId,
  ModeOptionLabels
} from "./types.js";
