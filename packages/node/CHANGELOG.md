# Changelog

## 0.5.1-alpha.4

- Detects Chrome's explicit blocked-download error page, avoids alternate
  download attempts, and keeps signed download URLs out of rejected-page results.
- Requires filename-scoped workbook previews when browser filtering is absent.
- Repairs Chat detection and configuration when current Power or Advanced
  menus are open, preserving scoped Work evidence and verified effort changes.
- Recognizes current Work model/Power menus and the independent Fast-mode
  checkbox, with verified selection/restoration and legacy Advanced support.
- Recovers an unconfirmed Send through a fresh client using the authenticated
  saved tab, baseline, unique turn and matching prompt, without sending again.
- Adds an explicit authenticated journal service and packaged CLI for browser
  hosts without process identity. Journal files and locks remain owned by real
  Node; browser capabilities remain in the active browser host.
- Supports the new private-file journal transport on macOS/Linux; Windows
  returns an explicit unsupported-platform error before filesystem access.
- Preserves multiline composer text, recognizes zero-file composer state,
  and forwards the requested response format during exact-turn collection.
- Bounds native download completion receipt waits and reports unverified
  completion without repeating the download or switching strategies.
- Uses one journal-call deadline across queued admission and dispatch and
  bounds concurrent turn evidence requests while preserving digest identities.
- Adds transactional live qualification with durable Send inspection, guarded
  same-ID recovery, owned receipts and duplicate-submission checks.
- Preserves journal-unavailable and indeterminate-write results across Node
  and Python through shared fixtures, with bounded transport and private reports.

## 0.5.1-alpha.3

- Adds the transactional `operations.submit`, `collect`, `inspect`, `control`,
  and `run` surface with durable request identity, monotonic mutation
  boundaries, exact ownership, non-repetition, and redacted recovery receipts.
- Adds capability-aware runtime identity, correlated multiplexed backend
  traffic, process-scoped tab coordination, bounded DOM/file/artifact
  observation, and deterministic configuration restoration.
- Hardens browser acquisition and attachment input scoping, acts-then-throws
  settlement, late deadline behavior, output path validation, journal quotas,
  lifecycle controls, and visible blocker classification.
- Extends release-canary coverage with exact per-scenario tab cleanup and
  independent Chat/Work/configuration postconditions; refreshes all four plugin
  runtime bundles from the qualified source.

## 0.5.1-alpha.2

- Adds confirmation-gated, fail-closed `messages.stop` lifecycle control with
  scoped DOM evidence and a single bounded deadline.
- Hardens uploads, explicit tab reuse, origin checks, localized selectors,
  blocker/mode visibility, and fixture generation against the validated PR
  review findings.
- Qualifies effort-only simplified Chat profiles and waits for delayed scoped
  artifact previews before selecting their exact Download control.
- Adds behavioral stop contracts, expanded regression coverage, rebuilt plugin
  runtimes, portable release helpers, and patched transitive dependency locks.

## 0.5.1-alpha.1

- Fixes current Chat/Work switching through the visible surface-radio group and
  preserves older selector fallbacks.
- Correctly identifies checked Work home state, active Work tasks, and the
  current compound Work configuration opener.
- Adds reusable live-smoke coverage for Chat/Work routing, strict configuration
  verification, Work start/status/wait/read/steer/artifacts, and Work-backed
  Runner and Responses paths.

## 0.5.0-alpha.1

- Adds `experience.detect/open`, `configuration.inspect/apply`, and the Work task lifecycle command group.
- Adds scoped Chat/Work selector profiles, strict configuration postcondition verification, and sanitized profile fixtures.
- Adds runner/Responses experience and configuration inputs plus milestone events.
- Preserves existing `mode`, `modes.set/get`, commands, package imports, and wire fields for backward compatibility.

## 0.3.0-alpha.1

- Hardens mode-menu detection and selection against thread/sidebar action menus, with locale-registry-backed thread-action vetoes and container-scoped menu enumeration.
- Adds the `modes.get` primitive and post-selection verification warnings on `modes.set`.
- Rewrites wait polling around a single combined DOM snapshot per poll; response text is fetched once at completion instead of every poll.
- Adds Windows and Linux clipboard capture with DOM fallback.
- Fixes report `createdAt` to honor the injected clock for deterministic fixtures.

## 0.2.0-alpha.1

- Adds Windows-safe host path validation and cross-platform backend gates.
- Adds localized ChatGPT selector support through the locale-label registry.
- Adds untrusted-output safety envelopes and integrity sidecar verification helpers.

## 0.1.0-alpha.1

- Initial public alpha package metadata and source layout.
