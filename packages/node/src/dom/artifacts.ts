import type { GeneratedArtifact, ListArtifactsArgs, PageLike } from "../types.js";
import { withTimeout, localGuardTimeout } from "../commands/timeouts.js";

export async function listPageArtifacts(
  page: PageLike,
  args: ListArtifactsArgs = {}
): Promise<GeneratedArtifact[]> {
  const timeoutMs = localGuardTimeout(args.timeoutMs, 5000);
  let artifacts: GeneratedArtifact[] | undefined;
  let evaluateError: unknown;
  if (typeof page.evaluate === "function") {
    artifacts = await withTimeout(
        page.evaluate(() => {
          const images = Array.from(document.querySelectorAll("main img")) as HTMLImageElement[];
          return images
            .map((image, index) => {
              const rect = image.getBoundingClientRect();
              const style = window.getComputedStyle(image);
              const width = Math.round(rect.width || image.naturalWidth || image.width || 0);
              const height = Math.round(rect.height || image.naturalHeight || image.height || 0);
              const alt = image.getAttribute("alt") ?? undefined;
              const src = image.currentSrc || image.src || undefined;
              const ariaLabel = image.getAttribute("aria-label") ?? image.closest("[aria-label]")?.getAttribute("aria-label") ?? undefined;
              const visible = width > 0
                && height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && Number(style.opacity || "1") > 0;
              const likelyGenerated = visible
                && !image.closest("nav, aside, header, footer, form, [contenteditable='true'], textarea")
                && (
                  width >= 96
                  || height >= 96
                  || /^data:image\//i.test(src ?? "")
                  || /^blob:/i.test(src ?? "")
                  || /\b(generated|image|photo|picture)\b/i.test(`${alt ?? ""} ${ariaLabel ?? ""}`)
                );
              if (!likelyGenerated) return undefined;
              const container = image.closest("figure, [data-testid*='image' i], [aria-label*='image' i], [role='group'], [data-testid^='conversation-turn']") ?? image.parentElement;
              const scopedDownload = container?.querySelector("a[download], button[aria-label*='Download' i], a[aria-label*='Download' i]");
              const globalDownload = document.querySelector("main button[aria-label*='Download image' i], main a[aria-label*='Download image' i]");
              const turnNode = image.closest("[data-testid^='conversation-turn']");
              const artifact: GeneratedArtifact = {
                kind: "image",
                index,
                visible,
                width,
                height,
                downloadAvailable: Boolean(scopedDownload ?? globalDownload),
                selectorProvenance: "main generated image"
              };
              if (alt !== undefined) artifact.alt = alt;
              if (ariaLabel !== undefined) artifact.ariaLabel = ariaLabel;
              const safeSrc = safeArtifactSrc(src);
              if (safeSrc !== undefined) artifact.src = safeSrc;
              const turnId = turnNode?.getAttribute("data-testid") ?? undefined;
              if (turnId !== undefined) artifact.turnId = turnId;
              return artifact;
            })
            .filter((artifact): artifact is GeneratedArtifact => artifact !== undefined);
        }),
        timeoutMs,
        "Timed out while inspecting visible ChatGPT artifacts."
      ).catch(error => {
        evaluateError = error;
        return undefined;
      });
  }

  if (artifacts === undefined && typeof page.content !== "function" && evaluateError !== undefined) {
    throw evaluateError;
  }

  const filtered = filterArtifacts(artifacts ?? await listArtifactsFromContent(page, timeoutMs), args);
  return filtered.map((artifact, index) => ({ ...artifact, index }));
}

export async function countPageArtifacts(page: PageLike, args: ListArtifactsArgs = {}): Promise<number> {
  return listPageArtifacts(page, args).then(artifacts => artifacts.length);
}

export async function readLatestImageDataUrl(
  page: PageLike,
  timeoutMs: number | undefined
): Promise<{ dataUrl: string; alt?: string } | undefined> {
  const guardMs = localGuardTimeout(timeoutMs, 5000);
  if (typeof page.evaluate === "function") {
    const fromDom = await withTimeout(
      page.evaluate(async () => {
        const images = Array.from(document.querySelectorAll("main img")) as HTMLImageElement[];
        const candidates = images.filter(image => {
          const rect = image.getBoundingClientRect();
          const width = rect.width || image.naturalWidth || image.width || 0;
          const height = rect.height || image.naturalHeight || image.height || 0;
          const src = image.currentSrc || image.src || "";
          const label = `${image.getAttribute("alt") ?? ""} ${image.closest("[aria-label]")?.getAttribute("aria-label") ?? ""}`;
          return !image.closest("nav, aside, header, footer, form, [contenteditable='true'], textarea")
            && (width >= 96 || height >= 96 || /^data:image\//i.test(src) || /^blob:/i.test(src) || /\b(generated|image|photo|picture)\b/i.test(label));
        });
        const image = candidates.at(-1);
        if (image === undefined) return undefined;
        const src = image.currentSrc || image.src;
        if (/^data:image\//i.test(src)) {
          const alt = image.getAttribute("alt") ?? undefined;
          return alt === undefined ? { dataUrl: src } : { dataUrl: src, alt };
        }
        if (/^(blob:|https?:)/i.test(src)) {
          const response = await fetch(src);
          const blob = await response.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error("FileReader failed."));
            reader.readAsDataURL(blob);
          });
          const alt = image.getAttribute("alt") ?? undefined;
          return alt === undefined ? { dataUrl } : { dataUrl, alt };
        }
        return undefined;
      }),
      guardMs,
      "Timed out while reading the visible generated image source."
    ).catch(() => undefined);
    if (fromDom !== undefined) return fromDom;
  }

  const html = await readContentWithTimeout(page, guardMs).catch(() => undefined);
  if (html === undefined) return undefined;
  const artifact = parseArtifactsFromHtml(html).at(-1);
  if (artifact?.src === undefined || !/^data:image\//i.test(artifact.src)) return undefined;
  return artifact.alt === undefined
    ? { dataUrl: artifact.src }
    : { dataUrl: artifact.src, alt: artifact.alt };
}

async function listArtifactsFromContent(page: PageLike, timeoutMs: number): Promise<GeneratedArtifact[]> {
  const html = await readContentWithTimeout(page, timeoutMs).catch(() => undefined);
  return html === undefined ? [] : parseArtifactsFromHtml(html);
}

function parseArtifactsFromHtml(html: string): GeneratedArtifact[] {
  const hasDownload = /<a\b[^>]*\sdownload(?:\s|=|>)/i.test(html)
    || /\baria-label=["'][^"']*download[^"']*["']/i.test(html);
  const artifacts: GeneratedArtifact[] = [];
  const imagePattern = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(html)) !== null) {
    const tag = match[0] ?? "";
    const src = attr(tag, "src");
    const alt = attr(tag, "alt");
    const ariaLabel = attr(tag, "aria-label");
    const width = numberAttr(tag, "width");
    const height = numberAttr(tag, "height");
    const label = `${alt ?? ""} ${ariaLabel ?? ""}`;
    const likelyGenerated = (width ?? 0) >= 96
      || (height ?? 0) >= 96
      || /^data:image\//i.test(src ?? "")
      || /^blob:/i.test(src ?? "")
      || /\b(generated|image|photo|picture)\b/i.test(label);
    if (!likelyGenerated) continue;
    const artifact: GeneratedArtifact = {
      kind: "image",
      index: artifacts.length,
      visible: true,
      downloadAvailable: hasDownload,
      selectorProvenance: "main generated image"
    };
    const safeSrc = safeArtifactSrc(src);
    if (safeSrc !== undefined) artifact.src = safeSrc;
    if (alt !== undefined) artifact.alt = alt;
    if (ariaLabel !== undefined) artifact.ariaLabel = ariaLabel;
    if (width !== undefined) artifact.width = width;
    if (height !== undefined) artifact.height = height;
    artifacts.push(artifact);
  }
  return artifacts;
}

function filterArtifacts(artifacts: GeneratedArtifact[], args: ListArtifactsArgs): GeneratedArtifact[] {
  const kind = args.kind ?? "image";
  const max = args.max ?? artifacts.length;
  return artifacts
    .filter(artifact => artifact.kind === kind)
    .slice(-max);
}

async function readContentWithTimeout(page: PageLike, timeoutMs: number): Promise<string> {
  if (typeof page.content !== "function") return "";
  return withTimeout(page.content(), timeoutMs, "Timed out while reading ChatGPT page content.");
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i").exec(tag);
  return match?.[2];
}

function numberAttr(tag: string, name: string): number | undefined {
  const value = attr(tag, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safeArtifactSrc(src: string | undefined): string | undefined {
  if (src === undefined) return undefined;
  if (/^https:\/\/chatgpt\.com\/backend-api\/estuary\/content\b/i.test(src)) {
    return undefined;
  }
  return src;
}
