import { resultOk } from "../errors.js";
import type { CommandResult, PageLike, RuntimeEnv, TemporaryChatData, TemporaryChatEvidence } from "../types.js";
import { withTimeout } from "../browser/evaluate.js";
import { contextFromPage } from "./context.js";
import { bootstrap } from "./session.js";

type TemporaryCandidate = {
  label: string;
  onEvidence: TemporaryChatEvidence[];
  offEvidence: TemporaryChatEvidence[];
};

const TEMPORARY_TURN_ON_LABELS = [
  "一時チャットをオンにする",
  "Turn on temporary chat",
  "Turn on Temporary Chat",
  "Temporary chat"
];

const TEMPORARY_TURN_OFF_LABELS = [
  "一時チャットをオフにする",
  "Turn off temporary chat",
  "Turn off Temporary Chat"
];

export async function readTemporaryChatState(env: RuntimeEnv): Promise<CommandResult<TemporaryChatData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<TemporaryChatData>;
  }

  const page = env.page!;
  const candidates = await readTemporaryCandidates(page);
  const labels = candidates.map(candidate => candidate.label);
  const evidence = candidates.flatMap(candidate => [...candidate.onEvidence, ...candidate.offEvidence]);
  const context = await contextFromPage(page);

  if (candidates.length === 0 && isTemporaryUrlEmptyChat(context.url, context.turnCount, context.assistantTurnCount)) {
    const urlEvidence = [
      { label: "Temporary Chat URL parameter", source: "url-param=temporary-chat=true" },
      { label: "Empty ChatGPT thread", source: "empty-chat" }
    ];
    return resultOk({
      state: "on",
      confidence: "verified",
      evidence: urlEvidence,
      candidates: labels
    }, context);
  }

  if (candidates.length !== 1) {
    return resultOk({ state: "unknown", evidence, candidates: labels }, context);
  }

  const candidate = candidates[0]!;
  if (candidate.onEvidence.length >= 2) {
    return resultOk({
      state: "on",
      confidence: "verified",
      evidence: candidate.onEvidence,
      candidates: labels
    }, context);
  }

  if (candidate.offEvidence.length > 0 && candidate.onEvidence.length === 0) {
    return resultOk({ state: "off", evidence: candidate.offEvidence, candidates: labels }, context);
  }

  return resultOk({ state: "unknown", evidence, candidates: labels }, context);
}

function isTemporaryUrlEmptyChat(url: string | undefined, turnCount: number | undefined, assistantTurnCount: number | undefined): boolean {
  return typeof url === "string"
    && /[?&]temporary-chat=true\b/i.test(url)
    && turnCount === 0
    && assistantTurnCount === 0;
}

export async function ensureTemporaryChatOn(env: RuntimeEnv): Promise<CommandResult<TemporaryChatData>> {
  let before = await readTemporaryChatState(env);
  for (let attempt = 0; before.ok && before.data?.state === "unknown" && before.data.candidates.length === 0 && attempt < 3; attempt += 1) {
    await env.page?.waitForTimeout?.(750);
    before = await readTemporaryChatState(env);
  }
  if (!before.ok || before.data === undefined) {
    return before;
  }
  if (before.data.state === "on") {
    return before;
  }
  if (before.data.state === "unknown") {
    return temporaryBlocker(env.page, "Temporary Chat state could not be verified before toggling.", before.data);
  }

  const clicked = await clickTemporaryCandidate(env.page!);
  if (!clicked) {
    return temporaryBlocker(env.page, "Temporary Chat toggle was not uniquely clickable.", before.data);
  }
  await env.page!.waitForTimeout?.(500);

  const after = await readTemporaryChatState(env);
  if (after.ok && after.data?.state === "on") {
    return after;
  }
  return temporaryBlocker(env.page, "Temporary Chat did not become verified_on after toggling.", after.data);
}

export async function assertTemporaryChatVerifiedOn(env: RuntimeEnv): Promise<CommandResult<TemporaryChatData>> {
  const state = await readTemporaryChatState(env);
  if (state.ok && state.data?.state === "on") {
    return state;
  }
  return temporaryBlocker(env.page, "Temporary Chat is not verified_on.", state.data);
}

async function ensurePage(env: RuntimeEnv): Promise<CommandResult<unknown>> {
  if (env.page !== undefined) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
}

async function readTemporaryCandidates(page: PageLike): Promise<TemporaryCandidate[]> {
  const selectorCandidates = await readTemporaryCandidatesBySelectors(page);
  if (selectorCandidates.length > 0) {
    return selectorCandidates;
  }

  if (typeof page.evaluate !== "function") {
    return [];
  }

  return withTimeout(page.evaluate(() => {
    const labels = [/temporary chat/i, /一時チャット/];
    const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const matchesTemporary = (value: string) => labels.some(pattern => pattern.test(value));
    const sourceEvidence = (label: string, source: string) => ({ label, source });

    return Array.from(document.querySelectorAll("button, [role='button'], [role='switch'], [role='checkbox'], input[type='checkbox']"))
      .map(node => {
        const element = node as HTMLElement;
        const label = normalize(
          element.getAttribute("aria-label")
          || element.innerText
          || element.textContent
          || element.getAttribute("title")
        );
        if (!matchesTemporary(label)) return undefined;

        const onEvidence = [];
        const offEvidence = [];
        const ariaPressed = element.getAttribute("aria-pressed");
        const ariaChecked = element.getAttribute("aria-checked");
        const dataState = element.getAttribute("data-state");
        const className = typeof element.className === "string" ? element.className : "";
        const labelMeansTurnOn = /\bturn on\b/i.test(label) || /オンにする/.test(label);
        const labelMeansTurnOff = /\bturn off\b/i.test(label) || /オフにする/.test(label);
        const currentUrl = typeof document.location?.href === "string" ? document.location.href : "";
        const temporaryUrlOn = /[?&]temporary-chat=true\b/i.test(currentUrl);

        if (labelMeansTurnOff) onEvidence.push(sourceEvidence(label, "label-action=turn-off"));
        if (temporaryUrlOn) onEvidence.push(sourceEvidence(label, "url-param=temporary-chat=true"));
        if (ariaPressed === "true") onEvidence.push(sourceEvidence(label, "aria-pressed=true"));
        if (ariaChecked === "true") onEvidence.push(sourceEvidence(label, "aria-checked=true"));
        if (/^(checked|on|active|selected)$/i.test(dataState ?? "")) onEvidence.push(sourceEvidence(label, `data-state=${dataState}`));
        if (/\b(active|selected|checked)\b/i.test(className)) onEvidence.push(sourceEvidence(label, "selected-class"));
        if ((element as HTMLInputElement).checked === true) onEvidence.push(sourceEvidence(label, "input.checked=true"));
        if (document.body.innerText.match(/temporary chat (is )?(on|enabled)/i)) onEvidence.push(sourceEvidence(label, "page-temporary-on-text"));
        if (document.body.innerText.match(/一時チャット.*(オン|有効)/)) onEvidence.push(sourceEvidence(label, "page-temporary-on-text"));

        if (labelMeansTurnOn) offEvidence.push(sourceEvidence(label, "label-action=turn-on"));
        if (ariaPressed === "false") offEvidence.push(sourceEvidence(label, "aria-pressed=false"));
        if (ariaChecked === "false") offEvidence.push(sourceEvidence(label, "aria-checked=false"));
        if (/^(unchecked|off|inactive)$/i.test(dataState ?? "")) offEvidence.push(sourceEvidence(label, `data-state=${dataState}`));
        if ((element as HTMLInputElement).checked === false && element.tagName.toLowerCase() === "input") {
          offEvidence.push(sourceEvidence(label, "input.checked=false"));
        }

        return { label, onEvidence, offEvidence };
      })
      .filter((value): value is TemporaryCandidate => value !== undefined);
  }), 3000, "Timed out reading Temporary Chat state.").catch(() => []);
}

async function clickTemporaryCandidate(page: PageLike): Promise<boolean> {
  const clickedBySelector = await clickTemporaryCandidateBySelector(page);
  if (clickedBySelector) {
    return true;
  }

  if (typeof page.evaluate === "function") {
    const clicked = await withTimeout(page.evaluate(() => {
      const labels = [/temporary chat/i, /一時チャット/];
      const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
      const matchesTemporary = (value: string) => labels.some(pattern => pattern.test(value));
      const candidates = Array.from(document.querySelectorAll("button, [role='button'], [role='switch'], [role='checkbox'], input[type='checkbox']"))
        .filter(node => {
          const element = node as HTMLElement;
          const label = normalize(
            element.getAttribute("aria-label")
            || element.innerText
            || element.textContent
            || element.getAttribute("title")
          );
          return matchesTemporary(label);
        });
      if (candidates.length !== 1) return false;
      (candidates[0] as HTMLElement).click();
      return true;
    }), 3000, "Timed out clicking Temporary Chat candidate.").catch(() => false);
    if (clicked) return true;
  }

  return false;
}

async function readTemporaryCandidatesBySelectors(page: PageLike): Promise<TemporaryCandidate[]> {
  if (typeof page.locator !== "function") {
    return [];
  }

  const url = typeof page.url === "function"
    ? await withTimeout(Promise.resolve(page.url()), 3000, "Timed out reading page URL.").catch(() => "")
    : "";
  const temporaryUrlOn = /[?&]temporary-chat=true\b/i.test(url);
  const candidates: TemporaryCandidate[] = [];

  const turnOffLocator = page.locator(ariaButtonSelector(TEMPORARY_TURN_OFF_LABELS));
  if (await locatorCount(turnOffLocator) === 1) {
    const label = "Temporary Chat turn-off control";
    const onEvidence: TemporaryChatEvidence[] = [{ label, source: "label-action=turn-off" }];
    if (temporaryUrlOn) {
      onEvidence.push({ label, source: "url-param=temporary-chat=true" });
    }
    candidates.push({ label, onEvidence, offEvidence: [] });
  }

  const turnOnLocator = page.locator(ariaButtonSelector(TEMPORARY_TURN_ON_LABELS));
  if (await locatorCount(turnOnLocator) === 1) {
    const label = "Temporary Chat turn-on control";
    candidates.push({
      label,
      onEvidence: [],
      offEvidence: [{ label, source: "label-action=turn-on" }]
    });
  }

  return candidates;
}

async function clickTemporaryCandidateBySelector(page: PageLike): Promise<boolean> {
  if (typeof page.locator !== "function") {
    return false;
  }

  const locator = page.locator(ariaButtonSelector([...TEMPORARY_TURN_ON_LABELS, ...TEMPORARY_TURN_OFF_LABELS]));
  if (await locatorCount(locator) !== 1) {
    return false;
  }
  await withTimeout(locator.click?.({ timeoutMs: 5000 }) ?? Promise.resolve(), 6000, "Timed out clicking Temporary Chat button.");
  return true;
}

async function locatorCount(locator: { count?: () => Promise<number> } | undefined): Promise<number> {
  if (locator?.count === undefined) {
    return 0;
  }
  return withTimeout(locator.count(), 1000, "Timed out counting Temporary Chat candidates.").catch(() => 0);
}

function ariaButtonSelector(labels: string | string[]): string {
  const values = Array.isArray(labels) ? labels : [labels];
  return values.flatMap(label => [
    `button[aria-label="${cssAttributeValue(label)}"]`,
    `[role='button'][aria-label="${cssAttributeValue(label)}"]`
  ]).join(", ");
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

async function temporaryBlocker(
  page: PageLike | undefined,
  message: string,
  data: TemporaryChatData | undefined
): Promise<CommandResult<TemporaryChatData>> {
  const blocker: NonNullable<CommandResult["blocker"]> = {
    kind: "selector_drift",
    code: "temporary_chat_not_verified",
    message,
    resumable: true
  };
  const candidates = data?.candidates.map(label => ({ label }));
  if (candidates !== undefined) blocker.candidates = candidates;

  const result: CommandResult<TemporaryChatData> = {
    ok: false,
    status: "blocked",
    warnings: [],
    blocker,
    context: await contextFromPage(page)
  };
  if (data !== undefined) result.data = data;
  return result;
}
