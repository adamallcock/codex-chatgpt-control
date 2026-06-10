import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resultError, resultOk } from "../errors.js";
import { redactReportValue } from "../safety/report-redaction.js";
import type { CommandResult, RuntimeEnv } from "../types.js";
import { contextFromPage } from "./context.js";

export type RunReportOptions = {
  enabled?: boolean;
  destDir?: string;
  basename?: string;
  includeContent?: boolean;
  maxPreviewChars?: number;
};

export type RunReportData = {
  path: string;
  bytes: number;
  includeContent: boolean;
};

export async function createRunReport(
  env: RuntimeEnv,
  result: CommandResult<unknown>,
  options: RunReportOptions = {}
): Promise<CommandResult<RunReportData>> {
  try {
    const destDir = options.destDir ?? "reports/runs";
    await mkdir(destDir, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const safeBase = sanitizeBasename(options.basename ?? "chatgpt-run-report");
    const path = join(destDir, `${stamp}-${safeBase}.json`);
    const includeContent = options.includeContent === true;
    const summary = redactReportValue({
      ok: result.ok,
      status: result.status,
      warnings: result.warnings,
      blocker: result.blocker,
      error: result.error,
      context: result.context,
      reportPath: result.reportPath
    }, options);
    const report = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      includeContent,
      summary,
      steps: result.steps?.map(step => ({
        ...step,
        dataPreview: redactReportValue(step.dataPreview, options)
      })),
      data: redactReportValue(result.data, options)
    };
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const saved = await stat(path);
    return resultOk({ path, bytes: saved.size, includeContent }, await contextFromPage(env.page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(env.page));
  }
}

function sanitizeBasename(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "chatgpt-run-report";
}
