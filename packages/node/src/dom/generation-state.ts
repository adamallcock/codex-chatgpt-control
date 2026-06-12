import type { PageLike } from "../types.js";
import { copyResponseButtons } from "./selectors.js";
import { localeLabels } from "./locale-labels.js";

export type AssistantGenerationState = {
  active: boolean;
  stopped: boolean;
  signals: string[];
};

/**
 * Neutral fallback used when generation state cannot be inspected.
 *
 * This means "no active/stopped signal observed"; it is not evidence that a
 * response is complete.
 */
export const EMPTY_GENERATION_STATE: AssistantGenerationState = {
  active: false,
  stopped: false,
  signals: []
};

export async function readAssistantGenerationState(page: PageLike): Promise<AssistantGenerationState> {
  if (typeof page.evaluate === "function") {
    return page.evaluate((args: { stop: string[]; stopped: string[] }) => {
      const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
      const isVisible = (element: HTMLElement) => {
        const style = window.getComputedStyle(element);
        return style.display !== "none"
          && style.visibility !== "hidden"
          && style.opacity !== "0"
          && element.getAttribute("aria-hidden") !== "true";
      };
      const visibleButtons = Array.from(document.querySelectorAll("button"))
        .filter((button): button is HTMLButtonElement => isVisible(button as HTMLElement)
          && button.disabled !== true
          && button.getAttribute("aria-disabled") !== "true");
      const buttonTexts = visibleButtons
        .map(button => [
          button.innerText,
          button.textContent,
          button.getAttribute("aria-label"),
          button.getAttribute("title")
        ].map(normalize).filter(Boolean).join(" "))
        .filter(Boolean);
      const bodyText = normalize(document.body?.innerText);
      const haystacks = [bodyText, ...buttonTexts];
      const matchingSignals = (phrases: string[]) => haystacks.flatMap(text =>
        phrases
          .map(phrase => phrase.toLowerCase())
          .filter(phrase => text.includes(phrase))
      );
      const activeSignals = matchingSignals(args.stop);
      const stoppedSignals = matchingSignals(args.stopped);
      return {
        active: activeSignals.length > 0,
        stopped: stoppedSignals.length > 0,
        signals: [...new Set([...activeSignals, ...stoppedSignals, ...buttonTexts.filter(text => /stop|cancel|stopped|answering|thinking/i.test(text))])].slice(0, 5)
      };
    }, {
      stop: [...localeLabels.stopControl],
      stopped: [...localeLabels.stoppedAssistant]
    }).catch(() => EMPTY_GENERATION_STATE);
  }

  if (typeof page.content === "function") {
    const html = await page.content().catch(() => "");
    return generationStateFromText(html);
  }

  return EMPTY_GENERATION_STATE;
}

export async function latestAssistantTurnHasResponseActions(page: PageLike): Promise<boolean> {
  if (typeof page.evaluate === "function") {
    const scoped = await page.evaluate((phrases: string[]) => {
      const turns = Array.from(document.querySelectorAll("[data-testid^='conversation-turn']"));
      if (turns.length === 0) return undefined;
      const latestTurn = turns.reverse().find(turn =>
        turn.querySelector("[data-message-author-role='assistant']") !== null
      ) as HTMLElement | undefined;
      if (latestTurn === undefined) return false;
      const actionText = Array.from(latestTurn.querySelectorAll("button"))
        .map(button => [
          button.innerText,
          button.textContent,
          button.getAttribute("aria-label"),
          button.getAttribute("title")
        ].filter(Boolean).join(" "))
        .join(" ")
        .toLowerCase();
      return phrases.some(phrase => actionText.includes(phrase.toLowerCase()));
    }, [...localeLabels.responseActions]).catch(() => undefined);
    if (scoped !== undefined) {
      return scoped;
    }
  }

  try {
    const copyButtons = copyResponseButtons(page);
    const count = await copyButtons.count?.();
    if (count !== undefined) {
      return count > 0;
    }
    return await copyButtons.isVisible?.() === true;
  } catch {
    if (typeof page.content === "function") {
      const html = await page.content().catch(() => "");
      return localeLabels.responseActions.some(phrase => html.toLowerCase().includes(phrase.toLowerCase()));
    }
    return true;
  }
}

function generationStateFromText(text: string): AssistantGenerationState {
  const normalized = text.toLowerCase();
  const activeSignals = localeLabels.stopControl.filter(phrase => normalized.includes(phrase.toLowerCase()));
  const stoppedSignals = localeLabels.stoppedAssistant.filter(phrase => normalized.includes(phrase.toLowerCase()));
  return {
    active: activeSignals.length > 0,
    stopped: stoppedSignals.length > 0,
    signals: [...activeSignals, ...stoppedSignals].slice(0, 5)
  };
}
