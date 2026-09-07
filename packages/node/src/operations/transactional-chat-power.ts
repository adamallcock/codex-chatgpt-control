import { localeLabels } from "../dom/locale-labels.js";
import { readChatPopover, type ChatPopoverSnapshot } from "../commands/chat-popover.js";
import type { LocatorLike, PageLike } from "../types.js";

export type TransactionalChatPower = Readonly<{
  presentation: "closed" | "simple";
  triggerId: string;
  currentLabel: string;
  modelMarker: string;
  popover?: ChatPopoverSnapshot;
}>;

/** Read current scoped Chat effort without opening a menu or probing a value. */
export async function readTransactionalChatPower(page: Readonly<PageLike>): Promise<TransactionalChatPower | undefined> {
  const popover = (await readChatPopover(page)).snapshot;
  if (page.evaluate === undefined) return undefined;
  const expandedTriggerLabels = ["Thinking effort"];
  const trigger = await page.evaluate((config: { chatLabels: string[]; workLabels: string[]; effortLabels: string[]; expandedTriggerLabels: string[] }) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const visible = (element: Element): boolean => {
      let current: Node | null = element;
      for (let depth = 0; current !== null && depth < 64; depth += 1) {
        if (current.nodeType !== 1) return true;
        const node = current as HTMLElement;
        if (node.hidden || node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true"
          || node.getAttribute("aria-disabled") === "true" || node.getAttribute("data-active") === "false") return false;
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return false;
        if (current === element) {
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
        }
        current = current.parentNode;
      }
      return current === null;
    };
    const forms = document.querySelectorAll("main form");
    if (forms.length > 8) return undefined;
    const candidates: Array<{ triggerId: string; currentLabel: string; modelMarker: string; expanded: boolean }> = [];
    let visited = 0;
    for (const form of Array.from(forms)) {
      if (!visible(form)) continue;
      const nodes: Element[] = [];
      let node: Node | null = form.firstChild;
      while (node !== null) {
        if (++visited > 4096) return undefined;
        if (node.nodeType === 1) nodes.push(node as Element);
        if (node.firstChild !== null) { node = node.firstChild; continue; }
        while (node !== null && node !== form && node.nextSibling === null) node = node.parentNode;
        if (node === form || node === null) break;
        node = node.nextSibling;
      }
      const editors = nodes.filter(node => (node.tagName === "TEXTAREA" || node.getAttribute("contenteditable") === "true" || node.getAttribute("role") === "textbox") && visible(node));
      if (editors.length !== 1) continue;
      const editor = editors[0]!;
      const editorLabel = normalize(editor.getAttribute("aria-label") ?? editor.getAttribute("placeholder") ?? "").toLocaleLowerCase();
      if (!config.chatLabels.some(label => normalize(label).toLocaleLowerCase() === editorLabel)
        || config.workLabels.some(label => normalize(label).toLocaleLowerCase() === editorLabel)) continue;
      for (const button of nodes) {
        if (button.tagName !== "BUTTON" || !visible(button) || (button as HTMLButtonElement).disabled
          || button.getAttribute("aria-haspopup") !== "menu"
          || !(button.getAttribute("class") ?? "").split(/\s+/).includes("__composer-pill")) continue;
        const expanded = button.getAttribute("aria-expanded");
        const id = button.getAttribute("id");
        if ((expanded !== "true" && expanded !== "false") || id === null || id.length === 0 || id.length > 240 || /\s/.test(id)) continue;
        let raw = "";
        let child: Node | null = button.firstChild;
        while (child !== null) {
          if (++visited > 4096) return undefined;
          const hidden = child.nodeType === 1 && !visible(child as Element);
          if (child.nodeType === 3) {
            raw += child.nodeValue ?? "";
            if (raw.length > 240) return undefined;
          }
          if (!hidden && child.firstChild !== null) { child = child.firstChild; continue; }
          while (child !== null && child !== button && child.nextSibling === null) child = child.parentNode;
          if (child === button || child === null) break;
          child = child.nextSibling;
        }
        const text = normalize(raw);
        const labels = [...config.effortLabels, ...(expanded === "true" ? config.expandedTriggerLabels : [])]
          .filter(label => text.toLocaleLowerCase().endsWith(label.toLocaleLowerCase()))
          .sort((left, right) => right.length - left.length);
        const currentLabel = labels[0];
        if (currentLabel === undefined) continue;
        const prefix = normalize(text.slice(0, text.length - currentLabel.length));
        if (prefix.length > 0 && !/^(?:latest|(?:gpt[\s-]?)?\d+(?:\.\d+)?(?:[ .-][a-z]+)?)$/i.test(prefix)) continue;
        candidates.push({ triggerId: id, currentLabel: text.slice(text.length - currentLabel.length), modelMarker: prefix, expanded: expanded === "true" });
      }
    }
    return candidates.length === 1 ? candidates[0] : undefined;
  }, {
    chatLabels: localeLabels.composerTextbox,
    workLabels: localeLabels.workComposerTextbox,
    effortLabels: Array.from(new Set([...Object.values(localeLabels.configurationOptions).flat(), ...Object.entries(localeLabels.modeOptions).filter(([key]) => key !== "latest").flatMap(([, labels]) => labels)])),
    expandedTriggerLabels
  }).catch(() => undefined);
  if (trigger === undefined || trigger === null || typeof trigger.currentLabel !== "string") return undefined;
  if (!trigger.expanded) {
    if (popover !== undefined) return undefined;
    return { presentation: "closed", triggerId: trigger.triggerId, currentLabel: trigger.currentLabel, modelMarker: trigger.modelMarker };
  }
  if (popover?.view !== "simple" || popover.slider === undefined || popover.effort === undefined
    || popover.triggerId !== trigger.triggerId
    || (popover.effort !== trigger.currentLabel && !expandedTriggerLabels.includes(trigger.currentLabel))) return undefined;
  return { presentation: "simple", triggerId: trigger.triggerId, currentLabel: popover.effort, modelMarker: trigger.modelMarker, popover };
}

function idSelector(id: string): string { return `[id="${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`; }

export function transactionalPowerTrigger(page: Readonly<PageLike>, snapshot: TransactionalChatPower): LocatorLike | undefined {
  return page.locator?.(idSelector(snapshot.triggerId));
}

export async function preflightTransactionalPowerTrigger(locator: LocatorLike, snapshot: TransactionalChatPower): Promise<boolean> {
  if (locator.evaluate === undefined || await locator.count?.() !== 1) return false;
  const state = await locator.evaluate(element => {
    let current: Node | null = element;
    let form = false, main = false;
    for (let depth = 0; current !== null && depth < 64; depth += 1) {
      if (current.nodeType !== 1) break;
      const node = current as HTMLElement;
      if (node.hidden || node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true"
        || node.getAttribute("aria-disabled") === "true" || node.getAttribute("data-active") === "false") return undefined;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return undefined;
      if (node.tagName === "FORM") form = true;
      if (node.tagName === "MAIN" && form) main = true;
      current = current.parentNode;
    }
    const rect = element.getBoundingClientRect();
    if (current?.nodeType === 1 || !form || !main || rect.width <= 0 || rect.height <= 0 || element.tagName !== "BUTTON"
      || (element as HTMLButtonElement).disabled || element.hasAttribute("disabled")
      || !(element.getAttribute("class") ?? "").split(/\s+/).includes("__composer-pill")) return undefined;
    return { id: element.getAttribute("id"), expanded: element.getAttribute("aria-expanded"), popup: element.getAttribute("aria-haspopup") };
  }).catch(() => undefined);
  return state !== undefined && state.id === snapshot.triggerId && state.expanded === "false" && state.popup === "menu";
}

export function transactionalPowerMenu(page: Readonly<PageLike>, snapshot: TransactionalChatPower): LocatorLike | undefined {
  return page.locator?.(`[role="menu"][aria-labelledby="${snapshot.triggerId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
}

export function transactionalPowerSlider(page: Readonly<PageLike>, snapshot: TransactionalChatPower): LocatorLike | undefined {
  const popover = snapshot.popover;
  if (popover?.slider === undefined) return undefined;
  const roots = page.locator?.('[data-testid="composer-intelligence-picker-content"]');
  const root = roots?.nth?.(popover.rootIndex) ?? (popover.rootIndex === 0 ? roots : undefined);
  const sliders = root?.locator?.('[data-testid="composer-model-picker-slider-simple-view"][data-active="true"] [role="slider"]');
  return sliders?.nth?.(popover.slider.index) ?? (popover.slider.index === 0 ? sliders : undefined);
}

/** Locator preflight is read-only and uses the same active/owned rules as discovery. */
export async function preflightTransactionalPowerSlider(locator: LocatorLike, snapshot: TransactionalChatPower): Promise<boolean> {
  if (locator.evaluate === undefined || await locator.count?.() !== 1 || snapshot.popover?.slider === undefined) return false;
  const state = await locator.evaluate(element => {
    let current: Node | null = element;
    let owner = false, panel = false, view = false;
    let triggerId: string | null = null;
    for (let depth = 0; current !== null && depth < 64; depth += 1) {
      if (current.nodeType !== 1) break;
      const node = current as HTMLElement;
      if (node.hidden || node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("data-active") === "false"
        || node.getAttribute("aria-disabled") === "true" || node.getAttribute("data-locked") === "true"
        || (current !== element && node.getAttribute("aria-hidden") === "true")) return undefined;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return undefined;
      if (node.getAttribute("data-testid") === "composer-intelligence-picker-content") owner = true;
      if (node.getAttribute("data-testid") === "composer-model-picker-slider-simple-view" && node.getAttribute("data-active") === "true") panel = true;
      if (node.getAttribute("data-view") === "simple" && node.getAttribute("data-has-slider") === "true"
        && node.getAttribute("data-has-advanced-view") === "true" && node.getAttribute("data-model-selection-view") === "true") view = true;
      if (node.getAttribute("role") === "menu" && node.getAttribute("data-state") === "open") triggerId = node.getAttribute("aria-labelledby");
      current = current.parentNode;
    }
    const rect = element.getBoundingClientRect();
    if (current?.nodeType === 1 || !owner || !panel || !view || rect.width <= 0 || rect.height <= 0 || element.getAttribute("role") !== "slider") return undefined;
    return { triggerId, minimum: element.getAttribute("aria-valuemin"), maximum: element.getAttribute("aria-valuemax"), current: element.getAttribute("aria-valuenow") };
  }).catch(() => undefined);
  return state !== undefined && state.triggerId === snapshot.triggerId && state.minimum === String(snapshot.popover.slider.minimum)
    && state.maximum === String(snapshot.popover.slider.maximum) && state.current === String(snapshot.popover.slider.current);
}
