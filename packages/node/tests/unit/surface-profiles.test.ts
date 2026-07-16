import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyConfiguration,
  configurationMatchesSelection,
  configurationInspectionFromSurface,
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
    const page = surfaceSwitchPage(true);

    const result = await openExperience({ page }, { experience: "work", timeoutMs: 100 });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      experience: "work",
      previousExperience: "chat",
      changed: true,
      selectorProfile: "work_basic_v1"
    });
    expect(page.switchClickCount()).toBe(1);
  });

  it("returns selector drift instead of guessing when no unique surface control exists", async () => {
    const page = surfaceSwitchPage(false);

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
});

async function readSurfaceFixture(name: string): Promise<TestSurfaceProfileFixture> {
  const path = resolve("contracts/v1/fixtures", name);
  return JSON.parse(await readFile(path, "utf8")) as TestSurfaceProfileFixture;
}

type SurfaceSwitchPage = PageLike & {
  switchClickCount: () => number;
};

function surfaceSwitchPage(hasWorkControl: boolean): SurfaceSwitchPage {
  let experience: "chat" | "work" = "chat";
  let switchClicks = 0;
  const missing: LocatorLike = {
    count: async () => 0,
    click: async () => {}
  };
  const workControl: LocatorLike = {
    count: async () => hasWorkControl ? 1 : 0,
    click: async () => {
      switchClicks += 1;
      experience = "work";
    }
  };

  return {
    switchClickCount: () => switchClicks,
    url: () => experience === "work" ? "https://chatgpt.com/work" : "https://chatgpt.com/",
    title: async () => "ChatGPT",
    getByRole: (_role, options = {}) =>
      options.name === "Work" ? workControl : missing,
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
          ? (["model", "effort", "speed"] as const).map(axis => ({
              label: `${axis[0]!.toUpperCase()}${axis.slice(1)} ${values[axis]}`,
              role: "menuitem"
            }))
          : options[openAxis].map(label => ({
              label,
              role: "menuitemradio",
              checked: values[openAxis!] === label
            }));
        return { items, labels: [], split: false } as T;
      }
      throw new Error(`Unexpected evaluate call: ${source}`);
    },
    waitForTimeout: async () => {}
  };
}
