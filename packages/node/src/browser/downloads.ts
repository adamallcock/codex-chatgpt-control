import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { DownloadedFile, PageLike } from "../types.js";
import { ChatGPTControlError } from "../errors.js";
import { createDeadline, remainingMs, type Deadline } from "../commands/deadline.js";
import { withTimeout } from "../commands/timeouts.js";
import { coordinatedEventRegistrationBarrier, withCoordinatedMutationGuard } from "../runtime/coordinated-page.js";

export type DownloadLike = {
  suggestedFilename?: () => string;
  /** Capability-based stream exposed by Playwright's Download implementation. */
  createReadStream?: () => Promise<AsyncIterable<Uint8Array>>;
  saveAs?: (path: string) => Promise<void>;
  path?: (options?: { timeoutMs?: number }) => Promise<string | null>;
};

export class DownloadReceiptTimeoutError extends ChatGPTControlError {
  constructor(stage: string) {
    super(`Download ${stage} did not complete before the deadline. Completion is unverified; inspect the existing download before retrying.`,
      "download_unavailable", false, undefined, { code: "download_receipt_timeout", resumable: false });
  }
}

export class DownloadBrowserBlockedError extends ChatGPTControlError {
  constructor() {
    super("Chrome displayed ERR_BLOCKED_BY_CLIENT during the download. Inspect the existing download and Chrome restrictions before retrying; completion is unverified.",
      "download_unavailable", false, undefined, { code: "download_blocked_by_browser", resumable: false });
  }
}

export class DownloadReceiptFailedError extends ChatGPTControlError {
  constructor() {
    super("The browser did not provide a verified download receipt. Inspect the existing download before retrying; completion is unverified.",
      "download_unavailable", false, undefined, { code: "download_receipt_failed", resumable: false });
  }
}

export function isTerminalDownloadError(error: unknown): error is DownloadReceiptTimeoutError | DownloadBrowserBlockedError | DownloadReceiptFailedError {
  return error instanceof DownloadReceiptTimeoutError || error instanceof DownloadBrowserBlockedError || error instanceof DownloadReceiptFailedError;
}

export function isTerminalDownloadCode(code: string | undefined): boolean {
  return code === "download_receipt_timeout" || code === "download_blocked_by_browser" || code === "download_receipt_failed";
}

async function checkBrowserDownloadError(page: PageLike, deadline: Deadline): Promise<void> {
  if (typeof page.evaluate !== "function") return;
  // A missing or stalled diagnostic must leave time for the native receipt.
  // Both probes are read-only, bounded by the existing operation deadline,
  // and return an enum instead of exporting error-page URLs or body text.
  const timeoutMs = Math.min(1000, Math.floor(remainingMs(deadline) / 4));
  if (timeoutMs <= 0) return;
  let state: unknown;
  try {
    state = await withTimeout(page.evaluate(function inspectBrowserDownloadError() {
      if (!document.body?.getAttribute("class")?.split(/\s+/).includes("neterror")) return "unavailable";
      const frames = document.querySelectorAll("#main-frame-error");
      if (frames.length !== 1) return "unavailable";
      const codes = frames[0]!.querySelectorAll(".error-code");
      return codes.length === 1 && codes[0]!.textContent?.trim() === "ERR_BLOCKED_BY_CLIENT"
        ? "blocked_by_client" : "unavailable";
    }, undefined, { timeoutMs }), timeoutMs, "Browser download diagnostic timed out.");
  } catch {
    return;
  }
  if (state === "blocked_by_client") throw new DownloadBrowserBlockedError();
}

async function downloadStep<T>(deadline: Deadline, stage: string, run: () => Promise<T>, capMs?: number): Promise<T> {
  const timeoutMs = Math.min(remainingMs(deadline), capMs ?? Number.MAX_SAFE_INTEGER);
  const timeoutError = new DownloadReceiptTimeoutError(stage);
  if (timeoutMs <= 0) throw timeoutError;
  try {
    return await withTimeout(run(), timeoutMs, timeoutError.message);
  } catch (error) {
    if (error instanceof Error && error.message === timeoutError.message) throw timeoutError;
    throw error;
  }
}

export async function waitForDownloadFromClick(
  page: PageLike,
  click: () => Promise<void>,
  destDir: string,
  timeoutMs: number,
  filenameHint?: string
): Promise<DownloadedFile> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error("Download timeout must be positive and within the supported timer range.");
  }
  const deadline = createDeadline(timeoutMs);
  await checkBrowserDownloadError(page, deadline);
  const absoluteDest = resolve(destDir);
  await downloadStep(deadline, "destination preparation", () => mkdir(absoluteDest, { recursive: true }));

  if (typeof page.waitForEvent !== "function") {
    throw new Error("The active browser page does not expose download events.");
  }
  // Arm before activation. Promise.all observes both rejections immediately,
  // including a late event rejection after a failed or timed-out click.
  const nativeTimeoutMs = remainingMs(deadline);
  if (nativeTimeoutMs <= 0) throw new DownloadReceiptTimeoutError("event registration");
  const activation = new AbortController();
  let failure: ChatGPTControlError | undefined;
  const assertActive = () => {
    if (failure !== undefined) throw failure;
    if (activation.signal.aborted || remainingMs(deadline) <= 0) throw new DownloadReceiptTimeoutError("control click");
  };
  try {
    const rawWait = page.waitForEvent("download", { timeout: nativeTimeoutMs, timeoutMs: nativeTimeoutMs }) as Promise<DownloadLike>;
    const registration = coordinatedEventRegistrationBarrier(rawWait);
    let receiptFailed = false;
    const downloadPromise = downloadStep(deadline, "event receipt", () => rawWait).catch(error => {
      receiptFailed = true;
      failure = isTerminalDownloadError(error) ? error : new DownloadReceiptFailedError();
      activation.abort(failure);
      throw failure;
    });
    const [download] = await Promise.all([
      downloadPromise,
      (async () => {
        // Actor fairness may choose a queued mutation before another read.
        // Registration must finish before the activating click is even queued.
        if (registration !== undefined) await downloadStep(deadline, "event registration", () => registration);
        try {
          await downloadStep(deadline, "control click", () => withCoordinatedMutationGuard(activation.signal, assertActive, click), 10_000);
        } catch (error) {
          if (!receiptFailed) await checkBrowserDownloadError(page, deadline);
          throw error;
        }
        if (!receiptFailed) await checkBrowserDownloadError(page, deadline);
      })()
    ]);
    // saveAs is already a complete capability; an optional path() call can hang
    // on bridge implementations and is unnecessary when saveAs is available.
    const sourcePath = typeof download.saveAs !== "function" && typeof download.path === "function"
      ? await downloadStep(deadline, "source path", () => download.path!({ timeoutMs: remainingMs(deadline) })) : null;
    const suggestedFilename = filenameHint
      ?? download.suggestedFilename?.()
      ?? (sourcePath === null ? undefined : basename(sourcePath))
      ?? `chatgpt-download-${Date.now()}`;
    const targetPath = join(absoluteDest, basename(suggestedFilename));

    if (typeof download.saveAs === "function") {
      await downloadStep(deadline, "file save", () => download.saveAs!(targetPath));
    } else if (sourcePath !== null) {
      if (resolve(sourcePath) !== resolve(targetPath)) {
        await downloadStep(deadline, "file copy", () => copyFile(sourcePath, targetPath));
      }
    } else {
      throw new Error("The browser download object exposes neither saveAs() nor a completed local path().");
    }

    const saved = await downloadStep(deadline, "file verification", () => stat(targetPath));
    if (saved.size <= 0) {
      throw new Error(`Downloaded file is empty: ${targetPath}`);
    }

    return {
      path: targetPath,
      suggestedFilename,
      bytes: saved.size
    };
  } catch (error) {
    throw failure ?? (isTerminalDownloadError(error) ? error : new DownloadReceiptFailedError());
  } finally {
    // Cancels locally queued activation only. A native download already in
    // progress, or its native event listener, is not claimed to be cancelled.
    activation.abort();
  }
}
