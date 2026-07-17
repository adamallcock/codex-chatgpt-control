import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { downloadLatestArtifact, locatorCountWithTimeout } from "./artifacts.js";
import { waitForDownloadFromClick } from "../browser/downloads.js";
import { resultError, resultOk } from "../errors.js";
import { addFilesButton, cssSelectors, requiredLocator } from "../dom/selectors.js";
import { localeLabels } from "../dom/locale-labels.js";
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
import { ensurePage } from "./session.js";
import { localGuardTimeout, withTimeout } from "./timeouts.js";

const CODEX_UPLOAD_PERMISSION_FIX = "Codex Settings > Computer Use > Chrome > Permissions > Uploads: set to Always allow, or add chatgpt.com to the allowed upload domains.";
const CHROME_FILE_URL_PERMISSION_FIX = "Chrome chrome://extensions > Codex extension > Details: enable Allow access to file URLs.";
const DEFAULT_MAX_BYTES_PER_FILE = 512 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

type AttachmentReadinessSnapshot = {
  files: Array<{ name: string; visible: boolean }>;
  processing: boolean;
  processingText?: string;
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
  const preflightArgs: FilePreflightArgs = { paths: args.paths };
  if (args.includeDiagnostics === true && args.includeHashes !== undefined) {
    preflightArgs.includeHashes = args.includeHashes;
  }
  const preflight = await preflightFiles(env, preflightArgs);
  if (!preflight.ok || preflight.data === undefined) {
    return preflight as CommandResult<AttachFilesData>;
  }

  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<AttachFilesData>;
  }

  const page = env.page!;

  try {
    const files = preflight.data.files.map(file => ({
      path: file.path,
      name: file.name,
      bytes: file.bytes
    }));

    await uploadFiles(page, files, args.timeoutMs ?? 30000);
    const browserInput = args.includeDiagnostics === true
      ? await readBrowserInputDiagnostic(page).catch(() => undefined)
      : undefined;

    await page.waitForTimeout?.(args.timeoutMs === undefined ? 1000 : Math.min(args.timeoutMs, 3000));
    const readiness = await waitForAttachedFilesReady(page, files, args.timeoutMs ?? 30000);
    if (!readiness.ready) {
      const blocker: NonNullable<CommandResult<AttachFilesData>["blocker"]> = {
        kind: "upload_failed",
        code: "attachment_processing",
        message: "ChatGPT still appears to be processing the attached file, so the prompt was not submitted.",
        remediation: [
          {
            label: "Wait for upload",
            instruction: "Wait until the visible attachment finishes uploading or processing, then retry the askWithFiles call.",
            userActionRequired: false
          },
          {
            label: "Retry smaller file",
            instruction: "If processing never finishes, retry with a smaller file or a different supported file type.",
            userActionRequired: true
          }
        ],
        resumable: true
      };
      if (readiness.processingText !== undefined) {
        blocker.visibleText = readiness.processingText;
      }
      return {
        ok: false,
        status: "blocked",
        warnings: [],
        blocker,
        context: await contextFromPage(page)
      };
    }
    const data: AttachFilesData = { files };
    if (args.includeDiagnostics === true) {
      data.diagnostics = { preflight: preflight.data };
      if (browserInput !== undefined) {
        data.diagnostics.browserInput = browserInput;
      }
    }
    return resultOk(data, await contextFromPage(page), preflight.warnings);
  } catch (error) {
    if (isUploadBridgeBlocker(error)) {
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
        context: await contextFromPage(page)
      };
    }
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
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
  return error instanceof Error && "code" in error;
}

async function waitForAttachedFilesReady(
  page: PageLike,
  files: AttachedFile[],
  timeoutMs: number
): Promise<{ ready: true } | { ready: false; processingText?: string }> {
  const started = Date.now();
  let lastProcessingText: string | undefined;

  while (Date.now() - started < timeoutMs) {
    const snapshot = await readAttachmentReadiness(page, files).catch(() => undefined);
    if (snapshot === undefined) {
      return { ready: true };
    }

    const allNamesVisible = snapshot.files.length > 0 && snapshot.files.every(file => file.visible);
    if (!snapshot.processing && allNamesVisible) {
      return { ready: true };
    }
    if (!snapshot.processing && Date.now() - started >= Math.min(timeoutMs, 1000)) {
      return { ready: true };
    }

    if (snapshot.processingText !== undefined) {
      lastProcessingText = snapshot.processingText;
    }
    await page.waitForTimeout?.(250);
  }

  const blocked: { ready: false; processingText?: string } = { ready: false };
  if (lastProcessingText !== undefined) {
    blocked.processingText = lastProcessingText;
  }
  return blocked;
}

async function readAttachmentReadiness(
  page: PageLike,
  files: AttachedFile[]
): Promise<AttachmentReadinessSnapshot | undefined> {
  if (typeof page.evaluate !== "function") {
    return undefined;
  }

  return page.evaluate((fileNames: string[]) => {
    const visibleText = document.body?.innerText ?? "";
    const normalize = (value: string) => value.toLocaleLowerCase();
    const normalizedVisibleText = normalize(visibleText);
    const files = fileNames.map(name => ({
      name,
      visible: normalizedVisibleText.includes(normalize(name))
    }));

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
    const attachmentText = Array.from(document.querySelectorAll(attachmentSelectors))
      .map(element => [
        element.textContent ?? "",
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("title") ?? ""
      ].join(" "))
      .join(" ");
    const relevantText = attachmentText.length > 0 ? attachmentText : visibleText;
    const processingMatch = /\b(uploading|processing|attaching|preparing|reading|scanning|analyzing)\b/i.exec(relevantText);
    const snapshot: AttachmentReadinessSnapshot = {
      files,
      processing: processingMatch !== null
    };
    if (processingMatch !== null) {
      snapshot.processingText = relevantText.slice(0, 500);
    }
    return snapshot;
  }, files.map(file => file.name));
}

async function uploadFiles(page: NonNullable<RuntimeEnv["page"]>, files: AttachedFile[], timeoutMs: number): Promise<void> {
  const paths = files.map(file => file.path);
  const errors: string[] = [];

  const attempts: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: "visible-chatgpt-file-input",
      run: async () => {
        await clickFileChooserTarget(page, "#upload-files", paths, timeoutMs, { requireVisible: true });
      }
    },
    {
      name: "add-photos-files-menu-item",
      run: async () => {
        await clickChatGPTAddPhotosMenuItem(page, paths, timeoutMs);
      }
    },
    {
      name: "generic-add-files-button",
      run: async () => {
        await clickFileChooserLocator(page, addFilesButton(page), paths, timeoutMs);
      }
    },
    {
      name: "direct-file-input-set",
      run: async () => {
        await setHiddenFileInput(page, files);
      }
    }
  ];

  for (const attempt of attempts) {
    try {
      await attempt.run();
      return;
    } catch (error) {
      errors.push(`${attempt.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No ChatGPT upload path completed.\n${errors.join("\n")}`);
}

async function clickChatGPTAddPhotosMenuItem(
  page: PageLike,
  paths: string[],
  timeoutMs: number
): Promise<void> {
  // The `#composer-plus-btn` id is the language-agnostic primary; the aria-label and the
  // menu-item text are locale-sensitive (menu text sourced from the locale registry).
  const addPhotosFilesText = localeLabels.addPhotosFilesMenuItem[0];
  const menuItem = requiredLocator(page, "div[role='menuitem']").filter?.({ hasText: addPhotosFilesText });

  if (await locatorCount(menuItem) !== 1) {
    const plusButton = requiredLocator(page, "#composer-plus-btn, button[aria-label='Add files and more']");
    if (await locatorCount(plusButton) !== 1) {
      throw new Error("ChatGPT Add files button was not uniquely available.");
    }
    await plusButton.click?.({ timeoutMs: Math.min(timeoutMs, 10000) });
    await page.waitForTimeout?.(250);
  }

  const refreshedMenuItem = requiredLocator(page, "div[role='menuitem']").filter?.({ hasText: addPhotosFilesText });
  await clickFileChooserLocator(page, refreshedMenuItem, paths, timeoutMs);
}

async function clickFileChooserTarget(
  page: PageLike,
  selector: string,
  paths: string[],
  timeoutMs: number,
  options: { requireVisible?: boolean } = {}
): Promise<void> {
  const locator = requiredLocator(page, selector);
  if (await locatorCount(locator) !== 1) {
    throw new Error(`Upload target was not uniquely available: ${selector}`);
  }
  if (options.requireVisible === true && locator.isVisible !== undefined && !await locator.isVisible({ timeoutMs: 1000 })) {
    throw new Error(`Upload target is hidden: ${selector}`);
  }
  await clickFileChooserLocator(page, locator, paths, timeoutMs);
}

async function clickFileChooserLocator(
  page: PageLike,
  locator: LocatorLike | undefined,
  paths: string[],
  timeoutMs: number
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

  const chooserPromise = waitForFileChooser(page, timeoutMs);
  try {
    await locator.click({ timeoutMs: Math.min(timeoutMs, 10000) });
  } catch (error) {
    await chooserPromise.catch(() => undefined);
    throw error;
  }

  const chooser = await chooserPromise;
  await validateChooserMultiplicity(chooser, paths);
  try {
    await chooser.setFiles(paths);
  } catch (error) {
    throw new Error(`fileChooser.setFiles failed. ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function waitForFileChooser(page: PageLike, timeoutMs: number): Promise<FileChooserLike> {
  const rawChooser = await page.waitForEvent?.("filechooser", {
    timeout: timeoutMs,
    timeoutMs
  });

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

async function locatorCount(locator: LocatorLike | undefined): Promise<number> {
  if (locator === undefined || typeof locator.count !== "function") {
    return 0;
  }
  return locator.count();
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
      if (artifactDownload.ok) {
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
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

type GeneratedFileAffordance = {
  assistantIndex: number;
  filename: string;
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
    const affordance = assistant.getByRole?.(role, { name: selected.filename, exact: true })
      ?? assistant.locator?.(`${selected.tag}[aria-label="${escapeCssAttribute(selected.filename)}"]`);
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
    const preview = requiredLocator(page, `section[aria-label="${escapeCssAttribute(selected.filename)}"]`);
    const download = await waitForPreviewDownloadControl(page, preview, timeoutMs);
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
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

async function inspectGeneratedFileAffordances(
  page: RuntimeEnv["page"] & {},
  timeoutMs: number
): Promise<GeneratedFileAffordance[]> {
  if (typeof page.evaluate === "function") {
    const fromDom = await withTimeout(
      page.evaluate(() => {
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
        const assistants = Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));
        return assistants.flatMap((assistant, assistantIndex) => Array.from(assistant.querySelectorAll("button[aria-label], a[download], a[href*='/backend-api/files/']"))
          .filter(visible)
          .map(element => ({
            assistantIndex,
            filename: (element.getAttribute("aria-label") ?? element.textContent ?? "").trim(),
            tag: element.tagName.toLocaleLowerCase(),
            text: (element.textContent ?? "").trim()
          }))
          .filter(item => (item.tag === "button" || item.tag === "a") && fileLike(item.filename) && item.filename === item.text)
          .map(({ assistantIndex, filename, tag }) => ({ assistantIndex, filename, tag })));
      }),
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
    const filename = decodeBasicHtml(match[3] ?? "").trim();
    const text = decodeBasicHtml((match[4] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (/^[^\\/\r\n]{1,255}\.[a-z0-9][a-z0-9._-]{0,15}$/i.test(filename) && filename === text) {
      candidates.push({ assistantIndex: 0, filename, tag: (match[1] ?? "button").toLocaleLowerCase() as "button" | "a" });
    }
  }
  return candidates;
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
  preview: LocatorLike,
  timeoutMs: number
): Promise<LocatorLike | undefined> {
  const deadline = Date.now() + Math.min(timeoutMs, 15000);
  while (Date.now() < deadline) {
    for (const label of localeLabels.download) {
      const control = preview.getByRole?.("button", { name: label, exact: true })
        ?? preview.locator?.(`button[aria-label="${escapeCssAttribute(label)}"]`);
      if (await locatorCountWithTimeout(control, localGuardTimeout(timeoutMs, 2000), "artifact_preview_download_count_timeout") === 1) {
        return control;
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

async function setHiddenFileInput(page: RuntimeEnv["page"], files: AttachedFile[]): Promise<void> {
  if (page === undefined) {
    throw new Error("No active page is available for file upload.");
  }
  const input = requiredLocator(page, cssSelectors.hiddenFileInputs).last?.() ?? requiredLocator(page, cssSelectors.hiddenFileInputs);
  if (typeof input.setInputFiles !== "function") {
    await setFilesViaDomDataTransfer(page, files);
    return;
  }
  await input.setInputFiles(files.map(file => file.path));
}

async function readBrowserInputDiagnostic(page: PageLike): Promise<BrowserInputDiagnostic | undefined> {
  if (typeof page.evaluate !== "function") {
    return undefined;
  }

  return page.evaluate(() => {
    const input = (document.querySelector("#upload-files")
      || document.querySelector("input[type='file']:not([accept='image/*'])")
      || document.querySelector("input[type='file']")) as HTMLInputElement | null;
    if (!input) {
      return { files: [] };
    }
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
  });
}

async function setFilesViaDomDataTransfer(page: NonNullable<RuntimeEnv["page"]>, files: AttachedFile[]): Promise<void> {
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const maxInlineBytes = 25 * 1024 * 1024;
  if (totalBytes > maxInlineBytes) {
    throw new Error(`No file chooser or setInputFiles support is available for large uploads. ${CODEX_UPLOAD_PERMISSION_FIX} ${CHROME_FILE_URL_PERMISSION_FIX}`);
  }

  if (typeof page.evaluate !== "function") {
    throw new Error(`No file chooser, setInputFiles, or page.evaluate support is available for file upload. ${CODEX_UPLOAD_PERMISSION_FIX} ${CHROME_FILE_URL_PERMISSION_FIX}`);
  }

  const payload = await Promise.all(files.map(async file => ({
    name: file.name,
    bytesBase64: (await readFile(file.path)).toString("base64"),
    type: guessMimeType(file.name)
  })));

  await page.evaluate(
    async (payload) => {
      const input = (document.querySelector("#upload-files") || document.querySelector("input[type='file']:not([accept='image/*'])") || document.querySelector("input[type='file']")) as HTMLInputElement | null;
      if (!input) {
        throw new Error("No ChatGPT file input found in the DOM.");
      }
      const dataTransfer = new DataTransfer();
      for (const item of payload) {
        const binary = atob(item.bytesBase64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        dataTransfer.items.add(new File([bytes], item.name, { type: item.type }));
      }
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    payload
  );
}

function guessMimeType(name: string): string {
  if (/\.txt$/i.test(name)) return "text/plain";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.md$/i.test(name)) return "text/markdown";
  return "application/octet-stream";
}

function isUploadBridgeBlocker(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /DataTransfer is not a constructor|No file chooser|setInputFiles|Allow access to file URLs|file upload|fileChooser\.setFiles failed|Not allowed|No ChatGPT upload path completed/i.test(message);
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
