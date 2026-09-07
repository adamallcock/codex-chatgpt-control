import { describe, expect, it, vi } from "vitest";
import type { FileChooserLike, LocatorLike, PageLike } from "../../src/types.js";
import {
  createChatGPTAttachmentProvider,
  createChatGPTAttachmentProviderAsync,
  type ChatGPTAttachmentProviderOptions
} from "../../src/operations/production-chatgpt-attachments.js";
import type { OperationFileIdentity } from "../../src/operations/file-identity.js";
import type { SubmissionAttachmentRequest, SubmissionHandoffRequest } from "../../src/operations/submission.js";
import type { OperationTargetBindingV1 } from "../../src/operations/types.js";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTION_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_DIGEST = digest("request", "chatgpt-attachment-request");
const TARGET_DIGEST = digest("target", "chatgpt-attachment-target");
const IDENTITY_A = digest("identity", "a");
const IDENTITY_B = digest("identity", "b");
const CONTENT_A = "a".repeat(64);
const CONTENT_B = "b".repeat(64);
const SECRET_PATH = "/private/should-never-leak/meeting-notes.pdf";
const SECRET_NAME = "meeting-notes.pdf";

const target: OperationTargetBindingV1 = {
  providerId: "chatgpt",
  browserId: "chrome-extension",
  tabId: "tab-attachment-1",
  coordinationScope: "process",
  conversationId: "conversation-1",
  canonicalThreadUrl: "https://opaque.invalid/thread/" + "1".repeat(64),
  evidenceProfile: {
    providerIdentity: "required",
    stableTabId: "required",
    stableConversationId: "required",
    stableUserTurnId: "unavailable",
    authoritativeTabClaim: "unavailable",
    replacementTabRecovery: false
  }
};

function digest(domain: string, material: unknown): string {
  const text = `${domain}:${JSON.stringify(material)}`;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return `hmac-sha256:${hash.toString(16).padStart(8, "0").repeat(8).slice(0, 64)}`;
}

function identity(
  sourcePath: string,
  displayName: string,
  contentSha256: string,
  bytes: number
): OperationFileIdentity {
  return {
    sourcePath,
    manifest: { displayName, contentSha256, bytes },
    proof: { device: "1", inode: "2", size: String(bytes), modifiedNs: "3", changedNs: "4" }
  };
}

const fileA = identity(SECRET_PATH, SECRET_NAME, CONTENT_A, 10);
const fileB = identity("/private/should-never-leak/second.txt", "second.txt", CONTENT_B, 20);

function manifest(files: readonly OperationFileIdentity[] = [fileA]): SubmissionHandoffRequest["manifest"] {
  return {
    count: files.length,
    orderPolicy: "exact",
    identities: files.map((file, ordinal) => ({
      identityDigest: file.manifest.contentSha256 === CONTENT_A ? IDENTITY_A : IDENTITY_B,
      ordinal
    }))
  };
}

function handoffRequest(files: readonly OperationFileIdentity[] = [fileA]): SubmissionHandoffRequest {
  return {
    operationId: OPERATION_ID,
    requestDigest: REQUEST_DIGEST,
    surface: "chat",
    actionId: ACTION_ID,
    targetBindingDigest: TARGET_DIGEST,
    manifest: manifest(files)
  };
}

function attachmentRequest(files: readonly OperationFileIdentity[] = [fileA]): SubmissionAttachmentRequest {
  const request = handoffRequest(files);
  return {
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    surface: request.surface,
    targetBindingDigest: request.targetBindingDigest,
    manifest: request.manifest
  };
}

type ProbeState = {
  files: readonly OperationFileIdentity[];
  direct?: boolean;
  menu?: boolean;
  menuRow?: boolean;
  malformed?: boolean;
  leaky?: boolean;
  ambiguous?: boolean;
  localized?: boolean;
  clearedInput?: boolean;
  mixed?: boolean;
  duplicateNames?: boolean;
  mismatchBytes?: boolean;
  reordered?: boolean;
  deferSetFiles?: boolean;
  activationCandidateCount?: number;
  sendReady?: boolean;
};

type FakePage = PageLike & {
  chooserCalls: number;
  clickCalls: number;
  setFilesCalls: number;
  uploadedPaths: string[][];
  evaluateCalls: number;
  setFilesStarted: boolean;
  state: ProbeState;
  resolveChooser?: () => void;
  releaseSetFiles?: () => void;
};

function makePage(initial: Partial<ProbeState> = {}): FakePage {
  const page = {
    chooserCalls: 0,
    clickCalls: 0,
    setFilesCalls: 0,
    uploadedPaths: [],
    evaluateCalls: 0,
    setFilesStarted: false,
    state: {
      files: [],
      direct: true,
      ...initial
    }
  } as FakePage;
  let chooserResolve: ((chooser: FileChooserLike) => void) | undefined;
  const chooser: FileChooserLike = {
    setFiles: async paths => {
      page.setFilesCalls += 1;
      page.uploadedPaths.push([...paths]);
      page.state.files = page.state.files.length > 0 ? page.state.files : [fileA];
      page.setFilesStarted = true;
      if (page.state.deferSetFiles) {
        await new Promise<void>(resolve => {
          page.releaseSetFiles = resolve;
        });
      }
    }
  };
  page.resolveChooser = () => chooserResolve?.(chooser);
  const activation: LocatorLike = {
    count: async () => 1,
    isVisible: async () => true,
    click: async () => {
      page.clickCalls += 1;
      queueMicrotask(() => chooserResolve?.(chooser));
    }
  };
  const menuOpener: LocatorLike = {
    count: async () => 1,
    isVisible: async () => true,
    click: async () => {
      page.clickCalls += 1;
      page.state.menu = true;
    }
  };
  page.locator = selector => selector.includes("menu-opener") ? menuOpener : activation;
  page.waitForEvent = async event => {
    expect(event).toBe("filechooser");
    page.chooserCalls += 1;
    return await new Promise<FileChooserLike>(resolve => {
      chooserResolve = resolve;
    });
  };
  page.evaluate = async <T, A = unknown>(
    fn: (arg: A) => T | Promise<T>,
    arg?: A
  ): Promise<T> => {
    page.evaluateCalls += 1;
    const state = page.state;
    if (fn.toString().includes("composer-submit-button")) {
      return { status: state.sendReady === false ? "not_ready" : "ready" } as T;
    }
    expect(fn.toString()).not.toContain("querySelectorAll");
    expect(fn.toString()).not.toContain("Array.from");
    expect(fn.toString()).not.toContain('structural.includes("composer")');
    expect(fn.toString()).toContain("files === undefined");
    expect(fn.toString()).toContain("input.value");
    if (fn.toString().includes("[role='menu'] div[tabindex='0']")) {
      expect(fn.toString()).not.toContain("document.querySelectorAll(\"[tabindex='0']\")");
      expect(fn.toString()).toContain("[role='group'] div[tabindex='0']");
      expect(fn.toString()).toContain("[class*='popover' i] div[tabindex='0']");
    }
    if (state.malformed) return { malformed: true } as T;
    if (state.leaky) {
      return {
        status: "ready",
        composerCount: 1,
        fileInputCount: 1,
        inputFilesReadable: true,
        attachmentRegionCount: 1,
        facts: [{ ordinal: 0, name: SECRET_NAME, bytes: 10, orderKey: 0 }],
        secondaryFacts: [],
        factSource: "input",
        orderDeterministic: true,
        directActivationSelector: "main > form > label.attach-label",
        activationCandidateCount: 1
      } as T;
    }
    if (state.localized && arg !== undefined && typeof arg === "object") {
      const labels = (arg as { labels?: unknown }).labels;
      expect(Array.isArray(labels)).toBe(true);
      expect((labels as string[]).some(label => label.includes("Añadir"))).toBe(true);
    }
    const expected = arg !== undefined && typeof arg === "object" && arg !== null
      && Array.isArray((arg as { expected?: unknown }).expected)
      ? (arg as unknown as { expected: Array<{ ordinal: number; displayName: string; bytes: number }> }).expected
      : [];
    const orderedFiles = state.reordered ? [...state.files].reverse() : [...state.files];
    const files = orderedFiles.map((file, ordinal) => {
      const expectedOrdinal = expected.findIndex(item => item.displayName === file.manifest.displayName);
      const matchedOrdinal = expectedOrdinal >= 0 ? expected[expectedOrdinal]!.ordinal : ordinal;
      const bytesMatch = !(state.mismatchBytes && ordinal === 0);
      return {
        ordinal,
        namePresent: true,
        sizePresent: true,
        nameMatch: state.duplicateNames ? true : expectedOrdinal >= 0,
        bytesMatch: state.duplicateNames ? true : bytesMatch,
        matchOrdinal: state.duplicateNames ? -1 : bytesMatch ? matchedOrdinal : -1,
        ...(state.duplicateNames ? { ambiguous: true } : {}),
        orderKey: ordinal
      };
    });
    const secondaryFacts = state.mixed ? files : [];
    if (state.ambiguous) {
      return {
        status: "ambiguous",
        composerCount: 2,
        fileInputCount: 2,
        inputFilesReadable: false,
        attachmentRegionCount: 0,
        facts: [],
        secondaryFacts: [],
        factSource: "none",
        orderDeterministic: false,
        activationCandidateCount: 2
      } as T;
    }
    return {
      status: "ready",
      composerCount: 1,
      fileInputCount: 1,
      inputFilesReadable: !state.clearedInput,
      attachmentRegionCount: files.length,
      facts: files,
      secondaryFacts,
      factSource: state.clearedInput ? "metadata" : state.mixed ? "mixed" : "input",
      orderDeterministic: true,
      ...(state.direct === false
        ? {
            menuOpenerSelector: "main > form > button.menu-opener",
            ...(state.menu && state.menuRow ? { menuUploadSelector: "main > form > div.menu-upload" } : {}),
            activationCandidateCount: state.menu && state.menuRow ? 1 : 1
          }
        : {
            directActivationSelector: "main > form > label.attach-label",
            activationCandidateCount: state.activationCandidateCount ?? 1
          })
    } as T;
  };
  return page;
}

function providerFor(
  page: FakePage,
  overrides: Partial<ChatGPTAttachmentProviderOptions> = {}
) {
  const evidenceMaterials: unknown[] = [];
  const files = overrides.files ?? [fileA];
  const provider = createChatGPTAttachmentProvider({
    evidenceDigest: (domain, material) => {
      evidenceMaterials.push({ domain, material });
      return digest(domain, material);
    },
    files,
    identityDigest: (_ordinal, file) => file.contentSha256 === CONTENT_A ? IDENTITY_A : IDENTITY_B,
    revalidateFile: async () => undefined,
    ...(overrides.locale === undefined ? {} : { locale: overrides.locale }),
    ...(overrides.signal === undefined ? {} : { signal: overrides.signal }),
    ...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
    ...(overrides.maxCandidates === undefined ? {} : { maxCandidates: overrides.maxCandidates })
  });
  return { provider, evidenceMaterials };
}

describe("ChatGPT production attachment provider", () => {
  it("uses one localized active-composer handoff and only then proves exact UI facts", async () => {
    const page = makePage({ localized: true });
    const { provider, evidenceMaterials } = providerFor(page, { locale: "es-ES" });
    const handoff = await provider.handoffFiles(handoffRequest(), page, target);
    expect(handoff.status).toBe("satisfied");
    expect(page.chooserCalls).toBe(1);
    expect(page.clickCalls).toBe(1);
    expect(page.setFilesCalls).toBe(1);
    expect(page.uploadedPaths).toEqual([[SECRET_PATH]]);

    const observed = await provider.observeAttachments(attachmentRequest(), page, target);
    expect(observed.status).toBe("exact");
    expect(JSON.stringify(observed)).not.toContain(SECRET_PATH);
    expect(JSON.stringify(observed)).not.toContain(SECRET_NAME);
    expect(JSON.stringify(evidenceMaterials)).not.toContain(SECRET_PATH);
    expect(JSON.stringify(evidenceMaterials)).not.toContain(SECRET_NAME);
  });

  it("requires an exact empty active-composer precondition and refuses a preexisting same-name chip", async () => {
    const page = makePage({ files: [fileA] });
    const { provider } = providerFor(page);
    const result = await provider.handoffFiles(handoffRequest(), page, target);
    expect(result).toEqual({ status: "not_satisfied", blockerCode: "ambiguous_file_handoff" });
    expect(page.chooserCalls).toBe(1);
    expect(page.clickCalls).toBe(0);
    expect(page.setFilesCalls).toBe(0);
  });

  it("does not treat a restart/preexisting surface as exact without this primitive's causal handoff", async () => {
    const page = makePage({ files: [fileA] });
    const { provider } = providerFor(page);
    const observed = await provider.observeAttachments(attachmentRequest(), page, target);
    expect(observed.status).toBe("ambiguous");
    expect(JSON.stringify(observed)).not.toContain(SECRET_NAME);
  });

  it("rejects duplicate-name postconditions as ambiguous even after its own handoff", async () => {
    const page = makePage();
    const { provider } = providerFor(page, { files: [fileA, fileB] });
    expect((await provider.handoffFiles(handoffRequest([fileA, fileB]), page, target)).status).toBe("satisfied");
    page.state = { files: [fileA, fileB], duplicateNames: true, direct: true };
    const observed = await provider.observeAttachments(attachmentRequest([fileA, fileB]), page, target);
    expect(observed.status).toBe("ambiguous");
  });

  it("requires every UI-exposed size fact to match the causal manifest", async () => {
    const page = makePage();
    const { provider } = providerFor(page);
    expect((await provider.handoffFiles(handoffRequest(), page, target)).status).toBe("satisfied");
    page.state.mismatchBytes = true;
    const observed = await provider.observeAttachments(attachmentRequest(), page, target);
    expect(observed.status).toBe("mismatch");
  });

  it("can prove a causal handoff from visible chips after ChatGPT clears input.files", async () => {
    const page = makePage();
    const { provider, evidenceMaterials } = providerFor(page);
    expect((await provider.handoffFiles(handoffRequest(), page, target)).status).toBe("satisfied");
    page.state = { files: [fileA], clearedInput: true, direct: true };

    const observed = await provider.observeAttachments(attachmentRequest(), page, target);
    expect(observed.status).toBe("exact");
    expect(JSON.stringify(observed)).not.toContain(SECRET_PATH);
    expect(JSON.stringify(observed)).not.toContain(SECRET_NAME);
    expect(JSON.stringify(evidenceMaterials)).not.toContain(SECRET_PATH);
    expect(JSON.stringify(evidenceMaterials)).not.toContain(SECRET_NAME);
  });

  it("keeps exact attachment observation independent from extra post-upload controls", async () => {
    const page = makePage();
    const { provider } = providerFor(page);
    expect((await provider.handoffFiles(handoffRequest(), page, target)).status).toBe("satisfied");
    page.state = {
      files: [fileA],
      clearedInput: true,
      direct: true,
      activationCandidateCount: 2
    };

    const observed = await provider.observeAttachments(attachmentRequest(), page, target);

    expect(observed.status).toBe("exact");
  });

  it("reports a causal attachment as delayed until the unique Send control is ready", async () => {
    const page = makePage();
    const { provider } = providerFor(page);
    expect((await provider.handoffFiles(handoffRequest(), page, target)).status).toBe("satisfied");
    page.state = { files: [fileA], clearedInput: true, direct: true, sendReady: false };

    expect((await provider.observeAttachments(attachmentRequest(), page, target)).status).toBe("delayed");
    page.state.sendReady = true;
    expect((await provider.observeAttachments(attachmentRequest(), page, target)).status).toBe("exact");
  });

  it("requires both input and chip observations to match when the composer exposes both", async () => {
    const page = makePage();
    const { provider } = providerFor(page);
    expect((await provider.handoffFiles(handoffRequest(), page, target)).status).toBe("satisfied");
    page.state = { files: [fileA], mixed: true, direct: true };
    expect((await provider.observeAttachments(attachmentRequest(), page, target)).status).toBe("exact");

    page.state = { files: [fileA], mixed: true, mismatchBytes: true, direct: true };
    expect((await provider.observeAttachments(attachmentRequest(), page, target)).status).toBe("mismatch");
  });

  it("rejects reordered causal UI facts even when names and sizes all match", async () => {
    const page = makePage();
    const files = [fileA, fileB];
    const { provider } = providerFor(page, { files });
    expect((await provider.handoffFiles(handoffRequest(files), page, target)).status).toBe("satisfied");
    page.state = { files, reordered: true, direct: true };

    const observed = await provider.observeAttachments(attachmentRequest(files), page, target);
    expect(observed.status).toBe("mismatch");
  });

  it("rejects causal UI multiplicity changes rather than treating a partial set as exact", async () => {
    const page = makePage();
    const files = [fileA, fileB];
    const { provider } = providerFor(page, { files });
    expect((await provider.handoffFiles(handoffRequest(files), page, target)).status).toBe("satisfied");
    page.state = { files: [fileA], direct: true };

    const observed = await provider.observeAttachments(attachmentRequest(files), page, target);
    expect(observed.status).toBe("mismatch");
  });

  it("falls back to a unique semantic menu row when scoped CDP is unavailable", async () => {
    const page = makePage({ direct: false, menuRow: true });
    let capabilityReads = 0;
    page.capabilities = {
      get: async () => {
        capabilityReads += 1;
        throw new Error("scoped CDP is unavailable");
      }
    };
    const { provider } = providerFor(page);
    const result = await provider.handoffFiles(handoffRequest(), page, target);
    expect(result.status).toBe("satisfied");
    expect(page.clickCalls).toBe(2);
    expect(page.setFilesCalls).toBe(1);
    expect(capabilityReads).toBe(1);
  });

  it("uses one fixed scoped CDP gesture for ChatGPT's hidden input and the native chooser for files", async () => {
    const page = makePage({ direct: false, menuRow: true });
    let sentMethod: string | undefined;
    let sentParams: Record<string, unknown> | undefined;
    let sentOptions: Record<string, unknown> | undefined;
    class PrivateCdpCapability {
      #calls = 0;

      get calls(): number {
        return this.#calls;
      }

      async send(
        method: string,
        params?: Record<string, unknown>,
        options?: Record<string, unknown>
      ): Promise<unknown> {
        this.#calls += 1;
        sentMethod = method;
        sentParams = params;
        sentOptions = options;
        queueMicrotask(() => page.resolveChooser?.());
        return { result: { value: { ok: true } } };
      }
    }
    const capability = new PrivateCdpCapability();
    page.capabilities = { get: async id => id === "cdp" ? capability : undefined };
    const { provider } = providerFor(page);

    const result = await provider.handoffFiles(handoffRequest(), page, target);

    expect(result.status).toBe("satisfied");
    expect(capability.calls).toBe(1);
    expect(sentMethod).toBe("Runtime.evaluate");
    expect(sentParams).toMatchObject({
      userGesture: true,
      awaitPromise: true,
      returnByValue: true
    });
    expect(sentParams?.expression).toContain('input.id === "upload-files"');
    expect(sentParams?.expression).toContain("active composer file input was not unique");
    expect(sentParams?.expression).not.toContain(SECRET_PATH);
    expect(sentOptions?.timeoutMs).toEqual(expect.any(Number));
    expect(page.clickCalls).toBe(0);
    expect(page.chooserCalls).toBe(1);
    expect(page.setFilesCalls).toBe(1);
  });

  it("fails closed when scoped CDP does not prove the exact hidden input", async () => {
    const page = makePage({ direct: false, menuRow: true });
    let sends = 0;
    page.capabilities = {
      get: async () => ({
        send: async () => {
          sends += 1;
          return { result: { value: { ok: false, reason: "active composer file input was not unique" } } };
        }
      })
    };
    const { provider } = providerFor(page, { timeoutMs: 20 });

    const result = await provider.handoffFiles(handoffRequest(), page, target);

    expect(result).toEqual({ status: "uncertain", quarantine: "provider" });
    expect(sends).toBe(1);
    expect(page.clickCalls).toBe(0);
    expect(page.setFilesCalls).toBe(0);
  });

  it("snapshots the complete caller identity graph before callbacks can mutate it", async () => {
    const callerFile = identity(SECRET_PATH, SECRET_NAME, CONTENT_A, 10);
    const callerFiles = [callerFile];
    const page = makePage();
    const revalidated: OperationFileIdentity[] = [];
    const evidenceMaterials: unknown[] = [];
    let forgeDigest = false;
    const provider = createChatGPTAttachmentProvider({
      evidenceDigest: (domain, material) => {
        evidenceMaterials.push({ domain, material });
        return digest(domain, material);
      },
      files: callerFiles,
      identityDigest: (_ordinal, file) => forgeDigest
        ? IDENTITY_B
        : file.contentSha256 === CONTENT_A ? IDENTITY_A : IDENTITY_B,
      revalidateFile: async file => {
        revalidated.push(file);
      }
    });
    const request = handoffRequest([callerFile]);

    // Mutate both the container and every caller-owned identity branch after
    // construction. The provider must retain only its frozen snapshot.
    callerFiles[0] = fileB;
    callerFile.sourcePath = "/forged/changed-name.txt";
    callerFile.manifest.displayName = "changed-name.txt";
    callerFile.manifest.bytes = 999;
    callerFile.proof.size = "999";
    forgeDigest = true;

    const handoff = await provider.handoffFiles(request, page, target);
    expect(handoff.status).toBe("satisfied");
    expect(page.uploadedPaths).toEqual([[SECRET_PATH]]);
    expect(revalidated).toHaveLength(1);
    expect(revalidated[0]).not.toBe(callerFile);
    expect(Object.isFrozen(revalidated[0])).toBe(true);
    expect(Object.isFrozen(revalidated[0]?.manifest)).toBe(true);
    expect(Object.isFrozen(revalidated[0]?.proof)).toBe(true);
    expect(revalidated[0]?.sourcePath).toBe(SECRET_PATH);
    expect(revalidated[0]?.manifest.displayName).toBe(SECRET_NAME);
    expect(revalidated[0]?.manifest.bytes).toBe(10);

    // The forged caller state cannot make the provider claim a different UI
    // identity; the actual causal handoff remains tied to the frozen facts.
    page.state = { files: [callerFile], direct: true };
    const forgedObserved = await provider.observeAttachments(attachmentRequest([callerFile]), page, target);
    expect(forgedObserved.status).toBe("mismatch");

    page.state = { files: [fileA], direct: true };
    const observed = await provider.observeAttachments(attachmentRequest([callerFile]), page, target);
    expect(observed.status).toBe("exact");
    expect(JSON.stringify([handoff, forgedObserved, observed, evidenceMaterials])).not.toContain("changed-name.txt");
    expect(JSON.stringify([handoff, forgedObserved, observed, evidenceMaterials])).not.toContain("/forged/changed-name.txt");
  });

  it("does not settle satisfied while chooser.setFiles is still in flight", async () => {
    const page = makePage({ deferSetFiles: true });
    const { provider } = providerFor(page);
    let settled = false;
    const pending = provider.handoffFiles(handoffRequest(), page, target).then(result => {
      settled = true;
      return result;
    });
    for (let index = 0; index < 50 && !page.setFilesStarted; index += 1) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    expect(page.setFilesStarted).toBe(true);
    expect(settled).toBe(false);
    page.releaseSetFiles?.();
    expect((await pending).status).toBe("satisfied");
    expect(settled).toBe(true);
  });

  it("reconciles a click that rejects after delivering the chooser and never retries", async () => {
    const page = makePage();
    const originalLocator = page.locator;
    page.locator = selector => {
      const locator = originalLocator!(selector);
      return {
        ...locator,
        click: async () => {
          page.clickCalls += 1;
          page.state.files = [fileA];
          page.resolveChooser?.();
          throw new Error("bridge rejected after the gesture");
        }
      };
    };
    // The core primitive's click rejection is reconciled by its chooser.
    const { provider } = providerFor(page);
    const result = await provider.handoffFiles(handoffRequest(), page, target);
    expect(result.status).toBe("satisfied");
    expect(page.clickCalls).toBe(1);
    expect(page.setFilesCalls).toBe(1);
  });

  it("keeps a provider/evidence failure generic and does not expose UI or local inputs", async () => {
    const page = makePage();
    const provider = createChatGPTAttachmentProvider({
      evidenceDigest: () => { throw new Error(SECRET_PATH); },
      files: [fileA],
      identityDigest: () => IDENTITY_A,
      revalidateFile: async () => undefined
    });
    const result = await provider.handoffFiles(handoffRequest(), page, target);
    expect(result.status).toBe("uncertain");
    expect(JSON.stringify(result)).not.toContain(SECRET_PATH);
    expect(JSON.stringify(result)).not.toContain(SECRET_NAME);
  });

  it("fails closed on ambiguous active composers and malformed provider observations", async () => {
    const page = makePage();
    page.state.malformed = true;
    const { provider } = providerFor(page);
    const observed = await provider.observeAttachments(attachmentRequest(), page, target);
    expect(observed.status).toBe("unavailable");
  });

  it("rejects legacy raw filename/byte probe shapes without echoing their contents", async () => {
    const page = makePage({ leaky: true });
    const { provider } = providerFor(page);
    const observed = await provider.observeAttachments(attachmentRequest(), page, target);
    expect(observed.status).toBe("unavailable");
    expect(JSON.stringify(observed)).not.toContain(SECRET_NAME);
    expect(JSON.stringify(observed)).not.toContain(SECRET_PATH);
  });

  it("does not choose among multiple localized composer candidates", async () => {
    const page = makePage({ ambiguous: true });
    const { provider } = providerFor(page);
    const result = await provider.handoffFiles(handoffRequest(), page, target);
    expect(result).toEqual({ status: "not_satisfied", blockerCode: "selector_drift" });
    expect(page.clickCalls).toBe(0);
    expect(page.setFilesCalls).toBe(0);
  });

  it("supports a structurally identified plus-menu route without localized text assumptions", async () => {
    const page = makePage({ direct: false });
    const { provider } = providerFor(page);
    // The test page exposes the menu opener but not a menu row; no guessed
    // second click is permitted, so this deterministically stops at drift.
    const result = await provider.handoffFiles(handoffRequest(), page, target);
    expect(result).toEqual({ status: "uncertain", quarantine: "provider" });
    expect(page.clickCalls).toBe(1);
    expect(page.setFilesCalls).toBe(0);
  });

  it("honors a genuine aborted signal before any browser mutation", async () => {
    const controller = new AbortController();
    controller.abort();
    const page = makePage();
    const { provider } = providerFor(page, { signal: controller.signal });
    const result = await provider.handoffFiles(handoffRequest(), page, target);
    expect(result).toEqual({ status: "not_satisfied", blockerCode: "operation_timeout" });
    expect(page.evaluateCalls).toBe(0);
    expect(page.clickCalls).toBe(0);
  });

  it("rejects accessor-bearing, unknown-key, proxy-like, and invalid-signal option graphs", () => {
    const base = {
      evidenceDigest: () => digest("evidence", "ok"),
      files: [fileA],
      identityDigest: () => IDENTITY_A,
      revalidateFile: async () => undefined
    };
    expect(() => createChatGPTAttachmentProvider({ ...base, unknown: true } as never)).toThrow();
    expect(() => createChatGPTAttachmentProvider(Object.defineProperty({ ...base }, "locale", {
      enumerable: true,
      get: () => "es-ES"
    }) as never)).toThrow();
    expect(() => createChatGPTAttachmentProvider({ ...base, signal: {} } as never)).toThrow();
    const proxy = new Proxy({ ...base }, { getOwnPropertyDescriptor: () => { throw new Error("trap"); } });
    expect(() => createChatGPTAttachmentProvider(proxy as never)).toThrow();
  });
});


describe("asynchronous attachment identity authority", () => {
  it("awaits identity signing before handoff and returns only concrete signed receipts", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const page = makePage();
    const providerPromise = createChatGPTAttachmentProviderAsync({
      files: [fileA], evidenceDigest: async (domain, material) => digest(domain, material),
      identityDigest: async () => { await pending; return IDENTITY_A; },
      revalidateFile: async () => undefined
    });
    const handoff = providerPromise.then(provider => provider.handoffFiles(handoffRequest(), page, target));
    await Promise.resolve();
    expect(page.evaluateCalls).toBe(0);
    expect(page.clickCalls).toBe(0);
    expect(page.setFilesCalls).toBe(0);
    release();
    expect(await handoff).toMatchObject({ status: "satisfied", evidenceDigest: expect.stringMatching(/^hmac-sha256:/) });
    const provider = await providerPromise;
    expect(await provider.observeAttachments(attachmentRequest(), page, target)).toMatchObject({ status: "exact", evidenceDigest: expect.stringMatching(/^hmac-sha256:/), identityDigests: [IDENTITY_A] });
    expect(page.clickCalls).toBe(1);
    expect(page.setFilesCalls).toBe(1);
  });

  it("rejects asynchronous identity failure before any browser access", async () => {
    const page = makePage();
    const outcome = createChatGPTAttachmentProviderAsync({
      files: [fileA], evidenceDigest: async (domain, material) => digest(domain, material),
      identityDigest: async () => { throw new Error("private remote failure"); }, revalidateFile: async () => undefined
    }).then(provider => provider.handoffFiles(handoffRequest(), page, target));
    await expect(outcome).rejects.toThrow("invalid ChatGPT attachment provider options");
    expect(page.evaluateCalls).toBe(0);
    expect(page.clickCalls).toBe(0);
    expect(page.setFilesCalls).toBe(0);
  });
});
