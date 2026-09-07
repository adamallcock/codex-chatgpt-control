import { attachChatGPTBrowser, isChatGPTUrl, tabIdFromPage } from "../browser/attach.js";
import { readPageState } from "../browser/page-state.js";
import { chatGPTAttachmentContextUrl } from "../browser/chatgpt-url.js";
import { resultError, resultOk } from "../errors.js";
import { unwrapCoordinatedPage } from "../runtime/coordinated-page.js";
import type { BootstrapArgs, BootstrapData, CommandResult, RuntimeEnv } from "../types.js";
import { contextFromPage } from "./context.js";

export type EnsurePageOptions = {
  minimalContext?: boolean;
};

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
      url: chatGPTAttachmentContextUrl(state.url) ?? state.url,
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

export async function ensurePage(
  env: RuntimeEnv,
  options: EnsurePageOptions = {}
): Promise<CommandResult<unknown>> {
  if (env.page === undefined) {
    return bootstrap(env, { preferExistingTab: true });
  }

  const affinity = await verifyTabAffinity(env);
  if (affinity !== undefined) {
    return affinity;
  }

  const origin = await verifyChatGPTOrigin(env);
  if (origin !== undefined) {
    return origin;
  }

  return resultOk({}, await contextFromPage(
    env.page,
    tabContext(env),
    { minimal: options.minimalContext === true }
  ));
}

async function verifyChatGPTOrigin(env: RuntimeEnv): Promise<CommandResult<unknown> | undefined> {
  if (env.page === undefined) return undefined;
  const page = env.page;
  // Invoke inside the promise so synchronous provider errors are also kept
  // out of public diagnostics: their messages can contain the rejected URL.
  const actualUrl = await Promise.resolve().then(() => page.url?.()).catch(() => undefined);
  if (isChatGPTUrl(actualUrl)) return undefined;
  return {
    ok: false,
    status: "blocked",
    warnings: [],
    blocker: {
      kind: "selector_drift",
      code: "unsafe_chatgpt_origin",
      message: "ChatGPT command refused to operate because the controlled tab is not on an allowlisted ChatGPT origin.",
      // Rejected navigations may contain signed attachment URLs, credentials,
      // or private path segments. Keep the URL only for the local origin test.
      visibleText: actualUrl === undefined
        ? "The current tab URL could not be verified."
        : "The current tab is outside the supported ChatGPT origins.",
      remediation: [
        {
          label: "Reopen ChatGPT",
          instruction: "Run session.bootstrap against https://chatgpt.com or claim an exact supported ChatGPT tab before retrying.",
          userActionRequired: false
        }
      ],
      resumable: false
    },
    context: await contextFromPage(env.page, tabContext(env), { minimal: true })
  };
}

export async function verifyTabAffinity(env: RuntimeEnv): Promise<CommandResult<unknown> | undefined> {
  if (env.expectedTabId === undefined || env.page === undefined) {
    return undefined;
  }

  // The coordinated facade intentionally snapshots its public identity when
  // it is created so its coordinator key cannot drift underneath queued work.
  // Affinity verification has a different job: it must inspect the provider
  // page that the facade protects and detect a changed/reused tab claim.
  const actualTabId = tabIdFromPage(unwrapCoordinatedPage(env.page));
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

function tabContext(
  env: RuntimeEnv,
  actualTabId = tabIdFromPage(unwrapCoordinatedPage(env.page!))
): { tabId?: string } {
  const tabId = actualTabId ?? env.expectedTabId;
  return tabId === undefined ? {} : { tabId };
}
