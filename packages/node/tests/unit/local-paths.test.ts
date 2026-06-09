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
});
