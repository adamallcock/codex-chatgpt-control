import { localeLabels } from "../dom/locale-labels.js";
import { normalizeForLabelMatch } from "../dom/label-match.js";
import type { LocatorLike, PageLike } from "../types.js";

export type ChatPopoverSnapshot = {
  view: "simple" | "advanced";
  rootIndex: number;
  triggerId?: string;
  toggleIndex: number;
  modelOptions: Array<{ label: string; checked: boolean; index: number }>;
  activeModel?: string;
  effort?: string;
  speed?: "Standard" | "Fast";
  speedIndex?: number;
  slider?: { index: number; minimum: number; maximum: number; current: number; valueText?: string };
};

/** Inactive model radios retain geometry. Require an owned, active, non-inert view. */
export async function readChatPopover(page: PageLike): Promise<{ snapshot?: ChatPopoverSnapshot; acted: boolean }> {
  if (page.evaluate === undefined) return { acted: false };
  const observation = await page.evaluate((config: { powerLabels: string[] }) => {
    const visible = (element: Element, allowSliderAriaHidden = false): boolean => {
      let current: Node | null = element;
      for (let depth = 0; current !== null && depth < 64; depth += 1) {
        if (current.nodeType !== 1) return true;
        const node = current as HTMLElement;
        if (node.hidden || node.hasAttribute("hidden") || node.hasAttribute("inert")
          || node.getAttribute("data-active") === "false"
          || (node.getAttribute("aria-hidden") === "true" && !(current === element && allowSliderAriaHidden))
          || node.getAttribute("aria-disabled") === "true" || node.getAttribute("data-locked") === "true") return false;
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return false;
        const rect = node.getBoundingClientRect();
        if (current === element && (rect.width <= 0 || rect.height <= 0)) return false;
        current = current.parentNode;
      }
      return current === null;
    };
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const roots = document.querySelectorAll('[data-testid="composer-intelligence-picker-content"]');
    if (roots.length > 8) return { acted: false };
    const activeRoots = Array.from(roots).filter(node => visible(node));
    if (activeRoots.length !== 1) return { acted: false };
    const root = activeRoots[0]!;
    let menu: Element | null = null;
    let ancestor = root.parentNode;
    for (let depth = 0; ancestor?.nodeType === 1 && depth < 16; depth += 1) {
      const element = ancestor as Element;
      if (element.getAttribute("role") === "menu") { menu = element; break; }
      ancestor = ancestor.parentNode;
    }
    if (menu?.getAttribute("data-state") !== "open" || !visible(menu)) return { acted: false };
    const nodes: Element[] = [];
    const text = new Map<Element, string>();
    let current: Node | null = root.firstChild;
    let count = 0;
    let chars = 0;
    while (current !== null) {
      if (++count > 4096) return { acted: false };
      if (current.nodeType === 1) nodes.push(current as Element);
      if (current.nodeType === 3) {
        const value = current.nodeValue ?? "";
        chars += value.length;
        if (chars > 32768) return { acted: false };
        let parent = current.parentNode;
        for (let depth = 0; parent !== null && parent !== root && depth < 64; depth += 1) {
          if (parent.nodeType === 1) text.set(parent as Element, ((text.get(parent as Element) ?? "") + value).slice(0, 240));
          parent = parent.parentNode;
        }
      }
      if (current.firstChild !== null) { current = current.firstChild; continue; }
      while (current !== null && current !== root && current.nextSibling === null) current = current.parentNode;
      if (current === root || current === null) break;
      current = current.nextSibling;
    }
    const within = (node: Element, owner: Element): boolean => {
      let current: Node | null = node;
      for (let depth = 0; current !== null && depth < 64; depth += 1) {
        if (current === owner) return true;
        current = current.parentNode;
      }
      return false;
    };
    const owners = nodes.filter(node => node.getAttribute("data-has-slider") === "true"
      && node.getAttribute("data-has-advanced-view") === "true"
      && node.getAttribute("data-model-selection-view") === "true" && visible(node));
    if (owners.length !== 1) return { acted: false };
    const owner = owners[0]!;
    const view = owner.getAttribute("data-view");
    if (view !== "simple" && view !== "advanced") return { acted: false };
    const panels = nodes.filter(node => node.getAttribute("data-testid") === `composer-model-picker-slider-${view}-view`
      && within(node, owner) && node.getAttribute("data-active") === "true" && visible(node));
    if (panels.length !== 1) return { acted: false };
    const panel = panels[0]!;
    const toggles = nodes.filter(node => node.getAttribute("role") === "menuitem"
      && node.getAttribute("data-interactive") === "true"
      && node.getAttribute("aria-expanded") === String(view === "advanced")
      && within(node, owner) && visible(node));
    if (toggles.length > 1 || (view === "simple" && toggles.length !== 1)) return { acted: false };
    // The structural toggle owns this transition, independently of localized name/text.
    const modelNodes = view === "advanced" ? nodes.filter(node => within(node, panel)
      && node.getAttribute("role") === "menuitemradio" && visible(node)) : [];
    if (modelNodes.length > 32) return { acted: false };
    const modelLabel = (node: Element): string => {
      const primary = nodes.filter(child => within(child, node) && (child.getAttribute("class") ?? "").split(/\s+/).includes("truncate"));
      return normalize(primary.length === 1 ? text.get(primary[0]!) ?? "" : text.get(node) ?? "");
    };
    const snapshot: ChatPopoverSnapshot = {
      view, rootIndex: Array.from(roots).indexOf(root),
      toggleIndex: nodes.filter(node => node.getAttribute("role") === "menuitem" && node.getAttribute("data-interactive") === "true").indexOf(toggles[0]!), modelOptions: modelNodes.map(node => ({
        label: modelLabel(node), checked: node.getAttribute("aria-checked") === "true",
        index: nodes.filter(row => within(row, panel) && row.getAttribute("role") === "menuitemradio").indexOf(node)
      })).filter(option => option.label.length > 0)
    };
    const triggerId = menu.getAttribute("aria-labelledby");
    if (triggerId !== null && triggerId.length > 0 && triggerId.length < 240 && !/\s/.test(triggerId)) snapshot.triggerId = triggerId;
    const checked = snapshot.modelOptions.filter(option => option.checked);
    if (checked.length === 1) snapshot.activeModel = checked[0]!.label;
    if (view === "simple") {
      const speedControls = nodes.filter(node => node.getAttribute("role") === "menuitemcheckbox"
        && node.hasAttribute("data-fast-mode-enabled") && within(node, owner) && visible(node));
      if (speedControls.length === 1) {
        const speed = speedControls[0]!;
        const checked = speed.getAttribute("aria-checked");
        if ((checked === "true" || checked === "false") && speed.getAttribute("data-fast-mode-enabled") === checked
          && speed.getAttribute("data-visible") === "true") {
          snapshot.speed = checked === "true" ? "Fast" : "Standard";
          snapshot.speedIndex = nodes.filter(node => node.getAttribute("role") === "menuitemcheckbox" && node.hasAttribute("data-fast-mode-enabled")).indexOf(speed);
        }
      }
      const sliders = nodes.filter(node => node.getAttribute("role") === "slider" && within(node, panel) && visible(node, true));
      if (sliders.length === 1) {
        const slider = sliders[0]!;
        const powers = nodes.filter(node => within(slider, node) && within(node, panel)
          && node.getAttribute("role") === "menuitem" && visible(node)
          && config.powerLabels.some(label => normalize(node.getAttribute("aria-label") ?? "").toLocaleLowerCase() === label.toLocaleLowerCase()));
        const sliderOwners = nodes.filter(node => within(slider, node) && within(node, panel) && node.hasAttribute("data-model-reasoning-effort-slider"));
        const integer = (name: string): number | undefined => {
          const raw = slider.getAttribute(name);
          return raw !== null && /^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined;
        };
        const minimum = integer("aria-valuemin"), maximum = integer("aria-valuemax"), now = integer("aria-valuenow");
        if (powers.length === 1 && sliderOwners.length === 1 && minimum !== undefined && maximum !== undefined && now !== undefined
          && maximum > minimum && maximum - minimum < 32 && now >= minimum && now <= maximum) {
          snapshot.slider = { index: nodes.filter(node => node.getAttribute("role") === "slider" && within(node, panel)).indexOf(slider), minimum, maximum, current: now };
          const valueText = normalize(slider.getAttribute("aria-valuetext") ?? "");
          if (valueText.length > 0) snapshot.slider.valueText = valueText;
          else {
            const descriptionIds = (powers[0]!.getAttribute("aria-describedby") ?? "").split(/\s+/).slice(0, 8);
            for (const id of descriptionIds) {
              const descriptions = nodes.filter(node => node.getAttribute("id") === id);
              if (descriptions.length !== 1) continue;
              const description = normalize(text.get(descriptions[0]!) ?? "");
              const ordinal = /^(.+?),\s*(\d+)\s+of\s+(\d+)\./u.exec(description);
              if (ordinal !== null && Number(ordinal[2]) === now - minimum + 1 && Number(ordinal[3]) === maximum - minimum + 1) snapshot.slider.valueText = ordinal[1]!;
            }
          }
          if (snapshot.slider.valueText !== undefined) snapshot.effort = snapshot.slider.valueText;
        }
      }
    }
    return { snapshot, acted: false };
  }, { powerLabels: localeLabels.configurationAxes.power }).catch(() => ({ acted: false }));
  return observation !== undefined && observation !== null && typeof observation.acted === "boolean" ? observation : { acted: false };
}

function observedRoot(page: PageLike, snapshot: ChatPopoverSnapshot): LocatorLike | undefined {
  const roots = page.locator?.('[data-testid="composer-intelligence-picker-content"]');
  return roots?.nth?.(snapshot.rootIndex) ?? (snapshot.rootIndex === 0 ? roots : undefined);
}

async function clickObservedControl(page: PageLike, snapshot: ChatPopoverSnapshot, modelIndex?: number): Promise<boolean> {
  const selector = modelIndex === undefined ? '[role="menuitem"][data-interactive="true"]'
    : '[data-testid="composer-model-picker-slider-advanced-view"][data-active="true"] [role="menuitemradio"]';
  const candidates = observedRoot(page, snapshot)?.locator?.(selector);
  const index = modelIndex ?? snapshot.toggleIndex;
  const target = candidates?.nth?.(index) ?? (index === 0 ? candidates : undefined);
  if (target?.click === undefined || target.evaluate === undefined || await target.count?.() !== 1) return false;
  const state = await target.evaluate(element => {
    let current: Node | null = element;
    let owned = false;
    for (let depth = 0; current !== null && depth < 64; depth += 1) {
      if (current.nodeType !== 1) break;
      const node = current as HTMLElement;
      if (node.hidden || node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true"
        || node.getAttribute("aria-disabled") === "true" || node.getAttribute("data-active") === "false") return undefined;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return undefined;
      if (node.getAttribute("data-testid") === "composer-intelligence-picker-content") owned = true;
      current = current.parentNode;
    }
    const rect = element.getBoundingClientRect();
    if (!owned || rect.width <= 0 || rect.height <= 0) return undefined;
    let label = "";
    const primary = new Map<Element, string>();
    let child: Node | null = element.firstChild;
    let count = 0;
    while (child !== null) {
      if (++count > 512) return undefined;
      if (child.nodeType === 3) {
        label += child.nodeValue ?? "";
        if (label.length > 512) return undefined;
        let parent = child.parentNode;
        for (let depth = 0; parent !== null && parent !== element && depth < 64; depth += 1) {
          if (parent.nodeType === 1 && ((parent as Element).getAttribute("class") ?? "").split(/\s+/).includes("truncate")) {
            primary.set(parent as Element, (primary.get(parent as Element) ?? "") + (child.nodeValue ?? ""));
          }
          parent = parent.parentNode;
        }
      }
      if (child.firstChild !== null) { child = child.firstChild; continue; }
      while (child !== null && child !== element && child.nextSibling === null) child = child.parentNode;
      if (child === element || child === null) break;
      child = child.nextSibling;
    }
    return { role: element.getAttribute("role"), expanded: element.getAttribute("aria-expanded"), label: (primary.size === 1 ? [...primary.values()][0]! : label).replace(/\s+/g, " ").trim() };
  }).catch(() => undefined);
  if (state === undefined || state.role !== (modelIndex === undefined ? "menuitem" : "menuitemradio")
    || (modelIndex === undefined && state.expanded !== String(snapshot.view === "advanced"))) return false;
  const expectedModel = snapshot.modelOptions.find(option => option.index === modelIndex);
  if (modelIndex !== undefined && (expectedModel === undefined || state.label !== expectedModel.label)) return false;
  await target.click();
  return true;
}

export async function closeChatPopover(page: PageLike, before?: ChatPopoverSnapshot): Promise<boolean> {
  const snapshot = before ?? (await readChatPopover(page)).snapshot;
  if (snapshot === undefined) return false;
  const escapedId = snapshot.triggerId?.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const menu = escapedId === undefined ? undefined : page.locator?.(`[role="menu"][aria-labelledby="${escapedId}"]`);
  if (menu?.press !== undefined && await menu.count?.() === 1) await menu.press("Escape");
  else if (page.keyboard?.press !== undefined) await page.keyboard.press("Escape");
  else if (page.cua?.keypress !== undefined) await page.cua.keypress({ keys: ["ESC"] });
  else return false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await waitForPopoverTransition(page, 100);
    if ((await readChatPopover(page)).snapshot === undefined) return true;
  }
  return false;
}

async function waitForPopoverTransition(page: PageLike, milliseconds: number): Promise<void> {
  if (page.waitForTimeout !== undefined) await page.waitForTimeout(milliseconds);
  else await new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

async function reopenChatPopover(page: PageLike, before: ChatPopoverSnapshot): Promise<ChatPopoverSnapshot | undefined> {
  if (before.triggerId === undefined) return undefined;
  if (!await closeChatPopover(page, before)) return undefined;
  // aria-labelledby was read from this exact owned menu before closing. The
  // trigger's accessible name can change when a model view is dismissed.
  const trigger = page.locator?.(`[id="${before.triggerId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
  if (trigger?.click === undefined || trigger.evaluate === undefined || await trigger.count?.() !== 1) return undefined;
  const isVisible = () => trigger.evaluate!(element => {
    let current: Node | null = element;
    for (let depth = 0; current !== null && depth < 64; depth += 1) {
      if (current.nodeType !== 1) break;
      const node = current as HTMLElement;
      if (node.hidden || node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true" || node.getAttribute("aria-disabled") === "true") return false;
      const style = window.getComputedStyle(node);
      // Work task composers sit below pointer-events:none layout wrappers.
      // A descendant can override that property; computed target actionability
      // remains required, while hidden/inert ancestors still block.
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0"
        || (current === element && style.pointerEvents === "none")) return false;
      current = current.parentNode;
    }
    if (current?.nodeType === 1) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (element.tagName.toLowerCase() === "button" || element.getAttribute("role") === "button");
  }).catch(() => false);
  let visible = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await isVisible()) { visible = true; break; }
    if (attempt + 1 < 5) await waitForPopoverTransition(page, 100);
  }
  if (!visible) return undefined;
  await trigger.click();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await waitForPopoverTransition(page, 100);
    const reopened = (await readChatPopover(page)).snapshot;
    if (reopened?.view === "simple" && reopened.triggerId === before.triggerId) return reopened;
  }
  return undefined;
}

export async function setChatPopoverView(page: PageLike, view: ChatPopoverSnapshot["view"]): Promise<ChatPopoverSnapshot | undefined> {
  const before = (await readChatPopover(page)).snapshot;
  if (before === undefined || before.view === view) return before;
  if (view === "simple" && before.triggerId !== undefined) return reopenChatPopover(page, before);
  if (!await clickObservedControl(page, before)) return undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await waitForPopoverTransition(page, 100);
    const after = (await readChatPopover(page)).snapshot;
    if (after?.view === view) return after;
  }
  return undefined;
}

/** Opens the model view for evidence; does not probe slider values during inspection. */
export async function inspectChatPopover(page: PageLike): Promise<ChatPopoverSnapshot | undefined> {
  const initial = (await readChatPopover(page)).snapshot;
  if (initial === undefined) return undefined;
  let inspected: ChatPopoverSnapshot | undefined;
  try {
    const simple = await setChatPopoverView(page, "simple");
    const advanced = await setChatPopoverView(page, "advanced");
    if (simple !== undefined && advanced !== undefined) {
      inspected = { ...advanced, view: initial.view, ...(simple.effort === undefined ? {} : { effort: simple.effort }),
        ...(simple.slider === undefined ? {} : { slider: simple.slider }),
        ...(simple.speed === undefined ? {} : { speed: simple.speed, speedIndex: simple.speedIndex }) };
    }
  } finally {
    if (await setChatPopoverView(page, initial.view) === undefined) inspected = undefined;
  }
  return inspected;
}

export async function selectChatPopoverModel(page: PageLike, labels: string[]): Promise<string | undefined> {
  const initial = (await readChatPopover(page)).snapshot;
  if (initial === undefined) return undefined;
  try {
    const advanced = await setChatPopoverView(page, "advanced");
    if (advanced === undefined) return undefined;
    const matches = advanced.modelOptions.filter(option => labels.some(label => normalizeForLabelMatch(label) === normalizeForLabelMatch(option.label)));
    if (matches.length !== 1 || !await clickObservedControl(page, advanced, matches[0]!.index)) return undefined;
    await waitForPopoverTransition(page, 150);
    const after = await setChatPopoverView(page, "advanced");
    return after?.activeModel !== undefined && labels.some(label => normalizeForLabelMatch(label) === normalizeForLabelMatch(after.activeModel!)) ? after.activeModel : undefined;
  } finally { await setChatPopoverView(page, initial.view); }
}

/** Search the observed bounded range during mutation, restoring an unmatched search. */
export async function selectChatPopoverEffort(page: PageLike, labels: string[]): Promise<string | undefined> {
  const initial = (await readChatPopover(page)).snapshot;
  if (initial === undefined) return undefined;
  let original: ChatPopoverSnapshot["slider"];
  let found = false;
  let mayRestore = true;
  const read = async (): Promise<ChatPopoverSnapshot | undefined> => (await readChatPopover(page)).snapshot;
  const move = async (target: number): Promise<ChatPopoverSnapshot | undefined> => {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const before = await read();
      if (original === undefined || before?.slider === undefined || before.slider.minimum !== original.minimum || before.slider.maximum !== original.maximum) { mayRestore = false; return undefined; }
      if (before.slider.current === target) return before;
      const candidates = observedRoot(page, before)?.locator?.('[data-testid="composer-model-picker-slider-simple-view"][data-active="true"] [role="slider"]');
      const locator = candidates?.nth?.(before.slider.index) ?? (before.slider.index === 0 ? candidates : undefined);
      if (locator?.press === undefined || locator.evaluate === undefined || await locator.count?.() !== 1) return undefined;
      const locatorState = await locator.evaluate(element => {
        let current: Node | null = element;
        let panel = false, owned = false;
        for (let depth = 0; current !== null && depth < 64; depth += 1) {
          if (current.nodeType !== 1) break;
          const node = current as HTMLElement;
          if (node.hidden || node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("data-active") === "false"
            || node.getAttribute("aria-disabled") === "true" || node.getAttribute("data-locked") === "true"
            || (current !== element && node.getAttribute("aria-hidden") === "true")) return undefined;
          const style = window.getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return undefined;
          if (node.getAttribute("data-testid") === "composer-model-picker-slider-simple-view" && node.getAttribute("data-active") === "true") panel = true;
          if (node.getAttribute("data-testid") === "composer-intelligence-picker-content") owned = true;
          current = current.parentNode;
        }
        const rect = element.getBoundingClientRect();
        if (!panel || !owned || rect.width <= 0 || rect.height <= 0 || element.getAttribute("role") !== "slider") return undefined;
        return { minimum: element.getAttribute("aria-valuemin"), maximum: element.getAttribute("aria-valuemax"), current: element.getAttribute("aria-valuenow") };
      }).catch(() => undefined);
      if (locatorState === undefined || locatorState.minimum !== String(before.slider.minimum)
        || locatorState.maximum !== String(before.slider.maximum) || locatorState.current !== String(before.slider.current)) return undefined;
      const delta = target > before.slider.current ? 1 : -1;
      mayRestore = false;
      await locator.press(delta > 0 ? "ArrowRight" : "ArrowLeft");
      await waitForPopoverTransition(page, 100);
      const after = await read();
      if (after?.slider === undefined || after.slider.minimum !== original.minimum || after.slider.maximum !== original.maximum || after.slider.current !== before.slider.current + delta) return undefined;
      mayRestore = true;
    }
    return undefined;
  };
  try {
    const simple = await setChatPopoverView(page, "simple");
    original = simple?.slider;
    if (original === undefined || simple?.effort === undefined) return undefined;
    const matches = (snapshot: ChatPopoverSnapshot | undefined): string | undefined => snapshot?.effort !== undefined
      && labels.some(label => normalizeForLabelMatch(label) === normalizeForLabelMatch(snapshot.effort!)) ? snapshot.effort : undefined;
    const noop = matches(simple);
    if (noop !== undefined) { found = true; return noop; }
    for (let value = original.minimum; value <= original.maximum; value += 1) {
      const observed = await move(value);
      if (observed === undefined || observed.effort === undefined) return undefined;
      const matched = matches(observed);
      if (matched !== undefined) { found = true; return matched; }
    }
    return undefined;
  } finally {
    if (!found && original !== undefined && mayRestore) await move(original.current);
    await setChatPopoverView(page, initial.view);
  }
}

/** The optional Work fast-mode checkbox is independent of model and effort. */
export async function selectChatPopoverSpeed(page: PageLike, labels: string[]): Promise<string | undefined> {
  const initial = (await readChatPopover(page)).snapshot;
  if (initial === undefined) return undefined;
  try {
    const simple = await setChatPopoverView(page, "simple");
    if (simple?.speed === undefined || simple.speedIndex === undefined) return undefined;
    const desired = (["Standard", "Fast"] as const).filter(value => labels.some(label => normalizeForLabelMatch(label) === normalizeForLabelMatch(value)));
    if (desired.length !== 1) return undefined;
    if (simple.speed === desired[0]) return simple.speed;
    const candidates = observedRoot(page, simple)?.locator?.('[role="menuitemcheckbox"][data-fast-mode-enabled]');
    const locator = candidates?.nth?.(simple.speedIndex) ?? (simple.speedIndex === 0 ? candidates : undefined);
    if (locator?.click === undefined || locator.evaluate === undefined || await locator.count?.() !== 1) return undefined;
    const state = await locator.evaluate(element => {
      let current: Node | null = element;
      let owned = false, simple = false, open = false;
      for (let depth = 0; current !== null && depth < 64; depth += 1) {
        if (current.nodeType !== 1) break;
        const node = current as HTMLElement;
        if (node.hidden || node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true"
          || node.getAttribute("aria-disabled") === "true" || node.getAttribute("data-active") === "false" || node.getAttribute("data-locked") === "true") return undefined;
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return undefined;
        if (node.getAttribute("role") === "menu" && node.getAttribute("data-state") === "open") open = true;
        if (node.getAttribute("data-testid") === "composer-intelligence-picker-content") owned = true;
        if (node.getAttribute("data-view") === "simple" && node.getAttribute("data-model-selection-view") === "true") simple = true;
        current = current.parentNode;
      }
      const rect = element.getBoundingClientRect();
      if (current?.nodeType === 1 || !owned || !simple || !open || rect.width <= 0 || rect.height <= 0
        || element.getAttribute("role") !== "menuitemcheckbox" || element.getAttribute("data-visible") !== "true") return undefined;
      const checked = element.getAttribute("aria-checked");
      return element.getAttribute("data-fast-mode-enabled") === checked ? checked : undefined;
    }).catch(() => undefined);
    if (state !== String(simple.speed === "Fast")) return undefined;
    await locator.click();
    await waitForPopoverTransition(page, 150);
    const after = (await readChatPopover(page)).snapshot;
    return after !== undefined && after.speed === desired[0] ? after.speed : undefined;
  } finally { await setChatPopoverView(page, initial.view); }
}
