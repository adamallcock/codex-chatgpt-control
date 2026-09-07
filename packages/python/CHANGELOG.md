# Changelog

## 0.5.1a4

- Preserves the explicit `download_blocked_by_browser` result without retries
  through the shared backend and Python models.
- Preserves normal journal-runtime blockers and indeterminate journal writes
  through synchronous and asynchronous facades without blind retries.
- Adds shared fixture round-trips for the explicit Node journal service while
  retaining TypeScript authority over browser interaction and durable operations.
- Inherits current Work model/effort/speed configuration and authenticated
  fresh-client Send recovery from the shared TypeScript browser runtime.
- Documents journal-service setup, recovery and the separate requirements for
  Python-to-backend transport and live transactional qualification.
- Preserves explicit unsupported-platform and unverified download-completion
  blockers through shared backend fixtures without retrying the browser action.

## 0.5.1a3

- Adds idiomatic sync and async transactional operation clients over the
  TypeScript-authoritative backend, including caller-owned operation/control
  IDs, inspect/collect recovery, typed compatibility diagnostics, and exact
  receipt models.
- Replaces coarse request serialization with correlated bounded transport
  routing and preserves cancellation, blocker, Runner, Responses, and ordinary
  shell behavior across the shared 82-fixture protocol.

## 0.5.1a2

- Adds sync and async `chatgpt.messages.stop(confirm_stop=True)` parity over the
  Node-owned visible-browser command.
- Covers the new command in shared fixtures, backend conformance, primitive
  tests, and the full ordinary-shell parity gate without adding independent
  Python browser behavior.

## 0.5.1a1

- Picks up the corrected Node-backed Chat/Work radio selection and active Work
  detection without changing the Python API or shared wire shapes.
- Retains sync/async experience, configuration, Work, Runner, and Responses
  parity while the expanded cross-language and package-install gates qualify
  the replacement alpha.

## 0.5.0a1

- Adds matching sync and async `experience`, `configuration`, and `work` clients.
- Adds typed surface-profile, configuration, and Work lifecycle models.
- Recursively converts nested snake-case Python dictionaries to the shared camel-case backend wire shape.
- Preserves existing mode methods and package imports while adding runner/Responses support for Chat and Work preferences.

## 0.3.0a1

- Adds `chatgpt.modes.get()` to the sync and async facades, matching the new backend `modes.get` primitive.
- Adds a persistent-session mode to `NodeSidecarTransport` (context manager or `open()`/`close()`) so multi-command workflows reuse one backend process; transport failures close the session while protocol errors keep it open.
- Keeps parity with the Node backend's hardened mode selection and status-only wait polling.

## 0.2.0a1

- Adds Windows parity coverage for backend command splitting, subprocess handling, and integrity verification.
- Adds Python access to untrusted-output envelopes and integrity sidecar verification.
- Keeps the Python package aligned with the Node backend protocol used by the localized selector and diagnostics updates.

## 0.1.0a1

- Initial Python parity client metadata for the public source repo.
