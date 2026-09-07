import { resultError, resultOk } from "../errors.js";
import { enumerateVisibleMenuItems, findUniqueMenuItem, type MenuItem } from "../dom/menus.js";
import { localeLabels } from "../dom/locale-labels.js";
import { isShortLatinToken, normalizeForLabelMatch, visibleLabelMatches } from "../dom/label-match.js";
import { normalizeLabel, normalizeWhitespace } from "../dom/visible-text.js";
import type { CommandResult, GetModeArgs, LocatorLike, PageLike, RuntimeEnv, SelectToolArgs, SetModeArgs } from "../types.js";
import type { ModeOptionId } from "../dom/locale/types.js";
import { contextFromPage } from "./context.js";
import {
  discoverPowerSlider,
  observedPowerSlider,
  resolvePowerTarget
} from "./power-discovery.js";
import { ensurePage } from "./session.js";
import { closeChatPopover, readChatPopover, selectChatPopoverEffort, selectChatPopoverModel, setChatPopoverView } from "./chat-popover.js";

const DEFAULT_MODE_EFFORT = "Thinking";
const CURRENT_MODE_LABELS: string[] = dedupeLabels([
  ...localeLabels.modeLabels,
  ...Object.values(localeLabels.modeOptions).flat(),
  ...Object.values(localeLabels.configurationOptions).flat(),
]);
const MODE_OPENER_LABELS = [...CURRENT_MODE_LABELS.filter(label => label !== "Pro"), ...localeLabels.modeOpenerExtra];
const MODEL_VERSION_FAMILY_PATTERN = /^gpt[\s-]/i;
const MODEL_VERSION_LABEL_PATTERN = /^(?:gpt[\s-].+|o\d+|\d+(?:\.\d+)?|latest)$/i;
const CANONICAL_INTELLIGENCE_ORDER = new Map<ModeOptionId, number>([
  ["instant", 0],
  ["medium", 1],
  ["high", 2],
  ["extraHigh", 3],
  ["pro", 4],
]);
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
const MODE_ID_ALIASES: Record<ModeOptionId, string[]> = {
  latest: ["latest"],
  instant: ["instant"],
  thinking: ["thinking"],
  extended: ["extended"],
  medium: ["medium"],
  high: ["high"],
  extraHigh: ["extra high", "extra-high", "extra_high", "extrahigh"],
  pro: ["pro"],
};
const THREAD_ACTION_MENU_LABELS = new Set(localeLabels.threadActionMenuItems.map(normalizeForLabelMatch));
const THREAD_ACTION_PREFIXES = localeLabels.threadActionPrefixes
  .map(normalizeForLabelMatch)
  .filter(prefix => prefix.length > 0);

type RequestedMode = {
  requested: string;
  labels: string[];
  modeId?: ModeOptionId;
};

type PowerSliderSelection = {
  selected: string;
};

export async function setMode(
  env: RuntimeEnv,
  args: SetModeArgs
): Promise<CommandResult<{ selected: string[]; candidates: string[] }>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<{ selected: string[]; candidates: string[] }>;
  }

  const page = env.page!;

  try {
    const initialPopover = (await readChatPopover(page)).snapshot;
    const requested = requestedModeSelections(args);
    const requestedVersion = requestedModelVersion(args);
    const requestedForOpening = requestedVersion === undefined ? requested : [...requested, requestedModeSelection(requestedVersion)];
    const opened = await waitForModeMenu(page, requestedForOpening, args.timeoutMs ?? 30000);
    if (requestedVersion === undefined && opened.alreadySelected.length === requested.length) {
      return resultOk({ selected: opened.alreadySelected, candidates: opened.modeButtons }, await contextFromPage(page));
    }
    if (!opened.opened) {
      return selectorDrift(page, "No unique ChatGPT mode menu opener was found.");
    }
    await page.waitForTimeout?.(250);
    const scopedPopover = (await readChatPopover(page)).snapshot;
    if (scopedPopover !== undefined) {
      try {
        const selected: string[] = [];
        const candidates: string[] = [];
        if (requestedVersion !== undefined) {
          const model = await selectChatPopoverModel(page, [requestedVersion]);
          if (model === undefined) return selectorDrift(page, `Model version "${requestedVersion}" did not verify in the owned Chat model view.`);
          selected.push(model);
          candidates.push(model);
        }
        for (const request of requested) {
          const effort = await selectChatPopoverEffort(page, request.labels);
          if (effort === undefined) return selectorDrift(page, `Mode option "${request.requested}" did not verify in the owned Chat effort control.`);
          selected.push(effort);
          candidates.push(effort);
        }
        return resultOk({ selected, candidates }, await contextFromPage(page));
      } finally {
        if (initialPopover !== undefined) await setChatPopoverView(page, initialPopover.view);
        else await closeChatPopover(page);
      }
    }
    let candidates = await enumerateVisibleMenuItems(page);
    const observedCandidates: MenuItem[] = [...candidates];
    const selected: string[] = [];

    if (requested.length > 0 && shouldRejectAsWrongModeMenu(candidates)) {
      const candidateLabels = candidates.map(candidate => candidate.label);
      return {
        ok: false,
        status: "unsupported",
        warnings: [],
        blocker: selectorDriftBlocker("Visible menu appears to be a thread/action menu, not the ChatGPT mode menu.", candidateLabels),
        context: await contextFromPage(page)
      };
    }

    for (const request of requested) {
      let match = findModeMenuItem(candidates, request);
      if (match === undefined) {
        const sliderSelection = await selectModeWithPowerSlider(page, request);
        if (sliderSelection !== undefined) {
          // A slider press is already a mutation. Even if the postcondition
          // label is unavailable, do not fall through to Advanced and issue a
          // second UI action against the same request. The final warning pass
          // will expose that this selection remains unverified.
          selected.push(sliderSelection.selected);
          continue;
        }
        const nested = await openEffortSubmenu(page, candidates, request);
        observedCandidates.push(...nested);
        candidates = nested;
        match = findModeMenuItem(candidates, request);
      }
      if (match === undefined) {
        const candidateLabels = dedupeLabels(observedCandidates.map(candidate => candidate.label));
        return {
          ok: false,
          status: "unsupported",
          warnings: [],
          blocker: selectorDriftBlocker(`Mode option "${request.requested}" was not found or was ambiguous.`, candidateLabels),
          context: await contextFromPage(page)
        };
      }
      if (!await clickResolvedMenuItem(page, match)) {
        return selectorDrift(page, `Mode option "${match.label}" was visible but could not be clicked.`, candidates.map(candidate => candidate.label));
      }
      selected.push(match.label);
    }

    let candidateLabels = dedupeLabels(observedCandidates.map(candidate => candidate.label));
    if (requestedVersion !== undefined) {
      const versionResult = await selectModelVersion(page, requestedVersion, candidates, args.timeoutMs ?? 30000);
      candidateLabels = dedupeLabels([...candidateLabels, ...versionResult.candidates]);
      if (!versionResult.selected) {
        return {
          ok: false,
          status: "unsupported",
          warnings: [],
          blocker: selectorDriftBlocker(`Model version "${requestedVersion}" was not found or was ambiguous.`, candidateLabels),
          context: await contextFromPage(page)
        };
      }
      selected.push(versionResult.selected);
    }

    const verificationWarnings = await modeVerificationWarnings(page, requested, selected);
    return resultOk({ selected, candidates: candidateLabels }, await contextFromPage(page), verificationWarnings);
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

/**
 * Chat's compact picker can expose a Power/reasoning ARIA slider. Discover the
 * control from its semantic relationship to the localized Power axis and its
 * owning menu, then use only a complete, bounded, DOM-provided value mapping.
 * The Advanced submenu remains the fallback for every unrecognized or
 * unprobed shape; in particular, this path never infers labels from a fixed
 * five-position range.
 */
async function selectModeWithPowerSlider(
  page: PageLike,
  request: RequestedMode
): Promise<PowerSliderSelection | undefined> {
  const discovery = await discoverPowerSlider(page, {
    powerLabels: localeLabels.configurationAxes.power
  });
  if (!discovery.ok || await isWorkPowerSurface(page, discovery.evidence.surface)) {
    return undefined;
  }

  const target = resolvePowerTarget(discovery, request.labels);
  const slider = observedPowerSlider(page, discovery);
  if (target === undefined
    || slider?.count === undefined
    || slider.evaluate === undefined
    || slider.press === undefined
    || slider.isVisible === undefined
    || !await slider.isVisible().catch(() => false)
    || await slider.count().catch(() => 0) !== 1) {
    return undefined;
  }

  // Re-read the three values on the selected locator so a menu replacement
  // between discovery and selection cannot apply an old operation's plan to a
  // newly rendered slider.
  const state = await slider.evaluate(element => ({
    min: Number(element.getAttribute("aria-valuemin")),
    max: Number(element.getAttribute("aria-valuemax")),
    now: Number(element.getAttribute("aria-valuenow"))
  })).catch(() => undefined);
  if (state === undefined
    || state.min !== discovery.range.minimum
    || state.max !== discovery.range.maximum
    || !Number.isInteger(state.now)
    || state.now < state.min
    || state.now > state.max
    || target < state.min
    || target > state.max) {
    return undefined;
  }

  const key = target > state.now ? "ArrowRight" : "ArrowLeft";
  for (let step = 0; step < Math.abs(target - state.now); step += 1) {
    await slider.press(key);
  }
  await page.waitForTimeout?.(150);
  const after = await slider.evaluate(element => Number(element.getAttribute("aria-valuenow")))
    .catch(() => undefined);
  const reflected = findUniqueVisibleLabelForRequest(await visibleModeButtonLabelList(page), request);
  return {
    // A silent/no-op keypress must not be reported as the requested level. We
    // still return a handled selection to prevent a second Advanced mutation;
    // the normal visible-mode verification warning exposes the unresolved
    // postcondition to the caller.
    selected: after === target ? reflected ?? request.requested : request.requested
  };
}

async function isWorkPowerSurface(page: PageLike, discoveredSurface: "chat" | "work" | "unknown"): Promise<boolean> {
  if (discoveredSurface === "work") return true;
  const url = typeof page.url === "function"
    ? await Promise.resolve(page.url()).catch(() => "")
    : "";
  return /\/work(?:\/|$|\?)/i.test(url);
}

/**
 * Current Chat exposes the intelligence choices inside an Advanced "Effort <value>"
 * submenu.  Only traverse a uniquely labelled visible Effort/Intelligence row and
 * only accept the submenu when it contains the exact requested mode.  This keeps the
 * legacy flat picker working while avoiding any inference from the five-position
 * power slider.
 */
async function openEffortSubmenu(
  page: PageLike,
  rootItems: MenuItem[],
  request: RequestedMode
): Promise<MenuItem[]> {
  const axisLabels = [
    ...localeLabels.configurationAxes.effort,
    ...localeLabels.configurationAxes.intelligence,
  ].map(normalizeForLabelMatch);
  const effortRows = (items: MenuItem[]): MenuItem[] => items.filter(item => {
    if (item.role === "menuitemradio") return false;
    const normalized = normalizeForLabelMatch(item.label);
    return axisLabels.some(axis => normalized === axis || normalized.startsWith(`${axis} `));
  });
  let visibleRootItems = rootItems;
  let rows = effortRows(visibleRootItems);
  if (rows.length === 0) {
    const advancedLabels = localeLabels.configurationAxes.advanced.map(normalizeForLabelMatch);
    const advancedRows = visibleRootItems.filter(item => {
      const normalized = normalizeForLabelMatch(item.label);
      return advancedLabels.some(label => normalized === label || visibleLabelMatches(item.label, label));
    });
    if (advancedRows.length !== 1 || !await clickResolvedMenuItem(page, advancedRows[0]!)) {
      return [];
    }
    await page.waitForTimeout?.(250);
    visibleRootItems = await enumerateVisibleMenuItems(page);
    rows = effortRows(visibleRootItems);
  }
  if (rows.length !== 1 || !await clickResolvedMenuItem(page, rows[0]!)) {
    return [];
  }

  await page.waitForTimeout?.(250);
  const nested = await enumerateVisibleMenuItems(page);
  return findModeMenuItem(nested, request) === undefined ? [] : nested;
}

/**
 * Post-condition check: after clicking mode rows, the composer's mode-labelled controls
 * should reflect the requested selection. A mismatch does not fail the command — some
 * ChatGPT surfaces do not echo every mode — but it must be visible to callers so a
 * modes.set "ok" is never silently treated as a verified mode (the "Pin ... Pro ..."
 * incident shape). Model-version selections are not verified because versions are
 * usually not echoed on the composer.
 */
async function modeVerificationWarnings(
  page: PageLike,
  requested: RequestedMode[],
  selected: string[]
): Promise<string[]> {
  if (requested.length === 0) {
    return [];
  }

  await page.waitForTimeout?.(250);
  const visibleButtons = await visibleModeButtonLabelList(page);
  if (visibleButtons.length === 0) {
    return [
      `Mode selection is unverified: no mode-labelled composer control was visible after selecting ${selected.map(label => JSON.stringify(label)).join(", ")}. Use modes.get or inspect modeStep before treating this as a verified mode.`
    ];
  }

  const unverified = requested.filter(request => findUniqueVisibleLabelForRequest(visibleButtons, request) === undefined);
  if (unverified.length === 0) {
    return [];
  }
  return [
    `Mode selection is unverified: requested ${unverified.map(request => JSON.stringify(request.requested)).join(", ")} is not reflected by the visible mode controls (${visibleButtons.join(", ")}). Use modes.get or inspect modeStep before treating this as a verified mode.`
  ];
}

export async function getMode(
  env: RuntimeEnv,
  args: GetModeArgs = {}
): Promise<CommandResult<{ modes: string[] }>> {
  void args;
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<{ modes: string[] }>;
  }

  const page = env.page!;

  try {
    const modes = await visibleModeButtonLabelList(page);
    const warnings = modes.length === 0
      ? ["No mode-labelled composer control is currently visible, so the active ChatGPT mode could not be read."]
      : [];
    return resultOk({ modes }, await contextFromPage(page), warnings);
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

type ModeMenuOpenResult = {
  opened: boolean;
  alreadySelected: string[];
  modeButtons: string[];
};

async function waitForModeMenu(page: PageLike, requested: RequestedMode[], timeoutMs: number): Promise<ModeMenuOpenResult> {
  const deadline = Date.now() + timeoutMs;
  let modeButtons: string[] = [];

  do {
    if ((await readChatPopover(page)).snapshot !== undefined) return { opened: true, alreadySelected: [], modeButtons };
    modeButtons = await visibleModeButtonLabelList(page);
    const alreadySelected = findAlreadySelectedModes(modeButtons, requested);
    if (alreadySelected.length === requested.length) {
      return { opened: false, alreadySelected, modeButtons };
    }

    const openMenuItems = await enumerateVisibleMenuItems(page);
    if (looksLikeModeMenu(openMenuItems)) {
      return { opened: true, alreadySelected: [], modeButtons };
    }

    if (await clickModeOpener(page, modeButtons)) {
      return { opened: true, alreadySelected: [], modeButtons };
    }

    if (Date.now() >= deadline) {
      break;
    }
    await page.waitForTimeout?.(250);
  } while (true);

  return { opened: false, alreadySelected: [], modeButtons };
}

export async function selectTool(
  env: RuntimeEnv,
  args: SelectToolArgs
): Promise<CommandResult<{ selected?: string; candidates: string[] }>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<{ selected?: string; candidates: string[] }>;
  }

  const page = env.page!;

  try {
    const opened = await clickFirstUniqueButton(page, [...localeLabels.addFilesOpenerCandidates]);
    if (!opened) {
      return selectorDrift(page, "No unique ChatGPT tool menu opener was found.");
    }
    await page.waitForTimeout?.(250);
    const candidates = await enumerateVisibleMenuItems(page);
    const wantedCandidates = toolLabels(args.tool);
    let match: MenuItem | undefined;
    let wanted = wantedCandidates[0] ?? args.tool;
    for (const candidate of wantedCandidates) {
      const found = findUniqueMenuItem(candidates, candidate);
      if (found !== undefined) {
        match = found;
        wanted = candidate;
        break;
      }
    }

    if (match === undefined) {
      const candidateLabels = candidates.map(candidate => candidate.label);
      return {
        ok: false,
        status: "unsupported",
        warnings: [],
        blocker: selectorDriftBlocker(`Tool "${wanted}" was not found or was ambiguous.`, candidateLabels),
        context: await contextFromPage(page)
      };
    }

    if (!await clickMenuItem(page, match)) {
      return selectorDrift(page, `Tool "${match.label}" was visible but could not be clicked.`, candidates.map(candidate => candidate.label));
    }
    return resultOk({ selected: match.label, candidates: candidates.map(candidate => candidate.label) }, await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

async function clickFirstUniqueButton(page: PageLike, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const roleLocator = page.getByRole?.("button", { name: label, exact: true });
    if (await clickIfUnique(roleLocator)) {
      return true;
    }

    const textLocator = page.locator?.("button, [role='button']")?.filter?.({ hasText: label });
    if (await clickIfUnique(textLocator)) {
      return true;
    }
  }

  return false;
}

async function clickModeOpener(page: PageLike, modeButtons: string[]): Promise<boolean> {
  if (await clickFirstUniqueButton(page, modeButtons)) {
    return true;
  }

  return clickFirstUniqueButton(page, MODE_OPENER_LABELS);
}

function isThreadActionLabel(label: string): boolean {
  const normalized = normalizeForLabelMatch(label);
  if (THREAD_ACTION_MENU_LABELS.has(normalized)) {
    return true;
  }
  return THREAD_ACTION_PREFIXES.some(prefix => normalized.startsWith(`${prefix} `));
}

function hasStructuralModeEvidence(item: MenuItem): boolean {
  if (item.testId?.startsWith("model-switcher-") === true) {
    return true;
  }
  return MODEL_VERSION_FAMILY_PATTERN.test(item.label) || MODEL_VERSION_LABEL_PATTERN.test(item.label);
}

/**
 * Whether a single menu item is evidence that the visible menu is the ChatGPT mode menu.
 *
 * A fuzzy token hit on a short mode word such as "Pro" is NOT evidence: thread titles
 * inside sidebar action menus can contain it ("Pin CopyBench Pro Consultation"), which is
 * exactly the false positive that let modes.set select a pin action as the Pro mode.
 * Thread-action rows can never be evidence, even when their title embeds a full mode word.
 * Exact matching uses normalizeForLabelMatch (NFKC) so the evidence set and the veto set
 * share identical Unicode folding — fullwidth/compatibility-form labels match both sides.
 */
function isModeMenuEvidence(item: MenuItem): boolean {
  if (hasStructuralModeEvidence(item)) {
    return true;
  }
  if (isThreadActionLabel(item.label)) {
    return false;
  }
  const normalized = normalizeForLabelMatch(item.label);
  return CURRENT_MODE_LABELS.some(modeLabel => {
    const normalizedMode = normalizeForLabelMatch(modeLabel);
    if (normalized === normalizedMode) {
      return true;
    }
    return !isShortLatinToken(normalizedMode) && visibleLabelMatches(normalized, normalizedMode);
  });
}

function looksLikeModeMenu(items: MenuItem[]): boolean {
  return items.some(item => isModeMenuEvidence(item));
}

function shouldRejectAsWrongModeMenu(items: MenuItem[]): boolean {
  if (items.length === 0) {
    return false;
  }
  if (items.some(item => isModeMenuEvidence(item))) {
    return false;
  }

  return items.some(item => isThreadActionLabel(item.label));
}

async function clickMenuItem(page: PageLike, item: MenuItem): Promise<boolean> {
  if (await clickModelSwitcherMenuItem(page, item)) {
    return true;
  }

  if (await clickMenuItemByPointer(page, item)) {
    return true;
  }

  if (item.role !== undefined) {
    const accessibleName = item.ariaLabel ?? item.label;
    if (await clickIfUniqueMenuControl(
      page.getByRole?.(item.role, { name: accessibleName, exact: true }),
      item
    )) return true;
  }

  const roleLocator = page.locator?.("[role='menuitem'], [role='menuitemradio'], [role='option']")
    ?.filter?.({ hasText: new RegExp(`^\\s*${escapeRegExp(item.label)}\\s*$`, "i") });
  return clickIfUniqueMenuControl(roleLocator, item);
}

async function clickMenuItemByPointer(page: PageLike, item: MenuItem): Promise<boolean> {
  const point = await menuItemCenter(page, item);
  if (point === undefined) {
    return false;
  }

  const pageWithPointer = page as PageLike & {
    mouse?: { click?: (x: number, y: number) => Promise<void> | void };
    cua?: { click?: (options: { x: number; y: number; button?: number }) => Promise<void> | void };
  };

  if (pageWithPointer.mouse?.click !== undefined) {
    await pageWithPointer.mouse.click(point.x, point.y);
    return true;
  }
  if (pageWithPointer.cua?.click !== undefined) {
    await pageWithPointer.cua.click({ x: point.x, y: point.y });
    return true;
  }
  return false;
}

async function clickModelSwitcherMenuItem(page: PageLike, item: MenuItem): Promise<boolean> {
  if (typeof page.evaluate !== "function" || typeof page.locator !== "function") {
    return false;
  }

  const testId = await page.evaluate((wanted: { label: string; testId?: string }) => {
    const normalizedWanted = wanted.label.replace(/\s+/g, " ").trim().toLowerCase();
    const candidates = Array.from(document.querySelectorAll("[data-testid^='model-switcher-']"));
    const matches = candidates
      .filter(node => {
        const element = node as HTMLElement;
        const candidateTestId = element.getAttribute("data-testid") ?? "";
        if (candidateTestId.endsWith("-effort")) return false;
        if (wanted.testId !== undefined && candidateTestId !== wanted.testId) return false;
        const text = (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        return text === normalizedWanted;
      })
      .map(node => (node as HTMLElement).getAttribute("data-testid"))
      .filter((value): value is string => value !== null);

    return matches.length === 1 ? matches[0] : undefined;
  }, item.testId === undefined ? { label: item.label } : { label: item.label, testId: item.testId }).catch(() => undefined);

  if (testId === undefined) {
    return false;
  }

  return clickIfUniqueMenuControl(page.locator(`[data-testid="${escapeAttributeValue(testId)}"]`), item);
}

async function clickIfUnique(locator: LocatorLike | undefined): Promise<boolean> {
  if (locator === undefined || typeof locator.count !== "function" || typeof locator.click !== "function") {
    return false;
  }

  const count = await locator.count().catch(() => 0);
  if (count !== 1) {
    return false;
  }

  await locator.click();
  return true;
}

async function clickIfUniqueMenuControl(locator: LocatorLike | undefined, item: MenuItem): Promise<boolean> {
  if (locator === undefined
    || typeof locator.count !== "function"
    || typeof locator.evaluate !== "function"
    || typeof locator.click !== "function") {
    return false;
  }
  if (await locator.count().catch(() => 0) !== 1) return false;
  const safe = await locator.evaluate((element: Element) => {
    const control = element as HTMLButtonElement;
    if (control.disabled || control.getAttribute("aria-disabled") === "true") return false;
    if (control.hidden || control.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
    const style = window.getComputedStyle(control);
    const rect = control.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0
      || style.display === "none"
      || style.visibility === "hidden"
      || style.opacity === "0"
      || style.pointerEvents === "none") return false;
    const containers = Array.from(document.querySelectorAll<HTMLElement>(
      "[role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]"
    )).filter(container => {
      if (container.hidden || container.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
      const containerStyle = window.getComputedStyle(container);
      const containerRect = container.getBoundingClientRect();
      return containerRect.width > 0 && containerRect.height > 0
        && containerStyle.display !== "none"
        && containerStyle.visibility !== "hidden"
        && containerStyle.opacity !== "0";
    });
    return containers.length > 0 && containers.some(container => container.contains(control));
  }).catch(() => false);
  if (!safe) return false;
  await locator.click();
  return true;
}

function toolLabels(tool: string): string[] {
  const known = (localeLabels.tools as Record<string, readonly string[]>)[tool];
  return known !== undefined ? [...known] : [tool];
}

function findModeMenuItem(candidates: MenuItem[], request: RequestedMode): MenuItem | undefined {
  const selectable = candidates.filter(candidate => !isThreadActionLabel(candidate.label));
  for (const wanted of request.labels) {
    const match = findUniqueModeMenuItem(selectable, wanted);
    if (match !== undefined) {
      return match;
    }
  }

  const wantedIndex = request.modeId === undefined ? undefined : CANONICAL_INTELLIGENCE_ORDER.get(request.modeId);
  if (wantedIndex === undefined) {
    return undefined;
  }

  const intelligenceItems = selectable.filter(candidate =>
    candidate.role === "menuitemradio"
    && !MODEL_VERSION_LABEL_PATTERN.test(candidate.label)
    && !MODEL_VERSION_FAMILY_PATTERN.test(candidate.label)
  );
  return intelligenceItems.length >= CANONICAL_INTELLIGENCE_ORDER.size
    ? intelligenceItems[wantedIndex]
    : undefined;
}

/**
 * Unique-match a wanted mode label. Exact normalized equality is always accepted; a
 * fuzzy token hit on a short mode word such as "Pro" additionally requires structural
 * mode-row evidence (a model-switcher test id or a menuitemradio role), so an arbitrary
 * unique menu row whose text merely contains "Pro" cannot be selected as the mode.
 * Exact matching uses normalizeForLabelMatch (NFKC), consistent with isModeMenuEvidence.
 */
function findUniqueModeMenuItem(items: MenuItem[], wanted: string): MenuItem | undefined {
  const normalizedWanted = normalizeForLabelMatch(wanted);
  const exact = items.filter(item => normalizeForLabelMatch(item.label) === normalizedWanted);
  if (exact.length === 1) {
    return exact[0];
  }

  const fuzzy = items.filter(item => visibleLabelMatches(item.label, wanted));
  if (fuzzy.length !== 1) {
    return undefined;
  }
  const match = fuzzy[0]!;
  if (!isShortLatinToken(normalizedWanted)) {
    return match;
  }
  return hasStructuralModeEvidence(match) || match.role === "menuitemradio" ? match : undefined;
}

function requestedModeSelections(args: SetModeArgs): RequestedMode[] {
  const requested = [args.model, args.intelligence, args.effort].filter((value): value is string => value !== undefined);
  if (requestedModelVersion(args) !== undefined && requested.length === 0) {
    return [];
  }
  return (requested.length > 0 ? requested : [DEFAULT_MODE_EFFORT]).map(requestedModeSelection);
}

function requestedModeSelection(requested: string): RequestedMode {
  const modeId = modeOptionIdFor(requested);
  const labels = modeId === undefined ? [requested] : localeLabels.modeOptions[modeId];
  const request: RequestedMode = {
    requested,
    labels: labels.length > 0 ? [...labels] : [requested],
  };
  if (modeId !== undefined) {
    request.modeId = modeId;
  }
  return request;
}

function modeOptionIdFor(value: string): ModeOptionId | undefined {
  const normalized = normalizeModeLookupKey(value);
  for (const id of MODE_OPTION_IDS) {
    if (MODE_ID_ALIASES[id].some(alias => normalizeModeLookupKey(alias) === normalized)) {
      return id;
    }
    if (localeLabels.modeOptions[id].some(label => normalizeModeLookupKey(label) === normalized)) {
      return id;
    }
  }
  return undefined;
}

function normalizeModeLookupKey(value: string): string {
  return normalizeForLabelMatch(value).replace(/[_-]+/g, " ");
}

function requestedModelVersion(args: SetModeArgs): string | undefined {
  return args.modelVersion ?? args.version;
}

function findUniqueVisibleLabel(labels: string[], wanted: string): string | undefined {
  const normalized = normalizeLabel(wanted);
  const exact = labels.filter(label => normalizeLabel(label) === normalized);
  if (exact.length === 1) {
    return exact[0];
  }

  const fuzzy = labels.filter(label => visibleLabelMatches(normalizeLabel(label), normalized));
  return fuzzy.length === 1 ? fuzzy[0] : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function findAlreadySelectedModes(visibleButtons: string[], requested: RequestedMode[]): string[] {
  return requested
    .map(request => findUniqueVisibleLabelForRequest(visibleButtons, request))
    .filter((label): label is string => label !== undefined);
}

function findUniqueVisibleLabelForRequest(labels: string[], request: RequestedMode): string | undefined {
  for (const label of request.labels) {
    const found = findUniqueVisibleLabel(labels, label);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

async function selectModelVersion(
  page: PageLike,
  requestedVersion: string,
  currentCandidates: MenuItem[],
  timeoutMs: number
): Promise<{ selected?: string; candidates: string[] }> {
  let candidates = await enumerateVisibleMenuItems(page);
  if (!looksLikeModeMenu(candidates)) {
    const opened = await waitForModeMenu(page, [{ requested: requestedVersion, labels: [requestedVersion] }], timeoutMs);
    if (opened.opened) {
      await page.waitForTimeout?.(250);
      candidates = await enumerateVisibleMenuItems(page);
    }
  }
  let exact = findExactSelectableMenuItem(candidates, requestedVersion);
  if (exact !== undefined) {
    return await clickResolvedMenuItem(page, exact)
      ? { selected: exact.label, candidates: candidates.map(candidate => candidate.label) }
      : { candidates: candidates.map(candidate => candidate.label) };
  }

  const opened = await openModelVersionSubmenu(page, currentCandidates);
  candidates = await enumerateVisibleMenuItems(page);
  exact = findExactSelectableMenuItem(candidates, requestedVersion);
  if (!opened || exact === undefined) {
    return { candidates: candidates.map(candidate => candidate.label) };
  }

  return await clickResolvedMenuItem(page, exact)
    ? { selected: exact.label, candidates: candidates.map(candidate => candidate.label) }
    : { candidates: candidates.map(candidate => candidate.label) };
}

function isModelVersionSubmenuOpener(item: MenuItem): boolean {
  return item.role !== "menuitemradio"
    && (MODEL_VERSION_FAMILY_PATTERN.test(item.label) || item.ariaLabel === "Select model");
}

async function clickResolvedMenuItem(page: PageLike, item: MenuItem): Promise<boolean> {
  if (item.testId !== undefined && await clickIfUniqueMenuControl(
    page.locator?.(`[data-testid="${escapeAttributeValue(item.testId)}"]`),
    item
  )) {
    return true;
  }
  if (item.role !== undefined && await clickIfUniqueMenuControl(
    page.getByRole?.(item.role, { name: item.ariaLabel ?? item.label, exact: true }),
    item
  )) {
    return true;
  }
  return clickMenuItem(page, item);
}

async function openModelVersionSubmenu(page: PageLike, candidates: MenuItem[]): Promise<boolean> {
  const submenuOpeners = candidates.filter(isModelVersionSubmenuOpener);
  if (submenuOpeners.length === 0) {
    return false;
  }

  for (const candidate of submenuOpeners) {
    if (await openSubmenuByPointer(page, candidate)) {
      await page.waitForTimeout?.(250);
      if (await modelVersionMenuItemsAreVisible(page)) {
        return true;
      }
    }

    if (await clickMenuItem(page, candidate)) {
      await page.waitForTimeout?.(250);
      if (await modelVersionMenuItemsAreVisible(page)) {
        return true;
      }
    }
  }
  return false;
}

async function openSubmenuByPointer(page: PageLike, item: MenuItem): Promise<boolean> {
  const point = await menuItemCenter(page, item);
  if (point === undefined) {
    return false;
  }

  const pageWithMouse = page as PageLike & {
    mouse?: { move?: (x: number, y: number) => Promise<void> | void };
    cua?: { move?: (options: { x: number; y: number }) => Promise<void> | void };
  };

  if (pageWithMouse.mouse?.move !== undefined) {
    await pageWithMouse.mouse.move(point.x, point.y);
    return true;
  }
  if (pageWithMouse.cua?.move !== undefined) {
    await pageWithMouse.cua.move({ x: point.x, y: point.y });
    return true;
  }
  return false;
}

async function menuItemCenter(
  page: PageLike,
  item: Pick<MenuItem, "label" | "testId">,
  roles: string[] = ["menuitem", "menuitemradio", "option"]
): Promise<{ x: number; y: number } | undefined> {
  if (typeof page.evaluate !== "function") {
    return undefined;
  }

  const target: { label: string; roles: string[]; testId?: string } = { label: item.label, roles };
  if (item.testId !== undefined) {
    target.testId = item.testId;
  }

  return page.evaluate((target: { label: string; roles: string[]; testId?: string }) => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    const normalizedLabel = normalize(target.label);
    const roleSelector = target.roles.map(role => `[role='${role}']`).join(",");
    const visible = (element: HTMLElement) => {
      if (element.hidden || element.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== "hidden"
        && style.display !== "none"
        && style.opacity !== "0"
        && style.pointerEvents !== "none";
    };
    const containers = Array.from(document.querySelectorAll<HTMLElement>(
      "[role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]"
    )).filter(visible);
    const matches = Array.from(document.querySelectorAll(roleSelector))
      .filter(node => {
        const element = node as HTMLButtonElement;
        if (target.testId !== undefined && element.getAttribute("data-testid") !== target.testId) {
          return false;
        }
        if (element.disabled || element.getAttribute("aria-disabled") === "true") return false;
        const label = normalize(element.innerText ?? element.textContent ?? "");
        if (label !== normalizedLabel) {
          return false;
        }
        return visible(element)
          && containers.length > 0
          && containers.some(container => container.contains(element));
      });
    if (matches.length !== 1) return undefined;

    const rect = matches[0]!.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2)
    };
  }, target).catch(() => undefined);
}

async function modelVersionMenuItemsAreVisible(page: PageLike): Promise<boolean> {
  return (await enumerateVisibleMenuItems(page))
    .some(candidate => candidate.role === "menuitemradio" && MODEL_VERSION_LABEL_PATTERN.test(candidate.label));
}

function findExactSelectableMenuItem(items: MenuItem[], wanted: string): MenuItem | undefined {
  const normalized = normalizeLabel(wanted);
  const matches = items.filter(item =>
    item.normalized === normalized
    && !isModelVersionSubmenuOpener(item)
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function dedupeLabels(labels: string[]): string[] {
  return Array.from(new Set(labels));
}

async function selectorDrift<T>(
  page: PageLike,
  message: string,
  candidates?: string[]
): Promise<CommandResult<T>> {
  const visibleText = candidates?.join("\n") ?? await visibleButtonLabels(page);
  return {
    ok: false,
    status: "unsupported",
    warnings: [],
    blocker: selectorDriftBlocker(message, candidates, visibleText),
    context: await contextFromPage(page)
  };
}

function selectorDriftBlocker(
  message: string,
  candidates: string[] | undefined,
  visibleText = candidates?.join("\n") ?? ""
): NonNullable<CommandResult["blocker"]> {
  const candidateLabels = candidates ?? visibleText.split("\n").map(label => label.trim()).filter(Boolean).slice(0, 30);
  const blocker: NonNullable<CommandResult["blocker"]> = {
    kind: "selector_drift",
    code: "visible_candidate_not_found",
    message,
    visibleText,
    resumable: false
  };
  if (candidateLabels.length > 0) {
    blocker.candidates = candidateLabels.map(label => ({ label }));
  }
  return blocker;
}

async function visibleButtonLabels(page: PageLike): Promise<string> {
  return (await visibleButtonLabelList(page)).join("\n");
}

async function visibleButtonLabelList(page: PageLike): Promise<string[]> {
  if (typeof page.evaluate !== "function") {
    return [];
  }

  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("button, [role='button']"))
      .map(node => {
        const element = node as HTMLElement;
        return element.getAttribute("aria-label") ?? element.innerText ?? element.textContent ?? "";
      })
      .map(text => text.trim())
      .filter(Boolean)
      .slice(0, 30);
  }).then(labels => labels.map(normalizeWhitespace)).catch(() => []);
}

async function visibleModeButtonLabelList(page: PageLike): Promise<string[]> {
  if (typeof page.evaluate !== "function") {
    return [];
  }

  return page.evaluate((modeLabels: string[]) => {
    const normalizedModeLabels = modeLabels.map(label => label.toLowerCase());
    const tokenMatches = (text: string, token: string) => {
      if (token.length <= 3) {
        return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, "i").test(text);
      }
      return text.includes(token);
    };
    const scopedRoots = Array.from(document.querySelectorAll(
      "main form, main [data-testid*='composer' i], main [class*='composer' i]"
    ));
    return Array.from(document.querySelectorAll("button, [role='button']"))
      .map(node => {
        const element = node as HTMLElement;
        if (element.hidden
          || element.getAttribute("aria-hidden") === "true"
          || (typeof element.closest === "function"
            && element.closest("[hidden], [inert], [aria-hidden='true']") !== null)) return "";
        const style = typeof window?.getComputedStyle === "function"
          ? window.getComputedStyle(element)
          : undefined;
        if (style?.display === "none"
          || style?.visibility === "hidden"
          || style?.opacity === "0"
          || style?.pointerEvents === "none") return "";
        const rect = typeof element.getBoundingClientRect === "function"
          ? element.getBoundingClientRect()
          : { width: 1, height: 1 };
        if (rect.width <= 0 && rect.height <= 0) return "";
        if (scopedRoots.length > 0 && !scopedRoots.some(root => root.contains(node))) return "";
        const visibleText = (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
        const ariaLabel = (element.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
        const label = visibleText.length > 0 ? visibleText : ariaLabel;
        const testId = element.getAttribute("data-testid") ?? "";
        if (testId === "accounts-profile-button") return "";
        if (/open profile menu/i.test(label)) return "";
        if (visibleText.length === 0 && /feedback|conversation options|dismiss/i.test(ariaLabel)) return "";
        const normalized = label.toLowerCase();
        const structuralModelControl = /model-switcher|model-selector|mode-selector/i.test(testId)
          || /\b(?:gpt|sol|luna|terra)\b/i.test(label);
        if (!structuralModelControl && !normalizedModeLabels.some(modeLabel => tokenMatches(normalized, modeLabel))) return "";
        return label;
      })
      .filter(Boolean)
      .slice(0, 30);
  }, CURRENT_MODE_LABELS).then(labels => labels.map(normalizeWhitespace)).catch(() => []);
}
