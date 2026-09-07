import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configurationInspectionFromSurface,
  configurationMatchesSelection,
  configurationInspectionFromPopover
} from "../../src/commands/configuration.js";
import type { MenuItem } from "../../src/dom/menus.js";

import { inspectChatPopover, readChatPopover, selectChatPopoverEffort, selectChatPopoverModel, selectChatPopoverSpeed } from "../../src/commands/chat-popover.js";
import { DomNode, element } from "../helpers/dom-tree.js";
import type { PageLike, LocatorLike } from "../../src/types.js";
import { discoverPowerSlider } from "../../src/commands/power-discovery.js";

const item = (label: string, rest: Partial<MenuItem> = {}): MenuItem => ({
  label, normalized: label.toLowerCase(), ...rest
});

describe("Chat model and effort configuration classification", () => {
  it("keeps the axis name separate from the active value and uniquely checked model", () => {
    const result = configurationInspectionFromSurface("chat", "chat_simplified_v1", [], {
      openerLabel: "Thinking effort", openerValue: "Medium", axisRows: [], advancedVisible: false
    }, [
      item("Medium", { role: "menuitem", ariaLabel: "Select model" }),
      item("Latest", { role: "menuitemradio", checked: false }),
      item("GPT-5.6 Sol", { role: "menuitemradio", checked: true }),
      item("GPT-5.5", { role: "menuitemradio", checked: false })
    ]);
    expect(result.active).toEqual({ effort: "Medium", modelVersion: "GPT-5.6 Sol" });
    expect(result.options.effort).toBeUndefined();
    expect(result.options.modelVersion?.map(row => row.label)).toEqual(["Latest", "GPT-5.6 Sol", "GPT-5.5"]);
    expect(configurationMatchesSelection(result, { modelVersion: "GPT-5.6 Sol", effort: "Medium" })).toBe(true);
    expect(configurationMatchesSelection(result, { modelVersion: "GPT-5.6 Sol", effort: "High" })).toBe(false);
  });

  it("does not affirm an active value from an axis name or ambiguous checked models", () => {
    const result = configurationInspectionFromSurface("chat", "chat_simplified_v1", [], {
      openerLabel: "Thinking effort", axisRows: [], advancedVisible: false
    }, [
      item("Latest", { role: "menuitemradio", checked: true }),
      item("GPT-5.6 Sol", { role: "menuitemradio", checked: true }),
      item("Advanced", { role: "menuitem", hasPopup: true })
    ]);
    expect(result.active).toEqual({});
    expect(configurationMatchesSelection(result, { effort: "Thinking effort" })).toBe(false);
    expect(result.options.modelVersion?.map(row => row.label)).toEqual(["Latest", "GPT-5.6 Sol"]);
  });

  it("recognizes checked Latest as a concrete model-version choice", () => {
    const result = configurationInspectionFromSurface("chat", "chat_simplified_v1", [], {
      openerValue: "High", axisRows: [], advancedVisible: false
    }, [item("Latest", { role: "menuitemradio", checked: true })]);
    expect(result.active.modelVersion).toBe("Latest");
    expect(configurationMatchesSelection(result, { modelVersion: "Latest" })).toBe(true);
  });
});


function popoverDom(labels = ["Low", "Medium", "High"], work = false) {
  const slider = element("span", { role: "slider", "aria-hidden": "true", "aria-valuemin": "0", "aria-valuemax": String(labels.length - 1), "aria-valuenow": "1" });
  const description = element("span", { id: "power-value" });
  const power = element("div", { role: "menuitem", "aria-label": "Power", "aria-describedby": "power-value" },
    element("div", { "data-model-reasoning-effort-slider": "" }, slider), description);
  const simple = element("div", { "data-testid": "composer-model-picker-slider-simple-view" }, power);
  const radios = (work ? ["Default", "GPT-6 Astra", "GPT-5.6 Sol", "GPT-5.6 Terra", "GPT-5.6 Luna", "GPT-5.5"] : ["Latest", "GPT-5.6 Sol", "GPT-5.5"]).map((label, index) => element("div", {
    role: "menuitemradio", "aria-checked": String(index === (work ? 2 : 0))
  }, ...(work ? [element("div", { class: "min-w-0" }, element("div", { class: "truncate" }, label), ...(index === 0 ? [element("span", {}, "Recommended set of models")] : []))] : [label])));
  const advanced = element("div", { "data-testid": "composer-model-picker-slider-advanced-view" }, ...radios);
  const toggle = element("div", { role: "menuitem", "aria-label": "Select model", "data-interactive": "true" }, "Medium");
  const speed = element("div", { role: "menuitemcheckbox", "aria-label": "Enable fast mode", "aria-checked": "false", "data-fast-mode-enabled": "false", "data-visible": "true" });
  const owner = element("div", { "data-has-slider": "true", "data-has-advanced-view": "true", "data-model-selection-view": "true" }, toggle, ...(work ? [speed] : []), simple, advanced);
  const root = element("div", { "data-testid": "composer-intelligence-picker-content" }, owner);
  const menu = element("div", { role: "menu", "data-state": "open", "aria-labelledby": "menu-trigger" }, root);
  const trigger = element("button", { id: "menu-trigger" }, "Thinking effort");
  const document = new DomNode("#document", {}, [trigger, menu]);
  let reopens = 0;
  let toggles = 0;
  let modelClicks = 0;
  let speedClicks = 0;
  const presses: string[] = [];
  const setView = (view: "simple" | "advanced") => {
    owner.attributes["data-view"] = view;
    toggle.attributes["aria-expanded"] = String(view === "advanced");
    speed.attributes["data-visible"] = String(view === "simple");
    speed.attributes["aria-hidden"] = String(view === "advanced");
    toggle.attributes["aria-hidden"] = String(view === "advanced");
    if (view === "advanced") toggle.attributes.inert = "";
    else delete toggle.attributes.inert;
    for (const [node, active] of [[simple, view === "simple"], [advanced, view === "advanced"]] as const) {
      node.attributes["data-active"] = String(active);
      if (active) delete node.attributes.inert;
      else node.attributes.inert = "";
    }
  };
  const setLevel = (level: number) => {
    slider.attributes["aria-valuenow"] = String(level);
    description.firstChild = null;
    description.append(`${labels[level]}, ${level + 1} of ${labels.length}.`);
  };
  Object.assign(toggle, { click: () => { toggles += 1; setView(owner.attributes["data-view"] === "simple" ? "advanced" : "simple"); } });
  radios.forEach(radio => Object.assign(radio, { click: () => {
    modelClicks += 1;
    radios.forEach(row => { row.attributes["aria-checked"] = String(row === radio); });
    setView("simple");
  } }));
  document.querySelectorAll = selector => {
    expect(selector).toBe('[data-testid="composer-intelligence-picker-content"]');
    return [root];
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { getComputedStyle: (node: DomNode) => node.style });
  const page: PageLike = {
    evaluate: async (fn, arg) => fn(arg as never),
    waitForTimeout: async () => {},
    locator: selector => {
      if (selector === '[role="menu"][aria-labelledby="menu-trigger"]') return { count: async () => 1, press: async key => { expect(key).toBe("Escape"); menu.attributes["data-state"] = "closed"; } };
      if (selector === '[id="menu-trigger"]') return { count: async () => 1, evaluate: async fn => fn(trigger as unknown as Element), click: async () => { reopens += 1; menu.attributes["data-state"] = "open"; setView("simple"); } };
      expect(selector).toBe('[data-testid="composer-intelligence-picker-content"]');
      const rootLocator: LocatorLike = { count: async () => 1, nth: index => { expect(index).toBe(0); return rootLocator; }, locator: scoped => {
        if (scoped === '[role="menuitemcheckbox"][data-fast-mode-enabled]') {
          const speedLocator: LocatorLike = { count: async () => work ? 1 : 0, nth: () => speedLocator,
            evaluate: async fn => fn(speed as unknown as Element), click: async () => {
              speedClicks += 1;
              const checked = speed.attributes["aria-checked"] !== "true";
              speed.attributes["aria-checked"] = String(checked); speed.attributes["data-fast-mode-enabled"] = String(checked);
            } };
          return speedLocator;
        }
        if (scoped === '[role="menuitem"][data-interactive="true"]'
          || scoped === '[data-testid="composer-model-picker-slider-advanced-view"][data-active="true"] [role="menuitemradio"]') {
          const controls = scoped.startsWith('[role="menuitem"]') ? [toggle] : radios;
          const controlLocator = (index?: number): LocatorLike => ({
            count: async () => index === undefined ? controls.length : Number(controls[index] !== undefined),
            nth: index => controlLocator(index),
            evaluate: async fn => fn(controls[index ?? 0] as unknown as Element),
            click: async () => { (controls[index ?? 0] as DomNode & { click: () => void }).click(); }
          });
          return controlLocator();
        }
        expect(scoped).toBe('[data-testid="composer-model-picker-slider-simple-view"][data-active="true"] [role="slider"]');
        const collect = (node: DomNode): DomNode[] => {
          const found = node.getAttribute("role") === "slider" ? [node] : [];
          let child = node.firstChild;
          while (child !== null) { found.push(...collect(child)); child = child.nextSibling; }
          return found;
        };
        const makeLocator = (index?: number): LocatorLike => ({
          count: async () => index === undefined ? collect(simple).length : Number(collect(simple)[index] !== undefined),
          nth: index => makeLocator(index),
          evaluate: async fn => fn(collect(simple)[index ?? 0] as unknown as Element),
          press: async key => {
            expect(collect(simple)[index ?? 0]).toBe(slider);
            presses.push(key);
            const current = Number(slider.attributes["aria-valuenow"]);
            setLevel(current + (key === "ArrowRight" ? 1 : -1));
          }
        });
        return makeLocator();
      } };
      return rootLocator;
    }
  };
  setView("simple");
  setLevel(1);
  return { page, document, menu, root, owner, simple, advanced, toggle, slider, power, radios, speed, description, setView, setLevel,
    presses, speedClicks: () => speedClicks, toggles: () => toggles, modelClicks: () => modelClicks, reopens: () => reopens };
}

afterEach(() => vi.unstubAllGlobals());

describe("rendered composer popover production DOM callbacks", () => {
  it.each([
    ["three", ["Low", "Medium", "High"]],
    ["five", ["Low", "Medium", "High", "Max", "Ultra"]]
  ])("reads the %s-position rendered aria-hidden slider but excludes mounted inert model radios", async (_name, labels) => {
    const fixture = popoverDom(labels as string[]);
    const read = await readChatPopover(fixture.page);
    expect(read.snapshot).toMatchObject({ view: "simple", effort: "Medium", modelOptions: [],
      slider: { minimum: 0, maximum: labels.length - 1, current: 1 } });
    expect(read.snapshot?.activeModel).toBeUndefined();
    const inspection = await inspectChatPopover(fixture.page);
    expect(inspection).toMatchObject({ view: "simple", effort: "Medium", activeModel: "Latest" });
    expect(inspection?.modelOptions.map(row => row.label)).toEqual(["Latest", "GPT-5.6 Sol", "GPT-5.5"]);
    expect(fixture.toggles()).toBe(1);
    expect(fixture.reopens()).toBe(1);
    expect(fixture.modelClicks()).toBe(0);
    expect(fixture.presses).toEqual([]);
    expect(fixture.owner.attributes["data-view"]).toBe("simple");
  });

  it("reopens an actionable Work trigger beneath a pointer-events:none layout ancestor", async () => {
    const fixture = popoverDom(["Light", "Medium", "High", "Max", "Ultra", "Pro"], true);
    const trigger = fixture.document.firstChild!;
    trigger.nextSibling = null;
    Object.assign(trigger.style, { pointerEvents: "auto" });
    const layout = element("div", { id: "thread-bottom" }, trigger);
    Object.assign(layout.style, { pointerEvents: "none" });
    layout.parentNode = fixture.document;
    layout.nextSibling = fixture.menu;
    fixture.document.firstChild = layout;
    const observed = await inspectChatPopover(fixture.page);
    expect(observed?.activeModel).toBe("GPT-5.6 Sol");
    expect(fixture.reopens()).toBe(1);
    expect(fixture.owner.attributes["data-view"]).toBe("simple");
  });

  it("never reopens a trigger whose own computed pointer-events remains none", async () => {
    const fixture = popoverDom();
    Object.assign(fixture.document.firstChild!.style, { pointerEvents: "none" });
    expect(await inspectChatPopover(fixture.page)).toBeUndefined();
    expect(fixture.reopens()).toBe(0);
    expect(fixture.modelClicks()).toBe(0);
  });

  it("fails closed when the trigger ancestor visibility walk exceeds its bound", async () => {
    const fixture = popoverDom();
    const trigger = fixture.document.firstChild!;
    trigger.nextSibling = null;
    let nested = trigger;
    for (let depth = 0; depth < 65; depth += 1) nested = element("div", {}, nested);
    nested.attributes.inert = "";
    nested.parentNode = fixture.document;
    nested.nextSibling = fixture.menu;
    fixture.document.firstChild = nested;
    expect(await inspectChatPopover(fixture.page)).toBeUndefined();
    expect(fixture.reopens()).toBe(0);
    expect(fixture.modelClicks()).toBe(0);
  });

  it("waits for a closing modal's trigger lock to clear before reopening", async () => {
    const fixture = popoverDom();
    const original = fixture.page.locator!;
    let preflights = 0;
    fixture.page.locator = selector => {
      const target = original(selector);
      if (selector === '[id="menu-trigger"]') {
        const evaluate = target.evaluate!;
        target.evaluate = fn => evaluate(element => {
          preflights += 1;
          const node = element as unknown as DomNode;
          Object.assign(node.style, { pointerEvents: preflights < 3 ? "none" : "auto" });
          return fn(element);
        });
      }
      return target;
    };
    const observed = await inspectChatPopover(fixture.page);
    expect(observed?.activeModel).toBe("Latest");
    expect(preflights).toBe(3);
    expect(fixture.reopens()).toBe(1);
    expect(fixture.owner.attributes["data-view"]).toBe("simple");
  });

  it("fails inspection closed when the initial presentation cannot be restored", async () => {
    const fixture = popoverDom();
    const locator = fixture.page.locator!;
    fixture.page.locator = selector => selector === '[role="menu"][aria-labelledby="menu-trigger"]'
      ? { count: async () => 1 } : locator(selector);
    expect(await inspectChatPopover(fixture.page)).toBeUndefined();
    expect(fixture.owner.attributes["data-view"]).toBe("advanced");
    expect(fixture.modelClicks()).toBe(0);
    expect(fixture.presses).toEqual([]);
  });

  it("restores an initially advanced menu and verifies a selection that returns to simple", async () => {
    const fixture = popoverDom();
    fixture.setView("advanced");
    expect(await selectChatPopoverModel(fixture.page, ["GPT-5.6 Sol"])).toBe("GPT-5.6 Sol");
    expect(fixture.modelClicks()).toBe(1);
    expect(fixture.owner.attributes["data-view"]).toBe("advanced");
    expect((await inspectChatPopover(fixture.page))?.activeModel).toBe("GPT-5.6 Sol");
    expect(fixture.owner.attributes["data-view"]).toBe("advanced");
  });

  it.each(["inert", "aria-hidden", "data-active", "aria-disabled", "data-locked"])("rejects a slider behind a %s ancestor", async attribute => {
    const fixture = popoverDom();
    fixture.power.attributes[attribute] = attribute === "data-active" ? "false" : "true";
    expect((await readChatPopover(fixture.page)).snapshot?.slider).toBeUndefined();
    expect(await selectChatPopoverEffort(fixture.page, ["High"])).toBeUndefined();
    expect(fixture.presses).toEqual([]);
  });

  it("requires rendered geometry and ignores a hidden stale duplicate", async () => {
    const fixture = popoverDom();
    const stale = element("span", { role: "slider", "aria-hidden": "true", hidden: "" });
    fixture.power.append(stale);
    expect((await readChatPopover(fixture.page)).snapshot?.effort).toBe("Medium");
    expect(await selectChatPopoverEffort(fixture.page, ["High"])).toBe("High");
    expect(fixture.presses).toEqual(["ArrowLeft", "ArrowRight", "ArrowRight"]);
    fixture.slider.rect = { width: 0, height: 0 };
    expect((await readChatPopover(fixture.page)).snapshot?.slider).toBeUndefined();
  });

  it("does not reconcile an inconsistent ordinal description into a selected effort", async () => {
    const fixture = popoverDom();
    fixture.description.firstChild = null;
    fixture.description.append("High, 3 of 3.");
    expect((await readChatPopover(fixture.page)).snapshot?.effort).toBeUndefined();
    expect(await selectChatPopoverEffort(fixture.page, ["High"])).toBeUndefined();
    expect(fixture.presses).toEqual([]);
  });

  it("searches observed labels, verifies each keyboard step and restores an unavailable target", async () => {
    const fixture = popoverDom();
    expect(await selectChatPopoverEffort(fixture.page, ["High"])).toBe("High");
    expect(fixture.slider.attributes["aria-valuenow"]).toBe("2");
    expect(fixture.presses).toEqual(["ArrowLeft", "ArrowRight", "ArrowRight"]);
    expect(await selectChatPopoverEffort(fixture.page, ["Ultra"])).toBeUndefined();
    expect(fixture.slider.attributes["aria-valuenow"]).toBe("2");
  });

  it("does not perform any mutation for the current effort", async () => {
    const fixture = popoverDom();
    expect(await selectChatPopoverEffort(fixture.page, ["Medium"])).toBe("Medium");
    expect(fixture.presses).toEqual([]);
  });

  it("does not continue after a silent keyboard failure", async () => {
    const fixture = popoverDom();
    const ignored: LocatorLike = { count: async () => 1, evaluate: async fn => fn(fixture.slider as unknown as Element), press: async () => { fixture.presses.push("ignored"); }, nth: () => ignored, locator: () => ignored };
    fixture.page.locator = () => ignored;
    expect(await selectChatPopoverEffort(fixture.page, ["High"])).toBeUndefined();
    expect(fixture.presses).toEqual(["ignored"]);
    expect(fixture.slider.attributes["aria-valuenow"]).toBe("1");
  });

  it("never selects an ambiguous active model or reads options from an inactive view", async () => {
    const fixture = popoverDom();
    fixture.radios[1]!.attributes["aria-checked"] = "true";
    expect((await inspectChatPopover(fixture.page))?.activeModel).toBeUndefined();
    fixture.advanced.attributes.inert = "";
    fixture.owner.attributes["data-view"] = "advanced";
    expect((await readChatPopover(fixture.page)).snapshot).toBeUndefined();
  });
});


describe("Power discovery uses the same rendered Chat slider ownership", () => {
  it.each([3, 5])("reads an aria-hidden %i-position thumb only in the verified active view", async count => {
    const fixture = popoverDom(["Low", "Medium", "High", "Max", "Ultra"].slice(0, count));
    const discovery = await discoverPowerSlider(fixture.page, { powerLabels: ["Power"] });
    expect(discovery).toMatchObject({ ok: true, range: { minimum: 0, maximum: count - 1, current: 1 }, valueText: "Medium" });
    expect(fixture.presses).toEqual([]);
    fixture.setView("advanced");
    expect(await discoverPowerSlider(fixture.page, { powerLabels: ["Power"] })).toMatchObject({ ok: false });
  });

  it("continues rejecting arbitrary aria-hidden controls outside the scoped profile", async () => {
    const fixture = popoverDom();
    delete fixture.owner.attributes["data-model-selection-view"];
    expect(await discoverPowerSlider(fixture.page, { powerLabels: ["Power"] })).toMatchObject({ ok: false, reason: "no_visible_slider" });
  });
});


describe("current Work composer configuration", () => {
  it("reads six-position Power, full model labels and the independent fast checkbox", async () => {
    const fixture = popoverDom(["Light", "Medium", "High", "Max", "Ultra", "Pro"], true);
    fixture.setLevel(0);
    const observed = await inspectChatPopover(fixture.page);
    expect(observed).toMatchObject({ effort: "Light", activeModel: "GPT-5.6 Sol", speed: "Standard", slider: { minimum: 0, maximum: 5, current: 0 } });
    const data = configurationInspectionFromPopover("work", [], observed);
    expect(data).toMatchObject({ selectorProfile: "work_basic_v1", verified: true, active: { model: "GPT-5.6 Sol", effort: "Light", speed: "Standard" } });
    expect(data.availableAxes).toEqual(["effort", "model", "speed"]);
    expect(data.options.model?.map(option => option.label)).toEqual(["Default", "GPT-6 Astra", "GPT-5.6 Sol", "GPT-5.6 Terra", "GPT-5.6 Luna", "GPT-5.5"]);
    expect(data.active.modelVersion).toBeUndefined();
    expect(fixture.presses).toEqual([]);
    expect(fixture.modelClicks()).toBe(0);
  });

  it("selects Default without its description, sixth-position effort and Fast independently", async () => {
    const fixture = popoverDom(["Light", "Medium", "High", "Max", "Ultra", "Pro"], true);
    expect(await selectChatPopoverModel(fixture.page, ["Default"])).toBe("Default");
    expect(await selectChatPopoverEffort(fixture.page, ["Pro"])).toBe("Pro");
    expect(await selectChatPopoverSpeed(fixture.page, ["Fast"])).toBe("Fast");
    const data = configurationInspectionFromPopover("work", [], await inspectChatPopover(fixture.page));
    expect(data.active).toEqual({ model: "Default", effort: "Pro", speed: "Fast" });
    expect(await selectChatPopoverSpeed(fixture.page, ["Standard"])).toBe("Standard");
    expect(fixture.owner.attributes["data-view"]).toBe("simple");
  });

  it("does not invent a speed axis when the checkbox is unavailable or inconsistent", async () => {
    const fixture = popoverDom(["Light", "Medium", "High", "Max", "Ultra", "Pro"], true);
    fixture.speed.attributes["data-fast-mode-enabled"] = "true";
    const observed = await inspectChatPopover(fixture.page);
    expect(observed?.speed).toBeUndefined();
    expect(configurationInspectionFromPopover("work", [], observed).availableAxes).toEqual(["effort", "model"]);
    expect(await selectChatPopoverSpeed(fixture.page, ["Fast"])).toBeUndefined();
  });

  it.each(["locked", "closed"])("does not click Fast when ownership becomes %s after observation", async kind => {
    const fixture = popoverDom(["Light", "Medium", "High", "Max", "Ultra", "Pro"], true);
    const original = fixture.page.locator!;
    fixture.page.locator = selector => {
      const root = original(selector);
      const scoped = root.locator;
      if (scoped !== undefined) root.locator = query => {
        const controls = scoped(query);
        if (query === '[role="menuitemcheckbox"][data-fast-mode-enabled]') {
          const nth = controls.nth!;
          controls.nth = index => {
            const target = nth(index), evaluate = target.evaluate!;
            target.evaluate = fn => {
              if (kind === "locked") fixture.speed.attributes["data-locked"] = "true";
              else fixture.menu.attributes["data-state"] = "closed";
              return evaluate(fn);
            };
            return target;
          };
        }
        return controls;
      };
      return root;
    };
    expect(await selectChatPopoverSpeed(fixture.page, ["Fast"])).toBeUndefined();
    expect(fixture.speedClicks()).toBe(0);
  });

  it("keeps legacy Work Advanced model, effort and speed rows unchanged", () => {
    const data = configurationInspectionFromSurface("work", "work_advanced_v1", [], { advancedVisible: true,
      axisRows: [{ axis: "model", label: "Model GPT-5.5", value: "GPT-5.5" }, { axis: "effort", label: "Effort High", value: "High" }, { axis: "speed", label: "Speed Fast", value: "Fast" }] }, []);
    expect(data).toMatchObject({ verified: true, selectorProfile: "work_advanced_v1", active: { model: "GPT-5.5", effort: "High", speed: "Fast" } });
  });
});
