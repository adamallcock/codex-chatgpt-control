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
};

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
    if (!await clickUniqueExperienceControl(page, labels)) {
      return experienceSelectorDrift(
        page,
        `No unique visible ChatGPT ${args.experience === "work" ? "Work" : "Chat"} surface control was found.`,
        before
      );
    }

    const timeoutMs = args.timeoutMs ?? 30000;
    const started = Date.now();
    let after = before;
    while (Date.now() - started < timeoutMs) {
      await page.waitForTimeout?.(250);
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

export function detectExperienceFromSnapshot(snapshot: SurfaceSnapshot): DetectExperienceData {
  const evidence: ExperienceEvidence[] = [];
  const composerLabels = snapshot.composerLabels.map(normalizeForLabelMatch);
  const controls = snapshot.mainControls.map(normalizeForLabelMatch);
  const mainText = normalizeForLabelMatch(snapshot.mainText);
  const url = snapshot.url.toLowerCase();

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

  if (/\/work(?:\/|$|\?)/.test(url)) {
    evidence.push({ source: "url", label: snapshot.url });
  }
  if (containsAny(mainText, ["work on something else", "work on anything"])) {
    evidence.push({ source: "heading", label: "Work composer copy" });
  }

  const workScore = workComposer.length * 4
    + (workAxisCount >= 2 ? 4 : 0)
    + (/\/work(?:\/|$|\?)/.test(url) ? 3 : 0)
    + (containsAny(mainText, ["work on something else", "work on anything"]) ? 2 : 0);
  const chatScore = chatComposer.length * 4;

  let experience: ChatGPTExperience = "unknown";
  let confidence: ExperienceConfidence = "low";
  if (workScore > chatScore && workScore >= 4) {
    experience = "work";
    confidence = workScore >= 7 ? "high" : "medium";
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
    return { url, composerLabels: [], mainControls: [], mainText: "" };
  }

  const snapshot = await page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const html = element as HTMLElement;
      const rect = html.getBoundingClientRect?.();
      const style = typeof window !== "undefined" ? window.getComputedStyle?.(html) : undefined;
      return (rect === undefined || (rect.width > 0 && rect.height > 0))
        && style?.display !== "none"
        && style?.visibility !== "hidden"
        && style?.opacity !== "0";
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
    return { composerLabels, mainControls, mainText };
  }).catch(() => ({ composerLabels: [], mainControls: [], mainText: "" }));

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
    for (const role of ["button", "menuitem", "tab", "link"]) {
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
    const nodes = Array.from(document.querySelectorAll(
      "header button, header [role='button'], header [role='tab'], main [role='menuitem'], main [role='option']"
    ));
    const matches = nodes.filter(node => {
      const html = node as HTMLElement;
      const label = node.getAttribute("aria-label") ?? html.innerText ?? node.textContent ?? "";
      return wanted.has(normalize(label));
    });
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
