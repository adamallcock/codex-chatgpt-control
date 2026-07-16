import { join } from "node:path";
import { BROWSER_BRIDGE_REMEDIATION, BROWSER_BRIDGE_UNAVAILABLE_MESSAGE } from "../errors.js";
import { envText, filterScenarios, runLiveSmoke } from "./live-smoke/harness.js";
import { optionalScenarios, requiredScenarios } from "./live-smoke/scenarios.js";
import type { LiveSmokeBrowser, LiveSmokeContext } from "./live-smoke/types.js";

const globals = globalThis as Record<string, unknown>;
const agent = globals.agent;

if (agent === undefined) {
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
  process.exitCode = 2;
} else {
  const context: LiveSmokeContext = {
    agent,
    reportDir: join(process.cwd(), "reports", "live-smoke")
  };

  const browser = globals.browser as LiveSmokeBrowser | undefined;
  if (browser !== undefined) {
    context.browser = browser;
  }
  const knownThreadQuery = envText("CHATGPT_SMOKE_QUERY");
  if (knownThreadQuery !== undefined) {
    context.knownThreadQuery = knownThreadQuery;
  }
  const knownThreadUrl = envText("CHATGPT_SMOKE_THREAD_URL");
  if (knownThreadUrl !== undefined) {
    context.knownThreadUrl = knownThreadUrl;
  }
  const knownConversationId = envText("CHATGPT_SMOKE_CONVERSATION_ID");
  if (knownConversationId !== undefined) {
    context.knownConversationId = knownConversationId;
  }
  context.env = {
    CHATGPT_E2E_CREATE_IMAGE: envText("CHATGPT_E2E_CREATE_IMAGE"),
    CHATGPT_E2E_DEEP_RESEARCH: envText("CHATGPT_E2E_DEEP_RESEARCH"),
    CHATGPT_E2E_DOWNLOAD: envText("CHATGPT_E2E_DOWNLOAD"),
    CHATGPT_E2E_LOGIN_PROFILE: envText("CHATGPT_E2E_LOGIN_PROFILE"),
    CHATGPT_E2E_MODE_LABEL: envText("CHATGPT_E2E_MODE_LABEL"),
    CHATGPT_E2E_RUNNING_STATUS: envText("CHATGPT_E2E_RUNNING_STATUS"),
    CHATGPT_E2E_STREAM: envText("CHATGPT_E2E_STREAM"),
    CHATGPT_E2E_UPLOAD_PERMISSION_MANUAL: envText("CHATGPT_E2E_UPLOAD_PERMISSION_MANUAL"),
    CHATGPT_E2E_WEB_SEARCH: envText("CHATGPT_E2E_WEB_SEARCH")
  };

  const scenarios = filterScenarios([...requiredScenarios, ...optionalScenarios], envText("CHATGPT_E2E_SCENARIOS"));
  const result = await runLiveSmoke(context, scenarios);
  process.exitCode = result.requiredFailures.length === 0 ? 0 : 1;
}
