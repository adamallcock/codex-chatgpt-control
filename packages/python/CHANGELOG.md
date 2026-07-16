# Changelog

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
