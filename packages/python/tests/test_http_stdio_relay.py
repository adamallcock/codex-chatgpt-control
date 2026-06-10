from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
RELAY = ROOT / "scripts" / "http_stdio_relay.mjs"
BACKEND_RESPONSE_SCHEMA = "chatgpt.browser_control.backend_response.v1"
BACKEND_EVENT_SCHEMA = "chatgpt.browser_control.backend_event.v1"


class HttpStdioRelayTests(unittest.TestCase):
    def test_request_responses_do_not_emit_blank_records(self) -> None:
        def handler(request: dict[str, Any], path: str, writer: Callable[[str], None]) -> None:
            self.assertEqual(path, "/request")
            writer(json.dumps(response(request, {"command": request["command"]})) + "\n")

        with RelayHarness(handler) as harness:
            harness.send({"requestId": "req_one", "command": "backend.health", "payload": {}})
            harness.send({"requestId": "req_two", "command": "commands", "payload": {}})

            first = harness.read_json()
            second = harness.read_json()

        self.assertEqual(first["requestId"], "req_one")
        self.assertEqual(second["requestId"], "req_two")
        self.assertNotEqual(second, "")

    def test_empty_request_body_returns_structured_relay_error(self) -> None:
        def handler(_request: dict[str, Any], path: str, writer: Callable[[str], None]) -> None:
            self.assertEqual(path, "/request")
            writer("")

        with RelayHarness(handler) as harness:
            harness.send({"requestId": "req_empty", "command": "backend.health", "payload": {}})
            value = harness.read_json()

        self.assertEqual(value["schemaVersion"], BACKEND_RESPONSE_SCHEMA)
        self.assertEqual(value["requestId"], "req_empty")
        self.assertFalse(value["ok"])
        self.assertEqual(value["error"]["code"], "backend_relay_error")
        self.assertIn("empty response body", value["error"]["message"])

    def test_stream_events_are_forwarded_before_http_response_completes(self) -> None:
        first_chunk_written = threading.Event()
        allow_completion = threading.Event()

        def handler(request: dict[str, Any], path: str, writer: Callable[[str], None]) -> None:
            self.assertEqual(path, "/stream")
            writer(json.dumps(event(request, {"type": "run_item_stream_event", "name": "message_submitted"})) + "\n")
            first_chunk_written.set()
            allow_completion.wait(timeout=5)
            writer(json.dumps(event(request, {"type": "completed", "result": {"ok": True, "status": "ok"}})) + "\n")

        with RelayHarness(handler) as harness:
            harness.send({"requestId": "req_stream", "command": "runner.stream", "payload": {}})
            self.assertTrue(first_chunk_written.wait(timeout=2))

            first = harness.read_json(timeout=1)
            self.assertEqual(first["type"], "run_item_stream_event")
            self.assertEqual(first["name"], "message_submitted")

            allow_completion.set()
            final = harness.read_json(timeout=2)

        self.assertEqual(final["type"], "completed")
        self.assertEqual(final["result"]["status"], "ok")

    def test_empty_stream_body_returns_structured_error_event(self) -> None:
        def handler(_request: dict[str, Any], path: str, writer: Callable[[str], None]) -> None:
            self.assertEqual(path, "/stream")
            writer("")

        with RelayHarness(handler) as harness:
            harness.send({"requestId": "req_empty_stream", "command": "runner.stream", "payload": {}})
            value = harness.read_json()

        self.assertEqual(value["schemaVersion"], BACKEND_EVENT_SCHEMA)
        self.assertEqual(value["requestId"], "req_empty_stream")
        self.assertEqual(value["type"], "error")
        self.assertEqual(value["error"]["code"], "backend_relay_error")
        self.assertIn("empty stream body", value["error"]["message"])

    def test_relay_harness_closes_subprocess_pipes(self) -> None:
        def handler(request: dict[str, Any], path: str, writer: Callable[[str], None]) -> None:
            self.assertEqual(path, "/request")
            writer(json.dumps(response(request, {"ok": True})) + "\n")

        harness = RelayHarness(handler)
        with harness:
            process = harness.process
            harness.send({"requestId": "req_close", "command": "backend.health", "payload": {}})
            harness.read_json()

        stdin = process.stdin
        stdout = process.stdout
        stderr = process.stderr
        assert stdin is not None
        assert stdout is not None
        assert stderr is not None
        self.assertTrue(stdin.closed)
        self.assertTrue(stdout.closed)
        self.assertTrue(stderr.closed)


class RelayHarness:
    def __init__(self, handler: Callable[[dict[str, Any], str, Callable[[str], None]], None]) -> None:
        self._handler = handler
        self._server: ThreadingHTTPServer | None = None
        self._server_thread: threading.Thread | None = None
        self._process: subprocess.Popen[str] | None = None
        self._stdout: queue.Queue[str] = queue.Queue()
        self._stdout_thread: threading.Thread | None = None

    @property
    def process(self) -> subprocess.Popen[str]:
        if self._process is None:
            raise AssertionError("relay subprocess has not started")
        return self._process

    def __enter__(self) -> "RelayHarness":
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("content-length", "0"))
                request = json.loads(self.rfile.read(length).decode("utf-8"))
                self.send_response(200)
                self.send_header("content-type", "application/x-ndjson")
                self.end_headers()

                def write(text: str) -> None:
                    if text:
                        self.wfile.write(text.encode("utf-8"))
                        self.wfile.flush()

                outer._handler(request, self.path, write)

            def log_message(self, format: str, *_args: Any) -> None:
                return

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server_thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._server_thread.start()

        env = {
            **os.environ,
            "CHATGPT_BROWSER_BACKEND_HTTP_URL": f"http://127.0.0.1:{self._server.server_port}",
        }
        self._process = subprocess.Popen(
            ["node", str(RELAY)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
        )
        self._stdout_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self._stdout_thread.start()
        return self

    def __exit__(self, _exc_type: Any, _exc: Any, _tb: Any) -> None:
        process = self._process
        if process is not None:
            if process.stdin is not None and not process.stdin.closed:
                process.stdin.close()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
            if self._stdout_thread is not None and self._stdout_thread.is_alive():
                self._stdout_thread.join(timeout=2)
            for stream in (process.stdout, process.stderr):
                if stream is not None and not stream.closed:
                    stream.close()
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._server_thread is not None:
            self._server_thread.join(timeout=2)

    def send(self, request: dict[str, Any]) -> None:
        assert self._process is not None
        assert self._process.stdin is not None
        self._process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
        self._process.stdin.flush()

    def read_json(self, timeout: float = 2) -> dict[str, Any]:
        try:
            line = self._stdout.get(timeout=timeout)
        except queue.Empty as exc:
            raise AssertionError("relay did not emit stdout in time") from exc
        self.assert_not_blank(line)
        return json.loads(line)

    def assert_not_blank(self, line: str) -> None:
        if line.strip() == "":
            raise AssertionError("relay emitted a blank stdout record")

    def _read_stdout(self) -> None:
        assert self._process is not None
        assert self._process.stdout is not None
        try:
            for line in self._process.stdout:
                self._stdout.put(line)
        except ValueError:
            return


def response(request: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": BACKEND_RESPONSE_SCHEMA,
        "requestId": request["requestId"],
        "ok": True,
        "result": result,
    }


def event(request: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": BACKEND_EVENT_SCHEMA,
        "requestId": request["requestId"],
        **payload,
    }


if __name__ == "__main__":
    unittest.main()
