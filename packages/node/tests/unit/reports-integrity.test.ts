import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRunReport } from "../../src/commands/reports.js";
import { normalizePromptForIntegrity, verifyIntegritySidecar } from "../../src/safety/untrusted-output.js";
import type { CommandResult } from "../../src/types.js";

const FIXED_NOW = new Date("2026-06-09T20:00:00.000Z");

describe("run report integrity sidecars", () => {
  it("writes SHA-256 and byte-count metadata for report, prompt, output, and input files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-report-integrity-"));
    const inputPath = join(dir, "input.md");
    await writeFile(inputPath, "source bytes\n", "utf8");

    const result = await createRunReport(
      { now: () => FIXED_NOW },
      commandResult({
        prompt: "Review this file.  \n\n\nReturn concise notes.\t",
        responseText: "Captured answer with ``` fence escape attempt.",
        files: [{ path: inputPath, name: "input.md", bytes: 13 }]
      }),
      { destDir: dir, basename: "integrity", includeContent: true, integrity: { inputPaths: [inputPath] } }
    );

    expect(result.ok).toBe(true);
    expect(result.data?.path).toBe(join(dir, "2026-06-09T20-00-00-000Z-integrity.json"));
    expect(result.data?.metaPath).toBe(`${result.data?.path}.meta.json`);

    const reportBody = await readFile(result.data!.path, "utf8");
    const meta = JSON.parse(await readFile(result.data!.metaPath!, "utf8"));

    expect(meta).toMatchObject({
      schemaVersion: "chatgpt.browser_control.integrity.v1",
      target: {
        path: result.data?.path,
        bytes: Buffer.byteLength(reportBody, "utf8"),
        sha256: sha256(reportBody)
      },
      prompt: {
        normalized: true,
        bytes: Buffer.byteLength("Review this file.\nReturn concise notes.", "utf8"),
        sha256: sha256(normalizePromptForIntegrity("Review this file.  \n\n\nReturn concise notes.\t"))
      },
      output: {
        untrusted: true,
        bytes: Buffer.byteLength("Captured answer with ``` fence escape attempt.", "utf8"),
        sha256: sha256("Captured answer with ``` fence escape attempt.")
      },
      inputs: [
        {
          path: inputPath,
          bytes: Buffer.byteLength("source bytes\n", "utf8"),
          sha256: sha256("source bytes\n")
        }
      ]
    });

    await expect(verifyIntegritySidecar(result.data!.metaPath!)).resolves.toMatchObject({
      ok: true,
      mismatches: []
    });
  });

  it("refuses to overwrite an existing run report for the same timestamp and basename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-report-no-overwrite-"));
    const options = { destDir: dir, basename: "same-run", includeContent: true };

    const first = await createRunReport({ now: () => FIXED_NOW }, commandResult({ responseText: "first" }), options);
    const second = await createRunReport({ now: () => FIXED_NOW }, commandResult({ responseText: "second" }), options);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.error?.message).toContain("already exists");
    await expect(readFile(first.data!.path, "utf8")).resolves.toContain("first");
  });

  it("detects target report tampering before a consumer trusts a sidecar", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-report-tamper-"));
    const result = await createRunReport(
      { now: () => FIXED_NOW },
      commandResult({ responseText: "original output" }),
      { destDir: dir, basename: "tamper", includeContent: true }
    );

    expect(result.ok).toBe(true);
    await writeFile(result.data!.path, "tampered\n", "utf8");

    await expect(verifyIntegritySidecar(result.data!.metaPath!)).resolves.toMatchObject({
      ok: false,
      mismatches: [
        expect.objectContaining({
          kind: "target",
          path: result.data!.path
        })
      ]
    });
  });

  it("removes the report file if sidecar creation fails after the report write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-report-sidecar-fail-"));
    const reportPath = join(dir, "2026-06-09T20-00-00-000Z-sidecar-fail.json");
    await writeFile(`${reportPath}.meta.json`, "pre-existing sidecar\n", "utf8");

    const result = await createRunReport(
      { now: () => FIXED_NOW },
      commandResult({ responseText: "orphan check" }),
      { destDir: dir, basename: "sidecar-fail", includeContent: true }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("already exists");
    await expect(pathExists(reportPath)).resolves.toBe(false);
  });
});

function commandResult(data: Record<string, unknown>): CommandResult<unknown> {
  return {
    ok: true,
    status: "ok",
    data,
    warnings: [],
    context: { timestamp: "2026-06-09T20:00:00.000Z" }
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
