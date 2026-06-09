import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { downloadLatestArtifact, locatorCountWithTimeout } from "./artifacts.js";
import { waitForDownloadFromClick } from "../browser/downloads.js";
import { resultError, resultOk } from "../errors.js";
import { addFilesButton, cssSelectors, requiredLocator } from "../dom/selectors.js";
import { basenameForHostPath, resolveForHostPath } from "../platform/local-paths.js";
import type {
  AttachedFile,
  AttachFilesArgs,
  AttachFilesData,
  CommandResult,
  DownloadedFile,
  DownloadLatestArgs,
  FileChooserLike,
  LocatorLike,
  PageLike,
  RuntimeEnv
} from "../types.js";
import { contextFromPage } from "./context.js";
import { bootstrap } from "./session.js";
import { localGuardTimeout } from "./timeouts.js";

const CODEX_UPLOAD_PERMISSION_FIX = "Codex Settings > Computer Use > Chrome > Permissions > Uploads: set to Always allow, or add chatgpt.com to the allowed upload domains.";
const CHROME_FILE_URL_PERMISSION_FIX = "Chrome chrome://extensions > Codex extension > Details: enable Allow access to file URLs.";

export async function validateAttachPaths(paths: string[]): Promise<AttachedFile[]> {
  const files: AttachedFile[] = [];

  for (const path of paths) {
    const absolute = resolveForHostPath(path);
    await access(absolute, constants.R_OK);
    const fileStat = await stat(absolute);
    if (!fileStat.isFile()) {
      throw new Error(`Attachment path is not a file: ${absolute}`);
    }

    files.push({
      path: absolute,
      name: basenameForHostPath(absolute),
      bytes: fileStat.size
    });
  }

  return files;
}

export async function attachFiles(
  env: RuntimeEnv,
  args: AttachFilesArgs
): Promise<CommandResult<AttachFilesData>> {
  const boot = await ensurePage(env);
  if (!boot.ok) {
    return boot as CommandResult<AttachFilesData>;
  }

  const page = env.page!;

  try {
    const files = await validateAttachPaths(args.paths);

    await uploadFiles(page, files, args.timeoutMs ?? 30000);

    await page.waitForTimeout?.(args.timeoutMs === undefined ? 1000 : Math.min(args.timeoutMs, 3000));
    return resultOk({ files }, await contextFromPage(page));
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
  const menuItem = requiredLocator(page, "div[role='menuitem']").filter?.({ hasText: "Add photos & files" });

  if (await locatorCount(menuItem) !== 1) {
    const plusButton = requiredLocator(page, "#composer-plus-btn, button[aria-label='Add files and more']");
    if (await locatorCount(plusButton) !== 1) {
      throw new Error("ChatGPT Add files button was not uniquely available.");
    }
    await plusButton.click?.({ timeoutMs: Math.min(timeoutMs, 10000) });
    await page.waitForTimeout?.(250);
  }

  const refreshedMenuItem = requiredLocator(page, "div[role='menuitem']").filter?.({ hasText: "Add photos & files" });
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

async function ensurePage(env: RuntimeEnv): Promise<CommandResult<unknown>> {
  if (env.page !== undefined) {
    return resultOk({}, await contextFromPage(env.page));
  }
  return bootstrap(env, { preferExistingTab: true });
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
