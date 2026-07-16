import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { attachChatGPTBrowser } from "../browser/attach.js";
import { inspectConfiguration } from "../commands/configuration.js";
import {
  detectExperienceFromSnapshot,
  readSurfaceSnapshot
} from "../commands/experience.js";
import {
  BROWSER_BRIDGE_REMEDIATION,
  BROWSER_BRIDGE_UNAVAILABLE_MESSAGE,
  toCommandResult
} from "../errors.js";
import type {
  BrowserLike,
  ConfigurationInspectionData,
  ExistingTabPolicy,
  RuntimeEnv,
  SurfaceProfileFixture,
  SurfaceProfileSupportState
} from "../types.js";

const CHATGPT_HOME = "https://chatgpt.com/";
const DEFAULT_PROVENANCE = "Read-only sanitized capture from visible ChatGPT controls; review before committing.";

type CaptureRuntime = {
  agent?: unknown;
  browser?: BrowserLike;
};

type CaptureOptions = {
  id: string;
  out: string;
  locale?: string;
  region: string;
  accountScope: string;
  planScope: string;
  workspaceScope: string;
  supportState: SurfaceProfileSupportState;
  provenance: string;
  tabId?: string;
  ifMissing: NonNullable<ExistingTabPolicy["ifMissing"]>;
};

class UsageError extends Error {
  constructor(message: string, readonly exitCode = 2) {
    super(message);
    this.name = "UsageError";
  }
}

const USAGE = [
  "Usage:",
  "  npm run capture:surface-profile -- --id work-basic-en",
  "  npm run capture:surface-profile -- --id chat-simplified-de --locale de-DE --out ../../outputs/surface-profiles/chat-simplified-de.json",
  "",
  "Options:",
  "  --id               Required normalized profile id.",
  "  --out              Draft JSON path. Defaults under ../../outputs/surface-profiles/.",
  "  --locale           Known BCP47 locale; otherwise reads documentElement.lang.",
  "  --region           Normalized supplied region group. Default: not-recorded.",
  "  --account-scope    Normalized supplied account group. Default: not-recorded.",
  "  --plan-scope       Normalized supplied plan group. Default: not-recorded.",
  "  --workspace-scope  Normalized supplied workspace group. Default: not-recorded.",
  "  --support-state    current|compatibility|unverified|retired. Default: unverified.",
  "  --provenance       Non-private provenance note.",
  "  --tab-id           Claim an exact already-open ChatGPT tab.",
  "  --if-missing       block|open|create. Default: block.",
  "",
  "The capture is read-only with respect to ChatGPT configuration. It opens and",
  "closes visible menus, writes a sanitized draft locally, and never records",
  "prompts, responses, sidebar titles, account names, cookies, or network data."
].join("\n");

export async function main(
  argv = process.argv.slice(2),
  runtime: CaptureRuntime = globalThis as CaptureRuntime
): Promise<number> {
  let options: CaptureOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.log(error.message);
      return error.exitCode;
    }
    throw error;
  }

  if ((runtime.agent === undefined || runtime.agent === null) && runtime.browser === undefined) {
    console.log(JSON.stringify({
      ok: false,
      status: "blocked",
      blocker: {
        kind: "browser_bridge_unavailable",
        code: "codex_chrome_bridge_unavailable",
        message: BROWSER_BRIDGE_UNAVAILABLE_MESSAGE,
        remediation: BROWSER_BRIDGE_REMEDIATION
      }
    }, null, 2));
    return 2;
  }

  try {
    const env: RuntimeEnv = {};
    if (runtime.agent !== undefined && runtime.agent !== null) env.agent = runtime.agent;
    if (runtime.browser !== undefined) env.browser = runtime.browser;

    const attached = await attachChatGPTBrowser(env, {
      existingTab: {
        target: options.tabId === undefined
          ? { type: "selected", host: "chatgpt" }
          : { type: "tabId", tabId: options.tabId },
        ifMissing: options.ifMissing,
        ifMultiple: "first",
        requireChatGPT: true
      },
      url: CHATGPT_HOME
    });
    env.page = attached.page;

    const snapshot = await readSurfaceSnapshot(attached.page);
    const detected = detectExperienceFromSnapshot(snapshot);
    const inspectionResult = await inspectConfiguration(env, { includeOptions: true });
    if (!inspectionResult.ok || inspectionResult.data === undefined) {
      console.log(JSON.stringify(inspectionResult, null, 2));
      return 1;
    }

    const locale = options.locale ?? await readDocumentLocale(attached.page) ?? "und";
    const profile = buildSurfaceProfileDraft(options, locale, snapshot, detected, inspectionResult.data);
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, `${JSON.stringify(profile, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(JSON.stringify({
      ok: true,
      status: "ok",
      path: options.out,
      id: profile.id,
      experience: profile.expected.experience,
      selectorProfile: profile.expected.selectorProfile,
      supportState: profile.supportState
    }, null, 2));
    return 0;
  } catch (error) {
    console.log(JSON.stringify(toCommandResult(error), null, 2));
    return 1;
  }
}

export function buildSurfaceProfileDraft(
  options: Pick<
    CaptureOptions,
    "id" | "region" | "accountScope" | "planScope" | "workspaceScope" | "supportState" | "provenance"
  >,
  locale: string,
  snapshot: Awaited<ReturnType<typeof readSurfaceSnapshot>>,
  detected: ReturnType<typeof detectExperienceFromSnapshot>,
  inspection: ConfigurationInspectionData,
  observedAt = new Date().toISOString().slice(0, 10)
): SurfaceProfileFixture {
  const activeEntries = Object.entries(inspection.active)
    .filter((entry): entry is [keyof ConfigurationInspectionData["active"], string] =>
      typeof entry[1] === "string"
    );
  const axisRows = inspection.experience === "work"
    ? activeEntries.map(([axis, value]) => ({
        axis,
        label: `${titleCase(axis)} ${value}`,
        value
      }))
    : [];
  const openerLabel = inspection.experience === "chat"
    ? inspection.active.intelligence ?? inspection.active.effort
    : undefined;
  const menuItems = Object.values(inspection.options)
    .flatMap(optionsForAxis => optionsForAxis ?? [])
    .map(option => ({
      label: option.label,
      normalized: option.id,
      role: option.hasSubmenu === true ? "menuitem" : "menuitemradio",
      checked: option.selected,
      ...(option.hasSubmenu === undefined ? {} : { hasPopup: option.hasSubmenu })
    }));
  const safeComposerLabels = dedupeBounded(
    detected.evidence
      .filter(item => item.source === "composer")
      .map(item => item.label),
    16
  );
  const safeMainControls = dedupeBounded([
    ...axisRows.map(row => row.label),
    ...(openerLabel === undefined ? [] : [openerLabel]),
    ...menuItems.map(item => item.label),
    ...(inspection.selectorProfile === "work_advanced_v1" ? ["Advanced"] : [])
  ], 80);

  return {
    schemaVersion: "chatgpt.browser_control.surface_profile.v1",
    id: options.id,
    observedAt,
    provenance: options.provenance,
    locale,
    region: options.region,
    accountScope: options.accountScope,
    planScope: options.planScope,
    workspaceScope: options.workspaceScope,
    supportState: options.supportState,
    snapshot: {
      url: sanitizeChatGPTUrl(snapshot.url),
      composerLabels: safeComposerLabels,
      mainControls: safeMainControls,
      mainText: detected.evidence
        .filter(item => item.source === "heading")
        .map(item => item.label)
        .join(" ")
        .slice(0, 2000)
    },
    panel: {
      ...(openerLabel === undefined ? {} : { openerLabel }),
      axisRows,
      advancedVisible: inspection.selectorProfile === "work_advanced_v1"
    },
    menuItems,
    expected: {
      experience: detected.experience,
      selectorProfile: inspection.selectorProfile,
      availableAxes: inspection.availableAxes,
      active: inspection.active
    }
  };
}

export function parseArgs(argv: readonly string[]): CaptureOptions {
  let id: string | undefined;
  let out: string | undefined;
  let locale: string | undefined;
  let region = "not-recorded";
  let accountScope = "not-recorded";
  let planScope = "not-recorded";
  let workspaceScope = "not-recorded";
  let supportState: SurfaceProfileSupportState = "unverified";
  let provenance = DEFAULT_PROVENANCE;
  let tabId: string | undefined;
  let ifMissing: NonNullable<ExistingTabPolicy["ifMissing"]> = "block";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    switch (arg) {
      case "--help":
      case "-h":
        throw new UsageError(USAGE, 0);
      case "--id":
        id = requiredValue(argv, ++index, arg);
        break;
      case "--out":
        out = requiredValue(argv, ++index, arg);
        break;
      case "--locale":
        locale = requiredValue(argv, ++index, arg);
        break;
      case "--region":
        region = requiredValue(argv, ++index, arg);
        break;
      case "--account-scope":
        accountScope = requiredValue(argv, ++index, arg);
        break;
      case "--plan-scope":
        planScope = requiredValue(argv, ++index, arg);
        break;
      case "--workspace-scope":
        workspaceScope = requiredValue(argv, ++index, arg);
        break;
      case "--support-state":
        supportState = parseSupportState(requiredValue(argv, ++index, arg));
        break;
      case "--provenance":
        provenance = requiredValue(argv, ++index, arg);
        break;
      case "--tab-id":
        tabId = requiredValue(argv, ++index, arg);
        break;
      case "--if-missing":
        ifMissing = parseIfMissing(requiredValue(argv, ++index, arg));
        break;
      default:
        throw new UsageError(`Unknown argument: ${arg}\n\n${USAGE}`);
    }
  }

  if (id === undefined) {
    throw new UsageError(`--id is required.\n\n${USAGE}`);
  }
  for (const [field, value] of Object.entries({
    id,
    region,
    accountScope,
    planScope,
    workspaceScope
  })) {
    assertNormalizedSlug(value, `--${field.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`);
  }

  const defaultOut = resolve(
    process.cwd(),
    "..",
    "..",
    "outputs",
    "surface-profiles",
    `${new Date().toISOString().slice(0, 10)}-${id}.json`
  );
  return {
    id,
    out: resolve(out ?? defaultOut),
    ...(locale === undefined ? {} : { locale }),
    region,
    accountScope,
    planScope,
    workspaceScope,
    supportState,
    provenance,
    ...(tabId === undefined ? {} : { tabId }),
    ifMissing
  };
}

async function readDocumentLocale(page: NonNullable<RuntimeEnv["page"]>): Promise<string | undefined> {
  if (page.evaluate === undefined) return undefined;
  return page.evaluate(() => document.documentElement.lang || undefined).catch(() => undefined);
}

function sanitizeChatGPTUrl(value: string): string {
  const url = new URL(value || CHATGPT_HOME, CHATGPT_HOME);
  url.search = "";
  url.hash = "";
  if (/^\/c\/[^/]+/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/^\/c\/[^/]+/, "/c/sanitized");
  }
  return `${url.origin}${url.pathname}`;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function dedupeBounded(values: readonly string[], limit: number): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean))).slice(0, limit);
}

function requiredValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`${flag} requires a value.`);
  }
  return value;
}

function parseSupportState(value: string): SurfaceProfileSupportState {
  if (["current", "compatibility", "unverified", "retired"].includes(value)) {
    return value as SurfaceProfileSupportState;
  }
  throw new UsageError(`Invalid --support-state: ${value}`);
}

function parseIfMissing(value: string): NonNullable<ExistingTabPolicy["ifMissing"]> {
  if (value === "block" || value === "open" || value === "create") return value;
  throw new UsageError(`Invalid --if-missing: ${value}`);
}

function assertNormalizedSlug(value: string, flag: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
    throw new UsageError(`${flag} must be a normalized lowercase slug without private names.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
