import { afterEach, describe, expect, it, vi } from "vitest";
import { detectExperience, detectExperienceFromSnapshot, readSurfaceSnapshot } from "../../src/commands/experience.js";
import type { PageLike } from "../../src/types.js";

const chat = {
  url: "https://chatgpt.com/c/sanitized-conversation",
  composerLabels: ["Chat with ChatGPT"],
  mainText: ""
};

afterEach(() => vi.unstubAllGlobals());

describe("Chat/Work evidence under composer popovers", () => {
  it.each([
    ["closed", ["Thinking effort", "Send prompt"]],
    ["simple", ["Select model", "Thinking effort", "Medium", "Advanced"]],
    ["advanced", ["Select model", "Thinking effort", "Latest", "GPT-5.6 Sol", "GPT-5.5"]],
    ["explicit model", ["Select model", "Thinking effort", "GPT-5.6 Sol", "Medium"]]
  ])("keeps an existing Chat conversation classified with its %s menu", (_view, controls) => {
    const detected = detectExperienceFromSnapshot({ ...chat, mainControls: controls as string[] });
    expect(detected.experience).toBe("chat");
    expect(detected.evidence.some(item => item.label.startsWith("Work configuration"))).toBe(false);
  });

  it("does not combine model/effort and an unrelated speed overlay as Work", () => {
    const detected = detectExperienceFromSnapshot({
      ...chat,
      mainControls: ["Model", "Effort", "Speed"],
      controlGroups: [["Model", "Effort"], ["Speed"]],
      composerControls: ["Thinking effort"]
    });
    expect(detected.experience).toBe("chat");
  });

  it("does not treat a model option's effort description as the Work composer opener", () => {
    const detected = detectExperienceFromSnapshot({
      ...chat,
      mainControls: ["Thinking effort", "GPT-5.6 Sol High performance"],
      composerControls: ["Thinking effort"],
      controlGroups: [["Thinking effort"], ["GPT-5.6 Sol High performance"]]
    });
    expect(detected.experience).toBe("chat");
  });

  it.each([
    { composerControls: ["5.5 Light"], mainControls: ["5.5 Light"] },
    { composerControls: [], mainControls: ["Model", "Effort", "Speed"], controlGroups: [["Model", "Effort", "Speed"]] }
  ])("preserves Work continuation on a shared /c route", snapshot => {
    expect(detectExperienceFromSnapshot({ ...chat, ...snapshot }).experience).toBe("work");
  });

  it("executes DOM capture with separate overlay and composer control ownership", async () => {
    const textbox = element("Chat with ChatGPT");
    const effort = element("Thinking effort");
    const model = element("Select model");
    const modelChoice = element("GPT-5.6 Sol High performance");
    const composer = element("", [textbox, effort]);
    const overlay = element("", [model, modelChoice]);
    composer.querySelectorAll = selector => selector.includes("textarea") ? [textbox] : [effort];
    const main = element("", [composer]);
    main.querySelectorAll = () => [];
    vi.stubGlobal("document", {
      querySelector: () => main,
      querySelectorAll: (selector: string) => selector.startsWith("main form") ? [composer]
        : selector.startsWith("[role='menu']") ? [overlay] : []
    });
    const snapshot = await readSurfaceSnapshot({
      url: () => chat.url,
      evaluate: async (fn, arg) => fn(arg as never)
    } as PageLike);
    expect(snapshot.composerControls).toEqual(["Thinking effort"]);
    expect(snapshot.controlGroups).toEqual([["Thinking effort"], ["Select model", "GPT-5.6 Sol High performance"]]);
    expect(detectExperienceFromSnapshot(snapshot).experience).toBe("chat");
  });

  it.each([false, true])("does not aggregate distinct overlays nested under a composer (nested menu: %s)", async nested => {
    const textbox = element("Chat with ChatGPT");
    const model = element("Model");
    const effort = element("Effort");
    const speed = element("Speed");
    const speedOverlay = element("", [speed]);
    const modelOverlay = element("", nested ? [model, effort, speedOverlay] : [model, effort]);
    const composer = element("", nested ? [textbox, modelOverlay] : [textbox, modelOverlay, speedOverlay]);
    composer.querySelectorAll = selector => selector.includes("textarea") ? [textbox] : [model, effort, speed];
    modelOverlay.querySelectorAll = () => nested ? [model, effort, speed] : [model, effort];
    const main = element("", [composer]);
    main.querySelectorAll = () => [];
    vi.stubGlobal("document", {
      querySelector: () => main,
      querySelectorAll: (selector: string) => selector.startsWith("main form") ? [composer]
        : selector.startsWith("[role='menu']") ? [modelOverlay, speedOverlay] : []
    });
    const snapshot = await readSurfaceSnapshot({
      url: () => chat.url,
      evaluate: async (fn, arg) => fn(arg as never)
    } as PageLike);
    expect(snapshot.composerControls).toEqual([]);
    expect(snapshot.controlGroups).toEqual([[], ["Model", "Effort"], ["Speed"]]);
    expect(detectExperienceFromSnapshot(snapshot).experience).toBe("chat");
  });

  it.each(["composer", "overlay"])("fails closed before expanding excessive visible %s roots", async kind => {
    const roots = Array.from({ length: 33 }, () => element("Chat with ChatGPT"));
    const expand = vi.fn(() => { throw new Error("Oversized capture must not expand descendants"); });
    for (const root of roots) root.querySelectorAll = expand;
    vi.stubGlobal("document", {
      querySelector: () => null,
      querySelectorAll: (selector: string) => (kind === "composer" && selector.startsWith("main form"))
        || (kind === "overlay" && selector.startsWith("[role='menu']")) ? roots : []
    });
    const snapshot = await readSurfaceSnapshot({
      url: () => "https://chatgpt.com/work",
      evaluate: async (fn, arg) => fn(arg as never)
    } as PageLike);
    expect(expand).not.toHaveBeenCalled();
    expect(snapshot.rootBudgetExceeded).toBe(true);
    expect(snapshot.controlGroups).toEqual([]);
    expect(detectExperienceFromSnapshot(snapshot)).toMatchObject({
      experience: "unknown",
      evidence: [{ source: "control", label: "Experience surface root budget exceeded" }]
    });
  });

  it("retries an empty loading snapshot until the existing Chat composer is ready", async () => {
    const page = loadingPage(1);
    const result = await detectExperience({ page }, { timeoutMs: 750 });
    expect(result.data?.experience).toBe("chat");
    expect(page.waitForTimeout).toHaveBeenCalledTimes(1);
  });

  it("bounds loading retries and honors a zero timeout", async () => {
    const page = loadingPage(100);
    const result = await detectExperience({ page }, { timeoutMs: 750 });
    expect(result.data?.experience).toBe("unknown");
    expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
    const noWait = loadingPage(100);
    expect((await detectExperience({ page: noWait }, { timeoutMs: 0 })).data?.experience).toBe("unknown");
    expect(noWait.waitForTimeout).not.toHaveBeenCalled();
  });

  it("stops loading retries when a sign-in blocker appears", async () => {
    const page = loadingPage(100, "Log in to continue");
    const result = await detectExperience({ page }, { timeoutMs: 1000 });
    expect(result.ok).toBe(false);
    expect(result.blocker?.kind).toBe("login_required");
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });
});

type TestElement = {
  parentElement: TestElement | null;
  innerText: string;
  textContent: string;
  hasAttribute: () => boolean;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { width: number; height: number };
  contains: (node: unknown) => boolean;
  querySelectorAll: (selector: string) => TestElement[];
};

function element(label: string, children: TestElement[] = []): TestElement {
  const node: TestElement = {
    parentElement: null,
    innerText: label,
    textContent: label,
    hasAttribute: () => false,
    getAttribute: name => name === "aria-label" ? label : null,
    getBoundingClientRect: () => ({ width: 100, height: 30 }),
    contains: candidate => children.some(child => child === candidate || child.contains(candidate)),
    querySelectorAll: () => children
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function loadingPage(loadingSnapshots: number, blockerText = ""): PageLike {
  let reads = 0;
  return {
    url: () => chat.url,
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: async <T, A>(fn: (arg: A) => T | Promise<T>): Promise<T> => {
      if (String(fn).includes("composerRoots")) {
        reads += 1;
        return {
          composerLabels: reads <= loadingSnapshots ? [] : chat.composerLabels,
          mainControls: [], mainText: ""
        } as T;
      }
      if (String(fn).includes("blockerText")) return {
        visibleText: blockerText, blockerText, hasConversationMessages: false
      } as T;
      return 0 as T;
    }
  };
}
