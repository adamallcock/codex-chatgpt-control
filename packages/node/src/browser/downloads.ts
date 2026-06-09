import { mkdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { DownloadedFile, PageLike } from "../types.js";
import { localGuardTimeout, withTimeout } from "../commands/timeouts.js";

export type DownloadLike = {
  suggestedFilename?: () => string;
  saveAs?: (path: string) => Promise<void>;
  path?: () => Promise<string | null>;
};

export async function waitForDownloadFromClick(
  page: PageLike,
  click: () => Promise<void>,
  destDir: string,
  timeoutMs: number
): Promise<DownloadedFile> {
  const absoluteDest = resolve(destDir);
  await mkdir(absoluteDest, { recursive: true });

  const downloadPromise = page.waitForEvent?.("download", { timeout: timeoutMs, timeoutMs }) as Promise<DownloadLike> | undefined;
  if (downloadPromise === undefined) {
    throw new Error("The active browser page does not expose download events.");
  }

  await withTimeout(
    click(),
    localGuardTimeout(timeoutMs, 10000),
    "Download control click did not complete before the local guard timeout."
  );
  const download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename?.() ?? `chatgpt-download-${Date.now()}`;
  const targetPath = join(absoluteDest, basename(suggestedFilename));

  if (typeof download.saveAs === "function") {
    await download.saveAs(targetPath);
  } else {
    throw new Error("The browser download object does not expose saveAs().");
  }

  const saved = await stat(targetPath);
  if (saved.size <= 0) {
    throw new Error(`Downloaded file is empty: ${targetPath}`);
  }

  return {
    path: targetPath,
    suggestedFilename,
    bytes: saved.size
  };
}
