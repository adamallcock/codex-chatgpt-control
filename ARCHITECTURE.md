# codex-chatgpt-control Architecture

## Purpose

This repository is an unofficial SDK for user-directed workflows in visible ChatGPT web sessions. The local customization in this checkout adds a guarded ChatGPT Pro review workflow for reducing manual Codex Desktop -> ChatGPT Pro -> Codex Desktop copy/paste.

## Structure

- `packages/node` is the browser-control runtime authority. It owns visible UI commands, workflows, blockers, reports, tests, and backend dispatch.
- `packages/python` is a parity client over the Node backend protocol. The ChatGPT Pro review v1 work is Node-first; Python parity is deferred until the workflow is promoted as a shared backend contract.
- `skills/codex-chatgpt-control` is the agent-facing operating guide for using the SDK safely.

## Processing Flow

The guarded Pro review flow is intentionally split into small steps:

1. Attach to a visible ChatGPT tab through the browser bridge, starting from `https://chatgpt.com/?temporary-chat=true` for Pro review.
2. Verify the current host is a real ChatGPT host.
3. Ensure the starting tab is an empty chat.
4. Ensure Temporary Chat is verified on. When the visible toggle is hidden, the workflow may treat `temporary-chat=true` plus zero user/assistant turns as verified Temporary Chat evidence.
5. Select the requested visible mode. Pro review defaults to visible `Pro` with effort `拡張`; it must not rely on ChatGPT's default `Thinking` mode. Japanese ChatGPT UI may require selecting `Pro`, opening the intelligence/settings modal, and changing `Pro の思考の労力` from `標準` to `拡張`. After that, the selected state may show as `じっくり思考 Pro`, and this is treated as the same verified mode.
6. Attach the expected zip.
7. Verify exactly the expected attachment name is visible.
8. Compose the prompt. When a Pro review `runId` is available, the submitted prompt includes a visible `Codex ChatGPT Pro Review Run` marker containing `runId`, source prompt hash, ZIP hash, ZIP name, and ZIP byte count. This marker is for idempotent recovery only and is not review evidence.
9. Inspect the composer and run the safe-submit guard.
10. In dry-run mode, stop before sending. In submit mode, click the unique send button, wait for an assistant response to stabilize and for the latest assistant turn to expose its own Copy response action, then copy the answer through ChatGPT's visible Copy response button.
11. Capture the returned Pro answer as clipboard Markdown. Browser tab clipboard is preferred so the workflow does not need foreground OS clipboard control; system clipboard and DOM extraction are fallbacks.
12. Save the answer Markdown, a sibling metadata file, a run ledger, a run-local `state.json`, and a prepared return prompt so the Codex caller can verify status/source/hash before using or returning the answer. If Codex is interrupted after submit, recovery must reopen the saved tab/conversation target and verify the visible run marker before copying the latest assistant answer.

`messages.ask` is not used for this safety-critical flow because it combines compose and submit. The flow uses `compose -> inspect -> guard -> submit preflight -> submit -> wait -> copy`.

## Pro Review CLI

The Node package exposes a local operator entrypoint for the guarded workflow:

```bash
npm --prefix packages/node run pro-review -- --zip <review.zip> --prompt-file <prompt.md>
npm --prefix packages/node run pro-review -- --zip <review.zip> --prompt-file <prompt.md> --submit --output <answer.md>
npm --prefix packages/node run pro-review-return -- --meta <answer.meta.json>
npm --prefix packages/node run pro-review-return -- --meta <answer.meta.json> --consume-current --current-thread-id <threadId>
npm --prefix packages/node run pro-review-return -- --meta <answer.meta.json> --preflight-thread-json <thread-read.json>
npm --prefix packages/node run pro-review-return -- --meta <answer.meta.json> --reserve-send --preflight-thread-json <thread-read.json>
npm --prefix packages/node run pro-review-return -- --meta <answer.meta.json> --record-turn-started --attempt-id <attemptId> --turn-id <turnId>
npm --prefix packages/node run pro-review-return -- --meta <answer.meta.json> --confirm-sent --post-send-thread-json <thread-read-after-send.json> --attempt-id <attemptId>
```

Dry-run is the default. `--submit` only requests submission; the same host, Temporary Chat, attachment, prompt hash, mode, blocker, and unique send-button guards still decide whether the message may be sent. The CLI uses the existing Pro review workflow, defaults to `Pro` + `拡張`, starts from a new `temporary-chat=true` ChatGPT tab by default, and does not use OS cursor control. Submit waits up to 10 minutes by default before copying the latest assistant answer.

When `--output answer.md` is supplied, the CLI writes schema v2 `answer.md`, `answer.meta.json`, `.pro-review-runs/<runId>/input-prompt.md`, `.pro-review-runs/<runId>/return-ledger.json`, and `.pro-review-runs/<runId>/return-prompt.md` atomically. Callers should check `ok`, `status`, `runId`, `codex.threadId`, `codex.sessionId`, `codex.cwd`, `codex.projectRoot`, `codex.git`, `prompt.path`, `prompt.sha256`, `zip.sha256`, `answer.sha256`, `answer.source`, and `answer.format` before treating the Markdown body as a completed Pro review. The v2 generator records git worktree root, branch, and head SHA; it does not read raw git remote URLs because remote URLs can contain credential-adjacent userinfo or tokens.

The return prompt is a prepared handoff artifact for the outer Codex caller. It marks Pro output as untrusted third-party review input and fences inline answer text with a dynamically sized Markdown fence that is longer than any backtick run inside the answer. The Node workflow does not paste into Codex Desktop and does not call Codex thread messaging by itself. If the detected `codexThreadId` is the currently active Codex thread and the same agent turn is consuming the answer, the caller should use current-thread direct consume: verify `answer.md`, `input-prompt.md`, the zip, `return-prompt.md`, and `return-ledger.json`, then mark the ledger `current_thread_consumed` and continue in the same turn without calling thread messaging. If the detected `codexThreadId` is a different thread, the outer caller may send the return prompt only after target-thread preflight, duplicate-run checks, exact `threadId` routing, post-send readback, and idle confirmation.

`pro-review-return` only treats schema v2 metadata as ready. It rehashes `answer.md`, `.pro-review-runs/<runId>/input-prompt.md`, the zip, and `return-prompt.md`, requires a target `codex.threadId`, requires git metadata to be available, verifies that the local ledger's routing/hash fields match the metadata, validates the local ledger state, and returns a send-ready payload for an outer Codex tool. With `--consume-current`, it additionally verifies the current thread and session before updating the local ledger to `current_thread_consumed`. With `--preflight-thread-json`, it validates a previously read target Codex thread snapshot without sending: exact thread id/session id, cwd, project root, git metadata, idle/not-loaded runtime state, active flags, archived state, and duplicate `runId` markers. If the available `thread/read` snapshot lacks required session, git, runtime, or active-flag evidence, preflight blocks instead of weakening the match; current `codex_app.read_thread` output can provide `thread.id`, object-shaped `thread.status`, and `cwd`, but not enough evidence for guarded cross-thread send by itself. With `--reserve-send`, `--record-turn-started`, and `--confirm-sent`, it advances the local ledger through `send_reserved`, `turn_started`, and `marker_observed`; reservation attempt ids must be unique, turn-start recording requires an unexpired lease, and confirmation can recover from `send_reserved` if readback already contains the exact run/hash marker. The actual `send_message_to_thread` call remains an outer Codex tool action between reservation and confirmation. The exported `guardedCrossThreadSend()` helper can orchestrate `read -> reserve -> injected sendMessageToThread -> record -> readback -> confirm`, but only when the caller explicitly injects `readThread` and `sendMessageToThread` functions. It is experimental, not default-enabled, and does not discover or call private Codex endpoints by itself.

When the Pro review helper runs inside Node REPL / browser bridge, the host process may not expose `CODEX_THREAD_ID` in `process.env`. The shared bridge helper checks explicit options, `CODEX_THREAD_ID`, and Codex request metadata through `detectCodexOrigin()`. Callers should still verify the detected `threadId` before a guarded return.

For interrupted browser-bridge runs, callers should use the saved `.pro-review-runs/<runId>/state.json` and the helper/runtime recovery path. Recovery is copy-only: it does not reattach the ZIP or resubmit the prompt. It must validate the visible submitted user turn's run marker against the expected `runId`, prompt hash, and ZIP hash before accepting the latest assistant response.

## Secret Operation

This project has no secret values in its runtime configuration.

The SDK must not read `.env`, `auth.json`, credential folders, browser cookies, browser storage, 1Password values, private key bodies, decrypted SOPS values, or service account JSON bodies. Browser login state may exist in the user's visible Chrome profile, but this project treats it as secret-adjacent state and only interacts through visible UI and host-provided browser bridge APIs.

No 1Password, SOPS, age, or plaintext secret cache is required for the v1 guarded Pro review workflow.

## Safety Notes

- The SDK is not an OpenAI API wrapper and must not call private ChatGPT endpoints.
- Temporary Chat must be verified on before any automatic Pro review submission.
- If Temporary Chat, attachment state, prompt text, host, login state, or send button state is ambiguous, the workflow returns a structured blocker and does not submit.
- Visible UI reads are bounded with short timeouts where practical. If the browser bridge, DOM read, or locator count does not return reliably, the workflow must fail closed instead of waiting indefinitely or guessing state.
- Sequence execution enforces per-step timeouts. Pro review uses a shorter default step timeout so live smoke checks can return a structured timeout before the host tool call is killed.
- Live verification must not fall back to OS-level cursor control, taskbar clicks, or foreground-window stealing. If the Chrome bridge cannot provide the needed state, stop with a blocker and leave the user's desktop interaction alone.
- Pro review starts from a newly created ChatGPT tab by default. It must not claim or overwrite the user's already-open ChatGPT tab unless the workflow is explicitly changed to an existing-tab mode.
- Automatic submission requires an explicit `autoSubmit: true` request and the same guard checks used by dry-run.
- Pro review attachments must be `.zip` files, non-empty, no larger than 100 MB, and have a basic ZIP signature before upload is attempted.
- Attachment SHA-256 and byte counts are local source metadata. The visible ChatGPT UI can confirm the attachment name and absence of extra visible attachments, but it cannot prove that ChatGPT received identical bytes.
- Attachment verification normalizes delete-button labels such as `ファイル 1 を削除：review.zip` and invisible label characters so the delete affordance is not treated as a second attachment.
- Composer prompt verification hashes a normalized prompt form that removes blank-only lines and trailing line whitespace. This preserves non-empty line content and order while tolerating extra blank lines inserted by ChatGPT's composer DOM for long Markdown prompts.
- ChatGPT output is returned as review input for Codex; executing suggested changes is a separate decision.
- The bridge does not paste the Pro answer into the Codex Desktop UI. It saves the answer to the current run's output file and prepares a return prompt tied to the detected Codex thread id when available.
- `CODEX_THREAD_ID` is treated as an origin hint, not a complete proof of safe return. Returning to Codex requires `runId`, prompt hash, ZIP hash, answer hash, git metadata, a local ledger, target-thread validation, and duplicate-send prevention.
- Return ledger schema v2 is a state machine. Phase 1-3 writes and consumes `return_prompt_prepared`, `blocked`, and `current_thread_consumed`; the guarded cross-thread path uses `send_reserved`, `turn_started`, and `marker_observed`; later terminal states such as `completed`, `duplicate_detected`, `failed_retryable`, and `failed_terminal` remain reserved for fuller retry/repair workflows. Validators must verify ledger routing/hash fields against metadata, not only the ledger state string.
- Cross-thread Codex return is not default-enabled in v1. The implemented cross-thread support is preflight plus local ledger gating over caller-provided `thread/read` snapshots; actual sending must remain an explicit injected outer action followed by readback confirmation.
- If answer capture is incomplete or no completed answer text is available, the return state is `blocked` and no return prompt is prepared.

## Verification

For Node changes run:

```bash
npm --prefix packages/node test
npm --prefix packages/node run build
npm --prefix packages/node run bundle
```

Run contract/parity checks only when shared protocol fixtures or Python-visible behavior are intentionally changed.
