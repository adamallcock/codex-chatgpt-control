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

- Adds durable transactional Chat and Work operations with caller-owned IDs,
  append-only mutation intent/receipts, collect-only recovery, exact turn and
  artifact ownership, and fail-closed handling after ambiguous browser calls.
- Multiplexes correlated Node and Python transports while preserving ordered
  same-tab mutations, bounded observation, explicit compatibility diagnostics,
  and conservative provider capability fallbacks.
- Hardens attachment handoff, generated-file capture, dynamic Power discovery,
  browser/tab identity, lifecycle control, and output installation against
  stale, hidden, cross-tab, oversized, late-settling, and acts-then-throws state.
- Adds deterministic cleanup and Chat/Work restoration to the live release
  canary, structured visible rate-limit diagnosis, expanded privacy/performance
  boundaries, 82 shared fixtures, and rebuilt plugin runtimes.

## 0.5.1-alpha.2

- Adds an explicit `messages.stop` primitive with exact confirmation, unique
  visible-control selection, one operation deadline, and verified inactive
  postconditions across Node, Python, sequences, contracts, and plugin docs.
- Hardens file attachment around a single composer-scoped input, fresh visible
  evidence, one shared timeout, approved chooser APIs, and localized upload and
  download labels; removes the page-script `DataTransfer` fallback.
- Recognizes effort-only simplified Chat configuration during live release
  qualification and follows asynchronously mounted, filename-scoped artifact
  previews until their verified Download control is ready.
- Enforces strict HTTPS ChatGPT origins before and after navigation, honors
  user-open tabs for explicit reuse, and scopes lifecycle, blocker, and mode
  evidence away from hidden or quoted content.
- Preserves the reviewed Power/Advanced locale sweep while rejecting unsafe
  generic or send-colliding stop labels, makes fixture regeneration portable
  and CI-checked on Windows, refreshes plugin bundles, patches audited
  transitive dependencies, and makes release helpers use the active Node/npm.

## 0.5.1-alpha.1

- Fixes current Chat/Work pane switching by selecting the visible
  `Select chat surface` radios while retaining legacy button, menu-item, tab,
  link, and bounded DOM fallbacks.
- Correctly detects the checked Work pane and active Work tasks whose home
  surface radio is no longer visible.
- Expands reusable live qualification to cover explicit Chat/Work round trips,
  strict no-op configuration verification, the complete Work lifecycle,
  Work-backed Runner and Responses calls, artifact enumeration, and safe Chat
  restoration.
- Upgrades all bundled skills and plugin packaging validation, and adds an
  opt-in Work configuration mutation test that restores the original setting.

## 0.5.0-alpha.1

- Adds first-class Chat/Work experience detection and verified surface switching.
- Adds surface-aware `configuration.inspect` and strict `configuration.apply` for Chat intelligence/model controls and Work model/effort/speed axes.
- Adds submit-once Work lifecycle commands for start, status, wait, steering, response capture, and artifact access.
- Adds sanitized legacy Chat, simplified Chat, Work basic, Work advanced, and sidebar false-positive profile fixtures to the shared Node/Python conformance suite.
- Adds sync and async Python parity, recursive snake-case wire conversion, runner/Responses support, and Work artifact aliases.
- Rebrands the plugin promise to ChatGPT Surface Control and adds `chatgpt-delegate`; package coordinates, legacy mode APIs, and `chatgpt-pro-consult` remain compatible.

## 0.3.0-alpha.1

- Hardens visible mode selection against thread/sidebar action menus: short mode words such as `Pro` no longer match inside pinned-thread titles, localized thread-action labels and `Pin`/`Unpin` prefixes are rejected, and menu enumeration is scoped to open menu containers.
- Adds `modes.get` for reading the visible mode labels without changing them, plus post-selection verification warnings on `modes.set` when the composer does not visibly reflect the requested mode.
- Rewrites `messages.wait` polling around one combined DOM snapshot per poll with length/hash change detection; the full answer crosses the browser bridge once at completion instead of on every poll.
- Adds a persistent-session mode to the Python `NodeSidecarTransport` (context manager or `open()`/`close()`) so multi-command workflows reuse one backend process.
- Adds Windows and Linux clipboard capture (PowerShell `Get-Clipboard`, `xclip`/`xsel`/`wl-paste`) with the existing DOM fallback.
- Fixes report `createdAt` to honor the injected clock so regenerated contract fixtures are deterministic.

## 0.2.0-alpha.1

- Adds cross-platform Windows and macOS path handling, subprocess gates, and public CI coverage.
- Adds broader localized ChatGPT label detection through the shared locale registry.
- Adds untrusted-output envelopes, integrity sidecars, and expanded diagnostics contracts.

## 0.1.0-alpha.1

- Initial public source preparation for `codex-chatgpt-control`.
- Includes the TypeScript visible-session runtime, backend protocol fixtures, and Python parity client.
- Registry publication is intentionally deferred until package allowlists and install smokes pass.
