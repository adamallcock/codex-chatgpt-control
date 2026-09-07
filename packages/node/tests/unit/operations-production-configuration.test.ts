import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { LocatorLike, PageLike } from "../../src/types.js";
import type { OperationTargetBindingV1 } from "../../src/operations/types.js";
import type { OperationStagingCallbackRequest } from "../../src/operations/staging.js";
import {
  createProductionConfigurationStaging,
  type ProductionConfigurationDomSnapshot,
  type ProductionConfigurationPrimitiveOptions
} from "../../src/operations/production-configuration.js";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_DIGEST = `hmac-sha256:${"a".repeat(64)}`;
const TARGET_DIGEST = `hmac-sha256:${"b".repeat(64)}`;
const SECRET = "private-request-label-must-not-escape";

const evidenceDigest = (_domain: string, _material: unknown): string =>
  `hmac-sha256:${"c".repeat(64)}`;

const target: OperationTargetBindingV1 = {
  providerId: "provider",
  browserId: "browser",
  tabId: "tab",
  coordinationScope: "process",
  conversationId: "conversation",
  canonicalThreadUrl: `https://opaque.invalid/thread/${"1".repeat(64)}`,
  evidenceProfile: {
    providerIdentity: "required",
    stableTabId: "required",
    stableConversationId: "required",
    stableUserTurnId: "unavailable",
    authoritativeTabClaim: "unavailable",
    replacementTabRecovery: false
  }
};

function request(
  kind: OperationStagingCallbackRequest["kind"],
  options: Readonly<{ desired?: string; actionId?: string }> = {}
): OperationStagingCallbackRequest {
  return {
    operationId: OPERATION_ID,
    requestDigest: REQUEST_DIGEST,
    targetBindingDigest: TARGET_DIGEST,
    actionId: options.actionId ?? "22222222-2222-4222-8222-222222222222",
    kind,
    desiredStateDigest: evidenceDigest("staging-desired", { requestDigest: REQUEST_DIGEST, kind }),
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 10_000
  };
}

function menuSnapshot(
  controls: ProductionConfigurationDomSnapshot["controls"],
  surface: ProductionConfigurationDomSnapshot["surface"] = "chat"
): ProductionConfigurationDomSnapshot {
  return { surface, controls };
}

function powerObservation(current: number, options: Readonly<{ missingAria?: boolean; sliders?: number }> = {}) {
  const make = (index: number) => ({
    index,
    visible: true,
    ariaLabel: "Power",
    ...(options.missingAria ? {} : { minimum: "0", maximum: "2", current: String(current), step: "1" }),
    menu: { role: "menu", label: "Power", visible: true },
    surface: { experience: "chat" as const, selectorProfile: "chat_simplified_v1" },
    options: [
      { label: "Low", value: "0", visible: true },
      { label: "Medium", value: "1", visible: true },
      { label: "High", value: "2", visible: true }
    ],
    optionSource: "power_menu" as const
  });
  return { sliders: Array.from({ length: options.sliders ?? 1 }, (_, index) => make(index)) };
}

type FakePageOptions = Readonly<{
  menuSnapshots?: ProductionConfigurationDomSnapshot[];
  powerSnapshots?: unknown[];
  onClick?: (label: string) => void;
  onPress?: (key: string) => void;
  throwOnClick?: boolean;
  throwOnPress?: boolean;
}>;

function fakePage(options: FakePageOptions): PageLike & { clicks: () => number; presses: () => number } {
  const menuSnapshots = [...(options.menuSnapshots ?? [])];
  const powerSnapshots = [...(options.powerSnapshots ?? [])];
  let currentMenu = menuSnapshots[0];
  let currentPower = powerSnapshots[0];
  let clicks = 0;
  let presses = 0;
  const page: PageLike = {
    evaluate: async <T, A>(callback: (arg: A) => T | Promise<T>, arg?: A) => {
      // These independent scoped probes execute real callbacks in the new
      // DOM fixture suite. This legacy menu/ARIA-map fixture has no popover.
      if (typeof arg === "object" && arg !== null && (("powerLabels" in arg && !("maxSliders" in arg)) || "chatLabels" in arg)) return undefined as T;
      if (typeof arg === "object" && arg !== null && "maxControls" in arg) {
        expect(callback.toString()).not.toContain("querySelectorAll");
        expect(callback.toString()).not.toContain("Array.from");
        expect(callback.toString()).not.toContain(".matches(");
        expect(callback.toString()).not.toContain(".closest(");
        expect(callback.toString()).not.toContain(".parentElement");
        expect(callback.toString()).not.toContain("main form");
      }
      const value = typeof arg === "object" && arg !== null && "maxControls" in arg
        ? (menuSnapshots.shift() ?? currentMenu)
        : (powerSnapshots.shift() ?? currentPower);
      if (typeof arg === "object" && arg !== null && "maxControls" in arg) currentMenu = value as typeof currentMenu;
      else currentPower = value;
      return value as T;
    },
    getByRole: (role, query) => {
      const label = typeof query?.name === "string" ? query.name : "";
      const count = async () => (currentMenu?.controls ?? []).filter(control =>
        (control.role ?? "button") === role && control.label === label && control.visible !== false
      ).length;
      const locator: LocatorLike = {
        count,
        isVisible: async () => await count() === 1,
        click: async () => {
          clicks += 1;
          if (options.throwOnClick) throw new Error("provider rejection");
          options.onClick?.(label);
        }
      };
      return locator;
    },
    locator: selector => {
      if (!selector.includes("slider")) {
        return {
          count: async () => 0,
          isVisible: async () => false
        };
      }
      const slider: LocatorLike = {
        count: async () => 1,
        nth: () => slider,
        isVisible: async () => true,
        evaluate: async <T>() => {
          const observation = currentPower as { sliders?: Array<{ minimum?: string; maximum?: string; current?: string }> } | undefined;
          const current = observation?.sliders?.[0];
          return {
            minimum: current?.minimum ?? null,
            maximum: current?.maximum ?? null,
            current: current?.current ?? null
          } as T;
        },
        press: async key => {
          presses += 1;
          if (options.throwOnPress) throw new Error("provider rejection");
          options.onPress?.(key);
        }
      };
      return slider;
    }
  };
  return Object.assign(page, { clicks: () => clicks, presses: () => presses });
}

function primitive(
  configuration: NonNullable<ProductionConfigurationPrimitiveOptions["configuration"]>,
  surface: "chat" | "work" = "chat"
) {
  return createProductionConfigurationStaging({
    evidenceDigest,
    operationId: OPERATION_ID,
    requestDigest: REQUEST_DIGEST,
    surface,
    configuration
  });
}

describe("production configuration staging primitive", () => {
  it("accepts descriptor-safe options and configuration from a foreign realm", async () => {
    const foreign = runInNewContext(`({
      operationId: "${OPERATION_ID}",
      requestDigest: "${REQUEST_DIGEST}",
      surface: "chat",
      configuration: { experience: "chat" }
    })`) as ProductionConfigurationPrimitiveOptions;
    Object.defineProperty(foreign, "evidenceDigest", {
      value: evidenceDigest,
      enumerable: true,
      configurable: true
    });
    const staging = createProductionConfigurationStaging(foreign);
    const result = await staging.readCurrent!({
      ...request("configuration_set"),
      page: fakePage({ menuSnapshots: [menuSnapshot([{ label: "New chat", role: "button" }], "chat")] }),
      target
    });

    expect(result.status).toBe("satisfied");
  });

  it("distinguishes a satisfied, mismatched, and uninspectable experience surface", async () => {
    const action = request("configuration_set");
    const visibleControl = [{ label: "New chat", role: "button" }] as const;
    const satisfied = await primitive({ experience: "chat" }).readCurrent!({
      ...action,
      page: fakePage({ menuSnapshots: [menuSnapshot(visibleControl, "chat")] }),
      target
    });
    const mismatched = await primitive({ experience: "chat" }).readCurrent!({
      ...action,
      page: fakePage({ menuSnapshots: [menuSnapshot(visibleControl, "work")] }),
      target
    });
    const unavailable = await primitive({ experience: "chat" }).readCurrent!({
      ...action,
      page: fakePage({ menuSnapshots: [menuSnapshot(visibleControl, "unknown")] }),
      target
    });

    expect(satisfied.status).toBe("satisfied");
    expect(mismatched).toMatchObject({
      status: "unavailable",
      blockerCode: "configuration_surface_unsupported"
    });
    expect(unavailable).toMatchObject({
      status: "unavailable",
      blockerCode: "configuration_surface_unavailable"
    });
  });

  it("uses locale-aware semantic values and one planned click without leaking requested labels", async () => {
    const before = menuSnapshot([
      { label: "Aufwand Mittel", role: "button", id: "effort-row" },
      { label: "Hoch", role: "menuitemradio", menuKey: "menu:0" },
      { label: "Mittel", role: "menuitemradio", menuKey: "menu:0", selected: true }
    ]);
    const after = menuSnapshot([
      { label: "Aufwand Hoch", role: "button", id: "effort-row" },
      { label: "Hoch", role: "menuitemradio", menuKey: "menu:0", selected: true },
      { label: "Mittel", role: "menuitemradio", menuKey: "menu:0" }
    ]);
    const page = fakePage({ menuSnapshots: [before, before, before, after] });
    const staging = primitive({ mode: "High" });
    const result = await staging.readCurrent!({ ...request("configuration_set"), page, target });
    expect(result.status).toBe("not_satisfied");
    expect(JSON.stringify(result)).not.toContain(SECRET);
    await staging.mutateOnce!({ ...request("configuration_set"), page, target });
    const reconciled = await staging.observe!({ ...request("configuration_set"), page, target });
    expect(reconciled.status).toBe("satisfied");
    expect(page.clicks()).toBe(1);
  });

  it("fails closed when the menu is reordered between observation and mutation", async () => {
    const before = menuSnapshot([
      { label: "Effort Medium", role: "button", id: "effort-row" },
      { label: "High", role: "menuitemradio", menuKey: "menu:0" }
    ]);
    const reordered = menuSnapshot([
      { label: "High", role: "menuitemradio", menuKey: "menu:0" },
      { label: "Effort Medium", role: "button", id: "effort-row" }
    ]);
    const page = fakePage({ menuSnapshots: [before, reordered] });
    const staging = primitive({ mode: "High" });
    await staging.readCurrent!({ ...request("configuration_set"), page, target });
    await expect(staging.mutateOnce!({ ...request("configuration_set"), page, target })).rejects.toMatchObject({ code: "configuration_state_drift" });
    expect(page.clicks()).toBe(0);
  });

  it("does not retry an acts-then-throws click and reports the unreconciled obligation", async () => {
    const snapshot = menuSnapshot([
      { label: "Effort Medium", role: "button", id: "effort-row" },
      { label: "High", role: "menuitemradio", menuKey: "menu:0" }
    ]);
    const page = fakePage({ menuSnapshots: [snapshot, snapshot, snapshot], throwOnClick: true });
    const staging = primitive({ mode: "High" });
    await staging.readCurrent!({ ...request("configuration_set"), page, target });
    await expect(staging.mutateOnce!({ ...request("configuration_set"), page, target })).rejects.toMatchObject({ code: "configuration_state_drift" });
    const after = await staging.observe!({ ...request("configuration_set"), page, target });
    expect(after).toMatchObject({ status: "uncertain", blockerCode: "staging_mutation_unreconciled" });
    expect(page.clicks()).toBe(1);
  });

  it("isolates reused operation factories and rejects ambiguous tool state", async () => {
    const first = menuSnapshot([
      { label: "Effort Medium", role: "button", id: "effort-row" },
      { label: "High", role: "menuitemradio", menuKey: "menu:0" }
    ]);
    const second = menuSnapshot([
      { label: "Effort High", role: "button", id: "effort-row" },
      { label: "High", role: "menuitemradio", menuKey: "menu:0", selected: true }
    ]);
    const firstPage = fakePage({ menuSnapshots: [first] });
    const secondPage = fakePage({ menuSnapshots: [second] });
    const firstPrimitive = primitive({ mode: "High" });
    const secondPrimitive = primitive({ mode: SECRET });
    await firstPrimitive.readCurrent!({ ...request("configuration_set"), page: firstPage, target });
    const secondResult = await secondPrimitive.readCurrent!({ ...request("configuration_set"), page: secondPage, target });
    expect(secondResult.status).toBe("not_satisfied");
    expect(JSON.stringify(secondResult)).not.toContain(SECRET);

    const toolPage = fakePage({ menuSnapshots: [menuSnapshot([
      { label: "Web search", role: "menuitem", menuKey: "menu:0" }
    ])] });
    const tool = primitive({ tools: ["web_search"] });
    const toolResult = await tool.readCurrent!({ ...request("tool_set"), page: toolPage, target });
    expect(toolResult).toMatchObject({ status: "unavailable", blockerCode: "tool_state_unavailable" });
  });

  it("captures mutable options once, rejects hostile configuration descriptors, and preserves supported additional axes", async () => {
    const mutableConfiguration: { mode: string } = { mode: "High" };
    const mutableOptions = {
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      surface: "chat" as "chat" | "work",
      configuration: mutableConfiguration
    } satisfies ProductionConfigurationPrimitiveOptions;
    const staging = createProductionConfigurationStaging(mutableOptions);
    mutableConfiguration.mode = SECRET;
    mutableOptions.operationId = SECRET;
    mutableOptions.surface = "work";
    const before = menuSnapshot([
      { label: "Effort Medium", role: "button", id: "effort-row" },
      { label: "High", role: "menuitemradio", menuKey: "menu:0" }
    ]);
    const page = fakePage({ menuSnapshots: [before] });
    const result = await staging.readCurrent!({ ...request("configuration_set"), page, target });
    expect(result.status).toBe("not_satisfied");
    expect(JSON.stringify(result)).not.toContain(SECRET);

    try {
      createProductionConfigurationStaging({
        evidenceDigest,
        operationId: OPERATION_ID,
        requestDigest: REQUEST_DIGEST,
        surface: "chat",
        configuration: { mode: 42 as unknown as string }
      });
      throw new Error("expected malformed configuration to be rejected");
    } catch (error) {
      expect(error).toMatchObject({ code: "configuration_not_configured" });
    }

    const hostile = Object.defineProperty({
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      surface: "chat"
    }, "configuration", { get: () => { throw new Error(SECRET); }, enumerable: true });
    try {
      createProductionConfigurationStaging(hostile as never);
      throw new Error("expected hostile options to be rejected");
    } catch (error) {
      expect(error).toMatchObject({ code: "staging_request_mismatch" });
    }
    const hostileProxy = new Proxy({
      evidenceDigest,
      operationId: OPERATION_ID,
      requestDigest: REQUEST_DIGEST,
      surface: "chat"
    }, {
      getOwnPropertyDescriptor: () => { throw new Error(SECRET); }
    });
    expect(() => createProductionConfigurationStaging(hostileProxy as never)).toThrowError(
      expect.objectContaining({ code: "staging_request_mismatch" })
    );

    const additional = primitive({ additional: { effort: "High", speed: "Fast" } });
    const satisfied = await additional.readCurrent!({
      ...request("configuration_set", { actionId: "55555555-5555-4555-8555-555555555555" }),
      page: fakePage({ menuSnapshots: [menuSnapshot([
        { label: "Effort High", role: "button", id: "effort-row" },
        { label: "Speed Fast", role: "button", id: "speed-row" }
      ])] }),
      target
    });
    expect(satisfied.status).toBe("satisfied");

    expect(() => primitive({ additional: { power: "High" } })).toThrowError(
      expect.objectContaining({ code: "configuration_not_configured" })
    );
    expect(() => primitive({ additional: {} })).toThrowError(
      expect.objectContaining({ code: "configuration_not_configured" })
    );
  });

  it("uses only a structural tool opener, then re-discovers the localized target once", async () => {
    const closed = menuSnapshot([
      { label: "Deep research", role: "button", selected: true, id: "tool-current" },
      { label: "Dateien und mehr hinzufügen", role: "button", id: "composer-plus-btn" }
    ]);
    const open = menuSnapshot([
      { label: "Deep research", role: "menuitemradio", menuKey: "menu:0", selected: true },
      { label: "Websuche", role: "menuitemradio", menuKey: "menu:0" }
    ]);
    const page = fakePage({ menuSnapshots: [closed, closed, closed, open] });
    const tool = primitive({ tools: ["web_search"] });
    const result = await tool.readCurrent!({ ...request("tool_set", { actionId: "66666666-6666-4666-8666-666666666666" }), page, target });
    expect(result.status).toBe("not_satisfied");
    await tool.mutateOnce!({ ...request("tool_set", { actionId: "66666666-6666-4666-8666-666666666666" }), page, target });
    expect(page.clicks()).toBe(2);
  });

  it("re-discovers each distinct configuration step after menus close and rejects ambiguous targets", async () => {
    const closed = menuSnapshot([
      { label: "Configure", role: "button", id: "mode-selector" },
      { label: "Effort Current", role: "button", id: "effort-row" },
      { label: "Speed Slow", role: "button", id: "speed-row" }
    ]);
    const modeOpen = menuSnapshot([
      { label: "High", role: "menuitemradio", menuKey: "menu:0" }
    ]);
    const speedOpen = menuSnapshot([
      { label: "Fast", role: "menuitemradio", menuKey: "menu:1" }
    ]);
    const page = fakePage({ menuSnapshots: [closed, closed, closed, modeOpen, closed, speedOpen] });
    const staging = primitive({ mode: "High", additional: { speed: "Fast" } });
    const action = request("configuration_set", { actionId: "77777777-7777-4777-8777-777777777777" });
    const initial = await staging.readCurrent!({ ...action, page, target });
    expect(initial.status).toBe("not_satisfied");
    await staging.mutateOnce!({ ...action, page, target });
    expect(page.clicks()).toBe(4);

    const ambiguous = menuSnapshot([
      { label: "Configure", role: "button", id: "mode-selector" },
      { label: "Effort Current", role: "button", id: "effort-row" },
      { label: "High", role: "menuitemradio", menuKey: "menu:0" },
      { label: "High", role: "menuitemradio", menuKey: "menu:1" }
    ]);
    const ambiguousPage = fakePage({ menuSnapshots: [ambiguous, ambiguous] });
    const ambiguousStaging = primitive({ mode: "High" });
    const ambiguousAction = request("configuration_set", { actionId: "88888888-8888-4888-8888-888888888888" });
    await ambiguousStaging.readCurrent!({ ...ambiguousAction, page: ambiguousPage, target });
    await expect(ambiguousStaging.mutateOnce!({ ...ambiguousAction, page: ambiguousPage, target }))
      .rejects.toMatchObject({ code: "configuration_control_ambiguous" });
    expect(ambiguousPage.clicks()).toBe(0);
  });

  it("requires a complete, unique ARIA Power mapping and bounds arrow traversal", async () => {
    const powerPage = fakePage({
      powerSnapshots: [powerObservation(0), powerObservation(0), powerObservation(2)]
    });
    const staging = primitive({ reasoning: "High" });
    const initial = await staging.readCurrent!({ ...request("power_select"), page: powerPage, target });
    expect(initial.status).toBe("not_satisfied");
    await staging.mutateOnce!({ ...request("power_select"), page: powerPage, target });
    const final = await staging.observe!({ ...request("power_select"), page: powerPage, target });
    expect(final.status).toBe("satisfied");
    expect(powerPage.presses()).toBe(2);

    const missingAria = fakePage({ powerSnapshots: [powerObservation(0, { missingAria: true })] });
    const missingResult = await staging.readCurrent!({ ...request("power_select", { actionId: "33333333-3333-4333-8333-333333333333" }), page: missingAria, target });
    expect(missingResult).toMatchObject({ status: "unavailable", blockerCode: "power_mapping_incomplete" });

    const multiple = fakePage({ powerSnapshots: [powerObservation(0, { sliders: 2 })] });
    const multipleResult = await staging.readCurrent!({ ...request("power_select", { actionId: "44444444-4444-4444-8444-444444444444" }), page: multiple, target });
    expect(multipleResult.status).toBe("unavailable");
    expect(multiple.presses()).toBe(0);
  });

  it("returns an explicit Power restoration obligation after an uncertain keypress", async () => {
    const page = fakePage({
      powerSnapshots: [powerObservation(0), powerObservation(0), powerObservation(0)],
      throwOnPress: true
    });
    const staging = primitive({ reasoning: "High" });
    await staging.readCurrent!({ ...request("power_select"), page, target });
    await expect(staging.mutateOnce!({ ...request("power_select"), page, target })).rejects.toMatchObject({ code: "power_state_drift" });
    const after = await staging.observe!({ ...request("power_select"), page, target });
    expect(after).toMatchObject({ status: "uncertain", blockerCode: "power_restoration_required" });
    expect(page.presses()).toBe(1);
  });

  it("rejects non-exact or unbounded provider snapshots without browser mutation", async () => {
    const extraFieldPage = fakePage({
      menuSnapshots: [{
        ...menuSnapshot([{ label: "Effort Medium", role: "button" }]),
        providerPrivate: SECRET
      } as ProductionConfigurationDomSnapshot]
    });
    const staging = primitive({ mode: "High" });
    const extra = await staging.readCurrent!({
      ...request("configuration_set", { actionId: "99999999-9999-4999-8999-999999999998" }),
      page: extraFieldPage,
      target
    });
    expect(extra).toMatchObject({ status: "unavailable", blockerCode: "configuration_surface_unavailable" });
    expect(extraFieldPage.clicks()).toBe(0);
    expect(JSON.stringify(extra)).not.toContain(SECRET);

    const oversizedPage = fakePage({
      menuSnapshots: [menuSnapshot([{ label: "Effort Medium", role: "button", testId: "x".repeat(513) }])]
    });
    const oversized = await staging.readCurrent!({
      ...request("configuration_set", { actionId: "99999999-9999-4999-8999-999999999997" }),
      page: oversizedPage,
      target
    });
    expect(oversized).toMatchObject({ status: "unavailable", blockerCode: "configuration_surface_unavailable" });
    expect(oversizedPage.clicks()).toBe(0);
  });
});
