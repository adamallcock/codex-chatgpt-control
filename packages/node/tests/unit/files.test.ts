import { access, chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import { attachFiles, downloadLatestFile, preflightFiles, stripLocalizedDownloadPrefix, validateAttachPaths } from "../../src/commands/files.js";
import type { BrowserOperationOptions, LocatorLike, PageLike, WaitForEventOptions } from "../../src/types.js";

describe("preflightFiles", () => {
  it("requires absolute paths and returns a structured blocker", async () => {
    const result = await preflightFiles({}, { paths: ["notes.txt"] });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      kind: "upload_failed",
      code: "file_path_not_absolute",
      fieldPath: "paths[0]"
    });
    expect(result.context.timestamp).toBeDefined();
  });

  it("returns a structured not-found blocker for missing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-preflight-missing-"));
    const missing = join(dir, "missing.pdf");

    const result = await preflightFiles({}, { paths: [missing] });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("not_found");
    expect(result.blocker).toMatchObject({
      kind: "not_found",
      code: "file_missing",
      fieldPath: "paths[0]"
    });
    expect(result.blocker?.message).toContain(missing);
  });

  it("rejects directories before any upload attempt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-preflight-dir-"));

    const result = await preflightFiles({}, { paths: [dir] });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      kind: "upload_failed",
      code: "file_path_is_directory",
      fieldPath: "paths[0]"
    });
  });

  it("reports unreadable files as permission blockers when the platform enforces read bits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-preflight-unreadable-"));
    const file = join(dir, "secret.txt");
    await writeFile(file, "secret");
    await chmod(file, 0o000);

    try {
      const canRead = await access(file, constants.R_OK).then(() => true, () => false);
      if (canRead) return;

      const result = await preflightFiles({}, { paths: [file] });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("blocked");
      expect(result.blocker).toMatchObject({
        kind: "permission",
        code: "file_not_readable",
        fieldPath: "paths[0]"
      });
    } finally {
      await chmod(file, 0o600).catch(() => undefined);
    }
  });

  it("blocks zero-byte files before any browser upload attempt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-preflight-empty-"));
    const file = join(dir, "empty.txt");
    await writeFile(file, "");

    const result = await preflightFiles({}, { paths: [file] });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      kind: "upload_failed",
      code: "file_empty",
      fieldPath: "paths[0]"
    });
    expect(result.blocker?.message).toContain("zero bytes");
  });

  it("warns for duplicate basenames and duplicate resolved paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-preflight-warnings-"));
    const nested = join(dir, "nested");
    const other = join(dir, "other");
    await mkdir(nested);
    await mkdir(other);
    const primary = join(nested, "notes.md");
    const duplicatePath = join(nested, "..", "nested", "notes.md");
    const duplicateName = join(other, "notes.md");
    await writeFile(primary, "hello");
    await writeFile(duplicateName, "world");

    const result = await preflightFiles({}, { paths: [primary, duplicatePath, duplicateName] });

    expect(result.ok).toBe(true);
    expect(result.data?.totalBytes).toBe(15);
    expect(result.data?.files[0]).toMatchObject({
      path: primary,
      name: "notes.md",
      bytes: 5,
      extension: ".md",
      mimeType: "text/markdown",
      category: "text"
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Duplicate resolved file path"),
      expect.stringContaining("Duplicate file basename")
    ]));
    expect(result.warnings.join("\n")).not.toContain("Zero-byte file");
  });

  it("can include SHA-256 metadata when requested for upload diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-preflight-digest-"));
    const file = join(dir, "digest.txt");
    const body = "digest me";
    await writeFile(file, body);

    const result = await preflightFiles({}, { paths: [file], includeHashes: true });

    expect(result.ok).toBe(true);
    expect(result.data?.files[0]).toMatchObject({
      path: file,
      name: "digest.txt",
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex")
    });
  });

  it("enforces per-file and total-byte limits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-preflight-limits-"));
    const first = join(dir, "first.txt");
    const second = join(dir, "second.txt");
    await writeFile(first, "hello");
    await writeFile(second, "world");

    const tooLarge = await preflightFiles({}, { paths: [first], maxBytesPerFile: 4 });
    expect(tooLarge.ok).toBe(false);
    expect(tooLarge.status).toBe("blocked");
    expect(tooLarge.blocker).toMatchObject({
      kind: "upload_failed",
      code: "file_too_large",
      fieldPath: "paths[0]"
    });

    const tooMuchTotal = await preflightFiles({}, { paths: [first, second], maxTotalBytes: 9 });
    expect(tooMuchTotal.ok).toBe(false);
    expect(tooMuchTotal.status).toBe("blocked");
    expect(tooMuchTotal.blocker).toMatchObject({
      kind: "upload_failed",
      code: "file_total_bytes_exceeded",
      fieldPath: "paths"
    });
  });
});

describe("validateAttachPaths", () => {
  it("rejects relative paths", async () => {
    await expect(validateAttachPaths(["notes.txt"])).rejects.toThrow(/absolute/);
  });

  it("rejects empty and nested relative paths", async () => {
    await expect(validateAttachPaths([""])).rejects.toThrow(/absolute/);
    await expect(validateAttachPaths(["notes/file.md"])).rejects.toThrow(/absolute/);
  });

  it("rejects ambiguous Windows paths", async () => {
    await expect(validateAttachPaths([String.raw`C:Users\notes.md`])).rejects.toThrow(/absolute/);
    await expect(validateAttachPaths([String.raw`\tmp\notes.md`])).rejects.toThrow(/absolute/);
  });

  it("rejects foreign Windows absolute syntax on POSIX hosts", async () => {
    if (process.platform === "win32") return;

    await expect(validateAttachPaths([String.raw`C:\Users\codex\missing-file.md`])).rejects.toThrow(/absolute/);
    await expect(validateAttachPaths([String.raw`\\server\share\missing-file.md`])).rejects.toThrow(/absolute/);
  });

  it("does not validate a POSIX literal filename that looks like a Windows path", async () => {
    if (process.platform === "win32") return;

    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-literal-winpath-"));
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      await writeFile(String.raw`C:\Users\codex\literal.md`, "literal filename");
      await expect(validateAttachPaths([String.raw`C:\Users\codex\literal.md`])).rejects.toThrow(/absolute/);
    } finally {
      process.chdir(cwd);
    }
  });

  it("returns file metadata for readable files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    await expect(validateAttachPaths([file])).resolves.toEqual([
      { path: file, name: "notes.txt", bytes: 5 }
    ]);
  });

  it("rejects forward-slash UNC paths on POSIX (treated as relative-ish ambiguity by validateAttachPaths)", async () => {
    // //server/share/file starts with / so POSIX isAbsolute accepts it.
    // resolveForHostPath with the current platform (linux/darwin) would pass
    // the isAbsolutePath check, then try fs.access on it — which will fail
    // with ENOENT (not an "absolute" error).  This test documents that
    // validateAttachPaths does NOT reject forward-slash UNC as non-absolute on
    // POSIX; instead the guard is that the path simply does not exist.
    // This is intentional: on POSIX, //server/share/ is a valid NFS/SMB mount.
    if (process.platform === "win32") return;
    // The path will pass the absolute check and fail at fs.access (ENOENT)
    await expect(validateAttachPaths(["//server/share/missing-file.md"])).rejects.toThrow();
    // Importantly, it does NOT throw /absolute/ — it gets past the path check
    const rejection = validateAttachPaths(["//server/share/missing-file.md"]).catch(e => e);
    await expect(rejection).resolves.not.toMatchObject({ message: expect.stringMatching(/absolute/) });
  });
});

describe("attachFiles", () => {
  it("can return preflight and browser-side file-size diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-diagnostics-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let uploadedPaths: string[] = [];
    let titleCalls = 0;
    const visibleInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {},
      evaluate: async <T>() => true as T
    };
    const messageLocator: LocatorLike = {
      count: async () => 0
    };

    const page: PageLike = {
      locator: (selector: string) => {
        if (selector.includes("input[type='file']")) return visibleInput;
        if (selector.includes("data-message-author-role")) return messageLocator;
        return { count: async () => 0 };
      },
      waitForEvent: async () => ({
        element: () => boundChooserElement(),
        isMultiple: async () => true,
        setFiles: async (paths: string[]) => {
          uploadedPaths = paths;
        }
      }),
      evaluate: async <T, A = unknown>(_fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
        if (arg !== null && typeof arg === "object" && "expectedFiles" in arg) {
          return {
            supported: true,
            files: [{ name: "notes.txt", visible: true }],
            processing: false
          } as T;
        }
        return {
          files: [{ name: "notes.txt", size: 5, type: "text/plain", lastModified: 123 }]
        } as T;
      },
      waitForTimeout: async () => {},
      title: async () => {
        titleCalls += 1;
        return "ChatGPT";
      },
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, {
      paths: [file],
      includeDiagnostics: true,
      includeHashes: true
    });

    expect(result.ok).toBe(true);
    expect(uploadedPaths).toEqual([file]);
    expect(titleCalls).toBe(0);
    expect(result.data?.diagnostics?.preflight.files[0]).toMatchObject({
      name: "notes.txt",
      bytes: 5,
      sha256: createHash("sha256").update("hello").digest("hex")
    });
    expect(result.data?.diagnostics?.browserInput?.files[0]).toMatchObject({
      name: "notes.txt",
      size: 5,
      type: "text/plain"
    });
  });

  it("reads diagnostics only from the unique active-composer file input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-scoped-diagnostics-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const visibleInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {},
      evaluate: async <T>() => true as T
    };
    const missing: LocatorLike = { count: async () => 0 };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? visibleInput : missing,
      waitForEvent: async () => ({ element: () => boundChooserElement(), setFiles: async () => {} }),
      evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
        const source = String(fn);
        if (source.includes("file.lastModified")) {
          const staleInput = {
            files: [{ name: "stale.txt", size: 99, type: "text/plain", lastModified: 1 }]
          };
          const composerInput = {
            id: "upload-files",
            disabled: false,
            files: [{ name: "notes.txt", size: 5, type: "text/plain", lastModified: 123 }],
            getAttribute: (name: string) => name === "accept" ? "*/*" : null
          };
          const composer = {
            querySelectorAll: (selector: string) => selector === "input[type='file']" ? [composerInput] : []
          };
          const textbox = {
            hidden: false,
            closest: (selector: string) => selector.includes("[hidden]") ? null : composer,
            getBoundingClientRect: () => ({ width: 100, height: 20 })
          };
          const previousDocument = globalThis.document;
          const previousWindow = globalThis.window;
          try {
            globalThis.document = {
              querySelector: () => staleInput,
              querySelectorAll: (selector: string) => selector.includes("textarea") ? [textbox] : []
            } as unknown as Document;
            globalThis.window = {
              getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" })
            } as unknown as Window & typeof globalThis;
            return await fn(arg as A);
          } finally {
            globalThis.document = previousDocument;
            globalThis.window = previousWindow;
          }
        }
        if (arg !== null && typeof arg === "object" && "expectedFiles" in arg) {
          return {
            supported: true,
            files: [{ name: "notes.txt", visible: true }],
            processing: false
          } as T;
        }
        return { supported: true, inputFiles: [], attachmentLabels: [] } as T;
      },
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, {
      paths: [file],
      includeDiagnostics: true
    });

    expect(result.ok).toBe(true);
    expect(result.data?.diagnostics?.browserInput?.files).toEqual([{
      name: "notes.txt",
      size: 5,
      type: "text/plain",
      lastModified: 123
    }]);
  });

  it("uses the current focusable command-palette upload row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-palette-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let plusClicked = false;
    let paletteClicked = false;
    let palettePattern: RegExp | undefined;
    let plusScopeSource = "";
    let uploadedPaths: string[] = [];
    const hiddenInput: LocatorLike = {
      count: async () => plusClicked ? 1 : 0,
      isVisible: async () => false,
      evaluate: async <T>() => true as T
    };
    const plusButton: LocatorLike = {
      count: async () => 1,
      click: async () => { plusClicked = true; },
      evaluate: async <T>(fn: (element: Element) => T) => {
        plusScopeSource = String(fn);
        return true as T;
      }
    };
    const missingMenuItem: LocatorLike = {
      count: async () => 0,
      filter: () => missingMenuItem
    };
    const paletteItem: LocatorLike = {
      count: async () => plusClicked ? 1 : 0,
      filter: options => {
        palettePattern = options["hasText"] as RegExp;
        return paletteItem;
      },
      click: async () => { paletteClicked = true; }
    };
    const messageLocator: LocatorLike = { count: async () => 0 };
    const page: PageLike = {
      locator: selector => {
        if (selector.includes("input[type='file']")) return hiddenInput;
        if (selector === "#composer-plus-btn, button[aria-label='Add files and more']") return plusButton;
        if (selector === "div[role='menuitem']") return missingMenuItem;
        if (selector === "div[tabindex='0']") return paletteItem;
        if (selector.includes("data-message-author-role")) return messageLocator;
        return missingMenuItem;
      },
      waitForEvent: async () => ({
        element: () => boundChooserElement(),
        isMultiple: async () => true,
        setFiles: async (paths: string[]) => { uploadedPaths = paths; }
      }),
      evaluate: async <T>(): Promise<T> => ({
        supported: true,
        files: [{ name: "notes.txt", visible: true }],
        processing: false
      }) as T,
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(result.ok).toBe(true);
    expect(plusClicked).toBe(true);
    expect(paletteClicked).toBe(true);
    expect(uploadedPaths).toEqual([file]);
    expect(palettePattern?.test("Añadir fotos y archivos")).toBe(true);
    expect(plusScopeSource).toContain('textbox.closest("form")');
    expect(plusScopeSource.indexOf('textbox.closest("form")'))
      .toBeLessThan(plusScopeSource.indexOf("[class*='composer' i]"));
  });

  it("refuses an unrelated palette chooser before handing it any file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-unbound-palette-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let plusClicked = false;
    let setFilesCalls = 0;
    const hiddenInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => false,
      evaluate: async <T>() => true as T
    };
    const plusButton: LocatorLike = {
      count: async () => 1,
      click: async () => { plusClicked = true; },
      evaluate: async <T>() => true as T
    };
    const paletteItem: LocatorLike = {
      count: async () => plusClicked ? 1 : 0,
      filter: () => paletteItem,
      click: async () => {}
    };
    const missing: LocatorLike = { count: async () => 0, filter: () => missing };
    const page: PageLike = {
      locator: selector => {
        if (selector.includes("input[type='file']")) return hiddenInput;
        if (selector === "#composer-plus-btn, button[aria-label='Add files and more']") return plusButton;
        if (selector === "div[tabindex='0']") return paletteItem;
        return missing;
      },
      waitForEvent: async () => ({
        element: () => boundChooserElement(false),
        setFiles: async () => { setFilesCalls += 1; }
      }),
      evaluate: async <T>(): Promise<T> => ({
        supported: false,
        inputFiles: [],
        attachmentLabels: []
      }) as T,
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file], timeoutMs: 500 });

    expect(result.ok).toBe(false);
    expect(result.blocker?.code).toBe("upload_path_unavailable");
    expect(result.blocker?.visibleText).toContain("backing input was not the unique active-composer upload target");
    expect(setFilesCalls).toBe(0);
  });

  it("waits for attached files to finish processing before returning success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-processing-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let uploadedPaths: string[] = [];
    let readinessChecks = 0;

    const visibleInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {},
      evaluate: async <T>() => true as T
    };
    const messageLocator: LocatorLike = {
      count: async () => 0
    };

    const page: PageLike = {
      locator: (selector: string) => {
        if (selector.includes("input[type='file']")) return visibleInput;
        if (selector.includes("data-message-author-role")) return messageLocator;
        return { count: async () => 0 };
      },
      waitForEvent: async () => ({
        element: () => boundChooserElement(),
        isMultiple: async () => true,
        setFiles: async (paths: string[]) => {
          uploadedPaths = paths;
        }
      }),
      evaluate: async <T, A = unknown>(_fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
        if (arg === null || typeof arg !== "object" || !("expectedFiles" in arg)) {
          return { supported: true, inputFiles: [], attachmentLabels: [] } as T;
        }
        readinessChecks += 1;
        const processing = readinessChecks === 1;
        return {
          files: [
            { name: "notes.txt", visible: !processing }
          ],
          processing,
          processingText: processing ? "Uploading notes.txt" : undefined
        } as T;
      },
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file], timeoutMs: 500 });

    expect(result.ok).toBe(true);
    expect(uploadedPaths).toEqual([file]);
    expect(readinessChecks).toBeGreaterThan(1);
  });

  it("uses scoped CDP only to open the hidden input's approved file chooser", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-cdp-chooser-"));
    const first = join(dir, "first.md");
    const second = join(dir, "second.txt");
    await writeFile(first, "first-file");
    await writeFile(second, "second-file");

    const hiddenInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => false,
      evaluate: async <T>() => true as T
    };
    const missing: LocatorLike = {
      count: async () => 0,
      filter: () => missing
    };
    let uploadedPaths: string[] = [];
    let sentMethod: string | undefined;
    let sentParams: Record<string, unknown> | undefined;
    let sentOptions: Record<string, unknown> | undefined;
    let chooserTimeoutMs: number | undefined;
    let eventTimeoutMs: number | undefined;
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? hiddenInput : missing,
      waitForEvent: async (_event, options) => {
        eventTimeoutMs = (options as WaitForEventOptions | undefined)?.timeoutMs;
        return {
          isMultiple: async () => true,
          setFiles: async (paths: string[], chooserOptions?: BrowserOperationOptions) => {
            uploadedPaths = paths;
            chooserTimeoutMs = chooserOptions?.timeoutMs;
          }
        };
      },
      evaluate: async <T>(): Promise<T> => ({
        supported: true,
        files: [
          { name: "first.md", visible: true },
          { name: "second.txt", visible: true }
        ],
        processing: false
      }) as T,
      capabilities: {
        get: async id => id === "cdp" ? {
          send: async (method: string, params: Record<string, unknown>, options?: Record<string, unknown>) => {
            sentMethod = method;
            sentParams = params;
            sentOptions = options;
            return { result: { value: { ok: true } } };
          }
        } : undefined
      },
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [first, second] });

    expect(result.ok).toBe(true);
    expect(uploadedPaths).toEqual([first, second]);
    expect(sentMethod).toBe("Runtime.evaluate");
    expect(sentParams).toMatchObject({
      userGesture: true,
      awaitPromise: true,
      returnByValue: true
    });
    expect(sentParams?.expression).toContain('input.id === "upload-files"');
    expect(sentParams?.expression).toContain("active composer file input was not unique");
    // Match the real Codex Chrome chooser, which intentionally has no
    // backing-element accessor. The scoped CDP trigger is the identity proof.
    expect(sentOptions?.timeoutMs).toEqual(expect.any(Number));
    expect(eventTimeoutMs).toEqual(expect.any(Number));
    expect(chooserTimeoutMs).toEqual(expect.any(Number));
  });

  it("does not hand files to a chooser when scoped CDP reports ambiguous composer inputs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-cdp-ambiguous-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let setFilesCalls = 0;
    const hiddenInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => false,
      evaluate: async <T>() => true as T
    };
    const missing: LocatorLike = { count: async () => 0, filter: () => missing };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? hiddenInput : missing,
      waitForEvent: async () => ({
        setFiles: async () => { setFilesCalls += 1; }
      }),
      capabilities: {
        get: async () => ({
          send: async () => ({
            result: { value: { ok: false, reason: "active composer file input was not unique" } }
          })
        })
      },
      evaluate: async <T>(): Promise<T> => ({
        supported: false,
        inputFiles: [],
        attachmentLabels: []
      }) as T,
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file], timeoutMs: 100 });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blocker: { code: "upload_path_unavailable" }
    });
    expect(result.blocker?.visibleText).toContain("active composer file input was not unique");
    expect(setFilesCalls).toBe(0);
  });

  it("ignores a unique visible file input outside the active composer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-wrong-composer-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let wrongClicks = 0;
    let chooserCalls = 0;
    let directPaths: string[] = [];
    let directTimeoutMs: number | undefined;
    const wrongVisibleInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => { wrongClicks += 1; },
      evaluate: async <T>() => false as T
    };
    const activeComposerInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => false,
      evaluate: async <T>() => true as T,
      setInputFiles: async (paths, options) => {
        directPaths = paths;
        directTimeoutMs = options?.timeoutMs;
      }
    };
    const candidates: LocatorLike = {
      count: async () => 2,
      nth: index => index === 0 ? wrongVisibleInput : activeComposerInput
    };
    const missing: LocatorLike = { count: async () => 0, filter: () => missing };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? candidates : missing,
      waitForEvent: async () => {
        chooserCalls += 1;
        return { setFiles: async () => {} };
      },
      evaluate: async <T, A = unknown>(_fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
        if (arg !== null && typeof arg === "object" && "expectedFiles" in arg) {
          return {
            supported: true,
            files: [{ name: "notes.txt", visible: true }],
            processing: false
          } as T;
        }
        return { supported: true, inputFiles: [], attachmentLabels: [] } as T;
      },
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(result.ok).toBe(true);
    expect(wrongClicks).toBe(0);
    expect(chooserCalls).toBe(0);
    expect(directPaths).toEqual([file]);
    expect(directTimeoutMs).toEqual(expect.any(Number));
  });

  it("marks a timed-out in-flight chooser handoff indeterminate and non-resumable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-single-deadline-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const visibleInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {},
      evaluate: async <T>() => true as T
    };
    const missing: LocatorLike = { count: async () => 0, filter: () => missing };
    vi.useFakeTimers();
    try {
      let handoffs = 0;
      let nativeTimeoutMs: number | undefined;
      let markHandoffStarted: (() => void) | undefined;
      const handoffStarted = new Promise<void>(resolve => { markHandoffStarted = resolve; });
      const page: PageLike = {
        locator: selector => selector.includes("input[type='file']") ? visibleInput : missing,
        waitForEvent: async () => ({
          element: () => boundChooserElement(),
          setFiles: async (_paths: string[], options?: BrowserOperationOptions) => {
            markHandoffStarted?.();
            nativeTimeoutMs = options?.timeoutMs;
            await new Promise<void>((_resolve, reject) => setTimeout(
              () => reject(new Error(`Timed out after ${options?.timeoutMs ?? 0}ms setting chooser files.`)),
              options?.timeoutMs ?? 0
            ));
          }
        }),
        evaluate: async <T>(): Promise<T> => ({
          supported: false,
          inputFiles: [],
          attachmentLabels: []
        }) as T,
        title: async () => "ChatGPT",
        url: () => "https://chatgpt.com/"
      };
      const startedAt = Date.now();
      const resultPromise = attachFiles({ page }, { paths: [file], timeoutMs: 50 });

      await handoffStarted;
      await vi.advanceTimersByTimeAsync(50);
      const result = await resultPromise;

      expect(result).toMatchObject({
        ok: false,
        status: "partial",
        blocker: { code: "attachment_outcome_indeterminate", resumable: false }
      });
      expect(handoffs).toBe(0);
      expect(nativeTimeoutMs).toBeGreaterThan(0);
      expect(nativeTimeoutMs).toBeLessThanOrEqual(50);
      expect(Date.now() - startedAt).toBeLessThanOrEqual(50);

      await vi.advanceTimersByTimeAsync(100);
      expect(handoffs).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a real bounded settling delay when page.waitForTimeout is unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-delay-fallback-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const visibleInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {},
      evaluate: async <T>() => true as T
    };
    const missing: LocatorLike = { count: async () => 0, filter: () => missing };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? visibleInput : missing,
      waitForEvent: async () => ({ element: () => boundChooserElement(), setFiles: async () => {} }),
      evaluate: async <T, A = unknown>(_fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
        if (arg !== null && typeof arg === "object" && "expectedFiles" in arg) {
          return {
            supported: true,
            files: [{ name: "notes.txt", visible: true }],
            processing: false
          } as T;
        }
        return { supported: true, inputFiles: [], attachmentLabels: [] } as T;
      },
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file], timeoutMs: 200 });

    expect(result.ok).toBe(true);
  });

  it("uses a host timer for settling so no browser wait remains in flight", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-stalled-delay-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const visibleInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {},
      evaluate: async <T>() => true as T
    };
    const missing: LocatorLike = { count: async () => 0, filter: () => missing };
    vi.useFakeTimers();
    try {
      let browserWaitCalls = 0;
      let markHandoffStarted: (() => void) | undefined;
      const handoffStarted = new Promise<void>(resolve => { markHandoffStarted = resolve; });
      const page: PageLike = {
        locator: selector => selector.includes("input[type='file']") ? visibleInput : missing,
        waitForEvent: async () => ({
          element: () => boundChooserElement(),
          setFiles: async () => { markHandoffStarted?.(); }
        }),
        evaluate: async <T>(): Promise<T> => ({
          supported: true,
          inputFiles: [],
          attachmentLabels: []
        }) as T,
        waitForTimeout: async () => {
          browserWaitCalls += 1;
          return new Promise<void>(() => {});
        },
        title: async () => "ChatGPT",
        url: () => "https://chatgpt.com/"
      };
      const startedAt = Date.now();
      const resultPromise = attachFiles({ page }, { paths: [file], timeoutMs: 10 });

      await handoffStarted;
      await vi.advanceTimersByTimeAsync(10);
      const result = await resultPromise;

      expect(result).toMatchObject({
        ok: false,
        status: "partial",
        blocker: { code: "attachment_outcome_indeterminate", resumable: false }
      });
      expect(Date.now() - startedAt).toBeLessThanOrEqual(10);
      expect(browserWaitCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects stale same-name composer evidence captured before upload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-stale-evidence-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let readinessSource = "";
    const visibleInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {},
      evaluate: async <T>() => true as T
    };
    const missing: LocatorLike = { count: async () => 0, filter: () => missing };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? visibleInput : missing,
      waitForEvent: async () => ({ element: () => boundChooserElement(), setFiles: async () => {} }),
      evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
        if (arg !== null && typeof arg === "object" && "expectedFiles" in arg) {
          readinessSource = String(fn);
          return {
            supported: true,
            files: [{ name: "notes.txt", visible: false }],
            processing: false
          } as T;
        }
        return {
          supported: true,
          inputFiles: [],
          attachmentLabels: ["notes.txt"]
        } as T;
      },
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file], timeoutMs: 20 });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      status: "partial",
      blocker: { code: "attachment_outcome_indeterminate", resumable: false }
    });
    expect(readinessSource).toContain("newLabelIndices");
    expect(readinessSource).toContain("args.baseline.attachmentLabels");
  });

  it("classifies normal readiness-budget exhaustion as verification failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-readiness-budget-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const input: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {},
      evaluate: async <T>() => true as T
    };
    vi.useFakeTimers();
    try {
      let markChooserStarted: (() => void) | undefined;
      const chooserStarted = new Promise<void>(resolve => { markChooserStarted = resolve; });
      const page: PageLike = {
        locator: selector => selector.includes("input[type='file']") ? input : { count: async () => 0 },
        waitForEvent: async () => {
          markChooserStarted?.();
          return {
            element: () => boundChooserElement(),
            setFiles: async () => {}
          };
        },
        evaluate: async <T, A = unknown>(_fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
          if (arg !== null && typeof arg === "object" && "expectedFiles" in arg) {
            return {
              supported: true,
              files: [{ name: "notes.txt", visible: false }],
              processing: false
            } as T;
          }
          return { supported: true, inputFiles: [], attachmentLabels: [] } as T;
        },
        waitForTimeout: async delayMs => new Promise<void>(resolve => setTimeout(resolve, delayMs)),
        title: async () => "ChatGPT",
        url: () => "https://chatgpt.com/"
      };
      const resultPromise = attachFiles({ page }, { paths: [file], timeoutMs: 40 });

      await chooserStarted;
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toMatchObject({
        ok: false,
        status: "partial",
        blocker: { code: "attachment_outcome_indeterminate", resumable: false }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when no sanctioned upload primitive is available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-blocked-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const locator: LocatorLike = {
      count: async () => 0,
      filter: () => locator
    };
    const page: PageLike = {
      locator: () => locator,
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker?.kind).toBe("upload_failed");
    expect(result.blocker?.code).toBe("upload_path_unavailable");
    expect(result.blocker?.resumable).toBe(true);
    expect(result.blocker?.message).toContain("must not submit");
    expect(result.blocker?.message).not.toContain("permission");
    expect(result.blocker?.visibleText).toContain("no sanctioned native file handoff");
  });

  it("refuses to upload when the controlled tab leaves the ChatGPT allowlist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-origin-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");
    let chooserCalls = 0;
    const page: PageLike = {
      locator: () => ({ count: async () => 1, isVisible: async () => true, click: async () => {} }),
      waitForEvent: async () => {
        chooserCalls += 1;
        return { setFiles: async () => {} };
      },
      title: async () => "Lookalike",
      url: () => "https://evil.example/?next=https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "unsafe_chatgpt_origin",
      resumable: false
    });
    expect(chooserCalls).toBe(0);
  });

  it("blocks when attachment evidence cannot be inspected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-unverified-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const input: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {},
      evaluate: async <T>() => true as T
    };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? input : { count: async () => 0 },
      waitForEvent: async () => ({
        element: () => boundChooserElement(),
        isMultiple: async () => true,
        setFiles: async () => {}
      }),
      evaluate: async () => {
        throw new Error("DOM readiness unavailable");
      },
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file], timeoutMs: 50 });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatchObject({
      kind: "upload_failed",
      code: "attachment_outcome_indeterminate",
      resumable: false
    });
    expect(result.blocker?.message).toContain("Inspect the current composer");
  });

  it("does not accept an attachment filename outside the composer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-history-name-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const input: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {},
      evaluate: async <T>() => true as T
    };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? input : { count: async () => 0 },
      waitForEvent: async () => ({
        element: () => boundChooserElement(),
        isMultiple: async () => true,
        setFiles: async () => {}
      }),
      evaluate: async <T>(): Promise<T> => ({
        supported: true,
        files: [{ name: "notes.txt", visible: false }],
        processing: false
      }) as T,
      waitForTimeout: async () => {},
      title: async () => "Old message mentions notes.txt",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file], timeoutMs: 100 });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      status: "partial",
      blocker: { code: "attachment_outcome_indeterminate", resumable: false }
    });
  });

  it("does not misclassify a disconnected native upload pipe as a permission failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-pipe-closed-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const missing: LocatorLike = {
      count: async () => 0,
      filter: () => missing,
      last: () => hiddenInput
    };
    const hiddenInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => false,
      evaluate: async <T>() => true as T
    };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? hiddenInput : missing,
      waitForEvent: async () => ({ setFiles: async () => {} }),
      capabilities: {
        get: async () => ({
          send: async () => {
            throw new Error("native pipe closed before response");
          }
        })
      },
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      kind: "browser_bridge_unavailable",
      code: "upload_transport_failed",
      resumable: true
    });
    expect(result.blocker?.message).toContain("must not submit");
    expect(result.blocker?.message).not.toContain("permission");
    expect(result.blocker?.visibleText).toContain("native pipe closed before response");
  });

  it("marks a side-effect-then-transport-error handoff indeterminate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-pipe-after-handoff-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");
    let handoffs = 0;

    const input: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => undefined,
      evaluate: async <T>() => true as T
    };
    const missing: LocatorLike = { count: async () => 0, filter: () => missing };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? input : missing,
      waitForEvent: async () => ({
        element: () => boundChooserElement(),
        setFiles: async () => {
          handoffs += 1;
          throw new Error("native pipe closed before response");
        }
      }),
      evaluate: async <T>(): Promise<T> => ({
        supported: false,
        inputFiles: [],
        attachmentLabels: []
      }) as T,
      waitForTimeout: async () => undefined,
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(handoffs).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      status: "partial",
      blocker: {
        kind: "upload_failed",
        code: "attachment_outcome_indeterminate",
        resumable: false
      }
    });
    expect(result.warnings.join(" ")).toContain("native pipe closed before response");
  });

  it("never tries a second upload path after a started handoff fails generically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-single-handoff-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");
    const handoffs: string[] = [];

    const input: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => undefined,
      evaluate: async <T>() => true as T,
      setInputFiles: async () => { handoffs.push("direct"); }
    };
    const missing: LocatorLike = { count: async () => 0, filter: () => missing };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? input : missing,
      waitForEvent: async () => ({
        element: () => boundChooserElement(),
        setFiles: async () => {
          handoffs.push("chooser");
          throw new Error("unexpected chooser reply");
        }
      }),
      evaluate: async <T>(): Promise<T> => ({
        supported: false,
        inputFiles: [],
        attachmentLabels: []
      }) as T,
      waitForTimeout: async () => undefined,
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(handoffs).toEqual(["chooser"]);
    expect(result).toMatchObject({
      ok: false,
      status: "partial",
      blocker: { code: "attachment_outcome_indeterminate", resumable: false }
    });
  });

  it("reports an incompatible browser upload surface without blaming permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-surface-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const hiddenInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => false,
      evaluate: async <T>() => true as T
    };
    const missing: LocatorLike = {
      count: async () => 0,
      filter: () => missing
    };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? hiddenInput : missing,
      waitForEvent: async () => {
        throw new Error("Timed out waiting for file chooser.");
      },
      capabilities: {
        get: async () => ({
          send: async () => {
            throw new Error("Runtime.evaluate is unavailable in this browser surface.");
          }
        })
      },
      evaluate: async () => {
        throw new Error("The browser exposes a read-only DOM snapshot.");
      },
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      kind: "upload_failed",
      code: "upload_path_unavailable",
      resumable: true
    });
    expect(result.blocker?.message).toContain("must not submit");
    expect(result.blocker?.message).not.toContain("permission");
    expect(result.blocker?.visibleText).toContain("no sanctioned native file handoff");
  });

  it("settles an early chooser rejection before a slow visible click completes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-chooser-timeout-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const visibleInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
      },
      evaluate: async <T>() => true as T
    };
    const missing: LocatorLike = {
      count: async () => 0,
      filter: () => missing
    };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? visibleInput : missing,
      waitForEvent: async () => {
        throw new Error("Timed out waiting for file chooser.");
      },
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file], timeoutMs: 50 });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      kind: "upload_failed",
      code: "upload_path_unavailable",
      resumable: true
    });
    expect(result.blocker?.visibleText).toContain("Timed out waiting for file chooser");
  });

  it("explains both permission gates when Chrome rejects fileChooser.setFiles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-not-allowed-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let plusClicked = false;
    const evaluatedSources: string[] = [];
    const messageLocator: LocatorLike = {
      count: async () => 0
    };
    const hiddenInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => false,
      evaluate: async <T>() => true as T
    };
    const plusButton: LocatorLike = {
      count: async () => 1,
      click: async () => {
        plusClicked = true;
      },
      evaluate: async <T>() => true as T
    };
    const menuItem: LocatorLike = {
      count: async () => plusClicked ? 1 : 0,
      filter: () => menuItem,
      click: async () => {}
    };

    const page: PageLike = {
      locator: (selector: string) => {
        if (selector.includes("input[type='file']")) return hiddenInput;
        if (selector === "#composer-plus-btn, button[aria-label='Add files and more']") return plusButton;
        if (selector === "div[role='menuitem']") return menuItem;
        if (selector.includes("data-message-author-role")) return messageLocator;
        return { count: async () => 0, filter: () => menuItem };
      },
      waitForEvent: async () => ({
        element: () => boundChooserElement(),
        isMultiple: async () => true,
        setFiles: async () => {
          throw new Error('{"code":-32000,"message":"Not allowed"}');
        }
      }),
      evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
        evaluatedSources.push(`${String(fn)}\n${JSON.stringify(arg)}`);
        return undefined as T;
      },
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("partial");
    expect(result.blocker?.kind).toBe("upload_failed");
    expect(result.blocker?.code).toBe("attachment_outcome_indeterminate");
    expect(result.blocker?.resumable).toBe(false);
    expect(result.blocker?.message).toContain("Inspect the current composer");
    expect(result.blocker?.remediation?.map(step => step.instruction).join(" ")).toContain("Allow access to file URLs");
    expect(result.blocker?.visibleText).toContain("fileChooser.setFiles failed");
    expect(result.blocker?.visibleText).toContain("Not allowed");
    expect(evaluatedSources.join("\n")).not.toContain("DataTransfer");
    expect(evaluatedSources.join("\n")).not.toContain("bytesBase64");
  });
});

function boundChooserElement(scoped = true): LocatorLike {
  return {
    evaluate: async <T>() => scoped as T
  };
}

describe("downloadLatestFile", () => {
  it("normalizes verified localized Download prefixes", () => {
    expect(stripLocalizedDownloadPrefix("Descargar informe.csv", ["Download", "Descargar"]))
      .toBe("informe.csv");
    expect(stripLocalizedDownloadPrefix("informe.csv", ["Download", "Descargar"]))
      .toBe("informe.csv");
  });

  it("opens a filename-labelled artifact preview and copies a path-only Chrome download", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-generated-file-download-"));
    const dest = join(dir, "out");
    const browserDownload = join(dir, "chatgpt-live-smoke (1).csv");
    await mkdir(dest);
    await writeFile(browserDownload, "name,value\nsmoke,1\n");

    let previewOpen = false;
    let filenameClicked = false;
    let downloadClicked = false;
    const filenameButton: LocatorLike = {
      count: async () => 1,
      click: async () => {
        filenameClicked = true;
        previewOpen = true;
      }
    };
    const assistant: LocatorLike = {
      getByRole: (_role, options) => options?.name === "chatgpt-live-smoke.csv" ? filenameButton : { count: async () => 0 }
    };
    const assistants: LocatorLike = {
      count: async () => 1,
      nth: () => assistant
    };
    const previewDownload: LocatorLike = {
      count: async () => previewOpen ? 1 : 0,
      click: async () => {
        downloadClicked = true;
      }
    };
    const preview: LocatorLike = {
      getByRole: (_role, options) => options?.name === "Download" ? previewDownload : { count: async () => 0 }
    };
    const noConventionalDownload: LocatorLike = { count: async () => 0 };
    const html = [
      "<main><div data-message-author-role='assistant'>",
      "<button aria-label='chatgpt-live-smoke.csv'>chatgpt-live-smoke.csv</button>",
      "<img alt='Generated image' width='256' height='256' src='data:image/png;base64,aW1hZ2U='>",
      "</div></main>"
    ].join("");
    const page: PageLike = {
      content: async () => html,
      locator: selector => {
        if (selector === "[data-message-author-role='assistant']") return assistants;
        if (selector === "section[aria-label=\"chatgpt-live-smoke.csv\"]") return preview;
        return noConventionalDownload;
      },
      waitForEvent: async () => ({ path: async () => browserDownload }),
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/c/mock"
    };

    const result = await downloadLatestFile({ page }, {
      destDir: dest,
      filenamePattern: "^chatgpt-live-smoke\\.csv$",
      timeoutMs: 100
    });

    expect(result.ok).toBe(true);
    expect(result.data?.suggestedFilename).toBe("chatgpt-live-smoke.csv");
    expect(result.data?.path).toBe(join(dest, "chatgpt-live-smoke.csv"));
    expect(filenameClicked).toBe(true);
    expect(downloadClicked).toBe(true);
    await expect(readFile(join(dest, "chatgpt-live-smoke.csv"), "utf8")).resolves.toBe("name,value\nsmoke,1\n");
  });

  it("waits beyond the former 15-second cap for a generated-file preview control", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-delayed-preview-download-"));
    const dest = join(dir, "out");
    const browserDownload = join(dir, "chatgpt-live-smoke.csv");
    await mkdir(dest);
    await writeFile(browserDownload, "name,value\nsmoke,1\n");

    let now = 0;
    let previewOpen = false;
    let downloadClicked = false;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const missing: LocatorLike = { count: async () => 0 };
    const filenameButton: LocatorLike = {
      count: async () => 1,
      click: async () => {
        previewOpen = true;
      }
    };
    const previewDownload: LocatorLike = {
      count: async () => previewOpen && now >= 16000 ? 1 : 0,
      click: async () => {
        downloadClicked = true;
      }
    };
    const assistant: LocatorLike = {
      getByRole: (_role, options) => options?.name === "chatgpt-live-smoke.csv" ? filenameButton : missing
    };
    const assistants: LocatorLike = {
      count: async () => 1,
      nth: () => assistant
    };
    const preview: LocatorLike = {
      count: async () => previewOpen && now >= 3000 ? 1 : 0,
      getByRole: (_role, options) => options?.name === "Download" ? previewDownload : missing
    };
    const page: PageLike = {
      content: async () => [
        "<main><div data-message-author-role='assistant'>",
        "<button aria-label='chatgpt-live-smoke.csv'>chatgpt-live-smoke.csv</button>",
        "</div></main>"
      ].join(""),
      locator: selector => {
        if (selector === "[data-message-author-role='assistant']") return assistants;
        if (selector === "section[aria-label=\"chatgpt-live-smoke.csv\"]") return preview;
        return missing;
      },
      waitForEvent: async () => ({ path: async () => browserDownload }),
      waitForTimeout: async timeoutMs => {
        now += timeoutMs;
      },
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/c/mock"
    };

    try {
      const result = await downloadLatestFile({ page }, {
        destDir: dest,
        filenamePattern: "^chatgpt-live-smoke\\.csv$",
        timeoutMs: 20000
      });

      expect(result.ok).toBe(true);
      expect(result.data?.suggestedFilename).toBe("chatgpt-live-smoke.csv");
      expect(downloadClicked).toBe(true);
      expect(now).toBeGreaterThanOrEqual(16000);
    } finally {
      dateNow.mockRestore();
    }
  });

  it.each([false, true])("keeps preview downloads filename-scoped without locator filtering (labelled preview: %s)", async hasLabelledPreview => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-scoped-preview-download-"));
    const browserDownload = join(dir, "review.csv");
    await writeFile(browserDownload, "finding,severity\nexample,low\n");
    const dest = join(dir, "out");
    let now = 0;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const missing: LocatorLike = { count: async () => 0 };
    const artifactClick = vi.fn(async () => {});
    const labelledDownloadClick = vi.fn(async () => {});
    const unrelatedDownloadClick = vi.fn(async () => {});
    const artifact: LocatorLike = { count: async () => 1, click: artifactClick };
    const assistant: LocatorLike = {
      getByRole: (_role, options) => options?.name === "review.csv" ? artifact : missing
    };
    const assistants: LocatorLike = { count: async () => 1, nth: () => assistant };
    const labelledDownload: LocatorLike = { count: async () => 1, click: labelledDownloadClick };
    const unrelatedDownload: LocatorLike = { count: async () => 1, click: unrelatedDownloadClick };
    const labelledPreview: LocatorLike = {
      getByRole: (_role, options) => options?.name === "Download" ? labelledDownload : missing
    };
    // This provider cannot filter workbook previews by filename. Its sole
    // workbook belongs to another file, even though it has a Download button.
    const unrelatedWorkbook: LocatorLike = {
      count: async () => 1,
      getByRole: (_role, options) => options?.name === "Download" ? unrelatedDownload : missing
    };
    const waitForEvent = vi.fn(async () => ({ path: async () => browserDownload }));
    const page: PageLike = {
      content: async () => "<main><div data-message-author-role='assistant'><button aria-label='review.csv'>review.csv</button></div></main>",
      locator: selector => {
        if (selector === "[data-message-author-role='assistant']") return assistants;
        if (selector === "section[aria-label=\"review.csv\"]") return hasLabelledPreview ? labelledPreview : missing;
        if (selector === "section[data-testid^='popcorn-']") return unrelatedWorkbook;
        return missing;
      },
      waitForEvent,
      waitForTimeout: async timeoutMs => { now += timeoutMs; },
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/c/mock"
    };

    try {
      const result = await downloadLatestFile({ page }, {
        destDir: dest,
        filenamePattern: "^review\\.csv$",
        timeoutMs: 100
      });

      expect(artifactClick).toHaveBeenCalledOnce();
      expect(unrelatedDownloadClick).not.toHaveBeenCalled();
      expect(result.ok).toBe(hasLabelledPreview);
      if (hasLabelledPreview) {
        expect(labelledDownloadClick).toHaveBeenCalledOnce();
        expect(waitForEvent).toHaveBeenCalledOnce();
        await expect(readFile(join(dest, "review.csv"), "utf8")).resolves.toBe("finding,severity\nexample,low\n");
      } else {
        expect(labelledDownloadClick).not.toHaveBeenCalled();
        expect(waitForEvent).not.toHaveBeenCalled();
        expect(result.data).toBeUndefined();
      }
    } finally {
      dateNow.mockRestore();
    }
  });

  it("normalizes Chat's download-prefixed artifact control and uses the workbook preview", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-generated-workbook-download-"));
    const dest = join(dir, "out");
    const browserDownload = join(dir, "review.csv");
    await mkdir(dest);
    await writeFile(browserDownload, "finding,severity\nexample,low\n");

    let previewOpen = false;
    let controlClicked = false;
    let downloadClicked = false;
    const artifactControl: LocatorLike = {
      count: async () => 1,
      click: async () => {
        controlClicked = true;
        previewOpen = true;
      }
    };
    const missing: LocatorLike = {
      count: async () => 0,
      filter: () => missing
    };
    const assistant: LocatorLike = {
      getByRole: (_role, options) => options?.name === "download review.csv" ? artifactControl : missing
    };
    const assistants: LocatorLike = {
      count: async () => 1,
      nth: () => assistant
    };
    const previewDownload: LocatorLike = {
      count: async () => previewOpen ? 1 : 0,
      click: async () => {
        downloadClicked = true;
      }
    };
    const workbookPreview: LocatorLike = {
      count: async () => previewOpen ? 1 : 0,
      filter: options => options?.hasText === "review.csv" ? workbookPreview : missing,
      getByRole: (_role, options) => options?.name === "Download" ? previewDownload : missing
    };
    const page: PageLike = {
      content: async () => [
        "<main><div data-message-author-role='assistant'>",
        "<button aria-label='download review.csv'>download review.csv</button>",
        "</div></main>"
      ].join(""),
      locator: selector => {
        if (selector === "[data-message-author-role='assistant']") return assistants;
        if (selector === "section[data-testid^='popcorn-']") return workbookPreview;
        return missing;
      },
      waitForEvent: async () => ({ path: async () => browserDownload }),
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/c/mock"
    };

    const result = await downloadLatestFile({ page }, {
      destDir: dest,
      filenamePattern: "^review\\.csv$",
      timeoutMs: 100
    });

    expect(result.ok).toBe(true);
    expect(result.data?.suggestedFilename).toBe("review.csv");
    expect(controlClicked).toBe(true);
    expect(downloadClicked).toBe(true);
    await expect(readFile(join(dest, "review.csv"), "utf8")).resolves.toBe("finding,severity\nexample,low\n");
  });

  it("does not accept an unrelated image fallback when filenamePattern does not match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-generated-file-mismatch-"));
    const html = [
      "<main><div data-message-author-role='assistant'>",
      "<button aria-label='other.csv'>other.csv</button>",
      "<img alt='Generated image' width='256' height='256' src='data:image/png;base64,aW1hZ2U='>",
      "</div></main>"
    ].join("");
    const page: PageLike = {
      content: async () => html,
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/c/mock"
    };

    const result = await downloadLatestFile({ page }, {
      destDir: dir,
      filenamePattern: "^chatgpt-live-smoke\\.csv$",
      timeoutMs: 100
    });

    expect(result).toMatchObject({
      ok: false,
      status: "unsupported",
      blocker: {
        kind: "download_unavailable",
        code: "download_filename_not_found"
      }
    });
  });

  it("keeps direct assistant file links working with filenamePattern", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-direct-file-link-"));
    const dest = join(dir, "out");
    const browserDownload = join(dir, "report (2).csv");
    await mkdir(dest);
    await writeFile(browserDownload, "metric,value\nrequests,2\n");

    let clicked = false;
    const link: LocatorLike = {
      count: async () => 1,
      click: async () => {
        clicked = true;
      }
    };
    const assistant: LocatorLike = {
      getByRole: (_role, options) => options?.name === "report.csv" ? link : { count: async () => 0 }
    };
    const assistants: LocatorLike = {
      count: async () => 1,
      nth: () => assistant
    };
    const page: PageLike = {
      content: async () => "<main><div data-message-author-role='assistant'><a download aria-label='report.csv'>report.csv</a></div></main>",
      locator: selector => selector === "[data-message-author-role='assistant']" ? assistants : { count: async () => 0 },
      waitForEvent: async () => ({ path: async () => browserDownload }),
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/c/mock"
    };

    const result = await downloadLatestFile({ page }, {
      destDir: dest,
      filenamePattern: "^report\\.csv$",
      timeoutMs: 100
    });

    expect(result.ok).toBe(true);
    expect(result.data?.suggestedFilename).toBe("report.csv");
    expect(clicked).toBe(true);
    await expect(readFile(join(dest, "report.csv"), "utf8")).resolves.toBe("metric,value\nrequests,2\n");
  });

  it("saves a non-empty mocked browser download", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-download-"));
    const dest = join(dir, "out");
    await mkdir(dest);

    const locator: LocatorLike = {
      count: async () => 1,
      last: () => locator,
      click: async () => {}
    };
    let downloadOptions: unknown;
    const page: PageLike = {
      locator: () => locator,
      waitForEvent: async (_event, options) => {
        downloadOptions = options;
        return {
        suggestedFilename: () => "answer.txt",
        saveAs: async (path: string) => {
          await writeFile(path, "downloaded");
        }
        };
      },
      evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => fn(arg as A),
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/c/mock"
    };

    // Fix the clock for this exact propagation assertion: diagnostic and
    // filesystem setup otherwise legitimately consume the receipt deadline.
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const result = await downloadLatestFile({ page }, { destDir: dest, timeoutMs: 45000 });
      expect(result.ok).toBe(true);
      expect(result.data?.suggestedFilename).toBe("answer.txt");
      expect(result.data?.bytes).toBeGreaterThan(0);
      expect(downloadOptions).toEqual({ timeout: 45000, timeoutMs: 45000 });
      await expect(stat(join(dest, "answer.txt"))).resolves.toBeTruthy();
      await expect(readFile(join(dest, "answer.txt"), "utf8")).resolves.toBe("downloaded");
    } finally {
      clock.mockRestore();
    }
  });

  it("returns a classified blocker quickly when locating download controls stalls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-download-stall-"));
    const dest = join(dir, "out");
    await mkdir(dest);

    const stalledLocator: LocatorLike = {
      count: async () => new Promise<number>(() => {})
    };
    const page: PageLike = {
      locator: () => stalledLocator,
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/c/mock"
    };

    const result = await Promise.race([
      downloadLatestFile({ page }, { destDir: dest, timeoutMs: 20 }),
      new Promise<"hung">(resolve => setTimeout(() => resolve("hung"), 75))
    ]);

    expect(result).not.toBe("hung");
    expect(result).toMatchObject({
      ok: false,
      status: "unsupported",
      blocker: {
        kind: "download_unavailable",
        code: "download_control_timeout"
      }
    });
  });
});
