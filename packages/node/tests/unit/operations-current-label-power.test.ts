import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatGPT } from "../../src/client.js";
import { OperationJournal } from "../../src/operations/journal.js";
import type { OperationBrowserAdapter } from "../../src/operations/service.js";
import { createProductionConfigurationStaging } from "../../src/operations/production-configuration.js";
import { runOperationStaging, type OperationStagingCallbackRequest, type OperationStagingIntentResult, type OperationStagingReceipt, type OperationStagingRequest } from "../../src/operations/staging.js";
import { readTransactionalChatPower } from "../../src/operations/transactional-chat-power.js";
import type { OperationTargetBindingV1, OperationConfigurationRequestV1 } from "../../src/operations/types.js";
import type { LocatorLike, PageLike } from "../../src/types.js";
import { DomNode, element } from "../helpers/dom-tree.js";

const operationId = "11111111-1111-4111-8111-111111111111";
const requestDigest = `hmac-sha256:${"a".repeat(64)}`;
const targetBindingDigest = `hmac-sha256:${"b".repeat(64)}`;
const actionId = "22222222-2222-4222-8222-222222222222";
const evidenceDigest = (domain: string, material: unknown): string => `hmac-sha256:${createHmac("sha256", "fixture-only-key").update(domain).update(JSON.stringify(material)).digest("hex")}`;
const target: OperationTargetBindingV1 = {
  providerId: "provider", browserId: "browser", tabId: "tab", coordinationScope: "process", conversationId: "conversation",
  canonicalThreadUrl: `https://opaque.invalid/thread/${"1".repeat(64)}`,
  evidenceProfile: { providerIdentity: "required", stableTabId: "required", stableConversationId: "required", stableUserTurnId: "unavailable", authoritativeTabClaim: "unavailable", replacementTabRecovery: false }
};
const identity: OperationStagingRequest = { operationId, requestDigest, targetBindingDigest, actionId, kind: "power_select", desiredStateDigest: evidenceDigest("staging-desired", { requestDigest, kind: "power_select" }) };
function callback(signal = new AbortController().signal): OperationStagingCallbackRequest {
  return { ...identity, signal, deadlineAt: Date.now() + 30_000 };
}
function primitive(reasoning: string, asynchronousSigner = false) {
  return createProductionConfigurationStaging({
    operationId, requestDigest, surface: "chat", configuration: { reasoning },
    evidenceDigest: asynchronousSigner ? async (domain, material) => evidenceDigest(domain, material) : evidenceDigest
  });
}

/** Executes every browser observation/preflight callback against a linked DOM. */
function powerDom(labels = ["Medium", "High", "Pro"], initiallyOpen = false) {
  const editor = element("div", { contenteditable: "true", "aria-label": "Chat with ChatGPT" });
  const labelNode = element("span");
  const trigger = element("button", { id: "power-trigger", class: "__composer-pill group/pill", "aria-haspopup": "menu", "aria-expanded": "false" }, labelNode);
  const plus = element("button", { id: "composer-plus-btn", "data-testid": "composer-plus-btn", "aria-label": "Add files and more", "aria-haspopup": "menu", "aria-expanded": "false" });
  const form = element("form", {}, editor, plus, trigger);
  const main = element("main", {}, form);
  const slider = element("span", { role: "slider", "aria-hidden": "true", "aria-valuemin": "0", "aria-valuemax": String(labels.length - 1), "aria-valuenow": "0" });
  const description = element("span", { id: "power-description" });
  const powerOwner = element("div", { role: "menuitem", "aria-label": "Power", "aria-describedby": "power-description" },
    element("div", { "data-model-reasoning-effort-slider": "" }, slider), description);
  const simple = element("div", { "data-testid": "composer-model-picker-slider-simple-view", "data-active": "true" }, powerOwner);
  const toggle = element("div", { role: "menuitem", "data-interactive": "true", "aria-expanded": "false" }, "Medium");
  const view = element("div", { "data-view": "simple", "data-has-slider": "true", "data-has-advanced-view": "true", "data-model-selection-view": "true" }, toggle, simple);
  const root = element("div", { "data-testid": "composer-intelligence-picker-content" }, view);
  const menu = element("div", { role: "menu", "aria-labelledby": "power-trigger", "data-state": "closed" }, root);
  const document = new DomNode("#document", {}, [main, menu]);
  let model = "";
  let opens = 0, closes = 0;
  const keys: string[] = [];
  const evaluations: string[] = [];
  let afterPress: ((key: string) => void) | undefined;
  let beforeControlEvaluation: ((node: DomNode) => void) | undefined;
  let pressMode: "normal" | "ignored" | "throw_before" | "throw_after" = "normal";
  const isOpen = () => menu.attributes["data-state"] === "open";
  const setOpen = (open: boolean) => { menu.attributes["data-state"] = open ? "open" : "closed"; trigger.attributes["aria-expanded"] = String(open); setLevel(Number(slider.attributes["aria-valuenow"])); };
  const setLevel = (value: number) => {
    slider.attributes["aria-valuenow"] = String(value);
    labelNode.firstChild = null;
    labelNode.append(`${model}${isOpen() ? "Thinking effort" : labels[value]}`);
    description.firstChild = null;
    description.append(`${labels[value]}, ${value + 1} of ${labels.length}.`);
  };
  document.querySelectorAll = selector => {
    if (selector === "main form") return [form];
    if (selector === '[data-testid="composer-intelligence-picker-content"]') return isOpen() ? [root] : [];
    throw new Error(`Unexpected selector: ${selector}`);
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { getComputedStyle: (node: DomNode) => node.style });
  const controls = (nodes: () => DomNode[], handlers: { click?: () => void; press?: (key: string, node: DomNode) => void } = {}, index?: number): LocatorLike => ({
    count: async () => index === undefined ? nodes().length : Number(nodes()[index] !== undefined),
    nth: value => controls(nodes, handlers, value),
    evaluate: async fn => { const node = nodes()[index ?? 0]!; beforeControlEvaluation?.(node); return fn(node as unknown as Element); },
    ...(handlers.click === undefined ? {} : { click: async () => handlers.click!() }),
    ...(handlers.press === undefined ? {} : { press: async (key: string) => handlers.press!(key, nodes()[index ?? 0]!) })
  });
  const collectSliders = () => {
    const nodes: DomNode[] = [];
    const visit = (node: DomNode) => { if (node.getAttribute("role") === "slider") nodes.push(node); let child = node.firstChild; while (child !== null) { visit(child); child = child.nextSibling; } };
    visit(simple);
    return nodes;
  };
  const page: PageLike = {
    evaluate: async (fn, arg) => { evaluations.push(String(fn)); return fn(arg as never); },
    waitForTimeout: async () => { throw new Error("The transactional actor must not sleep"); },
    locator: selector => {
      if (selector === '[id="power-trigger"]') return controls(() => [trigger], { click: () => { opens += 1; setOpen(true); } });
      if (selector === '[role="menu"][aria-labelledby="power-trigger"]') return controls(() => isOpen() ? [menu] : [], { press: key => { expect(key).toBe("Escape"); closes += 1; setOpen(false); } });
      if (selector === '[data-testid="composer-intelligence-picker-content"]') {
        const roots: LocatorLike = controls(() => isOpen() ? [root] : []);
        const rootLocator: LocatorLike = { ...roots, nth: () => rootLocator, locator: scoped => {
          expect(scoped).toBe('[data-testid="composer-model-picker-slider-simple-view"][data-active="true"] [role="slider"]');
          return controls(collectSliders, { press: (key, node) => {
            expect(node).toBe(slider);
            keys.push(key);
            if (pressMode === "throw_before") throw new Error("Bridge rejected before delivery");
            if (pressMode !== "ignored") setLevel(Number(slider.attributes["aria-valuenow"]) + (key === "ArrowRight" ? 1 : -1));
            afterPress?.(key);
            if (pressMode === "throw_after") throw new Error("Bridge lost acknowledgement");
          } });
        } };
        return rootLocator;
      }
      throw new Error(`Unexpected locator: ${selector}`);
    }
  };
  setLevel(0); setOpen(initiallyOpen);
  return { page, slider, powerOwner, description, trigger, labelNode, form, simple, keys, evaluations, setLevel, setOpen,
    isOpen, opens: () => opens, closes: () => closes,
    setModel: (value: string) => { model = value; setLevel(Number(slider.attributes["aria-valuenow"])); },
    afterPress: (fn: (key: string) => void) => { afterPress = fn; },
    beforeControlEvaluation: (fn: (node: DomNode) => void) => { beforeControlEvaluation = fn; },
    setPressMode: (mode: typeof pressMode) => { pressMode = mode; } };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("transactional current-label Power selection", () => {
  it.each([undefined, "chat"] as const)("routes high-level ask effort through the journalled real DOM primitive with experience %s", async experience => {
    const dom = powerDom(); const stateRoot = await mkdtemp(join(tmpdir(), "current-label-client-"));
    try {
      const journal = await OperationJournal.open({ stateRoot });
      let configuration: OperationConfigurationRequestV1 | undefined;
      let submissionReached = 0;
      const unavailable = async (): Promise<never> => { throw new Error("This routing fixture must stop before Send"); };
      const chatgpt = createChatGPT({ operations: { stateRoot, adapterFactory: async ({ request }) => {
        configuration = request.configuration;
        const production = createProductionConfigurationStaging({ operationId: request.operationId,
          requestDigest: journal.submitRequestDigest(request, []), surface: "chat", ...(configuration === undefined ? {} : { configuration }),
          evidenceDigest: async (domain, material) => journal.evidenceDigest(domain, material)
        });
        const observe = (callback: OperationStagingCallbackRequest) => callback.kind === "composer_set"
          ? Promise.resolve({ status: "satisfied" as const, desiredStateDigest: callback.desiredStateDigest,
            currentStateDigest: journal.evidenceDigest("test-composer", {}), evidenceDigest: journal.evidenceDigest("test-composer", {}) })
          : production.readCurrent!({ ...callback, page: dom.page, target });
        const adapter: OperationBrowserAdapter = {
          resolveTarget: async () => ({ target }),
          staging: { readCurrent: observe, observe, mutateOnce: callback => production.mutateOnce!({ ...callback, page: dom.page, target }) },
          submission: {
            observeStaging: async () => { submissionReached += 1; return { status: "mismatch", reason: "unknown", evidenceDigest: journal.evidenceDigest("test-stop-before-send", {}) }; },
            executeFileHandoffOnce: unavailable, observeAttachments: unavailable, prepareSend: unavailable,
            executePreparedSend: unavailable, verifyPreparedSend: unavailable, recoverSend: unavailable, executeFinalTabTransaction: unavailable
          },
          collector: { readContext: unavailable, observe: unavailable, sleep: unavailable }
        };
        return adapter;
      } } });
      await chatgpt.ask({ operationId, prompt: "Synthetic routing test", ...(experience === undefined ? {} : { experience }),
        configuration: { effort: "High" }, wait: false, read: false });
      expect(configuration).toEqual({ ...(experience === undefined ? {} : { experience }), additional: { effort: "High" } });
      expect(submissionReached).toBe(1);
      expect(dom.keys).toEqual(["ArrowRight"]); expect(dom.opens()).toBe(1); expect(dom.closes()).toBe(1);
      const durable = await journal.load(operationId);
      expect(Object.values(durable.state.actions).filter(action => action.kind === "power_select")).toMatchObject([{ outcome: "satisfied" }]);
      expect(Object.values(durable.state.actions).filter(action => action.kind === "send")).toEqual([]);
    } finally { await rm(stateRoot, { recursive: true, force: true }); }
  });

  it("rejects conflicting reasoning and public effort aliases without opening", async () => {
    const dom = powerDom(); const request = { ...callback(), page: dom.page, target };
    const staging = createProductionConfigurationStaging({ operationId, requestDigest, surface: "chat",
      configuration: { reasoning: "High", additional: { effort: "Pro" } }, evidenceDigest });
    expect(await staging.readCurrent!(request)).toMatchObject({ status: "unavailable", blockerCode: "power_not_configured" });
    expect(dom.opens()).toBe(0); expect(dom.keys).toEqual([]);
  });

  it("observes a closed composer without opening or guessing a mapping", async () => {
    const dom = powerDom();
    expect(await readTransactionalChatPower(dom.page)).toMatchObject({ presentation: "closed", currentLabel: "Medium" });
    const staging = primitive("High", true);
    expect(await staging.readCurrent!({ ...callback(), page: dom.page, target })).toMatchObject({ status: "not_satisfied" });
    expect(dom.opens()).toBe(0);
    expect(dom.keys).toEqual([]);
  });

  it.each([
    ["three", ["Medium", "High", "Pro"]],
    ["five", ["Instant", "Medium", "High", "Extra High", "Pro"]]
  ])("selects and verifies High on the actual %s-position DOM then restores closed presentation", async (_name, labels) => {
    const dom = powerDom(labels as string[]);
    const staging = primitive("High");
    const request = { ...callback(), page: dom.page, target };
    expect((await staging.readCurrent!(request)).status).toBe("not_satisfied");
    await staging.mutateOnce!(request);
    expect((await staging.observe!(request)).status).toBe("satisfied");
    expect(dom.opens()).toBe(1); expect(dom.closes()).toBe(1); expect(dom.isOpen()).toBe(false);
    expect(dom.keys).toEqual(Array(labels.indexOf("High")).fill("ArrowRight"));
    await expect(staging.mutateOnce!(request)).rejects.toMatchObject({ code: "staging_mutation_already_attempted" });
  });

  it("recognizes the current label as a no-op and leaves the menu closed", async () => {
    const dom = powerDom();
    const staging = primitive("Medium");
    const request = { ...callback(), page: dom.page, target };
    expect((await staging.readCurrent!(request)).status).toBe("satisfied");
    await staging.mutateOnce!(request);
    expect(dom.opens()).toBe(0); expect(dom.keys).toEqual([]);
  });

  it("exhausts a bounded absent-target search, proves restoration and settles unsuccessful", async () => {
    const dom = powerDom(["Instant", "Medium", "High", "Extra High", "Pro"]);
    dom.setLevel(2);
    const staging = primitive("Unavailable custom effort");
    const request = { ...callback(), page: dom.page, target };
    await staging.readCurrent!(request); await staging.mutateOnce!(request);
    expect((await staging.observe!(request)).status).toBe("not_satisfied");
    expect(dom.keys.length).toBe(8); expect(dom.slider.attributes["aria-valuenow"]).toBe("2");
    expect(dom.isOpen()).toBe(false);
  });

  it("uses exact label equality so High cannot select Extra High", async () => {
    const dom = powerDom(["Medium", "Extra High", "Pro"]);
    const staging = primitive("High");
    const request = { ...callback(), page: dom.page, target };
    await staging.readCurrent!(request); await staging.mutateOnce!(request);
    expect((await staging.observe!(request)).status).toBe("not_satisfied");
    expect(dom.slider.attributes["aria-valuenow"]).toBe("0");
  });

  it.each(["ignored", "throw_before", "throw_after"] as const)("stops after a %s key without blind restoration or retry", async mode => {
    const dom = powerDom(); dom.setPressMode(mode);
    const staging = primitive("Pro");
    const request = { ...callback(), page: dom.page, target };
    await staging.readCurrent!(request);
    await expect(staging.mutateOnce!(request)).rejects.toMatchObject({ code: "power_state_drift" });
    expect(await staging.observe!(request)).toMatchObject({ status: "uncertain", blockerCode: "power_restoration_required" });
    expect(dom.keys).toHaveLength(1); expect(dom.closes()).toBe(0);
    await expect(staging.mutateOnce!(request)).rejects.toMatchObject({ code: "staging_mutation_already_attempted" });
  });

  it.each(["range", "model", "cancel", "timeout"])("stops the plan on %s change after one key", async change => {
    const dom = powerDom();
    const abort = new AbortController();
    const staging = primitive("Pro");
    let time = Date.now();
    if (change === "timeout") vi.spyOn(Date, "now").mockImplementation(() => time);
    const request = { ...callback(abort.signal), page: dom.page, target };
    dom.afterPress(() => {
      if (change === "range") dom.slider.attributes["aria-valuemax"] = "4";
      if (change === "model") dom.setModel("5.6");
      if (change === "cancel") abort.abort();
      if (change === "timeout") time = request.deadlineAt;
    });
    await staging.readCurrent!(request);
    await expect(staging.mutateOnce!(request)).rejects.toBeDefined();
    expect(dom.keys).toHaveLength(1); expect(dom.closes()).toBe(0);
    vi.restoreAllMocks();
  });

  it("rejects an altered closed precondition without opening the menu", async () => {
    const dom = powerDom(); const staging = primitive("Pro");
    const request = { ...callback(), page: dom.page, target };
    await staging.readCurrent!(request); dom.setLevel(1);
    await expect(staging.mutateOnce!(request)).rejects.toMatchObject({ code: "power_state_drift" });
    expect(dom.opens()).toBe(0); expect(dom.keys).toEqual([]);
  });

  it("preserves an initially open menu after successful selection", async () => {
    const dom = powerDom(undefined, true); const staging = primitive("High");
    const request = { ...callback(), page: dom.page, target };
    await staging.readCurrent!(request); await staging.mutateOnce!(request);
    expect((await staging.observe!(request)).status).toBe("satisfied");
    expect(dom.opens()).toBe(0); expect(dom.closes()).toBe(0); expect(dom.isOpen()).toBe(true);
  });

  it("targets the live slider by its observed index when an inert duplicate precedes it", async () => {
    const dom = powerDom();
    const owner = dom.slider.parentNode!;
    const stale = element("span", { ...dom.slider.attributes, inert: "" });
    stale.parentNode = owner; stale.nextSibling = dom.slider; owner.firstChild = stale;
    const staging = primitive("High"); const request = { ...callback(), page: dom.page, target };
    await staging.readCurrent!(request); await staging.mutateOnce!(request);
    expect((await staging.observe!(request)).status).toBe("satisfied");
    expect(dom.keys).toEqual(["ArrowRight"]);
  });

  it.each(["trigger", "slider"])("does not activate a %s that becomes hidden at locator preflight", async control => {
    const dom = powerDom();
    dom.beforeControlEvaluation(node => { if (node === (control === "trigger" ? dom.trigger : dom.slider)) node.attributes.inert = ""; });
    const staging = primitive("High"); const request = { ...callback(), page: dom.page, target };
    await staging.readCurrent!(request);
    await expect(staging.mutateOnce!(request)).rejects.toMatchObject({ code: "power_control_unavailable" });
    expect(dom.keys).toEqual([]); expect(dom.opens()).toBe(control === "trigger" ? 0 : 1);
  });

  it("keeps an interrupted restoration uncertain without issuing the remaining keys", async () => {
    const dom = powerDom();
    dom.afterPress(() => { if (dom.keys.length === 2) dom.setPressMode("throw_before"); });
    const staging = primitive("Unavailable effort"); const request = { ...callback(), page: dom.page, target };
    await staging.readCurrent!(request);
    await expect(staging.mutateOnce!(request)).rejects.toMatchObject({ code: "power_state_drift" });
    expect(await staging.observe!(request)).toMatchObject({ status: "uncertain", blockerCode: "power_restoration_required" });
    expect(dom.keys).toHaveLength(3); expect(dom.closes()).toBe(0);
  });

  it.each(["trigger", "slider"])("fails closed when the %s ancestry exceeds the preflight bound after discovery", async control => {
    const dom = powerDom();
    dom.beforeControlEvaluation(node => {
      if (node !== (control === "trigger" ? dom.trigger : dom.slider)) return;
      let top = node;
      while (top.parentNode?.nodeType === 1) top = top.parentNode;
      for (let index = 0; index < 64; index += 1) { const parent = element("div"); top.parentNode = parent; top = parent; }
      top.attributes.inert = "";
    });
    const staging = primitive("High"); const request = { ...callback(), page: dom.page, target };
    await staging.readCurrent!(request);
    await expect(staging.mutateOnce!(request)).rejects.toMatchObject({ code: "power_control_unavailable" });
    expect(dom.keys).toEqual([]);
  });

  it.each(["cancel", "timeout"])("checks %s after asynchronous authority signing and before opening", async cause => {
    const dom = powerDom(); const abort = new AbortController(); let invalidate = false;
    const request = { ...callback(abort.signal), page: dom.page, target };
    const staging = createProductionConfigurationStaging({ operationId, requestDigest, surface: "chat", configuration: { reasoning: "High" },
      evidenceDigest: async (domain, material) => {
        if (invalidate) {
          if (cause === "cancel") abort.abort();
          else vi.spyOn(Date, "now").mockReturnValue(request.deadlineAt);
        }
        return evidenceDigest(domain, material);
      }
    });
    await staging.readCurrent!(request); invalidate = true;
    await expect(staging.mutateOnce!(request)).rejects.toMatchObject({ code: cause === "cancel" ? "operation_cancelled" : "operation_timeout" });
    expect(dom.opens()).toBe(0); expect(dom.keys).toEqual([]);
  });

  it("does not authorize mutation from an observation whose asynchronous evidence signing failed", async () => {
    const dom = powerDom(); const request = { ...callback(), page: dom.page, target };
    const staging = createProductionConfigurationStaging({ operationId, requestDigest, surface: "chat", configuration: { reasoning: "High" },
      evidenceDigest: async (domain, material) => { if (domain !== "staging-desired") throw new Error("Authority unavailable"); return evidenceDigest(domain, material); }
    });
    expect(await staging.readCurrent!(request)).toMatchObject({ status: "uncertain", blockerCode: "configuration_evidence_failed" });
    await expect(staging.mutateOnce!(request)).rejects.toMatchObject({ code: "configuration_evidence_failed" });
    expect(dom.opens()).toBe(0); expect(dom.keys).toEqual([]);
  });

  it("reconciles a lost acknowledgement when the requested label is observed without another key", async () => {
    const dom = powerDom(); dom.setPressMode("throw_after"); const staging = primitive("High");
    let receipt: OperationStagingReceipt | undefined;
    const result = await runOperationStaging(identity, {
      readCurrent: request => staging.readCurrent!({ ...request, page: dom.page, target }),
      observe: request => staging.observe!({ ...request, page: dom.page, target }),
      mutateOnce: request => staging.mutateOnce!({ ...request, page: dom.page, target }),
      persistIntent: async () => ({ status: "created" }), persistReceipt: async request => { receipt = request.receipt; }
    });
    expect(result.kind).toBe("completed"); expect(receipt).toMatchObject({ outcome: "satisfied" });
    expect(dom.keys).toEqual(["ArrowRight"]); expect(dom.closes()).toBe(0);
  });

  it("persists the intent before opening and reconciles same-action replay without another mutation", async () => {
    const dom = powerDom(); let staging = primitive("High", true);
    let intent: OperationStagingIntentResult = { status: "created" };
    let receipt: OperationStagingReceipt | undefined;
    const run = () => runOperationStaging(identity, {
      readCurrent: request => staging.readCurrent!({ ...request, page: dom.page, target }),
      observe: request => staging.observe!({ ...request, page: dom.page, target }),
      mutateOnce: request => { expect(intent.status).toBe("existing_unsettled"); return staging.mutateOnce!({ ...request, page: dom.page, target }); },
      persistIntent: async () => { const result = intent; if (result.status === "created") intent = { status: "existing_unsettled" }; return result; },
      persistReceipt: async request => { receipt = request.receipt; intent = { status: "existing_settled", receipt }; }
    });
    expect((await run()).kind).toBe("completed");
    expect(receipt).toMatchObject({ mutation: "attempted", outcome: "satisfied" });
    const before = [...dom.keys]; staging = primitive("High", true);
    expect((await run()).kind).toBe("completed");
    expect(dom.keys).toEqual(before); expect(dom.opens()).toBe(1);
    expect(JSON.stringify(receipt)).not.toContain("High");
  });

  it("observes an interrupted action from a fresh primitive without reconstructing search authority", async () => {
    const dom = powerDom(); dom.setLevel(1);
    const staging = primitive("Pro");
    let mutations = 0;
    const result = await runOperationStaging(identity, {
      readCurrent: request => staging.readCurrent!({ ...request, page: dom.page, target }),
      observe: request => staging.observe!({ ...request, page: dom.page, target }),
      mutateOnce: async () => { mutations += 1; return { status: "started" }; },
      persistIntent: async () => ({ status: "existing_unsettled" }), persistReceipt: async () => {}
    });
    expect(result.kind).toBe("blocked"); expect(mutations).toBe(0);
    expect(dom.opens()).toBe(0); expect(dom.keys).toEqual([]);
  });
});
