"""Regression tests for Bug 2: subprocess returncode timing in backend.py.

The bug: in StdioBackendTransport._process_error, on Windows process.poll() can return
None immediately after the stdout pipe hits EOF even though the child already exited
non-zero.  The result was BackendTransportError.returncode == None instead of the real
exit code.

The fix: when poll() is None, fall back to process.wait(timeout=1.0) (catching
TimeoutExpired), and join the stderr drain thread (self._stderr_thread, timeout 0.5)
before reading self._stderr_buffer.

These tests are entirely deterministic — no real processes or races involved.
"""

from __future__ import annotations

import subprocess
import threading
import unittest
from unittest.mock import MagicMock

from codex_chatgpt_control.backend import BackendTransportError, StdioBackendTransport


def _make_transport(stderr_text: str = "") -> StdioBackendTransport:
    """Return a StdioBackendTransport with injected fake state (no real process)."""
    transport = StdioBackendTransport(command=["dummy"])
    transport._stderr_buffer = stderr_text
    return transport


def _fake_process(poll_return=None, wait_return=None):
    """Build a minimal mock process object.

    poll_return:  what .poll() returns (None or an int)
    wait_return:  what .wait(timeout=...) returns (an int) — only used when poll_return is None
    """
    proc = MagicMock(spec=subprocess.Popen)
    proc.poll.return_value = poll_return
    if wait_return is not None:
        proc.wait.return_value = wait_return
    else:
        proc.wait.side_effect = subprocess.TimeoutExpired(cmd="dummy", timeout=1.0)
    return proc


class ProcessErrorReturncodeTests(unittest.TestCase):
    """Regression tests for the wait(timeout=1.0) fallback in _process_error."""

    # ------------------------------------------------------------------
    # Bug 2 regression: poll() returns None but wait() reveals the code
    # ------------------------------------------------------------------

    def test_poll_none_falls_back_to_wait_and_uses_returncode(self) -> None:
        """REGRESSION for Bug 2.

        When poll() returns None (Windows timing race), _process_error must fall
        back to process.wait(timeout=1.0) and use the code it returns.
        """
        transport = _make_transport(stderr_text="something went wrong")
        transport._process = _fake_process(poll_return=None, wait_return=7)

        err = transport._process_error("boom")

        self.assertEqual(err.returncode, 7)
        self.assertIn("something went wrong", err.stderr)
        self.assertIn("7", str(err))
        # poll() must have been called exactly once
        transport._process.poll.assert_called_once()
        # wait() must have been called with timeout=1.0
        transport._process.wait.assert_called_once_with(timeout=1.0)

    def test_poll_none_wait_timeout_leaves_returncode_none(self) -> None:
        """When poll() is None AND wait() times out, returncode stays None."""
        transport = _make_transport(stderr_text="")
        transport._process = _fake_process(poll_return=None, wait_return=None)
        # wait_return=None causes wait() to raise TimeoutExpired

        err = transport._process_error("still running")

        self.assertIsNone(err.returncode)

    def test_poll_none_stderr_is_included(self) -> None:
        """Stderr text populated before _process_error is called is included."""
        transport = _make_transport(stderr_text="fatal: crash log here")
        transport._process = _fake_process(poll_return=None, wait_return=7)

        err = transport._process_error("backend died")

        self.assertIn("fatal: crash log here", err.stderr)

    def test_poll_none_stderr_thread_is_joined_before_reading(self) -> None:
        """The stderr drain thread must be joined (timeout 0.5) before reading.

        We use a real but already-finished thread so join() returns immediately
        and the test is deterministic. The key assertion is that the returncode and
        stderr are still correct when a thread is present.
        """
        transport = _make_transport(stderr_text="thread stderr")
        transport._process = _fake_process(poll_return=None, wait_return=3)

        # A real thread that is already done — join() is instantaneous.
        finished_thread = threading.Thread(target=lambda: None)
        finished_thread.start()
        finished_thread.join()  # ensure it's done before we inject it
        transport._stderr_thread = finished_thread

        err = transport._process_error("process ended")

        self.assertEqual(err.returncode, 3)
        self.assertIn("thread stderr", err.stderr)

    # ------------------------------------------------------------------
    # Sanity-check: when poll() returns a code directly, use it as-is
    # ------------------------------------------------------------------

    def test_poll_returns_code_directly_no_wait_called(self) -> None:
        """When poll() returns a non-None code, wait() must NOT be called."""
        transport = _make_transport(stderr_text="crash output")
        transport._process = _fake_process(poll_return=5, wait_return=99)

        err = transport._process_error("process exited")

        self.assertEqual(err.returncode, 5)
        self.assertIn("crash output", err.stderr)
        self.assertIn("5", str(err))
        # wait() must not have been consulted
        transport._process.wait.assert_not_called()

    def test_poll_returns_zero_exit_code_is_used(self) -> None:
        """Exit code 0 from poll() is also used (returncode=0 is non-None)."""
        transport = _make_transport()
        transport._process = _fake_process(poll_return=0)

        err = transport._process_error("clean exit")

        self.assertEqual(err.returncode, 0)
        transport._process.wait.assert_not_called()

    def test_no_process_returns_none_returncode(self) -> None:
        """If _process is None, returncode is None and stderr is empty."""
        transport = _make_transport()
        # _process is already None (default)

        err = transport._process_error("no process")

        self.assertIsNone(err.returncode)
        self.assertEqual(err.stderr, "")

    def test_message_included_in_error_when_returncode_is_none(self) -> None:
        """The caller's message is preserved when no returncode is available."""
        transport = _make_transport()
        transport._process = _fake_process(poll_return=None, wait_return=None)

        err = transport._process_error("custom message here")

        self.assertIn("custom message here", str(err))
        self.assertIsNone(err.returncode)

    def test_message_and_exit_code_in_error_string_when_returncode_available(self) -> None:
        """Both the caller message and exit code appear in the error string."""
        transport = _make_transport()
        transport._process = _fake_process(poll_return=42)

        err = transport._process_error("server crashed")

        self.assertIn("server crashed", str(err))
        self.assertIn("42", str(err))


if __name__ == "__main__":
    unittest.main()
