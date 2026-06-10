import { readSystemClipboard } from "../browser/clipboard.js";
import { readPageState } from "../browser/page-state.js";
import { BROWSER_BRIDGE_REMEDIATION, resultOk } from "../errors.js";
import type { CommandResult, RuntimeEnv } from "../types.js";
import { contextFromPage } from "./context.js";
import { bootstrap } from "./session.js";

export type DoctorCheckName =
  | "bridge"
  | "login"
  | "upload"
  | "download"
  | "clipboard"
  | "modes"
  | "tools"
  | "selectors";

export type CapabilityStatus = "ok" | "blocked" | "unsupported" | "unknown";

export type CapabilityCheck = {
  status: CapabilityStatus;
  message: string;
  remediation?: string[];
};

export type DoctorArgs = {
  check?: DoctorCheckName[];
};

export type DoctorReport = {
  ready: boolean;
  checks: Partial<Record<DoctorCheckName, CapabilityCheck>>;
};

const DEFAULT_CHECKS: DoctorCheckName[] = ["bridge", "login", "upload", "download", "clipboard", "modes", "tools", "selectors"];
const UPLOAD_REMEDIATION = [
  "Codex Settings > Computer Use > Chrome > Permissions > Uploads: set to Always allow, or add chatgpt.com to the allowed upload domains.",
  "Chrome chrome://extensions > Codex extension > Details: enable Allow access to file URLs."
];

export async function doctor(env: RuntimeEnv, args: DoctorArgs = {}): Promise<CommandResult<DoctorReport>> {
  const wanted = args.check ?? DEFAULT_CHECKS;
  const checks: Partial<Record<DoctorCheckName, CapabilityCheck>> = {};
  const boot = await bootstrap(env, { preferExistingTab: true, timeoutMs: 30000 });

  for (const check of wanted) {
    switch (check) {
      case "bridge":
        checks.bridge = boot.ok
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
    }
  }

  const ready = Object.values(checks).every(check => check?.status === "ok" || check?.status === "unknown");
  return resultOk({ ready, checks }, await contextFromPage(env.page));
}

function bridgeCheck(boot: CommandResult<unknown>): CapabilityCheck {
  if (boot.blocker?.kind === "browser_bridge_unavailable") {
    return blocked(boot.blocker.message, bridgeRemediation(boot));
  }

  if (boot.blocker?.kind === "login_required") {
    return ok("Chrome bridge is available; ChatGPT login is required before browser-control commands can continue.");
  }

  if (boot.blocker !== undefined) {
    return unknown(`Chrome bridge responded, but bootstrap is blocked by ${boot.blocker.kind}: ${boot.blocker.message}`);
  }

  return blocked(boot.error?.message ?? "Chrome bridge is unavailable.");
}

async function loginCheck(env: RuntimeEnv, boot: CommandResult<unknown>): Promise<CapabilityCheck> {
  if (!boot.ok && boot.blocker?.kind === "login_required") {
    return blocked("ChatGPT login is required.", ["Ask the user to sign in to ChatGPT in Chrome, then retry."]);
  }
  if (env.page === undefined) {
    return boot.ok ? ok("Bootstrap completed; login appears usable.") : blocked("Cannot determine login because bootstrap failed.");
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

function bridgeRemediation(boot: CommandResult<unknown>): string[] {
  const remediation = boot.blocker?.remediation ?? BROWSER_BRIDGE_REMEDIATION;
  return remediation.map(step => `${step.label}: ${step.instruction}`);
}

function ok(message: string): CapabilityCheck {
  return { status: "ok", message };
}

function blocked(message: string, remediation?: string[]): CapabilityCheck {
  return remediation === undefined ? { status: "blocked", message } : { status: "blocked", message, remediation };
}

function unsupported(message: string, remediation?: string[]): CapabilityCheck {
  return remediation === undefined ? { status: "unsupported", message } : { status: "unsupported", message, remediation };
}

function unknown(message: string, remediation?: string[]): CapabilityCheck {
  return remediation === undefined ? { status: "unknown", message } : { status: "unknown", message, remediation };
}
