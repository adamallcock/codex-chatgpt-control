import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import type { PageLike } from "../../src/types.js";
import {
  BrowserObservationError,
  observeBrowserPage,
  readPageObservation,
  type BrowserObservationOptions
} from "../../src/operations/browser-observation.js";
import { TURN_OWNERSHIP_SCHEMA_VERSION, type OwnershipBaseline } from "../../src/operations/turn-ownership.js";

const digest = (domain: string, material: unknown): string => {
  const text = `${domain}:${JSON.stringify(material)}`;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  const hex = hash.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
  return `hmac-sha256:${hex}`;
};

type RawArtifact = {
  kind: "file" | "image" | "other";
  identity: string;
  contentDigest?: string;
  bytes?: number;
  mimeType?: string;
};

type RawTurn = {
  role: "user" | "assistant";
  stableId: string;
  parentStableId?: string;
  branchStableId?: string;
  ordinal: number;
  text: string;
  contentHtml?: string;
  structure: { tag: string; childCount: number; artifactCount: number };
  state?: "generating" | "terminal";
  finishReason?: string;
  artifacts: RawArtifact[];
};

function turn(
  role: RawTurn["role"],
  stableId: string,
  ordinal: number,
  extras: Partial<RawTurn> = {}
): RawTurn {
  const text = extras.text ?? (role === "user" ? "private prompt" : "private response");
  return {
    role,
    stableId,
    ordinal,
    text,
    ...(role === "assistant" ? { contentHtml: extras.contentHtml ?? `<p>${escapeHtml(text)}</p>` } : {}),
    structure: { tag: "div", childCount: 1, artifactCount: 0 },
    artifacts: [],
    ...extras
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function observation(turns: RawTurn[], extras: Record<string, unknown> = {}) {
  return {
    canonicalUrl: "https://chatgpt.com/c/conversation-1",
    conversationId: "conversation-1",
    threadId: "thread-1",
    turns,
    completeness: "complete" as const,
    terminalState: turns.some(item => item.state === "generating") ? "generating" as const : turns.some(item => item.role === "assistant") ? "terminal" as const : "idle" as const,
    ...extras
  };
}

function fakePage(value: unknown): PageLike & { evaluateCount: number } {
  const page = {
    evaluateCount: 0,
    evaluate: async (_callback: unknown, args?: unknown) => {
      page.evaluateCount += 1;
      const captureAssistantTurnId = typeof args === "object" && args !== null && "captureAssistantTurnId" in args
        ? (args as { captureAssistantTurnId?: unknown }).captureAssistantTurnId
        : undefined;
      if (typeof value !== "object" || value === null || !Array.isArray((value as { turns?: unknown }).turns)) return value;
      return {
        ...(value as Record<string, unknown>),
        turns: ((value as { turns: RawTurn[] }).turns).map(item => {
          if (item.contentHtml === undefined || item.stableId === captureAssistantTurnId) return item;
          const { contentHtml: _contentHtml, ...withoutMarkup } = item;
          return withoutMarkup;
        })
      };
    }
  };
  return page as PageLike & { evaluateCount: number };
}

function options(overrides: Partial<BrowserObservationOptions> = {}): BrowserObservationOptions {
  return {
    operationId: "operation-1",
    target: {
      providerId: "provider-1",
      browserId: "browser-1",
      tabId: "tab-1",
      coordinationScope: "process",
      authoritativeTabClaim: "claim-1",
      expectedConversationId: "conversation-1",
      expectedThreadId: "thread-1"
    },
    evidenceDigest: digest,
    ...overrides
  };
}

/**
 * A deliberately tiny browser-realm DOM.  querySelectorAll throws so these
 * regressions prove the serialized probe uses its bounded DOM-pointer path;
 * the tree is a long chain (or a text/comment-heavy sibling list) so a
 * traversal that queues a whole result set would be observable without
 * requiring jsdom in the unit-test process.
 */
type SyntheticChild = SyntheticElement | SyntheticLeaf;

class SyntheticElement {
  readonly nodeType = 1;
  readonly nodeValue = null;
  parentNode: SyntheticElement | SyntheticDocument | null = null;
  firstChild: SyntheticChild | null = null;
  lastChild: SyntheticChild | null = null;
  nextSibling: SyntheticChild | null = null;
  previousSibling: SyntheticChild | null = null;
  ownerDocument: SyntheticDocument;
  readonly tagName: string;
  private readonly attributes: Record<string, string>;

  constructor(ownerDocument: SyntheticDocument, tagName: string, attributes: Record<string, string> = {}) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
  }

  get children(): SyntheticElement[] {
    const children: SyntheticElement[] = [];
    for (let child = this.firstChild; child !== null; child = child.nextSibling) {
      if (child instanceof SyntheticElement) children.push(child);
    }
    return children;
  }

  append(child: SyntheticChild): void {
    child.parentNode = this;
    if (this.lastChild === null) {
      this.firstChild = child;
      this.lastChild = child;
      return;
    }
    child.previousSibling = this.lastChild;
    this.lastChild.nextSibling = child;
    this.lastChild = child;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return Object.hasOwn(this.attributes, name);
  }

  matches(selector: string): boolean {
    if (selector === "*") return true;
    if (selector.includes("[data-message-author-role]") && this.hasAttribute("data-message-author-role")) return true;
    if (selector.includes("[data-conversation-id]") && this.hasAttribute("data-conversation-id")) return true;
    if (selector.includes("[data-thread-id]") && this.hasAttribute("data-thread-id")) return true;
    if (selector.includes("[data-testid^='conversation-turn']")
      && (this.getAttribute("data-testid")?.startsWith("conversation-turn") ?? false)) return true;
    return false;
  }

  closest(selector: string): SyntheticElement | null {
    let current: SyntheticElement | SyntheticDocument | null = this;
    while (current instanceof SyntheticElement) {
      if (current.matches(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  querySelectorAll(): never {
    throw new Error("unbounded querySelectorAll must not be used");
  }
}

class SyntheticLeaf {
  readonly nodeType: 3 | 8;
  readonly nodeValue: string;
  parentNode: SyntheticElement | SyntheticDocument | null = null;
  readonly firstChild = null;
  readonly lastChild = null;
  nextSibling: SyntheticChild | null = null;
  previousSibling: SyntheticChild | null = null;
  ownerDocument: SyntheticDocument;

  constructor(ownerDocument: SyntheticDocument, nodeType: 3 | 8, value = "") {
    this.ownerDocument = ownerDocument;
    this.nodeType = nodeType;
    this.nodeValue = value;
  }
}

class SyntheticDocument {
  readonly nodeType = 9;
  readonly nodeValue = null;
  readonly ownerDocument = null;
  firstChild: SyntheticChild | null = null;
  lastChild: SyntheticChild | null = null;

  append(child: SyntheticChild): void {
    child.parentNode = this;
    if (this.lastChild === null) {
      this.firstChild = child;
      this.lastChild = child;
      return;
    }
    child.previousSibling = this.lastChild;
    this.lastChild.nextSibling = child;
    this.lastChild = child;
  }

  createTreeWalker(root: SyntheticDocument | SyntheticElement, whatToShow = 0xffffffff): { nextNode: () => SyntheticChild | null } {
    let current: SyntheticChild | null = null;
    const shows = (node: SyntheticChild): boolean => whatToShow === 0xffffffff
      || (whatToShow & (1 << (node.nodeType - 1))) !== 0;
    return {
      nextNode: () => {
        while (true) {
          if (current === null) {
            current = root.firstChild;
          } else if (current.firstChild !== null) {
            current = current.firstChild;
          } else {
            while (current !== null && current !== root && current.nextSibling === null) {
              current = current.parentNode instanceof SyntheticElement ? current.parentNode : null;
            }
            if (current === root || current === null) return null;
            current = current.nextSibling;
          }
          if (current === null || shows(current)) return current;
        }
      }
    };
  }

  querySelectorAll(): never {
    throw new Error("unbounded querySelectorAll must not be used");
  }
}

function syntheticDocument(descendantCount: number, siblingNoise = 0): SyntheticDocument {
  const document = new SyntheticDocument();
  const root = new SyntheticElement(document, "div", {
    "data-testid": "conversation-turn-1",
    "data-message-author-role": "user",
    "data-message-id": "user-1",
    "data-conversation-id": "conversation-1",
    "data-thread-id": "thread-1"
  });
  document.append(root);
  let parent = root;
  for (let index = 0; index < descendantCount; index += 1) {
    const child = new SyntheticElement(document, "span");
    parent.append(child);
    parent = child;
  }
  for (let index = 0; index < siblingNoise; index += 1) {
    document.append(new SyntheticLeaf(document, index % 2 === 0 ? 3 : 8));
  }
  return document;
}

function providerConversationDocument(generating = false): SyntheticDocument {
  const document = new SyntheticDocument();
  const userRoot = new SyntheticElement(document, "section", {
    "data-testid": "conversation-turn-1",
    "data-turn-id": "user-container-1",
    "data-conversation-id": "conversation-1",
    "data-thread-id": "thread-1"
  });
  userRoot.append(new SyntheticElement(document, "div", {
    "data-message-author-role": "user",
    "data-message-id": "user-1"
  }));
  document.append(userRoot);

  const assistantRoot = new SyntheticElement(document, "section", {
    "data-testid": "conversation-turn-2",
    "data-turn-id": "request-WEB:assistant-container-1"
  });
  assistantRoot.append(new SyntheticElement(document, "div", {
    "data-message-author-role": "assistant",
    "data-message-id": "assistant-1"
  }));
  document.append(assistantRoot);
  if (generating) {
    document.append(new SyntheticElement(document, "button", { "data-testid": "stop-button" }));
  }
  return document;
}

function conversationDocumentWithHiddenMessageText(): SyntheticDocument {
  const document = new SyntheticDocument();
  const root = new SyntheticElement(document, "section", {
    "data-testid": "conversation-turn-1",
    "data-conversation-id": "conversation-1",
    "data-thread-id": "thread-1"
  });
  const role = new SyntheticElement(document, "div", {
    "data-message-author-role": "user",
    "data-message-id": "user-1"
  });
  role.append(new SyntheticLeaf(document, 3, "visible before "));
  const hidden = new SyntheticElement(document, "span", { hidden: "" });
  hidden.append(new SyntheticLeaf(document, 3, "stale hidden content"));
  role.append(hidden);
  role.append(new SyntheticLeaf(document, 3, "visible after"));
  root.append(role);
  document.append(root);
  return document;
}

function readSynthetic(document: SyntheticDocument): ReturnType<typeof readPageObservation> {
  return readSyntheticWithOptions(document, {});
}

function readSyntheticWithOptions(
  document: SyntheticDocument,
  overrides: Partial<{ maxTurns: number; maxTextChars: number; maxArtifactsPerTurn: number; href: string }> = {}
): ReturnType<typeof readPageObservation> {
  const { href = "https://chatgpt.com/c/conversation-1", ...readOptions } = overrides;
  const previousDocument = (globalThis as { document?: unknown }).document;
  const previousLocation = (globalThis as { location?: unknown }).location;
  Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: document });
  Object.defineProperty(globalThis, "location", { configurable: true, writable: true, value: { href } });
  try {
    return readPageObservation({ maxTurns: 1, maxTextChars: 512, maxArtifactsPerTurn: 1, ...readOptions });
  } finally {
    if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: previousDocument });
    if (previousLocation === undefined) delete (globalThis as { location?: unknown }).location;
    else Object.defineProperty(globalThis, "location", { configurable: true, writable: true, value: previousLocation });
  }
}

function aggregateBudgetArtifactDocument(): { document: SyntheticDocument; sentinelTouched: () => boolean } {
  const document = new SyntheticDocument();
  const root = new SyntheticElement(document, "div", {
    "data-testid": "conversation-turn-1",
    "data-message-author-role": "user",
    "data-message-id": "user-1",
    "data-conversation-id": "conversation-1",
    "data-thread-id": "thread-1"
  });
  document.append(root);
  for (const identity of ["artifact-1", "artifact-2"]) {
    const artifact = new SyntheticElement(document, "a", {
      "data-file-id": identity,
      download: ""
    });
    artifact.append(new SyntheticLeaf(document, 3, ""));
    root.append(artifact);
  }
  // The two artifact subtrees account for five nodes including the turn root;
  // fill the remaining aggregate budget with comments. The sentinel is the
  // 4,097th node and must not be observed or dereferenced.
  for (let index = 0; index < 32_763; index += 1) root.append(new SyntheticLeaf(document, 8, ""));
  let sentinelTouched = false;
  const sentinel = new SyntheticLeaf(document, 3, "sentinel");
  Object.defineProperty(sentinel, "nodeValue", {
    configurable: true,
    get: () => {
      sentinelTouched = true;
      return "sentinel";
    }
  });
  root.append(sentinel);
  return { document, sentinelTouched: () => sentinelTouched };
}

function nestedTurnRootDocument(): { document: SyntheticDocument; sentinelTouched: () => boolean } {
  const document = new SyntheticDocument();
  const outer = new SyntheticElement(document, "div", {
    "data-testid": "conversation-turn-outer",
    "data-message-author-role": "user",
    "data-message-id": "outer",
    "data-conversation-id": "conversation-1",
    "data-thread-id": "thread-1"
  });
  document.append(outer);
  outer.append(new SyntheticElement(document, "div", { "data-testid": "conversation-turn-nested" }));
  let sentinelTouched = false;
  const sentinel = new SyntheticLeaf(document, 3, "sentinel");
  Object.defineProperty(sentinel, "nodeValue", {
    configurable: true,
    get: () => {
      sentinelTouched = true;
      return "sentinel";
    }
  });
  outer.append(sentinel);
  return { document, sentinelTouched: () => sentinelTouched };
}

describe("browser observation adapter", () => {
  it("accepts a descriptor-safe blank-task observation returned from another realm", async () => {
    const foreignObservation = runInNewContext(`({
      canonicalUrl: "https://chatgpt.com/",
      turns: [],
      completeness: "complete",
      terminalState: "idle"
    })`) as unknown;
    const page: PageLike = { evaluate: async <T>() => foreignObservation as T };

    const result = await observeBrowserPage(page, options({
      target: {
        providerId: "provider-1",
        browserId: "browser-1",
        tabId: "tab-1",
        coordinationScope: "process",
        targetLifecycle: "new_pending"
      }
    }));

    expect(result.snapshot).toMatchObject({
      completeness: "complete",
      terminalState: "idle",
      userTurns: [],
      assistantTurns: []
    });
    expect(result.newTargetAnchor).toBeDefined();
  });

  it("keeps the serialized page-evaluate callback free of module-scope runtime dependencies", () => {
    const serialized = readPageObservation.toString();
    expect(serialized).not.toContain("globalThis.document");
    expect(serialized).not.toContain("globalThis.location");
    expect(serialized).not.toContain("globalThis.getComputedStyle");
    expect(serialized).not.toContain("createTreeWalker");
    const reconstructed = Function(`"use strict"; return (${serialized});`)() as typeof readPageObservation;
    expect(() => reconstructed({ maxTurns: 1, maxTextChars: 1, maxArtifactsPerTurn: 1 })).toThrow("document unavailable");
  });

  it("accepts the live provider shape with a structural turn container and nested message identity", () => {
    const result = readSyntheticWithOptions(providerConversationDocument(), { maxTurns: 2 });

    expect(result.turns).toEqual([
      expect.objectContaining({ role: "user", stableId: "user-1", ordinal: 0 }),
      expect.objectContaining({
        role: "assistant",
        stableId: "assistant-1",
        parentStableId: "user-1",
        branchStableId: "assistant-1",
        ordinal: 0,
        state: "terminal",
        finishReason: "provider_terminal"
      })
    ]);
    expect(result.terminalState).toBe("terminal");
  });

  it("infers only the latest assistant as generating from one visible structural Stop control", () => {
    const result = readSyntheticWithOptions(providerConversationDocument(true), { maxTurns: 2 });

    expect(result.turns[1]).toMatchObject({
      role: "assistant",
      stableId: "assistant-1",
      parentStableId: "user-1",
      branchStableId: "assistant-1",
      state: "generating"
    });
    expect(result.turns[1]?.finishReason).toBeUndefined();
    expect(result.terminalState).toBe("generating");
  });

  it("excludes hidden descendant text from an otherwise visible owned turn", () => {
    const result = readSynthetic(conversationDocumentWithHiddenMessageText());

    expect(result.turns[0]?.text).toBe("visible before visible after");
    expect(result.turns[0]?.text).not.toContain("stale hidden content");
  });

  it("normalizes a text-only terminal turn in one page evaluation", async () => {
    const page = fakePage(observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, {
        parentStableId: "user-1",
        branchStableId: "branch-1",
        state: "terminal",
        finishReason: "stop"
      })
    ]));
    const result = await observeBrowserPage(page, options({ terminalAssistantTurnId: "assistant-1" }));

    expect(page.evaluateCount).toBe(1);
    expect(result.snapshot.userTurns).toHaveLength(1);
    expect(result.snapshot.assistantTurns[0]).toMatchObject({ stableId: "assistant-1", parentStableId: "user-1", branchStableId: "branch-1", state: "terminal" });
    expect(result.terminal).toMatchObject({
      assistantTurnId: "assistant-1",
      userTurnId: "user-1",
      userTurnEvidenceDigest: expect.stringMatching(/^hmac-sha256:/),
      finishReason: "stop"
    });
    expect(result.terminal?.rawText).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("private response");
    expect(result.snapshot.target.canonicalThreadUrl.status).toBe("available");
    if (result.snapshot.target.canonicalThreadUrl.status === "available") {
      expect(result.snapshot.target.canonicalThreadUrl.value).not.toContain("chatgpt.com");
    }
  });

  it("proves a blank new-task anchor without manufacturing a conversation identity", async () => {
    const page = fakePage({
      canonicalUrl: "https://chatgpt.com/",
      turns: [],
      completeness: "complete",
      terminalState: "idle"
    });
    const result = await observeBrowserPage(page, options({
      target: {
        providerId: "provider-1",
        browserId: "browser-1",
        tabId: "tab-new",
        coordinationScope: "process",
        targetLifecycle: "new_pending"
      }
    }));
    expect(result.snapshot.target.conversation).toEqual({ status: "unavailable", reason: "not_observed" });
    expect(result.snapshot.target.canonicalThreadUrl).toEqual({ status: "unavailable", reason: "not_observed" });
    expect(result.newTargetAnchor?.anchorDigest).toMatch(/^hmac-sha256:/);
    expect(result.newTargetAnchor?.blankTaskEvidenceDigest).toBe(result.snapshot.snapshotDigest);
    expect(JSON.stringify(result)).not.toContain("chatgpt.com/");
  });

  it("keeps image, file, and mixed artifact identities on one shared turn path", async () => {
    const artifacts: RawArtifact[] = [
      { kind: "image", identity: "image-1", contentDigest: "sha256:" + "1".repeat(64), mimeType: "image/png", bytes: 12 },
      { kind: "file", identity: "file-1", contentDigest: "sha256:" + "2".repeat(64), mimeType: "text/plain", bytes: 34 },
      { kind: "other", identity: "other-1", bytes: 56 }
    ];
    const page = fakePage(observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, {
        parentStableId: "user-1",
        branchStableId: "branch-1",
        state: "terminal",
        finishReason: "stop",
        artifacts
      })
    ]));
    const result = await observeBrowserPage(page, options({ terminalAssistantTurnId: "assistant-1" }));

    expect(result.snapshot.assistantTurns[0]?.artifactEvidenceDigests).toHaveLength(3);
    expect(result.terminal?.artifacts).toHaveLength(3);
    expect(result.terminal?.artifacts.map(item => item.kind)).toEqual(["image", "file", "other"]);
    expect(result.terminal?.artifacts.every(item => item.sourceIdentityDigest.startsWith("hmac-sha256:"))).toBe(true);
  });

  it("reports a generating turn without inventing a terminal receipt", async () => {
    const page = fakePage(observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, {
        parentStableId: "user-1",
        branchStableId: "branch-1",
        state: "generating"
      })
    ]));
    const result = await observeBrowserPage(page, options());
    expect(result.snapshot.terminalState).toBe("generating");
    expect(result.terminal).toBeUndefined();
  });

  it("distinguishes repeated prompt text by stable turn identity", async () => {
    const page = fakePage(observation([
      turn("user", "user-old", 0),
      turn("assistant", "assistant-old", 0, { parentStableId: "user-old", branchStableId: "branch-old", state: "terminal", finishReason: "stop" }),
      turn("user", "user-new", 1),
      turn("assistant", "assistant-new", 1, { parentStableId: "user-new", branchStableId: "branch-new", state: "terminal", finishReason: "stop" })
    ]));
    const result = await observeBrowserPage(page, options({ terminalAssistantTurnId: "assistant-new" }));
    expect(result.snapshot.userTurns.map(item => item.stableId)).toEqual(["user-old", "user-new"]);
    expect(result.snapshot.userTurns[0]?.evidenceDigest).not.toBe(result.snapshot.userTurns[1]?.evidenceDigest);
  });

  it("emits an exact post-Send delta against a complete baseline", async () => {
    const first = await observeBrowserPage(fakePage(observation([
      turn("user", "user-old", 0),
      turn("assistant", "assistant-old", 0, { parentStableId: "user-old", branchStableId: "branch-old", state: "terminal", finishReason: "stop" })
    ])), options({ terminalAssistantTurnId: "assistant-old" }));
    const baseline: OwnershipBaseline = {
      schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
      snapshotDigest: first.snapshot.snapshotDigest,
      target: first.snapshot.target,
      userTurns: first.snapshot.userTurns,
      assistantTurns: first.snapshot.assistantTurns,
      completeness: "complete"
    };
    const second = await observeBrowserPage(fakePage(observation([
      turn("user", "user-old", 0),
      turn("assistant", "assistant-old", 0, { parentStableId: "user-old", branchStableId: "branch-old", state: "terminal", finishReason: "stop" }),
      turn("user", "user-new", 1),
      turn("assistant", "assistant-new", 1, { parentStableId: "user-new", branchStableId: "branch-new", state: "generating" })
    ])), options({ baseline }));
    expect(second.snapshot.postSendDelta?.baselineSnapshotDigest).toBe(first.snapshot.snapshotDigest);
    expect(second.snapshot.postSendDelta?.addedUserEvidenceDigests).toHaveLength(1);
    expect(second.snapshot.postSendDelta?.deltaDigest).toMatch(/^hmac-sha256:/);
  });

  it("fails closed for duplicate or ambiguous branch identities", async () => {
    const duplicate = fakePage(observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, { parentStableId: "user-1", branchStableId: "branch-1", state: "terminal", finishReason: "stop" }),
      turn("assistant", "assistant-2", 1, { parentStableId: "user-1", branchStableId: "branch-1", state: "terminal", finishReason: "stop" })
    ]));
    await expect(observeBrowserPage(duplicate, options())).rejects.toMatchObject({ code: "branch_ambiguous" });

    const duplicateId = fakePage(observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, { parentStableId: "user-1", branchStableId: "branch-1", state: "terminal", finishReason: "stop" }),
      turn("user", "user-1", 1)
    ]));
    await expect(observeBrowserPage(duplicateId, options())).rejects.toMatchObject({ code: "duplicate_identity" });
  });

  it("preserves distinct regeneration branches for the classifier to reject", async () => {
    const page = fakePage(observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-a", 0, { parentStableId: "user-1", branchStableId: "branch-a", state: "terminal", finishReason: "stop" }),
      turn("assistant", "assistant-b", 1, { parentStableId: "user-1", branchStableId: "branch-b", state: "terminal", finishReason: "stop" })
    ]));
    const result = await observeBrowserPage(page, options({ terminalAssistantTurnId: "assistant-a" }));
    expect(result.snapshot.assistantTurns.map(item => item.branchStableId)).toEqual(["branch-a", "branch-b"]);
    expect(result.terminal?.assistantTurnId).toBe("assistant-a");
  });

  it("rejects incomplete/unbounded provider output with fixed diagnostics", async () => {
    const missingState = fakePage(observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, { parentStableId: "user-1", branchStableId: "branch-1" })
    ], { terminalState: "unknown" }));
    await expect(observeBrowserPage(missingState, options())).rejects.toMatchObject({ code: "provider_shape_drift" });

    const oversized = fakePage(observation([
      turn("user", "user-1", 0, { text: "x".repeat(10) })
    ]));
    await expect(observeBrowserPage(oversized, options({ maxTextChars: 5 }))).rejects.toMatchObject({ code: "bounded_limit_exceeded" });

    const shapeDrift = fakePage({
      ...observation([]),
      unexpectedProviderField: "must not be accepted"
    });
    await expect(observeBrowserPage(shapeDrift, options())).rejects.toMatchObject({ code: "provider_shape_drift" });
  });

  it("returns raw content only for an explicit exact terminal assistant request", async () => {
    const payload = observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, { parentStableId: "user-1", branchStableId: "branch-1", state: "terminal", finishReason: "stop" })
    ]);
    const metadata = await observeBrowserPage(fakePage(payload), options({ terminalAssistantTurnId: "assistant-1" }));
    expect(metadata.terminal?.rawText).toBeUndefined();

    const include = await observeBrowserPage(fakePage(payload), options({ responseContent: "include", terminalAssistantTurnId: "assistant-1", rawAssistantTurnId: "assistant-1" }));
    expect(include.terminal?.rawText).toBe("private response");
    expect(JSON.stringify(include.snapshot)).not.toContain("private response");
    expect(() => options({ responseContent: "include" })).not.toThrow();
    await expect(observeBrowserPage(fakePage(payload), options({ responseContent: "include" }))).rejects.toMatchObject({ code: "raw_content_unavailable" });
  });

  it("preserves code, list, and table semantics for an exact Markdown capture", async () => {
    const payload = observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, {
        parentStableId: "user-1",
        branchStableId: "branch-1",
        state: "terminal",
        finishReason: "stop",
        text: "Title one two const x = 1; A B",
        contentHtml: [
          "<h1>Title</h1>",
          "<ol><li>one</li><li>two</li></ol>",
          "<pre><code class='language-ts'>const x = 1;\n</code></pre>",
          "<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>"
        ].join("")
      })
    ]);
    const result = await observeBrowserPage(fakePage(payload), options({
      responseContent: "include",
      responseFormat: "markdown",
      terminalAssistantTurnId: "assistant-1",
      rawAssistantTurnId: "assistant-1"
    }));

    expect(result.terminal?.responseFormat).toBe("markdown");
    expect(result.terminal?.rawText).toContain("# Title");
    expect(result.terminal?.rawText).toContain("1. one\n2. two");
    expect(result.terminal?.rawText).toContain("```ts\nconst x = 1;\n```");
    expect(result.terminal?.rawText).toContain("| A |\n| --- |\n| B |");
  });

  it("returns normalized text when the immutable transactional format is text", async () => {
    const payload = observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, {
        parentStableId: "user-1",
        branchStableId: "branch-1",
        state: "terminal",
        finishReason: "stop",
        text: "Title one two",
        contentHtml: "<h1>Title</h1><ul><li>one</li><li>two</li></ul>"
      })
    ]);
    const result = await observeBrowserPage(fakePage(payload), options({
      responseContent: "include",
      responseFormat: "text",
      terminalAssistantTurnId: "assistant-1",
      rawAssistantTurnId: "assistant-1"
    }));

    expect(result.terminal?.responseFormat).toBe("text");
    expect(result.terminal?.rawText).toBe("Title one two");
    expect(result.terminal?.rawText).not.toContain("#");
    expect(result.terminal?.rawText).not.toContain("- one");
  });

  it("fails closed for format drift, a wrong exact turn, malformed markup, and over-limit markup", async () => {
    const payload = observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, {
        parentStableId: "user-1",
        branchStableId: "branch-1",
        state: "terminal",
        finishReason: "stop"
      }),
      turn("assistant", "assistant-2", 1, {
        parentStableId: "user-1",
        branchStableId: "branch-2",
        state: "terminal",
        finishReason: "stop"
      })
    ]);
    await expect(observeBrowserPage(fakePage(payload), options({
      responseContent: "include",
      responseFormat: "html" as never,
      terminalAssistantTurnId: "assistant-1",
      rawAssistantTurnId: "assistant-1"
    }))).rejects.toMatchObject({ code: "provider_shape_drift" });
    await expect(observeBrowserPage(fakePage(payload), options({
      responseContent: "include",
      terminalAssistantTurnId: "assistant-2",
      rawAssistantTurnId: "assistant-1"
    }))).rejects.toMatchObject({ code: "raw_content_unavailable" });

    const malformed = observation([turn("user", "user-1", 0), turn("assistant", "assistant-1", 0, {
      parentStableId: "user-1",
      branchStableId: "branch-1",
      state: "terminal",
      finishReason: "stop",
      contentHtml: "<script>private-only</script>",
      text: "private-only"
    })]);
    await expect(observeBrowserPage(fakePage(malformed), options({ terminalAssistantTurnId: "assistant-1" }))).rejects.toMatchObject({ code: "provider_shape_drift" });

    const oversized = observation([turn("user", "user-1", 0), turn("assistant", "assistant-1", 0, {
      parentStableId: "user-1",
      branchStableId: "branch-1",
      state: "terminal",
      finishReason: "stop",
      text: "ok",
      contentHtml: `<p>${"x".repeat(40)}</p>`
    })]);
    await expect(observeBrowserPage(fakePage(oversized), options({ terminalAssistantTurnId: "assistant-1", maxTextChars: 8 }))).rejects.toMatchObject({ code: "bounded_limit_exceeded" });
  });

  it("does not journal transient HTML or ignored private DOM content", async () => {
    const payload = observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, {
        parentStableId: "user-1",
        branchStableId: "branch-1",
        state: "terminal",
        finishReason: "stop",
        text: "safe answer",
        contentHtml: "<p>safe answer</p><script>private-only-dom-content</script>"
      })
    ]);
    const result = await observeBrowserPage(fakePage(payload), options({
      responseContent: "include",
      terminalAssistantTurnId: "assistant-1",
      rawAssistantTurnId: "assistant-1"
    }));
    expect(JSON.stringify(result)).not.toContain("private-only-dom-content");
    expect(JSON.stringify(result.snapshot)).not.toContain("safe answer");
    expect(result.terminal?.rawText).toBe("safe answer");
  });

  it("does not leak prompt, response, or URL material through digest outputs", async () => {
    const seen: unknown[] = [];
    const page = fakePage(observation([
      turn("user", "user-1", 0, { text: "secret prompt" }),
      turn("assistant", "assistant-1", 0, { parentStableId: "user-1", branchStableId: "branch-1", state: "terminal", finishReason: "stop", text: "secret response" })
    ]));
    const result = await observeBrowserPage(page, options({
      terminalAssistantTurnId: "assistant-1",
      responseContent: "include",
      rawAssistantTurnId: "assistant-1",
      evidenceDigest: (domain, material) => {
        seen.push({ domain, material });
        return digest(domain, material);
      }
    }));
    expect(JSON.stringify(result.snapshot)).not.toMatch(/secret (prompt|response)|chatgpt\.com/);
    expect(seen.some(item => JSON.stringify(item).includes("secret prompt"))).toBe(true);
    expect(seen.some(item => JSON.stringify(item).includes("secret response"))).toBe(true);
    expect(seen.some(item => JSON.stringify(item).includes("chatgpt.com"))).toBe(true);
    expect(result.terminal?.rawText).toBe("secret response");
  });

  it("uses fixed error messages rather than leaking provider details", async () => {
    const page = fakePage({ turns: "not-an-array" });
    await expect(observeBrowserPage(page, options())).rejects.toEqual(expect.objectContaining({
      name: "BrowserObservationError",
      code: "navigation_ambiguous",
      message: "Browser observation could not prove one canonical conversation navigation target."
    } satisfies Partial<BrowserObservationError>));
  });

  it("traverses exactly at the DOM node bound without materializing query results", () => {
    const result = readSynthetic(syntheticDocument(32_767));
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]?.stableId).toBe("user-1");
  });

  it("does not force a layout/style read for every ordinary DOM wrapper", () => {
    const previous = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
    let styleReads = 0;
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      writable: true,
      value: () => {
        styleReads += 1;
        return { display: "block", visibility: "visible", opacity: "1" };
      }
    });
    try {
      expect(readSynthetic(syntheticDocument(2_048)).turns).toHaveLength(1);
      expect(styleReads).toBe(1);
    } finally {
      if (previous === undefined) delete (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
      else Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, writable: true, value: previous });
    }
  });

  it("fails closed as soon as the serialized DOM traversal exceeds its node bound", () => {
    expect(() => readSynthetic(syntheticDocument(32_768))).toThrow("node limit exceeded");
  });

  it("counts text and comment nodes even when the element tree is small", () => {
    expect(() => readSynthetic(syntheticDocument(0, 32_767))).not.toThrow();
    expect(() => readSynthetic(syntheticDocument(0, 32_768))).toThrow("node limit exceeded");
  });

  it("enforces one aggregate budget across multiple artifact subtrees", () => {
    const fixture = aggregateBudgetArtifactDocument();
    expect(() => readSyntheticWithOptions(fixture.document, { maxArtifactsPerTurn: 2 })).toThrow("node limit exceeded");
    expect(fixture.sentinelTouched()).toBe(false);
  });

  it("rejects nested turn roots before traversing the post-drift sentinel", () => {
    const fixture = nestedTurnRootDocument();
    expect(() => readSynthetic(fixture.document)).toThrow("nested turn root");
    expect(fixture.sentinelTouched()).toBe(false);
  });

  it("rejects stale DOM conversation identity after navigation changes", () => {
    expect(() => readSyntheticWithOptions(syntheticDocument(0), {
      href: "https://chatgpt.com/c/different-conversation"
    })).toThrow("conversation navigation mismatch");
  });
});


describe("asynchronous observation authority", () => {
  it("bounds delayed turn and artifact digests to four calls while preserving stable output order", async () => {
    const turns = Array.from({ length: 8 }, (_, index) => turn(index % 2 === 0 ? "user" : "assistant", `turn-${index}`, Math.floor(index / 2), {
      ...(index % 2 === 0 ? {} : { parentStableId: `turn-${index - 1}`, branchStableId: `branch-${index}`, state: "terminal" as const, finishReason: "stop" }),
      artifacts: Array.from({ length: 3 }, (_, ordinal) => ({ kind: "file" as const, identity: `artifact-${index}-${ordinal}` }))
    }));
    const raw = observation(turns);
    const expected = await observeBrowserPage(fakePage(raw), options());
    let active = 0;
    let maximum = 0;
    const completed: string[] = [];
    const observed = await observeBrowserPage(fakePage(raw), options({ evidenceDigest: async (domain, material) => {
      active += 1; maximum = Math.max(maximum, active);
      try {
        const stableId = (material as { stableId?: string }).stableId;
        await new Promise(resolve => setTimeout(resolve, stableId === "turn-0" ? 20 : 1));
        if (domain === "browser-observation-turn") completed.push(stableId!);
        return digest(domain, material);
      } finally { active -= 1; }
    } }));
    expect(maximum).toBe(4);
    expect(active).toBe(0);
    expect(completed[0]).not.toBe("turn-0");
    expect(observed).toEqual(expected);
    expect(observed.snapshot.userTurns.map(value => value.stableId)).toEqual(["turn-0", "turn-2", "turn-4", "turn-6"]);
    expect(observed.snapshot.assistantTurns.map(value => value.stableId)).toEqual(["turn-1", "turn-3", "turn-5", "turn-7"]);
  });

  it.each(["artifact", "turn", "structure"])("stops admission and drains active %s digests before returning a redacted failure", async stage => {
    const raw = observation(Array.from({ length: 12 }, (_, index) => turn("user", `user-${index}`, index, {
      artifacts: [{ kind: "file", identity: `artifact-${index}` }]
    })));
    let fail!: () => void;
    let release!: () => void;
    const failureGate = new Promise<void>(resolve => { fail = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    let active = 0;
    let settled = false;
    const pending = observeBrowserPage(fakePage(raw), options({ evidenceDigest: async (domain, material) => {
      if (domain !== `browser-observation-${stage}`) return digest(domain, material);
      started += 1; active += 1;
      const ordinal = started;
      try {
        if (ordinal === 1) { await failureGate; throw new Error("private authority detail"); }
        await held;
        return digest(domain, material);
      } finally { active -= 1; }
    } })).then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    try {
      await vi.waitFor(() => expect(started).toBe(4));
      fail();
      await vi.waitFor(() => expect(active).toBe(3));
      expect(settled).toBe(false);
      expect(started).toBe(4);
    } finally { fail(); release(); }
    const error = await pending;
    expect(error).toBeInstanceOf(BrowserObservationError);
    expect(error.code).toBe("evidence_digest_failed");
    expect(error.message).not.toContain("private authority detail");
    expect(started).toBe(4);
    expect(active).toBe(0);
  });

  it("preserves every turn, artifact, structure, terminal and snapshot digest", async () => {
    const raw = observation([
      turn("user", "user-1", 0),
      turn("assistant", "assistant-1", 0, { parentStableId: "user-1", branchStableId: "branch-1", state: "terminal", finishReason: "stop", artifacts: [{ kind: "file", identity: "artifact-1" }] })
    ]);
    const base = options({ terminalAssistantTurnId: "assistant-1" });
    const synchronous = await observeBrowserPage(fakePage(raw), base);
    const asynchronous = await observeBrowserPage(fakePage(raw), { ...base, evidenceDigest: async (domain, material) => {
      await Promise.resolve();
      return digest(domain, material);
    } });
    expect(asynchronous).toEqual(synchronous);
    await expect(observeBrowserPage(fakePage(raw), { ...base, evidenceDigest: async () => { throw new Error("private authority failure"); } }))
      .rejects.toBeInstanceOf(BrowserObservationError);
  });
});
