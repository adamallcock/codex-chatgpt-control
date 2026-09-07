import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { downloadLatestArtifact, locatorCountWithTimeout } from "./artifacts.js";
import { ACTIVE_COMPOSER_FILE_INPUT_CLICK_EXPRESSION } from "../browser/active-composer-file-input.js";
import { isTerminalDownloadCode, isTerminalDownloadError, waitForDownloadFromClick } from "../browser/downloads.js";
import { nodeErrorCode, resultError, resultOk } from "../errors.js";
import { addFilesButton, cssSelectors, requiredLocator } from "../dom/selectors.js";
import { escapeRegExp, localeLabels } from "../dom/locale-labels.js";
import {
  basenameForHostPath,
  currentHostPathPlatform,
  isHostAbsolutePath,
  resolveForHostPath
} from "../platform/local-paths.js";
import type {
  AttachedFile,
  AttachFilesArgs,
  AttachFilesData,
  BlockerKind,
  BrowserInputDiagnostic,
  CommandStatus,
  CommandResult,
  DownloadedFile,
  DownloadLatestArgs,
  FileCategory,
  FileChooserLike,
  FilePreflightArgs,
  FilePreflightData,
  FilePreflightFile,
  LocatorLike,
  PageLike,
  RuntimeEnv
} from "../types.js";
import { contextFromPage } from "./context.js";
import { createDeadline, remainingMs, type Deadline } from "./deadline.js";
import { ensurePage } from "./session.js";
import { localGuardTimeout, withTimeout } from "./timeouts.js";

const CODEX_UPLOAD_PERMISSION_FIX = "Codex Settings > Computer Use > Chrome > Permissions > Uploads: set to Always allow, or add chatgpt.com to the allowed upload domains.";
const CHROME_FILE_URL_PERMISSION_FIX = "Chrome chrome://extensions > Codex extension > Details: enable Allow access to file URLs.";
const DEFAULT_MAX_BYTES_PER_FILE = 512 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

type AttachmentReadinessSnapshot = {
  supported?: boolean;
  files: Array<{ name: string; visible: boolean }>;
  processing: boolean;
  processingText?: string;
};

type AttachmentReadinessResult =
  | { ready: true }
  | { ready: false; reason: "processing" | "unverified"; processingText?: string };

type AttachmentEvidenceBaseline = {
  supported: boolean;
  inputFiles: string[];
  attachmentLabels: string[];
};

type AttachmentMutationState = {
  handoffStarted: boolean;
};

export async function validateAttachPaths(paths: string[]): Promise<AttachedFile[]> {
  const result = await preflightFiles({}, { paths });
  if (!result.ok || result.data === undefined) {
    throw new Error(result.blocker?.message ?? result.error?.message ?? "File attachment preflight failed.");
  }

  return result.data.files.map(file => ({
    path: file.path,
    name: file.name,
    bytes: file.bytes
  }));
}

export async function preflightFiles(
  env: RuntimeEnv,
  args: FilePreflightArgs
): Promise<CommandResult<FilePreflightData>> {
  const maxBytesPerFile = args.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;
  const maxTotalBytes = args.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const files: FilePreflightFile[] = [];
  const warnings: string[] = [];

  for (const [index, inputPath] of args.paths.entries()) {
    const fieldPath = `paths[${index}]`;
    if (!isHostAbsolutePath(inputPath)) {
      return filePreflightBlocker({
        env,
        status: "blocked",
        kind: "upload_failed",
        code: "file_path_not_absolute",
        fieldPath,
        message: `File attachment path must be absolute for the backend host: ${inputPath}`
      });
    }

    const absolute = resolveForHostPath(inputPath);
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(absolute);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return filePreflightBlocker({
          env,
          status: "not_found",
          kind: "not_found",
          code: "file_missing",
          fieldPath,
          message: `File attachment path does not exist: ${absolute}`
        });
      }
      if (isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM")) {
        return filePreflightBlocker({
          env,
          status: "blocked",
          kind: "permission",
          code: "file_not_readable",
          fieldPath,
          message: `File attachment path is not readable: ${absolute}`
        });
      }
      return resultError(error instanceof Error ? error : new Error(String(error)), filePreflightContext(env));
    }

    if (!fileStat.isFile()) {
      return filePreflightBlocker({
        env,
        status: "blocked",
        kind: "upload_failed",
        code: fileStat.isDirectory() ? "file_path_is_directory" : "file_path_not_file",
        fieldPath,
        message: `File attachment path is not a file: ${absolute}`
      });
    }

    try {
      await access(absolute, constants.R_OK);
    } catch (error) {
      return filePreflightBlocker({
        env,
        status: "blocked",
        kind: "permission",
        code: "file_not_readable",
        fieldPath,
        message: `File attachment path is not readable: ${absolute}`
      });
    }

    if (fileStat.size > maxBytesPerFile) {
      return filePreflightBlocker({
        env,
        status: "blocked",
        kind: "upload_failed",
        code: "file_too_large",
        fieldPath,
        message: `File attachment exceeds the configured per-file preflight limit: ${absolute} (${fileStat.size}/${maxBytesPerFile} bytes)`
      });
    }

    if (fileStat.size === 0) {
      return filePreflightBlocker({
        env,
        status: "blocked",
        kind: "upload_failed",
        code: "file_empty",
        fieldPath,
        message: `File attachment path is zero bytes and ChatGPT rejects empty attachments: ${absolute}`
      });
    }

    const metadata = await fileMetadata(absolute, fileStat.size, args.includeHashes === true);
    files.push(metadata);
  }

  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (totalBytes > maxTotalBytes) {
    return filePreflightBlocker({
      env,
      status: "blocked",
      kind: "upload_failed",
      code: "file_total_bytes_exceeded",
      fieldPath: "paths",
      message: `File attachments exceed the configured total preflight limit: ${totalBytes}/${maxTotalBytes} bytes`
    });
  }

  collectFilePreflightWarnings(files, warnings);
  return resultOk({ files, totalBytes }, filePreflightContext(env), warnings);
}

export async function attachFiles(
  env: RuntimeEnv,
  args: AttachFilesArgs
): Promise<CommandResult<AttachFilesData>> {
  const deadline = createDeadline(Math.max(1, args.timeoutMs ?? 30_000));
  const preflightArgs: FilePreflightArgs = { paths: args.paths };
  if (args.includeDiagnostics === true && args.includeHashes !== undefined) {
    preflightArgs.includeHashes = args.includeHashes;
  }
  const preflight = await preflightFiles(env, preflightArgs);
  if (!preflight.ok || preflight.data === undefined) {
    return preflight as CommandResult<AttachFilesData>;
  }

  let boot: CommandResult<unknown>;
  try {
    boot = await withinAttachmentDeadline(
      deadline,
      () => ensurePage(env, { minimalContext: true }),
      "ChatGPT page verification"
    );
  } catch (error) {
    if (error instanceof AttachmentDeadlineError || remainingMs(deadline) <= 0) {
      return attachmentDeadlineResult(error);
    }
    return resultError(error instanceof Error ? error : new Error(String(error)));
  }
  if (!boot.ok) {
    return boot as CommandResult<AttachFilesData>;
  }

  const page = env.page!;
  const mutationState: AttachmentMutationState = { handoffStarted: false };

  try {
    const files = preflight.data.files.map(file => ({
      path: file.path,
      name: file.name,
      bytes: file.bytes
    }));
    const rawBaseline = await withinNativeAttachmentDeadline(
      deadline,
      timeoutMs => readAttachmentEvidenceBaseline(page, timeoutMs),
      "Pre-upload attachment baseline",
      2_000
    ).catch(() => ({ supported: false, inputFiles: [], attachmentLabels: [] }));
    const baseline: AttachmentEvidenceBaseline = rawBaseline !== null
      && typeof rawBaseline === "object"
      && Array.isArray(rawBaseline.inputFiles)
      && Array.isArray(rawBaseline.attachmentLabels)
      ? rawBaseline
      : { supported: false, inputFiles: [], attachmentLabels: [] };

    await uploadFiles(page, files, deadline, mutationState);
    const browserInput = args.includeDiagnostics === true
      ? await withinNativeAttachmentDeadline(
          deadline,
          timeoutMs => readBrowserInputDiagnostic(page, timeoutMs),
          "Browser input diagnostic",
          2_000
        ).catch(() => undefined)
      : undefined;

    await attachmentDelay(
      page,
      deadline,
      Math.min(250, Math.max(1, Math.floor(remainingMs(deadline) / 4)))
    );
    const readiness = await waitForAttachedFilesReady(page, files, baseline, deadline);
    if (!readiness.ready) {
      return attachmentOutcomeIndeterminate(
        files,
        [],
        await attachmentContext(page, deadline),
        readiness.processingText
      );
    }
    const data: AttachFilesData = { files };
    if (args.includeDiagnostics === true) {
      data.diagnostics = { preflight: preflight.data };
      if (browserInput !== undefined) {
        data.diagnostics.browserInput = browserInput;
      }
    }
    return resultOk(data, await attachmentContext(page, deadline), preflight.warnings);
  } catch (error) {
    if (mutationState.handoffStarted) {
      const permissionFailure = isUploadPermissionBlocker(error);
      return attachmentOutcomeIndeterminate(
        preflight.data.files,
        [error instanceof Error ? error.message : String(error)],
        await attachmentContext(page, deadline),
        permissionFailure ? uploadPermissionDetails(error) : undefined,
        permissionFailure ? uploadPermissionRemediation() : undefined
      );
    }
    if (error instanceof AttachmentDeadlineError || remainingMs(deadline) <= 0) {
      return attachmentDeadlineResult(error);
    }
    if (isUploadTransportFailure(error)) {
      return {
        ok: false,
        status: "blocked",
        warnings: [],
        blocker: {
          kind: "browser_bridge_unavailable",
          code: "upload_transport_failed",
          message: "The Codex Chrome bridge disconnected while handing files to ChatGPT's visible composer. File attachment did not complete, so callers must not submit the prompt.",
          visibleText: error instanceof Error ? error.message : String(error),
          remediation: [
            {
              label: "Retry live attachment",
              instruction: "Retry the attachment from the live Codex Chrome runtime; the operation is safe to resume because file attachment did not complete.",
              userActionRequired: false
            },
            {
              label: "Restart bridge if repeated",
              instruction: "If the bridge disconnects again, restart Chrome or Codex before retrying. Do not change upload permissions unless Chrome explicitly reports a permission denial.",
              userActionRequired: true
            }
          ],
          resumable: true
        },
        context: await attachmentContext(page, deadline)
      };
    }
    if (isUploadPermissionBlocker(error)) {
      return {
        ok: false,
        status: "blocked",
        warnings: [],
        blocker: {
          kind: "permission",
          code: "upload_permission_required",
          message: uploadPermissionMessage(error),
          visibleText: uploadPermissionDetails(error),
          remediation: uploadPermissionRemediation(),
          resumable: true
        },
        context: await attachmentContext(page, deadline)
      };
    }
    if (isUploadPathFailure(error)) {
      return {
        ok: false,
        status: "blocked",
        warnings: [],
        blocker: {
          kind: "upload_failed",
          code: "upload_path_unavailable",
          message: "None of the browser's supported ChatGPT file-attachment paths completed. Callers must not submit the prompt.",
          visibleText: error instanceof Error ? error.message : String(error),
          remediation: [
            {
              label: "Retry live attachment",
              instruction: "Retry from the live Codex Chrome runtime after confirming the ChatGPT composer is visible. Do not change upload permissions unless Chrome explicitly reports a permission denial.",
              userActionRequired: false
            }
          ],
          resumable: true
        },
        context: await attachmentContext(page, deadline)
      };
    }
    return resultError(error instanceof Error ? error : new Error(String(error)), await attachmentContext(page, deadline));
  }
}

function attachmentDeadlineResult(error?: unknown): CommandResult<AttachFilesData> {
  return {
    ok: false,
    status: "timeout",
    warnings: error === undefined ? [] : [error instanceof Error ? error.message : String(error)],
    blocker: {
      kind: "upload_failed",
      code: "attachment_deadline_exhausted",
      message: "ChatGPT file attachment did not complete before the caller's single operation deadline. The prompt was not submitted.",
      resumable: true
    },
    context: { timestamp: new Date().toISOString() }
  };
}

function attachmentOutcomeIndeterminate(
  files: readonly AttachedFile[],
  warnings: string[],
  context: CommandResult<unknown>["context"],
  visibleText?: string,
  remediation?: NonNullable<NonNullable<CommandResult["blocker"]>["remediation"]>
): CommandResult<AttachFilesData> {
  const blocker: NonNullable<CommandResult<AttachFilesData>["blocker"]> = {
    kind: "upload_failed",
    code: "attachment_outcome_indeterminate",
    message: "The native file handoff started, but its outcome could not be verified. The browser request is no longer in flight, though the file may already be present. Inspect the current composer; do not submit or retry automatically.",
    resumable: false
  };
  if (visibleText !== undefined) blocker.visibleText = visibleText;
  if (remediation !== undefined) blocker.remediation = remediation;
  return {
    ok: false,
    status: "partial",
    data: {
      files: files.map(file => ({ path: file.path, name: file.name, bytes: file.bytes }))
    },
    warnings,
    blocker,
    context
  };
}

type FilePreflightBlockerArgs = {
  env: RuntimeEnv;
  status: CommandStatus;
  kind: BlockerKind;
  code: string;
  fieldPath: string;
  message: string;
};

function filePreflightBlocker(args: FilePreflightBlockerArgs): CommandResult<FilePreflightData> {
  return {
    ok: false,
    status: args.status,
    warnings: [],
    blocker: {
      kind: args.kind,
      code: args.code,
      fieldPath: args.fieldPath,
      message: args.message,
      resumable: true
    },
    context: filePreflightContext(args.env)
  };
}

function filePreflightContext(env: RuntimeEnv) {
  return { timestamp: (env.now?.() ?? new Date()).toISOString() };
}

async function fileMetadata(absolute: string, bytes: number, includeHash = false): Promise<FilePreflightFile> {
  const extension = extensionForHostPath(absolute);
  const { mimeType, category } = guessFileType(extension);
  const metadata: FilePreflightFile = {
    path: absolute,
    name: basenameForHostPath(absolute),
    bytes,
    extension,
    mimeType,
    category
  };
  if (includeHash) {
    metadata.sha256 = createHash("sha256").update(await readFile(absolute)).digest("hex");
  }
  return metadata;
}

function extensionForHostPath(value: string): string {
  return currentHostPathPlatform() === "win32"
    ? path.win32.extname(value).toLowerCase()
    : path.posix.extname(value).toLowerCase();
}

function collectFilePreflightWarnings(files: FilePreflightFile[], warnings: string[]): void {
  const byPath = new Map<string, number>();
  const byName = new Map<string, number>();

  for (const file of files) {
    const pathCount = (byPath.get(file.path) ?? 0) + 1;
    byPath.set(file.path, pathCount);
    if (pathCount === 2) {
      warnings.push(`Duplicate resolved file path requested: ${file.path}`);
    }

    const normalizedName = file.name.toLocaleLowerCase();
    const nameCount = (byName.get(normalizedName) ?? 0) + 1;
    byName.set(normalizedName, nameCount);
    if (nameCount === 2) {
      warnings.push(`Duplicate file basename requested: ${file.name}`);
    }
  }
}

function guessFileType(extension: string): { mimeType: string; category: FileCategory } {
  switch (extension) {
    case ".txt":
      return { mimeType: "text/plain", category: "text" };
    case ".md":
    case ".markdown":
      return { mimeType: "text/markdown", category: "text" };
    case ".csv":
      return { mimeType: "text/csv", category: "spreadsheet" };
    case ".tsv":
      return { mimeType: "text/tab-separated-values", category: "spreadsheet" };
    case ".json":
      return { mimeType: "application/json", category: "data" };
    case ".jsonl":
    case ".ndjson":
      return { mimeType: "application/x-ndjson", category: "data" };
    case ".pdf":
      return { mimeType: "application/pdf", category: "document" };
    case ".doc":
      return { mimeType: "application/msword", category: "document" };
    case ".docx":
      return { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", category: "document" };
    case ".xls":
      return { mimeType: "application/vnd.ms-excel", category: "spreadsheet" };
    case ".xlsx":
      return { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", category: "spreadsheet" };
    case ".png":
      return { mimeType: "image/png", category: "image" };
    case ".jpg":
    case ".jpeg":
      return { mimeType: "image/jpeg", category: "image" };
    case ".gif":
      return { mimeType: "image/gif", category: "image" };
    case ".webp":
      return { mimeType: "image/webp", category: "image" };
    case ".svg":
      return { mimeType: "image/svg+xml", category: "image" };
    case ".mp3":
      return { mimeType: "audio/mpeg", category: "audio" };
    case ".wav":
      return { mimeType: "audio/wav", category: "audio" };
    case ".mp4":
      return { mimeType: "video/mp4", category: "video" };
    case ".mov":
      return { mimeType: "video/quicktime", category: "video" };
    case ".zip":
      return { mimeType: "application/zip", category: "archive" };
    case ".gz":
      return { mimeType: "application/gzip", category: "archive" };
    default:
      return { mimeType: guessMimeType(extension), category: "unknown" };
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return nodeErrorCode(error) !== undefined;
}

async function readAttachmentEvidenceBaseline(
  page: PageLike,
  timeoutMs: number
): Promise<AttachmentEvidenceBaseline> {
  if (typeof page.evaluate !== "function") {
    return { supported: false, inputFiles: [], attachmentLabels: [] };
  }
  return page.evaluate(() => {
    const visible = (element: HTMLElement) => {
      if (element.hidden || element.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    };
    const textboxes = Array.from(document.querySelectorAll<HTMLElement>(
      "textarea, [contenteditable='true'], [role='textbox']"
    )).filter(visible);
    const composers = [...new Set(textboxes
      .map(textbox => textbox.closest<HTMLElement>("form")
        ?? textbox.closest<HTMLElement>("[data-testid*='composer' i]")
        ?? textbox.closest<HTMLElement>("[aria-label*='composer' i]")
        ?? textbox.closest<HTMLElement>("[class*='composer' i]"))
      .filter((value): value is HTMLElement => value !== null))];
    if (composers.length !== 1) {
      return { supported: false, inputFiles: [], attachmentLabels: [] };
    }
    const composer = composers[0]!;
    const allInputs = Array.from(composer.querySelectorAll<HTMLInputElement>("input[type='file']"))
      .filter(input => !input.disabled && input.getAttribute("aria-disabled") !== "true");
    const preferred = allInputs.filter(input => input.id === "upload-files");
    const nonImage = allInputs.filter(input => input.getAttribute("accept") !== "image/*");
    const inputs = preferred.length > 0 ? preferred : nonImage.length > 0 ? nonImage : allInputs;
    if (inputs.length !== 1) {
      return { supported: false, inputFiles: [], attachmentLabels: [] };
    }
    const attachmentSelector = [
      "[data-testid*='attachment' i]",
      "[data-testid*='file' i]",
      "[aria-label*='attachment' i]",
      "[aria-label*='upload' i]",
      "[aria-label*='file' i]",
      "[class*='attachment' i]",
      "[class*='upload' i]",
      "[class*='file' i]",
      "[role='progressbar']"
    ].join(", ");
    const labels = Array.from(composer.querySelectorAll<HTMLElement>(attachmentSelector))
      .filter(visible)
      .map(element => [
        element.textContent ?? "",
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("title") ?? ""
      ].join(" ").replace(/\s+/g, " ").trim().toLocaleLowerCase())
      .filter(Boolean);
    return {
      supported: true,
      inputFiles: Array.from(inputs[0]!.files ?? []).map(file => `${file.name.toLocaleLowerCase()}\u0000${file.size}`),
      attachmentLabels: labels
    };
  }, undefined, { timeoutMs });
}

async function waitForAttachedFilesReady(
  page: PageLike,
  files: AttachedFile[],
  baseline: AttachmentEvidenceBaseline,
  deadline: Deadline
): Promise<AttachmentReadinessResult> {
  let lastProcessingText: string | undefined;
  let sawProcessing = false;

  while (remainingMs(deadline) > 0) {
    const snapshot = await withinNativeAttachmentDeadline(
      deadline,
      timeoutMs => readAttachmentReadiness(page, files, baseline, timeoutMs),
      "Attachment readiness inspection",
      2_000
    ).catch(() => undefined);
    if (snapshot === undefined || snapshot.supported === false) {
      return { ready: false, reason: "unverified" };
    }

    const allNamesVisible = snapshot.files.length === files.length && snapshot.files.every(file => file.visible);
    if (!snapshot.processing && allNamesVisible) {
      return { ready: true };
    }

    sawProcessing ||= snapshot.processing;
    if (snapshot.processingText !== undefined) {
      lastProcessingText = snapshot.processingText;
    }
    const pollBudget = remainingMs(deadline);
    if (pollBudget <= 10) break;
    await attachmentDelay(page, deadline, Math.min(250, pollBudget - 10));
  }

  const blocked: Extract<AttachmentReadinessResult, { ready: false }> = {
    ready: false,
    reason: sawProcessing ? "processing" : "unverified"
  };
  if (lastProcessingText !== undefined) {
    blocked.processingText = lastProcessingText;
  }
  return blocked;
}

async function readAttachmentReadiness(
  page: PageLike,
  files: AttachedFile[],
  baseline: AttachmentEvidenceBaseline,
  timeoutMs: number
): Promise<AttachmentReadinessSnapshot | undefined> {
  if (typeof page.evaluate !== "function") {
    return undefined;
  }

  return page.evaluate((args: {
    expectedFiles: Array<{ name: string; bytes: number }>;
    baseline: AttachmentEvidenceBaseline;
  }) => {
    const expectedFiles = args.expectedFiles;
    const normalize = (value: string) => value.toLocaleLowerCase();
    const visible = (element: HTMLElement) => {
      if (element.hidden || element.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    };
    const textboxes = Array.from(document.querySelectorAll<HTMLElement>(
      "textarea, [contenteditable='true'], [role='textbox']"
    )).filter(visible);
    const composers = [...new Set(textboxes
      .map(textbox => textbox.closest<HTMLElement>("form")
        ?? textbox.closest<HTMLElement>("[data-testid*='composer' i]")
        ?? textbox.closest<HTMLElement>("[aria-label*='composer' i]")
        ?? textbox.closest<HTMLElement>("[class*='composer' i]"))
      .filter((value): value is HTMLElement => value !== null))];
    if (composers.length !== 1) {
      return { supported: false, files: expectedFiles.map(file => ({ name: file.name, visible: false })), processing: false };
    }
    const composer = composers[0]!;
    const allInputs = Array.from(composer.querySelectorAll<HTMLInputElement>("input[type='file']"))
      .filter(input => !input.disabled && input.getAttribute("aria-disabled") !== "true");
    const preferred = allInputs.filter(input => input.id === "upload-files");
    const nonImage = allInputs.filter(input => input.getAttribute("accept") !== "image/*");
    const inputs = preferred.length > 0 ? preferred : nonImage.length > 0 ? nonImage : allInputs;
    if (inputs.length !== 1) {
      return { supported: false, files: expectedFiles.map(file => ({ name: file.name, visible: false })), processing: false };
    }
    const input = inputs[0]!;

    const attachmentSelectors = [
      "[data-testid*='attachment' i]",
      "[data-testid*='file' i]",
      "[aria-label*='attachment' i]",
      "[aria-label*='upload' i]",
      "[aria-label*='file' i]",
      "[class*='attachment' i]",
      "[class*='upload' i]",
      "[class*='file' i]",
      "[role='progressbar']"
    ].join(", ");
    const attachmentElements = Array.from(composer.querySelectorAll<HTMLElement>(attachmentSelectors)).filter(visible);
    const attachmentText = attachmentElements
      .map(element => [
        element.textContent ?? "",
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("title") ?? ""
      ].join(" "))
      .join(" ");
    const inputFiles = Array.from(input.files ?? []).map(file => ({
      name: normalize(file.name),
      size: file.size,
      signature: `${normalize(file.name)}\u0000${file.size}`
    }));
    const attachmentLabels = attachmentElements.map(element => normalize([
      element.textContent ?? "",
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("title") ?? ""
    ].join(" ")));
    const occurrence = (values: string[], index: number) =>
      values.slice(0, index + 1).filter(value => value === values[index]).length;
    const inputSignatures = inputFiles.map(file => file.signature);
    const newInputIndices = new Set(inputSignatures
      .map((signature, index) => occurrence(inputSignatures, index)
        > args.baseline.inputFiles.filter(value => value === signature).length ? index : -1)
      .filter(index => index >= 0));
    const newLabelIndices = new Set(attachmentLabels
      .map((label, index) => args.baseline.supported
        && occurrence(attachmentLabels, index)
          > args.baseline.attachmentLabels.filter(value => value === label).length ? index : -1)
      .filter(index => index >= 0));
    const usedInputs = new Set<number>();
    const usedLabels = new Set<number>();
    const visibleFiles = expectedFiles.map(expected => {
      const expectedName = normalize(expected.name);
      const inputIndex = inputFiles.findIndex((candidate, index) =>
        !usedInputs.has(index)
          && newInputIndices.has(index)
          && candidate.name === expectedName
          && candidate.size === expected.bytes
      );
      if (inputIndex >= 0) {
        usedInputs.add(inputIndex);
        return { name: expected.name, visible: true };
      }
      const labelIndex = attachmentLabels.findIndex((label, index) =>
        !usedLabels.has(index) && newLabelIndices.has(index) && label.includes(expectedName)
      );
      if (labelIndex >= 0) usedLabels.add(labelIndex);
      return { name: expected.name, visible: labelIndex >= 0 };
    });
    const processingMatch = /\b(uploading|processing|attaching|preparing|reading|scanning|analyzing)\b/i.exec(attachmentText);
    const snapshot: AttachmentReadinessSnapshot = {
      supported: true,
      files: visibleFiles,
      processing: processingMatch !== null
    };
    if (processingMatch !== null) {
      snapshot.processingText = attachmentText.slice(0, 500);
    }
    return snapshot;
  }, {
    expectedFiles: files.map(file => ({ name: file.name, bytes: file.bytes })),
    baseline
  }, { timeoutMs });
}

async function uploadFiles(
  page: NonNullable<RuntimeEnv["page"]>,
  files: AttachedFile[],
  deadline: Deadline,
  mutationState: AttachmentMutationState
): Promise<void> {
  const paths = files.map(file => file.path);
  const errors: string[] = [];
  let activeComposerInput: LocatorLike | undefined;
  try {
    activeComposerInput = await resolveUniqueActiveComposerFileInput(page, deadline);
  } catch (error) {
    errors.push(`active-composer-input: ${error instanceof Error ? error.message : String(error)}`);
  }

  const attempts: Array<{ name: string; run: () => Promise<void> }> = [];
  if (activeComposerInput !== undefined) {
    const resolvedInput = activeComposerInput;
    attempts.push({
      name: "visible-chatgpt-file-input",
      run: async () => {
        if (!await locatorIsRendered(resolvedInput, deadline)) {
          throw new Error("The active-composer upload target is hidden.");
        }
        await clickFileChooserLocator(page, resolvedInput, paths, deadline, mutationState);
      }
    });
  }
  attempts.push(
    {
      name: "add-photos-files-menu-item",
      run: async () => {
        await clickChatGPTAddPhotosMenuItem(page, paths, deadline, mutationState);
      }
    },
    {
      name: "generic-add-files-button",
      run: async () => {
        const control = addFilesButton(page);
        await assertControlInUniqueActiveComposer(control, deadline, "Generic Add files control");
        await clickFileChooserLocator(page, control, paths, deadline, mutationState);
      }
    },
    {
      name: "cdp-file-input-chooser",
      run: async () => {
        await clickHiddenFileInputWithCdp(page, paths, deadline, mutationState);
      }
    }
  );
  if (activeComposerInput !== undefined) {
    const resolvedInput = activeComposerInput;
    attempts.push({
      name: "direct-file-input-set",
      run: async () => {
        await setResolvedFileInput(resolvedInput, files, deadline, mutationState);
      }
    });
  }

  for (const attempt of attempts) {
    if (remainingMs(deadline) <= 0) {
      errors.push(`${attempt.name}: skipped because the single attachment deadline was exhausted`);
      break;
    }
    try {
      await attempt.run();
      return;
    } catch (error) {
      if (mutationState.handoffStarted) {
        throw error;
      }
      if (isUploadPermissionBlocker(error) || isUploadTransportFailure(error)) {
        throw error;
      }
      errors.push(`${attempt.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No ChatGPT upload path completed.\n${errors.join("\n")}`);
}

async function clickChatGPTAddPhotosMenuItem(
  page: PageLike,
  paths: string[],
  deadline: Deadline,
  mutationState: AttachmentMutationState
): Promise<void> {
  // The `#composer-plus-btn` id is the language-agnostic primary; the aria-label and the
  // menu-item text are locale-sensitive (menu text sourced from the locale registry).
  const addPhotosFilesLabels = localeLabels.addPhotosFilesMenuItem;
  let menuItem = await findChatGPTUploadMenuItem(page, addPhotosFilesLabels, deadline);

  if (menuItem === undefined) {
    const plusButton = requiredLocator(page, "#composer-plus-btn, button[aria-label='Add files and more']");
    if (await locatorCount(plusButton, deadline) !== 1) {
      throw new Error("ChatGPT Add files button was not uniquely available.");
    }
    await assertControlInUniqueActiveComposer(plusButton, deadline, "ChatGPT Add files control");
    if (plusButton.click === undefined) throw new Error("ChatGPT Add files button does not expose click().");
    await withinNativeAttachmentDeadline(
      deadline,
      timeoutMs => plusButton.click!({ timeoutMs }),
      "ChatGPT Add files control click",
      10_000
    );
    await attachmentDelay(page, deadline, 250);
  }

  menuItem = await findChatGPTUploadMenuItem(page, addPhotosFilesLabels, deadline);
  if (menuItem === undefined) {
    throw new Error("ChatGPT's visible Add photos & files upload row was not uniquely available.");
  }
  const refreshedMenuItem = menuItem;
  await clickFileChooserLocator(page, refreshedMenuItem, paths, deadline, mutationState);
}

async function findChatGPTUploadMenuItem(
  page: PageLike,
  addPhotosFilesLabels: readonly string[],
  deadline: Deadline
): Promise<LocatorLike | undefined> {
  // Current Chat renders the command palette upload action as a focusable row
  // with tabindex=0 and no ARIA menuitem role.
  const pattern = new RegExp(addPhotosFilesLabels.map(escapeRegExp).join("|"), "i");
  const candidate = requiredLocator(page, "div[tabindex='0']").filter?.({ hasText: pattern });
  return await locatorCount(candidate, deadline) === 1 ? candidate : undefined;
}

async function clickFileChooserLocator(
  page: PageLike,
  locator: LocatorLike | undefined,
  paths: string[],
  deadline: Deadline,
  mutationState: AttachmentMutationState
): Promise<void> {
  if (locator === undefined) {
    throw new Error("Upload locator was not available.");
  }
  if (typeof page.waitForEvent !== "function") {
    throw new Error("The active browser page does not expose file chooser events.");
  }
  if (typeof locator.click !== "function") {
    throw new Error("Upload locator does not expose click().");
  }

  // Attach a rejection handler immediately. Browser bridges can reject the
  // chooser wait before the visible click promise settles; leaving that
  // rejection temporarily unobserved can terminate the host JavaScript
  // runtime even though attachFiles has a surrounding error boundary.
  const chooserPromise = waitForFileChooser(page, deadline).then(
    chooser => ({ ok: true as const, chooser }),
    error => ({ ok: false as const, error })
  );
  try {
    await withinNativeAttachmentDeadline(
      deadline,
      timeoutMs => locator.click!({ timeoutMs }),
      "ChatGPT upload-control click",
      10_000
    );
  } catch (error) {
    await chooserPromise;
    throw error;
  }

  const chooserResult = await chooserPromise;
  if (!chooserResult.ok) {
    throw chooserResult.error;
  }
  const chooser = chooserResult.chooser;
  await validateChooserTarget(chooser, deadline, "scoped-composer-trigger");
  await withinAttachmentDeadline(
    deadline,
    () => validateChooserMultiplicity(chooser, paths),
    "File-chooser multiplicity validation"
  );
  try {
    mutationState.handoffStarted = true;
    await withinNativeAttachmentDeadline(
      deadline,
      timeoutMs => chooser.setFiles(paths, { timeoutMs }),
      "File-chooser handoff",
      15_000
    );
  } catch (error) {
    throw new Error(`fileChooser.setFiles failed. ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function clickHiddenFileInputWithCdp(
  page: PageLike,
  paths: string[],
  deadline: Deadline,
  mutationState: AttachmentMutationState
): Promise<void> {
  // Codex Chrome exposes page.evaluate as read-only and intentionally omits
  // locator.setInputFiles. CDP supplies only the trusted user gesture here;
  // the sanctioned file-chooser object still performs the local handoff.
  if (typeof page.waitForEvent !== "function") {
    throw new Error("The active browser page does not expose file chooser events.");
  }

  const rawCapability = await withinAttachmentDeadline(
    deadline,
    () => Promise.resolve(page.capabilities?.get?.("cdp")),
    "Scoped CDP upload capability resolution"
  );
  const cdp = rawCapability as {
    send?: (method: string, params?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> | unknown;
  } | undefined;
  if (typeof cdp?.send !== "function") {
    throw new Error("The active browser page does not expose the scoped CDP capability needed to click a hidden file input.");
  }

  const chooserPromise = waitForFileChooser(page, deadline).then(
    chooser => ({ ok: true as const, chooser }),
    error => ({ ok: false as const, error })
  );
  try {
    const evaluation = await withinNativeAttachmentDeadline(deadline, timeoutMs => Promise.resolve(cdp.send!("Runtime.evaluate", {
      expression: ACTIVE_COMPOSER_FILE_INPUT_CLICK_EXPRESSION,
      userGesture: true,
      awaitPromise: true,
      returnByValue: true
    }, {
      timeoutMs
    })), "Scoped CDP file-input click", 10_000);
    const wrappedValue = (evaluation as { result?: { value?: unknown } } | undefined)?.result?.value;
    const value = (wrappedValue ?? evaluation) as { ok?: boolean; reason?: string } | undefined;
    if (value?.ok !== true) {
      throw new Error(`Scoped CDP file-input click was refused: ${value?.reason ?? "no success result"}.`);
    }
  } catch (error) {
    await chooserPromise;
    throw error;
  }

  const chooserResult = await chooserPromise;
  if (!chooserResult.ok) {
    throw chooserResult.error;
  }
  await validateChooserTarget(chooserResult.chooser, deadline, "scoped-cdp-input");
  await withinAttachmentDeadline(
    deadline,
    () => validateChooserMultiplicity(chooserResult.chooser, paths),
    "File-chooser multiplicity validation"
  );
  try {
    mutationState.handoffStarted = true;
    await withinNativeAttachmentDeadline(
      deadline,
      timeoutMs => chooserResult.chooser.setFiles(paths, { timeoutMs }),
      "File-chooser handoff",
      15_000
    );
  } catch (error) {
    throw new Error(`fileChooser.setFiles failed. ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function waitForFileChooser(page: PageLike, deadline: Deadline): Promise<FileChooserLike> {
  const rawChooser = await withinNativeAttachmentDeadline(
    deadline,
    timeoutMs => Promise.resolve(page.waitForEvent?.("filechooser", { timeoutMs })),
    "File-chooser event wait"
  );

  if (!isFileChooserLike(rawChooser)) {
    throw new Error("File chooser event did not return a setFiles-capable chooser.");
  }

  return rawChooser;
}

async function validateChooserMultiplicity(chooser: FileChooserLike, paths: string[]): Promise<void> {
  if (paths.length <= 1 || typeof chooser.isMultiple !== "function") {
    return;
  }

  const isMultiple = await chooser.isMultiple();
  if (!isMultiple) {
    throw new Error("The active ChatGPT file chooser only accepts one file.");
  }
}

function isFileChooserLike(value: unknown): value is FileChooserLike {
  return value !== null
    && typeof value === "object"
    && typeof (value as FileChooserLike).setFiles === "function";
}

type ChooserTriggerProof = "scoped-composer-trigger" | "scoped-cdp-input";

async function validateChooserTarget(
  chooser: FileChooserLike,
  deadline: Deadline,
  _triggerProof: ChooserTriggerProof
): Promise<void> {
  if (typeof chooser.element !== "function") {
    // The Codex Chrome bridge deliberately exposes only isMultiple/setFiles.
    // This function is reachable only after the initiating input/control has
    // already been proven to belong to the unique active composer (or after
    // the scoped CDP expression proved and clicked that exact input).
    return;
  }
  const element = await withinAttachmentDeadline(
    deadline,
    () => Promise.resolve(chooser.element!()),
    "File-chooser backing-input resolution"
  );
  if (typeof element?.evaluate !== "function") {
    throw new Error("The file chooser backing input could not be inspected safely.");
  }
  const scoped = await withinNativeAttachmentDeadline(deadline, timeoutMs => element.evaluate!((candidate: Element) => {
    const visible = (node: HTMLElement) => {
      if (node.hidden || node.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
        && style.pointerEvents !== "none" && (rect.width > 0 || rect.height > 0);
    };
    const textboxes = Array.from(document.querySelectorAll<HTMLElement>(
      "textarea, [contenteditable='true'], [role='textbox']"
    )).filter(visible);
    const composers = [...new Set(textboxes
      .map(textbox => textbox.closest<HTMLElement>("form")
        ?? textbox.closest<HTMLElement>("[data-testid*='composer' i]")
        ?? textbox.closest<HTMLElement>("[aria-label*='composer' i]")
        ?? textbox.closest<HTMLElement>("[class*='composer' i]"))
      .filter((value): value is HTMLElement => value !== null))];
    if (composers.length !== 1 || !composers[0]!.contains(candidate)) return false;
    const all = Array.from(composers[0]!.querySelectorAll<HTMLInputElement>("input[type='file']"))
      .filter(input => !input.disabled && input.getAttribute("aria-disabled") !== "true");
    const preferred = all.filter(input => input.id === "upload-files");
    const nonImage = all.filter(input => input.getAttribute("accept") !== "image/*");
    const resolved = preferred.length > 0 ? preferred : nonImage.length > 0 ? nonImage : all;
    return resolved.length === 1 && resolved[0] === candidate;
  }, undefined, { timeoutMs }), "File-chooser active-composer identity check", 2_000);
  if (!scoped) {
    throw new Error("The file chooser backing input was not the unique active-composer upload target.");
  }
}

async function locatorCount(locator: LocatorLike | undefined, deadline?: Deadline): Promise<number> {
  if (locator === undefined) {
    return 0;
  }
  if (deadline !== undefined && typeof locator.allTextContents === "function") {
    const values = await withinNativeAttachmentDeadline(
      deadline,
      timeoutMs => locator.allTextContents!({ timeoutMs }),
      "Locator enumeration",
      2_000
    );
    return values.length;
  }
  if (typeof locator.count !== "function") return 0;
  if (deadline !== undefined) {
    return withinAttachmentDeadline(deadline, () => locator.count!(), "Locator enumeration");
  }
  return locator.count();
}

async function locatorIsRendered(locator: LocatorLike, deadline: Deadline): Promise<boolean> {
  if (typeof locator.evaluate !== "function") return false;
  return withinNativeAttachmentDeadline(deadline, timeoutMs => locator.evaluate!((element: Element) => {
    const node = element as HTMLElement;
    if (node.hidden || node.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && style.opacity !== "0"
      && style.pointerEvents !== "none"
      && (rect.width > 0 || rect.height > 0);
  }, undefined, { timeoutMs }), "Active-composer file-input visibility check", 1_000);
}

function attachmentBudget(deadline: Deadline): number {
  const budget = remainingMs(deadline);
  if (budget <= 0) {
    throw new AttachmentDeadlineError("Attachment operation");
  }
  return budget;
}

class AttachmentDeadlineError extends Error {
  constructor(label: string) {
    super(`${label} exceeded the single attachment deadline.`);
    this.name = "AttachmentDeadlineError";
  }
}

async function withinAttachmentDeadline<T>(
  deadline: Deadline,
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  const budget = attachmentBudget(deadline);
  try {
    return await withTimeout(operation(), budget, `${label} exceeded the single attachment deadline.`);
  } catch (error) {
    if (remainingMs(deadline) <= 0
      || (error instanceof Error && error.message.includes("exceeded the single attachment deadline"))) {
      throw new AttachmentDeadlineError(label);
    }
    throw error;
  }
}

async function withinNativeAttachmentDeadline<T>(
  deadline: Deadline,
  operation: (timeoutMs: number) => Promise<T>,
  label: string,
  capMs = Number.POSITIVE_INFINITY
): Promise<T> {
  const timeoutMs = Math.min(capMs, attachmentBudget(deadline));
  try {
    // Browser-native timeoutMs is the cancellation boundary. Do not wrap this
    // promise in Promise.race: abandoning a mutation promise lets it fire later.
    return await operation(timeoutMs);
  } catch (error) {
    if (remainingMs(deadline) <= 0) {
      throw new AttachmentDeadlineError(label);
    }
    throw error;
  }
}

async function attachmentDelay(_page: PageLike, deadline: Deadline, requestedMs: number): Promise<void> {
  const budget = attachmentBudget(deadline);
  const delayMs = Math.min(Math.max(0, requestedMs), Math.max(0, budget - 1));
  if (delayMs <= 0) {
    if (requestedMs > 0) throw new AttachmentDeadlineError("Attachment settling delay");
    return;
  }
  // A host timer cannot strand a browser request and is sufficient for polling.
  await new Promise<void>(resolve => setTimeout(resolve, delayMs));
}

async function attachmentContext(page: PageLike, _deadline: Deadline) {
  return contextFromPage(page, {}, { minimal: true });
}

export async function downloadLatestFile(
  env: RuntimeEnv,
  args: DownloadLatestArgs
): Promise<CommandResult<DownloadedFile>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<DownloadedFile>;
  }

  const page = env.page!;

  try {
    const generatedFileDownload = await tryGeneratedFilePreviewDownload(page, args);
    if (generatedFileDownload !== undefined) {
      return generatedFileDownload;
    }

    if (args.filenamePattern !== undefined) {
      return {
        ok: false,
        status: "unsupported",
        warnings: [],
        blocker: {
          kind: "download_unavailable",
          code: "download_filename_not_found",
          message: `No visible ChatGPT file affordance matched filenamePattern ${JSON.stringify(args.filenamePattern)}.`,
          resumable: true
        },
        context: await contextFromPage(page)
      };
    }

    const controls = requiredLocator(page, cssSelectors.downloadControls);
    let count: number;
    try {
      count = await locatorCountWithTimeout(controls, localGuardTimeout(args.timeoutMs, 5000), "download_control_timeout");
    } catch (error) {
      return {
        ok: false,
        status: "unsupported",
        warnings: [],
        blocker: {
          kind: "download_unavailable",
          code: "download_control_timeout",
          message: `No visible ChatGPT download control could be counted before the local guard timeout: ${error instanceof Error ? error.message : String(error)}`,
          resumable: true
        },
        context: await contextFromPage(page)
      };
    }
    if (count === 0) {
      const artifactDownload = await downloadLatestArtifact(env, args);
      if (artifactDownload.ok || isTerminalDownloadCode(artifactDownload.blocker?.code)) {
        return artifactDownload;
      }
      return {
        ok: false,
        status: "unsupported",
        warnings: [],
        blocker: {
          kind: "download_unavailable",
          message: "No visible ChatGPT download control was found."
        },
        context: await contextFromPage(page)
      };
    }

    const target = args.from === "visible_conversation" ? controls.last?.() ?? controls : controls.last?.() ?? controls;
    const downloaded = await waitForDownloadFromClick(
      page,
      async () => {
        await target.click?.();
      },
      args.destDir,
      args.timeoutMs ?? 120000
    );
    return resultOk(downloaded, await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page, {}, { minimal: isTerminalDownloadError(error) }));
  }
}

type GeneratedFileAffordance = {
  assistantIndex: number;
  filename: string;
  controlLabel?: string;
  tag: "button" | "a";
};

async function tryGeneratedFilePreviewDownload(
  page: RuntimeEnv["page"] & {},
  args: DownloadLatestArgs
): Promise<CommandResult<DownloadedFile> | undefined> {
  const timeoutMs = args.timeoutMs ?? 120000;
  const candidates = await inspectGeneratedFileAffordances(page, localGuardTimeout(timeoutMs, 5000));
  const selected = selectGeneratedFileAffordance(candidates, args);
  if (selected === undefined) return undefined;

  try {
    const assistantMessages = requiredLocator(page, cssSelectors.assistantMessages);
    const assistantCount = await locatorCountWithTimeout(
      assistantMessages,
      localGuardTimeout(timeoutMs, 5000),
      "generated_file_assistant_count_timeout"
    );
    if (selected.assistantIndex < 0 || selected.assistantIndex >= assistantCount) {
      throw new Error("The selected generated-file assistant turn is no longer present.");
    }

    const assistant = assistantMessages.nth?.(selected.assistantIndex) ?? assistantMessages;
    const role = selected.tag === "button" ? "button" : "link";
    const controlLabel = selected.controlLabel ?? selected.filename;
    const affordance = assistant.getByRole?.(role, { name: controlLabel, exact: true })
      ?? assistant.locator?.(`${selected.tag}[aria-label="${escapeCssAttribute(controlLabel)}"]`);
    const affordanceCount = await locatorCountWithTimeout(
      affordance,
      localGuardTimeout(timeoutMs, 5000),
      "generated_file_affordance_count_timeout"
    );
    if (affordance === undefined || affordanceCount !== 1 || typeof affordance.click !== "function") {
      throw new Error(`Expected one clickable generated-file affordance for ${selected.filename}, found ${affordanceCount}.`);
    }

    if (selected.tag === "a") {
      const downloaded = await waitForDownloadFromClick(
        page,
        () => affordance.click!({ timeoutMs: localGuardTimeout(timeoutMs, 10000) }),
        args.destDir,
        timeoutMs,
        selected.filename
      );
      return resultOk(downloaded, await contextFromPage(page));
    }

    await affordance.click({ timeoutMs: localGuardTimeout(timeoutMs, 10000) });
    const labelledPreview = requiredLocator(page, `section[aria-label="${escapeCssAttribute(selected.filename)}"]`);
    const workbookPreviews = requiredLocator(page, "section[data-testid^='popcorn-']");
    // A provider without locator filtering cannot tie a workbook preview to
    // the selected filename. Keep the explicitly labelled preview usable.
    const workbookPreview = typeof workbookPreviews.filter === "function"
      ? workbookPreviews.filter({ hasText: selected.filename })
      : undefined;
    const download = await waitForPreviewDownloadControl(
      page,
      workbookPreview === undefined ? [labelledPreview] : [labelledPreview, workbookPreview],
      timeoutMs
    );
    if (download === undefined) {
      throw new Error(`The artifact preview for ${selected.filename} did not expose a visible Download control.`);
    }

    const downloaded = await waitForDownloadFromClick(
      page,
      async () => download.click?.({ timeoutMs: localGuardTimeout(timeoutMs, 10000) }),
      args.destDir,
      timeoutMs,
      selected.filename
    );
    return resultOk(downloaded, await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page, {}, { minimal: isTerminalDownloadError(error) }));
  }
}

async function inspectGeneratedFileAffordances(
  page: RuntimeEnv["page"] & {},
  timeoutMs: number
): Promise<GeneratedFileAffordance[]> {
  if (typeof page.evaluate === "function") {
    const fromDom = await withTimeout(
      page.evaluate((downloadLabels: string[]) => {
        const visible = (element: Element): boolean => {
          let current: Element | null = element;
          while (current !== null) {
            const html = current as HTMLElement;
            const style = window.getComputedStyle(html);
            const rect = html.getBoundingClientRect();
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") <= 0) return false;
            if (current === element && (rect.width <= 0 || rect.height <= 0)) return false;
            current = current.parentElement;
          }
          return true;
        };
        const fileLike = (value: string): boolean => /^[^\\/\r\n]{1,255}\.[a-z0-9][a-z0-9._-]{0,15}$/i.test(value);
        const normalizedFilename = (value: string): string => {
          const trimmed = value.trim();
          const lowered = trimmed.toLocaleLowerCase();
          const prefix = downloadLabels
            .map(label => label.trim())
            .filter(Boolean)
            .sort((left, right) => right.length - left.length)
            .find(label => lowered.startsWith(`${label.toLocaleLowerCase()} `));
          return prefix === undefined ? trimmed : trimmed.slice(prefix.length).trim();
        };
        const assistants = Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));
        return assistants.flatMap((assistant, assistantIndex) =>
          Array.from(assistant.querySelectorAll("button[aria-label], a[download], a[href*='/backend-api/files/']"))
            .filter(visible)
            .map(element => {
              const controlLabel = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
              const text = (element.textContent ?? "").trim();
              return {
                assistantIndex,
                filename: normalizedFilename(controlLabel),
                controlLabel,
                tag: element.tagName.toLocaleLowerCase(),
                textFilename: normalizedFilename(text)
              };
            })
            .filter(item => (item.tag === "button" || item.tag === "a") && fileLike(item.filename) && item.filename === item.textFilename)
            .map(({ assistantIndex: index, filename, controlLabel, tag }) => ({
              assistantIndex: index,
              filename,
              ...(controlLabel === filename ? {} : { controlLabel }),
              tag
            }))
        );
      }, [...localeLabels.download]),
      timeoutMs,
      "Timed out while inspecting generated-file buttons."
    ).catch(() => undefined);
    if (Array.isArray(fromDom)) return fromDom as GeneratedFileAffordance[];
  }

  if (typeof page.content !== "function") return [];
  const html = await withTimeout(
    page.content(),
    timeoutMs,
    "Timed out while reading generated-file button markup."
  ).catch(() => "");
  const candidates: GeneratedFileAffordance[] = [];
  const buttonPattern = /<(button|a)\b[^>]*\baria-label=(['"])(.*?)\2[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = buttonPattern.exec(html)) !== null) {
    const controlLabel = decodeBasicHtml(match[3] ?? "").trim();
    const text = decodeBasicHtml((match[4] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const filename = normalizeGeneratedFileControlLabel(controlLabel);
    const textFilename = normalizeGeneratedFileControlLabel(text);
    if (/^[^\\/\r\n]{1,255}\.[a-z0-9][a-z0-9._-]{0,15}$/i.test(filename) && filename === textFilename) {
      candidates.push({
        assistantIndex: 0,
        filename,
        ...(controlLabel === filename ? {} : { controlLabel }),
        tag: (match[1] ?? "button").toLocaleLowerCase() as "button" | "a"
      });
    }
  }
  return candidates;
}

function normalizeGeneratedFileControlLabel(value: string): string {
  return stripLocalizedDownloadPrefix(value, localeLabels.download);
}

export function stripLocalizedDownloadPrefix(value: string, labels: readonly string[]): string {
  const trimmed = value.trim();
  const lowered = trimmed.toLocaleLowerCase();
  const prefix = labels
    .map(label => label.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .find(label => lowered.startsWith(`${label.toLocaleLowerCase()} `));
  return prefix === undefined ? trimmed : trimmed.slice(prefix.length).trim();
}

function selectGeneratedFileAffordance(
  candidates: GeneratedFileAffordance[],
  args: DownloadLatestArgs
): GeneratedFileAffordance | undefined {
  let scoped = candidates;
  const from = args.from;
  if (typeof from === "object" && from !== null) {
    scoped = scoped.filter(candidate => candidate.assistantIndex === from.assistantIndex);
  } else if (from !== "visible_conversation") {
    const latestAssistant = Math.max(-1, ...scoped.map(candidate => candidate.assistantIndex));
    scoped = scoped.filter(candidate => candidate.assistantIndex === latestAssistant);
  }
  if (args.filenamePattern !== undefined) {
    scoped = scoped.filter(candidate => filenameMatches(candidate.filename, args.filenamePattern!));
  }
  return scoped.at(-1);
}

function filenameMatches(filename: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(filename);
  } catch {
    return filename.toLocaleLowerCase().includes(pattern.toLocaleLowerCase());
  }
}

async function waitForPreviewDownloadControl(
  page: RuntimeEnv["page"] & {},
  previews: LocatorLike[],
  timeoutMs: number
): Promise<LocatorLike | undefined> {
  const deadline = Date.now() + Math.min(timeoutMs, 60000);
  while (Date.now() < deadline) {
    for (const preview of previews) {
      for (const label of localeLabels.download) {
        const control = preview.getByRole?.("button", { name: label, exact: true })
          ?? preview.locator?.(`button[aria-label="${escapeCssAttribute(label)}"]`);
        if (await locatorCountWithTimeout(control, localGuardTimeout(timeoutMs, 2000), "artifact_preview_download_count_timeout") === 1) {
          return control;
        }
      }
    }
    if (typeof page.waitForTimeout === "function") {
      await page.waitForTimeout(100);
    } else {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  return undefined;
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");
}

function decodeBasicHtml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

async function resolveUniqueActiveComposerFileInput(
  page: PageLike,
  deadline: Deadline
): Promise<LocatorLike> {
  const candidates = requiredLocator(page, cssSelectors.hiddenFileInputs);
  if (typeof candidates.count !== "function") {
    throw new Error("ChatGPT file inputs could not be enumerated safely.");
  }
  const count = await locatorCount(candidates, deadline);
  const eligible: LocatorLike[] = [];
  for (let index = 0; index < count; index += 1) {
    const input = count === 1 ? candidates : candidates.nth?.(index);
    if (input === undefined || typeof input.evaluate !== "function") continue;
    const scoped = await withinNativeAttachmentDeadline(deadline, timeoutMs => input.evaluate!((element: Element) => {
      const candidate = element as HTMLInputElement;
      const visible = (node: HTMLElement) => {
        if (node.hidden || node.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
          && (rect.width > 0 || rect.height > 0);
      };
      const textboxes = Array.from(document.querySelectorAll<HTMLElement>(
        "textarea, [contenteditable='true'], [role='textbox']"
      )).filter(visible);
    const composers = [...new Set(textboxes
        .map(textbox => textbox.closest<HTMLElement>("form")
          ?? textbox.closest<HTMLElement>("[data-testid*='composer' i]")
          ?? textbox.closest<HTMLElement>("[aria-label*='composer' i]")
          ?? textbox.closest<HTMLElement>("[class*='composer' i]"))
        .filter((value): value is HTMLElement => value !== null))];
      if (composers.length !== 1 || !composers[0]!.contains(candidate)) return false;
      const all = Array.from(composers[0]!.querySelectorAll<HTMLInputElement>("input[type='file']"))
        .filter(input => !input.disabled && input.getAttribute("aria-disabled") !== "true");
      const preferred = all.filter(input => input.id === "upload-files");
      const nonImage = all.filter(input => input.getAttribute("accept") !== "image/*");
      const resolved = preferred.length > 0 ? preferred : nonImage.length > 0 ? nonImage : all;
      return resolved.length === 1 && resolved[0] === candidate;
    }, undefined, { timeoutMs }), `File-input ${index + 1} scope check`, 2_000);
    if (scoped) eligible.push(input);
  }
  if (eligible.length !== 1) {
    throw new Error("The active browser exposes no sanctioned native file handoff because the active composer file input was not uniquely available.");
  }
  return eligible[0]!;
}

async function assertControlInUniqueActiveComposer(
  control: LocatorLike | undefined,
  deadline: Deadline,
  label: string
): Promise<void> {
  if (control === undefined || typeof control.evaluate !== "function") {
    throw new Error(`${label} could not be scoped to the active composer.`);
  }
  const scoped = await withinNativeAttachmentDeadline(deadline, timeoutMs => control.evaluate!((element: Element) => {
    const visible = (node: HTMLElement) => {
      if (node.hidden || node.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
        && (rect.width > 0 || rect.height > 0);
    };
    const textboxes = Array.from(document.querySelectorAll<HTMLElement>(
      "textarea, [contenteditable='true'], [role='textbox']"
    )).filter(visible);
    const composers = [...new Set(textboxes
      .map(textbox => textbox.closest<HTMLElement>("form")
        ?? textbox.closest<HTMLElement>("[data-testid*='composer' i]")
        ?? textbox.closest<HTMLElement>("[aria-label*='composer' i]")
        ?? textbox.closest<HTMLElement>("[class*='composer' i]"))
      .filter((value): value is HTMLElement => value !== null))];
    return composers.length === 1 && composers[0]!.contains(element);
  }, undefined, { timeoutMs }), `${label} scope check`, 2_000);
  if (!scoped) throw new Error(`${label} was outside the unique active composer.`);
}

async function setResolvedFileInput(
  input: LocatorLike,
  files: AttachedFile[],
  deadline: Deadline,
  mutationState: AttachmentMutationState
): Promise<void> {
  if (typeof input.setInputFiles !== "function") {
    throw new Error("The active browser exposes no sanctioned native file handoff for ChatGPT's file input.");
  }
  mutationState.handoffStarted = true;
  await withinNativeAttachmentDeadline(
    deadline,
    timeoutMs => input.setInputFiles!(files.map(file => file.path), { timeoutMs }),
    "Direct file-input handoff",
    15_000
  );
}

async function readBrowserInputDiagnostic(
  page: PageLike,
  timeoutMs: number
): Promise<BrowserInputDiagnostic | undefined> {
  if (typeof page.evaluate !== "function") {
    return undefined;
  }

  return page.evaluate(() => {
    const visible = (element: HTMLElement) => {
      if (element.hidden || element.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    };
    const textboxes = Array.from(document.querySelectorAll<HTMLElement>(
      "textarea, [contenteditable='true'], [role='textbox']"
    )).filter(visible);
    const composers = [...new Set(textboxes
      .map(textbox => textbox.closest<HTMLElement>("form")
        ?? textbox.closest<HTMLElement>("[data-testid*='composer' i]")
        ?? textbox.closest<HTMLElement>("[aria-label*='composer' i]")
        ?? textbox.closest<HTMLElement>("[class*='composer' i]"))
      .filter((value): value is HTMLElement => value !== null))];
    if (composers.length !== 1) return undefined;
    const allInputs = Array.from(composers[0]!.querySelectorAll<HTMLInputElement>("input[type='file']"))
      .filter(input => !input.disabled && input.getAttribute("aria-disabled") !== "true");
    const preferred = allInputs.filter(input => input.id === "upload-files");
    const nonImage = allInputs.filter(input => input.getAttribute("accept") !== "image/*");
    const inputs = preferred.length > 0 ? preferred : nonImage.length > 0 ? nonImage : allInputs;
    if (inputs.length !== 1) return undefined;
    const input = inputs[0]!;
    return {
      files: Array.from(input.files ?? []).map(file => {
        const diagnostic: { name: string; size: number; type?: string; lastModified?: number } = {
          name: file.name,
          size: file.size
        };
        if (file.type.length > 0) {
          diagnostic.type = file.type;
        }
        if (file.lastModified !== 0) {
          diagnostic.lastModified = file.lastModified;
        }
        return diagnostic;
      })
    };
  }, undefined, { timeoutMs });
}

function guessMimeType(name: string): string {
  if (/\.txt$/i.test(name)) return "text/plain";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.md$/i.test(name)) return "text/markdown";
  return "application/octet-stream";
}

function isUploadPermissionBlocker(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Allow access to file URLs|Codex Settings > Computer Use|Browser Use rejected|requested that files not be uploaded|permission denied|browser blocked|fileChooser\.setFiles failed[^\n]*(?:Not allowed|permission|denied|rejected)/i.test(message);
}

function isUploadTransportFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /native pipe closed before response|browser bridge.*(?:closed|disconnect)|connection (?:was )?closed|target page, context or browser has been closed/i.test(message);
}

function isUploadPathFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /No ChatGPT upload path completed/i.test(message);
}

function uploadPermissionMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/fileChooser\.setFiles failed|Not allowed/i.test(message)) {
    return `ChatGPT's file chooser opened, but Chrome refused the local file handoff. Ask the user to enable both upload permission gates, then retry: ${CODEX_UPLOAD_PERMISSION_FIX} ${CHROME_FILE_URL_PERMISSION_FIX}`;
  }

  if (/Browser Use rejected|requested that files not be uploaded|upload files|permission denied|browser blocked/i.test(message)) {
    return `Codex/Chrome upload permission is blocking file attachment. Ask the user to enable both upload permission gates, then retry: ${CODEX_UPLOAD_PERMISSION_FIX} ${CHROME_FILE_URL_PERMISSION_FIX}`;
  }

  return `File upload is not available until both upload permission gates are enabled. Ask the user to enable them, then retry: ${CODEX_UPLOAD_PERMISSION_FIX} ${CHROME_FILE_URL_PERMISSION_FIX}`;
}

function uploadPermissionDetails(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "Upload permission troubleshooting:",
    `1. ${CODEX_UPLOAD_PERMISSION_FIX}`,
    `2. ${CHROME_FILE_URL_PERMISSION_FIX}`,
    "Observed failure:",
    message
  ].join("\n");
}

function uploadPermissionRemediation(): NonNullable<NonNullable<CommandResult["blocker"]>["remediation"]> {
  return [
    {
      label: "Codex Chrome uploads",
      instruction: CODEX_UPLOAD_PERMISSION_FIX,
      userActionRequired: true
    },
    {
      label: "Chrome file URLs",
      instruction: CHROME_FILE_URL_PERMISSION_FIX,
      userActionRequired: true
    }
  ];
}
