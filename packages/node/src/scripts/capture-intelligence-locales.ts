import { existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachChatGPTBrowser } from "../browser/attach.js";
import {
  readChatPopover,
  setChatPopoverView,
  type ChatPopoverSnapshot
} from "../commands/chat-popover.js";
import { BROWSER_BRIDGE_REMEDIATION, BROWSER_BRIDGE_UNAVAILABLE_MESSAGE } from "../errors.js";
import type { BrowserLike, ExistingTabPolicy, LocatorLike, PageLike, RuntimeEnv } from "../types.js";
import { nonEnglishLanguages, readLanguageCoverage, type CoverageLanguage } from "./locale-capture/language-coverage.js";
import { cleanCapturedSliderLabel } from "./locale-capture/slider-label.js";
import {
  assignOrderedChatConfigurationRows,
  assignChatSelectedSurfaceOptions,
  assignOrderedSurfaceOptions,
  assignOrderedWorkConfigurationRows,
  type CapturedChatConfigurationRow,
  type CapturedWorkConfigurationRow,
  type RawConfigurationRow,
  type RawSurfaceOption,
} from "./locale-capture/surface-graph.js";

const SCHEMA_VERSION = "chatgpt.browser_control.intelligence_locale_capture.v1";
const CHATGPT_HOME = "https://chatgpt.com/";
const DEFAULT_SWITCH_TIMEOUT_MS = 15_000;
const DEFAULT_SETTLE_MS = 1_500;
const DEFAULT_LIMIT = 25;
const DEFAULT_GENERATION_CAPTURE_TIMEOUT_MS = 8_000;
const DEFAULT_GENERATION_PROMPT = [
  "Localization probe: count upward from 1 to 2000, one number per line.",
  "Do not explain. Keep going until I stop you."
].join(" ");

type CaptureStatus = "ok" | "blocked";

type CaptureRecord = {
  schemaVersion: typeof SCHEMA_VERSION;
  status: CaptureStatus;
  capturedAt: string;
  requestedLocale: string;
  requestedNativeName: string;
  htmlLang?: string | undefined;
  url?: string | undefined;
  menuHeading?: string | undefined;
  intelligenceLabels?: string[] | undefined;
  selectedIntelligenceLabel?: string | undefined;
  versionFamilyLabels?: string[] | undefined;
  modelVersionLabels?: string[] | undefined;
  generationStopLabels?: string[] | undefined;
  generationStoppedLabels?: string[] | undefined;
  generationSignals?: string[] | undefined;
  surfaceCapture?: LocaleSurfaceCapture | undefined;
  warnings: string[];
  blocker?: {
    kind: string;
    code: string;
    message: string;
  };
};

type LocaleSurfaceCapture = {
  schemaVersion: "chatgpt.browser_control.locale_surface_capture.v1";
  status: CaptureStatus;
  chat?: {
    optionLabel: string;
    composerLabels: string[];
    power: CapturedPowerControl;
    advanced?: CapturedAdvancedControl;
    configurationRows: CapturedChatConfigurationRow[];
  };
  work?: {
    optionLabel: string;
    composerLabels: string[];
    power: CapturedPowerControl;
    advanced?: CapturedAdvancedControl;
    configurationRows: CapturedWorkConfigurationRow[];
  };
  restoredChat: boolean;
  warnings: string[];
  blocker?: {
    kind: "selector_drift";
    code: string;
    message: string;
  };
};

type CapturedPowerControl = {
  axisLabel: string;
  valueLabel: string;
  minimum: number;
  maximum: number;
  value: number;
  position: number;
  count: number;
};

type CapturedAdvancedControl = {
  label: string;
  accessibleLabel?: string | undefined;
  expanded: boolean;
  initiallyExpanded?: boolean | undefined;
};

type CapturedConfigurationMenu<TRow extends CapturedChatConfigurationRow | CapturedWorkConfigurationRow> = {
  openerLabel: string;
  power: CapturedPowerControl;
  advanced?: CapturedAdvancedControl;
  rows: TRow[];
};

type CaptureOptions = {
  locale: string | undefined;
  nativeName: string | undefined;
  out: string;
  printQueue: boolean;
  autoSwitch: boolean;
  all: boolean;
  limit: number | undefined;
  locales: string[] | undefined;
  openVersionSubmenu: boolean;
  captureGenerationState: boolean;
  captureSurfaces: boolean;
  generationPrompt: string;
  generationCaptureTimeoutMs: number;
  restore: boolean;
  settleMs: number;
  switchTimeoutMs: number;
  coveragePath: string;
  ifMissing: NonNullable<ExistingTabPolicy["ifMissing"]>;
  tabId: string | undefined;
};

type CaptureRuntime = {
  agent?: unknown;
  browser?: BrowserLike;
};

type TimingOptions = Pick<CaptureOptions, "settleMs" | "switchTimeoutMs">;

type GenerationUiSnapshot = {
  controls: CapturedGenerationControl[];
  shortLatestAssistantTexts: string[];
};

type CapturedGenerationControl = {
  label: string;
  text?: string | undefined;
  ariaLabel?: string | undefined;
  title?: string | undefined;
  testId?: string | undefined;
  role?: string | undefined;
};

type GenerationStateCapture = {
  stopLabels: string[];
  stoppedLabels: string[];
  signals: string[];
  warnings: string[];
  submitted: boolean;
  stopped: boolean;
};

type CaptureDependencies = {
  captureIntelligencePicker: typeof captureIntelligencePicker;
  captureGenerationStateLabels: typeof captureGenerationStateLabels;
};

class CaptureUsageError extends Error {
  constructor(message: string, readonly exitCode = 2) {
    super(message);
    this.name = "CaptureUsageError";
  }
}

const USAGE = [
  "Usage:",
  "  npm run capture:intelligence-locales:queue",
  "  npm run capture:intelligence-locales -- --locale de --native Deutsch --out ../../outputs/intelligence-locale-captures/2026-06-10-intelligence-picker.jsonl",
  "  npm run capture:intelligence-locales -- --auto-switch --limit 25",
  "  npm run capture:intelligence-locales -- --auto-switch --all --if-missing open",
  "  npm run capture:intelligence-locales -- --auto-switch --locales de,fr-FR,pt-BR",
  "",
  "Options:",
  "  --print-queue                  Print the language queue from references/language-coverage.md.",
  "  --locale                       BCP47 locale id for a one-shot capture.",
  "  --native                       Exact Settings language option text for a one-shot capture.",
  "  --out                          JSONL output path. Defaults to ../../outputs/intelligence-locale-captures/<today>-intelligence-picker.jsonl.",
  "  --auto-switch                  Change ChatGPT Settings -> General -> Language before each capture.",
  "  --all                          Sweep every non-English language from references/language-coverage.md.",
  "  --limit                        Number of non-English languages to sweep. Default: 25 with --auto-switch.",
  "  --locales                      Comma-separated BCP47 ids to sweep instead of first --limit languages.",
  "  --open-version-submenu         Capture GPT-* model version submenu labels. Default: true.",
  "  --no-open-version-submenu      Do not open the model-version submenu.",
  "  --capture-generation-state     Submit one bounded probe per locale to capture localized running/stopped generation labels. Default: false.",
  "  --no-capture-generation-state  Disable generation-state capture.",
  "  --capture-surfaces              Capture Chat/Work radios, composers, Power/Advanced controls, and ordered configuration rows.",
  "  --no-capture-surfaces           Disable Chat/Work surface capture. Default.",
  "  --generation-prompt            Override the redacted probe prompt used only for generation-state capture.",
  "  --generation-timeout-ms        Wait for generation controls after submit. Default: 8000.",
  "  --restore                      Restore the initially selected language after a sweep. Default with --auto-switch.",
  "  --no-restore                   Leave ChatGPT on the last swept language.",
  "  --settle-ms                    Wait after language switches and menu opens. Default: 1500.",
  "  --switch-timeout-ms            Wait for rendered html lang after a language switch. Default: 15000.",
  "  --if-missing                   block|open|create. Default: open with --auto-switch, otherwise block.",
  "  --tab-id                       Claim an exact ChatGPT tab id instead of the selected ChatGPT tab.",
  "  --coverage-path                Path to language-coverage.md."
].join("\n");

export async function main(argv = process.argv.slice(2), runtime: CaptureRuntime = globalThis as CaptureRuntime): Promise<number> {
  let options: CaptureOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof CaptureUsageError) {
      console.log(error.message);
      return error.exitCode;
    }
    throw error;
  }

  const languages = await readLanguageCoverage(options.coveragePath);
  const knownLanguageNames = languages.map(language => language.nativeName);
  if (options.printQueue) {
    printQueue(nonEnglishLanguages(languages));
    return 0;
  }

  if ((runtime.agent === undefined || runtime.agent === null) && runtime.browser === undefined) {
    console.log(JSON.stringify({
      ok: false,
      status: "blocked",
      blocker: {
        kind: "browser_bridge_unavailable",
        code: "codex_chrome_bridge_unavailable",
        message: BROWSER_BRIDGE_UNAVAILABLE_MESSAGE,
        remediation: BROWSER_BRIDGE_REMEDIATION
      }
    }, null, 2));
    return 2;
  }

  const initialLanguage = options.autoSwitch && options.restore
    ? await readInitialLanguage(runtime, options, knownLanguageNames)
    : undefined;
  const sweepLanguages = resolveSweepLanguages(options, languages);
  const records: CaptureRecord[] = [];
  let restoreFailed = false;

  try {
    for (const language of sweepLanguages) {
      const page = await attachCapturePage(runtime, options);
      const record = await captureOne(page, language, options, knownLanguageNames);
      records.push(record);
      await appendRecord(options.out, record);
      printCaptureRecord(record, options.out);
      const recentRecords = records.slice(-3);
      if (recentRecords.length === 3 && recentRecords.every(previous => previous.status === "blocked")) {
        console.error("Stopping after three consecutive blocked locale captures.");
        return 1;
      }
    }
  } finally {
    if (options.autoSwitch && options.restore && initialLanguage !== undefined) {
      await attachCapturePage(runtime, options).then(page => restoreLanguage(
        page,
        initialLanguage.selectedLabel,
        initialLanguage.htmlLang,
        knownLanguageNames,
        options
      )).catch(error => {
        restoreFailed = true;
        console.error(`Unable to restore initial language ${initialLanguage.selectedLabel}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  return restoreFailed || records.some(record =>
    record.status === "blocked"
    || !surfaceCaptureSucceeded(options.captureSurfaces, record.surfaceCapture)
  ) ? 1 : 0;
}

async function readInitialLanguage(
  runtime: CaptureRuntime,
  options: CaptureOptions,
  knownLanguageNames: readonly string[]
): Promise<{ selectedLabel: string; htmlLang: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const page = await attachCapturePage(runtime, options);
      const proof = await renderedProof(page);
      const selected = await readSelectedLanguage(page, knownLanguageNames);
      if (selected !== undefined && proof.htmlLang !== undefined && proof.htmlLang.length > 0) {
        return { selectedLabel: selected, htmlLang: proof.htmlLang };
      }
      lastError = new Error("Settings language value was empty.");
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  throw new Error(`Unable to establish the initial ChatGPT language before a restorable sweep: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export function surfaceCaptureSucceeded(
  requested: boolean,
  capture: { status: "ok" | "blocked"; restoredChat: boolean } | undefined
): boolean {
  return !requested || (capture?.status === "ok" && capture.restoredChat);
}

export function parseArgs(argv: readonly string[]): CaptureOptions {
  let locale: string | undefined;
  let nativeName: string | undefined;
  let out: string | undefined;
  let printQueue = false;
  let autoSwitch = false;
  let all = false;
  let limit: number | undefined;
  let locales: string[] | undefined;
  let openVersionSubmenu = true;
  let captureGenerationState = false;
  let captureSurfaces = false;
  let generationPrompt = DEFAULT_GENERATION_PROMPT;
  let generationCaptureTimeoutMs = DEFAULT_GENERATION_CAPTURE_TIMEOUT_MS;
  let restore: boolean | undefined;
  let settleMs = DEFAULT_SETTLE_MS;
  let switchTimeoutMs = DEFAULT_SWITCH_TIMEOUT_MS;
  let coveragePath: string | undefined;
  let ifMissing: NonNullable<ExistingTabPolicy["ifMissing"]> | undefined;
  let tabId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    switch (arg) {
      case "--help":
      case "-h":
        throw new CaptureUsageError(USAGE, 0);
      case "--print-queue":
        printQueue = true;
        break;
      case "--locale":
        locale = requiredValue(argv, ++index, arg);
        break;
      case "--native":
        nativeName = requiredValue(argv, ++index, arg);
        break;
      case "--out":
        out = requiredValue(argv, ++index, arg);
        break;
      case "--auto-switch":
        autoSwitch = true;
        break;
      case "--all":
        all = true;
        break;
      case "--limit":
        limit = parsePositiveInteger(requiredValue(argv, ++index, arg), arg);
        break;
      case "--locales":
        locales = requiredValue(argv, ++index, arg).split(",").map(value => value.trim()).filter(Boolean);
        break;
      case "--open-version-submenu":
        openVersionSubmenu = true;
        break;
      case "--no-open-version-submenu":
        openVersionSubmenu = false;
        break;
      case "--capture-generation-state":
        captureGenerationState = true;
        break;
      case "--no-capture-generation-state":
        captureGenerationState = false;
        break;
      case "--capture-surfaces":
        captureSurfaces = true;
        break;
      case "--no-capture-surfaces":
        captureSurfaces = false;
        break;
      case "--generation-prompt":
        generationPrompt = requiredValue(argv, ++index, arg);
        break;
      case "--generation-timeout-ms":
        generationCaptureTimeoutMs = parsePositiveInteger(requiredValue(argv, ++index, arg), arg);
        break;
      case "--restore":
        restore = true;
        break;
      case "--no-restore":
        restore = false;
        break;
      case "--settle-ms":
        settleMs = parsePositiveInteger(requiredValue(argv, ++index, arg), arg);
        break;
      case "--switch-timeout-ms":
        switchTimeoutMs = parsePositiveInteger(requiredValue(argv, ++index, arg), arg);
        break;
      case "--if-missing":
        ifMissing = parseIfMissing(requiredValue(argv, ++index, arg));
        break;
      case "--tab-id":
        tabId = requiredValue(argv, ++index, arg);
        break;
      case "--coverage-path":
        coveragePath = requiredValue(argv, ++index, arg);
        break;
      default:
        throw new CaptureUsageError(`Unknown option: ${arg}\n\n${USAGE}`);
    }
  }

  if (!printQueue && !autoSwitch && (locale === undefined || nativeName === undefined)) {
    throw new CaptureUsageError(`One-shot capture requires --locale and --native unless --auto-switch is used.\n\n${USAGE}`);
  }

  const root = packageRoot();
  return {
    locale,
    nativeName,
    out: resolve(root, out ?? defaultOutputPath()),
    printQueue,
    autoSwitch,
    all,
    limit,
    locales,
    openVersionSubmenu,
    captureGenerationState,
    captureSurfaces,
    generationPrompt,
    generationCaptureTimeoutMs,
    restore: restore ?? autoSwitch,
    settleMs,
    switchTimeoutMs,
    coveragePath: resolve(root, coveragePath ?? "references/language-coverage.md"),
    ifMissing: ifMissing ?? (autoSwitch ? "open" : "block"),
    tabId
  };
}

async function attachCapturePage(runtime: CaptureRuntime, options: CaptureOptions): Promise<PageLike> {
  const runtimeEnv: RuntimeEnv = {};
  if (runtime.agent !== undefined && runtime.agent !== null) runtimeEnv.agent = runtime.agent;
  if (runtime.browser !== undefined) runtimeEnv.browser = runtime.browser;
  const attached = await attachChatGPTBrowser(runtimeEnv, {
    existingTab: {
      target: options.tabId === undefined
        ? { type: "selected", host: "chatgpt" }
        : { type: "tabId", tabId: options.tabId },
      ifMissing: options.ifMissing,
      ifMultiple: "first",
      requireChatGPT: true
    },
    url: CHATGPT_HOME
  });
  return attached.page;
}

function resolveSweepLanguages(options: CaptureOptions, languages: readonly CoverageLanguage[]): CoverageLanguage[] {
  if (options.autoSwitch) {
    const nonEnglish = nonEnglishLanguages(languages);
    if (options.locales !== undefined) {
      return options.locales.map(locale => {
        const language = languages.find(candidate => candidate.bcp47.toLowerCase() === locale.toLowerCase());
        if (language === undefined) {
          throw new CaptureUsageError(`Locale ${locale} was not found in language coverage.`);
        }
        return language;
      });
    }
    if (options.all) {
      return nonEnglish;
    }
    return nonEnglish.slice(0, options.limit ?? DEFAULT_LIMIT);
  }

  return [{
    language: options.locale!,
    nativeName: options.nativeName!,
    bcp47: options.locale!,
    speakers: "",
    status: ""
  }];
}

export async function captureOne(
  page: PageLike,
  language: CoverageLanguage,
  options: CaptureOptions,
  knownLanguageNames: readonly string[],
  dependencies: Partial<CaptureDependencies> = {}
): Promise<CaptureRecord> {
  const warnings: string[] = [];
  try {
    if (options.autoSwitch) {
      await switchLanguage(page, language, knownLanguageNames, options);
      const proof = await renderedProof(page);
      if (!htmlLangMatches(proof.htmlLang, language.bcp47)) {
        return blockedRecord(language, proof, warnings, "rendered_locale_mismatch", `Rendered html lang ${proof.htmlLang || "unknown"} did not match requested ${language.bcp47}.`);
      }
    }

    await closeSettingsIfOpen(page);
    await returnToChatSurface(page, options);
    if (options.captureSurfaces) {
      await ensureChatSurfaceSelected(page, options);
    }
    const picker = await (dependencies.captureIntelligencePicker ?? captureIntelligencePicker)(page, options);
    await closeFloatingMenus(page);
    const surfaceCapture = options.captureSurfaces
      ? await captureLocaleSurface(page, options, picker.configuration)
      : undefined;
    const generation = options.captureGenerationState
      ? await (dependencies.captureGenerationStateLabels ?? captureGenerationStateLabels)(page, options)
      : undefined;
    if (generation !== undefined) {
      warnings.push(...generation.warnings);
    }
    const record: CaptureRecord = {
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      capturedAt: new Date().toISOString(),
      requestedLocale: language.bcp47,
      requestedNativeName: language.nativeName,
      htmlLang: picker.htmlLang,
      url: normalizeChatGPTUrl(picker.url),
      menuHeading: picker.menuHeading,
      intelligenceLabels: picker.intelligenceLabels,
      selectedIntelligenceLabel: picker.selectedIntelligenceLabel,
      versionFamilyLabels: picker.versionFamilyLabels,
      modelVersionLabels: picker.modelVersionLabels,
      warnings
    };
    if (surfaceCapture !== undefined) {
      record.surfaceCapture = surfaceCapture;
      warnings.push(...surfaceCapture.warnings);
    }
    if (generation !== undefined) {
      record.generationStopLabels = generation.stopLabels;
      record.generationStoppedLabels = generation.stoppedLabels;
      record.generationSignals = generation.signals;
    }
    return record;
  } catch (error) {
    const proof = await renderedProof(page).catch(() => ({}));
    return blockedRecord(language, proof, warnings, "capture_failed", error instanceof Error ? error.message : String(error));
  }
}

async function switchLanguage(
  page: PageLike,
  language: CoverageLanguage,
  knownLanguageNames: readonly string[],
  options: TimingOptions
): Promise<void> {
  await openSettings(page, options);
  await openLanguageCombobox(page, knownLanguageNames);
  await clickOptionExact(page, language.nativeName);
  await wait(options.settleMs);
  if (page.goto !== undefined) {
    await page.goto(CHATGPT_HOME).catch(error => {
      if (!/ERR_ABORTED/i.test(error instanceof Error ? error.message : String(error))) throw error;
    });
    await wait(options.settleMs);
  }
  await waitForRenderedLanguage(page, language.bcp47, options.switchTimeoutMs);
}

async function restoreLanguage(
  page: PageLike,
  selectedLanguageText: string,
  expectedHtmlLang: string,
  knownLanguageNames: readonly string[],
  options: TimingOptions
): Promise<void> {
  await openSettings(page, options);
  await openLanguageCombobox(page, knownLanguageNames);
  await clickOptionExact(page, selectedLanguageText);
  await wait(options.settleMs);
  let restored = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.goto !== undefined) {
      await page.goto(CHATGPT_HOME).catch(error => {
        if (!/ERR_ABORTED/i.test(error instanceof Error ? error.message : String(error))) throw error;
      });
    }
    await wait(options.settleMs);
    try {
      await waitForRenderedLanguage(page, expectedHtmlLang, options.switchTimeoutMs);
      restored = true;
      break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  if (!restored) throw new Error(`Rendered language did not restore to ${expectedHtmlLang}.`);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await closeSettingsIfOpen(page);
    await wait(500);
    if (!await isSettingsOpen(page)) return;
  }
  throw new Error("Settings modal remained open after restoring the initial language.");
}

async function openSettings(page: PageLike, options: Pick<CaptureOptions, "settleMs">): Promise<void> {
  if (await isSettingsOpen(page)) return;
  await closeFloatingMenus(page);
  const profiles = page.locator?.("[data-testid=\"accounts-profile-button\"]");
  const profileCount = await profiles?.count?.().catch(() => 0) ?? 0;
  let settings: LocatorLike | undefined;
  for (let index = profileCount - 1; index >= 0; index -= 1) {
    const profile = profiles?.nth?.(index);
    if (profile?.click === undefined) continue;
    if (profile.isVisible !== undefined && !await profile.isVisible().catch(() => false)) continue;
    await profile.click().catch(() => undefined);
    await wait(Math.min(options.settleMs, 500));
    const candidate = page.locator?.("[data-testid=\"settings-menu-item\"]")?.last?.();
    const candidateCount = await candidate?.count?.().catch(() => 0) ?? 0;
    if (candidateCount === 1 && candidate?.click !== undefined) {
      settings = candidate;
      break;
    }
  }
  if (settings?.click === undefined) throw new Error("Settings menu item was not available from any visible profile control.");
  await settings.click();
  const deadline = Date.now() + 5_000;
  for (;;) {
    if (await isSettingsOpen(page)) return;
    if (Date.now() >= deadline) throw new Error("Settings modal did not open.");
    await wait(Math.min(options.settleMs, 500));
  }
}

async function isSettingsOpen(page: PageLike): Promise<boolean> {
  return page.evaluate?.(() =>
    document.querySelector("[role='dialog']") !== null
      && (
        location.hash === "#settings"
        || document.querySelector("[data-testid='close-button']") !== null
        || document.querySelectorAll("button[role='combobox']").length >= 3
      )
  ) ?? false;
}

async function openLanguageCombobox(page: PageLike, knownLanguageNames: readonly string[]): Promise<void> {
  const match = await findLanguageCombobox(page, knownLanguageNames);
  const combo = page.locator?.("[role='dialog'] button[role='combobox']")?.nth?.(match.index);
  if (combo?.click === undefined) throw new Error("Language combobox was not actionable.");
  await combo.click();
  await wait(500);
}

async function clickOptionExact(page: PageLike, label: string): Promise<void> {
  const option = page.getByRole?.("option", { name: label, exact: true });
  if (option?.click === undefined) {
    throw new Error(`Language option ${label} was not available.`);
  }
  await option.click();
}

async function readSelectedLanguage(page: PageLike, knownLanguageNames: readonly string[]): Promise<string | undefined> {
  await openSettings(page, { settleMs: DEFAULT_SETTLE_MS });
  return (await findLanguageCombobox(page, knownLanguageNames)).selectedLabel;
}

async function findLanguageCombobox(
  page: PageLike,
  knownLanguageNames: readonly string[]
): Promise<{ index: number; selectedLabel: string }> {
  const values = await page.evaluate?.(() =>
    Array.from(document.querySelectorAll("[role='dialog'] button[role='combobox']"))
      .map((button, index) => ({
        index,
        label: (button.textContent ?? "").replace(/\s+/g, " ").trim()
      }))
  ) ?? [];
  const known = new Set(knownLanguageNames.map(normalized));
  const matches = values.filter(value => known.has(normalized(value.label)));
  if (matches.length !== 1) {
    throw new Error(`Expected one Settings language combobox by selected native-language value; observed ${matches.length}.`);
  }
  return { index: matches[0]!.index, selectedLabel: matches[0]!.label };
}

async function closeSettingsIfOpen(page: PageLike): Promise<void> {
  if (!await isSettingsOpen(page)) return;
  const closePoints = await page.evaluate?.(() =>
    Array.from(document.querySelectorAll("[data-testid='close-button']"))
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter(point => point.width > 0 && point.height > 0)
      .sort((left, right) => right.x - left.x)
  ) ?? [];
  for (const point of closePoints) {
    await clickPagePoint(page, point).catch(() => undefined);
    await wait(500);
    if (!await isSettingsOpen(page)) return;
  }

  const buttons = page.locator?.("[data-testid=\"close-button\"]");
  const count = await buttons?.count?.().catch(() => 0) ?? 0;
  for (let index = count - 1; index >= 0; index -= 1) {
    await buttons?.nth?.(index)?.click?.().catch(() => undefined);
    await wait(500);
    if (!await isSettingsOpen(page)) return;
  }
  await page.keyboard?.press?.("Escape").catch(() => undefined);
  await wait(500);
  if (await isSettingsOpen(page)) {
    throw new Error("Settings modal did not close.");
  }
}

async function returnToChatSurface(page: PageLike, options: Pick<CaptureOptions, "settleMs">): Promise<void> {
  const proof: { htmlLang?: string; url?: string } = await renderedProof(page).catch(() => ({}));
  if (proof.url?.includes("#settings") !== true) return;
  if (page.goto !== undefined) {
    await page.goto(CHATGPT_HOME).catch(() => undefined);
    await wait(options.settleMs);
    return;
  }
  await page.keyboard?.press?.("Escape").catch(() => undefined);
  await wait(options.settleMs);
}

async function closeFloatingMenus(page: PageLike): Promise<void> {
  await page.locator?.("body")?.click?.({ position: { x: 12, y: 12 } }).catch(() => undefined);
  await wait(250);
}

async function captureIntelligencePicker(page: PageLike, options: CaptureOptions): Promise<{
  htmlLang: string;
  url: string;
  menuHeading?: string;
  intelligenceLabels: string[];
  selectedIntelligenceLabel?: string;
  versionFamilyLabels: string[];
  modelVersionLabels: string[];
  configuration: CapturedConfigurationMenu<CapturedChatConfigurationRow>;
}> {
  await closeFloatingMenus(page);
  const configuration = await captureConfigurationMenu(page, "chat", options.settleMs, options.openVersionSubmenu);
  const proof = await renderedProof(page);
  const model = configuration.rows.find(row => row.axis === "model");
  const effort = configuration.rows.find(row => row.axis === "effort");
  if (model === undefined || effort === undefined || effort.options.length === 0) {
    throw new Error("Chat configuration did not expose ordered Model and Effort options.");
  }
  const selectedIntelligenceLabel = effort.options.find(option => option.checked)?.label;
  return {
    htmlLang: proof.htmlLang ?? "",
    url: proof.url ?? "",
    menuHeading: configuration.power.axisLabel,
    intelligenceLabels: effort.options.map(option => option.label),
    ...(selectedIntelligenceLabel === undefined ? {} : { selectedIntelligenceLabel }),
    versionFamilyLabels: [],
    modelVersionLabels: model.options.map(option => option.label),
    configuration
  };
}

async function captureLocaleSurface(
  page: PageLike,
  options: Pick<CaptureOptions, "settleMs" | "switchTimeoutMs">,
  chatConfiguration: CapturedConfigurationMenu<CapturedChatConfigurationRow>
): Promise<LocaleSurfaceCapture> {
  const warnings: string[] = [];
  let chatLabel: string | undefined;
  let workLabel: string | undefined;
  let restoredChat = false;
  let result: Omit<LocaleSurfaceCapture, "restoredChat">;

  try {
    await waitForOrderedSurfaceOptions(page, options.switchTimeoutMs);
    const mapped = assignChatSelectedSurfaceOptions(await readVisibleSurfaceOptions(page));
    chatLabel = mapped.chatLabel;
    workLabel = mapped.workLabel;
    const chatComposerLabels = await readVisibleComposerLabels(page);

    await clickSurfaceOption(page, workLabel);
    await waitForSurfaceSelection(page, workLabel, options.switchTimeoutMs);
    await wait(options.settleMs);
    const workComposerLabels = await readVisibleComposerLabels(page);
    const workConfiguration = await captureConfigurationMenu(page, "work", options.settleMs, true);

    result = {
      schemaVersion: "chatgpt.browser_control.locale_surface_capture.v1",
      status: "ok",
      chat: {
        optionLabel: chatLabel,
        composerLabels: chatComposerLabels,
        power: chatConfiguration.power,
        ...(chatConfiguration.advanced === undefined ? {} : { advanced: chatConfiguration.advanced }),
        configurationRows: chatConfiguration.rows
      },
      work: {
        optionLabel: workLabel,
        composerLabels: workComposerLabels,
        power: workConfiguration.power,
        ...(workConfiguration.advanced === undefined ? {} : { advanced: workConfiguration.advanced }),
        configurationRows: workConfiguration.rows
      },
      warnings
    };
  } catch (error) {
    result = {
      schemaVersion: "chatgpt.browser_control.locale_surface_capture.v1",
      status: "blocked",
      warnings,
      blocker: {
        kind: "selector_drift",
        code: "locale_surface_capture_failed",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    await closeFloatingMenus(page).catch(() => undefined);
    if (chatLabel !== undefined) {
      try {
        await clickSurfaceOption(page, chatLabel);
        await waitForSurfaceSelection(page, chatLabel, options.switchTimeoutMs);
        restoredChat = true;
      } catch (error) {
        warnings.push(`Unable to restore Chat surface: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (result.status === "ok" && !restoredChat) {
    result = {
      ...result,
      status: "blocked",
      blocker: {
        kind: "selector_drift",
        code: "locale_surface_restore_failed",
        message: "The localized Chat/Work surface was captured, but Chat could not be restored."
      }
    };
  }

  return { ...result, restoredChat };
}

async function ensureChatSurfaceSelected(
  page: PageLike,
  options: Pick<CaptureOptions, "settleMs" | "switchTimeoutMs">
): Promise<void> {
  const mapped = await waitForOrderedSurfaceOptions(page, options.switchTimeoutMs);
  if (mapped.selected === "chat") return;
  await clickSurfaceOption(page, mapped.chatLabel);
  await waitForSurfaceSelection(page, mapped.chatLabel, options.switchTimeoutMs);
  await wait(options.settleMs);
}

async function waitForOrderedSurfaceOptions(
  page: PageLike,
  timeoutMs: number
): Promise<ReturnType<typeof assignOrderedSurfaceOptions>> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      return assignOrderedSurfaceOptions(await readVisibleSurfaceOptions(page));
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    await wait(250);
  }
}

async function readVisibleSurfaceOptions(page: PageLike): Promise<RawSurfaceOption[]> {
  return await page.evaluate?.(() => {
    const visible = (element: Element): boolean => {
      const rect = (element as HTMLElement).getBoundingClientRect?.();
      const style = window.getComputedStyle?.(element as HTMLElement);
      return rect !== undefined && rect.width > 0 && rect.height > 0
        && style?.display !== "none" && style?.visibility !== "hidden";
    };
    const label = (element: Element): string => (
      element.getAttribute("aria-label")
      ?? (element as HTMLElement).innerText
      ?? element.textContent
      ?? ""
    ).replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll("[role='radio'], input[type='radio']"))
      .filter(element => visible(element) && element.closest("[role='dialog']") === null)
      .map(element => ({
        label: label(element),
        checked: element.getAttribute("aria-checked") === "true"
          || element.getAttribute("data-state") === "on"
          || (element.tagName === "INPUT" && (element as HTMLInputElement).checked)
      }))
      .filter(option => option.label.length > 0)
      .slice(0, 8);
  }) ?? [];
}

async function readVisibleComposerLabels(page: PageLike): Promise<string[]> {
  return await page.evaluate?.(() => {
    const visible = (element: Element): boolean => {
      const rect = (element as HTMLElement).getBoundingClientRect?.();
      const style = window.getComputedStyle?.(element as HTMLElement);
      return rect !== undefined && rect.width > 0 && rect.height > 0
        && style?.display !== "none" && style?.visibility !== "hidden";
    };
    const roots = Array.from(document.querySelectorAll(
      "main form, main [data-testid*='composer' i], main [class*='composer' i]"
    ));
    const nodes = roots.flatMap(root => Array.from(
      root.querySelectorAll("textarea, [contenteditable='true'], [role='textbox'], input")
    ));
    return Array.from(new Set(nodes.filter(visible).map(element => (
      element.getAttribute("aria-label")
      ?? element.getAttribute("placeholder")
      ?? (element as HTMLElement).innerText
      ?? element.textContent
      ?? ""
    ).replace(/\s+/g, " ").trim()).filter(Boolean))).slice(0, 16);
  }) ?? [];
}

async function clickSurfaceOption(page: PageLike, label: string): Promise<void> {
  const locator = page.getByRole?.("radio", { name: label, exact: true });
  const count = await locator?.count?.().catch(() => 0) ?? 0;
  if (count !== 1 || locator?.click === undefined) {
    throw new Error(`Surface radio ${JSON.stringify(label)} was missing or ambiguous.`);
  }
  await locator.click();
}

async function waitForSurfaceSelection(page: PageLike, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const options = await readVisibleSurfaceOptions(page);
    if (options.some(option => option.label === label && option.checked)) return;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for surface ${JSON.stringify(label)}.`);
    await wait(250);
  }
}

async function captureConfigurationMenu(
  page: PageLike,
  experience: "chat",
  settleMs: number,
  captureModelOptions: boolean
): Promise<CapturedConfigurationMenu<CapturedChatConfigurationRow>>;
async function captureConfigurationMenu(
  page: PageLike,
  experience: "work",
  settleMs: number,
  captureModelOptions: boolean
): Promise<CapturedConfigurationMenu<CapturedWorkConfigurationRow>>;
async function captureConfigurationMenu(
  page: PageLike,
  experience: "chat" | "work",
  settleMs: number,
  captureModelOptions: boolean
): Promise<CapturedConfigurationMenu<CapturedChatConfigurationRow> | CapturedConfigurationMenu<CapturedWorkConfigurationRow>> {
  const expectedRowCount = experience === "chat" ? 2 : 3;
  const opener = await findConfigurationOpener(page, experience);
  const openerLabel = normalized(await opener.innerText?.().catch(() => undefined)
    ?? await opener.textContent?.().catch(() => undefined)
    ?? "");
  if (openerLabel.length === 0 || opener.click === undefined) {
    throw new Error(`${experienceLabel(experience)} configuration opener did not expose a label and click action.`);
  }

  await opener.click();
  await wait(Math.min(settleMs, 750));
  const simplified = (await readChatPopover(page)).snapshot;
  if (simplified !== undefined) {
    try {
      return await captureSimplifiedConfigurationMenu(page, experience, openerLabel, simplified);
    } finally {
      await setChatPopoverView(page, simplified.view).catch(() => undefined);
      await closeFloatingMenus(page).catch(() => undefined);
    }
  }

  let root = await waitForRawConfigurationRoot(page, expectedRowCount, 5_000);
  const initialAdvancedExpanded = root.advanced.expanded;

  try {
    if (!root.advanced.expanded) {
      await setAdvancedExpansion(page, true, expectedRowCount);
      root = await readRawConfigurationRoot(page, expectedRowCount);
    }

    const orderedRows = experience === "chat"
      ? assignOrderedChatConfigurationRows(root.rows)
      : assignOrderedWorkConfigurationRows(root.rows);
    const rowsWithOptions: RawConfigurationRow[] = [];
    for (const row of orderedRows) {
      const locator = page.getByRole?.("menuitem", { name: row.label, exact: true });
      const rowCount = await locator?.count?.().catch(() => 0) ?? 0;
      if (rowCount !== 1 || locator?.click === undefined) {
        throw new Error(`${experienceLabel(experience)} configuration row ${JSON.stringify(row.label)} was missing or ambiguous.`);
      }
      const shouldCapture = row.axis !== "model" || captureModelOptions;
      let options: Array<{ label: string; checked: boolean }> = [];
      if (shouldCapture) {
        await locator.click();
        await wait(250);
        options = await readVisibleSubmenuOptions(page);
        if (options.length === 0) {
          throw new Error(`${experienceLabel(experience)} ${row.axis} submenu exposed no options.`);
        }
        await page.keyboard?.press?.("Escape").catch(() => undefined);
        await wait(100);
      }
      rowsWithOptions.push({ ...row, options });
    }

    const rows = experience === "chat"
      ? assignOrderedChatConfigurationRows(rowsWithOptions)
      : assignOrderedWorkConfigurationRows(rowsWithOptions);
    const effort = rows.find(row => row.axis === "effort");
    const valueLabel = effort?.valueLabel ?? effort?.options.find(option => option.checked)?.label ?? openerLabel;
    return {
      openerLabel,
      power: { ...root.power, valueLabel },
      advanced: { ...root.advanced, initiallyExpanded: initialAdvancedExpanded },
      rows
    } as CapturedConfigurationMenu<CapturedChatConfigurationRow> | CapturedConfigurationMenu<CapturedWorkConfigurationRow>;
  } finally {
    await restoreAdvancedExpansion(page, opener, initialAdvancedExpanded, expectedRowCount);
    await closeFloatingMenus(page).catch(() => undefined);
  }
}

type SimplifiedPopoverLabels = {
  powerAxisLabel: string;
  modelAxisLabel: string;
  sliderIndex: number;
  minimum: number;
  maximum: number;
  current: number;
  valueText: string;
  direction: "ltr" | "rtl";
};

type RawSimplifiedPopoverLabels = Omit<SimplifiedPopoverLabels, "valueText" | "minimum" | "maximum" | "current"> & {
  minimum: number | undefined;
  maximum: number | undefined;
  current: number | undefined;
  ariaValueText: string;
  descriptions: string[];
};

async function captureSimplifiedConfigurationMenu(
  page: PageLike,
  experience: "chat" | "work",
  openerLabel: string,
  initial: ChatPopoverSnapshot
): Promise<CapturedConfigurationMenu<CapturedChatConfigurationRow> | CapturedConfigurationMenu<CapturedWorkConfigurationRow>> {
  const simple = await setChatPopoverView(page, "simple");
  if (simple === undefined) {
    throw new Error(`${experienceLabel(experience)} simplified configuration did not expose a labeled Power slider.`);
  }
  const labels = await readSimplifiedPopoverLabels(page);
  const effortOptions = await captureSimplifiedEffortOptions(page, labels);
  const advanced = await setChatPopoverView(page, "advanced");
  if (advanced === undefined || advanced.modelOptions.length === 0) {
    throw new Error(`${experienceLabel(experience)} simplified configuration did not expose model options.`);
  }
  const modelRow: RawConfigurationRow = {
    label: labels.modelAxisLabel,
    axisLabel: labels.modelAxisLabel,
    options: advanced.modelOptions.map(option => ({ label: option.label, checked: option.checked }))
  };
  const effortRow: RawConfigurationRow = {
    label: labels.powerAxisLabel,
    axisLabel: labels.powerAxisLabel,
    options: effortOptions
  };
  const power: CapturedPowerControl = {
    axisLabel: labels.powerAxisLabel,
    valueLabel: labels.valueText,
    minimum: labels.minimum,
    maximum: labels.maximum,
    value: labels.current,
    position: labels.current - labels.minimum + 1,
    count: labels.maximum - labels.minimum + 1
  };
  if (experience === "chat") {
    return {
      openerLabel,
      power,
      rows: assignOrderedChatConfigurationRows([modelRow, effortRow])
    };
  }
  // The simplified Work popover exposes Fast as a checkbox rather than a
  // two-option localized row. Keep the required axis position but leave its
  // options empty so the reviewed applier preserves previously verified
  // Standard/Fast labels instead of guessing an unrendered translation.
  const speedRow: RawConfigurationRow = { label: "", axisLabel: "", options: [] };
  return {
    openerLabel,
    power,
    rows: assignOrderedWorkConfigurationRows([modelRow, effortRow, speedRow])
  };
}

async function readSimplifiedPopoverLabels(page: PageLike): Promise<SimplifiedPopoverLabels> {
  const labels: RawSimplifiedPopoverLabels | undefined = await page.evaluate?.(() => {
    const visible = (element: Element): boolean => {
      const rect = (element as HTMLElement).getBoundingClientRect?.();
      const style = window.getComputedStyle?.(element as HTMLElement);
      return rect !== undefined && rect.width > 0 && rect.height > 0
        && style?.display !== "none" && style?.visibility !== "hidden";
    };
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const roots = Array.from(document.querySelectorAll('[data-testid="composer-intelligence-picker-content"]'))
      .filter(visible);
    if (roots.length !== 1) return undefined;
    const root = roots[0]!;
    const simple = root.querySelector('[data-testid="composer-model-picker-slider-simple-view"][data-active="true"]');
    const slider = simple?.querySelector('[role="slider"]');
    const power = slider?.closest('[role="menuitem"]');
    const toggle = Array.from(root.querySelectorAll('[role="menuitem"][data-interactive="true"]'))
      .find(visible);
    const powerAxisLabel = normalize(power?.getAttribute("aria-label") ?? "");
    const modelAxisLabel = normalize(toggle?.getAttribute("aria-label") ?? "");
    const integer = (name: string): number | undefined => {
      const raw = slider?.getAttribute(name);
      return raw !== null && raw !== undefined && /^-?\d+$/.test(raw)
        && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined;
    };
    const minimum = integer("aria-valuemin");
    const maximum = integer("aria-valuemax");
    const current = integer("aria-valuenow");
    const descriptions = (power?.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .slice(0, 8)
      .map(id => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
      .map(element => normalize(element.innerText ?? element.textContent ?? ""));
    const ariaValueText = normalize(slider?.getAttribute("aria-valuetext") ?? "");
    const sliders = simple === null ? [] : Array.from(simple.querySelectorAll('[role="slider"]'));
    const sliderIndex = slider === null || slider === undefined ? -1 : sliders.indexOf(slider);
    const direction = slider !== null && slider !== undefined && window.getComputedStyle(slider).direction === "rtl"
      ? "rtl" as const
      : "ltr" as const;
    return { powerAxisLabel, modelAxisLabel, sliderIndex, minimum, maximum, current, ariaValueText, descriptions, direction };
  });
  const valueText = simplifiedSliderValue(labels?.ariaValueText, labels?.descriptions ?? []);
  if (labels === undefined || labels.powerAxisLabel.length === 0 || labels.modelAxisLabel.length === 0
    || valueText.length === 0 || labels.minimum === undefined || labels.maximum === undefined
    || labels.current === undefined || labels.sliderIndex < 0 || labels.maximum <= labels.minimum
    || labels.current < labels.minimum || labels.current > labels.maximum) {
    throw new Error(`Simplified configuration axis labels were missing or ambiguous; state=${JSON.stringify({
      root: labels !== undefined,
      powerLabel: (labels?.powerAxisLabel.length ?? 0) > 0,
      modelLabel: (labels?.modelAxisLabel.length ?? 0) > 0,
      valueText: valueText.length > 0,
      sliderIndex: labels?.sliderIndex,
      minimum: labels?.minimum,
      maximum: labels?.maximum,
      current: labels?.current
    })}.`);
  }
  return {
    powerAxisLabel: labels.powerAxisLabel,
    modelAxisLabel: labels.modelAxisLabel,
    sliderIndex: labels.sliderIndex,
    minimum: labels.minimum,
    maximum: labels.maximum,
    current: labels.current,
    valueText,
    direction: labels.direction
  };
}

export function simplifiedSliderValue(
  ariaValueText: string | undefined,
  descriptions: readonly string[]
): string {
  const aria = normalized(ariaValueText);
  if (aria.length > 0) return aria;
  return descriptions
    .map(cleanCapturedSliderLabel)
    .find(description => description.length > 0) ?? "";
}

export function simplifiedSliderStepKey(
  direction: "ltr" | "rtl",
  increment: boolean
): "ArrowLeft" | "ArrowRight" {
  return increment === (direction === "ltr") ? "ArrowRight" : "ArrowLeft";
}

async function captureSimplifiedEffortOptions(
  page: PageLike,
  initial: SimplifiedPopoverLabels
): Promise<Array<{ label: string; checked: boolean }>> {
  const options: Array<{ label: string; checked: boolean }> = [];
  let current = initial;
  try {
    for (let value = initial.minimum; value <= initial.maximum; value += 1) {
      current = await moveSimplifiedSlider(page, current, value);
      options.push({ label: current.valueText, checked: value === initial.current });
    }
  } finally {
    if (current.current !== initial.current) {
      await moveSimplifiedSlider(page, current, initial.current);
    }
  }
  return options;
}

async function moveSimplifiedSlider(
  page: PageLike,
  before: SimplifiedPopoverLabels,
  target: number
): Promise<SimplifiedPopoverLabels> {
  const original = before;
  let current = before;
  for (let attempt = 0; attempt < 32 && current.current !== target; attempt += 1) {
    if (current.minimum !== original.minimum || current.maximum !== original.maximum) {
      throw new Error("Simplified configuration Power slider changed shape during traversal.");
    }
    const sliders = page.locator?.('[data-testid="composer-model-picker-slider-simple-view"][data-active="true"] [role="slider"]');
    const locator = sliders?.nth?.(current.sliderIndex) ?? (current.sliderIndex === 0 ? sliders : undefined);
    if (locator?.press === undefined || await locator.count?.().catch(() => 0) !== 1) {
      throw new Error("Simplified configuration Power slider was missing or ambiguous during traversal.");
    }
    await locator.press(simplifiedSliderStepKey(current.direction, target > current.current));
    await wait(100);
    const after = await readSimplifiedPopoverLabels(page);
    const expected = current.current + (target > current.current ? 1 : -1);
    if (after.current !== expected) {
      throw new Error(`Simplified configuration Power slider moved to ${after.current}; expected ${expected}.`);
    }
    current = after;
  }
  if (current.current !== target) {
    throw new Error(`Simplified configuration Power slider did not reach position ${target}.`);
  }
  return current;
}

async function findConfigurationOpener(page: PageLike, experience: "chat" | "work") {
  const deadline = Date.now() + 5_000;
  let lastCounts: number[] = [];
  for (;;) {
    const candidates = [
      page.locator?.("main form button.__composer-pill")?.last?.(),
      page.locator?.("main button.__composer-pill")?.last?.(),
      page.locator?.("button.__composer-pill")?.last?.()
    ];
    lastCounts = [];
    for (const candidate of candidates) {
      const count = await candidate?.count?.().catch(() => 0) ?? 0;
      lastCounts.push(count);
      if (count === 1 && candidate !== undefined) return candidate;
    }
    if (Date.now() >= deadline) break;
    await wait(250);
  }
  const diagnostic = await page.evaluate?.(() => ({
    htmlLang: document.documentElement.lang,
    url: location.href.replace(/\/c\/[^/?#]+/i, "/c/sanitized"),
    dialogCount: document.querySelectorAll("[role='dialog']").length,
    composerPillCount: document.querySelectorAll("button.__composer-pill").length,
    mainComposerPillCount: document.querySelectorAll("main button.__composer-pill").length,
    mainTextboxCount: document.querySelectorAll("main textarea, main [contenteditable='true'], main [role='textbox']").length
  })).catch(() => undefined);
  throw new Error(`Expected one ${experienceLabel(experience)} configuration opener; locatorCounts=${lastCounts.join(",")}; state=${JSON.stringify(diagnostic ?? {})}.`);
}

type RawConfigurationRoot = {
  power: Omit<CapturedPowerControl, "valueLabel">;
  advanced: CapturedAdvancedControl;
  rows: RawConfigurationRow[];
};

async function readRawConfigurationRoot(page: PageLike, expectedRowCount: number): Promise<RawConfigurationRoot> {
  const capture = await page.evaluate?.((wantedRowCount: number) => {
    const visible = (element: Element): boolean => {
      const rect = (element as HTMLElement).getBoundingClientRect?.();
      const style = window.getComputedStyle?.(element as HTMLElement);
      return rect !== undefined && rect.width > 0 && rect.height > 0
        && style?.display !== "none" && style?.visibility !== "hidden";
    };
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const menus = Array.from(document.querySelectorAll("[role='menu']")).filter(visible);
    const root = menus.find(menu => {
      const rows = menu.querySelectorAll("[role='menuitem'][data-has-submenu], [role='menuitem'][aria-haspopup='menu']");
      return rows.length === wantedRowCount && menu.querySelector("[role='slider']") !== null;
    });
    if (root === undefined) return undefined;
    const slider = root.querySelector("[role='slider']");
    const powerItem = Array.from(root.querySelectorAll("[role='menuitem']"))
      .find(item => !item.hasAttribute("data-has-submenu") && item.getAttribute("aria-label") !== null);
    const advancedItem = Array.from(root.querySelectorAll("[role='menuitem'][aria-expanded]"))
      .find(item => !item.hasAttribute("data-has-submenu") && item.getAttribute("aria-haspopup") !== "menu");
    const minimum = Number(slider?.getAttribute("aria-valuemin"));
    const maximum = Number(slider?.getAttribute("aria-valuemax"));
    const value = Number(slider?.getAttribute("aria-valuenow"));
    if (slider === null || powerItem === undefined || advancedItem === undefined
      || !Number.isFinite(minimum) || !Number.isFinite(maximum) || !Number.isFinite(value)) return undefined;
    const rows = Array.from(root.querySelectorAll("[role='menuitem'][data-has-submenu], [role='menuitem'][aria-haspopup='menu']"))
      .filter(visible)
      .map(row => {
        const html = row as HTMLElement;
        const axisLabel = normalize(row.querySelector(".truncate")?.textContent ?? "");
        const valueLabel = normalize(row.querySelector("[data-trailing-style='default']")?.textContent ?? "");
        const item: RawConfigurationRow = {
          label: normalize(row.getAttribute("aria-label") ?? html.innerText ?? row.textContent ?? ""),
          axisLabel,
          options: []
        };
        if (valueLabel.length > 0) item.valueLabel = valueLabel;
        return item;
      });
    const accessibleLabel = normalize(advancedItem.getAttribute("aria-label") ?? "");
    return {
      power: {
        axisLabel: normalize(powerItem.getAttribute("aria-label") ?? (powerItem as HTMLElement).innerText ?? powerItem.textContent ?? ""),
        minimum,
        maximum,
        value,
        position: value - minimum + 1,
        count: maximum - minimum + 1
      },
      advanced: {
        label: normalize((advancedItem as HTMLElement).innerText ?? advancedItem.textContent ?? ""),
        ...(accessibleLabel.length === 0 ? {} : { accessibleLabel }),
        expanded: advancedItem.getAttribute("aria-expanded") === "true"
      },
      rows
    };
  }, expectedRowCount);
  if (capture === undefined) {
    throw new Error(`Expected one Power/Advanced menu with ${expectedRowCount} configuration rows.`);
  }
  if (capture.rows.length !== expectedRowCount) {
    throw new Error(`Expected ${expectedRowCount} visible configuration rows; observed ${capture.rows.length}.`);
  }
  if (capture.power.axisLabel.length === 0 || capture.advanced.label.length === 0) {
    throw new Error("Power or Advanced labels were empty.");
  }
  return capture;
}

async function waitForRawConfigurationRoot(
  page: PageLike,
  expectedRowCount: number,
  timeoutMs: number
): Promise<RawConfigurationRoot> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      return await readRawConfigurationRoot(page, expectedRowCount);
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    await wait(250);
  }
}

async function setAdvancedExpansion(page: PageLike, expanded: boolean, expectedRowCount: number): Promise<void> {
  const root = await readRawConfigurationRoot(page, expectedRowCount);
  if (root.advanced.expanded === expanded) return;
  const toggle = page.locator?.("[role='menu'] [role='menuitem'][aria-expanded]:not([data-has-submenu]):not([aria-haspopup='menu'])")?.last?.();
  const count = await toggle?.count?.().catch(() => 0) ?? 0;
  if (count !== 1 || toggle === undefined) {
    throw new Error("Advanced configuration toggle was missing or ambiguous.");
  }
  if (toggle.press !== undefined) {
    await toggle.press("Enter");
  } else if (toggle.click !== undefined) {
    await toggle.click();
  } else {
    throw new Error("Advanced configuration toggle was not actionable.");
  }
  await wait(250);
  const after = await readRawConfigurationRoot(page, expectedRowCount);
  if (after.advanced.expanded !== expanded) {
    throw new Error(`Advanced configuration toggle did not become ${expanded ? "expanded" : "compact"}.`);
  }
}

async function restoreAdvancedExpansion(
  page: PageLike,
  opener: LocatorLike,
  initiallyExpanded: boolean,
  expectedRowCount: number
): Promise<void> {
  await page.keyboard?.press?.("Escape").catch(() => undefined);
  let root = await readRawConfigurationRoot(page, expectedRowCount).catch(() => undefined);
  if (root === undefined) {
    await opener.click?.();
    await wait(200);
    root = await readRawConfigurationRoot(page, expectedRowCount);
  }
  if (root.advanced.expanded !== initiallyExpanded) {
    await setAdvancedExpansion(page, initiallyExpanded, expectedRowCount);
  }
}

function experienceLabel(experience: "chat" | "work"): string {
  return experience === "chat" ? "Chat" : "Work";
}

async function readVisibleSubmenuOptions(page: PageLike): Promise<Array<{ label: string; checked: boolean }>> {
  return await page.evaluate?.(() => {
    const visible = (element: Element): boolean => {
      const rect = (element as HTMLElement).getBoundingClientRect?.();
      const style = window.getComputedStyle?.(element as HTMLElement);
      return rect !== undefined && rect.width > 0 && rect.height > 0
        && style?.display !== "none" && style?.visibility !== "hidden";
    };
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const menus = Array.from(document.querySelectorAll("[role='menu']")).filter(visible);
    const submenu = [...menus].reverse().find(menu => menu.querySelector("[role='menuitemradio']") !== null);
    if (submenu === undefined) return [];
    return Array.from(submenu.querySelectorAll("[role='menuitemradio']"))
      .filter(visible)
      .map(option => {
        const contentRoot = Array.from(option.children)
          .find(child => !child.hasAttribute("data-trailing-style"));
        const primary = contentRoot?.children.item(0) ?? contentRoot;
        return {
          label: normalize(primary?.textContent
            ?? option.querySelector(".truncate")?.textContent
            ?? option.getAttribute("aria-label")
            ?? (option as HTMLElement).innerText
            ?? option.textContent
            ?? ""),
          checked: option.getAttribute("aria-checked") === "true"
            || option.getAttribute("data-state") === "checked"
        };
      })
      .filter(option => option.label.length > 0);
  }) ?? [];
}

async function clickPagePoint(page: PageLike, point: { x: number; y: number }): Promise<void> {
  const pageWithMouse = page as PageLike & { mouse?: { click?: (x: number, y: number) => Promise<void> } };
  if (pageWithMouse.mouse?.click !== undefined) {
    await pageWithMouse.mouse.click(point.x, point.y);
    return;
  }

  const body = page.locator?.("body");
  if (body?.click === undefined) {
    throw new Error("Page does not expose pointer click support.");
  }
  await body.click({ position: { x: point.x, y: point.y } });
}

async function captureGenerationStateLabels(
  page: PageLike,
  options: Pick<CaptureOptions, "generationPrompt" | "generationCaptureTimeoutMs" | "settleMs">
): Promise<GenerationStateCapture> {
  const warnings: string[] = [];
  const before = await readGenerationUiSnapshot(page).catch((): GenerationUiSnapshot => ({ controls: [], shortLatestAssistantTexts: [] }));
  let submitted = false;
  let stopped = false;
  let stopFailure: unknown;
  let active = before;
  let stopLabels: string[] = [];

  try {
    if (snapshotLooksActive(before)) {
      warnings.push("Generation controls were already visible before the probe; capturing existing controls without submitting another prompt.");
    } else {
      submitted = await submitGenerationProbePrompt(page, options.generationPrompt);
    }

    active = await waitForGenerationUiSnapshot(page, before, options.generationCaptureTimeoutMs).catch(error => {
      warnings.push(`Generation control capture timed out: ${error instanceof Error ? error.message : String(error)}`);
      return before;
    });
    stopLabels = generationStopLabels(before, active);
    if (stopLabels.length === 0) {
      warnings.push("No generation stop labels were observed; leaving stopControl unchanged for this locale.");
    }
  } catch (error) {
    warnings.push(`Generation probe failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (submitted || stopLabels.length > 0) {
      try {
        stopped = await stopGenerationIfVisible(page, stopLabels);
      } catch (error) {
        stopFailure = error;
        warnings.push(`Unable to stop generation after probe: ${error instanceof Error ? error.message : String(error)}`);
      }
      await wait(options.settleMs);
    }
  }

  const afterStop = await readGenerationUiSnapshot(page).catch((): GenerationUiSnapshot => ({ controls: [], shortLatestAssistantTexts: [] }));
  const stoppedLabels = stopped ? generationStoppedLabels(before, active, afterStop) : [];
  if (submitted && !stopped) {
    warnings.push("Generation probe was submitted but no stop action was confirmed.");
  }
  if (stopFailure !== undefined) {
    throw new Error(`Generation probe cleanup could not be verified: ${stopFailure instanceof Error ? stopFailure.message : String(stopFailure)}`);
  }

  return {
    stopLabels,
    stoppedLabels,
    signals: dedupeStrings([
      ...stopLabels,
      ...stoppedLabels,
      ...active.controls.map(control => control.label)
    ]).slice(0, 20),
    warnings,
    submitted,
    stopped
  };
}

async function submitGenerationProbePrompt(page: PageLike, prompt: string): Promise<boolean> {
  await closeFloatingMenus(page);
  const textbox = page.locator?.("textarea, [contenteditable='true']")?.last?.()
    ?? page.getByRole?.("textbox")?.last?.();
  if (textbox?.click === undefined || textbox.fill === undefined) {
    throw new Error("Composer textbox was not available for generation probe.");
  }
  await textbox.click();
  await textbox.fill(prompt);
  if (page.keyboard?.press !== undefined) {
    await page.keyboard.press("Enter");
    return true;
  }
  const clicked = await clickSubmitControlByDom(page);
  if (!clicked) {
    throw new Error("No structural submit control was available for generation probe.");
  }
  return true;
}

async function clickSubmitControlByDom(page: PageLike): Promise<boolean> {
  const structuralSelectors = [
    "form button[data-testid='send-button']",
    "form button#composer-submit-button",
    "button[data-testid='send-button']",
    "button#composer-submit-button"
  ];
  for (const selector of structuralSelectors) {
    const button = page.locator?.(selector)?.last?.();
    if (button?.click === undefined) continue;
    const clicked = await button.click().then(() => true, () => false);
    if (clicked) return true;
  }

  if (typeof page.evaluate !== "function") return false;
  return page.evaluate(() => {
    const isButtonElement = (element: Element): element is HTMLButtonElement =>
      element.tagName.toLowerCase() === "button";
    const visible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0";
    };
    const buttons = Array.from(document.querySelectorAll("form button, button"))
      .filter((button): button is HTMLButtonElement => {
        if (!isButtonElement(button)) return false;
        if ((button as HTMLButtonElement).disabled || button.getAttribute("aria-disabled") === "true") return false;
        if (!visible(button)) return false;
        const text = [
          button.textContent,
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          button.getAttribute("data-testid")
        ].filter(Boolean).join(" ");
        return /send|submit|composer-submit|arrow-up/i.test(text);
      });
    let button = buttons.at(-1);
    if (button === undefined) {
      const structural = Array.from(document.querySelectorAll("form button"))
        .filter((candidate): candidate is HTMLButtonElement => {
          if (!isButtonElement(candidate)) return false;
          if ((candidate as HTMLButtonElement).disabled || candidate.getAttribute("aria-disabled") === "true") return false;
          if (!visible(candidate)) return false;
          const text = [
            candidate.textContent,
            candidate.getAttribute("aria-label"),
            candidate.getAttribute("title"),
            candidate.getAttribute("data-testid"),
            candidate.id
          ].filter(Boolean).join(" ");
          return !/composer-plus|plus|attach|file|microphone|mic|dictat|voice|audio|intelligence|model|tool/i.test(text);
        })
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return (rightRect.bottom + rightRect.right / 10) - (leftRect.bottom + leftRect.right / 10);
        });
      button = structural[0];
    }
    if (button === undefined) return false;
    button.click();
    return true;
  }).catch(() => false);
}

async function waitForGenerationUiSnapshot(
  page: PageLike,
  before: GenerationUiSnapshot,
  timeoutMs: number
): Promise<GenerationUiSnapshot> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = await readGenerationUiSnapshot(page);
    if (generationStopLabels(before, current).length > 0 || snapshotLooksActive(current)) {
      return current;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for generation controls.");
    }
    await wait(500);
  }
}

async function readGenerationUiSnapshot(page: PageLike): Promise<GenerationUiSnapshot> {
  if (typeof page.evaluate !== "function") {
    return { controls: [], shortLatestAssistantTexts: [] };
  }
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const visible = (element: Element) => {
      if (typeof (element as HTMLElement).getBoundingClientRect !== "function") return false;
      if (element.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0"
        && style.pointerEvents !== "none";
    };
    const textboxes = Array.from(document.querySelectorAll<HTMLElement>(
      "textarea, [contenteditable='true'], [role='textbox']"
    )).filter(visible);
    const composers = [...new Set(textboxes
      .map(textbox => textbox.closest<HTMLElement>("form")
        ?? textbox.closest<HTMLElement>("[data-testid*='composer' i]")
        ?? textbox.closest<HTMLElement>("[aria-label*='composer' i]")
        ?? textbox.closest<HTMLElement>("[class*='composer' i]"))
      .filter((value): value is HTMLElement => value !== null))];
    const controls = composers.length !== 1 ? [] : Array.from(composers[0]!.querySelectorAll(
      "button, [role='button']"
    ))
      .filter(visible)
      .filter(element => !(element as HTMLButtonElement).disabled
        && element.getAttribute("aria-disabled") !== "true")
      .map(element => {
        const html = element as HTMLElement;
        const text = normalize(html.innerText || html.textContent);
        const ariaLabel = normalize(html.getAttribute("aria-label"));
        const title = normalize(html.getAttribute("title"));
        const testId = normalize(html.getAttribute("data-testid"));
        const label = ariaLabel || title || text || testId;
        return {
          label,
          text: text || undefined,
          ariaLabel: ariaLabel || undefined,
          title: title || undefined,
          testId: testId || undefined,
          role: html.getAttribute("role") ?? undefined
        };
      })
      .filter(control => control.label.length > 0);

    const turns = Array.from(document.querySelectorAll("main [data-testid^='conversation-turn']"));
    const latestAssistant = turns.reverse().find(turn =>
      turn.querySelector("[data-message-author-role='assistant']") !== null
    );
    const shortLatestAssistantTexts = latestAssistant === undefined
      ? []
      : Array.from(latestAssistant.querySelectorAll("[data-message-author-role='assistant'] *"))
        .map(element => normalize((element as HTMLElement).innerText || element.textContent))
        .filter(text => text.length > 0 && text.length <= 80);

    return { controls, shortLatestAssistantTexts };
  }).catch(() => ({ controls: [], shortLatestAssistantTexts: [] }));
}

export function generationStopLabels(before: GenerationUiSnapshot, active: GenerationUiSnapshot): string[] {
  const beforeLabels = new Set(before.controls.map(control => normalizedControlKey(control.label)));
  const candidates = active.controls
    .filter(control => looksLikeStopControl(control))
    .filter(control => !beforeLabels.has(normalizedControlKey(control.label)) || hasStableStopTestId(control))
    .map(control => control.label)
    .filter(isUsefulGenerationLabel);
  return dedupeStrings(candidates);
}

function generationStoppedLabels(
  before: GenerationUiSnapshot,
  active: GenerationUiSnapshot,
  afterStop: GenerationUiSnapshot
): string[] {
  const previous = new Set([...before.shortLatestAssistantTexts, ...active.shortLatestAssistantTexts].map(normalizedControlKey));
  const candidates = afterStop.shortLatestAssistantTexts
    .filter(text => !previous.has(normalizedControlKey(text)))
    .filter(isUsefulStoppedText);
  return dedupeStrings(candidates);
}

export function snapshotLooksActive(snapshot: GenerationUiSnapshot): boolean {
  return snapshot.controls.some(looksLikeStopControl);
}

function looksLikeStopControl(control: CapturedGenerationControl): boolean {
  return /stop|abort|interromp|unterbrech|gestoppt|arr[eê]t|detener|parar|interrumpir/i.test([
    control.label,
    control.text,
    control.ariaLabel,
    control.title,
    control.testId
  ].filter(Boolean).join(" "));
}

function hasStableStopTestId(control: CapturedGenerationControl): boolean {
  return /(?:^|[-_])stop(?:[-_]|$)/i.test(control.testId ?? "");
}

function isUsefulGenerationLabel(label: string): boolean {
  const normalized = normalizedControlKey(label);
  if (normalized.length < 2 || normalized.length > 80) return false;
  if (/^(send|send prompt|voice|dictate|start dictation|attach|add files|new chat|copy response|more actions|pro|instant|thinking|extended thinking)$/i.test(normalized)) return false;
  return true;
}

function isUsefulStoppedText(text: string): boolean {
  const normalized = normalizedControlKey(text);
  if (normalized.length < 2 || normalized.length > 80) return false;
  if (/^[\d\s.,:;!?()[\]-]+$/.test(normalized)) return false;
  if (/^localization probe/i.test(normalized)) return false;
  return true;
}

export async function stopGenerationIfVisible(page: PageLike, labels: readonly string[]): Promise<boolean> {
  if (labels.length === 0) return false;
  let selected: LocatorLike | undefined;
  for (const label of labels) {
    const eligible = await scopedStopCandidates(page, label);
    if (eligible.length === 1 && eligible[0]?.click !== undefined) {
      selected = eligible[0];
      break;
    }
  }
  if (selected?.click === undefined) return false;

  await selected.click();
  const expiresAt = Date.now() + 2_000;
  while (Date.now() < expiresAt) {
    const remaining = (await Promise.all(labels.map(label => scopedStopCandidates(page, label)))).flat();
    if (remaining.length === 0) return true;
    await wait(Math.min(100, Math.max(1, expiresAt - Date.now())));
  }
  throw new Error("The locale-capture Stop control was clicked, but generation did not become observably inactive.");
}

async function scopedStopCandidates(page: PageLike, label: string): Promise<LocatorLike[]> {
  const candidates = page.getByRole?.("button", { name: label, exact: true });
  if (candidates?.count === undefined) {
    throw new Error(`The locale-capture Stop candidates for ${JSON.stringify(label)} could not be enumerated.`);
  }
  const count = await candidates.count();
  const eligible: LocatorLike[] = [];
  for (let index = 0; index < count; index += 1) {
    const candidate = count === 1 ? candidates : candidates?.nth?.(index);
    if (candidate?.isVisible === undefined || candidate.evaluate === undefined) {
      throw new Error(`Locale-capture Stop candidate ${index + 1} for ${JSON.stringify(label)} could not be inspected.`);
    }
    if (!await candidate.isVisible()) continue;
    const scoped = await candidate.evaluate((element: Element) => {
      const button = element as HTMLButtonElement;
      if (button.disabled || button.getAttribute("aria-disabled") === "true") return false;
      const visible = (node: HTMLElement) => {
        if (node.hidden || node.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
          && style.pointerEvents !== "none" && (rect.width > 0 || rect.height > 0);
      };
      const textboxes = Array.from(document.querySelectorAll<HTMLElement>(
        "textarea, [contenteditable='true'], [role='textbox']"
      )).filter(visible);
      const composers = [...new Set(textboxes
        .map(textbox => textbox.closest<HTMLElement>("form")
          ?? textbox.closest<HTMLElement>("[data-testid*='composer' i]")
          ?? textbox.closest<HTMLElement>("[aria-label*='composer' i]")
          ?? textbox.closest<HTMLElement>("[class*='composer' i]"))
        .filter((value): value is HTMLElement => value !== null))];
      return composers.length === 1 && composers[0]!.contains(button);
    });
    if (scoped) eligible.push(candidate);
  }
  return eligible;
}

function normalizedControlKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.replace(/\s+/g, " ").trim();
    const key = trimmed.toLowerCase();
    if (trimmed.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

async function renderedProof(page: PageLike): Promise<{ htmlLang?: string; url?: string }> {
  return page.evaluate?.(() => ({
    htmlLang: document.documentElement.lang,
    url: location.href
  })) ?? {};
}

async function waitForRenderedLanguage(page: PageLike, bcp47: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const proof = await renderedProof(page);
    if (htmlLangMatches(proof.htmlLang, bcp47)) return;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for rendered language ${bcp47}; html lang is ${proof.htmlLang ?? "unknown"}.`);
    }
    await wait(500);
  }
}

function blockedRecord(
  language: CoverageLanguage,
  proof: { htmlLang?: string; url?: string },
  warnings: string[],
  code: string,
  message: string
): CaptureRecord {
  const record: CaptureRecord = {
    schemaVersion: SCHEMA_VERSION,
    status: "blocked",
    capturedAt: new Date().toISOString(),
    requestedLocale: language.bcp47,
    requestedNativeName: language.nativeName,
    warnings,
    blocker: {
      kind: "selector_drift",
      code,
      message
    }
  };
  if (proof.htmlLang !== undefined) record.htmlLang = proof.htmlLang;
  if (proof.url !== undefined) record.url = normalizeChatGPTUrl(proof.url);
  return record;
}

async function appendRecord(path: string, record: CaptureRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

function printCaptureRecord(record: CaptureRecord, out: string): void {
  if (record.status === "ok") {
    console.log(`captured ${record.requestedLocale} htmlLang=${record.htmlLang ?? "unknown"} intelligence=${record.intelligenceLabels?.length ?? 0} versions=${record.modelVersionLabels?.length ?? 0} surfaces=${record.surfaceCapture?.status ?? "not-requested"} generationStop=${record.generationStopLabels?.length ?? 0} generationStopped=${record.generationStoppedLabels?.length ?? 0} out=${out}`);
  } else {
    console.log(`blocked ${record.requestedLocale} htmlLang=${record.htmlLang ?? "unknown"} code=${record.blocker?.code ?? "unknown"} out=${out}`);
  }
}

function printQueue(languages: readonly CoverageLanguage[]): void {
  for (const language of languages) {
    console.log(`${language.bcp47.padEnd(8)} ${language.nativeName}`);
  }
}

function htmlLangMatches(htmlLang: string | undefined, bcp47: string): boolean {
  if (htmlLang === undefined || htmlLang.length === 0) return false;
  const actual = htmlLang.toLowerCase();
  const expected = bcp47.toLowerCase();
  if (actual === expected) return true;
  if (expected === "zh-hans") return actual === "zh-cn" || actual.includes("hans");
  if (expected === "zh-hk") return actual.includes("hk");
  if (expected === "zh-tw") return actual.includes("tw");
  const [base] = expected.split("-");
  return base !== undefined && actual === base || (base !== undefined && actual.startsWith(`${base}-`));
}

function normalizeChatGPTUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/chatgpt\.com$/.test(parsed.hostname)) return parsed.origin;
    return `${parsed.origin}${parsed.pathname}${parsed.hash === "#settings" ? "#settings" : ""}`;
  } catch {
    return url.slice(0, 120);
  }
}

function requiredValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new CaptureUsageError(`${flag} requires a value.\n\n${USAGE}`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CaptureUsageError(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseIfMissing(value: string): NonNullable<ExistingTabPolicy["ifMissing"]> {
  if (value === "block" || value === "open" || value === "create") return value;
  throw new CaptureUsageError("--if-missing must be one of: block, open, create.");
}

function defaultOutputPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `../../outputs/intelligence-locale-captures/${date}-intelligence-picker.jsonl`;
}

function packageRoot(): string {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(scriptDir, "../.."), resolve(scriptDir, "../../..")]) {
    if (existsSync(resolve(candidate, "package.json"))) return candidate;
  }
  return resolve(scriptDir, "../..");
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (typeof process !== "undefined" && process.argv[1] === fileURLToPath(import.meta.url)) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
