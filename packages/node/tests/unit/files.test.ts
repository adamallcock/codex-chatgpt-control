import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attachFiles, downloadLatestFile, validateAttachPaths } from "../../src/commands/files.js";
import type { LocatorLike, PageLike } from "../../src/types.js";

describe("validateAttachPaths", () => {
  it("rejects relative paths", async () => {
    await expect(validateAttachPaths(["notes.txt"])).rejects.toThrow(/absolute/);
  });

  it("returns file metadata for readable files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    await expect(validateAttachPaths([file])).resolves.toEqual([
      { path: file, name: "notes.txt", bytes: 5 }
    ]);
  });
});

describe("attachFiles", () => {
  it("uses ChatGPT's Add photos & files chooser when the file input is hidden", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-attach-"));
    const file = join(dir, "notes.txt");
    await writeFile(file, "hello");

    let plusClicked = false;
    let menuClicked = false;
    let uploadedPaths: string[] = [];

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
      click: async () => {
        menuClicked = true;
      }
    };
    const genericButton: LocatorLike = {
      click: async () => {
        throw new Error("generic button should not be used");
      }
    };

    const page: PageLike = {
      locator: (selector: string) => {
        if (selector === "#upload-files") return hiddenInput;
        if (selector === "#composer-plus-btn, button[aria-label='Add files and more']") return plusButton;
        if (selector === "div[role='menuitem']") return menuItem;
        if (selector.includes("data-message-author-role")) return messageLocator;
        return genericButton;
      },
      waitForEvent: async event => {
        expect(event).toBe("filechooser");
        return {
          isMultiple: async () => true,
          setFiles: async (paths: string[]) => {
            uploadedPaths = paths;
          }
        };
      },
      waitForTimeout: async () => {},
      title: async () => "ChatGPT",
      url: () => "https://chatgpt.com/"
    };

    const result = await attachFiles({ page }, { paths: [file] });

    expect(result.ok).toBe(true);
    expect(plusClicked).toBe(true);
    expect(menuClicked).toBe(true);
    expect(uploadedPaths).toEqual([file]);
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
