import { readPageState } from "../browser/page-state.js";
import { countPageMessages } from "../dom/messages.js";
import type { AssertSafeToSubmitArgs, AssertSafeToSubmitData, CommandResult, RuntimeEnv } from "../types.js";
import { contextFromPage } from "./context.js";
import { verifyAttachedFiles } from "./files.js";
import { inspectComposer } from "./messages.js";
import { setMode } from "./modes.js";
import { assertChatGPTHost } from "./session.js";
import { assertTemporaryChatVerifiedOn } from "./temporary.js";

export async function assertSafeToSubmit(
  env: RuntimeEnv,
  args: AssertSafeToSubmitArgs
): Promise<CommandResult<AssertSafeToSubmitData>> {
  const checks: string[] = [];

  const host = await assertChatGPTHost(env);
  if (!host.ok) return forwardFailure(host);
  checks.push("chatgpt_host");

  const state = env.page === undefined ? undefined : await readPageState(env.page).catch(() => undefined);
  if (state?.blocker !== undefined && state.blocker.kind !== "modal") {
    return blocked(env, state.blocker.kind, `ChatGPT page is blocked by ${state.blocker.kind}.`, state.blocker.visibleText);
  }
  if (state?.signedIn === false) {
    return blocked(env, "login_required", "ChatGPT login must be verified before safe submission.", state.visibleText);
  }
  checks.push("login_and_page_state");

  const turnCount = env.page === undefined ? undefined : await countPageMessages(env.page).catch(() => undefined);
  if (turnCount !== 0) {
    return blocked(env, "confirmation", "Safe submission requires a new empty chat with no existing turns.");
  }
  checks.push("empty_chat");

  const temporary = await assertTemporaryChatVerifiedOn(env);
  if (!temporary.ok) return forwardFailure(temporary);
  checks.push("temporary_verified_on");

  if (args.mode !== undefined) {
    const mode = await setMode(env, args.mode);
    if (!mode.ok) return forwardFailure(mode);
    checks.push("mode_verified");
  }

  const attachmentArgs = {
    expectedName: args.expectedAttachmentName
  } as Parameters<typeof verifyAttachedFiles>[1];
  if (args.expectedAttachmentPath !== undefined) attachmentArgs.expectedPath = args.expectedAttachmentPath;
  if (args.expectedAttachmentBytes !== undefined) attachmentArgs.expectedBytes = args.expectedAttachmentBytes;
  if (args.expectedAttachmentSha256 !== undefined) attachmentArgs.expectedSha256 = args.expectedAttachmentSha256;
  const attachment = await verifyAttachedFiles(env, attachmentArgs);
  if (!attachment.ok) return forwardFailure(attachment);
  checks.push("attachment_verified");

  const composer = await inspectComposer(env, { expectedSha256: args.expectedPromptSha256 });
  if (!composer.ok) return forwardFailure(composer);
  checks.push("composer_verified");

  if (args.runId !== undefined && await submittedRunIdExists(env, args.runId)) {
    return blocked(env, "confirmation", `A submitted user turn already appears to contain runId ${args.runId}; refusing to resubmit.`);
  }
  checks.push("duplicate_guard");

  return {
    ok: true,
    status: "ok",
    data: { verified: true, checks },
    warnings: [],
    context: await contextFromPage(env.page)
  };
}

async function submittedRunIdExists(env: RuntimeEnv, runId: string): Promise<boolean> {
  const page = env.page;
  if (page === undefined || typeof page.evaluate !== "function") {
    return false;
  }
  return page.evaluate((wanted: string) => {
    return Array.from(document.querySelectorAll("[data-message-author-role='user']"))
      .some(node => (node.textContent ?? "").includes(wanted));
  }, runId).catch(() => false);
}

async function blocked(
  env: RuntimeEnv,
  kind: NonNullable<CommandResult["blocker"]>["kind"],
  message: string,
  visibleText?: string
): Promise<CommandResult<AssertSafeToSubmitData>> {
  const blocker: NonNullable<CommandResult["blocker"]> = { kind, message, resumable: true };
  if (visibleText !== undefined) blocker.visibleText = visibleText;
  return {
    ok: false,
    status: "blocked",
    warnings: [],
    blocker,
    context: await contextFromPage(env.page)
  };
}

function forwardFailure(result: CommandResult<unknown>): CommandResult<AssertSafeToSubmitData> {
  const forwarded: CommandResult<AssertSafeToSubmitData> = {
    ok: false,
    status: result.status,
    warnings: result.warnings,
    context: result.context
  };
  if (result.error !== undefined) forwarded.error = result.error;
  if (result.blocker !== undefined) forwarded.blocker = result.blocker;
  return forwarded;
}
