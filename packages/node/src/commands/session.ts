import { attachChatGPTBrowser, tabIdFromPage } from "../browser/attach.js";
import { readPageState } from "../browser/page-state.js";
import { resultError, resultOk } from "../errors.js";
import type { BootstrapArgs, BootstrapData, CommandResult, RuntimeEnv } from "../types.js";
import { contextFromPage } from "./context.js";

export async function bootstrap(
  env: RuntimeEnv,
  args: BootstrapArgs = {}
): Promise<CommandResult<BootstrapData>> {
  try {
    const attached = await attachChatGPTBrowser(env, args);
    env.browser = attached.browser;
    env.page = attached.page;
    if (attached.tabId !== undefined) {
      env.expectedTabId = attached.tabId;
    }

    const state = await readPageState(attached.page);
    const data: BootstrapData = {
      browserName: attached.browserName,
      tabId: attached.tabId ?? "unknown",
      url: state.url,
      loggedIn: state.signedIn
    };

    const context = attached.tabId === undefined
      ? { browserName: attached.browserName }
      : { browserName: attached.browserName, tabId: attached.tabId };

    return resultOk(data, await contextFromPage(attached.page, context));
  } catch (error) {
    return resultError(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function ensurePage(env: RuntimeEnv): Promise<CommandResult<unknown>> {
  if (env.page === undefined) {
    return bootstrap(env, { preferExistingTab: true });
  }

  const affinity = await verifyTabAffinity(env);
  if (affinity !== undefined) {
    return affinity;
  }

  return resultOk({}, await contextFromPage(env.page, tabContext(env)));
}

export async function verifyTabAffinity(env: RuntimeEnv): Promise<CommandResult<unknown> | undefined> {
  if (env.expectedTabId === undefined || env.page === undefined) {
    return undefined;
  }

  const actualTabId = tabIdFromPage(env.page);
  if (actualTabId === env.expectedTabId) {
    return undefined;
  }

  const code = actualTabId === undefined ? "tab_affinity_unverifiable" : "tab_affinity_lost";
  const message = actualTabId === undefined
    ? `ChatGPT command cannot verify it is still attached to expected tab ${env.expectedTabId}.`
    : `ChatGPT command would run on tab ${actualTabId}, but the workflow expected tab ${env.expectedTabId}.`;

  return {
    ok: false,
    status: "blocked",
    warnings: [],
    blocker: {
      kind: "selector_drift",
      code,
      message,
      remediation: [
        {
          label: "Reclaim the intended tab",
          instruction: "Run session.bootstrap again with an exact existingTab target, or pass the correct page/tab to createChatGPT before retrying.",
          userActionRequired: false
        }
      ],
      resumable: false
    },
    context: await contextFromPage(env.page, tabContext(env, actualTabId))
  };
}

function tabContext(env: RuntimeEnv, actualTabId = tabIdFromPage(env.page!)): { tabId?: string } {
  const tabId = actualTabId ?? env.expectedTabId;
  return tabId === undefined ? {} : { tabId };
}
