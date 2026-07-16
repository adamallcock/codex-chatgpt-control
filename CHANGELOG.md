# Changelog

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
