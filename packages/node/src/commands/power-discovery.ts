import { normalizeForLabelMatch } from "../dom/label-match.js";
import type { LocatorLike, PageLike } from "../types.js";

/**
 * The upper bound is deliberately conservative.  A Power selector is expected
 * to expose a small, discrete set of reasoning levels; accepting an enormous
 * range would turn an unverified selector into a long mutation loop and would
 * make an aria typo surprisingly expensive.
 */
export const MAX_POWER_LEVELS = 32;
export const MAX_POWER_SLIDERS = 32;
/** Maximum browser-realm nodes inspected by one Power discovery probe. */
export const MAX_POWER_DOM_NODES = 4096;
const MAX_POWER_LABELS = 64;
const MAX_POWER_LABEL_LENGTH = 240;
const MAX_POWER_TEXT_CHARS = 32 * 1024;

export type PowerSurface = "chat" | "work" | "unknown";

export type PowerOptionEvidence = {
  label: string;
  value?: number;
};

export type PowerSliderRange = {
  minimum: number;
  maximum: number;
  current: number;
  count: number;
};

export type PowerSliderEvidence = {
  role: "slider";
  sliderIndex: number;
  relationship: "aria-label" | "aria-labelledby" | "owner" | "menu-label";
  matchedPowerLabels: string[];
  surface: PowerSurface;
  selectorProfile: string;
  menuRole: string;
  ownerRole?: string;
  valueText?: string;
  options: PowerOptionEvidence[];
  range: PowerSliderRange;
};

export type PowerDiscoveryFailureReason =
  | "no_visible_slider"
  | "no_semantic_power_slider"
  | "ambiguous_power_slider"
  | "missing_menu_relationship"
  | "invalid_aria_range"
  | "unsupported_range"
  | "observation_limit_exceeded"
  | "surface_mismatch";

export type PowerDiscoveryFailureEvidence = {
  visibleSliderCount: number;
  semanticSliderCount: number;
  invalidSemanticSliderCount: number;
  hiddenSliderCount: number;
  observedProfiles: string[];
  observationTruncated: boolean;
};

export type PowerDiscoveryResult =
  | {
      ok: true;
      evidence: PowerSliderEvidence;
      sliderIndex: number;
      range: PowerSliderRange;
      options: PowerOptionEvidence[];
      /** The non-English/visible label reported by the slider, if available. */
      valueText?: string;
    }
  | {
      ok: false;
      reason: PowerDiscoveryFailureReason;
      evidence: PowerDiscoveryFailureEvidence;
    };

/**
 * A serializable DOM observation used by the pure classifier below. Keeping
 * the classifier independent from a browser implementation makes ambiguity and
 * range rejection deterministic in unit tests, and prevents a later caller
 * from accidentally turning inspection into a mutation.
 */
export type PowerSliderDomObservation = {
  index: number;
  visible: boolean;
  ariaLabel?: string;
  labelledByText?: string;
  valueText?: string;
  minimum?: string;
  maximum?: string;
  current?: string;
  step?: string;
  owner?: {
    role?: string;
    label?: string;
    text?: string;
    visible: boolean;
  };
  menu?: {
    role: string;
    label?: string;
    text?: string;
    visible: boolean;
  };
  surface?: {
    experience?: PowerSurface;
    selectorProfile?: string;
  };
  options?: Array<{
    label: string;
    value?: string;
    visible: boolean;
  }>;
  optionSource?: "datalist" | "owner" | "power_menu";
  optionsTruncated?: boolean;
};

export type PowerDomObservation = {
  sliders: PowerSliderDomObservation[];
  slidersTruncated?: boolean;
};

export type PowerDiscoveryOptions = {
  powerLabels?: readonly string[];
  expectedSurface?: PowerSurface;
};

// There is deliberately no English fallback. Callers must provide the locale
// pack observed for the current surface; otherwise an accidental English
// match could select a control in a localized session.
const DEFAULT_POWER_LABELS: readonly string[] = [];

/**
 * Inspect the visible DOM once. This function is intentionally read-only: it
 * never focuses, presses, clicks, hovers, waits, or writes to the page.
 */
export async function discoverPowerSlider(
  page: PageLike,
  options: PowerDiscoveryOptions = {}
): Promise<PowerDiscoveryResult> {
  if (typeof page.evaluate !== "function") {
    return classifyPowerSliderObservation({ sliders: [] }, options);
  }

  const observation = await page.evaluate((config: {
    powerLabels: string[];
    maxSliders: number;
    maxOptions: number;
    maxNodes: number;
    maxTextChars: number;
  }) => {
    // This callback is serialized into the browser realm. Keep the probe
    // independent from module scope and use one SHOW_ALL traversal: text and
    // comment nodes consume the same global budget as elements. In
    // particular, do not replace this with a selector query or a DOM text
    // property; either would materialize arbitrary page-sized data before the
    // Power-specific caps can take effect.
    const maxLabelLength = 240;
    const maxLabelInput = maxLabelLength * 4;
    const elements: Element[] = [];
    const sliderElements: Element[] = [];
    const textByElement = new Map<Element, string>();
    let visitedNodes = 0;
    let textChars = 0;
    let textTruncated = false;
    const normalize = (value: string): string => {
      const limit = Math.min(value.length, maxLabelInput);
      let normalized = "";
      let pendingSpace = false;
      for (let index = 0; index < limit && normalized.length < maxLabelLength; index += 1) {
        const character = value[index]!;
        if (/\s/u.test(character)) {
          if (normalized.length > 0) pendingSpace = true;
          continue;
        }
        if (pendingSpace && normalized.length < maxLabelLength) normalized += " ";
        pendingSpace = false;
        normalized += character;
      }
      if (value.length > limit) textTruncated = true;
      return normalized.trim().slice(0, maxLabelLength);
    };

    const appendText = (node: Node): void => {
      if (node.nodeType !== 3) return;
      const raw = typeof node.nodeValue === "string" ? node.nodeValue : "";
      if (raw.length === 0) return;
      const remaining = config.maxTextChars - textChars;
      if (remaining <= 0) {
        textTruncated = true;
        return;
      }
      const piece = raw.slice(0, Math.min(raw.length, remaining));
      textChars += piece.length;
      if (piece.length < raw.length) textTruncated = true;
      let parent: Node | null = node.parentNode;
      let depth = 0;
      while (parent !== null && depth < 64) {
        if (parent.nodeType === 1) {
          const element = parent as Element;
          const previous = textByElement.get(element) ?? "";
          if (previous.length < maxLabelLength) {
            textByElement.set(element, `${previous}${piece.slice(0, maxLabelLength - previous.length)}`);
          }
        }
        parent = parent.parentNode;
        depth += 1;
      }
    };

    const visit = (node: Node): void => {
      visitedNodes += 1;
      if (visitedNodes > config.maxNodes) throw new Error("node limit exceeded");
      appendText(node);
      if (node.nodeType === 1) {
        const element = node as Element;
        elements.push(element);
        if (element.getAttribute("role") === "slider") {
          if (sliderElements.length >= config.maxSliders) throw new Error("slider limit exceeded");
          sliderElements.push(element);
        }
      }
    };

    const ownerDocument = document;
    try {
      if (typeof ownerDocument.createTreeWalker === "function") {
        const walker = ownerDocument.createTreeWalker(ownerDocument, 0xffffffff);
        let current = walker.nextNode();
        while (current !== null) {
          visit(current);
          current = walker.nextNode();
        }
      } else {
        // The manual path keeps deterministic behavior in minimal browser
        // adapters and tests which expose the DOM node links but no TreeWalker.
        let current: Node | null = ownerDocument.firstChild;
        while (current !== null) {
          visit(current);
          if (current.firstChild !== null) {
            current = current.firstChild;
            continue;
          }
          while (current !== null && current !== ownerDocument && current.nextSibling === null) {
            current = current.parentNode;
          }
          if (current === ownerDocument || current === null) break;
          current = current.nextSibling;
        }
      }
    } catch (error) {
      if (error instanceof Error
        && (error.message === "node limit exceeded" || error.message === "slider limit exceeded")) {
        return { sliders: [], slidersTruncated: true } satisfies PowerDomObservation;
      }
      throw error;
    }

    const idIndex = new Map<string, Element>();
    for (const element of elements) {
      const id = element.getAttribute("id");
      if (id !== null && id.length > 0 && !idIndex.has(id)) idIndex.set(id, element);
    }

    const textOf = (element: Element | null | undefined): string => {
      if (element === null || element === undefined) return "";
      const label = element.getAttribute("aria-label");
      if (label !== null) return normalize(label);
      return normalize(textByElement.get(element) ?? "");
    };
    const visibleTextOf = (element: Element | null | undefined): string => {
      if (element === null || element === undefined) return "";
      return normalize(textByElement.get(element) ?? "");
    };
    const matchesPowerLabel = (value: string): boolean => {
      const normalized = normalize(value).toLocaleLowerCase();
      return config.powerLabels.some(label => {
        const wanted = normalize(label).toLocaleLowerCase();
        if (wanted.length === 0) return false;
        return normalized === wanted
          || normalized.startsWith(`${wanted} `)
          || normalized.endsWith(` ${wanted}`)
          || normalized.includes(` ${wanted} `);
      });
    };
    const isVisible = (element: Element, allowSliderAriaHidden = false): boolean => {
      let current: Node | null = element;
      let depth = 0;
      while (current !== null && depth < 64) {
        if (current.nodeType !== 1) break;
        const currentElement = current as Element;
        const html = currentElement as HTMLElement;
        if (html.hidden || currentElement.hasAttribute("hidden")
          || (currentElement.getAttribute("aria-hidden") === "true" && !(current === element && allowSliderAriaHidden))
          || currentElement.getAttribute("data-active") === "false"
          || currentElement.hasAttribute("inert")) return false;
        const style = typeof window !== "undefined"
          ? window.getComputedStyle?.(html)
          : undefined;
        if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0" || style?.pointerEvents === "none") {
          return false;
        }
        current = current.parentNode;
        depth += 1;
      }
      if (current !== null && current.nodeType === 1) return false;
      const rect = (element as HTMLElement).getBoundingClientRect?.();
      return rect === undefined || (rect.width > 0 && rect.height > 0);
    };
    const labelledByText = (element: Element): string => {
      const ids = (element.getAttribute("aria-labelledby") ?? "")
        .slice(0, 512)
        .split(/\s+/)
        .map(id => id.trim())
        .filter(Boolean);
      return normalize(ids
        .map(id => textOf(idIndex.get(id)))
        .filter(Boolean)
        .join(" "))
        .slice(0, 240);
    };
    const directSurfaceHint = (element: Element): { experience?: PowerSurface; selectorProfile?: string } => {
      const values: string[] = [];
      let current: Node | null = element;
      let depth = 0;
      while (current !== null && depth < 8) {
        if (current.nodeType !== 1) break;
        const currentElement = current as Element;
        for (const attribute of ["data-surface", "data-experience", "data-testid", "id", "class"]) {
          const value = currentElement.getAttribute(attribute);
          if (value !== null) values.push(value.slice(0, 240));
        }
        current = current.parentNode;
        depth += 1;
      }
      const joined = values.join(" ").toLocaleLowerCase();
      const hasWork = /(?:^|[-_\s])work(?:$|[-_\s])/.test(joined);
      const hasChat = /(?:^|[-_\s])chat(?:$|[-_\s])/.test(joined);
      const experience: PowerSurface | undefined = hasWork === hasChat
        ? undefined
        : hasWork ? "work" : "chat";
      const selectorProfile = /advanced/.test(joined)
        ? experience === "work" ? "work_advanced_v1" : "unknown"
        : experience === "work" ? "work_basic_v1"
          : experience === "chat" ? "chat_simplified_v1" : undefined;
      return experience === undefined && selectorProfile === undefined
        ? {}
        : {
            ...(experience === undefined ? {} : { experience }),
            ...(selectorProfile === undefined ? {} : { selectorProfile })
          };
    };
    const isWithin = (element: Element, root: Element): boolean => {
      let current: Node | null = element;
      let depth = 0;
      while (current !== null && depth < 64) {
        if (current === root) return true;
        current = current.parentNode;
        depth += 1;
      }
      return false;
    };
    const hasDatalistAncestor = (element: Element): boolean => {
      let current: Node | null = element;
      let depth = 0;
      while (current !== null && depth < 64) {
        if (current.nodeType === 1 && (current as Element).tagName?.toLocaleLowerCase() === "datalist") return true;
        current = current.parentNode;
        depth += 1;
      }
      return false;
    };
    const readOptions = (root: Element | null): {
      options: Array<{ label: string; value?: string; visible: boolean }>;
      truncated: boolean;
    } => {
      if (root === null) return { options: [], truncated: false };
      const mapped: Array<{ label: string; value?: string; visible: boolean }> = [];
      let matched = 0;
      let truncated = false;
      const rootIsDatalist = root.tagName?.toLocaleLowerCase() === "datalist";
      for (const node of elements) {
        if (node === root || !isWithin(node, root)) continue;
        const role = node.getAttribute("role");
        const tagName = node.tagName?.toLocaleLowerCase();
        const isOption = role === "option"
          || role === "menuitemradio"
          || role === "radio"
          || node.getAttribute("data-power-value") !== null
          || (tagName === "option" && (rootIsDatalist || hasDatalistAncestor(node)));
        if (!isOption) continue;
        matched += 1;
        if (matched > config.maxOptions) {
          truncated = true;
          break;
        }
        const value = node.getAttribute("aria-valuenow")
          ?? node.getAttribute("data-power-value")
          ?? node.getAttribute("data-value")
          ?? node.getAttribute("value")
          ?? undefined;
        const logicalDatalistOption = rootIsDatalist || hasDatalistAncestor(node);
        mapped.push({
          label: textOf(node),
          ...(value === undefined ? {} : { value }),
          // Datalist options are intentionally not rendered, but they are the
          // semantic value map for the associated slider. Treating their
          // hidden presentation as a missing map would force an unnecessary
          // probe while still keeping ordinary hidden controls fail-closed.
          visible: logicalDatalistOption || isVisible(node)
        });
      }
      return {
        options: mapped.filter(option => option.label.length > 0),
        truncated
      };
    };
    const nearestOwner = (slider: Element): Element | null => {
      let current: Node | null = slider.parentNode;
      let depth = 0;
      while (current !== null && depth < 8) {
        if (current.nodeType !== 1) break;
        const element = current as Element;
        const role = element.getAttribute("role");
        if (role === "menuitem"
          || role === "menuitemradio"
          || role === "option"
          || role === "radio"
          || role === "group"
          || role === "row") return element;
        current = current.parentNode;
        depth += 1;
      }
      return null;
    };
    const nearestMenu = (slider: Element): Element | null => {
      let current: Node | null = slider.parentNode;
      let depth = 0;
      while (current !== null && depth < 16) {
        if (current.nodeType !== 1) break;
        const element = current as Element;
        const role = element.getAttribute("role");
        if (role === "menu"
          || role === "listbox"
          || element.getAttribute("data-radix-popper-content-wrapper") !== null
          || element.getAttribute("data-radix-menu-content") !== null) return element;
        current = current.parentNode;
        depth += 1;
      }
      return null;
    };
    const ownedChatSlider = (slider: Element, owner: Element | null, menu: Element | null): boolean => {
      if (owner === null || menu === null || menu.getAttribute("data-state") !== "open" || !isVisible(menu)
        || !isVisible(owner) || !matchesPowerLabel(owner.getAttribute("aria-label") ?? "")) return false;
      let current: Node | null = slider;
      let sliderOwner = false, activePanel = false, activeView = false, composerRoot = false;
      for (let depth = 0; current !== null && current !== menu && depth < 32; depth += 1) {
        if (current.nodeType !== 1) return false;
        const node = current as Element;
        if (node.getAttribute("aria-disabled") === "true" || node.getAttribute("data-locked") === "true") return false;
        if (node.hasAttribute("data-model-reasoning-effort-slider")) sliderOwner = true;
        if (node.getAttribute("data-testid") === "composer-model-picker-slider-simple-view"
          && node.getAttribute("data-active") === "true" && isVisible(node)) activePanel = true;
        if (node.getAttribute("data-view") === "simple" && node.getAttribute("data-has-slider") === "true"
          && node.getAttribute("data-model-selection-view") === "true" && node.getAttribute("data-has-advanced-view") === "true") activeView = true;
        if (node.getAttribute("data-testid") === "composer-intelligence-picker-content") composerRoot = true;
        current = current.parentNode;
      }
      const rect = (slider as HTMLElement).getBoundingClientRect?.();
      return current === menu && sliderOwner && activePanel && activeView && composerRoot
        && rect !== undefined && rect.width > 0 && rect.height > 0;
    };
    const sliders = sliderElements.map((slider, index): PowerSliderDomObservation => {
        const owner = nearestOwner(slider);
        const menu = nearestMenu(slider);
        const renderedChatSlider = ownedChatSlider(slider, owner, menu);
        let currentValueText = normalize(slider.getAttribute("aria-valuetext") ?? "");
        if (renderedChatSlider && currentValueText.length === 0) {
          const ids = (owner?.getAttribute("aria-describedby") ?? "").slice(0, 512).split(/\s+/).slice(0, 8);
          for (const id of ids) {
            const description = visibleTextOf(idIndex.get(id));
            const ordinal = /^(.+?),\s*(\d+)\s+of\s+(\d+)\./u.exec(description);
            if (ordinal !== null
              && Number(ordinal[2]) === Number(slider.getAttribute("aria-valuenow")) - Number(slider.getAttribute("aria-valuemin")) + 1
              && Number(ordinal[3]) === Number(slider.getAttribute("aria-valuemax")) - Number(slider.getAttribute("aria-valuemin")) + 1) currentValueText = ordinal[1]!;
          }
        }
        const listId = slider.getAttribute("list");
        const datalist = listId === null ? null : idIndex.get(listId) ?? null;
        // A whole menu is not an option map: it can contain model, speed, and
        // effort rows alongside Power. Only use it when the menu itself is
        // explicitly labelled as the Power axis; otherwise require an owning
        // semantic group (or an associated datalist).
        const menuLabel = menu?.getAttribute("aria-label") ?? "";
        const powerMenu = menu !== null && matchesPowerLabel(menuLabel) ? menu : null;
        const optionRoot = datalist ?? owner ?? powerMenu;
        const optionSource = datalist !== null
          ? "datalist" as const
          : owner !== null
            ? "owner" as const
            : powerMenu !== null ? "power_menu" as const : undefined;
        const { options, truncated: optionsTruncated } = readOptions(optionRoot);
        return {
          index,
          visible: isVisible(slider, renderedChatSlider),
          ...(textOf(slider).length === 0 ? {} : { ariaLabel: textOf(slider) }),
          ...(labelledByText(slider).length === 0 ? {} : { labelledByText: labelledByText(slider) }),
          ...(currentValueText.length === 0 ? {} : { valueText: currentValueText }),
          ...(slider.getAttribute("aria-valuemin") === null
            ? {}
            : { minimum: slider.getAttribute("aria-valuemin")! }),
          ...(slider.getAttribute("aria-valuemax") === null
            ? {}
            : { maximum: slider.getAttribute("aria-valuemax")! }),
          ...(slider.getAttribute("aria-valuenow") === null
            ? {}
            : { current: slider.getAttribute("aria-valuenow")! }),
          ...(slider.getAttribute("aria-valuestep") === null
            ? {}
            : { step: slider.getAttribute("aria-valuestep")! }),
          ...(owner === null ? {} : {
            owner: {
              ...(owner.getAttribute("role") === null ? {} : { role: owner.getAttribute("role")! }),
              ...(owner.getAttribute("aria-label") === null ? {} : { label: owner.getAttribute("aria-label")! }),
              text: visibleTextOf(owner),
              visible: isVisible(owner)
            }
          }),
          ...(menu === null ? {} : {
            menu: {
              role: menu.getAttribute("role") ?? "overlay",
              ...(menu.getAttribute("aria-label") === null ? {} : { label: menu.getAttribute("aria-label")! }),
              text: visibleTextOf(menu),
              visible: isVisible(menu)
            }
          }),
          surface: renderedChatSlider ? { experience: "chat", selectorProfile: "chat_simplified_v1" } : directSurfaceHint(slider),
          ...(options.length === 0 ? {} : { options }),
          ...(optionSource === undefined ? {} : { optionSource }),
          ...(optionsTruncated ? { optionsTruncated: true } : {})
        };
      });
    if (textTruncated) {
      return { sliders: [], slidersTruncated: true } satisfies PowerDomObservation;
    }
    return { sliders } satisfies PowerDomObservation;
  }, {
    powerLabels: [...(options.powerLabels ?? DEFAULT_POWER_LABELS)].slice(0, MAX_POWER_LABELS + 1),
    maxSliders: MAX_POWER_SLIDERS,
    maxOptions: MAX_POWER_LEVELS,
    maxNodes: MAX_POWER_DOM_NODES,
    maxTextChars: MAX_POWER_TEXT_CHARS
  }).catch(() => ({ sliders: [] }));

  return classifyPowerSliderObservation(observation, options);
}

/**
 * Classify one bounded, read-only DOM observation.  No state is retained; each
 * call starts from the supplied snapshot and therefore cannot leak a previous
 * operation's discovered range or value mapping.
 */
export function classifyPowerSliderObservation(
  observation: PowerDomObservation,
  options: PowerDiscoveryOptions = {}
): PowerDiscoveryResult {
  const suppliedPowerLabels = [...(options.powerLabels ?? DEFAULT_POWER_LABELS)];
  const limitExceeded = observation.slidersTruncated === true
    || observation.sliders.length > MAX_POWER_SLIDERS
    || suppliedPowerLabels.length > MAX_POWER_LABELS
    || observation.sliders.some(slider => slider.optionsTruncated === true
      || (slider.options?.length ?? 0) > MAX_POWER_LEVELS);
  if (limitExceeded) {
    return {
      ok: false,
      reason: "observation_limit_exceeded",
      evidence: {
        visibleSliderCount: 0,
        semanticSliderCount: 0,
        invalidSemanticSliderCount: 0,
        hiddenSliderCount: 0,
        observedProfiles: [],
        observationTruncated: true
      }
    };
  }
  const powerLabels = suppliedPowerLabels.filter(label => label.trim().length > 0
    && label.length <= MAX_POWER_LABEL_LENGTH);
  const visible = observation.sliders.filter(slider => slider.visible);
  const semantic = visible.filter(slider => semanticRelationship(slider, powerLabels) !== undefined);
  const hiddenCount = observation.sliders.length - visible.length;
  const observedProfiles = [...new Set(visible
    .map(slider => slider.surface?.selectorProfile ?? slider.surface?.experience)
    .filter((value): value is string => value !== undefined))];
  const failureEvidence = (invalidSemanticSliderCount = 0): PowerDiscoveryFailureEvidence => ({
    visibleSliderCount: visible.length,
    semanticSliderCount: semantic.length,
    invalidSemanticSliderCount,
    hiddenSliderCount: hiddenCount,
    observedProfiles,
    observationTruncated: false
  });

  if (visible.length === 0) {
    return { ok: false, reason: "no_visible_slider", evidence: failureEvidence() };
  }
  if (semantic.length === 0) {
    return { ok: false, reason: "no_semantic_power_slider", evidence: failureEvidence() };
  }
  if (semantic.length > 1) {
    return { ok: false, reason: "ambiguous_power_slider", evidence: failureEvidence() };
  }

  const candidate = semantic[0]!;
  const relationship = semanticRelationship(candidate, powerLabels);
  if (relationship === undefined || candidate.menu?.visible !== true) {
    return { ok: false, reason: "missing_menu_relationship", evidence: failureEvidence() };
  }
  if (options.expectedSurface !== undefined
    && candidate.surface?.experience !== options.expectedSurface) {
    return { ok: false, reason: "surface_mismatch", evidence: failureEvidence() };
  }

  const minimum = parseInteger(candidate.minimum);
  const maximum = parseInteger(candidate.maximum);
  const current = parseInteger(candidate.current);
  const step = candidate.step === undefined ? 1 : parseInteger(candidate.step);
  if (minimum === undefined || maximum === undefined || current === undefined
    || step === undefined || step !== 1 || minimum >= maximum || current < minimum || current > maximum) {
    return {
      ok: false,
      reason: "invalid_aria_range",
      evidence: failureEvidence(1)
    };
  }
  const count = maximum - minimum + 1;
  if (count > MAX_POWER_LEVELS || count < 2) {
    return {
      ok: false,
      reason: "unsupported_range",
      evidence: failureEvidence()
    };
  }

  const optionsEvidence = optionEvidence(
    candidate.optionSource === undefined ? [] : candidate.options ?? [],
    minimum,
    maximum,
    count
  );
  const range: PowerSliderRange = { minimum, maximum, current, count };
  const evidence: PowerSliderEvidence = {
    role: "slider",
    sliderIndex: candidate.index,
    relationship,
    matchedPowerLabels: matchedPowerLabels(candidate, powerLabels),
    surface: candidate.surface?.experience ?? "unknown",
    selectorProfile: candidate.surface?.selectorProfile ?? "unknown",
    menuRole: candidate.menu.role,
    ...(candidate.owner?.role === undefined ? {} : { ownerRole: candidate.owner.role }),
    ...(candidate.valueText === undefined ? {} : { valueText: candidate.valueText }),
    options: optionsEvidence,
    range
  };
  return {
    ok: true,
    evidence,
    sliderIndex: candidate.index,
    range,
    options: optionsEvidence,
    ...(candidate.valueText === undefined ? {} : { valueText: candidate.valueText })
  };
}

/**
 * Resolve a visible requested label to a numeric value only when the DOM gave
 * us a complete semantic mapping.  A current aria-valuetext is enough to
 * recognize that no mutation is required; it is not enough to guess another
 * level.  This is the important boundary that keeps ordinary inspection and
 * unprobed slider ranges fail-closed.
 */
export function resolvePowerTarget(
  discovery: Extract<PowerDiscoveryResult, { ok: true }>,
  requestedLabels: readonly string[]
): number | undefined {
  if (requestedLabels.length > MAX_POWER_LABELS
    || requestedLabels.some(label => label.length > MAX_POWER_LABEL_LENGTH)) return undefined;
  const matches = discovery.options.filter(option => requestedLabels.some(label => labelsMatch(option.label, label)));
  const values = [...new Set(matches.map(option => option.value).filter((value): value is number => value !== undefined))];
  if (matches.length > 0 && matches.length === values.length && values.length === 1) {
    return values[0];
  }
  if (discovery.valueText !== undefined && requestedLabels.some(label => labelsMatch(discovery.valueText!, label))) {
    return discovery.range.current;
  }
  return undefined;
}

/** Return a locator for the observed slider without broadening the selector. */
export function observedPowerSlider(page: PageLike, discovery: Extract<PowerDiscoveryResult, { ok: true }>): LocatorLike | undefined {
  const all = page.locator?.("[role='slider']");
  if (all === undefined) return undefined;
  if (all.nth !== undefined) return all.nth(discovery.sliderIndex);
  return discovery.sliderIndex === 0 ? all : undefined;
}

function semanticRelationship(
  slider: PowerSliderDomObservation,
  powerLabels: readonly string[]
): PowerSliderEvidence["relationship"] | undefined {
  if (powerLabels.some(label => labelsMatch(slider.ariaLabel, label))) return "aria-label";
  if (powerLabels.some(label => labelsMatch(slider.labelledByText, label))) return "aria-labelledby";
  if (slider.owner?.visible === true
    && (powerLabels.some(label => labelsMatch(slider.owner?.label, label))
      || powerLabels.some(label => labelsMatch(slider.owner?.text, label)))) {
    return "owner";
  }
  if (slider.menu?.visible === true
    && powerLabels.some(label => labelsMatch(slider.menu?.label, label))) {
    return "menu-label";
  }
  return undefined;
}

function matchedPowerLabels(slider: PowerSliderDomObservation, powerLabels: readonly string[]): string[] {
  const texts = [slider.ariaLabel, slider.labelledByText, slider.owner?.label, slider.owner?.text, slider.menu?.label]
    .filter((text): text is string => text !== undefined);
  return powerLabels.filter(label => texts.some(text => labelsMatch(text, label)));
}

function optionEvidence(
  options: PowerSliderDomObservation["options"],
  minimum: number,
  maximum: number,
  count: number
): PowerOptionEvidence[] {
  const visible = (options ?? []).filter(option => option.visible
    && option.label.trim().length > 0
    && option.label.length <= MAX_POWER_LABEL_LENGTH);
  if (visible.length === 0) return [];
  const explicit = visible.map(option => {
    const value = parseInteger(option.value);
    return value === undefined
      ? { label: option.label }
      : { label: option.label, value };
  });
  const explicitValues = explicit.map(option => option.value);
  if (explicit.length === count
    && explicitValues.every((value): value is number => value !== undefined && value >= minimum && value <= maximum)
    && new Set(explicitValues).size === explicitValues.length) {
    return explicit;
  }
  // An ordered list without explicit values is safe only when it is complete
  // and belongs to the already identified Power owner. Its DOM order is the
  // semantic order exposed by the control, not a menu-position heuristic.
  if (visible.length === count && explicitValues.every(value => value === undefined)) {
    return visible.map((option, index) => ({ label: option.label, value: minimum + index }));
  }
  return [];
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 32 || !/^-?\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function labelsMatch(value: string | undefined, wanted: string): boolean {
  if (value === undefined
    || value.length > MAX_POWER_LABEL_LENGTH
    || wanted.length > MAX_POWER_LABEL_LENGTH
    || value.trim().length === 0
    || wanted.trim().length === 0) return false;
  const normalizedValue = normalizeForLabelMatch(value);
  const normalizedWanted = normalizeForLabelMatch(wanted);
  if (normalizedValue === normalizedWanted) return true;
  const separators = `[\\s:•·\\-–—/]`;
  return new RegExp(`(?:^|${separators})${escapeRegExp(normalizedWanted)}(?:$|${separators})`, "iu")
    .test(normalizedValue);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
