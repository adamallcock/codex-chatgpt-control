import { access, chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { attachFiles, downloadLatestFile, preflightFiles, validateAttachPaths } from "../../src/commands/files.js";
import type { LocatorLike, PageLike } from "../../src/types.js";

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
    const visibleInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {}
    };
    const messageLocator: LocatorLike = {
      count: async () => 0
    };

    const page: PageLike = {
      locator: (selector: string) => {
        if (selector === "#upload-files") return visibleInput;
        if (selector.includes("data-message-author-role")) return messageLocator;
        return { count: async () => 0 };
      },
      waitForEvent: async () => ({
        isMultiple: async () => true,
        setFiles: async (paths: string[]) => {
          uploadedPaths = paths;
        }
      }),
      evaluate: async <T, A = unknown>(_fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
        if (Array.isArray(arg)) {
          return {
            files: [{ name: "notes.txt", visible: true }],
            processing: false
          } as T;
        }
        return {
          files: [{ name: "notes.txt", size: 5, type: "text/plain", lastModified: 123 }]
        } as T;
      },
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, {
      paths: [file],
      includeDiagnostics: true,
      includeHashes: true
    });

    expect(result.ok).toBe(true);
    expect(uploadedPaths).toEqual([file]);
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

  it("uses the current focusable command-palette upload row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-palette-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let plusClicked = false;
    let paletteClicked = false;
    let uploadedPaths: string[] = [];
    const hiddenInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => false
    };
    const plusButton: LocatorLike = {
      count: async () => 1,
      click: async () => { plusClicked = true; }
    };
    const missingMenuItem: LocatorLike = {
      count: async () => 0,
      filter: () => missingMenuItem
    };
    const paletteItem: LocatorLike = {
      count: async () => plusClicked ? 1 : 0,
      filter: () => paletteItem,
      click: async () => { paletteClicked = true; }
    };
    const messageLocator: LocatorLike = { count: async () => 0 };
    const page: PageLike = {
      locator: selector => {
        if (selector === "#upload-files") return hiddenInput;
        if (selector === "#composer-plus-btn, button[aria-label='Add files and more']") return plusButton;
        if (selector === "div[role='menuitem']") return missingMenuItem;
        if (selector === "div[tabindex='0']") return paletteItem;
        if (selector.includes("data-message-author-role")) return messageLocator;
        return missingMenuItem;
      },
      waitForEvent: async () => ({
        isMultiple: async () => true,
        setFiles: async (paths: string[]) => { uploadedPaths = paths; }
      }),
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(result.ok).toBe(true);
    expect(plusClicked).toBe(true);
    expect(paletteClicked).toBe(true);
    expect(uploadedPaths).toEqual([file]);
  });

  it("waits for attached files to finish processing before returning success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-processing-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let uploadedPaths: string[] = [];
    let processing = true;
    let readinessChecks = 0;
    let waitCalls = 0;

    const visibleInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => true,
      click: async () => {}
    };
    const messageLocator: LocatorLike = {
      count: async () => 0
    };

    const page: PageLike = {
      locator: (selector: string) => {
        if (selector === "#upload-files") return visibleInput;
        if (selector.includes("data-message-author-role")) return messageLocator;
        return { count: async () => 0 };
      },
      waitForEvent: async () => ({
        isMultiple: async () => true,
        setFiles: async (paths: string[]) => {
          uploadedPaths = paths;
        }
      }),
      evaluate: async <T, A = unknown>(_fn: (arg: A) => T | Promise<T>, _arg?: A): Promise<T> => {
        readinessChecks += 1;
        return {
          files: [
            { name: "notes.txt", visible: !processing }
          ],
          processing,
          processingText: processing ? "Uploading notes.txt" : undefined
        } as T;
      },
      waitForTimeout: async () => {
        waitCalls += 1;
        if (waitCalls > 1) {
          processing = false;
        }
      },
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file], timeoutMs: 500 });

    expect(result.ok).toBe(true);
    expect(uploadedPaths).toEqual([file]);
    expect(readinessChecks).toBeGreaterThan(1);
    expect(waitCalls).toBeGreaterThan(1);
  });

  it("uses scoped CDP only to open the hidden input's approved file chooser", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-cdp-chooser-"));
    const first = join(dir, "first.md");
    const second = join(dir, "second.txt");
    await writeFile(first, "first-file");
    await writeFile(second, "second-file");

    const hiddenInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => false
    };
    const missing: LocatorLike = {
      count: async () => 0,
      filter: () => missing
    };
    let uploadedPaths: string[] = [];
    let sentMethod: string | undefined;
    let sentParams: Record<string, unknown> | undefined;
    const page: PageLike = {
      locator: selector => selector === "#upload-files" ? hiddenInput : missing,
      waitForEvent: async () => ({
        isMultiple: async () => true,
        setFiles: async (paths: string[]) => {
          uploadedPaths = paths;
        }
      }),
      capabilities: {
        get: async id => id === "cdp" ? {
          send: async (method: string, params: Record<string, unknown>) => {
            sentMethod = method;
            sentParams = params;
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
    expect(sentParams?.expression).toContain("#upload-files");
  });

  it("returns a permission blocker when no upload primitive is available", async () => {
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
    expect(result.blocker?.kind).toBe("permission");
    expect(result.blocker?.code).toBe("upload_permission_required");
    expect(result.blocker?.resumable).toBe(true);
    expect(result.blocker?.message).toContain("Codex Settings > Computer Use > Chrome");
    expect(result.blocker?.message).toContain("Allow access to file URLs");
    expect(result.blocker?.remediation?.map(step => step.label)).toEqual([
      "Codex Chrome uploads",
      "Chrome file URLs"
    ]);
    expect(result.blocker?.visibleText).toContain("Upload permission troubleshooting");
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
      isVisible: async () => false
    };
    const page: PageLike = {
      locator: selector => selector.includes("input[type='file']") ? hiddenInput : missing,
      evaluate: async () => {
        throw new Error("native pipe closed before response");
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

  it("reports an incompatible browser upload surface without blaming permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-surface-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    const hiddenInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => false
    };
    const missing: LocatorLike = {
      count: async () => 0,
      filter: () => missing
    };
    const page: PageLike = {
      locator: selector => selector === "#upload-files" ? hiddenInput : missing,
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
    expect(result.blocker?.visibleText).toContain("read-only DOM snapshot");
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
      }
    };
    const missing: LocatorLike = {
      count: async () => 0,
      filter: () => missing
    };
    const page: PageLike = {
      locator: selector => selector === "#upload-files" ? visibleInput : missing,
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
      kind: "permission",
      code: "upload_permission_required",
      resumable: true
    });
    expect(result.blocker?.visibleText).toContain("Timed out waiting for file chooser");
  });

  it("explains both permission gates when Chrome rejects fileChooser.setFiles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-not-allowed-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let plusClicked = false;
    const messageLocator: LocatorLike = {
      count: async () => 0
    };
    const hiddenInput: LocatorLike = {
      count: async () => 1,
      isVisible: async () => false
    };
    const plusButton: LocatorLike = {
      count: async () => 1,
      click: async () => {
        plusClicked = true;
      }
    };
    const menuItem: LocatorLike = {
      count: async () => plusClicked ? 1 : 0,
      filter: () => menuItem,
      click: async () => {}
    };

    const page: PageLike = {
      locator: (selector: string) => {
        if (selector === "#upload-files") return hiddenInput;
        if (selector === "#composer-plus-btn, button[aria-label='Add files and more']") return plusButton;
        if (selector === "div[role='menuitem']") return menuItem;
        if (selector.includes("data-message-author-role")) return messageLocator;
        return { count: async () => 0, filter: () => menuItem };
      },
      waitForEvent: async () => ({
        isMultiple: async () => true,
        setFiles: async () => {
          throw new Error('{"code":-32000,"message":"Not allowed"}');
        }
      }),
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker?.kind).toBe("permission");
    expect(result.blocker?.code).toBe("upload_permission_required");
    expect(result.blocker?.resumable).toBe(true);
    expect(result.blocker?.message).toContain("file chooser opened");
    expect(result.blocker?.message).toContain("Codex Settings > Computer Use > Chrome");
    expect(result.blocker?.message).toContain("chrome://extensions");
    expect(result.blocker?.remediation?.map(step => step.instruction).join(" ")).toContain("Allow access to file URLs");
    expect(result.blocker?.visibleText).toContain("fileChooser.setFiles failed");
    expect(result.blocker?.visibleText).toContain("Not allowed");
  });
});

describe("downloadLatestFile", () => {
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

    const result = await downloadLatestFile({ page }, { destDir: dest, timeoutMs: 45000 });
    expect(result.ok).toBe(true);
    expect(result.data?.suggestedFilename).toBe("answer.txt");
    expect(result.data?.bytes).toBeGreaterThan(0);
    expect(downloadOptions).toEqual({ timeout: 45000, timeoutMs: 45000 });
    await expect(stat(join(dest, "answer.txt"))).resolves.toBeTruthy();
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
