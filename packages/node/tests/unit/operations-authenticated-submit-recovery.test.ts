import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserLike, PageLike } from "../../src/types.js";
import { OperationJournal } from "../../src/operations/journal.js";
import { OperationService, type OperationBrowserAdapter } from "../../src/operations/service.js";
import { OperationClient } from "../../src/operations/client.js";
import { createChatGPTOperationAdapterFactory, createChatGPTOperationHandleAdapterFactory } from "../../src/operations/chatgpt-runtime.js";
import { createBrowserResourceKey, ProcessTabCoordinator } from "../../src/runtime/tab-coordinator.js";
import { OPERATION_REQUEST_SCHEMA_VERSION, OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION, type OperationSubmitRequestV1, type OperationTargetBindingV1, type OperationEventV1 } from "../../src/operations/types.js";
import { TURN_OWNERSHIP_SCHEMA_VERSION, type OwnershipBaseline } from "../../src/operations/turn-ownership.js";
import { DomNode, element } from "../helpers/dom-tree.js";

const operationId = "11111111-1111-4111-8111-111111111111";
const actionId = "22222222-2222-4222-8222-222222222222";
const browserId = createBrowserResourceKey("codex", "codex-chrome");
const at = "2026-09-06T12:00:00.000Z";
const prompt = "Reply exactly: restart recovery works";
const request: OperationSubmitRequestV1 = { schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION, operationId, surface: "chat", target: { type: "new" }, prompt, capture: { responseContent: "include", responseFormat: "text", artifacts: "receipt_only" } };
const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function seed(options: { fixed?: boolean; send?: boolean; baseline?: boolean } = {}) {
  const stateRoot = await mkdtemp(join(tmpdir(), "issue41-submit-restart-")); roots.push(stateRoot);
  const journal = await OperationJournal.open({ stateRoot });
  const submitRequest = options.fixed ? { ...request, target: { type: "tab_id" as const, tabId: "saved-tab" } } : request;
  const requestDigest = journal.submitRequestDigest(submitRequest, []);
  const savedUrl = `https://opaque.invalid/thread/${journal.evidenceDigest("browser-observation-url", "https://chatgpt.com/c/saved-conversation").slice("hmac-sha256:".length)}`;
  const target: OperationTargetBindingV1 = {
    providerId: "chatgpt", browserId, tabId: "saved-tab", coordinationScope: "process",
    configurationReceiptDigest: journal.evidenceDigest("configuration-request", requestDigest),
    evidenceProfile: { providerIdentity: "required", stableTabId: "required", stableConversationId: options.fixed ? "required" : "unavailable", stableUserTurnId: "unavailable", authoritativeTabClaim: "unavailable", replacementTabRecovery: false },
    ...(options.fixed ? { conversationId: "saved-conversation", canonicalThreadUrl: savedUrl } : { targetLifecycle: "new_pending" as const,
      newTargetAnchorDigest: journal.evidenceDigest("anchor", "saved-blank-task"), blankTaskEvidenceDigest: journal.evidenceDigest("blank", "saved-blank-task") })
  };
  const available = (value: string) => ({ status: "available" as const, value });
  const unavailable = { status: "unavailable" as const, reason: "not_exposed" as const };
  const baseline: OwnershipBaseline = {
    schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION, snapshotDigest: journal.evidenceDigest("baseline", "saved-blank-task"), completeness: "complete", userTurns: [], assistantTurns: [],
    target: { provider: available("chatgpt"), browser: available(browserId), tab: available("saved-tab"), coordinationScope: "process", authoritativeTabClaim: unavailable,
      thread: options.fixed ? available("saved-conversation") : unavailable, conversation: options.fixed ? available("saved-conversation") : unavailable,
      canonicalThreadUrl: options.fixed ? available(savedUrl) : unavailable }
  };
  let loaded = await journal.create({ type: "operation_created", operationId, requestDigest, surface: "chat", createdAt: at, capturePolicy: { responseContent: "include", responseFormat: "text", artifacts: "receipt_only" } });
  const append = async (event: OperationEventV1) => { loaded = await journal.append(operationId, loaded.state.revision, event); };
  await append({ type: "target_bound", target, observedAt: at });
  if (options.send !== false) {
    await append({ type: "phase_changed", from: "prepared", to: "ready", mutationBoundary: "none", evidenceDigest: journal.evidenceDigest("ready", "fixture"), observedAt: at });
    const targetBindingDigest = journal.handleFromState(loaded.state).targetBindingDigest!;
    const action = { actionId, kind: "send" as const, repeatPolicy: "observe_only_after_intent" as const, requestDigest, targetDigest: targetBindingDigest };
    if (options.baseline !== false) await append({ type: "action_prepared", action, intentAt: at,
      baseline: { schemaVersion: OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION, operationId, requestDigest, targetBindingDigest, actionId, baseline, observedAt: at } });
    else await append({ type: "action_intent", action, intentAt: at });
    await append({ type: "phase_changed", from: "ready", to: "send_pending", mutationBoundary: "send_may_have_occurred", causeActionId: actionId, observedAt: at });
  }
  return { journal, stateRoot, submitRequest };
}

function fixture(options: { text?: string; duplicate?: boolean; conversation?: string; missing?: boolean } = {}) {
  const composer = element("div", { id: "prompt-textarea", contenteditable: "true", "aria-label": "Chat with ChatGPT" });
  const form = element("form", {}, composer);
  const user = element("div", { "data-message-author-role": "user", "data-message-id": "sent-user" }, options.text ?? prompt);
  const assistant = element("div", { "data-message-author-role": "assistant", "data-message-id": "reply-assistant" }, "restart recovery works");
  Object.assign(assistant, { innerHTML: "restart recovery works" });
  const main = element("main", { id: "main" }, user, assistant, ...(options.duplicate ? [element("div", { "data-message-author-role": "user", "data-message-id": "other-user" }, prompt)] : []), form);
  const document = new DomNode("#document", {}, [main]);
  const controlsSelector = "button, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='option']";
  document.querySelectorAll = selector => {
    if (selector === "main form, main [data-testid*='composer' i], main [class*='composer' i]") return [form];
    if (selector.includes("[role='menu']") || selector.includes("[role='radio']")) return [];
    return [];
  };
  form.querySelectorAll = selector => selector === controlsSelector ? [] : [composer];
  main.querySelectorAll = () => [form];
  Object.assign(document, { querySelector: (selector: string) => selector === "main" ? main : null, getElementById: (id: string) => id === "main" ? main : null });
  const currentUrl = `https://chatgpt.com/c/${options.conversation ?? "saved-conversation"}`;
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", { href: currentUrl });
  vi.stubGlobal("window", { getComputedStyle: (node: DomNode) => node.style });
  vi.stubGlobal("getComputedStyle", (node: DomNode) => node.style);
  const calls = { reads: 0, observations: 0, create: 0, selected: 0, mutate: 0, tabReads: 0 };
  const forbidden = () => { calls.mutate++; throw new Error("Recovery must never mutate"); };
  const page: PageLike & { id: string } = {
    id: "saved-tab", url: () => currentUrl, title: async () => "ChatGPT", goto: forbidden,
    getByRole: forbidden, locator: forbidden, waitForTimeout: async () => undefined,
    evaluate: async (fn, arg) => {
      calls.reads++;
      // Page-state attachment is a separate existing boundary; ownership and
      // surface callbacks below execute against the real linked DOM fixture.
      if (fn.toString().includes("visibleText:")) return { visibleText: "Chat with ChatGPT New chat", blockerText: "", hasConversationMessages: true } as never;
      if (fn.toString().includes("allowBlankTask")) calls.observations++;
      return fn(arg!);
    }
  };
  const browser: BrowserLike = { name: "chrome", tabs: {
    list: () => { calls.tabReads++; return options.missing ? [] : [page]; },
    get: id => { calls.tabReads++; if (options.missing || id !== "saved-tab") throw new Error("missing"); return page; },
    selected: () => { calls.selected++; return page; }, create: () => { calls.create++; throw new Error("Recovery must never create a tab"); }
  } };
  return { browser, calls };
}

function restart(journal: OperationJournal, browser: BrowserLike, label = "restarted-backend") {
  const options = { env: { browser }, owner: { backendSessionId: label }, evidenceDigest: async (domain: string, material: unknown) => /^[a-z][a-z0-9-]{0,63}$/u.test(domain) ? journal.evidenceDigest(domain, material) : journal.evidenceDigest("provider-evidence", { domain, material }), coordinator: new ProcessTabCoordinator() };
  const unavailable = async (): Promise<never> => { throw new Error("Fallback adapter must not be called"); };
  const fallback: OperationBrowserAdapter = { resolveTarget: unavailable, submission: { observeStaging: unavailable, executeFileHandoffOnce: unavailable, observeAttachments: unavailable, prepareSend: unavailable, executePreparedSend: unavailable, verifyPreparedSend: unavailable, recoverSend: unavailable, executeFinalTabTransaction: unavailable }, collector: { readContext: unavailable, observe: unavailable, sleep: unavailable } };
  return new OperationClient(new OperationService(journal), fallback, { adapterFactory: createChatGPTOperationAdapterFactory(options), handleAdapterFactory: createChatGPTOperationHandleAdapterFactory(options) });
}

describe("authenticated Send recovery through a fresh OperationClient and default ChatGPT runtime", () => {
  it.each([false, true])("collects the same durable Send after a fresh client restart (fixed=%s)", async fixed => {
    const seeded = await seed({ fixed });
    const { browser, calls } = fixture();
    const reopened = await OperationJournal.open({ stateRoot: seeded.stateRoot });
    const result = await restart(reopened, browser).run(seeded.submitRequest, { timeoutMs: 3000 });
    expect(result.submit.submission.kind).toBe("already_submitted");
    expect(result.collect?.kind).toBe("completed");
    const state = (await reopened.load(operationId)).state;
    expect(state.phase).toBe("completed");
    expect(Object.values(state.actions).filter(action => action.kind === "send")).toHaveLength(1);
    expect(state.submissionWitness?.actionId).toBe(actionId);
    expect(state.target?.targetLifecycle).toBe(fixed ? undefined : "new_established");
    expect(calls.observations).toBeGreaterThan(0);
    expect(calls).toMatchObject({ create: 0, selected: 0, mutate: 0 });
    const readCount = calls.reads;
    const replay = await restart(await OperationJournal.open({ stateRoot: seeded.stateRoot }), browser, "another-backend").run(seeded.submitRequest, { timeoutMs: 3000 });
    expect(replay.collect?.kind).toBe("completed");
    expect(calls.reads).toBe(readCount);
  });

  it("recovers an established new target after restart between submission and collection", async () => {
    const seeded = await seed(); const { browser, calls } = fixture();
    const first = await restart(seeded.journal, browser, "first-recovery").submit(seeded.submitRequest);
    expect(first.submission.kind).toBe("already_submitted");
    expect((await seeded.journal.load(operationId)).state.target?.targetLifecycle).toBe("new_established");
    const result = await restart(await OperationJournal.open({ stateRoot: seeded.stateRoot }), browser, "second-recovery").run(seeded.submitRequest, { timeoutMs: 3000 });
    expect(result.submit.submission.kind).toBe("already_submitted");
    expect(result.collect?.kind).toBe("completed");
    const events = (await seeded.journal.load(operationId)).envelopes.map(envelope => envelope.event);
    expect(events.filter(event => event.type === "target_established")).toHaveLength(1);
    expect(calls).toMatchObject({ create: 0, selected: 0, mutate: 0 });
  });

  it("rejects a different fixed conversation on the same saved tab", async () => {
    const seeded = await seed({ fixed: true }); const { browser, calls } = fixture({ conversation: "other-conversation" });
    const result = await restart(seeded.journal, browser).run(seeded.submitRequest, { timeoutMs: 500 });
    expect(result.submit.submission.kind).toBe("blocked");
    expect(result.collect).toBeUndefined();
    expect(calls).toMatchObject({ create: 0, selected: 0, mutate: 0 });
  });

  it("does not attach after caller cancellation", async () => {
    const seeded = await seed(); const { browser, calls } = fixture();
    const controller = new AbortController(); controller.abort();
    await expect(restart(seeded.journal, browser).submit(seeded.submitRequest, { signal: controller.signal })).rejects.toMatchObject({ code: "operation_cancelled" });
    expect(calls).toEqual({ reads: 0, observations: 0, create: 0, selected: 0, mutate: 0, tabReads: 0 });
  });

  it.each([
    ["missing saved tab", { missing: true }],
    ["unrelated conversation prompt", { text: "This belongs to another conversation" }],
    ["ambiguous duplicate submitted prompt", { duplicate: true }]
  ] as const)("fails closed for %s without replaying Send", async (_label, options) => {
    const seeded = await seed(); const { browser, calls } = fixture(options);
    const result = await restart(await OperationJournal.open({ stateRoot: seeded.stateRoot }), browser).run(seeded.submitRequest, { timeoutMs: 500 });
    expect(["submitted", "already_submitted", "completed_receipt"]).not.toContain(result.submit.submission.kind);
    expect(result.collect).toBeUndefined();
    expect((await seeded.journal.load(operationId)).state.target?.targetLifecycle).toBe("new_pending");
    expect(calls).toMatchObject({ create: 0, selected: 0, mutate: 0 });
  });

  it("authenticates the immutable request before any browser access", async () => {
    const seeded = await seed(); const { browser, calls } = fixture();
    await expect(restart(await OperationJournal.open({ stateRoot: seeded.stateRoot }), browser).submit({ ...seeded.submitRequest, prompt: "changed prompt" })).rejects.toMatchObject({ code: "operation_request_mismatch" });
    expect(calls).toEqual({ reads: 0, observations: 0, create: 0, selected: 0, mutate: 0, tabReads: 0 });
  });

  it("never recreates or recomposes a pending target that has no durable Send", async () => {
    const seeded = await seed({ send: false }); const { browser, calls } = fixture();
    const result = await restart(await OperationJournal.open({ stateRoot: seeded.stateRoot }), browser).submit(seeded.submitRequest);
    expect(result.submission.kind).toBe("blocked");
    expect(calls).toEqual({ reads: 0, observations: 0, create: 0, selected: 0, mutate: 0, tabReads: 0 });
    expect(Object.values((await seeded.journal.load(operationId)).state.actions)).toHaveLength(0);
  });

  it("does not synthesize a missing durable baseline for recovery", async () => {
    const seeded = await seed({ baseline: false }); const { browser, calls } = fixture();
    const result = await restart(await OperationJournal.open({ stateRoot: seeded.stateRoot }), browser).submit(seeded.submitRequest);
    expect(["submitted", "already_submitted"]).not.toContain(result.submission.kind);
    expect(calls).toEqual({ reads: 0, observations: 0, create: 0, selected: 0, mutate: 0, tabReads: 0 });
  });
});
