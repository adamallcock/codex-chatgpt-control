import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BrowserLike } from "../types.js";
import { main as captureSurfaceProfile } from "./capture-surface-profile.js";
import { filterScenarios, runLiveSmoke } from "./live-smoke/harness.js";
import { optionalScenarios, requiredScenarios } from "./live-smoke/scenarios.js";
import type { LiveSmokeBrowser, LiveSmokeScenarioResult } from "./live-smoke/types.js";

export type ReleaseCanaryOptions = {
  tabId: string;
  reportDir?: string;
  includeUpload?: boolean;
};

export type ReleaseCanaryResult = {
  ok: boolean;
  profilePaths: string[];
  reportPath?: string;
  results: LiveSmokeScenarioResult[];
  failures: string[];
};

type ReleaseCanaryRuntime = {
  agent?: unknown;
  browser?: BrowserLike;
};

const CORE_SCENARIOS = [
  "chat-work-expansion",
  "configuration-mutate-restore",
  "download-generated-file",
];

export async function runReleaseCanary(
  runtime: ReleaseCanaryRuntime,
  options: ReleaseCanaryOptions
): Promise<ReleaseCanaryResult> {
  if (runtime.agent === undefined || runtime.agent === null) {
    throw new Error("runReleaseCanary must run in a Codex bridge-hosted JavaScript context.");
  }
  if (options.tabId.trim().length === 0) {
    throw new Error("runReleaseCanary requires an exact dedicated ChatGPT tab id.");
  }

  const reportDir = resolve(options.reportDir ?? join(process.cwd(), "reports", "release-canary"));
  const profileDir = join(reportDir, "surface-profiles");
  await mkdir(profileDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const profilePaths = [
    join(profileDir, `${stamp}-chat.json`),
    join(profileDir, `${stamp}-work.json`),
  ];

  try {
    for (const [index, experience] of (["chat", "work"] as const).entries()) {
      const exitCode = await captureSurfaceProfile([
        "--id", `release-canary-${experience}`,
        "--experience", experience,
        "--tab-id", options.tabId,
        "--if-missing", "block",
        "--out", profilePaths[index]!,
        "--provenance", "Sanitized release canary capture from a dedicated visible ChatGPT tab."
      ], runtime);
      if (exitCode !== 0) {
        return {
          ok: false,
          profilePaths: profilePaths.slice(0, index),
          results: [],
          failures: [`surface-profile-${experience}`]
        };
      }
    }
  } finally {
    await closeDedicatedProfileTab(runtime.browser, options.tabId);
  }

  const names = options.includeUpload === true
    ? [...CORE_SCENARIOS, "attach-one-file"]
    : CORE_SCENARIOS;
  const context = {
    agent: runtime.agent,
    ...(runtime.browser === undefined ? {} : { browser: runtime.browser as LiveSmokeBrowser }),
    reportDir: join(reportDir, "live-smoke"),
    env: {
      CHATGPT_E2E_CONFIGURATION_MUTATION: "1",
      CHATGPT_E2E_DOWNLOAD: "1",
    }
  };
  const scenarios = filterScenarios([...requiredScenarios, ...optionalScenarios], names.join(","));
  if (scenarios.length !== names.length) {
    throw new Error(`Release canary scenario registration drift: expected ${names.length}, found ${scenarios.length}.`);
  }
  const smoke = await runLiveSmoke(context, scenarios);
  const failures = smoke.results.filter(result => result.status !== "pass").map(result => result.name);
  return {
    ok: failures.length === 0,
    profilePaths,
    reportPath: smoke.reportPath,
    results: smoke.results,
    failures
  };
}

async function closeDedicatedProfileTab(browser: BrowserLike | undefined, tabId: string): Promise<void> {
  const tabs = browser?.tabs;
  const get = tabs?.get;
  if (tabs === undefined || typeof get !== "function") {
    throw new Error("Release canary requires browser.tabs.get so its dedicated profile tab can be closed before behavior tests.");
  }
  const tab = await get.call(tabs, tabId);
  if (typeof tab.close !== "function") {
    throw new Error("Release canary dedicated profile tab does not expose close().");
  }
  await tab.close();
}
