import { constants as fsConstants, type BigIntStats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { DownloadLike } from "../browser/downloads.js";
import type { PageLike } from "../types.js";
import { coordinatedEventRegistrationBarrier } from "../runtime/coordinated-page.js";
import { isByteArrayView } from "../runtime/value-boundaries.js";
import type { BrowserObservationDigest } from "./browser-observation.js";
import type {
  ArtifactTransferKind,
  ArtifactTransferSourceRequest
} from "./artifact-transfer.js";
import { MAX_PROVIDER_CHUNK_BYTES } from "./artifact-stream.js";

/**
 * The source side of an artifact transfer is deliberately kept separate from
 * the transfer/output coordinator.  This provider only proves and reads the
 * one artifact owned by the request; it never chooses a latest message or
 * writes a durable output.
 */
export type ProductionChatGPTArtifactsOptions = Readonly<{
  /** An already-owned same-tab page. A per-call page may be supplied instead. */
  page?: Readonly<PageLike>;
  /** The keyed evidence function used by browser-observation.ts. */
  evidenceDigest: BrowserObservationDigest;
  /** Optional existing parent for request-temporary download directories. */
  tempDirectory?: string;
  /** Maximum time spent on bounded reads and event observation. */
  timeoutMs?: number;
  /** Maximum downloaded artifact size accepted by this source. */
  maxBytes?: number;
  /** Maximum DOM artifact candidates examined in one exact turn. */
  maxArtifacts?: number;
  /** Optional request cancellation signal. It never cancels an in-flight mutation. */
  signal?: AbortSignal;
}>;

export type ProductionChatGPTArtifactOpenSource = (
  request: ArtifactTransferSourceRequest,
  page?: Readonly<PageLike>
) => Promise<AsyncIterable<Uint8Array>>;

/**
 * The browser phase returns only the causal download capability. It performs
 * no saveAs(), path(), filesystem read, or temporary-directory work.
 */
export type ProductionChatGPTArtifactAcquireDownload = (
  request: ArtifactTransferSourceRequest,
  page?: Readonly<PageLike>
) => Promise<DownloadLike>;

/**
 * The local phase consumes one download capability exactly once and returns
 * only a defensive byte stream. It never calls back into the browser.
 */
export type ProductionChatGPTArtifactMaterializeDownload = (
  download: DownloadLike
) => Promise<AsyncIterable<Uint8Array>>;

export type ProductionChatGPTArtifacts = Readonly<{
  /**
   * Browser phase: prove, arm one waiter, click once, and return the exact
   * causal DownloadLike. Run this only while the same-tab transaction is held.
   */
  acquireDownload: ProductionChatGPTArtifactAcquireDownload;
  /**
   * Local phase: after releasing the browser transaction, materialize the
   * provider capability into a defensive bounded byte stream. No caller path
   * is recursively removed by this phase.
   */
  materializeDownload: ProductionChatGPTArtifactMaterializeDownload;
  /** Convenience composition of acquireDownload followed by materializeDownload. */
  openSource: ProductionChatGPTArtifactOpenSource;
}>;

export type ProductionChatGPTArtifactSourceProviderOptions = ProductionChatGPTArtifactsOptions;
export type ProductionChatGPTArtifactSourceProvider = ProductionChatGPTArtifacts;

export const PRODUCTION_CHATGPT_ARTIFACTS_SCHEMA_VERSION =
  "chatgpt.browser_control.production_artifacts.v1" as const;

const DIGEST_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,512}$/u;
const CONTENT_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const MAX_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_ARTIFACTS = 32;
const MAX_MAX_ARTIFACTS = 256;
const MAX_GRAPH_DEPTH = 12;
const MAX_GRAPH_NODES = 4_096;
const MAX_STRING_LENGTH = 4_096;
const MAX_MIME_LENGTH = 128;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const DOWNLOAD_STREAM_CHUNK_BYTES = 64 * 1024;
const MAX_PROVIDER_CHUNKS = 65_536;

type NormalizedOptions = Readonly<{
  page?: Readonly<PageLike>;
  evidenceDigest: BrowserObservationDigest;
  tempDirectory?: string;
  timeoutMs: number;
  maxBytes: number;
  maxArtifacts: number;
  signal?: AbortSignal;
}>;

type NormalizedRequest = Readonly<{
  operationId: string;
  requestDigest: string;
  targetBindingDigest: string;
  assistantTurnId: string;
  sourceIdentityDigest: string;
  kind: ArtifactTransferKind;
  ordinal: number;
  transferActionId: string;
  destinationIdentityDigest: string;
}>;

type ArtifactFacts = Readonly<{
  kind: ArtifactTransferKind;
  ordinal: number;
  identity: string;
  contentDigest?: string;
  bytes?: number;
  mimeType?: string;
}>;

type ArtifactProbeArguments = Readonly<{
  assistantTurnId: string;
  kind: ArtifactTransferKind;
  ordinal: number;
  maxArtifacts: number;
  expected?: ArtifactFacts;
}>;

type ArtifactBrowserProbeArguments = ArtifactProbeArguments & Readonly<{
  mode: "read" | "click";
}>;

type DownloadOutcome =
  | Readonly<{ kind: "success"; download: DownloadLike }>
  | Readonly<{ kind: "rejected" }>;

type DownloadWait = {
  readonly promise: Promise<DownloadOutcome>;
  readonly registration?: Promise<void>;
  outcome?: DownloadOutcome;
};

type AcquiredDownloadState = "ready" | "consumed";

type SafeMethod = (this: object, ...args: unknown[]) => unknown;

/**
 * Create a request-local ChatGPT artifact source adapter.
 *
 * The adapter performs two exact DOM reads around the one browser mutation:
 * the first proves the request's HMAC identity, while the second proves that
 * the same turn/kind/ordinal facts are still present immediately before the
 * click.  A download event is armed once, before the click, and a click that
 * rejects after acting is reconciled against only that one waiter.
 *
 * `acquireDownload` is the short browser-actor phase. Callers should release
 * the same-tab transaction as soon as it resolves, then call
 * `materializeDownload`; `openSource` is retained for non-actor callers that
 * explicitly want the two phases composed.
 */
export function createProductionChatGPTArtifacts(
  options: ProductionChatGPTArtifactsOptions
): ProductionChatGPTArtifacts {
  const normalized = normalizeOptions(options);
  // A DownloadLike is a request-local capability. WeakMap state prevents a
  // caller from materializing an arbitrary/preexisting download or consuming
  // one causal event twice, while not retaining raw paths or labels.
  const acquiredDownloads = new WeakMap<object, AcquiredDownloadState>();

  const acquireDownload: ProductionChatGPTArtifactAcquireDownload = async (
    request: ArtifactTransferSourceRequest,
    pageOverride?: Readonly<PageLike>
  ): Promise<DownloadLike> => {
    const normalizedRequest = normalizeRequest(request);
    const page = pageOverride ?? normalized.page;
    if (normalizedRequest === undefined || page === undefined || !isSafeProviderObject(page)
      || !isSafeDataGraph(page, new Set<object>(), 0, true)) {
      throw providerError();
    }
    if (normalized.signal !== undefined && normalized.signal.aborted) throw providerError();

    const probeArguments: ArtifactProbeArguments = Object.freeze({
      assistantTurnId: normalizedRequest.assistantTurnId,
      kind: normalizedRequest.kind,
      ordinal: normalizedRequest.ordinal,
      maxArtifacts: normalized.maxArtifacts
    });

    const firstFacts = await boundedRead(
      () => evaluatePage(page, probeExactArtifactInBrowser, Object.freeze({
        ...probeArguments,
        mode: "read"
      })),
      normalized.timeoutMs
    );
    const exactFacts = normalizeFacts(firstFacts, normalizedRequest, normalized.maxArtifacts);
    if (exactFacts === undefined || !matchesRequest(exactFacts, normalizedRequest)) {
      throw providerError();
    }
    const expectedDigest = await artifactEvidenceDigest(normalized, normalizedRequest, exactFacts);
    if (expectedDigest === undefined || expectedDigest !== normalizedRequest.sourceIdentityDigest) {
      throw providerError();
    }
    if (normalized.signal?.aborted === true) throw providerError();

    const waiter = startDownloadWait(page, normalized.timeoutMs);
    const preMutation = await settleDownloadBeforeMutation(waiter, normalized.timeoutMs);
    if (preMutation !== undefined) {
      // A resolved/rejected event before this request's click is stale or
      // ambiguous. It cannot be made causal by reusing the waiter.
      throw providerError();
    }

    const clickArguments: ArtifactBrowserProbeArguments = Object.freeze({
      ...probeArguments,
      mode: "click",
      expected: exactFacts
    });
    let clickMayHaveActed = false;
    try {
      // Once this call is issued, a bridge rejection cannot prove that the
      // DOM click did not land. The causal download waiter decides whether a
      // useful effect actually followed it.
      // This is the sole browser mutation in the source phase. It must remain
      // inside the same-tab actor until the bridge promise settles: a local
      // timeout race could return the actor while the serialized callback is
      // still able to invoke node.click() later. Read-only probes above retain
      // boundedRead; this mutation deliberately has no competing deadline.
      const clicked = await evaluatePage(page, probeExactArtifactInBrowser, clickArguments);
      clickMayHaveActed = clicked === true;
    } catch {
      // A browser bridge can reject after delivering the gesture. The one
      // download waiter below remains authoritative and is never retried.
      clickMayHaveActed = true;
    }

    const downloadOutcome = await awaitDownload(waiter, normalized.timeoutMs);
    if (!clickMayHaveActed || downloadOutcome.kind !== "success") {
      throw providerError();
    }

    if (normalized.signal !== undefined && normalized.signal.aborted) throw providerError();
    const download = downloadOutcome.download;
    if (acquiredDownloads.has(download)) throw providerError();
    acquiredDownloads.set(download, "ready");
    return download;
  };

  const materializeDownload: ProductionChatGPTArtifactMaterializeDownload = async (
    download: DownloadLike
  ): Promise<AsyncIterable<Uint8Array>> => {
    if (!isSafeProviderObject(download)) throw providerError();
    const state = acquiredDownloads.get(download);
    if (state !== "ready") throw providerError();
    // Consume before the first await. A failed local effect is not silently
    // retried because saveAs/path may already have partially acted.
    acquiredDownloads.set(download, "consumed");
    return await materializeDownloadBytes(download, normalized);
  };

  const openSource: ProductionChatGPTArtifactOpenSource = async (
    request: ArtifactTransferSourceRequest,
    pageOverride?: Readonly<PageLike>
  ): Promise<AsyncIterable<Uint8Array>> => {
    const download = await acquireDownload(request, pageOverride);
    return await materializeDownload(download);
  };

  return Object.freeze({ acquireDownload, materializeDownload, openSource });
}

/** Explicit aliases used by callers that name the provider after its role. */
export const createChatGPTArtifactSourceProvider = createProductionChatGPTArtifacts;
export const createProductionChatGPTArtifactSource = createProductionChatGPTArtifacts;
export const createProductionChatGPTArtifactSourceProvider = createProductionChatGPTArtifacts;

/**
 * This callback is deliberately self-contained: browser providers serialize
 * the function body and do not preserve module closures. Keep every selector,
 * bound, and helper inside the callback. It returns only bounded identity
 * facts; URLs, file names, and message text are never read or returned.
 */
function probeExactArtifactInBrowser(
  args: ArtifactBrowserProbeArguments
): ArtifactFacts | boolean | undefined {
  const turnRootSelector = "[data-testid^='conversation-turn'],[data-conversation-turn-id],[data-turn-id],[data-message-id]";
  const artifactNodeSelector = "[data-artifact-id],[data-file-id],[data-attachment-id],[data-image-id],[data-testid*='artifact' i],[data-testid*='file' i],[data-testid*='image' i],a[download]";
  const identityPattern = /^[A-Za-z0-9._:-]{1,512}$/u;
  const contentDigestPattern = /^[0-9a-f]{64}$/u;
  const maximumArtifacts = 256;
  const maximumNodes = 4_096;
  const maximumArtifactBytes = 128 * 1024 * 1024;
  const maximumMimeLength = 128;

  const boundedIdentity = (value: unknown): value is string =>
    typeof value === "string" && identityPattern.test(value);
  const artifactKind = (value: unknown): value is "file" | "image" | "other" =>
    value === "file" || value === "image" || value === "other";
  const nonnegativeInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const positiveInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  const classify = (node: HTMLElement): "file" | "image" | "other" => {
    const testId = (node.getAttribute("data-testid") ?? "").toLowerCase();
    if (node.tagName.toLowerCase() === "img" || testId.includes("image") || node.hasAttribute("data-image-id")) return "image";
    if (testId.includes("file") || node.hasAttribute("data-file-id") || node.hasAttribute("data-attachment-id") || node.tagName.toLowerCase() === "a") return "file";
    return "other";
  };
  const maximumRoots = 256;
  type RootInfo = {
    readonly node: HTMLElement;
    readonly start: number;
    end?: number;
    roles: number;
    allAssistant: boolean;
    identities: Set<string>;
  };
  type ArtifactMatch = {
    readonly node: HTMLElement;
    readonly at: number;
    /** Every retained candidate has an explicit turn owner. */
    readonly owner: HTMLElement;
  };
  type WalkFrame = {
    readonly node: Node;
    nextChild: Node | null;
    readonly nearestTurnRoot?: HTMLElement;
    readonly nearestTurnRootStart?: number;
  };
  const addIdentities = (info: RootInfo, node: HTMLElement): boolean => {
    for (const name of ["data-message-id", "data-turn-id", "data-conversation-turn-id"]) {
      const value = node.getAttribute(name);
      if (value === null || value.length === 0) continue;
      if (!boundedIdentity(value)) return false;
      info.identities.add(value);
    }
    return true;
  };
  /**
   * One bounded SHOW_ALL-equivalent traversal. Every node, including text and
   * comments, consumes the global visit budget; only elements are matched or
   * indexed. Root attribution is carried by the traversal stack, avoiding a
   * per-candidate subtree rescan for nested conversation turns.
   */
  const walkDocument = (boundary: Node, artifactLimit: number): Readonly<{
    roots: RootInfo[];
    artifacts: ArtifactMatch[];
    artifactOverflow: Set<HTMLElement>;
  }> | undefined => {
    try {
      const roots: RootInfo[] = [];
      const rootByNode = new Map<HTMLElement, RootInfo>();
      const artifacts: ArtifactMatch[] = [];
      const artifactCounts = new Map<HTMLElement, number>();
      const artifactOverflow = new Set<HTMLElement>();
      const frames: WalkFrame[] = [{
        node: boundary,
        nextChild: (boundary as ParentNode).firstChild
      }];
      let visited = 0;
      while (frames.length > 0) {
        const frame = frames[frames.length - 1];
        if (frame === undefined) return undefined;
        const child = frame.nextChild;
        if (child !== null) {
          visited += 1;
          // Fail before touching any property on a node beyond the cap. This
          // makes the sentinel boundary deterministic and keeps traversal O(N).
          if (visited > maximumNodes) return undefined;
          frame.nextChild = child.nextSibling;
          let nearestTurnRoot = frame.nearestTurnRoot;
          let nearestTurnRootStart = frame.nearestTurnRootStart;
          if (child.nodeType === 1) {
            const element = child as HTMLElement;
            let isTurnRoot: boolean;
            try {
              isTurnRoot = element.matches(turnRootSelector);
            } catch {
              return undefined;
            }
            if (isTurnRoot) {
              nearestTurnRoot = element;
              nearestTurnRootStart = visited;
            }
            let isArtifact = false;
            try {
              isArtifact = element.matches(artifactNodeSelector);
            } catch {
              return undefined;
            }
            if (isArtifact) {
              // The caller's artifact bound is per exact turn, not global to
              // the page. Keep only bounded candidates for each owner and
              // remember overflow so a selected owner fails closed later;
              // unrelated historical turns cannot starve this request.
              if (nearestTurnRoot !== undefined) {
                const count = artifactCounts.get(nearestTurnRoot) ?? 0;
                if (count >= artifactLimit) artifactOverflow.add(nearestTurnRoot);
                else {
                  if (artifacts.length >= maximumNodes) return undefined;
                  artifactCounts.set(nearestTurnRoot, count + 1);
                  artifacts.push({ node: element, at: visited, owner: nearestTurnRoot });
                }
              } // Unowned artifacts are deliberately not materialized.
            }
            const role = element.getAttribute("data-message-author-role");
            if (role !== null) {
              const owner = nearestTurnRoot ?? element;
              const ownerStart = nearestTurnRootStart ?? visited;
              let info = rootByNode.get(owner);
              if (info === undefined) {
                if (roots.length >= maximumRoots) return undefined;
                info = {
                  node: owner,
                  start: ownerStart,
                  roles: 0,
                  allAssistant: true,
                  identities: new Set<string>()
                };
                if (!addIdentities(info, owner)) return undefined;
                rootByNode.set(owner, info);
                roots.push(info);
              }
              info.roles += 1;
              if (role !== "assistant") info.allAssistant = false;
              if (owner !== element && !addIdentities(info, element)) return undefined;
            }
          }
          frames.push({
            node: child,
            nextChild: child.firstChild,
            ...(nearestTurnRoot === undefined ? {} : { nearestTurnRoot }),
            ...(nearestTurnRootStart === undefined ? {} : { nearestTurnRootStart })
          });
        } else {
          frames.pop();
          if (frame.node.nodeType === 1) {
            const info = rootByNode.get(frame.node as HTMLElement);
            if (info !== undefined) info.end = visited;
          }
        }
      }
      return { roots, artifacts, artifactOverflow };
    } catch {
      // A hostile or partially detached DOM must fail closed without exposing
      // an exception through the serialized browser callback.
      return undefined;
    }
  };

  const documentRoot = (globalThis as unknown as { document?: Document }).document;
  if (documentRoot === undefined || (args.mode !== "read" && args.mode !== "click")) return undefined;
  if (!boundedIdentity(args.assistantTurnId) || !artifactKind(args.kind)
    || !nonnegativeInteger(args.ordinal) || !positiveInteger(args.maxArtifacts)
    || args.maxArtifacts > maximumArtifacts) return undefined;

  const walked = walkDocument(documentRoot, args.maxArtifacts);
  if (walked === undefined) return undefined;
  const matchingRoots = walked.roots.filter(info => {
    const only = info.identities.values().next().value;
    return info.roles > 0
      && info.allAssistant
      && info.end !== undefined
      && info.identities.size === 1
      && typeof only === "string"
      && only === args.assistantTurnId;
  });
  if (matchingRoots.length !== 1) return undefined;
  const selectedRoot = matchingRoots[0];
  if (selectedRoot === undefined || selectedRoot.end === undefined
    || walked.artifactOverflow.has(selectedRoot.node)) return undefined;
  const nodes: HTMLElement[] = [];
  for (const artifact of walked.artifacts) {
    // Preorder ranges are retained for diagnostics, but cannot establish
    // ownership: a nested turn is contained in the outer range. Only the
    // exact nearest turn root may authorize an artifact for this request.
    if (artifact.owner !== selectedRoot.node) continue;
    if (artifact.at <= selectedRoot.start || artifact.at > selectedRoot.end) continue;
    if (nodes.length >= args.maxArtifacts) return undefined;
    nodes.push(artifact.node);
  }
  const seen = new Set<string>();
  const facts: ArtifactFacts[] = [];
  for (let ordinal = 0; ordinal < nodes.length; ordinal += 1) {
    const node = nodes[ordinal];
    if (node === undefined) return undefined;
    const strongIdentities = new Set<string>();
    for (const name of ["data-artifact-id", "data-file-id", "data-attachment-id", "data-image-id"]) {
      const value = node.getAttribute(name);
      if (value === null || value.length === 0) continue;
      if (!boundedIdentity(value)) return undefined;
      strongIdentities.add(value);
    }
    if (strongIdentities.size > 1) return undefined;
    const firstStrongIdentity = strongIdentities.values().next().value;
    const identity = (typeof firstStrongIdentity === "string" ? firstStrongIdentity : undefined)
      ?? node.getAttribute("data-testid") ?? "";
    if (!boundedIdentity(identity) || seen.has(identity)) return undefined;
    seen.add(identity);
    const kind = classify(node);
    const contentDigest = node.getAttribute("data-content-sha256") ?? node.getAttribute("data-sha256") ?? undefined;
    if (contentDigest !== undefined && !contentDigestPattern.test(contentDigest)) return undefined;
    const bytesRaw = node.getAttribute("data-bytes") ?? node.getAttribute("data-size") ?? undefined;
    const bytes = bytesRaw === undefined ? undefined : Number(bytesRaw);
    if (bytes !== undefined && (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumArtifactBytes)) return undefined;
    const mimeType = node.getAttribute("data-mime-type") ?? node.getAttribute("type") ?? undefined;
    if (mimeType !== undefined && (mimeType.length > maximumMimeLength || mimeType.includes("\u0000"))) return undefined;
    facts.push({
      kind,
      ordinal,
      identity,
      ...(contentDigest === undefined ? {} : { contentDigest }),
      ...(bytes === undefined ? {} : { bytes }),
      ...(mimeType === undefined ? {} : { mimeType })
    });
  }

  const selectedFacts = facts[args.ordinal];
  if (selectedFacts === undefined) return undefined;
  if (args.mode === "read") return selectedFacts;
  const expected = args.expected;
  if (expected === undefined
    || expected.kind !== selectedFacts.kind
    || expected.ordinal !== selectedFacts.ordinal
    || expected.identity !== selectedFacts.identity
    || expected.contentDigest !== selectedFacts.contentDigest
    || expected.bytes !== selectedFacts.bytes
    || expected.mimeType !== selectedFacts.mimeType) return false;
  const node = nodes[args.ordinal];
  if (node === undefined) return false;
  // The exact turn/kind/ordinal node is the sole capability used. Do not read
  // a human label, URL, or path and never try a second candidate.
  node.click();
  return true;
}

function normalizeOptions(value: unknown): NormalizedOptions {
  const record = ownDataRecord(value, [
    "page", "evidenceDigest", "tempDirectory", "timeoutMs", "maxBytes", "maxArtifacts", "signal"
  ]);
  const evidenceDigest = readData<unknown>(record, "evidenceDigest");
  const page = readData<unknown>(record, "page");
  const tempDirectory = readData<unknown>(record, "tempDirectory");
  const timeoutMs = readData<unknown>(record, "timeoutMs");
  const maxBytes = readData<unknown>(record, "maxBytes");
  const maxArtifacts = readData<unknown>(record, "maxArtifacts");
  const signal = readData<unknown>(record, "signal");
  if (typeof evidenceDigest !== "function") throw providerError();
  if (page !== undefined && (!isSafeProviderObject(page) || safeMethod(page, "evaluate") === undefined || safeMethod(page, "waitForEvent") === undefined)) throw providerError();
  if (tempDirectory !== undefined && (typeof tempDirectory !== "string" || !isAbsolute(tempDirectory) || !isSafeString(tempDirectory, MAX_STRING_LENGTH))) throw providerError();
  if (timeoutMs !== undefined && (!isPositiveSafeInteger(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS)) throw providerError();
  if (maxBytes !== undefined && (!isPositiveSafeInteger(maxBytes) || maxBytes > MAX_MAX_BYTES)) throw providerError();
  if (maxArtifacts !== undefined && (!isPositiveSafeInteger(maxArtifacts) || maxArtifacts > MAX_MAX_ARTIFACTS)) throw providerError();
  if (signal !== undefined && !isGenuineAbortSignal(signal)) throw providerError();
  if (page !== undefined && !isSafeDataGraph(page, new Set<object>(), 0, true)) throw providerError();
  return Object.freeze({
    ...(page === undefined ? {} : { page: page as Readonly<PageLike> }),
    evidenceDigest: evidenceDigest as BrowserObservationDigest,
    // Kept as a validated compatibility option. Transactional materialization
    // deliberately does not create or recursively remove paths supplied by a
    // caller; it uses a provider stream or a retained O_NOFOLLOW file handle.
    ...(tempDirectory === undefined ? {} : { tempDirectory }),
    timeoutMs: (timeoutMs as number | undefined) ?? DEFAULT_TIMEOUT_MS,
    maxBytes: (maxBytes as number | undefined) ?? DEFAULT_MAX_BYTES,
    maxArtifacts: (maxArtifacts as number | undefined) ?? DEFAULT_MAX_ARTIFACTS,
    ...(signal === undefined ? {} : { signal: signal as AbortSignal })
  });
}

function normalizeRequest(value: unknown): NormalizedRequest | undefined {
  if (!isPlainDataRecord(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, [
    "operationId", "requestDigest", "targetBindingDigest", "assistantTurnId", "sourceIdentityDigest",
    "kind", "ordinal", "transferActionId", "destinationIdentityDigest"
  ])) return undefined;
  const operationId = readData<unknown>(record, "operationId");
  const requestDigest = readData<unknown>(record, "requestDigest");
  const targetBindingDigest = readData<unknown>(record, "targetBindingDigest");
  const assistantTurnId = readData<unknown>(record, "assistantTurnId");
  const sourceIdentityDigest = readData<unknown>(record, "sourceIdentityDigest");
  const kind = readData<unknown>(record, "kind");
  const ordinal = readData<unknown>(record, "ordinal");
  const transferActionId = readData<unknown>(record, "transferActionId");
  const destinationIdentityDigest = readData<unknown>(record, "destinationIdentityDigest");
  if (!isBoundedId(operationId) || !isDigest(requestDigest) || !isDigest(targetBindingDigest)
    || !isBoundedId(assistantTurnId) || !isDigest(sourceIdentityDigest) || !isArtifactKind(kind)
    || !isNonnegativeSafeInteger(ordinal) || ordinal > MAX_MAX_ARTIFACTS
    || !isBoundedId(transferActionId) || !isDigest(destinationIdentityDigest)) return undefined;
  return Object.freeze({
    operationId,
    requestDigest,
    targetBindingDigest,
    assistantTurnId,
    sourceIdentityDigest,
    kind,
    ordinal,
    transferActionId,
    destinationIdentityDigest
  });
}

async function artifactEvidenceDigest(
  options: NormalizedOptions,
  request: NormalizedRequest,
  facts: ArtifactFacts
): Promise<string | undefined> {
  const material = Object.freeze({
    operationId: request.operationId,
    turnId: request.assistantTurnId,
    ordinal: facts.ordinal,
    kind: facts.kind,
    identity: facts.identity,
    ...(facts.contentDigest === undefined ? {} : { contentDigest: facts.contentDigest }),
    ...(facts.bytes === undefined ? {} : { bytes: facts.bytes }),
    ...(facts.mimeType === undefined ? {} : { mimeType: facts.mimeType })
  });
  try {
    const value = await options.evidenceDigest("browser-observation-artifact", material);
    return isDigest(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function matchesRequest(facts: ArtifactFacts, request: NormalizedRequest): boolean {
  return facts.kind === request.kind && facts.ordinal === request.ordinal;
}

function normalizeFacts(value: unknown, request: NormalizedRequest, maxArtifacts: number): ArtifactFacts | undefined {
  if (!isPlainDataRecord(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, ["kind", "ordinal", "identity", "contentDigest", "bytes", "mimeType"], true)) return undefined;
  const kind = readData<unknown>(record, "kind");
  const ordinal = readData<unknown>(record, "ordinal");
  const identity = readData<unknown>(record, "identity");
  const contentDigest = readData<unknown>(record, "contentDigest");
  const bytes = readData<unknown>(record, "bytes");
  const mimeType = readData<unknown>(record, "mimeType");
  if (!isArtifactKind(kind) || !isNonnegativeSafeInteger(ordinal) || ordinal >= maxArtifacts
    || !isBoundedId(identity)
    || (contentDigest !== undefined && !isContentDigest(contentDigest))
    || (bytes !== undefined && (!isNonnegativeSafeInteger(bytes) || bytes > MAX_ARTIFACT_BYTES))
    || (mimeType !== undefined && !isBoundedText(mimeType, MAX_MIME_LENGTH))) return undefined;
  if (ordinal !== request.ordinal || kind !== request.kind) return undefined;
  return Object.freeze({
    kind,
    ordinal,
    identity,
    ...(contentDigest === undefined ? {} : { contentDigest }),
    ...(bytes === undefined ? {} : { bytes }),
    ...(mimeType === undefined ? {} : { mimeType })
  });
}

function startDownloadWait(page: Readonly<PageLike>, timeoutMs: number): DownloadWait {
  const waitForEvent = safeMethod(page, "waitForEvent");
  if (waitForEvent === undefined) {
    const outcome: DownloadOutcome = { kind: "rejected" };
    return { promise: Promise.resolve(outcome), outcome };
  }
  let raw: unknown;
  try {
    raw = waitForEvent.call(page, "download", { timeout: timeoutMs, timeoutMs });
  } catch {
    const outcome: DownloadOutcome = { kind: "rejected" };
    return { promise: Promise.resolve(outcome), outcome };
  }
  if (!isPromiseLike(raw)) {
    const outcome: DownloadOutcome = { kind: "rejected" };
    return { promise: Promise.resolve(outcome), outcome };
  }
  const registration = coordinatedEventRegistrationBarrier(raw);
  const wait: DownloadWait = {
    ...(registration === undefined ? {} : { registration }),
    promise: Promise.resolve(raw).then(
      value => {
        const outcome: DownloadOutcome = isSafeProviderObject(value) && (safeMethod(value, "createReadStream") !== undefined || safeMethod(value, "saveAs") !== undefined || safeMethod(value, "path") !== undefined)
          ? { kind: "success", download: value as DownloadLike }
          : { kind: "rejected" };
        wait.outcome = outcome;
        return outcome;
      },
      () => {
        const outcome: DownloadOutcome = { kind: "rejected" };
        wait.outcome = outcome;
        return outcome;
      }
    )
  };
  return wait;
}

async function settleDownloadBeforeMutation(wait: DownloadWait, timeoutMs: number): Promise<DownloadOutcome | undefined> {
  if (wait.outcome !== undefined) return wait.outcome;
  if (wait.registration !== undefined) {
    try {
      await boundedRead(() => wait.registration as Promise<unknown>, timeoutMs);
    } catch {
      return { kind: "rejected" };
    }
  }
  await flushMicrotasks();
  return wait.outcome;
}

async function awaitDownload(wait: DownloadWait, timeoutMs: number): Promise<DownloadOutcome> {
  if (wait.outcome !== undefined) return wait.outcome;
  return await new Promise<DownloadOutcome>(resolveOutcome => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolveOutcome({ kind: "rejected" });
    }, timeoutMs);
    void wait.promise.then(value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveOutcome(value);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveOutcome({ kind: "rejected" });
    });
  });
}

/** Local-only phase implementation; no PageLike or browser callback is used. */
async function materializeDownloadBytes(download: DownloadLike, options: NormalizedOptions): Promise<AsyncIterable<Uint8Array>> {
  if (options.signal?.aborted === true) throw providerError();

  // Playwright exposes createReadStream() as a capability. It avoids passing
  // a caller-controlled path to saveAs(), and therefore avoids both the
  // temporary-directory replacement race and recursive cleanup of an
  // unverified path. The provider call and every subsequent iterator call are
  // independently bounded; a late provider settlement is observed by the
  // promise handler in boundedProviderCall and is never retried.
  const createReadStream = safeMethod(download, "createReadStream");
  if (createReadStream !== undefined) {
    try {
      const raw = await boundedProviderCall(
        () => createReadStream.call(download),
        options.timeoutMs
      );
      if (!isObjectLike(raw)) throw providerError();
      return boundedProviderByteStream(raw, options.maxBytes, options.timeoutMs, options.signal);
    } catch {
      throw providerError();
    }
  }

  // A path() result is opened with O_NOFOLLOW and retained as a FileHandle.
  // The pre-open lstat and post-open fstat must describe the same inode; once
  // retained, later replacement of the pathname cannot redirect the bytes
  // read by the returned stream. The browser-owned source is never deleted.
  const pathMethod = safeMethod(download, "path");
  if (pathMethod !== undefined) {
    let opened: Readonly<{ handle: FileHandle; snapshot: BigIntStats }> | undefined;
    try {
      const candidate = await boundedProviderCall(
        () => pathMethod.call(download),
        options.timeoutMs
      );
      if (typeof candidate !== "string" || !isAbsolute(candidate) || !isSafeString(candidate, MAX_STRING_LENGTH)) {
        throw providerError();
      }
      opened = await openBoundedFile(candidate, options.maxBytes);
      if (options.signal !== undefined && options.signal.aborted) throw providerError();
      const stream = boundedFileByteStream(opened.handle, opened.snapshot, options.signal);
      opened = undefined;
      return stream;
    } catch {
      if (opened !== undefined) {
        await opened.handle.close().catch(() => undefined);
      }
      throw providerError();
    }
  }

  // saveAs(path) cannot be made capability-safe in pure Node: the provider
  // receives a pathname and can replace either the directory or target after
  // validation. Refuse this legacy-only surface rather than creating an
  // operation-owned path that could be redirected or recursively removed.
  throw providerError();
}

async function openBoundedFile(
  path: string,
  maxBytes: number
): Promise<Readonly<{ handle: FileHandle; snapshot: BigIntStats }>> {
  let handle: FileHandle | undefined;
  try {
    const before = await lstat(path, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile() || before.size > BigInt(maxBytes)) throw providerError();
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(before, opened) || opened.size > BigInt(maxBytes)) throw providerError();
    return Object.freeze({ handle, snapshot: opened });
  } catch {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // The stable redacted provider error remains authoritative.
      }
    }
    throw providerError();
  }
}

function boundedFileByteStream(
  handle: FileHandle,
  snapshot: BigIntStats,
  signal: AbortSignal | undefined
): AsyncIterable<Uint8Array> {
  let closed = false;
  let position = 0;
  let queue: Promise<void> = Promise.resolve();

  const finalize = async (verifySnapshot: boolean): Promise<void> => {
    if (closed) return;
    closed = true;
    let failed = false;
    if (verifySnapshot) {
      try {
        const after = await handle.stat({ bigint: true });
        if (!sameFileSnapshot(snapshot, after) || BigInt(position) !== snapshot.size) failed = true;
      } catch {
        failed = true;
      }
    }
    try {
      await handle.close();
    } catch {
      failed = true;
    }
    if (failed) throw providerError();
  };

  const serialized = <T>(callback: () => Promise<T>): Promise<T> => {
    const result = queue.then(callback, callback);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  const iterator: AsyncIterator<Uint8Array> = Object.freeze({
    next: (): Promise<IteratorResult<Uint8Array>> => serialized(async () => {
      if (closed) return { done: true, value: undefined };
      if (signal?.aborted === true) {
        try { await finalize(false); } catch { /* return the same redacted error */ }
        throw providerError();
      }
      const total = Number(snapshot.size);
      if (!Number.isSafeInteger(total) || total < 0 || position > total) {
        try { await finalize(false); } catch { /* return the same redacted error */ }
        throw providerError();
      }
      if (position === total) {
        await finalize(true);
        return { done: true, value: undefined };
      }
      const length = Math.min(DOWNLOAD_STREAM_CHUNK_BYTES, total - position);
      const buffer = Buffer.allocUnsafe(length);
      let bytesRead: number;
      try {
        bytesRead = (await handle.read(buffer, 0, length, position)).bytesRead;
      } catch {
        try { await finalize(false); } catch { /* return the same redacted error */ }
        throw providerError();
      }
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > length) {
        try { await finalize(false); } catch { /* return the same redacted error */ }
        throw providerError();
      }
      position += bytesRead;
      // Never expose the reusable Buffer slab or file-backed mutable storage.
      return { done: false, value: Uint8Array.from(buffer.subarray(0, bytesRead)) };
    }),
    return: (): Promise<IteratorResult<Uint8Array>> => serialized(async () => {
      await finalize(false);
      return { done: true, value: undefined };
    })
  });

  return Object.freeze({
    // One capability has one cursor. Repeated calls cannot replay a private
    // download or allocate an independent reader over the same file handle.
    [Symbol.asyncIterator]: (): AsyncIterator<Uint8Array> => iterator
  });
}

/**
 * Defensive bounded adapter for a provider-owned Readable/AsyncIterable.
 * There is no local pathname to clean up, so a timed-out provider is
 * quarantined by abandoning exactly one iterator; all late settlements are
 * observed and no second read is ever issued.
 */
function boundedProviderByteStream(
  source: object,
  maxBytes: number,
  timeoutMs: number,
  signal: AbortSignal | undefined
): AsyncIterable<Uint8Array> {
  const iterator = providerAsyncIterator(source);
  let closed = false;
  let bytes = 0;
  let chunks = 0;
  let queue: Promise<void> = Promise.resolve();

  const close = async (waitForSettlement = true): Promise<void> => {
    if (closed) return;
    closed = true;
    const returnMethod = safeMethod(iterator as object, "return");
    if (returnMethod === undefined) return;
    if (!waitForSettlement) {
      try {
        const late = returnMethod.call(iterator);
        if (isPromiseLike(late)) void Promise.resolve(late).then(() => undefined, () => undefined);
      } catch {
        // The provider is already quarantined after the preceding failure.
      }
      return;
    }
    try {
      await boundedProviderCall(() => returnMethod.call(iterator), timeoutMs);
    } catch {
      // A provider return that times out is already quarantined. Its late
      // settlement is observed by boundedProviderCall; never retry close.
    }
  };

  const serialized = <T>(callback: () => Promise<T>): Promise<T> => {
    const result = queue.then(callback, callback);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  const next = (): Promise<IteratorResult<Uint8Array>> => serialized(async () => {
    if (closed) return { done: true, value: undefined };
    if (signal?.aborted === true) {
      await close(false);
      throw providerError();
    }
    let raw: unknown;
    try {
      raw = await boundedProviderCall(() => iterator.next(), timeoutMs);
    } catch {
      await close(false);
      throw providerError();
    }
    if (!isObjectLike(raw)) {
      await close(false);
      throw providerError();
    }
    const done = readData<unknown>(raw, "done");
    if (done === true) {
      closed = true;
      return { done: true, value: undefined };
    }
    if (done !== false) {
      await close(false);
      throw providerError();
    }
    const value = readData<unknown>(raw, "value");
    if (!isByteArrayView(value)
      || value.byteLength > MAX_PROVIDER_CHUNK_BYTES
      || value.byteLength > maxBytes - bytes
      || chunks >= MAX_PROVIDER_CHUNKS) {
      await close(false);
      throw providerError();
    }
    chunks += 1;
    bytes += value.byteLength;
    return { done: false, value: Uint8Array.from(value) };
  });

  const returned = (): Promise<IteratorResult<Uint8Array>> => serialized(async () => {
    await close();
    return { done: true, value: undefined };
  });

  return Object.freeze({
    [Symbol.asyncIterator]: (): AsyncIterator<Uint8Array> => Object.freeze({ next, return: returned })
  });
}

function providerAsyncIterator(source: object): AsyncIterator<Uint8Array> {
  let current: object | null = source;
  for (let depth = 0; current !== null && depth < MAX_GRAPH_DEPTH; depth += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, Symbol.asyncIterator);
      if (descriptor !== undefined) {
        if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined || typeof descriptor.value !== "function") {
          throw providerError();
        }
        const iterator = Reflect.apply(descriptor.value as (this: object) => unknown, source, []);
        if (!isObjectLike(iterator) || safeMethod(iterator, "next") === undefined) throw providerError();
        return iterator as AsyncIterator<Uint8Array>;
      }
      current = Object.getPrototypeOf(current) as object | null;
    } catch {
      throw providerError();
    }
  }
  throw providerError();
}

function sameFileSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return left.isFile() && right.isFile()
    && !left.isSymbolicLink() && !right.isSymbolicLink()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function evaluatePage<T>(
  page: Readonly<PageLike>,
  fn: (args: ArtifactBrowserProbeArguments) => T,
  args: ArtifactBrowserProbeArguments
): Promise<T> {
  const evaluate = safeMethod(page, "evaluate");
  if (evaluate === undefined) throw providerError();
  const result = evaluate.call(page, fn, args, { timeoutMs: MAX_TIMEOUT_MS });
  return await Promise.resolve(result) as T;
}

async function boundedRead<T>(callback: () => Promise<T> | T, timeoutMs: number): Promise<T> {
  const value = callback();
  if (!isPromiseLike(value)) return value;
  return await new Promise<T>((resolveValue, rejectValue) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectValue(providerError());
    }, timeoutMs);
    Promise.resolve(value).then(result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveValue(result);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectValue(providerError());
    });
  });
}

/**
 * Bound one provider promise while retaining a rejection/settlement observer
 * for a call that outlives the local deadline. Promise.race alone would leave
 * a late provider failure unhandled and could make a caller retry an effect
 * that is still acting. The observer intentionally performs no second effect.
 */
async function boundedProviderCall<T>(callback: () => unknown, timeoutMs: number): Promise<T> {
  let value: unknown;
  try {
    value = callback();
  } catch {
    throw providerError();
  }
  if (!isPromiseLike(value)) return value as T;
  const promise = Promise.resolve(value as PromiseLike<unknown>);
  let settled = false;
  const observed = promise.then(
    result => {
      settled = true;
      return result;
    },
    () => {
      settled = true;
      return undefined;
    }
  );
  return await new Promise<T>((resolveValue, rejectValue) => {
    const timer = setTimeout(() => {
      if (settled) return;
      rejectValue(providerError());
    }, timeoutMs);
    void observed.then(result => {
      if (settled !== true) return;
      clearTimeout(timer);
      // A rejection is represented as undefined by the observer. Treating an
      // undefined result as a provider failure is safe for all call sites.
      if (result === undefined) rejectValue(providerError());
      else resolveValue(result as T);
    });
  });
}

function ownDataRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isObjectLike(value) || Array.isArray(value)) throw providerError();
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw providerError();
  }
  if (prototype !== Object.prototype && prototype !== null) throw providerError();
  const allowedSet = new Set(allowed);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowedSet.has(key)) throw providerError();
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) throw providerError();
  }
  return value as Record<string, unknown>;
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (!isObjectLike(value) || Array.isArray(value)) return false;
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return false;
  }
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return false;
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) return false;
  }
  return true;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[], optional = false): boolean {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) if (!allowed.has(key)) return false;
  if (optional) return true;
  return keys.every(key => Object.prototype.hasOwnProperty.call(record, key));
}

function readData<T>(value: object, key: PropertyKey): T | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) return undefined;
    return descriptor.value as T;
  } catch {
    return undefined;
  }
}

function safeMethod(value: object, key: string): SafeMethod | undefined {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < MAX_GRAPH_DEPTH; depth += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined || typeof descriptor.value !== "function") return undefined;
        return descriptor.value as SafeMethod;
      }
      current = Object.getPrototypeOf(current) as object | null;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isSafeProviderObject(value: unknown): value is object {
  if (!isObjectLike(value)) return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return false;
      const descriptor = descriptors[key];
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isSafeDataGraph(value: unknown, seen: Set<object>, depth: number, capability = false): boolean {
  if (value === null || typeof value !== "object") return value !== undefined && typeof value !== "function";
  if (seen.has(value)) return true;
  if (depth > MAX_GRAPH_DEPTH || seen.size >= MAX_GRAPH_NODES) return false;
  seen.add(value);
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return false;
  }
  if (!capability && prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) return false;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return false;
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) return false;
    if (typeof descriptor.value === "function") continue;
    if (!isSafeDataGraph(descriptor.value, seen, depth + 1, false)) return false;
  }
  return true;
}

function isGenuineAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isObjectLike(value) && safeMethod(value, "then") !== undefined;
}

function isArtifactKind(value: unknown): value is ArtifactTransferKind {
  return value === "file" || value === "image" || value === "other";
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isContentDigest(value: unknown): value is string {
  return typeof value === "string" && CONTENT_DIGEST_PATTERN.test(value);
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isBoundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !value.includes("\u0000");
}

function isSafeString(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && !value.includes("\u0000");
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isErrno(value: unknown, code: string): boolean {
  return isObjectLike(value) && readData<unknown>(value, "code") === code;
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

function providerError(): Error {
  return new Error("ChatGPT artifact source is unavailable.");
}
