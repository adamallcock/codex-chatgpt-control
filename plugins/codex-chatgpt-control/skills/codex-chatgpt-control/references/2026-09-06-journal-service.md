---
title: Journal service for restricted browser hosts
date: 2026-09-06
type: runbook
status: implemented
---

# Journal service for restricted browser hosts

Transactional workflows need a real Node process to own journal files and locks.
Some browser hosts expose filesystem access but no process identity or local
network sockets. Configure the explicit private-file journal service in these
hosts. Browser operations and prepared Send capabilities remain in the browser
host; only journal storage and signing use the service.

This private-file transport supports macOS and Linux. Windows is explicitly
rejected with `journal_rpc_unsupported_platform` before filesystem access;
POSIX mode bits do not establish Windows ownership or ACL protection. This
limit applies to the new service transport. The existing local Node journal
path and ordinary Node/Python Windows support retain their current behavior.

Start the packaged service in an ordinary Node terminal. Supply a persistent,
absolute state root and a **new** absolute session directory. On macOS use the
canonical `/private/tmp` spelling when choosing a temporary directory.

```bash
node /absolute/plugin/runtime/node/codex-chatgpt-control-journal.mjs \
  --state-root /absolute/private/journal-state \
  --directory /absolute/private/new-journal-session
```

For a source checkout, build with `npm run bundle:journal` and use
`dist/codex-chatgpt-control-journal.mjs`. The service prints only a readiness
result. Keep `new-journal-session/connection.json` private: it contains the
session authentication secret. Never include its contents in a prompt, report,
issue, or log.

After initializing the supported Chrome bridge, create the browser client:

```js
const chatgpt = createChatGPT({
  agent,
  operations: {
    journalService: {
      descriptorPath: "/absolute/private/new-journal-session/connection.json"
    }
  }
});
const operationId = crypto.randomUUID();
const submitted = await chatgpt.ask({
  operationId,
  prompt: "Reply with exactly JOURNAL_OK",
  experience: "chat",
  configuration: { effort: "High" },
  files: [],
  wait: false
});
```

Do not set `operations.stateRoot` together with `journalService`: the service
owns the state root. Without `journalService`, the existing local Node journal
path remains unchanged. The client never starts a hidden process or falls back
to another transport. `timeoutMs` on the connection bounds each journal call;
it is not a deadline for the complete browser workflow.

The service uses owner-only directories and files, authenticated encrypted
request/response envelopes, bounded request admission, and replay checks. Journal
signing keys remain in the service. It uses the real Node PID and existing lock
liveness checks. The connection secret grants journal authority to its holder;
this is a same-user local service, not a boundary against a hostile process
running as that same user.

## Recovery

Stop the owned service with Ctrl-C or SIGTERM. To restart, retain the state root
and choose another new session directory, then create a new browser client with
that descriptor. Existing operation IDs, handles and completed receipts remain
valid. Retry an unconfirmed Send with the **same operation ID and unchanged
request**. After authenticating that request and its durable Send action, a fresh
client can reconcile the saved `new_pending` target through an observe-only
path. It requires the exact saved provider/browser/tab, its blank-task anchor,
a complete persisted pre-Send baseline, and exactly one new user turn whose
normalized text matches the requested prompt. The service then records the
proved conversation and collects its response without another Send.

This path never resolves `target: new` again, switches surfaces, restores
configuration, uploads files, or recomposes the prompt. A saved pending target
without a durable Send is blocked before browser access. Generic `collect` and
control calls still reject `new_pending` targets; use same-request submit/ask
reconciliation first. Missing tabs, unavailable baselines, different prompts,
and multiple new user turns remain blockers. Fixed or established targets also
require their exact saved conversation identity. Completed receipts replay
without browser access.

An exact saved tab and matching prompt do not provide provider navigation
history. Manual navigation on that tab to another conversation containing the
identical single prompt is observationally indistinguishable from the intended
Send. Do not navigate or repurpose the operation's tab while recovering it.

A missing or invalid connection blocks the workflow. A dispatched journal write
whose acknowledgement is lost returns `journal_rpc_outcome_indeterminate`.
Reconnect to the same journal and inspect or reconcile the **same operation
identity** before further browser actions. Never mint a new operation ID to
retry an uncertain Send. The client does not retry transport writes.

Transactional Chat Power selection observes the closed composer's effort,
records one action intent, and then searches the owned slider one step at a
time within a finite budget. An absent choice is restored only while every
step and the original position remain proven in the same execution. An
interrupted action is reconciled by observation; it never restarts probing or
reconstructs a setting from a digest.

## Qualification and Python

The optional `transactional-submit-once` smoke uses the production client. Set
`CHATGPT_E2E_TRANSACTIONAL=1` and `CHATGPT_E2E_JOURNAL_DESCRIPTOR` in its explicit
context environment to select this service. It checks the exact response,
receipt and browser turn counts before a same-ID replay.

Fresh-client restart qualification also exercised a real completed ChatGPT
exchange against an isolated authenticated journal prefix ending at the atomic
`action_prepared` Send event: phase `ready`, target `new_pending`, persisted
baseline, and no submission witness. After restarting the normal Node journal
service, a fresh browser client recovered the exact 26-byte synthetic response,
retained the same Send action, and preserved one user/one assistant turn before
and after recovery and completed replay. This tests loss of post-Send
bookkeeping against a real browser result; it does not claim an OS process was
killed at every individual timing boundary.

Python continues to use the versioned Node backend protocol. Configure
`BackendSession({ agent, operations: { journalService: { descriptorPath } } })`
in the active browser host; Python handles, operation results and wire schemas
are unchanged. Python cannot acquire the browser bridge by spawning a plain
Node subprocess. A bridge-hosted backend transport is still required, and the
HTTP test relay is usable only where that host permits local sockets.

The async journal authority and async DOM factory helpers are TypeScript host
integration APIs, not new Python wire methods. Owner: SDK runtime maintainers.
Revisit this intentional language asymmetry if Python gains its own browser
backend; require existing shared fixtures and conformance before adding one.
