# Changelog

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
