import type { PageLike } from "../types.js";
import { localeLabels } from "./locale-labels.js";
import { isTransientAssistantText } from "./messages.js";
import { normalizeWhitespace } from "./visible-text.js";

/**
 * One-evaluate DOM snapshot for the messages.wait polling loop.
 *
 * The previous loop ran four separate DOM probes per poll and transferred the entire
 * latest assistant text across the browser bridge every iteration, even though the loop
 * only needs change detection until completion. This snapshot returns fixed-size text
 * metadata (normalized length + hash + transient flag) plus generation state and
 * response-action evidence in a single round trip, sampled atomically from the same DOM
 * instant. The full text is fetched once, at loop exit, by the caller.
 */
export type WaitDomSnapshot = {
  turnCount: number;
  assistantTurnCount: number;
  latestAssistantTurnIndex?: number;
  text: WaitTextMetadata;
  generation: {
    active: boolean;
    stopped: boolean;
    signals: string[];
  };
  /** undefined means no conversation-turn markers were found; callers fall back to the copy-button locator. */
  hasResponseActions?: boolean;
};

export type WaitTextMetadata = {
  /** Length of the whitespace-normalized latest assistant text. */
  length: number;
  /** FNV-1a 32-bit hash (hex) of the whitespace-normalized latest assistant text. */
  hash: string;
  /** Whether the text is a transient placeholder such as "Thinking". */
  transient: boolean;
};

/**
 * SDK-side twin of the in-page metadata computation. The transient check delegates to
 * dom/messages.ts isTransientAssistantText — the ground truth used by isResponseComplete —
 * so only the in-page copy below is a true duplicate. The evaluate callback inlines the
 * same normalization, hash, and transient rules because serialized callbacks cannot close
 * over imports; `wait-snapshot.test.ts` pins the in-page copy to this helper (and thereby,
 * transitively, to the ground truth).
 */
export function waitTextMetadata(rawText: string | undefined): WaitTextMetadata {
  const normalized = normalizeWhitespace(rawText ?? "");
  return {
    length: normalized.length,
    hash: fnv1a32Hex(normalized),
    transient: isTransientAssistantText(normalized)
  };
}

export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function readWaitDomSnapshot(page: PageLike): Promise<WaitDomSnapshot | undefined> {
  if (typeof page.evaluate !== "function") {
    return undefined;
  }

  return page.evaluate((args: { transient: string[]; stop: string[]; stopped: string[]; actions: string[] }) => {
    const __combinedWaitSnapshot = true;
    void __combinedWaitSnapshot;
    const normalizeWs = (value: string) => value.replace(/\s+/g, " ").trim();
    const normalizeLower = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

    // --- Progress: turn counts and latest assistant text metadata (no text transfer) ---
    const nodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
    const assistantNodes = nodes.filter(node => node.getAttribute("data-message-author-role") === "assistant");
    const latestAssistant = assistantNodes.at(-1) as HTMLElement | undefined;
    const latestAssistantTurnIndex = latestAssistant === undefined ? undefined : nodes.indexOf(latestAssistant) + 1;
    const normalizedText = normalizeWs(latestAssistant?.innerText ?? latestAssistant?.textContent ?? "");

    let hash = 0x811c9dc5;
    for (let index = 0; index < normalizedText.length; index += 1) {
      hash ^= normalizedText.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    const textHash = (hash >>> 0).toString(16).padStart(8, "0");

    const trimmedForTransient = normalizedText.replace(/[.。…]+$/g, "").trim().toLowerCase();
    const transient = args.transient.some(phrase => trimmedForTransient === phrase.toLowerCase())
      || /^analyzing (?:the )?images?$/.test(trimmedForTransient)
      || /^processing (?:the )?images?$/.test(trimmedForTransient)
      || /^reading (?:the )?images?$/.test(trimmedForTransient);

    // --- Generation state: mirrors dom/generation-state.ts readAssistantGenerationState ---
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0"
        && element.getAttribute("aria-hidden") !== "true";
    };
    const visibleButtons = Array.from(document.querySelectorAll("button"))
      .filter((button): button is HTMLButtonElement => isVisible(button as HTMLElement)
        && (button as HTMLButtonElement).disabled !== true
        && button.getAttribute("aria-disabled") !== "true");
    const buttonTexts = visibleButtons
      .map(button => [
        button.innerText,
        button.textContent,
        button.getAttribute("aria-label"),
        button.getAttribute("title")
      ].map(normalizeLower).filter(Boolean).join(" "))
      .filter(Boolean);
    const bodyText = normalizeLower(document.body?.innerText);
    const haystacks = [bodyText, ...buttonTexts];
    const matchingSignals = (phrases: string[]) => haystacks.flatMap(text =>
      phrases
        .map(phrase => phrase.toLowerCase())
        .filter(phrase => text.includes(phrase))
    );
    const activeSignals = matchingSignals(args.stop);
    const stoppedSignals = matchingSignals(args.stopped);
    const generation = {
      active: activeSignals.length > 0,
      stopped: stoppedSignals.length > 0,
      signals: [...new Set([...activeSignals, ...stoppedSignals, ...buttonTexts.filter(text => /stop|cancel|stopped|answering|thinking/i.test(text))])].slice(0, 5)
    };

    // --- Response actions: mirrors dom/generation-state.ts latestAssistantTurnHasResponseActions ---
    const turns = Array.from(document.querySelectorAll("[data-testid^='conversation-turn']"));
    let hasResponseActions: boolean | undefined;
    if (turns.length === 0) {
      hasResponseActions = undefined;
    } else {
      const latestTurn = [...turns].reverse().find(turn =>
        turn.querySelector("[data-message-author-role='assistant']") !== null
      ) as HTMLElement | undefined;
      if (latestTurn === undefined) {
        hasResponseActions = false;
      } else {
        const actionText = Array.from(latestTurn.querySelectorAll("button"))
          .map(button => [
            button.innerText,
            button.textContent,
            button.getAttribute("aria-label"),
            button.getAttribute("title")
          ].filter(Boolean).join(" "))
          .join(" ")
          .toLowerCase();
        hasResponseActions = args.actions.some(phrase => actionText.includes(phrase.toLowerCase()));
      }
    }

    const snapshot: {
      turnCount: number;
      assistantTurnCount: number;
      latestAssistantTurnIndex?: number;
      text: { length: number; hash: string; transient: boolean };
      generation: { active: boolean; stopped: boolean; signals: string[] };
      hasResponseActions?: boolean;
    } = {
      turnCount: nodes.length,
      assistantTurnCount: assistantNodes.length,
      text: { length: normalizedText.length, hash: textHash, transient },
      generation
    };
    if (latestAssistantTurnIndex !== undefined) snapshot.latestAssistantTurnIndex = latestAssistantTurnIndex;
    if (hasResponseActions !== undefined) snapshot.hasResponseActions = hasResponseActions;
    return snapshot;
  }, {
    transient: [...localeLabels.transientAssistant],
    stop: [...localeLabels.stopControl],
    stopped: [...localeLabels.stoppedAssistant],
    actions: [...localeLabels.responseActions]
  });
}
