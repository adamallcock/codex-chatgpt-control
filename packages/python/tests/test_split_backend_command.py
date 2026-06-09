"""Regression tests for Bug 1: Windows command-line splitting in scripts/live_smoke.py.

The bug: split_backend_command used POSIX shlex.split on all platforms, which eats
backslashes and mangles Windows paths like C:\node.exe into C:node.exe.

The fix: on win32, use shlex.split(command, posix=False) and then strip the surrounding
quotes that non-POSIX mode retains, so quoted Windows paths with spaces work correctly.

These tests patch sys.platform so they run deterministically on any host OS.
"""

from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

# live_smoke lives in scripts/, which is not on pyright's path (the gate runs
# `pyright src tests`). Add it to sys.path and import it at runtime via
# importlib so there is no static import for pyright to flag as unresolved.
SCRIPTS_DIR = str(Path(__file__).resolve().parents[1] / "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

_live_smoke: Any = importlib.import_module("live_smoke")
split_backend_command = _live_smoke.split_backend_command
strip_matching_quotes = _live_smoke.strip_matching_quotes


class StripMatchingQuotesTests(unittest.TestCase):
    """Unit tests for the strip_matching_quotes helper (platform-independent)."""

    def test_strips_matched_double_quotes(self) -> None:
        self.assertEqual(strip_matching_quotes('"hello"'), "hello")

    def test_strips_matched_single_quotes(self) -> None:
        self.assertEqual(strip_matching_quotes("'hello'"), "hello")

    def test_strips_path_with_spaces_double_quoted(self) -> None:
        self.assertEqual(
            strip_matching_quotes('"C:\\Program Files\\nodejs\\node.exe"'),
            "C:\\Program Files\\nodejs\\node.exe",
        )

    def test_leaves_unquoted_string_unchanged(self) -> None:
        self.assertEqual(strip_matching_quotes("node"), "node")

    def test_leaves_asymmetric_quotes_unchanged(self) -> None:
        # Opening double quote, closing single quote — must NOT be stripped.
        self.assertEqual(strip_matching_quotes("\"hello'"), "\"hello'")

    def test_leaves_single_character_unchanged(self) -> None:
        # A single character cannot form a matching pair — must NOT be stripped.
        self.assertEqual(strip_matching_quotes('"'), '"')

    def test_leaves_empty_string_unchanged(self) -> None:
        self.assertEqual(strip_matching_quotes(""), "")

    def test_strips_outer_double_quotes_leaving_inner_single_quote(self) -> None:
        # Outer characters are both double quotes — they DO match and get stripped.
        # The inner single quote is just part of the content.
        self.assertEqual(strip_matching_quotes('"inner\'quote"'), "inner'quote")


class SplitBackendCommandNonWin32Tests(unittest.TestCase):
    """Tests for the POSIX path (linux / darwin): plain shlex.split, backslashes processed."""

    def _split(self, command: str) -> list[str]:
        with patch("sys.platform", "linux"):
            return split_backend_command(command)

    def test_simple_linux_command(self) -> None:
        result = self._split("node /abs/path/backend.mjs")
        self.assertEqual(result, ["node", "/abs/path/backend.mjs"])

    def test_darwin_simple_command(self) -> None:
        with patch("sys.platform", "darwin"):
            result = split_backend_command("node /abs/path/backend.mjs")
        self.assertEqual(result, ["node", "/abs/path/backend.mjs"])

    def test_posix_quoted_path_with_spaces(self) -> None:
        result = self._split('"/usr/local/bin/node" /abs/path/backend.mjs')
        self.assertEqual(result, ["/usr/local/bin/node", "/abs/path/backend.mjs"])

    def test_posix_single_token(self) -> None:
        result = self._split("node")
        self.assertEqual(result, ["node"])


class SplitBackendCommandWin32Tests(unittest.TestCase):
    """Tests for the Windows path (win32): non-POSIX shlex.split + quote stripping.

    REGRESSION for Bug 1: on win32 the old code called shlex.split(command) (POSIX=True
    by default), which ate backslashes and produced broken paths like C:node.exe.
    """

    def _split(self, command: str) -> list[str]:
        with patch("sys.platform", "win32"):
            return split_backend_command(command)

    def test_win32_unquoted_plain_command(self) -> None:
        # Regression: backslashes must be preserved, not eaten.
        result = self._split(r"C:\Program\node.exe C:\app\backend.mjs")
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0], r"C:\Program\node.exe")
        self.assertEqual(result[1], r"C:\app\backend.mjs")

    def test_win32_backslash_preserved_in_unquoted_path(self) -> None:
        # Regression: shlex.split with posix=True (the old code) ate backslashes,
        # turning "C:\\node.exe" into "C:node.exe". Verify the fix preserves them.
        result = self._split(r"C:\Windows\System32\node.exe")
        self.assertEqual(result, [r"C:\Windows\System32\node.exe"])

    def test_win32_double_quoted_path_with_spaces(self) -> None:
        # The most important case: a path that MUST be quoted on Windows because it
        # contains a space ("Program Files"). Outer quotes must be stripped and the
        # backslashes inside must be intact.
        command = r'"C:\Program Files\nodejs\node.exe" backend.mjs'
        result = self._split(command)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0], r"C:\Program Files\nodejs\node.exe")
        self.assertEqual(result[1], "backend.mjs")

    def test_win32_single_quoted_path_with_spaces(self) -> None:
        command = r"'C:\Program Files\nodejs\node.exe' backend.mjs"
        result = self._split(command)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0], r"C:\Program Files\nodejs\node.exe")
        self.assertEqual(result[1], "backend.mjs")

    def test_win32_simple_node_command(self) -> None:
        result = self._split("node backend.mjs")
        self.assertEqual(result, ["node", "backend.mjs"])

    def test_win32_single_unquoted_token(self) -> None:
        result = self._split("node")
        self.assertEqual(result, ["node"])


if __name__ == "__main__":
    unittest.main()
