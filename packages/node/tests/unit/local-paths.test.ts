import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  basenameForHostPath,
  isHostAbsolutePath,
  resolveForHostPath
} from "../../src/platform/local-paths.js";

describe("local path platform semantics", () => {
  it("accepts POSIX absolute paths only on POSIX-like hosts", () => {
    expect(isHostAbsolutePath("/tmp/file.md", "linux")).toBe(true);
    expect(isHostAbsolutePath("/example/user/file.md", "darwin")).toBe(true);
    expect(isHostAbsolutePath("notes/file.md", "linux")).toBe(false);
    expect(isHostAbsolutePath("", "linux")).toBe(false);
  });

  it("rejects Windows-looking absolute paths on POSIX-like hosts", () => {
    expect(isHostAbsolutePath(String.raw`C:\Users\example\file.md`, "linux")).toBe(false);
    expect(isHostAbsolutePath(String.raw`D:\WSL\file.md`, "darwin")).toBe(false);
    expect(isHostAbsolutePath(String.raw`\\server\share\file.md`, "linux")).toBe(false);
  });

  it("accepts fully qualified Windows local and UNC paths on Windows", () => {
    expect(isHostAbsolutePath(String.raw`C:\Users\example\file.md`, "win32")).toBe(true);
    expect(isHostAbsolutePath(String.raw`D:/Workspace/file.md`, "win32")).toBe(true);
    expect(isHostAbsolutePath(String.raw`\\server\share\file.md`, "win32")).toBe(true);
  });

  it("rejects ambiguous Windows paths", () => {
    expect(isHostAbsolutePath(String.raw`C:Users\example\file.md`, "win32")).toBe(false);
    expect(isHostAbsolutePath(String.raw`\tmp\file.md`, "win32")).toBe(false);
    expect(isHostAbsolutePath("notes/file.md", "win32")).toBe(false);
  });

  it("resolves and names paths with the requested host semantics", () => {
    expect(resolveForHostPath("/tmp/file.md", "linux")).toBe("/tmp/file.md");
    expect(basenameForHostPath("/tmp/file.md", "linux")).toBe("file.md");
    expect(resolveForHostPath(String.raw`C:\Users\example\file.md`, "win32")).toBe(String.raw`C:\Users\example\file.md`);
    expect(basenameForHostPath(String.raw`C:\Users\example\file.md`, "win32")).toBe("file.md");
  });

  it("throws before resolving a foreign Windows path on POSIX", () => {
    expect(() => resolveForHostPath(String.raw`C:\Users\example\file.md`, "linux")).toThrow(/absolute/);
  });

  it("documents the POSIX literal-filename bypass case", async () => {
    if (process.platform === "win32") return;
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-control-winpath-bypass-"));
    await writeFile(join(dir, String.raw`C:\Users\example\file.md`), "literal POSIX filename");

    expect(isHostAbsolutePath(String.raw`C:\Users\example\file.md`, "linux")).toBe(false);
    expect(() => resolveForHostPath(String.raw`C:\Users\example\file.md`, "linux")).toThrow(/absolute/);
  });

  // -------------------------------------------------------------------------
  // Gap 2 regression: additional edge cases for Windows path safety
  // -------------------------------------------------------------------------

  it("win32: rejects forward-slash UNC paths (conservative default — backslash UNC only)", () => {
    // The current regex only matches backslash UNC (\\server\share\).
    // Forward-slash UNC (//server/share/) looks like a POSIX path and is
    // intentionally rejected on win32 to avoid ambiguity.  This test pins
    // the conservative contract: if future code ever loosens this it will be a
    // deliberate, test-visible change.
    expect(isHostAbsolutePath("//server/share/file.md", "win32")).toBe(false);
    expect(isHostAbsolutePath("//server/share/", "win32")).toBe(false);
    expect(() => resolveForHostPath("//server/share/file.md", "win32")).toThrow(/absolute/);
  });

  it("win32: rejects a bare drive letter with no separator", () => {
    // "C:" alone is a drive-relative reference, not an absolute path.
    expect(isHostAbsolutePath("C:", "win32")).toBe(false);
    expect(isHostAbsolutePath("D:", "win32")).toBe(false);
  });

  it("win32: accepts a bare drive root (C:\\ or C:/)", () => {
    // "C:\" and "C:/" are fully-qualified root references.
    expect(isHostAbsolutePath("C:\\", "win32")).toBe(true);
    expect(isHostAbsolutePath("C:/", "win32")).toBe(true);
  });

  it("win32: accepts mixed-separator paths (C:/Users\\example/file.md)", () => {
    // Windows accepts both / and \ as separators; the regex intentionally
    // matches either character after the drive letter colon.
    const mixed = "C:/Users\\example/file.md";
    expect(isHostAbsolutePath(mixed, "win32")).toBe(true);
    // resolveForHostPath normalises to backslashes on win32
    const resolved = resolveForHostPath(mixed, "win32");
    expect(resolved).toContain("example");
    expect(basenameForHostPath(mixed, "win32")).toBe("file.md");
  });

  it("POSIX: //server/share/file is treated as absolute (starts with /)", () => {
    // On POSIX, path.posix.isAbsolute("//server/share/file") returns true
    // because the path starts with /.  This is the expected POSIX behaviour;
    // the test pins it so any future change to the POSIX branch is visible.
    expect(isHostAbsolutePath("//server/share/file.md", "linux")).toBe(true);
    expect(isHostAbsolutePath("//server/share/file.md", "darwin")).toBe(true);
  });

  it("POSIX: basenameForHostPath returns the POSIX basename, not Windows basename", () => {
    // On POSIX the path separator is /, so a Windows path with backslashes
    // is treated as a single filename component.  resolveForHostPath would
    // have thrown before this is called in real usage, but the basename helper
    // itself must be consistent.
    const winPath = String.raw`C:\Users\example\file.md`;
    // basenameForHostPath on linux uses path.posix.basename, so the whole
    // string after the last / is the basename (there is no / here).
    expect(basenameForHostPath(winPath, "linux")).toBe(winPath);
    // On win32 it correctly picks "file.md"
    expect(basenameForHostPath(winPath, "win32")).toBe("file.md");
  });

  it("resolveForHostPath throws for a POSIX absolute path on win32", () => {
    // A /unix/path is not a fully-qualified Windows path, so it must be
    // rejected when the host is win32.
    expect(() => resolveForHostPath("/usr/local/file.md", "win32")).toThrow(/absolute/);
    expect(() => resolveForHostPath("/tmp/file.md", "win32")).toThrow(/absolute/);
  });
});
