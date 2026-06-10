import { localeLabels, anyLabelPattern } from "../dom/locale-labels.js";
import { resultError, resultOk } from "../errors.js";
import type {
  BootstrapArgs,
  CommandResult,
  FileChooserLike,
  LocatorLike,
  PageLike,
  ProjectSource,
  ProjectSourcesAddArgs,
  ProjectSourcesAddData,
  ProjectSourcesAddPlanData,
  ProjectSourcesListArgs,
  ProjectSourcesListData,
  ProjectSourcesPlanAddArgs,
  ProjectSourcesUrl,
  ProjectSourceUploadBatch,
  RuntimeEnv
} from "../types.js";
import { contextFromPage } from "./context.js";
import { preflightFiles } from "./files.js";
import { bootstrap } from "./session.js";

const CHATGPT_ORIGIN = "https://chatgpt.com";
const DEFAULT_PROJECT_SOURCE_BATCH_SIZE = 10;
const PROJECT_SOURCE_CANDIDATE_LIMIT = 20;

type SafeCandidate = NonNullable<NonNullable<CommandResult["blocker"]>["candidates"]>[number];

type ProjectSourcesSnapshot = {
  sources: ProjectSource[];
  uiPresent: boolean;
  candidates: SafeCandidate[];
};

export function normalizeProjectSourcesUrl(value: string): ProjectSourcesUrl {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("ChatGPT Project URL must be an absolute URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("ChatGPT Project URL must use https.");
  }
  if (parsed.hostname !== "chatgpt.com") {
    throw new Error("ChatGPT Project URL must be on chatgpt.com.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const gIndex = segments.indexOf("g");
  const handle = gIndex >= 0 ? segments[gIndex + 1] : undefined;
  if (handle === undefined || !handle.startsWith("g-p-")) {
    throw new Error("ChatGPT Project URL must include a Project path such as /g/g-p-.../project.");
  }

  const { projectId, projectSlug } = splitProjectHandle(handle);
  const normalized: ProjectSourcesUrl = {
    projectId,
    url: `${CHATGPT_ORIGIN}/g/${handle}/project`
  };
  if (projectSlug !== undefined) {
    normalized.projectSlug = projectSlug;
  }
  return normalized;
}

export async function buildProjectSourceAddPlan(
  env: RuntimeEnv,
  args: ProjectSourcesPlanAddArgs
): Promise<CommandResult<ProjectSourcesAddPlanData>> {
  let project: ProjectSourcesUrl;
  try {
    project = normalizeProjectSourcesUrl(args.projectUrl);
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)));
  }

  const preflightArgs: Parameters<typeof preflightFiles>[1] = { paths: args.files };
  if (args.maxBytesPerFile !== undefined) preflightArgs.maxBytesPerFile = args.maxBytesPerFile;
  if (args.maxTotalBytes !== undefined) preflightArgs.maxTotalBytes = args.maxTotalBytes;
  const preflight = await preflightFiles(env, preflightArgs);
  if (!preflight.ok || preflight.data === undefined) {
    return preflight as CommandResult<ProjectSourcesAddPlanData>;
  }

  const files = preflight.data.files.map((file, index) => ({
    ...file,
    displayPath: args.files[index] ?? file.path
  }));
  const batchSize = normalizedBatchSize(args.batchSize);
  const batches: ProjectSourceUploadBatch[] = [];
  for (let offset = 0; offset < files.length; offset += batchSize) {
    const batchFiles = files.slice(offset, offset + batchSize);
    batches.push({
      index: batches.length,
      files: batchFiles,
      totalBytes: batchFiles.reduce((sum, file) => sum + file.bytes, 0)
    });
  }

  return resultOk({
    ...project,
    projectUrl: project.url,
    operation: "append_add",
    dryRun: true,
    files,
    batches,
    totalBytes: preflight.data.totalBytes
  }, { timestamp: preflight.context.timestamp }, preflight.warnings);
}

export async function listProjectSources(
  env: RuntimeEnv,
  args: ProjectSourcesListArgs
): Promise<CommandResult<ProjectSourcesListData>> {
  const opened = await openProjectSourcesUI(env, args);
  if (!opened.ok || opened.data === undefined) {
    return opened as CommandResult<ProjectSourcesListData>;
  }

  return readProjectSourcesFromCurrentPage(env, opened.data, "project_sources_list_unavailable");
}

export async function addProjectSources(
  env: RuntimeEnv,
  args: ProjectSourcesAddArgs
): Promise<CommandResult<ProjectSourcesAddData | ProjectSourcesAddPlanData>> {
  const plan = await buildProjectSourceAddPlan(env, args);
  if (!plan.ok || plan.data === undefined) {
    return plan as unknown as CommandResult<ProjectSourcesAddData | ProjectSourcesAddPlanData>;
  }

  if (args.confirmMutation !== true) {
    return {
      ok: false,
      status: "needs_confirmation",
      data: plan.data,
      warnings: plan.warnings,
      blocker: {
        kind: "confirmation",
        code: "project_sources_add_confirmation_required",
        fieldPath: "confirmMutation",
        message: "Adding files to a ChatGPT Project Sources list mutates visible project state. Re-run with confirmMutation: true after user approval.",
        remediation: [
          {
            label: "Confirm Project Sources add",
            instruction: "Ask the user to confirm this append-only Project Sources add operation for the listed local file names.",
            userActionRequired: true
          }
        ],
        resumable: true
      },
      context: plan.context
    };
  }

  const opened = await openProjectSourcesUI(env, args);
  if (!opened.ok || opened.data === undefined) {
    return opened as unknown as CommandResult<ProjectSourcesAddData | ProjectSourcesAddPlanData>;
  }

  const before = await readProjectSourcesFromCurrentPage(env, opened.data, "project_sources_list_unavailable");
  if (!before.ok || before.data === undefined) {
    return before as unknown as CommandResult<ProjectSourcesAddData | ProjectSourcesAddPlanData>;
  }

  const page = env.page;
  if (page === undefined) {
    return resultError(new Error("No active ChatGPT Project page is available for Project Sources upload."), opened.context);
  }

  for (const batch of plan.data.batches) {
    const upload = await uploadProjectSourceBatch(page, batch, args.timeoutMs ?? 120000);
    if (!upload.ok) {
      return upload as CommandResult<ProjectSourcesAddData>;
    }
  }

  await page.waitForTimeout?.(1000);
  const after = await readProjectSourcesFromCurrentPage(env, opened.data, "project_sources_after_add_unavailable");
  if (!after.ok || after.data === undefined) {
    return after as unknown as CommandResult<ProjectSourcesAddData | ProjectSourcesAddPlanData>;
  }

  return resultOk({
    ...plan.data,
    dryRun: false,
    before: before.data.sources,
    after: after.data.sources,
    added: diffProjectSourceNames(before.data.sources, after.data.sources)
  }, await contextFromPage(page), [...plan.warnings, ...before.warnings, ...after.warnings]);
}

export function diffProjectSourceNames(before: ProjectSource[], after: ProjectSource[]): ProjectSource[] {
  const remaining = new Map<string, number>();
  for (const source of before) {
    const key = sourceNameKey(source.name);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const added: ProjectSource[] = [];
  for (const source of after) {
    const key = sourceNameKey(source.name);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
    } else {
      added.push(source);
    }
  }
  return added;
}

export function extractProjectSourcesFromHtml(html: string): ProjectSource[] {
  const sources: ProjectSource[] = [];
  const sourceBlockPattern = /<(?:div|li|article|tr)\b(?<attrs>[^>]*(?:data-testid|aria-label|class)=["'][^"']*source[^"']*["'][^>]*)>(?<body>[\s\S]*?)<\/(?:div|li|article|tr)>/gi;

  for (const match of html.matchAll(sourceBlockPattern)) {
    const body = match.groups?.body ?? "";
    const texts = extractChildTexts(body, ["span", "td", "button", "a"]);
    const name = texts.map(sourceNameFromCandidateText).find((text): text is string => text !== undefined);
    if (name === undefined) {
      continue;
    }
    const statusText = texts.find(text => text !== name && normalizeProjectSourceStatus(text) !== "unknown");
    sources.push({ name, status: normalizeProjectSourceStatus(statusText ?? "") });
  }

  sources.push(...extractSourcesSectionRowsFromHtml(html));

  return dedupeAdjacentSources(sources);
}

export function safeProjectSourceCandidatesFromHtml(html: string): SafeCandidate[] {
  const candidates: SafeCandidate[] = [];
  const interactivePattern = /<(button|a)\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/\1>/gi;

  for (const match of html.matchAll(interactivePattern)) {
    const tag = match[1]?.toLowerCase();
    const attrs = match.groups?.attrs ?? "";
    const text = normalizeText(stripTags(match.groups?.body ?? ""));
    const label = normalizeText(attr(attrs, "aria-label") ?? attr(attrs, "title") ?? text);
    if (label.length === 0 || label.length > 120) {
      continue;
    }
    const roleAttr = attr(attrs, "role");
    const role = roleAttr ?? (tag === "a" ? "link" : "button");
    candidates.push({ label, role });
  }

  return dedupeCandidates(candidates).slice(0, PROJECT_SOURCE_CANDIDATE_LIMIT);
}

async function openProjectSourcesUI(
  env: RuntimeEnv,
  args: ProjectSourcesListArgs | ProjectSourcesAddArgs
): Promise<CommandResult<ProjectSourcesUrl>> {
  let project: ProjectSourcesUrl;
  try {
    project = normalizeProjectSourcesUrl(args.projectUrl);
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)));
  }

  if (env.page === undefined) {
    const boot = await bootstrap(env, bootstrapArgsForProject(project.url, args));
    if (!boot.ok) {
      return boot as unknown as CommandResult<ProjectSourcesUrl>;
    }
  }

  const page = env.page;
  if (page === undefined) {
    return resultError(new Error("No active ChatGPT page is available."), { timestamp: new Date().toISOString() });
  }

  try {
    const currentUrl = await Promise.resolve(page.url?.()).catch(() => undefined);
    if (!sameProjectPageUrl(currentUrl, project.url) && typeof page.goto === "function") {
      await page.goto(project.url, { waitUntil: "domcontentloaded", timeout: args.timeoutMs ?? 30000 });
      await page.waitForTimeout?.(500);
    }
    await clickSourcesTabIfAvailable(page, args.timeoutMs ?? 30000);
    return resultOk(project, await contextFromPage(page));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)), await contextFromPage(page));
  }
}

function bootstrapArgsForProject(
  url: string,
  args: ProjectSourcesListArgs | ProjectSourcesAddArgs
): BootstrapArgs {
  const boot: BootstrapArgs = { url };
  if (args.preferExistingTab !== undefined) {
    boot.preferExistingTab = args.preferExistingTab;
  }

  if (args.existingTab === true) {
    boot.existingTab = {
      target: { type: "url", url },
      ifMissing: "block",
      ifMultiple: "block",
      requireChatGPT: true
    };
  } else if (args.existingTab !== undefined) {
    boot.existingTab = args.existingTab;
  }

  return boot;
}

async function readProjectSourcesFromCurrentPage(
  env: RuntimeEnv,
  project: ProjectSourcesUrl,
  driftCode: string
): Promise<CommandResult<ProjectSourcesListData>> {
  const page = env.page;
  if (page === undefined) {
    return resultError(new Error("No active ChatGPT Project page is available for Project Sources listing."), project);
  }

  const snapshot = await readProjectSourcesSnapshot(page);
  if (snapshot.uiPresent) {
    return resultOk({ ...project, sources: snapshot.sources }, await contextFromPage(page));
  }

  return {
    ok: false,
    status: "unsupported",
    warnings: [],
    blocker: {
      kind: "selector_drift",
      code: driftCode,
      message: "The visible ChatGPT Project Sources UI could not be identified without reading source contents.",
      candidates: snapshot.candidates,
      resumable: true
    },
    context: await contextFromPage(page)
  };
}

async function readProjectSourcesSnapshot(page: PageLike): Promise<ProjectSourcesSnapshot> {
  if (typeof page.evaluate === "function") {
    try {
      const raw = await page.evaluate(() => {
        const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
        const textOf = (element: Element) => normalize((element as HTMLElement).innerText ?? element.textContent ?? "");
        const statusFor = (text: string) => {
          if (/\b(ready|added|available|synced)\b/i.test(text)) return "ready";
          if (/\b(processing|uploading|adding|pending|in progress)\b/i.test(text)) return "processing";
          if (/\b(failed|error|unsupported)\b/i.test(text)) return "failed";
          return "unknown";
        };
        const excludedLabel = (text: string) => /^(ready|processing|uploading|failed|error|add sources?|sources?|newest|all|source actions)$/i.test(text)
          || /^(sort|filter) sources?:/i.test(text);
        const sourceNameFromCandidate = (text: string) => {
          const normalized = normalize(text).replace(/\s+(Document|File|PDF|Image|Spreadsheet|Text|Code|CSV|Markdown)\s+·.*$/i, "");
          if (normalized.length === 0 || normalized.length > 160 || excludedLabel(normalized)) return undefined;
          return normalized;
        };
        const sourceNodes = Array.from(document.querySelectorAll([
          "li[data-testid*='source' i]",
          "article[data-testid*='source' i]",
          "tr[data-testid*='source' i]",
          "div[data-testid*='source' i]",
          "li[aria-label*='source' i]",
          "article[aria-label*='source' i]",
          "tr[aria-label*='source' i]",
          "div[aria-label*='source' i]",
          "li[class*='source' i]",
          "article[class*='source' i]",
          "tr[class*='source' i]",
          "div[class*='source' i]"
        ].join(", "))).filter(node => {
          const tag = node.tagName.toLowerCase();
          const role = node.getAttribute("role") ?? "";
          return tag !== "button"
            && tag !== "a"
            && !/^(button|tab|menuitem|option|dialog|menu)$/i.test(role)
            && node.closest("[role='dialog'], [role='menu']") === null;
        });
        const sourcesFromNodes = sourceNodes.flatMap(node => {
          const children = Array.from(node.querySelectorAll("span, td, button, a"))
            .map(textOf)
            .filter(Boolean);
          const name = children.map(sourceNameFromCandidate).find(Boolean);
          if (!name) return [];
          const statusText = children.find(child => child !== name && statusFor(child) !== "unknown") ?? "";
          return [{ name, status: statusFor(statusText) }];
        });
        const sourcesFromSection = Array.from(document.querySelectorAll("section[aria-label]"))
          .filter(section => /sources?/i.test(section.getAttribute("aria-label") ?? "") && section.closest("[role='dialog'], [role='menu']") === null)
          .flatMap(section => Array.from(section.querySelectorAll("[aria-label], button")).flatMap(element => {
            const role = element.getAttribute("role") ?? "";
            if (/^(tab|menuitem|option)$/i.test(role)) return [];
            const aria = normalize(element.getAttribute("aria-label") ?? "");
            const text = textOf(element);
            const name = sourceNameFromCandidate(aria) ?? sourceNameFromCandidate(text);
            if (!name) return [];
            const status = statusFor(text);
            return [{ name, status }];
          }));
        const sources = [...sourcesFromNodes, ...sourcesFromSection];
        const candidates = Array.from(document.querySelectorAll("[role='tab'], button, a"))
          .map(element => {
            const label = normalize(element.getAttribute("aria-label") ?? element.getAttribute("title") ?? textOf(element));
            const role = element.getAttribute("role") ?? (element.tagName.toLowerCase() === "a" ? "link" : "button");
            return { label, role };
          })
          .filter(candidate => candidate.label.length > 0 && candidate.label.length <= 120)
          .slice(0, 20);
        const activeSourceTab = Array.from(document.querySelectorAll("[role='tab'], button"))
          .some(element => {
            const label = textOf(element) || element.getAttribute("aria-label") || "";
            return /sources?/i.test(label) && element.getAttribute("aria-selected") === "true";
          });
        const emptyState = /\bno sources\b/i.test(document.body?.innerText ?? "");
        return {
          sources,
          uiPresent: sources.length > 0 || activeSourceTab || emptyState,
          candidates
        };
      });
      return normalizeSnapshot(raw);
    } catch {
      // Fall through to HTML extraction.
    }
  }

  if (typeof page.content === "function") {
    const html = await page.content();
    const sources = extractProjectSourcesFromHtml(html);
    const activeSourceTab = /role=["']tab["'][^>]*aria-selected=["']true["'][^>]*>\s*Sources\s*</i.test(html)
      || /aria-label=["']Sources["'][^>]*aria-selected=["']true["']/i.test(html);
    const emptyState = /\bno sources\b/i.test(stripInteractiveHtml(html));
    return {
      sources,
      uiPresent: sources.length > 0 || activeSourceTab || emptyState,
      candidates: safeProjectSourceCandidatesFromHtml(html)
    };
  }

  return { sources: [], uiPresent: false, candidates: [] };
}

function normalizeSnapshot(raw: unknown): ProjectSourcesSnapshot {
  if (raw === null || typeof raw !== "object") {
    return { sources: [], uiPresent: false, candidates: [] };
  }
  const record = raw as Record<string, unknown>;
  const sources = Array.isArray(record.sources)
    ? record.sources.flatMap(item => isRecord(item) && typeof item.name === "string"
      ? [{ name: normalizeText(item.name), status: normalizeProjectSourceStatus(String(item.status ?? "")) }]
      : [])
    : [];
  const candidates = Array.isArray(record.candidates)
    ? dedupeCandidates(record.candidates.flatMap(item => {
      if (!isRecord(item) || typeof item.label !== "string") {
        return [];
      }
      const candidate: SafeCandidate = { label: normalizeText(item.label) };
      if (typeof item.role === "string") {
        candidate.role = item.role;
      }
      return [candidate];
    }))
    : [];
  return {
    sources: dedupeAdjacentSources(sources.filter(source => source.name.length > 0)),
    uiPresent: record.uiPresent === true,
    candidates: candidates.slice(0, PROJECT_SOURCE_CANDIDATE_LIMIT)
  };
}

async function uploadProjectSourceBatch(
  page: PageLike,
  batch: ProjectSourceUploadBatch,
  timeoutMs: number
): Promise<CommandResult<unknown>> {
  const paths = batch.files.map(file => file.path);

  try {
    const directInput = page.locator?.("input[type='file']");
    if (directInput !== undefined && typeof directInput.setInputFiles === "function" && await locatorCount(directInput) > 0) {
      await directInput.setInputFiles(paths);
      return resultOk({ files: batch.files.map(file => ({ name: file.name, bytes: file.bytes })) }, await contextFromPage(page));
    }

    if (typeof page.waitForEvent !== "function") {
      throw new Error("The active Project Sources page does not expose file chooser events.");
    }

    let chooserPromise = waitForFileChooser(page, timeoutMs);
    await clickProjectSourceControl(page, localeLabels.projectSourcesAddSource, "button", timeoutMs);
    const opened = await raceFileChooserOpen(chooserPromise, page, 300);
    if (!opened) {
      chooserPromise = waitForFileChooser(page, timeoutMs);
      await clickProjectSourceControl(page, localeLabels.projectSourcesUploadFiles, "button", timeoutMs);
    }
    const chooser = await chooserPromise;
    await chooser.setFiles(paths);
    return resultOk({ files: batch.files.map(file => ({ name: file.name, bytes: file.bytes })) }, await contextFromPage(page));
  } catch (error) {
    return {
      ok: false,
      status: "blocked",
      warnings: [],
      blocker: {
        kind: "permission",
        code: "project_sources_upload_unavailable",
        message: `Project Sources file upload could not be completed through visible file chooser controls: ${error instanceof Error ? error.message : String(error)}`,
        remediation: [
          {
            label: "Use visible Project Sources UI",
            instruction: "Open the Project Sources tab, click Add source, choose the local file upload option, and retry after the browser file chooser is available.",
            userActionRequired: true
          }
        ],
        resumable: true
      },
      context: await contextFromPage(page)
    };
  }
}

async function clickSourcesTabIfAvailable(page: PageLike, timeoutMs: number): Promise<void> {
  try {
    await clickProjectSourceControl(page, localeLabels.projectSourcesTab, "tab", timeoutMs);
  } catch {
    // Listing will report selector_drift with safe candidates if the tab is not discoverable.
  }
}

async function clickProjectSourceControl(
  page: PageLike,
  labels: readonly string[],
  role: "button" | "tab",
  timeoutMs: number
): Promise<void> {
  const locator = page.getByRole?.(role, { name: anyLabelPattern(labels) });
  if (locator !== undefined && await locatorCount(locator) > 0) {
    await (locator.first?.() ?? locator).click?.({ timeout: Math.min(timeoutMs, 10000) });
    await page.waitForTimeout?.(250);
    return;
  }

  const selector = labels
    .map(label => `button[aria-label*='${cssString(label)}'], [role='${role}'][aria-label*='${cssString(label)}']`)
    .join(", ");
  const fallback = page.locator?.(selector);
  if (fallback !== undefined && await locatorCount(fallback) > 0) {
    await (fallback.first?.() ?? fallback).click?.({ timeout: Math.min(timeoutMs, 10000) });
    await page.waitForTimeout?.(250);
    return;
  }

  throw new Error(`Project Sources ${role} was not available for labels: ${labels.join(", ")}`);
}

async function waitForFileChooser(page: PageLike, timeoutMs: number): Promise<FileChooserLike> {
  const rawChooser = await page.waitForEvent?.("filechooser", { timeout: timeoutMs, timeoutMs });
  if (rawChooser === null || typeof rawChooser !== "object" || typeof (rawChooser as FileChooserLike).setFiles !== "function") {
    throw new Error("Project Sources file chooser did not expose setFiles().");
  }
  return rawChooser as FileChooserLike;
}

async function raceFileChooserOpen(
  chooserPromise: Promise<FileChooserLike>,
  page: PageLike,
  waitMs: number
): Promise<boolean> {
  return Promise.race([
    chooserPromise.then(() => true, () => false),
    (page.waitForTimeout?.(waitMs) ?? new Promise(resolve => setTimeout(resolve, waitMs))).then(() => false)
  ]);
}

async function locatorCount(locator: LocatorLike): Promise<number> {
  if (typeof locator.count !== "function") {
    return 0;
  }
  return locator.count();
}

function normalizedBatchSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PROJECT_SOURCE_BATCH_SIZE;
  }
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_PROJECT_SOURCE_BATCH_SIZE;
}

function splitProjectHandle(handle: string): { projectId: string; projectSlug?: string } {
  const match = /^(g-p-[0-9a-f]{16,})(?:-(.+))?$/i.exec(handle);
  if (match === null) {
    return { projectId: handle };
  }
  const result: { projectId: string; projectSlug?: string } = { projectId: match[1]! };
  if (match[2] !== undefined && match[2].length > 0) {
    result.projectSlug = match[2];
  }
  return result;
}

function sameProjectPageUrl(current: string | undefined, expected: string): boolean {
  if (current === undefined) {
    return false;
  }
  try {
    const currentUrl = new URL(current);
    const expectedUrl = new URL(expected);
    return currentUrl.origin === expectedUrl.origin
      && trimTrailingSlash(currentUrl.pathname) === trimTrailingSlash(expectedUrl.pathname);
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function sourceNameKey(value: string): string {
  return normalizeText(value).toLocaleLowerCase();
}

function extractChildTexts(html: string, tags: string[]): string[] {
  const tagPattern = tags.join("|");
  const pattern = new RegExp(`<(${tagPattern})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  return Array.from(html.matchAll(pattern))
    .map(match => normalizeText(stripTags(match[2] ?? "")))
    .filter(Boolean);
}

function extractAttrValues(html: string, name: string): string[] {
  const pattern = new RegExp(`${name}=["']([^"']+)["']`, "gi");
  return Array.from(html.matchAll(pattern))
    .map(match => normalizeText(match[1] ?? ""))
    .filter(Boolean);
}

function looksLikeSourceName(text: string): boolean {
  return text.length > 0
    && text.length <= 160
    && !/^(ready|processing|uploading|failed|error|add sources?|sources?|newest|all|source actions)$/i.test(text)
    && !/^(sort|filter) sources?:/i.test(text);
}

function sourceNameFromCandidateText(text: string): string | undefined {
  const name = normalizeText(text)
    .replace(/\s+(Document|File|PDF|Image|Spreadsheet|Text|Code|CSV|Markdown)\s+·.*$/i, "");
  return looksLikeSourceName(name) ? name : undefined;
}

function extractSourcesSectionRowsFromHtml(html: string): ProjectSource[] {
  const sources: ProjectSource[] = [];
  const sectionPattern = /<section\b(?<attrs>[^>]*aria-label=["']Sources["'][^>]*)>(?<body>[\s\S]*?)<\/section>/gi;
  for (const match of html.matchAll(sectionPattern)) {
    const body = match.groups?.body ?? "";
    const texts = [
      ...extractAttrValues(body, "aria-label"),
      ...extractChildTexts(body, ["button"])
    ];
    for (const text of texts) {
      const name = sourceNameFromCandidateText(text);
      if (name !== undefined) {
        sources.push({ name, status: normalizeProjectSourceStatus(text) });
      }
    }
  }
  return dedupeAdjacentSources(sources);
}

function normalizeProjectSourceStatus(value: string): ProjectSource["status"] {
  if (/\b(ready|added|available|synced)\b/i.test(value)) return "ready";
  if (/\b(processing|uploading|adding|pending|in progress)\b/i.test(value)) return "processing";
  if (/\b(failed|error|unsupported)\b/i.test(value)) return "failed";
  return "unknown";
}

function dedupeAdjacentSources(sources: ProjectSource[]): ProjectSource[] {
  const deduped: ProjectSource[] = [];
  for (const source of sources) {
    const previous = deduped.at(-1);
    if (previous?.name === source.name && previous.status === source.status) {
      continue;
    }
    deduped.push(source);
  }
  return deduped;
}

function dedupeCandidates(candidates: SafeCandidate[]): SafeCandidate[] {
  const seen = new Set<string>();
  const deduped: SafeCandidate[] = [];
  for (const candidate of candidates) {
    const label = normalizeText(candidate.label);
    if (label.length === 0) {
      continue;
    }
    const role = candidate.role === undefined ? undefined : normalizeText(candidate.role);
    const key = `${role ?? ""}\0${label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const item: SafeCandidate = { label };
    if (role !== undefined && role.length > 0) {
      item.role = role;
    }
    deduped.push(item);
  }
  return deduped;
}

function attr(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}=["']([^"']+)["']`, "i");
  return pattern.exec(attrs)?.[1];
}

function stripInteractiveHtml(html: string): string {
  return html.replace(/<(button|a)\b[\s\S]*?<\/\1>/gi, " ");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
