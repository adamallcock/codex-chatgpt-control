import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { waitForDownloadFromClick } from "../browser/downloads.js";
import { readPageState } from "../browser/page-state.js";
import { countPageArtifacts, listPageArtifacts, readLatestImageDataUrl } from "../dom/artifacts.js";
import { cssSelectors, requiredLocator } from "../dom/selectors.js";
import { localeLabels } from "../dom/locale-labels.js";
import { resultOk } from "../errors.js";
import type {
  ArtifactDownloadArgs,
  ArtifactListData,
  ArtifactWaitArgs,
  ArtifactWaitData,
  CommandResult,
  DownloadedFile,
  GeneratedArtifact,
  ListArtifactsArgs,
  LocatorLike,
  RuntimeEnv
} from "../types.js";
import { contextFromPage } from "./context.js";
import { bootstrap } from "./session.js";
import { localGuardTimeout, withTimeout } from "./timeouts.js";

export async function listLatestArtifacts(
  env: RuntimeEnv,
  args: ListArtifactsArgs = {}
): Promise<CommandResult<ArtifactListData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<ArtifactListData>;
  }

  const page = env.page!;
  try {
    const artifacts = await listPageArtifactsWithBridgeFallback(env, page, args);
    return resultOk(artifactListData(artifacts), await contextFromPage(page));
  } catch (error) {
    return artifactSelectorBlocker(error, await contextFromPage(page));
  }
}

export async function waitForArtifact(
  env: RuntimeEnv,
  args: ArtifactWaitArgs = {}
): Promise<CommandResult<ArtifactWaitData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<ArtifactWaitData>;
  }

  const page = env.page!;
  const timeoutMs = args.timeoutMs ?? 120000;
  const stableMs = args.stableMs ?? 1000;
  const pollMs = args.pollMs ?? 750;
  const started = Date.now();
  const afterArtifactCount = args.afterArtifactCount ?? 0;
  let lastSignature = "";
  let lastChangedAt = Date.now();
  let latestArtifacts: GeneratedArtifact[] = [];

  while (Date.now() - started < timeoutMs) {
    const state = await withTimeout(readPageState(page), localGuardTimeout(timeoutMs, 5000), "Timed out while reading ChatGPT page state.").catch(() => undefined);
    if (state?.blocker !== undefined && state.blocker.kind !== "modal") {
      return {
        ok: false,
        status: "blocked",
        warnings: [],
        blocker: state.blocker,
        context: await contextFromPage(page)
      };
    }

    try {
      latestArtifacts = await listPageArtifactsWithBridgeFallback(env, page, args);
    } catch (error) {
      return artifactSelectorBlocker(error, await contextFromPage(page));
    }

    const latest = latestArtifacts.at(-1);
    const signature = JSON.stringify({
      count: latestArtifacts.length,
      src: latest?.src,
      width: latest?.width,
      height: latest?.height,
      downloadAvailable: latest?.downloadAvailable
    });
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastChangedAt = Date.now();
    }

    const targetReached = latestArtifacts.length > afterArtifactCount
      && latest !== undefined
      && (args.requireDownload !== true || latest.downloadAvailable);
    if (targetReached && Date.now() - lastChangedAt >= stableMs && !await hasStopControl(page, timeoutMs)) {
      return resultOk(
        {
          complete: true,
          count: latestArtifacts.length,
          latest,
          elapsedMs: Date.now() - started
        },
        await contextFromPage(page)
      );
    }

    await sleep(page, pollMs);
  }

  const data: ArtifactWaitData = {
    complete: false,
    count: latestArtifacts.length,
    elapsedMs: Date.now() - started
  };
  const latest = latestArtifacts.at(-1);
  if (latest !== undefined) data.latest = latest;

  return {
    ok: false,
    status: "timeout",
    data,
    warnings: [],
    blocker: {
      kind: "artifact_unavailable",
      code: args.requireDownload === true ? "artifact_download_not_ready" : "artifact_not_ready",
      message: args.requireDownload === true
        ? "No generated artifact with a visible download affordance appeared before the timeout."
        : "No generated artifact appeared before the timeout.",
      resumable: true
    },
    context: await contextFromPage(page)
  };
}

export async function downloadLatestArtifact(
  env: RuntimeEnv,
  args: ArtifactDownloadArgs
): Promise<CommandResult<DownloadedFile>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<DownloadedFile>;
  }

  const page = env.page!;
  const timeoutMs = args.timeoutMs ?? 120000;

  if (args.prefer !== "visible_image_source") {
    const byDownload = await tryDownloadControl(page, args, timeoutMs);
    if (byDownload.ok || args.prefer === "download_control") {
      return byDownload;
    }
  }

  try {
    const byImageSource = await saveLatestVisibleImageSource(page, args.destDir, timeoutMs);
    if (byImageSource !== undefined) {
      return resultOk(byImageSource, await contextFromPage(page));
    }
  } catch (error) {
    return artifactDownloadBlocker(error, await contextFromPage(page));
  }

  try {
    const byPageAssets = await saveLatestPageAssetImage(env, page, args.destDir, timeoutMs);
    if (byPageAssets !== undefined) {
      return resultOk(byPageAssets, await contextFromPage(page));
    }
  } catch (error) {
    return artifactDownloadBlocker(error, await contextFromPage(page));
  }

  return artifactDownloadBlocker(
    new Error("No visible generated image source was available to save."),
    await contextFromPage(page)
  );
}

export async function locatorCountWithTimeout(
  locator: LocatorLike | undefined,
  timeoutMs: number,
  code: string
): Promise<number> {
  if (locator === undefined || typeof locator.count !== "function") {
    return 0;
  }
  return withTimeout(
    locator.count(),
    timeoutMs,
    `${code}: locator count did not complete before the local guard timeout.`
  );
}

async function tryDownloadControl(
  page: RuntimeEnv["page"] & {},
  args: ArtifactDownloadArgs,
  timeoutMs: number
): Promise<CommandResult<DownloadedFile>> {
  try {
    const controls = requiredLocator(page, cssSelectors.generatedArtifactDownloadControls);
    const count = await locatorCountWithTimeout(controls, localGuardTimeout(timeoutMs, 5000), "artifact_download_control_timeout");
    if (count === 0) {
      return artifactDownloadBlocker(new Error("No visible generated-image download control was found."), await contextFromPage(page));
    }

    const target = controls.last?.() ?? controls;
    const downloaded = await waitForDownloadFromClick(
      page,
      async () => {
        await target.click?.({ timeoutMs: localGuardTimeout(timeoutMs, 10000) });
      },
      args.destDir,
      timeoutMs
    );
    return resultOk(downloaded, await contextFromPage(page));
  } catch (error) {
    return artifactDownloadBlocker(error, await contextFromPage(page));
  }
}

async function saveLatestVisibleImageSource(
  page: RuntimeEnv["page"] & {},
  destDir: string,
  timeoutMs: number
): Promise<DownloadedFile | undefined> {
  const source = await readLatestImageDataUrl(page, timeoutMs);
  if (source === undefined) return undefined;
  const parsed = parseDataUrl(source.dataUrl);
  if (parsed === undefined) return undefined;

  const absoluteDest = resolve(destDir);
  await mkdir(absoluteDest, { recursive: true });
  const suggestedFilename = `generated-image-${Date.now()}.${extensionForMime(parsed.mimeType)}`;
  const path = join(absoluteDest, suggestedFilename);
  await writeFile(path, parsed.bytes);
  const saved = await stat(path);
  if (saved.size <= 0) {
    throw new Error(`Generated image artifact file is empty: ${path}`);
  }
  return { path, suggestedFilename, bytes: saved.size };
}

async function listPageArtifactsWithBridgeFallback(
  env: RuntimeEnv,
  page: RuntimeEnv["page"] & {},
  args: ListArtifactsArgs
): Promise<GeneratedArtifact[]> {
  try {
    const artifacts = await listPageArtifacts(page, args);
    if (artifacts.length > 0) {
      return artifacts;
    }
    const fromAssets = await listPageAssetArtifacts(env, page, args, args.timeoutMs).catch(() => []);
    return fromAssets.length > 0 ? fromAssets : artifacts;
  } catch (error) {
    const fromAssets = await listPageAssetArtifacts(env, page, args, args.timeoutMs).catch(() => []);
    if (fromAssets.length > 0) {
      return fromAssets;
    }
    throw error;
  }
}

async function listPageAssetArtifacts(
  env: RuntimeEnv,
  page: RuntimeEnv["page"] & {},
  args: ListArtifactsArgs,
  timeoutMs: number | undefined
): Promise<GeneratedArtifact[]> {
  const inventory = await readPageAssetsInventory(page, timeoutMs).catch(() => undefined)
    ?? await withTemporaryBridgeOwnedPage(env, page, timeoutMs, async freshPage => {
      return await readPageAssetsInventory(freshPage, timeoutMs).catch(() => undefined);
    });
  if (inventory === undefined) return [];

  const artifacts = inventory.assets
    .filter(asset => asset.kind === "image")
    .filter(asset => !isInlineSvgAsset(asset) && isLikelyRasterImageAsset(asset))
    .map((asset, index) => {
      const artifact: GeneratedArtifact = {
        kind: "image",
        index,
        visible: true,
        downloadAvailable: true,
        selectorProvenance: "pageAssets image inventory"
      };
      const src = safeArtifactSrc(asset.url);
      if (src !== undefined) artifact.src = src;
      return artifact;
    });
  const max = args.max ?? artifacts.length;
  return artifacts
    .filter(artifact => artifact.kind === (args.kind ?? "image"))
    .slice(-max)
    .map((artifact, index) => ({ ...artifact, index }));
}

async function saveLatestPageAssetImage(
  env: RuntimeEnv,
  page: RuntimeEnv["page"] & {},
  destDir: string,
  timeoutMs: number
): Promise<DownloadedFile | undefined> {
  return await saveLatestPageAssetImageFromPage(page, destDir, timeoutMs).catch(() => undefined)
    ?? await withTemporaryBridgeOwnedPage(env, page, timeoutMs, async freshPage => {
      return await saveLatestPageAssetImageFromPage(freshPage, destDir, timeoutMs).catch(() => undefined);
    });
}

async function saveLatestPageAssetImageFromPage(
  page: RuntimeEnv["page"] & {},
  destDir: string,
  timeoutMs: number
): Promise<DownloadedFile | undefined> {
  const capability = await getPageAssetsCapability(page);
  if (capability === undefined) return undefined;

  const inventory = await withTimeout(
    capability.list(),
    localGuardTimeout(timeoutMs, 15000),
    "Timed out while listing page assets for generated image download."
  );
  const candidateIds = inventory.assets
    .filter(asset => asset.kind === "image")
    .filter(asset => !isInlineSvgAsset(asset) && isLikelyRasterImageAsset(asset))
    .map(asset => asset.id);
  if (candidateIds.length === 0) return undefined;

  const bundled = await withTimeout(
    capability.bundle({ assetIds: candidateIds, inventoryId: inventory.id, kinds: ["image"] }),
    localGuardTimeout(timeoutMs, 30000),
    "Timed out while bundling generated image page asset."
  );
  const asset = bundled.assets
    .filter(item => !isInlineSvgAsset(item) && isLikelyRasterImageAsset(item))
    .at(-1);
  if (asset === undefined) return undefined;

  const absoluteDest = resolve(destDir);
  await mkdir(absoluteDest, { recursive: true });
  const suggestedFilename = `generated-image-${Date.now()}.${extensionForMime(asset.contentType ?? "image/png")}`;
  const path = join(absoluteDest, suggestedFilename);
  await copyFile(asset.path, path);
  const saved = await stat(path);
  if (saved.size <= 0) {
    throw new Error(`Generated image artifact file is empty: ${path}`);
  }
  return { path, suggestedFilename, bytes: saved.size };
}

async function readPageAssetsInventory(
  page: RuntimeEnv["page"] & {},
  timeoutMs: number | undefined
): Promise<PageAssetsInventory | undefined> {
  const capability = await getPageAssetsCapability(page);
  if (capability === undefined) return undefined;
  return await withTimeout(
    capability.list(),
    localGuardTimeout(timeoutMs, 15000),
    "Timed out while listing page assets for generated artifacts."
  );
}

async function getPageAssetsCapability(page: RuntimeEnv["page"] & {}): Promise<PageAssetsCapability | undefined> {
  const capabilities = page.capabilities;
  const get = capabilities?.get;
  if (typeof get !== "function") return undefined;
  const capability = await get.call(capabilities, "pageAssets");
  if (!isPageAssetsCapability(capability)) return undefined;
  return capability;
}

async function withTemporaryBridgeOwnedPage<T>(
  env: RuntimeEnv,
  currentPage: RuntimeEnv["page"] & {},
  timeoutMs: number | undefined,
  callback: (page: RuntimeEnv["page"] & {}) => Promise<T | undefined>
): Promise<T | undefined> {
  const url = await currentPageUrl(currentPage);
  if (url === undefined || !/^https:\/\/chatgpt\.com\/c\//i.test(url)) return undefined;

  const freshPage = await openTemporaryPage(env, url, timeoutMs);
  if (freshPage === undefined) return undefined;
  try {
    await settlePage(freshPage, localGuardTimeout(timeoutMs, 5000));
    return await callback(freshPage);
  } finally {
    await closeTemporaryPage(freshPage).catch(() => undefined);
  }
}

async function openTemporaryPage(
  env: RuntimeEnv,
  url: string,
  timeoutMs: number | undefined
): Promise<(RuntimeEnv["page"] & {}) | undefined> {
  const browser = env.browser;
  if (browser === undefined) return undefined;

  let page: RuntimeEnv["page"] | undefined;
  if (typeof browser.tabs?.create === "function") {
    page = await Promise.resolve(browser.tabs.create.call(browser.tabs, url));
  } else if (typeof browser.tabs?.new === "function") {
    page = await Promise.resolve(browser.tabs.new.call(browser.tabs));
    if (typeof page?.goto === "function") {
      await withTimeout(
        page.goto(url),
        localGuardTimeout(timeoutMs, 20000),
        "Timed out while opening generated image conversation in a temporary bridge tab."
      ).catch(() => undefined);
    }
  } else if (typeof browser.newPage === "function") {
    page = await Promise.resolve(browser.newPage.call(browser));
    if (typeof page?.goto === "function") {
      await withTimeout(
        page.goto(url),
        localGuardTimeout(timeoutMs, 20000),
        "Timed out while opening generated image conversation in a temporary bridge page."
      ).catch(() => undefined);
    }
  }

  return page as (RuntimeEnv["page"] & {}) | undefined;
}

async function settlePage(page: RuntimeEnv["page"] & {}, timeoutMs: number): Promise<void> {
  const waitForTimeout = page.waitForTimeout ?? page.playwright?.waitForTimeout;
  if (typeof waitForTimeout !== "function") return;
  await withTimeout(
    waitForTimeout.call(page.waitForTimeout === waitForTimeout ? page : page.playwright, Math.min(timeoutMs, 5000)),
    timeoutMs,
    "Timed out while waiting for temporary bridge tab to settle."
  ).catch(() => undefined);
}

async function closeTemporaryPage(page: RuntimeEnv["page"] & {}): Promise<void> {
  if (typeof page.close === "function") {
    await page.close();
  }
}

async function currentPageUrl(page: RuntimeEnv["page"] & {}): Promise<string | undefined> {
  const value = await Promise.resolve(page.url?.()).catch(() => undefined);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isPageAssetsCapability(value: unknown): value is PageAssetsCapability {
  return typeof value === "object"
    && value !== null
    && typeof (value as PageAssetsCapability).list === "function"
    && typeof (value as PageAssetsCapability).bundle === "function";
}

function isLikelyRasterImageAsset(asset: PageAssetLike): boolean {
  const contentType = asset.contentType ?? "";
  if (/^image\/(png|jpe?g|webp|gif|avif)$/i.test(contentType)) return true;
  const name = asset.name ?? basename(asset.path ?? "");
  const url = asset.url ?? "";
  return /\.(png|jpe?g|webp|gif|avif)(?:$|[?#])/i.test(name)
    || /\.(png|jpe?g|webp|gif|avif)(?:$|[?#])/i.test(url)
    || (contentType === "" && !isInlineSvgAsset(asset));
}

function isInlineSvgAsset(asset: PageAssetLike): boolean {
  return /^inline-svg:/i.test(asset.url ?? "")
    || /svg/i.test(asset.contentType ?? "")
    || /\.svg(?:$|[?#])/i.test(asset.name ?? "")
    || /\.svg(?:$|[?#])/i.test(asset.path ?? "");
}

function safeArtifactSrc(src: string | undefined): string | undefined {
  if (src === undefined) return undefined;
  if (/^https:\/\/chatgpt\.com\/backend-api\/estuary\/content\b/i.test(src)) {
    return undefined;
  }
  return src;
}

function parseDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } | undefined {
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(dataUrl);
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64") };
}

function extensionForMime(mimeType: string): string {
  if (/jpeg|jpg/i.test(mimeType)) return "jpg";
  if (/webp/i.test(mimeType)) return "webp";
  if (/gif/i.test(mimeType)) return "gif";
  return "png";
}

function artifactListData(artifacts: GeneratedArtifact[]): ArtifactListData {
  const data: ArtifactListData = {
    count: artifacts.length,
    artifacts
  };
  const latest = artifacts.at(-1);
  if (latest !== undefined) data.latest = latest;
  return data;
}

function artifactSelectorBlocker<T>(error: unknown, context: CommandResult["context"]): CommandResult<T> {
  return {
    ok: false,
    status: "blocked",
    warnings: [],
    blocker: {
      kind: "artifact_selector_drift",
      code: "artifact_dom_timeout",
      message: `Generated artifact detection could not inspect the ChatGPT page: ${error instanceof Error ? error.message : String(error)}`,
      resumable: true
    },
    context
  };
}

type PageAssetLike = {
  id?: string;
  kind?: string;
  name?: string;
  url?: string;
  path?: string;
  contentType?: string | null;
};

type PageAssetsInventory = {
  id: string;
  assets: Array<{
    id: string;
    kind: string;
    name: string;
    url: string;
  }>;
};

type PageAssetsBundle = {
  assets: Array<{
    contentType: string | null;
    id: string;
    kind: string;
    name: string;
    path: string;
    url: string;
  }>;
};

type PageAssetsCapability = {
  list: () => Promise<PageAssetsInventory>;
  bundle: (options: { assetIds?: string[]; inventoryId: string; kinds?: string[] }) => Promise<PageAssetsBundle>;
};

function artifactDownloadBlocker<T>(error: unknown, context: CommandResult["context"]): CommandResult<T> {
  return {
    ok: false,
    status: "unsupported",
    warnings: [],
    blocker: {
      kind: "artifact_download_unavailable",
      code: "artifact_download_unavailable",
      message: `No downloadable generated artifact could be saved from the visible ChatGPT page: ${error instanceof Error ? error.message : String(error)}`,
      resumable: true
    },
    context
  };
}

async function ensurePage(env: RuntimeEnv): Promise<CommandResult<unknown>> {
  if (env.page !== undefined) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
}

async function hasStopControl(page: RuntimeEnv["page"] & {}, timeoutMs: number): Promise<boolean> {
  if (typeof page.evaluate !== "function") return false;
  return withTimeout(
    page.evaluate((phrases: string[]) => {
      const text = document.body?.innerText ?? "";
      const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return phrases.some(phrase => new RegExp(`\\b${escape(phrase)}\\b`, "i").test(text));
    }, [...localeLabels.stopControl]),
    localGuardTimeout(timeoutMs, 2000),
    "Timed out while checking ChatGPT stop controls."
  ).catch(() => false);
}

async function sleep(page: RuntimeEnv["page"] & {}, ms: number): Promise<void> {
  if (typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(ms);
    return;
  }
  await new Promise(resolve => setTimeout(resolve, ms));
}
