import { describe, expect, it } from "vitest";
import type { PageLike } from "../../src/types.js";
import {
  bindBrowserTarget,
  bindBrowserTargetAsync,
  BrowserTargetError,
  type BrowserTargetBindingInput,
  type BrowserTargetCapabilities,
  type BrowserTargetClaim
} from "../../src/operations/browser-target.js";
import type { OwnershipTargetEvidence } from "../../src/operations/turn-ownership.js";
import { ProcessTabCoordinator } from "../../src/runtime/tab-coordinator.js";

const DIGEST = (domain: string, material: unknown): string => {
  const input = `${domain}:${JSON.stringify(material)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `hmac-sha256:${hash.toString(16).padStart(8, "0").repeat(8)}`;
};

const ALL_CAPABILITIES: BrowserTargetCapabilities = {
  stableProviderId: true,
  stableBrowserId: true,
  stableTabId: true,
  authoritativeTabClaim: true,
  concurrentTabs: true
};

const OWNER = {
  backendSessionId: "backend-session-1",
  operationId: "operation-1"
};

function identity(value: string): { status: "available"; value: string } {
  return { status: "available", value };
}

function unavailable(reason: "not_exposed" | "not_observed" = "not_observed"): { status: "unavailable"; reason: typeof reason } {
  return { status: "unavailable", reason };
}

function targetEvidence(
  tabId = "tab-1",
  claim: string | undefined = "claim-1",
  conversationId = "conversation-1"
): OwnershipTargetEvidence {
  return {
    provider: identity("provider-1"),
    browser: identity("browser-1"),
    tab: identity(tabId),
    thread: identity("thread-1"),
    conversation: identity(conversationId),
    canonicalThreadUrl: identity(`https://opaque.invalid/thread/${"a".repeat(64)}`),
    authoritativeTabClaim: claim === undefined
      ? { status: "unavailable", reason: "not_exposed" }
      : identity(claim),
    coordinationScope: claim === undefined ? "process" : "provider"
  };
}

function pendingTargetEvidence(): OwnershipTargetEvidence {
  return {
    provider: identity("provider-1"),
    browser: identity("browser-1"),
    tab: identity("tab-new"),
    thread: unavailable(),
    conversation: unavailable(),
    canonicalThreadUrl: unavailable(),
    authoritativeTabClaim: unavailable(),
    coordinationScope: "process"
  };
}

function page(label: string): PageLike & { label: string } {
  return { label, evaluate: async () => ({}) } as unknown as PageLike & { label: string };
}

function input(
  overrides: Record<string, unknown> = {}
): BrowserTargetBindingInput {
  return {
    page: page("one"),
    evidence: targetEvidence(),
    authoritativeClaim: { token: "claim-1", epoch: 4 },
    capabilities: ALL_CAPABILITIES,
    evidenceDigest: DIGEST,
    owner: OWNER,
    coordinator: new ProcessTabCoordinator(),
    ...overrides
  } as BrowserTargetBindingInput;
}

function expectTargetError(action: () => unknown, code: BrowserTargetError["code"]): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(BrowserTargetError);
  expect((error as BrowserTargetError).code).toBe(code);
}

describe("browser target binding adapter", () => {
  it("binds an immutable provider-scoped target only with a validated claim and capability matrix", () => {
    const bound = bindBrowserTarget(input());

    expect(bound.target).toMatchObject({
      providerId: "provider-1",
      browserId: "browser-1",
      tabId: "tab-1",
      coordinationScope: "provider",
      conversationId: "conversation-1",
      canonicalThreadUrl: `https://opaque.invalid/thread/${"a".repeat(64)}`,
      evidenceProfile: {
        providerIdentity: "required",
        stableTabId: "required",
        stableConversationId: "required",
        authoritativeTabClaim: "required",
        replacementTabRecovery: false
      }
    });
    expect(bound.target.tabClaimEvidenceDigest).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(bound.targetEvidenceDigest).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(bound.resource).toMatchObject({
      scope: "provider",
      resourceKind: "tab",
      concurrentTabs: true,
      authoritativeClaimValidated: true
    });
    expect(Object.isFrozen(bound)).toBe(true);
    expect(Object.isFrozen(bound.target)).toBe(true);
    expect(Object.isFrozen(bound.capabilities)).toBe(true);
    expect((bound.page as PageLike & { label: string }).label).toBe("one");
  });

  it.each([
    ["claim omitted", { authoritativeClaim: undefined, evidence: targetEvidence("tab-1", undefined) }, "tab", true],
    ["claim capability omitted", { capabilities: { ...ALL_CAPABILITIES, authoritativeTabClaim: false } }, "tab", true],
    ["concurrent tabs omitted", { capabilities: { ...ALL_CAPABILITIES, concurrentTabs: false } }, "browser", false],
    ["stable provider identity not advertised", { capabilities: { ...ALL_CAPABILITIES, stableProviderId: false } }, "browser", false],
    ["stable browser identity not advertised", { capabilities: { ...ALL_CAPABILITIES, stableBrowserId: false } }, "browser", false],
    ["stable tab identity not advertised", { capabilities: { ...ALL_CAPABILITIES, stableTabId: false } }, "browser", false]
  ])("applies the conservative %s downgrade", (_name, overrides, resourceKind, concurrentTabs) => {
    const bound = bindBrowserTarget(input(overrides));
    expect(bound.target.coordinationScope).toBe("process");
    expect(bound.target.evidenceProfile.authoritativeTabClaim).toBe("unavailable");
    expect(bound.resource).toMatchObject({
      scope: "process",
      resourceKind,
      concurrentTabs
    });
  });

  it("rejects a supplied claim that does not match browser-observation evidence", () => {
    expectTargetError(
      () => bindBrowserTarget(input({ authoritativeClaim: { token: "claim-other", epoch: 4 } })),
      "claim_mismatch"
    );
  });

  it("binds a blank new-task anchor without inventing conversation identity", () => {
    const anchorDigest = DIGEST("new-anchor", "anchor");
    const blankEvidenceDigest = DIGEST("new-blank", "blank");
    const bound = bindBrowserTarget(input({
      evidence: pendingTargetEvidence(),
      targetLifecycle: "new_pending",
      newTargetAnchorDigest: anchorDigest,
      blankTaskEvidenceDigest: blankEvidenceDigest,
      authoritativeClaim: undefined
    }));
    expect(bound.target).toMatchObject({
      targetLifecycle: "new_pending",
      newTargetAnchorDigest: anchorDigest,
      blankTaskEvidenceDigest: blankEvidenceDigest,
      evidenceProfile: { stableConversationId: "unavailable", stableUserTurnId: "unavailable" }
    });
    expect(bound.target.conversationId).toBeUndefined();
    expect(bound.target.canonicalThreadUrl).toBeUndefined();
    expect(() => bound.assertCurrent(targetEvidence("tab-1"))).toThrowError(BrowserTargetError);
    expect(() => bound.assertCurrent(targetEvidence("tab-new"), undefined, true)).not.toThrow();
  });

  it("refines the local binding to a fixed provider identity after establishment", () => {
    const bound = bindBrowserTarget(input({
      evidence: pendingTargetEvidence(),
      targetLifecycle: "new_pending",
      newTargetAnchorDigest: DIGEST("new-anchor", "anchor"),
      blankTaskEvidenceDigest: DIGEST("new-blank", "blank"),
      authoritativeClaim: undefined
    }));
    bound.markTargetEstablished?.({
      conversationId: "conversation-established",
      canonicalThreadUrl: `https://opaque.invalid/thread/${"b".repeat(64)}`
    });
    expect(bound.target.targetLifecycle).toBeUndefined();
    expect(bound.target.conversationId).toBe("conversation-established");
    expect(bound.target.canonicalThreadUrl).toBe(`https://opaque.invalid/thread/${"b".repeat(64)}`);
    const establishedEvidence = {
      ...targetEvidence("tab-new", undefined, "conversation-established"),
      canonicalThreadUrl: { status: "available" as const, value: `https://opaque.invalid/thread/${"b".repeat(64)}` }
    };
    expect(() => bound.assertCurrent(establishedEvidence)).not.toThrow();
    expectTargetError(
      () => bound.assertCurrent({
        ...targetEvidence("tab-new", undefined, "conversation-other"),
        canonicalThreadUrl: establishedEvidence.canonicalThreadUrl
      }),
      "navigation_mismatch"
    );
  });

  it("fails closed on navigation and fencing changes before a transaction callback", () => {
    const bound = bindBrowserTarget(input());
    const changedUrl: OwnershipTargetEvidence = {
      ...targetEvidence(),
      canonicalThreadUrl: identity(`https://opaque.invalid/thread/${"b".repeat(64)}`)
    };
    expectTargetError(() => bound.assertCurrent(changedUrl, { token: "claim-1", epoch: 4 }), "navigation_mismatch");
    expectTargetError(() => bound.assertCurrent(targetEvidence()), "claim_mismatch");
    expectTargetError(() => bound.assertCurrent(targetEvidence(), { token: "claim-1", epoch: 5 }), "claim_mismatch");
    expectTargetError(() => bound.assertPage(page("replacement")), "page_mismatch");
  });

  it("rejects routable canonical URLs instead of persisting raw navigation identity", () => {
    expectTargetError(
      () => bindBrowserTarget(input({
        evidence: {
          ...targetEvidence(),
          canonicalThreadUrl: identity("https://chatgpt.com/c/conversation-1")
        }
      })),
      "invalid_target_evidence"
    );
  });

  it("serializes same-tab process-scoped transactions", async () => {
    const coordinator = new ProcessTabCoordinator();
    const first = bindBrowserTarget(input({
      coordinator,
      authoritativeClaim: undefined,
      evidence: targetEvidence("tab-a", undefined)
    }));
    const second = bindBrowserTarget(input({
      coordinator,
      authoritativeClaim: undefined,
      evidence: targetEvidence("tab-a", undefined),
      page: page("two")
    }));
    expect(first.resource.resourceKey).toBe(second.resource.resourceKey);
    expect(first.resource.resourceKind).toBe("tab");
    expect(first.resource.scope).toBe("process");

    let active = 0;
    let maximumActive = 0;
    let secondStarted = false;
    let firstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstReady = new Promise<void>(resolve => { firstStarted = resolve; });
    const release = new Promise<void>(resolve => { releaseFirst = resolve; });
    const firstCall = first.withTabTransaction({}, async transaction => {
      expect(transaction.acquisition.resourceKind).toBe("tab");
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      firstStarted();
      await release;
      active -= 1;
    });
    await firstReady;
    const secondCall = second.withTabTransaction({}, async () => {
      secondStarted = true;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      active -= 1;
    });
    await Promise.resolve();
    expect(active).toBe(1);
    expect(secondStarted).toBe(false);
    releaseFirst();
    await Promise.all([firstCall, secondCall]);
    expect(maximumActive).toBe(1);
  });

  it("permits different process-scoped tab actors to overlap without a provider claim", async () => {
    const coordinator = new ProcessTabCoordinator();
    const first = bindBrowserTarget(input({
      coordinator,
      evidence: targetEvidence("tab-a", undefined),
      authoritativeClaim: undefined
    }));
    const second = bindBrowserTarget(input({
      coordinator,
      evidence: targetEvidence("tab-b", undefined),
      authoritativeClaim: undefined,
      page: page("two")
    }));
    expect(first.resource.resourceKey).not.toBe(second.resource.resourceKey);
    expect(first.resource).toMatchObject({
      scope: "process",
      resourceKind: "tab",
      concurrentTabs: true,
      authoritativeClaimValidated: false
    });
    expect(second.resource).toMatchObject({
      scope: "process",
      resourceKind: "tab",
      concurrentTabs: true,
      authoritativeClaimValidated: false
    });

    let active = 0;
    let maximumActive = 0;
    let firstStarted!: () => void;
    let secondStarted!: () => void;
    let release!: () => void;
    const firstReady = new Promise<void>(resolve => { firstStarted = resolve; });
    const secondReady = new Promise<void>(resolve => { secondStarted = resolve; });
    const releaseBoth = new Promise<void>(resolve => { release = resolve; });
    const run = (bound: ReturnType<typeof bindBrowserTarget>, started: () => void) => bound.withTabTransaction({}, async transaction => {
      expect(transaction.acquisition.resourceKind).toBe("tab");
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      started();
      await releaseBoth;
      active -= 1;
    });
    const firstCall = run(first, firstStarted);
    const secondCall = run(second, secondStarted);
    await Promise.all([firstReady, secondReady]);
    expect(maximumActive).toBe(2);
    release();
    await Promise.all([firstCall, secondCall]);
  });

  it("permits different tab actors to overlap at provider scope after claim negotiation", async () => {
    const coordinator = new ProcessTabCoordinator();
    const claimA: BrowserTargetClaim = { token: "claim-a", epoch: 1 };
    const claimB: BrowserTargetClaim = { token: "claim-b", epoch: 1 };
    const first = bindBrowserTarget(input({ coordinator, evidence: targetEvidence("tab-a", "claim-a"), authoritativeClaim: claimA }));
    const second = bindBrowserTarget(input({ coordinator, evidence: targetEvidence("tab-b", "claim-b"), authoritativeClaim: claimB, page: page("two") }));
    expect(first.resource.resourceKey).not.toBe(second.resource.resourceKey);
    expect(first.resource.scope).toBe("provider");
    expect(second.resource.scope).toBe("provider");

    let active = 0;
    let maximumActive = 0;
    let firstStarted!: () => void;
    let secondStarted!: () => void;
    let release!: () => void;
    const firstReady = new Promise<void>(resolve => { firstStarted = resolve; });
    const secondReady = new Promise<void>(resolve => { secondStarted = resolve; });
    const releaseBoth = new Promise<void>(resolve => { release = resolve; });
    const run = (bound: ReturnType<typeof bindBrowserTarget>, started: () => void) => bound.withTabTransaction({}, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      started();
      await releaseBoth;
      active -= 1;
    });
    const firstCall = run(first, firstStarted);
    const secondCall = run(second, secondStarted);
    await Promise.all([firstReady, secondReady]);
    expect(maximumActive).toBe(2);
    release();
    await Promise.all([firstCall, secondCall]);
  });

  it("keeps resource keys stable and separates tab actors without widening scope", () => {
    const coordinator = new ProcessTabCoordinator();
    const processFirst = bindBrowserTarget(input({
      coordinator,
      evidence: targetEvidence("tab:a", undefined),
      authoritativeClaim: undefined
    }));
    const processSecond = bindBrowserTarget(input({
      coordinator,
      evidence: targetEvidence("tab:a", undefined),
      authoritativeClaim: undefined,
      page: page("two")
    }));
    const processOtherTab = bindBrowserTarget(input({
      coordinator,
      evidence: targetEvidence("tab:b", undefined),
      authoritativeClaim: undefined,
      page: page("three")
    }));
    expect(processFirst.resource.resourceKey).toBe("tab:provider-1:browser-1:tab%3Aa");
    expect(processFirst.resource.resourceKey).toBe(processSecond.resource.resourceKey);
    expect(processFirst.resource.resourceKey).not.toBe(processOtherTab.resource.resourceKey);
    expect(processFirst.resource.scope).toBe("process");

    const browserFallback = bindBrowserTarget(input({
      coordinator,
      evidence: targetEvidence("tab:a", undefined),
      authoritativeClaim: undefined,
      capabilities: { ...ALL_CAPABILITIES, concurrentTabs: false }
    }));
    expect(browserFallback.resource.resourceKey).toBe("browser:provider-1:browser-1");
    expect(browserFallback.resource.resourceKind).toBe("browser");
  });
});


describe("asynchronous target authority", () => {
  it("awaits claim and target signatures without changing the synchronous binding", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const original = input();
    const expected = bindBrowserTarget(original);
    let returned = false;
    const delayed = bindBrowserTargetAsync({ ...original, evidenceDigest: async (domain, material) => {
      await pending;
      return DIGEST(domain, material);
    } }).then(value => { returned = true; return value; });
    await Promise.resolve();
    expect(returned).toBe(false);
    release();
    const bound = await delayed;
    expect(bound.target).toEqual(expected.target);
    expect(bound.targetEvidenceDigest).toEqual(expected.targetEvidenceDigest);
    expect(bound.page).toBe(original.page);
  });

  it("captures caller capabilities before yielding and fails closed on rejected signing", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const originalPage = page("original");
    const value = input({ page: originalPage, evidenceDigest: async (domain: string, material: unknown) => {
      await pending;
      return DIGEST(domain, material);
    } });
    const bound = bindBrowserTargetAsync(value);
    (value as { page: PageLike }).page = page("replacement");
    release();
    expect((await bound).page).toBe(originalPage);
    await expect(bindBrowserTargetAsync(input({ evidenceDigest: async () => { throw new Error("private authority failure"); } })))
      .rejects.toMatchObject({ code: "invalid_digest", message: "Target evidence digest is invalid." });
  });
});
