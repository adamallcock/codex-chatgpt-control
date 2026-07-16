import { enumerateVisibleMenuItems, type MenuItem } from "../dom/menus.js";
import { localeLabels } from "../dom/locale-labels.js";
import { normalizeForLabelMatch, visibleLabelMatches } from "../dom/label-match.js";
import { resultError, resultOk } from "../errors.js";
import type {
  AppliedConfigurationSelection,
  ApplyConfigurationArgs,
  ApplyConfigurationData,
  ChatGPTExperience,
  CommandResult,
  ConfigurationAxis,
  ConfigurationInspectionData,
  ConfigurationOption,
  ConfigurationSelection,
  InspectConfigurationArgs,
  LocatorLike,
  PageLike,
  RuntimeEnv,
  SurfaceSelectorProfile
} from "../types.js";
import { contextFromPage } from "./context.js";
import { detectExperience, openExperience } from "./experience.js";
import { setMode } from "./modes.js";
import { ensurePage } from "./session.js";

const WORK_AXES: ConfigurationAxis[] = ["model", "effort", "speed"];
const CONFIGURATION_AXIS_ORDER: ConfigurationAxis[] = [
  "model",
  "intelligence",
  "effort",
  "speed",
  "modelVersion",
];

export type ConfigurationPanelSnapshot = {
  openerLabel?: string;
  axisRows: Array<{ axis: ConfigurationAxis; label: string; value?: string }>;
  advancedVisible: boolean;
};

export async function inspectConfiguration(
  env: RuntimeEnv,
  args: InspectConfigurationArgs = {}
): Promise<CommandResult<ConfigurationInspectionData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<ConfigurationInspectionData>;
  }

  const page = env.page!;
  try {
    const detected = await detectExperience(
      env,
      args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }
    );
    if (!detected.ok || detected.data === undefined) {
      return forwardFailure(detected);
    }
    if (args.experience !== undefined && detected.data.experience !== args.experience) {
      return {
        ok: false,
        status: "unsupported",
        warnings: [],
        blocker: {
          kind: "selector_drift",
          code: "experience_mismatch",
          fieldPath: "experience",
          message: `Configuration inspection expected ${args.experience}, but the visible composer is ${detected.data.experience}. Call experience.open first or omit the expected experience.`,
          resumable: true
        },
        context: await contextFromPage(page, {
          experience: detected.data.experience,
          selectorProfile: detected.data.selectorProfile
        })
      };
    }

    const experience = detected.data.experience;
    const rootOpened = experience !== "unknown" && await openConfigurationRoot(page, experience);
    if (rootOpened) {
      await page.waitForTimeout?.(150);
    }

    const panel = await readConfigurationPanel(page);
    const rootItems = rootOpened ? await enumerateVisibleMenuItems(page) : [];
    const data = configurationInspectionFromSurface(
      experience,
      detected.data.selectorProfile,
      detected.data.evidence,
      panel,
      rootItems
    );

    if (args.includeOptions !== false && experience === "work" && panel.axisRows.length > 0) {
      for (const axis of WORK_AXES) {
        if (!data.availableAxes.includes(axis)) continue;
        const options = await inspectWorkAxisOptions(page, axis);
        if (options.length > 0) {
          data.options[axis] = options;
        }
      }
      await closeConfigurationMenus(page);
    }

    const warnings: string[] = [];
    if (!rootOpened) {
      warnings.push("No scoped configuration opener was available; inspection is limited to controls already visible in the composer.");
    }
    if (!data.verified) {
      warnings.push("The visible configuration could not be verified from a recognized Chat or Work selector profile.");
    }

    return resultOk(data, await contextFromPage(page, {
      experience: data.experience,
      selectorProfile: data.selectorProfile
    }), warnings);
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

export async function applyConfiguration(
  env: RuntimeEnv,
  args: ApplyConfigurationArgs
): Promise<CommandResult<ApplyConfigurationData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<ApplyConfigurationData>;
  }

  const page = env.page!;
  const strict = args.strict ?? true;
  try {
    const desired = normalizeDesiredSelection(args.desired);
    if (selectionEntries(desired).length === 0) {
      return {
        ok: false,
        status: "unsupported",
        warnings: [],
        blocker: {
          kind: "selector_drift",
          code: "configuration_empty",
          fieldPath: "desired",
          message: "configuration.apply requires at least one desired model, intelligence, effort, speed, or modelVersion value.",
          resumable: false
        },
        context: await contextFromPage(page)
      };
    }

    if (args.experience !== undefined) {
      const opened = await openExperience(env, {
        experience: args.experience,
        ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
      });
      if (!opened.ok) {
        return forwardFailure(opened);
      }
    }

    const beforeResult = await inspectConfiguration(env, {
      ...(args.experience === undefined ? {} : { experience: args.experience }),
      includeOptions: true,
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
    });
    if (!beforeResult.ok || beforeResult.data === undefined) {
      return forwardFailure(beforeResult);
    }
    const before = beforeResult.data;
    if (before.experience === "unknown") {
      return configurationFailure(page, before, desired, [], "The visible surface is not recognizable as Chat or Work.", "experience_unknown");
    }

    const selected: AppliedConfigurationSelection[] = [];
    for (const [axis, requested] of selectionEntries(desired)) {
      const active = activeConfigurationValue(before, axis);
      if (active !== undefined && configurationValueMatches(active, requested)) {
        selected.push({ axis, requested, selected: active });
        continue;
      }

      const selection = before.experience === "work"
        ? await selectWorkAxis(page, axis, requested)
        : await selectChatAxis(env, axis, requested, args.timeoutMs);
      if (selection === undefined) {
        return configurationFailure(
          page,
          before,
          desired,
          selected,
          `Configuration option "${requested}" for ${axis} was not found or was ambiguous on the ${before.experience} surface.`,
          "configuration_option_not_found",
          before.options[axis]?.map(option => option.label)
        );
      }
      selected.push({ axis, requested, selected: selection });
    }

    const afterResult = await inspectConfiguration(env, {
      ...(args.experience === undefined ? {} : { experience: args.experience }),
      includeOptions: false,
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
    });
    if (!afterResult.ok || afterResult.data === undefined) {
      return forwardFailure(afterResult);
    }
    const after = afterResult.data;
    const verified = configurationMatchesSelection(after, desired);
    const data: ApplyConfigurationData = { requested: desired, selected, before, after, verified };
    if (!verified && strict) {
      return {
        ok: false,
        status: "blocked",
        data,
        warnings: [],
        blocker: {
          kind: "selector_drift",
          code: "configuration_postcondition_unverified",
          fieldPath: "desired",
          message: `ChatGPT accepted configuration clicks, but the visible ${after.experience} controls do not verify every requested value.`,
          candidates: Object.entries(after.active).map(([axis, label]) => ({ label: `${axis}: ${label}` })),
          resumable: true
        },
        context: await contextFromPage(page, {
          experience: after.experience,
          selectorProfile: after.selectorProfile
        })
      };
    }

    const warnings = verified
      ? []
      : ["Configuration clicks completed, but strict verification was disabled and the visible postcondition remains unverified."];
    return resultOk(data, await contextFromPage(page, {
      experience: after.experience,
      selectorProfile: after.selectorProfile
    }), warnings);
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

export function configurationInspectionFromSurface(
  experience: ChatGPTExperience,
  detectedProfile: SurfaceSelectorProfile,
  evidence: ConfigurationInspectionData["evidence"],
  panel: ConfigurationPanelSnapshot,
  menuItems: MenuItem[]
): ConfigurationInspectionData {
  const active: Partial<Record<ConfigurationAxis, string>> = {};
  const options: Partial<Record<ConfigurationAxis, ConfigurationOption[]>> = {};
  const availableAxes: ConfigurationAxis[] = [];
  let selectorProfile = detectedProfile;

  if (experience === "work") {
    for (const row of panel.axisRows) {
      if (!availableAxes.includes(row.axis)) availableAxes.push(row.axis);
      if (row.value !== undefined && row.value.length > 0) active[row.axis] = row.value;
    }
    selectorProfile = panel.advancedVisible ? "work_advanced_v1" : "work_basic_v1";
  } else if (experience === "chat") {
    const simplified = chatMenuLooksSimplified(menuItems);
    selectorProfile = simplified ? "chat_simplified_v1" : detectedProfile;
    const axis: ConfigurationAxis = simplified ? "intelligence" : "effort";
    if (menuItems.length > 0 || panel.openerLabel !== undefined) {
      availableAxes.push(axis);
    }
    if (panel.openerLabel !== undefined) {
      active[axis] = panel.openerLabel;
    }
    const chatOptions = menuItems
      .filter(item => !isConfigurationAxisRow(item.label))
      .map(menuItemToOption);
    if (chatOptions.length > 0) {
      options[axis] = chatOptions;
    }
    const modelRows = menuItems.filter(item => /^gpt[\s-]/i.test(item.label) || item.hasPopup === true);
    if (modelRows.length > 0) {
      availableAxes.push("modelVersion");
      options.modelVersion = modelRows.map(menuItemToOption);
    }
  }

  return {
    experience,
    selectorProfile,
    availableAxes,
    active,
    options,
    verified: experience !== "unknown" && (availableAxes.length > 0 || Object.keys(active).length > 0),
    evidence
  };
}

async function inspectWorkAxisOptions(page: PageLike, axis: ConfigurationAxis): Promise<ConfigurationOption[]> {
  await ensureWorkConfigurationRoot(page);
  if (!await clickWorkAxisRow(page, axis)) {
    return [];
  }
  await page.waitForTimeout?.(120);
  const items = await enumerateVisibleMenuItems(page);
  const options = items
    .filter(item => !isConfigurationAxisRow(item.label))
    .map(menuItemToOption);
  await page.keyboard?.press?.("Escape");
  await page.waitForTimeout?.(80);
  return dedupeOptions(options);
}

async function selectWorkAxis(
  page: PageLike,
  axis: ConfigurationAxis,
  requested: string
): Promise<string | undefined> {
  if (!WORK_AXES.includes(axis)) {
    return undefined;
  }
  await ensureWorkConfigurationRoot(page);
  if (!await clickWorkAxisRow(page, axis)) {
    return undefined;
  }
  await page.waitForTimeout?.(120);
  const candidates = await enumerateVisibleMenuItems(page);
  const match = findConfigurationOption(candidates, requested);
  if (match === undefined || !await clickVisibleMenuItem(page, match)) {
    return undefined;
  }
  await page.waitForTimeout?.(150);
  return match.label;
}

async function selectChatAxis(
  env: RuntimeEnv,
  axis: ConfigurationAxis,
  requested: string,
  timeoutMs: number | undefined
): Promise<string | undefined> {
  const legacyArgs = axis === "modelVersion"
    ? { modelVersion: requested }
    : axis === "intelligence"
      ? { intelligence: requested }
      : axis === "effort"
        ? { effort: requested }
        : axis === "model"
          ? { model: requested }
          : undefined;
  if (legacyArgs === undefined) {
    return undefined;
  }
  const result = await setMode(env, {
    ...legacyArgs,
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  });
  return result.ok ? result.data?.selected.at(-1) : undefined;
}

async function openConfigurationRoot(page: PageLike, experience: ChatGPTExperience): Promise<boolean> {
  const existing = await readConfigurationPanel(page);
  if (existing.axisRows.length > 0) {
    return true;
  }
  const existingItems = await enumerateVisibleMenuItems(page).catch(() => []);
  if (configurationMenuLooksRecognized(existingItems, experience, existing.openerLabel)) {
    return true;
  }

  if (typeof page.evaluate === "function") {
    const clicked = await page.evaluate((surface: ChatGPTExperience) => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const visible = (element: Element): boolean => {
        const html = element as HTMLElement;
        const rect = html.getBoundingClientRect?.();
        const style = typeof window !== "undefined" ? window.getComputedStyle?.(html) : undefined;
        return (rect === undefined || (rect.width > 0 && rect.height > 0))
          && style?.display !== "none"
          && style?.visibility !== "hidden"
          && style?.opacity !== "0";
      };
      const forms = Array.from(document.querySelectorAll("main form, main [data-testid*='composer' i]"));
      const controls = forms.flatMap(form => Array.from(form.querySelectorAll("button, [role='button']")))
        .filter(visible);
      const matches = controls.filter(control => {
        const html = control as HTMLElement;
        const label = normalize(control.getAttribute("aria-label") ?? html.innerText ?? control.textContent ?? "");
        const testId = control.getAttribute("data-testid") ?? "";
        if (/send|voice|microphone|attach|upload|add files|plus/i.test(`${label} ${testId}`)) return false;
        if (/model-switcher|model-selector|mode-selector/i.test(testId)) return true;
        return surface === "work"
          ? /\b(?:gpt|sol|luna|terra|light|medium|high|max|ultra|standard|fast)\b/i.test(label)
          : /\b(?:instant|medium|high|extra high|pro|thinking|extended|gpt)\b/i.test(label);
      });
      if (matches.length !== 1) return false;
      (matches[0] as HTMLElement).click();
      return true;
    }, experience).catch(() => false);
    if (clicked) return true;
  }

  const labels = experience === "work"
    ? [
        ...localeLabels.configurationOptions.light,
        ...localeLabels.configurationOptions.medium,
        ...localeLabels.configurationOptions.high,
        ...localeLabels.configurationOptions.standard,
      ]
    : [
        ...localeLabels.configurationOptions.instant,
        ...localeLabels.configurationOptions.medium,
        ...localeLabels.configurationOptions.high,
        ...localeLabels.configurationOptions.extraHigh,
        ...localeLabels.configurationOptions.pro,
        ...localeLabels.modeOptions.thinking,
      ];
  for (const label of labels) {
    if (await clickIfUnique(page.getByRole?.("button", { name: label, exact: true }))) {
      return true;
    }
  }
  return false;
}

function configurationMenuLooksRecognized(
  items: MenuItem[],
  experience: ChatGPTExperience,
  openerLabel: string | undefined
): boolean {
  if (items.some(item => /(?:model|mode|effort|speed)-(?:switcher|selector)|model-switcher/i.test(item.testId ?? ""))) {
    return true;
  }
  if (openerLabel === undefined || items.length === 0) {
    return false;
  }

  const semanticLabels = experience === "work"
    ? [
        ...localeLabels.configurationOptions.light,
        ...localeLabels.configurationOptions.medium,
        ...localeLabels.configurationOptions.high,
        ...localeLabels.configurationOptions.max,
        ...localeLabels.configurationOptions.ultra,
        ...localeLabels.configurationOptions.standard,
        ...localeLabels.configurationOptions.fast,
      ]
    : [
        ...localeLabels.configurationOptions.instant,
        ...localeLabels.configurationOptions.medium,
        ...localeLabels.configurationOptions.high,
        ...localeLabels.configurationOptions.extraHigh,
        ...localeLabels.configurationOptions.pro,
        ...localeLabels.modeOptions.thinking,
        ...localeLabels.modeOptions.extended,
      ];
  const matched = new Set(
    items
      .filter(item => semanticLabels.some(label => visibleLabelMatches(item.label, label)))
      .map(item => normalizeConfigurationId(item.label))
  );
  return matched.size >= 2;
}

async function ensureWorkConfigurationRoot(page: PageLike): Promise<boolean> {
  const panel = await readConfigurationPanel(page);
  if (panel.axisRows.length > 0) return true;
  await page.keyboard?.press?.("Escape");
  await page.waitForTimeout?.(50);
  return openConfigurationRoot(page, "work");
}

async function readConfigurationPanel(page: PageLike): Promise<ConfigurationPanelSnapshot> {
  if (typeof page.evaluate !== "function") {
    return { axisRows: [], advancedVisible: false };
  }
  return page.evaluate((axisLabels: Record<string, string[]>) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const normalizedAxes = Object.fromEntries(
      Object.entries(axisLabels).map(([axis, labels]) => [
        axis,
        labels.map(label => normalize(label).toLocaleLowerCase())
      ])
    );
    const visible = (element: Element): boolean => {
      const html = element as HTMLElement;
      const rect = html.getBoundingClientRect?.();
      const style = typeof window !== "undefined" ? window.getComputedStyle?.(html) : undefined;
      return (rect === undefined || (rect.width > 0 && rect.height > 0))
        && style?.display !== "none"
        && style?.visibility !== "hidden"
        && style?.opacity !== "0";
    };
    const overlays = Array.from(document.querySelectorAll(
      "[role='menu'], [role='listbox'], [data-radix-popper-content-wrapper], [data-radix-menu-content]"
    )).filter(visible);
    const roots = overlays.length > 0 ? overlays : Array.from(document.querySelectorAll("main")).filter(visible);
    const rows = roots.flatMap(root => Array.from(root.querySelectorAll(
      "button, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='option']"
    ))).filter(visible);
    const axisRows: Array<{ axis: ConfigurationAxis; label: string; value?: string }> = [];
    let advancedVisible = false;
    for (const row of rows) {
      const html = row as HTMLElement;
      const label = normalize(row.getAttribute("aria-label") ?? html.innerText ?? row.textContent ?? "");
      const normalized = label.toLocaleLowerCase();
      if (normalizedAxes.advanced?.some(candidate => normalized === candidate || normalized.startsWith(`${candidate} `))) {
        advancedVisible = true;
      }
      for (const axis of ["model", "intelligence", "effort", "speed"] as ConfigurationAxis[]) {
        const candidates = normalizedAxes[axis] ?? [];
        const prefix = candidates.find(candidate => normalized === candidate || normalized.startsWith(`${candidate} `));
        if (prefix === undefined) continue;
        const value = normalize(label.slice(prefix.length));
        const item: { axis: ConfigurationAxis; label: string; value?: string } = { axis, label };
        if (value.length > 0) item.value = value;
        axisRows.push(item);
        break;
      }
    }

    const forms = Array.from(document.querySelectorAll("main form, main [data-testid*='composer' i]"));
    const openerCandidates = forms.flatMap(form => Array.from(form.querySelectorAll("button, [role='button']")))
      .filter(visible)
      .map(control => {
        const html = control as HTMLElement;
        return {
          label: normalize(control.getAttribute("aria-label") ?? html.innerText ?? control.textContent ?? ""),
          testId: control.getAttribute("data-testid") ?? ""
        };
      })
      .filter(item => !/send|voice|microphone|attach|upload|add files|plus/i.test(`${item.label} ${item.testId}`))
      .filter(item => /model-switcher|model-selector|mode-selector/i.test(item.testId)
        || /\b(?:gpt|sol|luna|terra|instant|medium|high|extra high|pro|thinking|extended|light|standard|fast)\b/i.test(item.label));
    const result: ConfigurationPanelSnapshot = {
      axisRows,
      advancedVisible
    };
    if (openerCandidates.length === 1 && openerCandidates[0]?.label.length) {
      result.openerLabel = openerCandidates[0].label;
    }
    return result;
  }, localeLabels.configurationAxes).catch(() => ({ axisRows: [], advancedVisible: false }));
}

async function clickWorkAxisRow(page: PageLike, axis: ConfigurationAxis): Promise<boolean> {
  const labels = axis === "modelVersion" ? [] : localeLabels.configurationAxes[axis as keyof typeof localeLabels.configurationAxes] ?? [];
  for (const label of labels) {
    const pattern = new RegExp(`^${escapeRegExp(label)}(?:\\s|$)`, "i");
    for (const role of ["button", "menuitem"]) {
      if (await clickIfUnique(page.getByRole?.(role, { name: pattern }))) {
        return true;
      }
    }
  }
  if (typeof page.evaluate !== "function") return false;
  return page.evaluate((wantedLabels: string[]) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const wanted = wantedLabels.map(normalize);
    const overlays = Array.from(document.querySelectorAll(
      "[role='menu'], [data-radix-popper-content-wrapper], [data-radix-menu-content]"
    ));
    const nodes = overlays.flatMap(root => Array.from(root.querySelectorAll("button, [role='button'], [role='menuitem']")));
    const matches = nodes.filter(node => {
      const html = node as HTMLElement;
      const label = normalize(node.getAttribute("aria-label") ?? html.innerText ?? node.textContent ?? "");
      return wanted.some(prefix => label === prefix || label.startsWith(`${prefix} `));
    });
    if (matches.length !== 1) return false;
    (matches[0] as HTMLElement).click();
    return true;
  }, labels).catch(() => false);
}

async function clickVisibleMenuItem(page: PageLike, item: MenuItem): Promise<boolean> {
  if (item.testId !== undefined && await clickIfUnique(page.locator?.(`[data-testid="${escapeAttributeValue(item.testId)}"]`))) {
    return true;
  }
  for (const role of ["menuitemradio", "menuitem", "option"]) {
    if (await clickIfUnique(page.getByRole?.(role, { name: item.label, exact: true }))) {
      return true;
    }
  }
  return clickIfUnique(page.getByText?.(item.label, { exact: true }));
}

function findConfigurationOption(items: MenuItem[], requested: string): MenuItem | undefined {
  const normalizedRequested = normalizeConfigurationId(requested);
  const exact = items.filter(item => normalizeConfigurationId(item.label) === normalizedRequested);
  if (exact.length === 1) return exact[0];

  const semanticLabels = configurationSemanticLabels(requested);
  for (const wanted of semanticLabels) {
    const matches = items.filter(item =>
      normalizeForLabelMatch(item.label) === normalizeForLabelMatch(wanted)
      || visibleLabelMatches(item.label, wanted)
    );
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

function configurationSemanticLabels(requested: string): string[] {
  const normalized = normalizeConfigurationId(requested);
  for (const labels of Object.values(localeLabels.configurationOptions)) {
    if (labels.some(label => normalizeConfigurationId(label) === normalized)) {
      return labels;
    }
  }
  for (const labels of Object.values(localeLabels.modeOptions)) {
    if (labels.some(label => normalizeConfigurationId(label) === normalized)) {
      return labels;
    }
  }
  return [requested];
}

export function configurationMatchesSelection(
  inspection: ConfigurationInspectionData,
  desired: ConfigurationSelection
): boolean {
  return selectionEntries(desired).every(([axis, requested]) => {
    const active = activeConfigurationValue(inspection, axis);
    return active !== undefined && configurationValueMatches(active, requested);
  });
}

function activeConfigurationValue(
  inspection: ConfigurationInspectionData,
  axis: ConfigurationAxis
): string | undefined {
  const direct = inspection.active[axis];
  if (direct !== undefined || inspection.experience !== "chat") {
    return direct;
  }

  if (axis === "model" || axis === "intelligence") {
    return inspection.active.intelligence ?? inspection.active.effort;
  }
  if (axis === "effort") {
    return inspection.active.effort ?? inspection.active.intelligence;
  }
  return undefined;
}

function configurationValueMatches(actual: string, requested: string): boolean {
  const normalizedActual = normalizeConfigurationId(actual);
  const normalizedRequested = normalizeConfigurationId(requested);
  if (normalizedActual === normalizedRequested) return true;
  return configurationSemanticLabels(requested)
    .some(label => normalizeConfigurationId(label) === normalizedActual);
}

function selectionEntries(selection: ConfigurationSelection): Array<[ConfigurationAxis, string]> {
  const entries: Array<[ConfigurationAxis, string]> = [];
  for (const axis of CONFIGURATION_AXIS_ORDER) {
    const value = selection[axis];
    if (typeof value === "string" && value.trim().length > 0) {
      entries.push([axis, value.trim()]);
    }
  }
  return entries;
}

function normalizeDesiredSelection(selection: ConfigurationSelection): ConfigurationSelection {
  const normalized: ConfigurationSelection = {};
  for (const axis of ["model", "intelligence", "effort", "speed"] as const) {
    const value = selection[axis]?.trim();
    if (value !== undefined && value.length > 0) normalized[axis] = value;
  }
  const modelVersion = (selection.modelVersion ?? selection.version)?.trim();
  if (modelVersion !== undefined && modelVersion.length > 0) {
    normalized.modelVersion = modelVersion;
  }
  return normalized;
}

function menuItemToOption(item: MenuItem): ConfigurationOption {
  const option: ConfigurationOption = {
    id: normalizeConfigurationId(item.label),
    label: item.label,
    selected: item.checked === true
  };
  if (item.hasPopup !== undefined) option.hasSubmenu = item.hasPopup;
  return option;
}

function dedupeOptions(options: ConfigurationOption[]): ConfigurationOption[] {
  const seen = new Set<string>();
  return options.filter(option => {
    const key = `${option.id}\u0000${option.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chatMenuLooksSimplified(items: MenuItem[]): boolean {
  const normalized = items.map(item => normalizeConfigurationId(item.label));
  const simplified = ["instant", "medium", "high", "extra high", "pro"];
  return simplified.filter(label => normalized.includes(label)).length >= 3;
}

function isConfigurationAxisRow(label: string): boolean {
  const normalized = normalizeForLabelMatch(label);
  return Object.values(localeLabels.configurationAxes)
    .flat()
    .some(axis => {
      const prefix = normalizeForLabelMatch(axis);
      return normalized === prefix || normalized.startsWith(`${prefix} `);
    });
}

function normalizeConfigurationId(value: string): string {
  return normalizeForLabelMatch(value)
    .replace(/^gpt[\s-]*/i, "gpt ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function closeConfigurationMenus(page: PageLike): Promise<void> {
  await page.keyboard?.press?.("Escape");
  await page.waitForTimeout?.(50);
  await page.keyboard?.press?.("Escape");
}

async function clickIfUnique(locator: LocatorLike | undefined): Promise<boolean> {
  if (locator?.count === undefined || locator.click === undefined) return false;
  if (await locator.count().catch(() => 0) !== 1) return false;
  await locator.click();
  return true;
}

async function configurationFailure(
  page: PageLike,
  before: ConfigurationInspectionData,
  desired: ConfigurationSelection,
  selected: AppliedConfigurationSelection[],
  message: string,
  code: string,
  candidates: string[] = []
): Promise<CommandResult<ApplyConfigurationData>> {
  const data: ApplyConfigurationData = {
    requested: desired,
    selected,
    before,
    after: before,
    verified: false
  };
  return {
    ok: false,
    status: "unsupported",
    data,
    warnings: [],
    blocker: {
      kind: "selector_drift",
      code,
      fieldPath: "desired",
      message,
      candidates: candidates.map(label => ({ label })),
      resumable: true
    },
    context: await contextFromPage(page, {
      experience: before.experience,
      selectorProfile: before.selectorProfile
    })
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function forwardFailure<T>(result: CommandResult<unknown>): CommandResult<T> {
  const forwarded: CommandResult<T> = {
    ok: false,
    status: result.status,
    warnings: result.warnings,
    context: result.context
  };
  if (result.output_text !== undefined) forwarded.output_text = result.output_text;
  if (result.reportPath !== undefined) forwarded.reportPath = result.reportPath;
  if (result.error !== undefined) forwarded.error = result.error;
  if (result.blocker !== undefined) forwarded.blocker = result.blocker;
  if (result.steps !== undefined) forwarded.steps = result.steps;
  return forwarded;
}
