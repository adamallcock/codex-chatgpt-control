import type { CommandContext, PageLike } from "../types.js";
import { withTimeout } from "../browser/evaluate.js";
import { countPageMessages } from "../dom/messages.js";
import { parseConversationId } from "../browser/page-state.js";

export async function contextFromPage(
  page: PageLike | undefined,
  partial: Partial<CommandContext> = {}
): Promise<CommandContext> {
  if (page === undefined) {
    return { timestamp: new Date().toISOString(), ...partial };
  }

  const url = typeof page.url === "function"
    ? await withTimeout(Promise.resolve(page.url()), 3000, "Timed out reading page URL.").catch(() => partial.url)
    : partial.url;
  const title = typeof page.title === "function"
    ? await withTimeout(page.title(), 3000, "Timed out reading page title.").catch(() => undefined)
    : partial.title;
  const turnCount = await withTimeout(countPageMessages(page), 3000, "Timed out counting page messages.").catch(() => partial.turnCount);
  const assistantTurnCount = await withTimeout(countPageMessages(page, "assistant"), 3000, "Timed out counting assistant messages.").catch(() => partial.assistantTurnCount);
  const conversationId = url !== undefined ? parseConversationId(url) : partial.conversationId;

  const context: CommandContext = {
    timestamp: new Date().toISOString(),
    ...partial
  };

  if (url !== undefined) {
    context.url = url;
  }
  if (title !== undefined) {
    context.title = title;
  }
  if (turnCount !== undefined) {
    context.turnCount = turnCount;
  }
  if (assistantTurnCount !== undefined) {
    context.assistantTurnCount = assistantTurnCount;
  }
  if (conversationId !== undefined) {
    context.conversationId = conversationId;
  }

  return context;
}
