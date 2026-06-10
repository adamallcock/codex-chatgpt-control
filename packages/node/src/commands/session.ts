import { attachChatGPTBrowser } from "../browser/attach.js";
import { readPageState } from "../browser/page-state.js";
import { resultError, resultOk } from "../errors.js";
import type { AssertChatGPTHostData, BootstrapArgs, BootstrapData, CommandResult, RuntimeEnv } from "../types.js";
import { contextFromPage } from "./context.js";

const CHATGPT_HOSTS = new Set(["chatgpt.com", "www.chatgpt.com", "chat.openai.com"]);

export async function bootstrap(
  env: RuntimeEnv,
  args: BootstrapArgs = {}
): Promise<CommandResult<BootstrapData>> {
  try {
    const attached = await attachChatGPTBrowser(env, args);
    env.browser = attached.browser;
    env.page = attached.page;

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

export async function assertChatGPTHost(env: RuntimeEnv): Promise<CommandResult<AssertChatGPTHostData>> {
  const boot = env.page === undefined ? await bootstrap(env, { preferExistingTab: true }) : resultOk({}, await contextFromPage(env.page));
  if (!boot.ok) {
    return boot as CommandResult<AssertChatGPTHostData>;
  }

  const page = env.page!;
  const url = typeof page.url === "function" ? await Promise.resolve(page.url()).catch(() => "") : "";
  const hostname = chatgptHostname(url);
  if (hostname === undefined) {
    return {
      ok: false,
      status: "blocked",
      warnings: [],
      blocker: {
        kind: "confirmation",
        code: "not_chatgpt_host",
        message: "Safe submission requires the visible tab to be on a recognized ChatGPT host.",
        visibleText: url,
        resumable: true
      },
      context: await contextFromPage(page)
    };
  }

  return resultOk({ url, hostname }, await contextFromPage(page));
}

function chatgptHostname(value: string): string | undefined {
  try {
    const hostname = new URL(value).hostname;
    return CHATGPT_HOSTS.has(hostname) ? hostname : undefined;
  } catch {
    return undefined;
  }
}
