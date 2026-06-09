import { resultError, resultOk } from "../errors.js";
import { enumerateVisibleMenuItems, findUniqueMenuItem } from "../dom/menus.js";
import { normalizeLabel, normalizeWhitespace } from "../dom/visible-text.js";
import type { CommandResult, LocatorLike, PageLike, RuntimeEnv, SelectToolArgs, SetModeArgs } from "../types.js";
import { contextFromPage } from "./context.js";
import { bootstrap } from "./session.js";

const DEFAULT_MODE_EFFORT = "Thinking";
const CURRENT_MODE_LABELS = ["Latest", "最新", "Instant", "Thinking", "シンキング", "Extended", "拡張", "Standard", "標準", "Pro", "プロ"];
const MODE_OPENER_LABELS = [...CURRENT_MODE_LABELS.filter(label => label !== "Pro"), "Configure"];

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
    if (modeSelectionSatisfied(opened.modeButtons, requested)) {
      return resultOk({ selected: opened.alreadySelected, candidates: opened.modeButtons }, await contextFromPage(page));
    }
    if (!opened.opened) {
      return selectorDrift(page, "No unique ChatGPT mode menu opener was found.");
    }
    await page.waitForTimeout?.(250);
    let candidates = await enumerateVisibleMenuItems(page);
    const candidateLabels = new Set(candidates.map(candidate => candidate.label));
    const selected: string[] = [];
    const combined = findCombinedModeMenuItem(candidates, args);
    if (combined !== undefined) {
      if (!await clickMenuItem(page, combined.label)) {
        return selectorDrift(page, `Mode option "${combined.label}" was visible but could not be clicked.`, candidates.map(candidate => candidate.label));
      }
      selected.push(combined.label);
    }

    for (const item of combined === undefined ? requested : []) {
      const match = findUniqueMenuItem(candidates, item);
      if (match === undefined) {
        if (await selectEffortFromConfigureModal(page, item)) {
          selected.push(item);
          await page.waitForTimeout?.(250);
          candidates = await enumerateVisibleMenuItems(page);
          for (const candidate of candidates) {
            candidateLabels.add(candidate.label);
          }
          continue;
        }
        const visibleCandidateLabels = [...candidateLabels];
        return {
          ok: false,
          status: "unsupported",
          warnings: [],
          blocker: selectorDriftBlocker(`Mode option "${item}" was not found or was ambiguous.`, visibleCandidateLabels),
          context: await contextFromPage(page)
        };
      }
      if (!await clickMenuItem(page, match.label)) {
        return selectorDrift(page, `Mode option "${match.label}" was visible but could not be clicked.`, candidates.map(candidate => candidate.label));
      }
      selected.push(match.label);
      await page.waitForTimeout?.(250);
      candidates = await enumerateVisibleMenuItems(page);
      for (const candidate of candidates) {
        candidateLabels.add(candidate.label);
      }
    }

    const verified = await waitForSelectedModes(page, requested, Math.min(args.timeoutMs ?? 30000, 5000));
    if (!modeSelectionSatisfied(verified, requested)) {
      const finalButtons = await visibleModeButtonLabelList(page);
      return selectorDrift(
        page,
        "Requested ChatGPT mode was clicked, but the final selected mode could not be verified.",
        [...new Set([...candidateLabels, ...finalButtons])]
      );
    }

    return resultOk({ selected: verified, candidates: [...candidateLabels] }, await contextFromPage(page));
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
    if (modeSelectionSatisfied(modeButtons, requested)) {
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
    const opened = await clickFirstUniqueButton(page, ["Add files and more", "Add files", "Add photos"]);
    if (!opened) {
      return selectorDrift(page, "No unique ChatGPT tool menu opener was found.");
    }
    await page.waitForTimeout?.(250);
    const candidates = await enumerateVisibleMenuItems(page);
    const wanted = toolLabel(args.tool);
    const match = findUniqueMenuItem(candidates, wanted);

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

  if (await clickModeOpenerByDom(page)) {
    return true;
  }

  return clickFirstUniqueButton(page, MODE_OPENER_LABELS);
}

async function clickModeOpenerByDom(page: PageLike): Promise<boolean> {
  if (typeof page.evaluate !== "function") {
    return false;
  }

  return page.evaluate((modeLabels: string[]) => {
    const normalizedModeLabels = modeLabels.map(label => label.toLowerCase());
    const tokenMatches = (text: string, token: string) => {
      if (token === "プロ") {
        return /(^|[\s・･•|/()（）-])プロ($|[\s・･•|/()（）-])/.test(text);
      }
      if (token.length <= 3 && /^[a-z0-9]+$/i.test(token)) {
        return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, "i").test(text);
      }
      return text.includes(token);
    };
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"))
      .filter(node => {
        const element = node as HTMLElement;
        if (element.getAttribute("data-testid") === "accounts-profile-button") return false;
        const aria = (element.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        if (/profile|プロファイル|conversation options|dismiss|feedback|send prompt|プロンプトを送信/i.test(aria)) return false;
        const text = (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        if (text.length === 0) return false;
        if (/プロンプト|プロジェクト|プロファイル/.test(text)) return false;
        return normalizedModeLabels.some(label => tokenMatches(text, label));
      });
    if (candidates.length !== 1) return false;
    (candidates[0] as HTMLElement).click();
    return true;
  }, CURRENT_MODE_LABELS).catch(() => false);
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

async function selectEffortFromConfigureModal(page: PageLike, effort: string): Promise<boolean> {
  if (!isEffortLabel(effort)) {
    return false;
  }

  if (!await openConfigureModal(page)) {
    return false;
  }

  if (await effortAlreadySelectedInConfigureModal(page, effort)) {
    await closeConfigureModal(page);
    return true;
  }

  const combo = page.locator?.("[role='combobox']")?.filter?.({ hasText: effortCurrentSelectionPattern() });
  if (!await clickIfUnique(combo)) {
    return false;
  }
  await page.waitForTimeout?.(250);

  const wanted = effortAliasPattern(effort);
  const option = page.locator?.("[role='option'], [role='menuitem'], [role='menuitemradio']")?.filter?.({ hasText: wanted });
  if (!await clickIfUnique(option)) {
    return false;
  }
  await page.waitForTimeout?.(250);

  const selected = await effortAlreadySelectedInConfigureModal(page, effort);
  await closeConfigureModal(page);
  return selected;
}

async function openConfigureModal(page: PageLike): Promise<boolean> {
  if (await configureModalVisible(page)) {
    return true;
  }

  if (await clickModelConfigureMenuItem(page)) {
    await page.waitForTimeout?.(250);
    return configureModalVisible(page);
  }

  return false;
}

async function clickModelConfigureMenuItem(page: PageLike): Promise<boolean> {
  if (typeof page.locator === "function") {
    const testId = page.locator("[data-testid='model-configure-modal']");
    if (await clickIfUnique(testId)) {
      return true;
    }
  }
  return clickMenuItem(page, "設定する...");
}

async function configureModalVisible(page: PageLike): Promise<boolean> {
  if (typeof page.evaluate !== "function") {
    return false;
  }
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], header, h2"))
      .some(node => ((node as HTMLElement).innerText ?? node.textContent ?? "").includes("インテリジェンス"));
  }).catch(() => false);
}

async function effortAlreadySelectedInConfigureModal(page: PageLike, effort: string): Promise<boolean> {
  if (typeof page.evaluate !== "function") {
    return false;
  }
  return page.evaluate((aliases: string[]) => {
    const comboTexts = Array.from(document.querySelectorAll("[role='combobox']"))
      .map(node => ((node as HTMLElement).innerText ?? node.textContent ?? "").replace(/\s+/g, " ").trim());
    return comboTexts.some(text => aliases.some(alias => text === alias));
  }, effortAliases(effort)).catch(() => false);
}

async function closeConfigureModal(page: PageLike): Promise<void> {
  const closeByTestId = page.locator?.("[data-testid='close-button']");
  if (await clickIfUnique(closeByTestId)) {
    await page.waitForTimeout?.(250);
    return;
  }
  const closeByRole = page.getByRole?.("button", { name: "閉じる", exact: true });
  if (await clickIfUnique(closeByRole)) {
    await page.waitForTimeout?.(250);
  }
}

function isEffortLabel(label: string): boolean {
  const normalized = normalizeLabel(label);
  return ["extended", "拡張", "standard", "標準", "thinking", "シンキング"].includes(normalized);
}

function effortAliases(label: string): string[] {
  return labelAliases(label).filter(alias => ["extended", "拡張", "じっくり思考", "standard", "標準", "thinking", "シンキング"].includes(alias));
}

function effortAliasPattern(label: string): RegExp {
  return new RegExp(effortAliases(label).map(escapeRegExp).join("|"), "i");
}

function effortCurrentSelectionPattern(): RegExp {
  return /^(標準|拡張|Standard|Extended)$/i;
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

function toolLabel(tool: string): string {
  switch (tool) {
    case "web_search":
      return "Web search";
    case "deep_research":
      return "Deep research";
    case "create_image":
      return "Create image";
    default:
      return tool;
  }
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
  return labelAliases(wanted).some(alias => visibleLabelMatchesOne(label, alias));
}

function visibleLabelMatchesOne(label: string, wanted: string): boolean {
  if (wanted === "プロ") {
    return /(^|[\s・･•|/()（）-])プロ($|[\s・･•|/()（）-])/.test(label);
  }
  if (wanted.length <= 3 && /^[a-z0-9]+$/i.test(wanted)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(wanted)}([^a-z0-9]|$)`, "i").test(label);
  }
  return label.includes(wanted);
}

function labelAliases(label: string): string[] {
  const normalized = normalizeLabel(label);
  const aliases = new Set([normalized]);
  switch (normalized) {
    case "extended":
    case "拡張":
      aliases.add("extended");
      aliases.add("拡張");
      aliases.add("じっくり思考");
      break;
    case "standard":
    case "標準":
      aliases.add("standard");
      aliases.add("標準");
      break;
    case "pro":
    case "プロ":
      aliases.add("pro");
      aliases.add("プロ");
      break;
    case "thinking":
    case "シンキング":
      aliases.add("thinking");
      aliases.add("シンキング");
      break;
  }
  return [...aliases];
}

function findCombinedModeMenuItem(items: Array<{ label: string; normalized: string }>, args: SetModeArgs): { label: string } | undefined {
  if (args.model === undefined || args.effort === undefined) {
    return undefined;
  }
  const matches = items.filter(item =>
    visibleLabelMatches(item.normalized, normalizeLabel(args.model!))
    && visibleLabelMatches(item.normalized, normalizeLabel(args.effort!))
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function findAlreadySelectedModes(visibleButtons: string[], requested: string[]): string[] {
  return [...new Set(requested
    .map(label => findUniqueVisibleLabel(visibleButtons, label))
    .filter((label): label is string => label !== undefined))];
}

function modeSelectionSatisfied(visibleButtons: string[], requested: string[]): boolean {
  return requested.every(label => findUniqueVisibleLabel(visibleButtons, label) !== undefined);
}

async function waitForSelectedModes(page: PageLike, requested: string[], timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;

  do {
    const visibleButtons = await visibleModeButtonLabelList(page);
    const selected = findAlreadySelectedModes(visibleButtons, requested);
    if (modeSelectionSatisfied(visibleButtons, requested)) {
      return selected;
    }

    if (Date.now() >= deadline) {
      return selected;
    }
    await page.waitForTimeout?.(250);
  } while (true);
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
      if (token === "プロ") {
        return /(^|[\s・･•|/()（）-])プロ($|[\s・･•|/()（）-])/.test(text);
      }
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
        if (/profile|プロファイル|send prompt|プロンプトを送信/i.test(ariaLabel)) return "";
        if (/プロンプト|プロジェクト|プロファイル/.test(visibleText)) return "";
        if (visibleText.length === 0 && /feedback|conversation options|dismiss/i.test(ariaLabel)) return "";
        const normalized = label.toLowerCase();
        if (!normalizedModeLabels.some(modeLabel => tokenMatches(normalized, modeLabel))) return "";
        return label;
      })
      .filter(Boolean)
      .slice(0, 30);
  }, CURRENT_MODE_LABELS).then(labels => labels.map(normalizeWhitespace)).catch(() => []);
}
