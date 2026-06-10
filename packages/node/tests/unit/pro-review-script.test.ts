import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { ProReviewWorkflowArgs } from "../../src/client.js";
import type { CommandResult } from "../../src/types.js";
import {
  parseProReviewCliArgs,
  runProReview,
  type ProReviewCliClient
} from "../../src/scripts/pro-review.js";
import { normalizePromptForHash } from "../../src/dom/visible-text.js";
import { parseProReviewRunMarker } from "../../src/pro-review/run-marker.js";

describe("pro-review entrypoint", () => {
  it("parses dry-run arguments by default", () => {
    expect(parseProReviewCliArgs([
      "--zip",
      "review.zip",
      "--prompt-file",
      "prompt.md"
    ], {})).toEqual({
      zipPath: "review.zip",
      promptFile: "prompt.md",
      submit: false,
      format: "markdown",
      timeoutMs: 600000,
      stableMs: 1000
    });
  });

  it("requires exactly one prompt source", () => {
    expect(() => parseProReviewCliArgs([
      "--zip",
      "review.zip",
      "--prompt",
      "inline",
      "--prompt-file",
      "prompt.md"
    ], {})).toThrow(/Use either --prompt or --prompt-file/);
  });

  it("accepts Codex origin thread id from environment", () => {
    expect(parseProReviewCliArgs([
      "--zip",
      "review.zip",
      "--prompt",
      "Review this."
    ], {
      CODEX_THREAD_ID: "thread-env-123"
    })).toMatchObject({
      zipPath: "review.zip",
      prompt: "Review this.",
      codexThreadId: "thread-env-123"
    });
  });

  it("runs dry-run without submit unless --submit is supplied", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pro-review-test-"));
    const promptPath = join(dir, "prompt.md");
    await writeFile(promptPath, "Review this package.\n", "utf8");
    const calls: string[] = [];
    const client = fakeClient(calls);

    const result = await runProReview(client, {
      zipPath: "review.zip",
      promptFile: promptPath,
      submit: false,
      format: "markdown",
      timeoutMs: 600000,
      stableMs: 1000
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["dryRun:review.zip:Review this package."]);
  });

  it("submits only when requested and passes response wait settings", async () => {
    const calls: string[] = [];
    const client = fakeClient(calls);
    const dir = await mkdtemp(join(tmpdir(), "pro-review-output-"));
    const zipPath = join(dir, "review.zip");
    await writeFile(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));

    const result = await runProReview(client, {
      zipPath,
      prompt: "Review now.",
      submit: true,
      outputPath: join(dir, "answer.md"),
      model: "GPT-5",
      effort: "Thinking",
      runId: "run-123",
      codexThreadId: "thread-123",
      format: "markdown",
      maxChars: 2000,
      timeoutMs: 120000,
      stableMs: 1500
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`submit:${zipPath}:Review now.`);
    expect(calls[0]).toContain("runId: run-123");
    expect(calls[0]).toContain(":120000:1500");
    const outputPath = (result.context as Record<string, unknown>).outputPath;
    const outputMetaPath = (result.context as Record<string, unknown>).outputMetaPath;
    expect(typeof outputPath).toBe("string");
    expect(typeof outputMetaPath).toBe("string");
    expect(await readFile(outputPath as string, "utf8")).toBe("answer text");
    const meta = JSON.parse(await readFile(outputMetaPath as string, "utf8")) as Record<string, unknown>;
    expect(meta).toMatchObject({
      schemaVersion: 2,
      ok: true,
      status: "ok",
      runId: "run-123",
      outputPath,
      codex: {
        threadId: "thread-123",
        source: "CODEX_THREAD_ID"
      },
      prompt: {
        path: expect.any(String),
        sha256: expect.any(String),
        bytes: expect.any(Number)
      },
      zip: {
        basename: "review.zip",
        path: zipPath,
        bytes: 5,
        sha256: expect.any(String)
      },
      answer: {
        path: outputPath,
        bytes: "answer text".length,
        sha256: expect.any(String)
      },
      return: {
        state: "return_prompt_prepared",
        promptPath: expect.any(String),
        promptSha256: expect.any(String),
        ledgerPath: expect.any(String),
        method: "manual_or_future_thread_message",
        returnedAt: null,
        turnId: null,
        attempts: []
      }
    });
    const returnPromptPath = ((meta.return as Record<string, unknown>).promptPath) as string;
    const inputPrompt = await readFile((meta.prompt as Record<string, unknown>).path as string, "utf8");
    expect(inputPrompt).toContain("## Codex ChatGPT Pro Review Run");
    expect(inputPrompt).toContain("runId: run-123");
    const marker = parseProReviewRunMarker(inputPrompt);
    expect(marker).toMatchObject({
      runId: "run-123",
      promptSha256: sha256Prompt("Review now.")
    });
    expect((meta.prompt as Record<string, unknown>).sha256).toBe(sha256Prompt(inputPrompt));
    expect((meta.prompt as Record<string, unknown>).sha256).not.toBe(marker?.promptSha256);
    const returnPrompt = await readFile(returnPromptPath, "utf8");
    expect(returnPrompt).toContain("runId: run-123");
    expect(returnPrompt).toContain(`answerPath: ${outputPath}`);
    expect(returnPrompt).toContain("## Inline Answer");
    expect(returnPrompt).toContain("```text");
    expect(returnPrompt).toContain("answer text");
  });

  it("uses a longer fence when the answer contains markdown fences", async () => {
    const calls: string[] = [];
    const client = fakeClient(calls);
    const dir = await mkdtemp(join(tmpdir(), "pro-review-fenced-output-"));
    const zipPath = join(dir, "review.zip");
    await writeFile(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));

    const result = await runProReview(client, {
      zipPath,
      prompt: "Review now.",
      submit: true,
      outputPath: join(dir, "answer.md"),
      runId: "run-fenced",
      codexThreadId: "thread-123",
      format: "markdown",
      timeoutMs: 120000,
      stableMs: 1500
    });

    expect(result.ok).toBe(true);
    const meta = JSON.parse(await readFile((result.context as Record<string, unknown>).outputMetaPath as string, "utf8")) as Record<string, unknown>;
    const returnPromptPath = ((meta.return as Record<string, unknown>).promptPath) as string;
    const returnPrompt = await readFile(returnPromptPath, "utf8");
    expect(returnPrompt).toContain("`````text");
    expect(returnPrompt).toContain("````\ninside answer\n````");
    expect(returnPrompt).toMatch(/`````text[\s\S]*````\ninside answer\n````[\s\S]*`````/);
  });

  it("refuses to overwrite an existing run ledger for the same run id", async () => {
    const calls: string[] = [];
    const client = fakeClient(calls);
    const dir = await mkdtemp(join(tmpdir(), "pro-review-duplicate-"));
    const zipPath = join(dir, "review.zip");
    const outputPath = join(dir, "answer.md");
    await writeFile(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));

    const options = {
      zipPath,
      prompt: "Review now.",
      submit: true,
      outputPath,
      runId: "run-duplicate",
      format: "markdown" as const,
      timeoutMs: 120000,
      stableMs: 1500
    };

    await expect(runProReview(client, options)).resolves.toMatchObject({ ok: true });
    await expect(runProReview(client, options)).rejects.toThrow(/ledger already exists/);
  });
});

function fakeClient(calls: string[]): ProReviewCliClient {
  return {
    proReview: {
      dryRun: async args => {
        calls.push(`dryRun:${args.zipPath}:${args.prompt}`);
        expect(args.mode).toEqual({ model: "Pro", effort: "拡張" });
        return ok({ dryRun: true });
      },
      submitAndRead: async (args: ProReviewWorkflowArgs & { autoSubmit: true }) => {
        calls.push(`submit:${args.zipPath}:${args.prompt}:${args.response?.timeoutMs}:${args.response?.stableMs}`);
        expect(args.autoSubmit).toBe(true);
        if (args.runId === "run-123") {
          expect(args.mode).toEqual({ model: "GPT-5", effort: "Thinking" });
          expect(args.response?.maxChars).toBe(2000);
        }
        if (args.runId === "run-fenced") {
          return ok({ text: "answer before\n````\ninside answer\n````\nafter", source: "clipboard", format: "markdown" });
        }
        return ok({ text: "answer text", source: "clipboard", format: "markdown" });
      }
    }
  };
}

function ok(data: unknown): CommandResult<unknown> {
  return {
    ok: true,
    status: "ok",
    data,
    warnings: [],
    context: { timestamp: "2026-06-09T00:00:00.000Z" }
  };
}

function sha256Prompt(text: string): string {
  return createHash("sha256").update(normalizePromptForHash(text)).digest("hex");
}
