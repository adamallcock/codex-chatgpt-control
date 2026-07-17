import { resultError, resultOk } from "../errors.js";
import { localeLabels } from "../dom/locale-labels.js";
import { normalizeForLabelMatch, visibleLabelMatches } from "../dom/label-match.js";
import type {
  ChatGPTExperience,
  CommandResult,
  DetectExperienceArgs,
  DetectExperienceData,
  ExperienceConfidence,
  ExperienceEvidence,
  LocatorLike,
  OpenExperienceArgs,
  OpenExperienceData,
  PageLike,
  RuntimeEnv,
  SurfaceSelectorProfile
} from "../types.js";
import { contextFromPage } from "./context.js";
import { ensurePage } from "./session.js";

type SurfaceSnapshot = {
  url: string;
  composerLabels: string[];
  mainControls: string[];
  mainText: string;
  selectedSurfaceLabels?: string[];
};

const CHATGPT_HOME = "https://chatgpt.com/";
const EXPERIENCE_CONTROL_DISCOVERY_TIMEOUT_MS = 5_000;
const EXPERIENCE_POLL_MS = 250;

export async function detectExperience(
  env: RuntimeEnv,
  args: DetectExperienceArgs = {}
): Promise<CommandResult<DetectExperienceData>> {
  void args;
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<DetectExperienceData>;
  }

  const page = env.page!;
  try {
    const data = detectExperienceFromSnapshot(await readSurfaceSnapshot(page));
    return resultOk(data, await contextFromPage(page, {
      experience: data.experience,
      selectorProfile: data.selectorProfile
    }), data.experience === "unknown"
      ? ["The current ChatGPT surface could not be classified as Chat or Work from scoped composer evidence."]
      : []);
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

export async function openExperience(
  env: RuntimeEnv,
  args: OpenExperienceArgs
): Promise<CommandResult<OpenExperienceData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<OpenExperienceData>;
  }

  const page = env.page!;
  try {
    const before = detectExperienceFromSnapshot(await readSurfaceSnapshot(page));
    if (before.experience === args.experience) {
      return resultOk({
        experience: args.experience,
        previousExperience: before.experience,
        changed: false,
        selectorProfile: before.selectorProfile
      }, await contextFromPage(page, {
        experience: before.experience,
        selectorProfile: before.selectorProfile
      }));
    }

    const labels = localeLabels.experienceOptions[args.experience];
    const timeoutMs = args.timeoutMs ?? 30000;
    const discoveryAttempts = pollAttempts(
      Math.min(timeoutMs, EXPERIENCE_CONTROL_DISCOVERY_TIMEOUT_MS),
      EXPERIENCE_POLL_MS
    );
    let observed = before;
    let controlClicked = await clickUniqueExperienceControl(page, labels);
    if (!controlClicked && await navigateConversationToSurfaceHome(page, args.timeoutMs)) {
      observed = detectExperienceFromSnapshot(await readSurfaceSnapshot(page));
      if (observed.experience === args.experience) {
        return resultOk({
          experience: args.experience,
          previousExperience: before.experience,
          changed: true,
          selectorProfile: observed.selectorProfile
        }, await contextFromPage(page, {
          experience: observed.experience,
          selectorProfile: observed.selectorProfile
        }));
      }
      controlClicked = await clickUniqueExperienceControl(page, labels);
    }

    // session.bootstrap can verify the composer before the Chat/Work radio has
    // hydrated. Give the scoped surface control a short bounded discovery
    // window instead of reporting selector drift from that transient state.
    for (let attempt = 1; !controlClicked && attempt < discoveryAttempts; attempt += 1) {
      await page.waitForTimeout?.(EXPERIENCE_POLL_MS);
      observed = detectExperienceFromSnapshot(await readSurfaceSnapshot(page));
      if (observed.experience === args.experience) {
        return resultOk({
          experience: args.experience,
          previousExperience: before.experience,
          changed: true,
          selectorProfile: observed.selectorProfile
        }, await contextFromPage(page, {
          experience: observed.experience,
          selectorProfile: observed.selectorProfile
        }));
      }
      controlClicked = await clickUniqueExperienceControl(page, labels);
    }
    if (!controlClicked) {
      return experienceSelectorDrift(
        page,
        `No unique visible ChatGPT ${args.experience === "work" ? "Work" : "Chat"} surface control was found.`,
        observed
      );
    }

    let after = before;
    for (let attempt = 0; attempt < pollAttempts(timeoutMs, EXPERIENCE_POLL_MS); attempt += 1) {
      await page.waitForTimeout?.(EXPERIENCE_POLL_MS);
      after = detectExperienceFromSnapshot(await readSurfaceSnapshot(page));
      if (after.experience === args.experience) {
        return resultOk({
          experience: args.experience,
          previousExperience: before.experience,
          changed: true,
          selectorProfile: after.selectorProfile
        }, await contextFromPage(page, {
          experience: after.experience,
          selectorProfile: after.selectorProfile
        }));
      }
    }

    return {
      ok: false,
      status: "blocked",
      warnings: [],
      blocker: {
        kind: "selector_drift",
        code: "experience_postcondition_unverified",
        fieldPath: "experience",
        message: `The ${args.experience} surface control was clicked, but the composer did not verify that ChatGPT switched to ${args.experience}.`,
        candidates: labels.map(label => ({ label })),
        resumable: true
      },
      context: await contextFromPage(page, {
        experience: after.experience,
        selectorProfile: after.selectorProfile
      })
    };
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

function pollAttempts(timeoutMs: number, pollMs: number): number {
  return Math.max(1, Math.ceil(Math.max(0, timeoutMs) / pollMs));
}

async function navigateConversationToSurfaceHome(
  page: PageLike,
  timeoutMs: number | undefined
): Promise<boolean> {
  if (page.goto === undefined || page.url === undefined) return false;
  const currentUrl = await Promise.resolve(page.url()).catch(() => "");
  if (!/^https:\/\/chatgpt\.com\/c\//i.test(currentUrl)) return false;
  await page.goto(CHATGPT_HOME, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs ?? 30000
  });
  await page.waitForTimeout?.(500);
  return true;
}

export function detectExperienceFromSnapshot(snapshot: SurfaceSnapshot): DetectExperienceData {
  const evidence: ExperienceEvidence[] = [];
  const composerLabels = snapshot.composerLabels.map(normalizeForLabelMatch);
  const controls = snapshot.mainControls.map(normalizeForLabelMatch);
  const mainText = normalizeForLabelMatch(snapshot.mainText);
  const selectedSurfaceLabels = (snapshot.selectedSurfaceLabels ?? []).map(normalizeForLabelMatch);
  const url = snapshot.url.toLowerCase();

  const selectedWork = matchingLabels(selectedSurfaceLabels, localeLabels.experienceOptions.work);
  const selectedChat = matchingLabels(selectedSurfaceLabels, localeLabels.experienceOptions.chat);
  const workSurfaceSelected = selectedWork.length > 0 && selectedChat.length === 0;
  const chatSurfaceSelected = selectedChat.length > 0 && selectedWork.length === 0;
  if (workSurfaceSelected) {
    evidence.push({ source: "control", label: "Work surface selected" });
  } else if (chatSurfaceSelected) {
    evidence.push({ source: "control", label: "Chat surface selected" });
  }

  const workComposer = matchingLabels(composerLabels, localeLabels.workComposerTextbox);
  for (const label of workComposer) {
    evidence.push({ source: "composer", label });
  }

  const chatComposer = matchingLabels(composerLabels, localeLabels.composerTextbox);
  for (const label of chatComposer) {
    evidence.push({ source: "composer", label });
  }

  const workAxisCount = (["model", "effort", "speed"] as const)
    .filter(axis => hasAnyLabel(controls, localeLabels.configurationAxes[axis]))
    .length;
  if (workAxisCount >= 2) {
    evidence.push({ source: "control", label: `Work configuration axes (${workAxisCount}/3)` });
  }
  const workConfigurationOpener = controls.some(label =>
    /\b(?:gpt[\s-]?\d|\d+(?:\.\d+)+|sol|luna|terra)\b/i.test(label)
    && hasAnyLabel([label], [
      ...localeLabels.configurationOptions.light,
      ...localeLabels.configurationOptions.medium,
      ...localeLabels.configurationOptions.high,
      ...localeLabels.configurationOptions.extraHigh,
      ...localeLabels.configurationOptions.max,
      ...localeLabels.configurationOptions.ultra,
    ])
  );
  if (workConfigurationOpener) {
    evidence.push({ source: "control", label: "Work configuration opener" });
  }

  if (/\/work(?:\/|$|\?)/.test(url)) {
    evidence.push({ source: "url", label: snapshot.url });
  }
  if (containsAny(mainText, ["work on something else", "work on anything"])) {
    evidence.push({ source: "heading", label: "Work composer copy" });
  }

  const workScore = workComposer.length * 4
    + (workSurfaceSelected ? 10 : 0)
    + (workAxisCount >= 2 ? 4 : 0)
    // The active Work task drops the Chat/Work radio and keeps the shared
    // "Chat with ChatGPT" textbox name. Its compound model + effort opener is
    // therefore strong enough to disambiguate that continuation surface.
    + (workConfigurationOpener ? 6 : 0)
    + (/\/work(?:\/|$|\?)/.test(url) ? 3 : 0)
    + (containsAny(mainText, ["work on something else", "work on anything"]) ? 2 : 0);
  const chatScore = chatComposer.length * 4
    + (chatSurfaceSelected ? 10 : 0);

  let experience: ChatGPTExperience = "unknown";
  let confidence: ExperienceConfidence = "low";
  if (workScore > chatScore && workScore >= 4) {
    experience = "work";
    confidence = workSurfaceSelected || workScore >= 7 ? "high" : "medium";
  } else if (chatScore > workScore && chatScore >= 4) {
    experience = "chat";
    confidence = "high";
  }

  const selectorProfile = profileFromSnapshot(snapshot, experience);
  return { experience, selectorProfile, confidence, evidence };
}

export async function readSurfaceSnapshot(page: PageLike): Promise<SurfaceSnapshot> {
  const url = typeof page.url === "function"
    ? await Promise.resolve(page.url()).catch(() => "")
    : "";
  if (typeof page.evaluate !== "function") {
    return { url, composerLabels: [], mainControls: [], mainText: "", selectedSurfaceLabels: [] };
  }

  const snapshot = await page.evaluate((surfaceOptionLabels: string[]) => {
    const visible = (element: Element): boolean => {
      const html = element as HTMLElement;
      const rect = html.getBoundingClientRect?.();
      if (rect !== undefined && (rect.width <= 0 || rect.height <= 0)) return false;
      let current: Element | null = element;
      while (current !== null) {
        if (current.hasAttribute?.("inert") || current.getAttribute?.("aria-hidden") === "true") {
          return false;
        }
        const style = typeof window !== "undefined"
          ? window.getComputedStyle?.(current as HTMLElement)
          : undefined;
        if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") {
          return false;
        }
        current = current.parentElement ?? null;
      }
      return true;
    };
    const labelFor = (element: Element): string => {
      const html = element as HTMLElement;
      return element.getAttribute("aria-label")
        ?? element.getAttribute("placeholder")
        ?? html.innerText
        ?? element.textContent
        ?? "";
    };
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const normalizeComparable = (value: string): string => normalize(value).toLocaleLowerCase();
    const wantedSurfaceLabels = new Set(surfaceOptionLabels.map(normalizeComparable));
    const composerRoots = Array.from(document.querySelectorAll(
      "main form, main [data-testid*='composer' i], main [class*='composer' i]"
    ));
    const composerNodes = composerRoots.flatMap(root => [
      root,
      ...Array.from(root.querySelectorAll("textarea, [contenteditable='true'], [role='textbox'], input"))
    ]);
    const composerLabels = Array.from(new Set(composerNodes
      .filter(visible)
      .map(labelFor)
      .map(normalize)
      .filter(Boolean)))
      .slice(0, 16);
    const main = document.querySelector("main");
    const overlayRoots = Array.from(document.querySelectorAll(
      "[role='menu'], [role='listbox'], [data-radix-popper-content-wrapper], [data-radix-menu-content]"
    )).filter(visible);
    const controlRoots = Array.from(new Set<Element>([...composerRoots, ...overlayRoots]));
    const effectiveControlRoots = controlRoots.length > 0
      ? controlRoots
      : main === null ? [] : [main];
    const mainControls = Array.from(new Set(effectiveControlRoots.flatMap(root => Array.from(root.querySelectorAll(
      "button, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='option']"
    )))
      .filter(visible)
      .map(labelFor)
      .map(normalize)
      .filter(Boolean)))
      .slice(0, 120);
    const surfaceTextNodes = main === null ? [] : Array.from(main.querySelectorAll(
      "h1, h2, h3, form, [data-testid*='composer' i], [class*='composer' i]"
    ))
      .filter(visible)
      .slice(0, 32);
    const mainText = normalize(surfaceTextNodes.map(labelFor).join(" ")).slice(0, 2000);
    const selectedSurfaceLabels = Array.from(new Set(Array.from(document.querySelectorAll(
      "[role='radio'][aria-checked='true'], [role='radio'][data-state='checked'], input[type='radio']:checked"
    ))
      .filter(visible)
      .map(labelFor)
      .map(normalize)
      .filter(label => wantedSurfaceLabels.has(normalizeComparable(label)))))
      .slice(0, 4);
    return { composerLabels, mainControls, mainText, selectedSurfaceLabels };
  }, [
    ...localeLabels.experienceOptions.chat,
    ...localeLabels.experienceOptions.work,
  ]).catch(() => ({ composerLabels: [], mainControls: [], mainText: "", selectedSurfaceLabels: [] }));

  return { url, ...snapshot };
}

function profileFromSnapshot(
  snapshot: SurfaceSnapshot,
  experience: ChatGPTExperience
): SurfaceSelectorProfile {
  const controls = snapshot.mainControls.map(normalizeForLabelMatch);
  const mainText = normalizeForLabelMatch(snapshot.mainText);

  if (experience === "work") {
    return hasAnyLabel(controls, localeLabels.configurationAxes.advanced)
      || containsAny(mainText, localeLabels.configurationAxes.advanced)
      ? "work_advanced_v1"
      : "work_basic_v1";
  }
  if (experience !== "chat") {
    return "unknown";
  }

  const simplifiedOptions = [
    ...localeLabels.configurationOptions.instant,
    ...localeLabels.configurationOptions.medium,
    ...localeLabels.configurationOptions.high,
    ...localeLabels.configurationOptions.extraHigh,
    ...localeLabels.configurationOptions.pro,
  ];
  if (hasAnyLabel(controls, simplifiedOptions)) {
    return "chat_simplified_v1";
  }
  const legacyOptions = [
    ...localeLabels.modeOptions.latest,
    ...localeLabels.modeOptions.thinking,
    ...localeLabels.modeOptions.extended,
  ];
  return hasAnyLabel(controls, legacyOptions)
    ? "chat_legacy_v1"
    : "chat_simplified_v1";
}

async function clickUniqueExperienceControl(page: PageLike, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    for (const role of ["radio", "button", "menuitem", "tab", "link"]) {
      if (await clickIfUnique(page.getByRole?.(role, { name: label, exact: true }))) {
        return true;
      }
    }
  }

  if (typeof page.evaluate !== "function") {
    return false;
  }
  return page.evaluate((wantedLabels: string[]) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const wanted = new Set(wantedLabels.map(normalize));
    const visible = (element: Element): boolean => {
      const html = element as HTMLElement;
      const rect = html.getBoundingClientRect?.();
      if (rect !== undefined && (rect.width <= 0 || rect.height <= 0)) return false;
      let current: Element | null = element;
      while (current !== null) {
        if (current.hasAttribute?.("inert") || current.getAttribute?.("aria-hidden") === "true") {
          return false;
        }
        const style = typeof window !== "undefined"
          ? window.getComputedStyle?.(current as HTMLElement)
          : undefined;
        if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") {
          return false;
        }
        current = current.parentElement ?? null;
      }
      return true;
    };
    const labelFor = (node: Element): string => {
      const html = node as HTMLElement;
      const inputLabels = "labels" in node
        ? Array.from((node as HTMLInputElement).labels ?? []).map(label => label.innerText).join(" ")
        : "";
      return node.getAttribute("aria-label")
        || inputLabels
        || html.innerText
        || node.textContent
        || "";
    };
    const nodes = Array.from(document.querySelectorAll(
      "[role='radio'], input[type='radio'], header button, header [role='button'], header [role='tab'], main [role='menuitem'], main [role='option']"
    ));
    const matches = nodes.filter(node => visible(node) && wanted.has(normalize(labelFor(node))));
    if (matches.length !== 1) return false;
    (matches[0] as HTMLElement).click();
    return true;
  }, labels).catch(() => false);
}

async function clickIfUnique(locator: LocatorLike | undefined): Promise<boolean> {
  if (locator?.count === undefined || locator.click === undefined) {
    return false;
  }
  if (await locator.count().catch(() => 0) !== 1) {
    return false;
  }
  await locator.click();
  return true;
}

function matchingLabels(normalizedHaystack: string[], candidates: readonly string[]): string[] {
  const normalizedCandidates = candidates.map(normalizeForLabelMatch);
  return normalizedHaystack
    .filter(label => normalizedCandidates.some(candidate =>
      label === candidate || visibleLabelMatches(label, candidate)
    ))
    .slice(0, 4);
}

function hasAnyLabel(normalizedHaystack: string[], candidates: readonly string[]): boolean {
  const normalizedCandidates = candidates.map(normalizeForLabelMatch);
  return normalizedHaystack.some(label =>
    normalizedCandidates.some(candidate =>
      label === candidate || visibleLabelMatches(label, candidate)
    )
  );
}

function containsAny(normalizedText: string, candidates: readonly string[]): boolean {
  return candidates.map(normalizeForLabelMatch).some(candidate => normalizedText.includes(candidate));
}

async function experienceSelectorDrift<T>(
  page: PageLike,
  message: string,
  detected: DetectExperienceData
): Promise<CommandResult<T>> {
  return {
    ok: false,
    status: "unsupported",
    warnings: [],
    blocker: {
      kind: "selector_drift",
      code: "experience_control_not_found",
      fieldPath: "experience",
      message,
      candidates: detected.evidence.map(item => ({ label: `${item.source}: ${item.label}` })),
      resumable: true
    },
    context: await contextFromPage(page, {
      experience: detected.experience,
      selectorProfile: detected.selectorProfile
    })
  };
}
