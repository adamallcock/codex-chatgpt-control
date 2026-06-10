import { resultError, resultOk } from "../errors.js";
import { enumerateVisibleMenuItems, findUniqueMenuItem, type MenuItem } from "../dom/menus.js";
import { localeLabels } from "../dom/locale-labels.js";
import { normalizeLabel, normalizeWhitespace } from "../dom/visible-text.js";
import type { CommandResult, LocatorLike, PageLike, RuntimeEnv, SelectToolArgs, SetModeArgs } from "../types.js";
import { contextFromPage } from "./context.js";
import { bootstrap } from "./session.js";

const DEFAULT_MODE_EFFORT = "Thinking";
const CURRENT_MODE_LABELS: string[] = [...localeLabels.modeLabels];
const MODE_OPENER_LABELS = [...CURRENT_MODE_LABELS.filter(label => label !== "Pro"), ...localeLabels.modeOpenerExtra];

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
    const requested = requestedModeLabels(args);
    const opened = await waitForModeMenu(page, requested, args.timeoutMs ?? 30000);
    if (opened.alreadySelected.length === requested.length) {
      return resultOk({ selected: opened.alreadySelected, candidates: opened.modeButtons }, await contextFromPage(page));
    }
    if (!opened.opened) {
      return selectorDrift(page, "No unique ChatGPT mode menu opener was found.");
    }
    await page.waitForTimeout?.(250);
    const candidates = await enumerateVisibleMenuItems(page);
    const selected: string[] = [];

    for (const item of requested) {
      const match = findUniqueMenuItem(candidates, item);
      if (match === undefined) {
        const candidateLabels = candidates.map(candidate => candidate.label);
        return {
          ok: false,
          status: "unsupported",
          warnings: [],
          blocker: selectorDriftBlocker(`Mode option "${item}" was not found or was ambiguous.`, candidateLabels),
          context: await contextFromPage(page)
        };
      }
      if (!await clickMenuItem(page, match.label)) {
        return selectorDrift(page, `Mode option "${match.label}" was visible but could not be clicked.`, candidates.map(candidate => candidate.label));
      }
      selected.push(match.label);
    }

    return resultOk({ selected, candidates: candidates.map(candidate => candidate.label) }, await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

type ModeMenuOpenResult = {
  opened: boolean;
  alreadySelected: string[];
  modeButtons: string[];
};

async function waitForModeMenu(page: PageLike, requested: string[], timeoutMs: number): Promise<ModeMenuOpenResult> {
  const deadline = Date.now() + timeoutMs;
  let modeButtons: string[] = [];

  do {
    modeButtons = await visibleModeButtonLabelList(page);
    const alreadySelected = findAlreadySelectedModes(modeButtons, requested);
    if (alreadySelected.length === requested.length) {
      return { opened: false, alreadySelected, modeButtons };
    }

    const openMenuItems = await enumerateVisibleMenuItems(page);
    if (looksLikeModeMenu(openMenuItems.map(item => item.label))) {
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

    if (!await clickMenuItem(page, match.label)) {
      return selectorDrift(page, `Tool "${match.label}" was visible but could not be clicked.`, candidates.map(candidate => candidate.label));
    }
    return resultOk({ selected: match.label, candidates: candidates.map(candidate => candidate.label) }, await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

async function ensurePage(env: RuntimeEnv): Promise<CommandResult<unknown>> {
  if (env.page !== undefined) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
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

function looksLikeModeMenu(labels: string[]): boolean {
  return labels.some(label => {
    const normalized = normalizeLabel(label);
    return CURRENT_MODE_LABELS.some(modeLabel => visibleLabelMatches(normalized, normalizeLabel(modeLabel)));
  });
}

async function clickMenuItem(page: PageLike, label: string): Promise<boolean> {
  if (await clickModelSwitcherMenuItem(page, label)) {
    return true;
  }

  if (await clickMenuItemByDom(page, label)) {
    return true;
  }

  const roleLocator = page.locator?.("[role='menuitem'], [role='menuitemradio'], [role='option']")?.filter?.({ hasText: label });
  if (await clickIfUnique(roleLocator)) {
    return true;
  }

  const textLocator = page.getByText?.(label, { exact: true });
  return clickIfUnique(textLocator);
}

async function clickModelSwitcherMenuItem(page: PageLike, label: string): Promise<boolean> {
  if (typeof page.evaluate !== "function" || typeof page.locator !== "function") {
    return false;
  }

  const testId = await page.evaluate((wanted: string) => {
    const normalizedWanted = wanted.replace(/\s+/g, " ").trim().toLowerCase();
    const candidates = Array.from(document.querySelectorAll("[data-testid^='model-switcher-']"));
    const matches = candidates
      .filter(node => {
        const element = node as HTMLElement;
        const candidateTestId = element.getAttribute("data-testid") ?? "";
        if (candidateTestId.endsWith("-effort")) return false;
        const text = (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        return text === normalizedWanted;
      })
      .map(node => (node as HTMLElement).getAttribute("data-testid"))
      .filter((value): value is string => value !== null);

    return matches.length === 1 ? matches[0] : undefined;
  }, label).catch(() => undefined);

  if (testId === undefined) {
    return false;
  }

  return clickIfUnique(page.locator(`[data-testid="${escapeAttributeValue(testId)}"]`));
}

async function clickMenuItemByDom(page: PageLike, label: string): Promise<boolean> {
  if (typeof page.evaluate !== "function") {
    return false;
  }

  return page.evaluate((wanted: string) => {
    const normalizedWanted = wanted.replace(/\s+/g, " ").trim().toLowerCase();
    const candidates = Array.from(document.querySelectorAll("[role='menuitem'], [role='menuitemradio'], [role='option']"));
    const matches = candidates.filter(node => {
      const element = node as HTMLElement;
      const text = (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      return text === normalizedWanted;
    });
    if (matches.length !== 1) return false;
    (matches[0] as HTMLElement).click();
    return true;
  }, label).catch(() => false);
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

function toolLabels(tool: string): string[] {
  const known = (localeLabels.tools as Record<string, readonly string[]>)[tool];
  return known !== undefined ? [...known] : [tool];
}

function requestedModeLabels(args: SetModeArgs): string[] {
  const requested = [args.model, args.effort].filter((value): value is string => value !== undefined);
  return requested.length > 0 ? requested : [DEFAULT_MODE_EFFORT];
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

function visibleLabelMatches(label: string, wanted: string): boolean {
  if (wanted.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(wanted)}([^a-z0-9]|$)`, "i").test(label);
  }
  return label.includes(wanted);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function findAlreadySelectedModes(visibleButtons: string[], requested: string[]): string[] {
  return requested
    .map(label => findUniqueVisibleLabel(visibleButtons, label))
    .filter((label): label is string => label !== undefined);
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
    return Array.from(document.querySelectorAll("button, [role='button']"))
      .map(node => {
        const element = node as HTMLElement;
        const visibleText = (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
        const ariaLabel = (element.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
        const label = visibleText.length > 0 ? visibleText : ariaLabel;
        const testId = element.getAttribute("data-testid") ?? "";
        if (testId === "accounts-profile-button") return "";
        if (/open profile menu/i.test(label)) return "";
        if (visibleText.length === 0 && /feedback|conversation options|dismiss/i.test(ariaLabel)) return "";
        const normalized = label.toLowerCase();
        if (!normalizedModeLabels.some(modeLabel => tokenMatches(normalized, modeLabel))) return "";
        return label;
      })
      .filter(Boolean)
      .slice(0, 30);
  }, CURRENT_MODE_LABELS).then(labels => labels.map(normalizeWhitespace)).catch(() => []);
}
