import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyConfiguration,
  configurationMatchesSelection,
  configurationInspectionFromSurface,
  inspectConfiguration,
  type ConfigurationPanelSnapshot
} from "../../src/commands/configuration.js";
import {
  detectExperienceFromSnapshot,
  openExperience
} from "../../src/commands/experience.js";
import type {
  ConfigurationAxis,
  LocatorLike,
  PageLike,
  SurfaceProfileFixture
} from "../../src/types.js";
import type { MenuItem } from "../../src/dom/menus.js";

type TestSurfaceProfileFixture = Omit<SurfaceProfileFixture, "panel" | "menuItems"> & {
  panel: ConfigurationPanelSnapshot;
  menuItems: MenuItem[];
};

const fixtureNames = [
  "surface-chat-legacy.json",
  "surface-chat-simplified.json",
  "surface-sidebar-false-positive.json",
  "surface-work-basic.json",
  "surface-work-advanced.json",
] as const;

describe("sanitized Chat and Work surface profiles", () => {
  for (const fixtureName of fixtureNames) {
    it(`detects and inspects ${fixtureName}`, async () => {
      const fixture = await readSurfaceFixture(fixtureName);
      const detected = detectExperienceFromSnapshot(fixture.snapshot);
      expect(detected.experience, fixture.id).toBe(fixture.expected.experience);
      expect(detected.selectorProfile, fixture.id).toBe(fixture.expected.selectorProfile);
      expect(fixture.region.length, fixture.id).toBeGreaterThan(0);
      expect(fixture.accountScope.length, fixture.id).toBeGreaterThan(0);
      expect(fixture.planScope.length, fixture.id).toBeGreaterThan(0);
      expect(fixture.workspaceScope.length, fixture.id).toBeGreaterThan(0);

      const inspection = configurationInspectionFromSurface(
        detected.experience,
        detected.selectorProfile,
        detected.evidence,
        fixture.panel,
        fixture.menuItems
      );
      expect(inspection.selectorProfile, fixture.id).toBe(fixture.expected.selectorProfile);
      expect(inspection.availableAxes, fixture.id).toEqual(fixture.expected.availableAxes);
      expect(inspection.active, fixture.id).toEqual(fixture.expected.active);
    });
  }

  it("does not treat a sidebar title containing Pro as a selected configuration", async () => {
    const fixture = await readSurfaceFixture("surface-sidebar-false-positive.json");
    const detected = detectExperienceFromSnapshot(fixture.snapshot);
    const inspection = configurationInspectionFromSurface(
      detected.experience,
      detected.selectorProfile,
      detected.evidence,
      fixture.panel,
      fixture.menuItems
    );

    expect(inspection.experience).toBe("chat");
    expect(inspection.active).toEqual({});
    expect(inspection.availableAxes).toEqual([]);
  });

  it("verifies legacy Chat aliases without changing the inspection wire shape", async () => {
    const legacy = await readSurfaceFixture("surface-chat-legacy.json");
    const legacyDetected = detectExperienceFromSnapshot(legacy.snapshot);
    const legacyInspection = configurationInspectionFromSurface(
      legacyDetected.experience,
      legacyDetected.selectorProfile,
      legacyDetected.evidence,
      legacy.panel,
      legacy.menuItems
    );

    expect(legacyInspection.active).toEqual({ effort: "Thinking" });
    expect(configurationMatchesSelection(legacyInspection, { intelligence: "Thinking" })).toBe(true);
    expect(configurationMatchesSelection(legacyInspection, { model: "Thinking" })).toBe(true);

    const simplified = await readSurfaceFixture("surface-chat-simplified.json");
    const simplifiedDetected = detectExperienceFromSnapshot(simplified.snapshot);
    const simplifiedInspection = configurationInspectionFromSurface(
      simplifiedDetected.experience,
      simplifiedDetected.selectorProfile,
      simplifiedDetected.evidence,
      simplified.panel,
      simplified.menuItems
    );

    expect(simplifiedInspection.active).toEqual({ intelligence: "Pro" });
    expect(configurationMatchesSelection(simplifiedInspection, { effort: "Pro" })).toBe(true);
    expect(configurationMatchesSelection(simplifiedInspection, { model: "Pro" })).toBe(true);
    expect(configurationMatchesSelection(simplifiedInspection, { modelVersion: "GPT-5.6 Sol" })).toBe(false);
  });

  it("switches from Chat to Work only after the scoped composer verifies the postcondition", async () => {
    const page = surfaceSwitchPage("radio");

    const result = await openExperience({ page }, { experience: "work", timeoutMs: 100 });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      experience: "work",
      previousExperience: "chat",
      changed: true,
      selectorProfile: "work_basic_v1"
    });
    expect(page.switchClickCount()).toBe(1);
    expect(page.requestedRoles()[0]).toBe("radio");
  });

  it("keeps the legacy button-based Chat and Work switch as a fallback", async () => {
    const page = surfaceSwitchPage("button");

    const result = await openExperience({ page }, { experience: "work", timeoutMs: 100 });

    expect(result.ok).toBe(true);
    expect(page.switchClickCount()).toBe(1);
    expect(page.requestedRoles()).toEqual(["radio", "button"]);
  });

  it("waits for the Chat and Work surface radio to hydrate after bootstrap", async () => {
    const page = surfaceSwitchPage("radio", 1);

    const result = await openExperience({ page }, { experience: "work", timeoutMs: 1000 });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ experience: "work", changed: true });
    expect(page.switchClickCount()).toBe(1);
  });

  it("returns to the surface selector before switching an active Work task to Chat", async () => {
    const page = activeWorkTaskSwitchPage();

    const result = await openExperience({ page }, { experience: "chat", timeoutMs: 100 });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      experience: "chat",
      previousExperience: "work",
      changed: true,
      selectorProfile: "chat_simplified_v1"
    });
    expect(page.homeNavigationCount()).toBe(1);
    expect(page.switchClickCount()).toBe(1);
  });

  it("reports a navigation error instead of hiding a failed return to the surface selector", async () => {
    const page = activeWorkTaskSwitchPage(true);

    const result = await openExperience({ page }, { experience: "chat", timeoutMs: 100 });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error?.message).toContain("Surface-home navigation failed");
    expect(page.homeNavigationCount()).toBe(1);
    expect(page.switchClickCount()).toBe(0);
  });

  it("uses the selected surface radio to disambiguate the shared textbox name", () => {
    const detected = detectExperienceFromSnapshot({
      url: "https://chatgpt.com/",
      composerLabels: ["Chat with ChatGPT"],
      mainControls: ["5.5 Light"],
      mainText: "",
      selectedSurfaceLabels: ["Work"]
    });

    expect(detected.experience).toBe("work");
    expect(detected.confidence).toBe("high");
    expect(detected.evidence).toContainEqual({
      source: "control",
      label: "Work surface selected"
    });
  });

  it("keeps a selected Chat radio authoritative over stale Work-like controls", () => {
    const detected = detectExperienceFromSnapshot({
      url: "https://chatgpt.com/",
      composerLabels: ["Chat with ChatGPT"],
      mainControls: ["5.5 Light"],
      mainText: "",
      selectedSurfaceLabels: ["Chat"]
    });

    expect(detected.experience).toBe("chat");
    expect(detected.confidence).toBe("high");
    expect(detected.evidence).toEqual(expect.arrayContaining([
      { source: "control", label: "Chat surface selected" },
      { source: "control", label: "Work configuration opener" }
    ]));
  });

  it("recognizes an active Work task after the surface radio disappears", () => {
    const detected = detectExperienceFromSnapshot({
      url: "https://chatgpt.com/c/sanitized-task",
      composerLabels: ["Chat with ChatGPT", "Work on anything"],
      mainControls: ["5.5 Light", "Send prompt"],
      mainText: ""
    });

    expect(detected.experience).toBe("work");
    expect(detected.confidence).toBe("high");
    expect(detected.evidence).toEqual(expect.arrayContaining([
      { source: "composer", label: "work on anything" },
      { source: "control", label: "Work configuration opener" }
    ]));
  });

  it("uses the compound Work opener when the task composer exposes only the shared textbox name", () => {
    const detected = detectExperienceFromSnapshot({
      url: "https://chatgpt.com/c/sanitized-task",
      composerLabels: ["Chat with ChatGPT"],
      mainControls: ["5.5 Light", "Send prompt"],
      mainText: ""
    });

    expect(detected.experience).toBe("work");
    expect(detected.confidence).toBe("medium");
    expect(detected.evidence).toContainEqual({
      source: "control",
      label: "Work configuration opener"
    });
  });

  it("opens Work configuration from main when no semantic composer root exists", async () => {
    const page = mainScopedWorkConfigurationPage();

    const result = await inspectConfiguration({ page }, {
      experience: "work",
      includeOptions: false,
      timeoutMs: 100
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      experience: "work",
      availableAxes: ["model", "effort", "speed"],
      active: {
        model: "GPT-5.5",
        effort: "Light",
        speed: "Standard"
      },
      verified: true
    });
    expect(page.configurationOpenCount()).toBe(1);
  });

  it("waits for the configuration opener to hydrate after the composer", async () => {
    const page = mainScopedWorkConfigurationPage(1);

    const result = await inspectConfiguration({ page }, {
      experience: "work",
      includeOptions: false,
      timeoutMs: 1000
    });

    expect(result.ok).toBe(true);
    expect(result.data?.verified).toBe(true);
    expect(result.data?.active).toEqual({
      model: "GPT-5.5",
      effort: "Light",
      speed: "Standard"
    });
    expect(page.configurationOpenCount()).toBe(1);
  });

  it("returns selector drift instead of guessing when no unique surface control exists", async () => {
    const page = surfaceSwitchPage(undefined);

    const result = await openExperience({ page }, { experience: "work", timeoutMs: 100 });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(result.blocker).toMatchObject({
      code: "experience_control_not_found",
      resumable: true
    });
  });

  it("applies and strictly verifies all Work configuration axes sequentially", async () => {
    const page = configurableWorkPage();

    const result = await applyConfiguration({ page }, {
      experience: "work",
      desired: {
        model: "GPT-5.6 Terra",
        effort: "High",
        speed: "Fast"
      },
      timeoutMs: 100
    });

    expect(result.ok).toBe(true);
    expect(result.data?.verified).toBe(true);
    expect(result.data?.selected).toEqual([
      { axis: "model", requested: "GPT-5.6 Terra", selected: "GPT-5.6 Terra" },
      { axis: "effort", requested: "High", selected: "High" },
      { axis: "speed", requested: "Fast", selected: "Fast" }
    ]);
    expect(result.data?.after.active).toEqual({
      model: "GPT-5.6 Terra",
      effort: "High",
      speed: "Fast"
    });
    expect(page.axisClicks()).toEqual([
      "model",
      "effort",
      "speed",
      "model",
      "effort",
      "speed"
    ]);
  });

  it("excludes parent-menu actions from Work axis options", async () => {
    const page = configurableWorkPage();

    const result = await inspectConfiguration({ page }, {
      experience: "work",
      includeOptions: true,
      timeoutMs: 100
    });

    expect(result.ok).toBe(true);
    expect(result.data?.options.model?.map(option => option.label)).toEqual([
      "GPT-5.6 Sol",
      "GPT-5.6 Terra",
      "GPT-5.6 Luna"
    ]);
    expect(result.data?.options.effort?.map(option => option.label)).toEqual([
      "Light",
      "Medium",
      "High",
      "Extra High",
      "Max",
      "Ultra"
    ]);
    expect(result.data?.options.speed?.map(option => option.label)).toEqual([
      "Standard",
      "Fast"
    ]);
  });

  it("does not accept a parent-menu reset action as an effort value", async () => {
    const page = configurableWorkPage();

    const result = await applyConfiguration({ page }, {
      experience: "work",
      desired: { effort: "Reset to default" },
      timeoutMs: 100
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(result.blocker?.code).toBe("configuration_option_not_found");
  });
});

async function readSurfaceFixture(name: string): Promise<TestSurfaceProfileFixture> {
  const path = resolve("contracts/v1/fixtures", name);
  return JSON.parse(await readFile(path, "utf8")) as TestSurfaceProfileFixture;
}

type SurfaceSwitchPage = PageLike & {
  switchClickCount: () => number;
  requestedRoles: () => string[];
};

function surfaceSwitchPage(
  controlRole: "radio" | "button" | undefined,
  delayedControlMisses = 0
): SurfaceSwitchPage {
  let experience: "chat" | "work" = "chat";
  let switchClicks = 0;
  let controlChecks = 0;
  const requestedRoles: string[] = [];
  const missing: LocatorLike = {
    count: async () => 0,
    click: async () => {}
  };
  const workControl: LocatorLike = {
    count: async () => {
      controlChecks += 1;
      return controlChecks <= delayedControlMisses ? 0 : 1;
    },
    click: async () => {
      switchClicks += 1;
      experience = "work";
    }
  };

  return {
    switchClickCount: () => switchClicks,
    requestedRoles: () => [...requestedRoles],
    url: () => experience === "work" ? "https://chatgpt.com/work" : "https://chatgpt.com/",
    title: async () => "ChatGPT",
    getByRole: (role, options = {}) => {
      if (options.name === "Work") requestedRoles.push(role);
      return role === controlRole && options.name === "Work" ? workControl : missing;
    },
    evaluate: async <T, A = unknown>(
      fn: (arg: A) => T | Promise<T>,
      _arg?: A
    ): Promise<T> => {
      const source = String(fn);
      if (source.includes("composerRoots") && source.includes("mainControls")) {
        return (experience === "work"
          ? {
              composerLabels: ["Work on anything"],
              mainControls: ["5.6 Sol Light"],
              mainText: "Work on something else"
            }
          : {
              composerLabels: ["Ask ChatGPT"],
              mainControls: ["Pro"],
              mainText: "Where should we begin?"
            }) as T;
      }
      throw new Error(`Unexpected evaluate call: ${source}`);
    },
    waitForTimeout: async () => {}
  };
}

type ActiveWorkTaskSwitchPage = PageLike & {
  homeNavigationCount: () => number;
  switchClickCount: () => number;
};

function activeWorkTaskSwitchPage(failNavigation = false): ActiveWorkTaskSwitchPage {
  let atHome = false;
  let experience: "chat" | "work" = "work";
  let homeNavigations = 0;
  let switchClicks = 0;
  const missing: LocatorLike = {
    count: async () => 0,
    click: async () => {}
  };
  const chatRadio: LocatorLike = {
    count: async () => atHome ? 1 : 0,
    click: async () => {
      switchClicks += 1;
      experience = "chat";
    }
  };

  return {
    homeNavigationCount: () => homeNavigations,
    switchClickCount: () => switchClicks,
    url: () => atHome ? "https://chatgpt.com/" : "https://chatgpt.com/c/sanitized-task",
    goto: async url => {
      expect(url).toBe("https://chatgpt.com/");
      homeNavigations += 1;
      if (failNavigation) throw new Error("Surface-home navigation failed");
      atHome = true;
    },
    title: async () => "ChatGPT",
    getByRole: (role, options = {}) =>
      role === "radio" && options.name === "Chat" ? chatRadio : missing,
    evaluate: async <T, A = unknown>(
      fn: (arg: A) => T | Promise<T>,
      _arg?: A
    ): Promise<T> => {
      const source = String(fn);
      if (source.includes("composerRoots") && source.includes("mainControls")) {
        if (experience === "chat") {
          return {
            composerLabels: ["Ask ChatGPT"],
            mainControls: ["Pro"],
            mainText: "Where should we begin?",
            selectedSurfaceLabels: ["Chat"]
          } as T;
        }
        return {
          composerLabels: ["Chat with ChatGPT"],
          mainControls: ["5.5 Light"],
          mainText: "",
          selectedSurfaceLabels: atHome ? ["Work"] : []
        } as T;
      }
      throw new Error(`Unexpected evaluate call: ${source}`);
    },
    waitForTimeout: async () => {}
  };
}

type MainScopedWorkConfigurationPage = PageLike & {
  configurationOpenCount: () => number;
};

function mainScopedWorkConfigurationPage(delayedPanelReads = 0): MainScopedWorkConfigurationPage {
  let configurationOpen = false;
  let configurationOpenCount = 0;
  let panelReads = 0;
  const opener: LocatorLike = {
    count: async () => 1,
    click: async () => {
      configurationOpen = true;
      configurationOpenCount += 1;
    }
  };
  const missing: LocatorLike = {
    count: async () => 0,
    click: async () => {}
  };

  return {
    configurationOpenCount: () => configurationOpenCount,
    url: () => "https://chatgpt.com/",
    title: async () => "ChatGPT",
    getByRole: (role, options = {}) =>
      role === "button" && options.name === "5.5 Light" ? opener : missing,
    evaluate: async <T, A = unknown>(
      fn: (arg: A) => T | Promise<T>,
      _arg?: A
    ): Promise<T> => {
      const source = String(fn);
      if (source.includes("composerRoots") && source.includes("mainControls")) {
        return {
          composerLabels: ["Chat with ChatGPT"],
          mainControls: ["5.5 Light"],
          mainText: "",
          selectedSurfaceLabels: ["Work"]
        } as T;
      }
      if (source.includes("normalizedAxes") && source.includes("axisRows")) {
        panelReads += 1;
        if (!source.includes("document.querySelector(\"main\")")) {
          throw new Error("Configuration opener discovery did not include main.");
        }
        if (!configurationOpen && panelReads <= delayedPanelReads) {
          return {
            axisRows: [],
            advancedVisible: false
          } as T;
        }
        return (configurationOpen
          ? {
              openerLabel: "5.5 Light",
              axisRows: [
                { axis: "model", label: "Model GPT-5.5", value: "GPT-5.5" },
                { axis: "effort", label: "Effort Light", value: "Light" },
                { axis: "speed", label: "Speed Standard", value: "Standard" }
              ],
              advancedVisible: true
            }
          : {
              openerLabel: "5.5 Light",
              axisRows: [],
              advancedVisible: false
            }) as T;
      }
      if (source.includes("allRoleNodes") && source.includes("scopedRoleNodes")) {
        const items = configurationOpen
          ? [
              { label: "Model GPT-5.5", role: "menuitem" },
              { label: "Effort Light", role: "menuitem" },
              { label: "Speed Standard", role: "menuitem" }
            ]
          : [];
        return { items, labels: [], split: false } as T;
      }
      if (source.includes("matches.length !== 1") && source.includes("model-switcher")) {
        return false as T;
      }
      throw new Error(`Unexpected evaluate call: ${source}`);
    },
    waitForTimeout: async () => {}
  };
}

type ConfigurableWorkPage = PageLike & {
  axisClicks: () => ConfigurationAxis[];
};

function configurableWorkPage(): ConfigurableWorkPage {
  const values: Record<"model" | "effort" | "speed", string> = {
    model: "GPT-5.6 Sol",
    effort: "Light",
    speed: "Standard"
  };
  const options: Record<"model" | "effort" | "speed", string[]> = {
    model: ["GPT-5.6 Sol", "GPT-5.6 Terra", "GPT-5.6 Luna"],
    effort: ["Light", "Medium", "High", "Extra High", "Max", "Ultra"],
    speed: ["Standard", "Fast"]
  };
  const clicks: ConfigurationAxis[] = [];
  let openAxis: "model" | "effort" | "speed" | undefined;

  const missing: LocatorLike = {
    count: async () => 0,
    click: async () => {}
  };
  const axisLocator = (axis: "model" | "effort" | "speed"): LocatorLike => ({
    count: async () => 1,
    click: async () => {
      openAxis = axis;
      clicks.push(axis);
    }
  });
  const optionLocator = (label: string): LocatorLike => ({
    count: async () => openAxis !== undefined && options[openAxis].includes(label) ? 1 : 0,
    click: async () => {
      if (openAxis === undefined || !options[openAxis].includes(label)) return;
      values[openAxis] = label;
      openAxis = undefined;
    }
  });

  return {
    axisClicks: () => [...clicks],
    url: () => "https://chatgpt.com/work",
    title: async () => "ChatGPT Work",
    getByRole: (role, roleOptions = {}) => {
      const wanted = roleOptions.name;
      if ((role === "button" || role === "menuitem") && wanted instanceof RegExp) {
        for (const axis of ["model", "effort", "speed"] as const) {
          if (wanted.test(`${axis[0]!.toUpperCase()}${axis.slice(1)} ${values[axis]}`)) {
            return axisLocator(axis);
          }
        }
      }
      if (role === "menuitemradio" && typeof wanted === "string") {
        return optionLocator(wanted);
      }
      return missing;
    },
    keyboard: {
      press: async key => {
        if (key === "Escape") openAxis = undefined;
      }
    },
    evaluate: async <T, A = unknown>(
      fn: (arg: A) => T | Promise<T>,
      _arg?: A
    ): Promise<T> => {
      const source = String(fn);
      if (source.includes("composerRoots") && source.includes("mainControls")) {
        return {
          composerLabels: ["Work on anything"],
          mainControls: [
            `Model ${values.model}`,
            `Effort ${values.effort}`,
            `Speed ${values.speed}`,
            "Advanced"
          ],
          mainText: "Work on something else"
        } as T;
      }
      if (source.includes("normalizedAxes") && source.includes("axisRows")) {
        return {
          openerLabel: `${values.model} ${values.effort}`,
          axisRows: [
            { axis: "model", label: `Model ${values.model}`, value: values.model },
            { axis: "effort", label: `Effort ${values.effort}`, value: values.effort },
            { axis: "speed", label: `Speed ${values.speed}`, value: values.speed }
          ],
          advancedVisible: true
        } as T;
      }
      if (source.includes("allRoleNodes") && source.includes("scopedRoleNodes")) {
        const items = openAxis === undefined
          ? [
              { label: "Reset to default", role: "menuitem" },
              ...(["model", "effort", "speed"] as const).map(axis => ({
                label: `${axis[0]!.toUpperCase()}${axis.slice(1)} ${values[axis]}`,
                role: "menuitem",
                hasPopup: true
              }))
            ]
          : [
              { label: "Reset to default", role: "menuitem" },
              ...options[openAxis].map(label => ({
                label,
                role: "menuitemradio",
                checked: values[openAxis!] === label
              }))
            ];
        return { items, labels: [], split: false } as T;
      }
      throw new Error(`Unexpected evaluate call: ${source}`);
    },
    waitForTimeout: async () => {}
  };
}
