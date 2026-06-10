import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { readSystemClipboard } from "../browser/clipboard.js";
import { readPageState } from "../browser/page-state.js";
import { localeLabels } from "../dom/locale-labels.js";
import { BROWSER_BRIDGE_REMEDIATION, resultOk } from "../errors.js";
import { explainCommandBlocker } from "../diagnostics/blockers.js";
import type { BootstrapArgs, CommandResult, ExistingTabPolicy, RuntimeEnv } from "../types.js";
import { contextFromPage } from "./context.js";
import type { RunReportOptions } from "./reports.js";
import { bootstrap } from "./session.js";

export type DoctorCheckName =
  | "bridge"
  | "login"
  | "upload"
  | "download"
  | "clipboard"
  | "modes"
  | "tools"
  | "selectors"
  | "existing_tab"
  | "artifacts"
  | "file_preflight"
  | "localization"
  | "reports";

export type CapabilityStatus = "ok" | "blocked" | "unsupported" | "unknown";

export type CapabilityCheck = {
  status: CapabilityStatus;
  message: string;
  remediation?: string[];
  code?: string;
  blockerKind?: string;
  nextCommand?: string;
  details?: Record<string, unknown>;
};

export type DoctorArgs = {
  check?: DoctorCheckName[];
  existingTab?: BootstrapArgs["existingTab"];
  files?: string[];
  report?: RunReportOptions;
};

export type DoctorReport = {
  ready: boolean;
  checks: Partial<Record<DoctorCheckName, CapabilityCheck>>;
};

const DEFAULT_CHECKS: DoctorCheckName[] = ["bridge", "login", "upload", "download", "clipboard", "modes", "tools", "selectors"];
const BOOTSTRAP_CHECKS = new Set<DoctorCheckName>(["bridge", "login", "upload", "download", "modes", "tools", "selectors"]);
const UPLOAD_REMEDIATION = [
  "Codex Settings > Computer Use > Chrome > Permissions > Uploads: set to Always allow, or add chatgpt.com to the allowed upload domains.",
  "Chrome chrome://extensions > Codex extension > Details: enable Allow access to file URLs."
];
const REQUIRED_LOCALE_KEYS = [
  "composerTextbox",
  "sendButton",
  "searchChatsButton",
  "searchChatsPlaceholder",
  "newChat",
  "addFilesButton",
  "addPhotosFilesMenuItem",
  "copyResponse",
  "download",
  "modeLabels",
  "signedInMarkers",
  "loginBlocker",
  "captchaBlocker",
  "rateLimitBlocker"
] as const;
const REQUIRED_TOOL_IDS = ["web_search", "deep_research", "create_image"] as const;

export async function doctor(env: RuntimeEnv, args: DoctorArgs = {}): Promise<CommandResult<DoctorReport>> {
  const wanted = args.check ?? DEFAULT_CHECKS;
  const checks: Partial<Record<DoctorCheckName, CapabilityCheck>> = {};
  const wantsExistingTab = wanted.includes("existing_tab");
  const existingTab = wantsExistingTab ? normalizeDoctorExistingTab(args.existingTab) : undefined;
  const boot = wantsExistingTab || wanted.some(check => BOOTSTRAP_CHECKS.has(check))
    ? await bootstrap(env, existingTab === undefined
      ? { preferExistingTab: true, timeoutMs: 30000 }
      : { existingTab, preferExistingTab: false, timeoutMs: 30000 })
    : undefined;

  for (const check of wanted) {
    switch (check) {
      case "bridge":
        checks.bridge = boot?.ok
          ? ok("Chrome bridge is available.")
          : bridgeCheck(boot);
        break;
      case "login":
        checks.login = await loginCheck(env, boot);
        break;
      case "upload":
        checks.upload = uploadCheck(env);
        break;
      case "download":
        checks.download = downloadCheck(env);
        break;
      case "clipboard":
        checks.clipboard = await clipboardCheck();
        break;
      case "modes":
        checks.modes = selectorCheck(env, "Mode/tool selection requires role/text selectors in the current ChatGPT page.");
        break;
      case "tools":
        checks.tools = selectorCheck(env, "Tool selection requires role/text selectors in the current ChatGPT page.");
        break;
      case "selectors":
        checks.selectors = selectorCheck(env, "Basic page selectors are available.");
        break;
      case "existing_tab":
        checks.existing_tab = existingTab === undefined || boot === undefined
          ? blocked("Existing-tab readiness was requested, but bootstrap was not initialized.")
          : existingTabCheck(existingTab, boot);
        break;
      case "artifacts":
        checks.artifacts = artifactsCheck(env);
        break;
      case "file_preflight":
        checks.file_preflight = filePreflightCheck(args);
        break;
      case "localization":
        checks.localization = localizationCheck(env);
        break;
      case "reports":
        checks.reports = await reportsCheck(args.report);
        break;
    }
  }

  const ready = Object.values(checks).every(check => check?.status === "ok" || check?.status === "unknown");
  return resultOk({ ready, checks }, await contextFromPage(env.page));
}

function bridgeCheck(boot: CommandResult<unknown> | undefined): CapabilityCheck {
  if (boot === undefined) {
    return unknown("Bridge readiness was not requested.");
  }
  if (boot.blocker?.kind === "browser_bridge_unavailable") {
    return withBlockerDetails(blocked(boot.blocker.message, bridgeRemediation(boot)), boot, "session.bootstrap");
  }

  if (boot.blocker?.kind === "login_required") {
    return ok("Chrome bridge is available; ChatGPT login is required before browser-control commands can continue.");
  }

  if (boot.blocker !== undefined) {
    return unknown(`Chrome bridge responded, but bootstrap is blocked by ${boot.blocker.kind}: ${boot.blocker.message}`);
  }

  return blocked(boot.error?.message ?? "Chrome bridge is unavailable.");
}

async function loginCheck(env: RuntimeEnv, boot: CommandResult<unknown> | undefined): Promise<CapabilityCheck> {
  if (boot !== undefined && !boot.ok && boot.blocker?.kind === "login_required") {
    return withBlockerDetails(
      blocked("ChatGPT login is required.", ["Ask the user to sign in to ChatGPT in Chrome, then retry."]),
      boot,
      "session.bootstrap"
    );
  }
  if (env.page === undefined) {
    return boot?.ok ? ok("Bootstrap completed; login appears usable.") : blocked("Cannot determine login because bootstrap failed.");
  }
  const state = await readPageState(env.page).catch(() => undefined);
  if (state?.blocker?.kind === "login_required") {
    return blocked("ChatGPT login is required.", ["Ask the user to sign in to ChatGPT in Chrome, then retry."]);
  }
  return state?.signedIn === true ? ok("ChatGPT appears signed in.") : unknown("Could not prove signed-in state from the visible page.");
}

function uploadCheck(env: RuntimeEnv): CapabilityCheck {
  const page = env.page;
  if (page === undefined) {
    return unknown("Upload readiness requires a bootstrapped ChatGPT page.", UPLOAD_REMEDIATION);
  }
  if (typeof page.waitForEvent !== "function" && typeof page.evaluate !== "function") {
    return blocked("The active browser page exposes no upload-capable file chooser or DOM fallback.", UPLOAD_REMEDIATION);
  }
  return unknown("Upload permissions can only be proven by a live attach attempt.", UPLOAD_REMEDIATION);
}

function downloadCheck(env: RuntimeEnv): CapabilityCheck {
  const page = env.page;
  if (page === undefined) return unknown("Download readiness requires a bootstrapped ChatGPT page.");
  return typeof page.waitForEvent === "function"
    ? ok("Browser download events are available.")
    : unsupported("The active browser page does not expose download events.");
}

async function clipboardCheck(): Promise<CapabilityCheck> {
  const value = await readSystemClipboard();
  return value === undefined
    ? unknown("System clipboard could not be read; response.copy will use DOM fallback if copy does not change.")
    : ok("System clipboard can be read.");
}

function selectorCheck(env: RuntimeEnv, message: string): CapabilityCheck {
  const page = env.page;
  if (page === undefined) return unknown("Selector readiness requires a bootstrapped ChatGPT page.");
  return typeof page.locator === "function" || typeof page.getByRole === "function"
    ? ok(message)
    : unsupported("The active page object does not expose locator or role selector helpers.");
}

function existingTabCheck(existingTab: ExistingTabPolicy, boot: CommandResult<unknown>): CapabilityCheck {
  if (boot.ok) {
    return ok("Existing ChatGPT tab target can be claimed.", {
      target: existingTab.target,
      tabId: boot.context.tabId,
      url: boot.context.url,
      conversationId: boot.context.conversationId
    });
  }

  return withBlockerDetails(
    blocked(boot.blocker?.message ?? boot.error?.message ?? "Existing ChatGPT tab target could not be claimed."),
    boot,
    "session.bootstrap"
  );
}

function normalizeDoctorExistingTab(existingTab: BootstrapArgs["existingTab"] | undefined): ExistingTabPolicy {
  if (existingTab !== undefined && existingTab !== true && existingTab !== false) {
    return {
      requireChatGPT: true,
      ifMissing: "block",
      ifMultiple: existingTab.target?.type === "selected" ? "first" : "block",
      ...existingTab
    };
  }

  return {
    target: { type: "selected", host: "chatgpt" },
    ifMissing: "block",
    ifMultiple: "block",
    requireChatGPT: true
  };
}

function artifactsCheck(env: RuntimeEnv): CapabilityCheck {
  const page = env.page;
  if (page === undefined) {
    return unknown("Artifact readiness requires an already bootstrapped ChatGPT page.", undefined, {
      pageAvailable: false
    }, "session.bootstrap");
  }

  const selectorsAvailable = typeof page.locator === "function" || typeof page.getByRole === "function";
  const downloadEventsAvailable = typeof page.waitForEvent === "function";
  const domEvaluateAvailable = typeof page.evaluate === "function";
  const pageAssetsAvailable = typeof page.capabilities?.get === "function";
  const details = {
    pageAvailable: true,
    selectorsAvailable,
    downloadEventsAvailable,
    domEvaluateAvailable,
    pageAssetsAvailable
  };

  if (selectorsAvailable && (downloadEventsAvailable || domEvaluateAvailable || pageAssetsAvailable)) {
    return ok("Artifact primitives can inspect the current page without requesting generation.", details);
  }

  return unknown("Artifact primitives need selector support plus download, DOM, or page-assets support to prove readiness.", undefined, details);
}

function filePreflightCheck(args: DoctorArgs): CapabilityCheck {
  return unsupported(
    "File preflight is registered as a Stage 2 scaffold; full local file validation is owned by Stage 3.",
    undefined,
    {
      pathCount: args.files?.length ?? 0,
      fullValidation: "deferred_to_stage_3"
    },
    "files.attach",
    "file_preflight_deferred"
  );
}

function localizationCheck(env: RuntimeEnv): CapabilityCheck {
  const requiredKeysMissing = REQUIRED_LOCALE_KEYS.filter(key => localeLabels[key].length === 0);
  const missingToolIds = REQUIRED_TOOL_IDS.filter(id => (localeLabels.tools[id]?.length ?? 0) === 0);
  const toolIds = Object.keys(localeLabels.tools);
  const englishCanonicalPresent = localeLabels.composerTextbox[0] === "Chat with ChatGPT"
    && localeLabels.sendButton[0] === "Send prompt"
    && localeLabels.modeLabels.includes("Thinking")
    && localeLabels.tools.web_search?.[0] === "Web search";
  const labelCandidateCount = REQUIRED_LOCALE_KEYS.reduce((total, key) => total + localeLabels[key].length, 0)
    + Object.values(localeLabels.tools).reduce((total, values) => total + values.length, 0);
  const details = {
    englishCanonicalPresent,
    requiredKeysMissing,
    missingToolIds,
    toolIds,
    labelCandidateCount,
    pageAvailable: env.page !== undefined,
    runtimeSelectorCoverage: "registry_only_stage_2"
  };

  if (englishCanonicalPresent && requiredKeysMissing.length === 0 && missingToolIds.length === 0) {
    return unknown("The locale registry is loaded; localized runtime selector coverage is registry-only in Stage 2 and not fully proven.", undefined, details);
  }

  return blocked(
    "The locale registry is missing canonical labels required for selector fallback.",
    ["Update src/dom/locale-labels.ts or src/dom/locale/* with verified visible labels before relying on localized controls."],
    details,
    "selector_drift"
  );
}

async function reportsCheck(options: RunReportOptions | undefined): Promise<CapabilityCheck> {
  const destDir = options?.destDir ?? "reports/runs";
  const includeContent = options?.includeContent === true;
  const details = {
    destDir,
    includeContent,
    redactionDefault: !includeContent,
    maxPreviewChars: options?.maxPreviewChars ?? 240
  };

  try {
    const current = await stat(destDir);
    if (!current.isDirectory()) {
      return unsupported("Report destination exists but is not a directory.", undefined, details);
    }
    await access(destDir, constants.W_OK);
    return ok(
      includeContent
        ? "Report destination is writable; raw content persistence is enabled by request."
        : "Report destination is writable and redaction is enabled by default.",
      details
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return unknown("Report destination does not exist yet; createReport will create it when a report is written.", undefined, {
        ...details,
        exists: false
      }, "createReport");
    }
    if (isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM")) {
      return blocked("Report destination is not writable.", ["Choose a writable report destDir or update filesystem permissions."], details, "permission");
    }
    return unknown(`Report destination writability could not be proven: ${error instanceof Error ? error.message : String(error)}`, undefined, details);
  }
}

function bridgeRemediation(boot: CommandResult<unknown>): string[] {
  const remediation = boot.blocker?.remediation ?? BROWSER_BRIDGE_REMEDIATION;
  return remediation.map(step => `${step.label}: ${step.instruction}`);
}

function withBlockerDetails(check: CapabilityCheck, result: CommandResult<unknown>, command: string): CapabilityCheck {
  if (result.blocker === undefined) {
    return check;
  }

  const explanation = explainCommandBlocker(result, { command });
  const details: Record<string, unknown> = {
    severity: explanation.severity,
    category: explanation.category,
    userActionRequired: explanation.userActionRequired
  };
  if (explanation.diagnostics?.existingTab !== undefined) {
    details.existingTab = explanation.diagnostics.existingTab;
  }
  if (explanation.candidates !== undefined) {
    details.candidates = explanation.candidates;
  }

  const nextCommand = explanation.nextCommands[0];
  const enriched: CapabilityCheck = {
    ...check,
    blockerKind: explanation.kind,
    details
  };
  if (result.blocker.code !== undefined) enriched.code = result.blocker.code;
  if (check.remediation === undefined && explanation.remediation.length > 0) {
    enriched.remediation = explanation.remediation.map(step => `${step.label}: ${step.instruction}`);
  }
  if (nextCommand !== undefined) enriched.nextCommand = nextCommand;
  return enriched;
}

function ok(message: string, details?: Record<string, unknown>): CapabilityCheck {
  return details === undefined ? { status: "ok", message } : { status: "ok", message, details };
}

function blocked(
  message: string,
  remediation?: string[],
  details?: Record<string, unknown>,
  blockerKind?: string,
  code?: string
): CapabilityCheck {
  return capability("blocked", message, remediation, details, undefined, blockerKind, code);
}

function unsupported(
  message: string,
  remediation?: string[],
  details?: Record<string, unknown>,
  nextCommand?: string,
  code?: string
): CapabilityCheck {
  return capability("unsupported", message, remediation, details, nextCommand, undefined, code);
}

function unknown(
  message: string,
  remediation?: string[],
  details?: Record<string, unknown>,
  nextCommand?: string
): CapabilityCheck {
  return capability("unknown", message, remediation, details, nextCommand);
}

function capability(
  status: CapabilityStatus,
  message: string,
  remediation?: string[],
  details?: Record<string, unknown>,
  nextCommand?: string,
  blockerKind?: string,
  code?: string
): CapabilityCheck {
  const check: CapabilityCheck = { status, message };
  if (remediation !== undefined) check.remediation = remediation;
  if (details !== undefined) check.details = details;
  if (nextCommand !== undefined) check.nextCommand = nextCommand;
  if (blockerKind !== undefined) check.blockerKind = blockerKind;
  if (code !== undefined) check.code = code;
  return check;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
