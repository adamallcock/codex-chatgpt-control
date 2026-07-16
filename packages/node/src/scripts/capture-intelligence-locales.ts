import { existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachChatGPTBrowser } from "../browser/attach.js";
import { BROWSER_BRIDGE_REMEDIATION, BROWSER_BRIDGE_UNAVAILABLE_MESSAGE } from "../errors.js";
import { localeLabels } from "../dom/locale-labels.js";
import type { BrowserLike, ExistingTabPolicy, PageLike, RuntimeEnv } from "../types.js";
import { nonEnglishLanguages, readLanguageCoverage, type CoverageLanguage } from "./locale-capture/language-coverage.js";

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

type CapturedMenuItem = {
  label: string;
  role?: string | undefined;
  checked?: boolean | undefined;
  expanded?: boolean | undefined;
  hasPopup?: string | undefined;
  testId?: string | undefined;
  ariaLabel?: string | undefined;
};

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
  warnings: string[];
  blocker?: {
    kind: string;
    code: string;
    message: string;
  };
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

  const initialLanguage = options.autoSwitch
    ? await attachCapturePage(runtime, options).then(page => readSelectedLanguage(page)).catch(() => undefined)
    : undefined;
  const sweepLanguages = resolveSweepLanguages(options, languages);
  const records: CaptureRecord[] = [];

  try {
    for (const language of sweepLanguages) {
      const page = await attachCapturePage(runtime, options);
      const record = await captureOne(page, language, options);
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
      await attachCapturePage(runtime, options).then(page => restoreLanguage(page, initialLanguage, options)).catch(error => {
        console.error(`Unable to restore initial language ${initialLanguage}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  return records.some(record => record.status === "blocked") ? 1 : 0;
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

async function captureOne(page: PageLike, language: CoverageLanguage, options: CaptureOptions): Promise<CaptureRecord> {
  const warnings: string[] = [];
  try {
    if (options.autoSwitch) {
      await switchLanguage(page, language, options);
      const proof = await renderedProof(page);
      if (!htmlLangMatches(proof.htmlLang, language.bcp47)) {
        return blockedRecord(language, proof, warnings, "rendered_locale_mismatch", `Rendered html lang ${proof.htmlLang || "unknown"} did not match requested ${language.bcp47}.`);
      }
    }

    await closeSettingsIfOpen(page);
    await returnToChatSurface(page, options);
    const picker = await captureIntelligencePicker(page, options);
    const generation = options.captureGenerationState
      ? await captureGenerationStateLabels(page, options)
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

async function switchLanguage(page: PageLike, language: CoverageLanguage, options: TimingOptions): Promise<void> {
  await openSettings(page, options);
  await openLanguageCombobox(page);
  await clickOptionExact(page, language.nativeName);
  await waitForRenderedLanguage(page, language.bcp47, options.switchTimeoutMs).catch(async () => {
    await wait(options.settleMs);
  });
}

async function restoreLanguage(page: PageLike, selectedLanguageText: string, options: TimingOptions): Promise<void> {
  await openSettings(page, options);
  await openLanguageCombobox(page);
  await clickOptionExact(page, selectedLanguageText);
  await wait(options.settleMs);
  await closeSettingsIfOpen(page);
}

async function openSettings(page: PageLike, options: Pick<CaptureOptions, "settleMs">): Promise<void> {
  if (await isSettingsOpen(page)) return;
  await closeFloatingMenus(page);
  const profile = page.locator?.("[data-testid=\"accounts-profile-button\"]")?.last?.();
  if (profile?.click === undefined) {
    throw new Error("Profile menu button was not available.");
  }
  await profile.click();
  await wait(options.settleMs);
  const settings = page.locator?.("[data-testid=\"settings-menu-item\"]")?.last?.();
  if (settings?.click === undefined) {
    throw new Error("Settings menu item was not available.");
  }
  await settings.click();
  await wait(options.settleMs);
  if (!await isSettingsOpen(page)) {
    throw new Error("Settings modal did not open.");
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

async function openLanguageCombobox(page: PageLike): Promise<void> {
  const combo = page.locator?.("button[role=\"combobox\"]")?.nth?.(3);
  if (combo?.click === undefined) {
    throw new Error("Language combobox was not available.");
  }
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

async function readSelectedLanguage(page: PageLike): Promise<string | undefined> {
  await openSettings(page, { settleMs: DEFAULT_SETTLE_MS });
  const labels = await page.evaluate?.(() =>
    Array.from(document.querySelectorAll("button[role='combobox']")).map(button => (button.textContent ?? "").replace(/\s+/g, " ").trim())
  );
  return labels?.[3];
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
}> {
  await closeFloatingMenus(page);
  await openPicker(page);
  await wait(options.settleMs);

  const first = await readPickerState(page);
  let modelVersionLabels: string[] = [];
  if (options.openVersionSubmenu && first.versionFamilyLabels.length > 0) {
    await openVersionSubmenu(page);
    await wait(options.settleMs);
    modelVersionLabels = (await readPickerState(page)).modelVersionLabels;
  }

  return { ...first, modelVersionLabels };
}

async function openPicker(page: PageLike): Promise<void> {
  const proCandidates = [
    page.locator?.("form button.__composer-pill")?.last?.(),
    page.locator?.("button.__composer-pill")?.last?.(),
    page.getByRole?.("button", { name: /^Pro$/ })?.last?.(),
    page.locator?.("button")?.filter?.({ hasText: /^Pro$/ })?.last?.(),
    page.locator?.("button")?.filter?.({ hasText: /^\s*Pro\s*$/ })?.last?.(),
  ];
  for (const proButton of proCandidates) {
    if (proButton?.click === undefined) continue;
    await proButton.click().catch(() => undefined);
    if (await pickerIsOpen(page)) return;
  }

  await clickStructuralPickerCandidate(page).catch(() => undefined);
  if (await pickerIsOpen(page)) return;

  for (const label of localeLabels.modeLabels) {
    const button = page.getByRole?.("button", { name: new RegExp(`^${escapeRegExp(label)}$`, "i") })?.last?.();
    if (button?.click === undefined) continue;
    await button.click().catch(() => undefined);
    if (await pickerIsOpen(page)) return;
  }
  throw new Error("Unable to open Intelligence picker.");
}

async function clickStructuralPickerCandidate(page: PageLike): Promise<boolean> {
  const point = await page.evaluate?.(() => {
    let targetPoint: { x: number; y: number } | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;

    const considerButton = (button: HTMLButtonElement, formScoped: boolean): void => {
      const rect = button.getBoundingClientRect();
      const text = (button.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length === 0 || text.length > 32) return;
      if (rect.width < 24 || rect.height < 24 || rect.width > 220 || rect.height > 64) return;
      if (rect.bottom < window.innerHeight * 0.45) return;
      const aria = button.getAttribute("aria-label") ?? "";
      const testId = button.getAttribute("data-testid") ?? "";
      if (/composer-plus|send|microphone|dictat|voice|audio/i.test(`${aria} ${testId}`)) return;
      const score = (formScoped ? 1000 : 0) + rect.bottom + rect.right / 10;
      if (score > bestScore) {
        bestScore = score;
        targetPoint = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
    };

    document.querySelectorAll("form button").forEach(button => considerButton(button as HTMLButtonElement, true));
    if (targetPoint === undefined) {
      document.querySelectorAll("button").forEach(button => considerButton(button as HTMLButtonElement, false));
    }
    return targetPoint;
  });
  if (point === undefined) return false;

  await clickPagePoint(page, point);
  return true;
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

async function pickerIsOpen(page: PageLike): Promise<boolean> {
  await wait(300);
  return page.evaluate?.(() =>
    document.querySelector("[data-testid='composer-intelligence-picker-content']") !== null
    || document.querySelector("[role='menuitemradio']") !== null
  ) ?? false;
}

async function readPickerState(page: PageLike): Promise<{
  htmlLang: string;
  url: string;
  menuHeading?: string;
  intelligenceLabels: string[];
  selectedIntelligenceLabel?: string;
  versionFamilyLabels: string[];
  modelVersionLabels: string[];
}> {
  return await page.evaluate?.(() => {
    const menu = document.querySelector("[data-testid='composer-intelligence-picker-content']")
      ?? Array.from(document.querySelectorAll("[role='menu']")).find(candidate => candidate.querySelector("[role='menuitemradio']"))
      ?? document;
    const menuTextLines = (menu.textContent ?? "").split(/\n/).map(line => line.trim()).filter(Boolean);
    const items = Array.from(document.querySelectorAll("[role='menuitemradio'], [role='menuitem']")).map((element) => {
      const label = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      const role = element.getAttribute("role") ?? undefined;
      return {
        label,
        role,
        checked: element.getAttribute("aria-checked") === "true",
        expanded: element.getAttribute("aria-expanded") === "true",
        hasPopup: element.getAttribute("aria-haspopup") ?? undefined,
        testId: element.getAttribute("data-testid") ?? undefined,
        ariaLabel: element.getAttribute("aria-label") ?? undefined,
      };
    }).filter(item => item.label.length > 0 || item.ariaLabel !== undefined || item.testId !== undefined);

    const radioLabels = items
      .filter(item => item.role === "menuitemradio" && item.label.length > 0)
      .map(item => item.label);
    const versionLabelPattern = /^(?:o\d+|\d+(?:\.\d+)?)$/i;
    const modelVersionLabels = radioLabels.filter(label => versionLabelPattern.test(label));
    const intelligenceLabels = radioLabels.filter(label => !versionLabelPattern.test(label));
    const selectedIntelligenceLabel = items.find(item =>
      item.role === "menuitemradio"
      && item.checked
      && item.label.length > 0
      && !versionLabelPattern.test(item.label)
    )?.label;
    const versionFamilyLabels = items
      .filter(item => item.role === "menuitem" && /^GPT[\s-]/i.test(item.label))
      .map(item => item.label);

    const result: {
      htmlLang: string;
      url: string;
      menuHeading?: string;
      intelligenceLabels: string[];
      selectedIntelligenceLabel?: string;
      versionFamilyLabels: string[];
      modelVersionLabels: string[];
      items: CapturedMenuItem[];
    } = {
      htmlLang: document.documentElement.lang,
      url: location.href,
      intelligenceLabels,
      versionFamilyLabels,
      modelVersionLabels,
      items,
    };
    const heading = menuTextLines.find(line => !radioLabels.includes(line) && !/^GPT[\s-]/i.test(line));
    if (heading !== undefined) result.menuHeading = heading;
    if (selectedIntelligenceLabel !== undefined) result.selectedIntelligenceLabel = selectedIntelligenceLabel;
    return result;
  }) ?? {
    htmlLang: "",
    url: "",
    intelligenceLabels: [],
    versionFamilyLabels: [],
    modelVersionLabels: []
  };
}

async function openVersionSubmenu(page: PageLike): Promise<void> {
  const gptCandidates = [
    page.getByRole?.("menuitem", { name: /^GPT[\s-]/i })?.last?.(),
    page.locator?.("[role='menuitem']")?.filter?.({ hasText: /^GPT[\s-]/i })?.last?.(),
  ];
  for (const gptMenu of gptCandidates) {
    if (gptMenu?.click === undefined) continue;
    await gptMenu.click().catch(() => undefined);
    if ((await readPickerState(page)).modelVersionLabels.length > 0) return;
  }
}

async function captureGenerationStateLabels(
  page: PageLike,
  options: Pick<CaptureOptions, "generationPrompt" | "generationCaptureTimeoutMs" | "settleMs">
): Promise<GenerationStateCapture> {
  const warnings: string[] = [];
  const before = await readGenerationUiSnapshot(page).catch((): GenerationUiSnapshot => ({ controls: [], shortLatestAssistantTexts: [] }));
  let submitted = false;
  let stopped = false;
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
    if (submitted || stopLabels.length > 0 || snapshotLooksActive(active)) {
      stopped = await stopGenerationIfVisible(page, stopLabels).catch(error => {
        warnings.push(`Unable to stop generation after probe: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      });
      await wait(options.settleMs);
    }
  }

  const afterStop = await readGenerationUiSnapshot(page).catch((): GenerationUiSnapshot => ({ controls: [], shortLatestAssistantTexts: [] }));
  const stoppedLabels = stopped ? generationStoppedLabels(before, active, afterStop) : [];
  if (submitted && !stopped) {
    warnings.push("Generation probe was submitted but no stop action was confirmed.");
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
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0"
        && element.getAttribute("aria-hidden") !== "true";
    };
    const relevantSurface = (element: Element) =>
      element.closest("main, form") !== null
      && element.closest("nav, aside") === null;
    const controls = Array.from(document.querySelectorAll("main button, main [role='button'], form button, form [role='button']"))
      .filter(visible)
      .filter(relevantSurface)
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

function generationStopLabels(before: GenerationUiSnapshot, active: GenerationUiSnapshot): string[] {
  const beforeLabels = new Set(before.controls.map(control => normalizedControlKey(control.label)));
  const candidates = active.controls
    .filter(control => !beforeLabels.has(normalizedControlKey(control.label)) || looksLikeStopControl(control))
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

function snapshotLooksActive(snapshot: GenerationUiSnapshot): boolean {
  return snapshot.controls.some(looksLikeStopControl);
}

function looksLikeStopControl(control: CapturedGenerationControl): boolean {
  return /stop|cancel|abort|interromp|unterbrech|gestoppt|arr[eê]t|detener|parar|interrumpir/i.test([
    control.label,
    control.text,
    control.ariaLabel,
    control.title,
    control.testId
  ].filter(Boolean).join(" "));
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

async function stopGenerationIfVisible(page: PageLike, labels: readonly string[]): Promise<boolean> {
  for (const label of labels) {
    const roleButton = page.getByRole?.("button", { name: label, exact: true })?.last?.();
    if (roleButton?.click !== undefined) {
      await roleButton.click().catch(() => undefined);
      await wait(500);
      return true;
    }
  }
  if (typeof page.evaluate !== "function") return false;
  return page.evaluate((wantedLabels: string[]) => {
    const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const wanted = new Set(wantedLabels.map(label => label.toLowerCase()));
    const relevantSurface = (element: Element) =>
      element.closest("main, form") !== null
      && element.closest("nav, aside") === null;
    const visible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0";
    };
    const buttons = Array.from(document.querySelectorAll("main button, main [role='button'], form button, form [role='button']"))
      .filter((button): button is HTMLElement =>
        typeof (button as HTMLElement).getBoundingClientRect === "function" && visible(button as HTMLElement)
      )
      .filter(relevantSurface);
    const match = buttons.find(button => {
      const label = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.innerText,
        button.textContent,
        button.getAttribute("data-testid")
      ].map(normalize).filter(Boolean).join(" ");
      return wanted.has(label)
        || /stop|cancel|abort|interromp|unterbrech|gestoppt|arr[eê]t|detener|parar|interrumpir/i.test(label);
    });
    if (match === undefined) return false;
    match.click();
    return true;
  }, [...labels]).catch(() => false);
}

function normalizedControlKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
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
    console.log(`captured ${record.requestedLocale} htmlLang=${record.htmlLang ?? "unknown"} intelligence=${record.intelligenceLabels?.length ?? 0} versions=${record.modelVersionLabels?.length ?? 0} generationStop=${record.generationStopLabels?.length ?? 0} generationStopped=${record.generationStoppedLabels?.length ?? 0} out=${out}`);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (typeof process !== "undefined" && process.argv[1] === fileURLToPath(import.meta.url)) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
