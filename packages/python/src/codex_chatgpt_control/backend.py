from __future__ import annotations

import json
import queue
import subprocess
import threading
from dataclasses import dataclass, field
from typing import Any, Iterator, Protocol


BACKEND_REQUEST_SCHEMA_VERSION = "chatgpt.browser_control.backend_request.v1"
BACKEND_RESPONSE_SCHEMA_VERSION = "chatgpt.browser_control.backend_response.v1"
BACKEND_EVENT_SCHEMA_VERSION = "chatgpt.browser_control.backend_event.v1"


class BackendProtocolError(RuntimeError):
    def __init__(self, code: str, message: str, *, recoverable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.recoverable = recoverable


class BackendTransportError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        returncode: int | None = None,
        stderr: str = "",
    ) -> None:
        super().__init__(message)
        self.returncode = returncode
        self.stderr = stderr


@dataclass(frozen=True)
class BackendRequest:
    command: str
    payload: dict[str, Any] = field(default_factory=dict)
    request_id: str | None = None

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {
            "schemaVersion": BACKEND_REQUEST_SCHEMA_VERSION,
            "command": self.command,
            "payload": self.payload,
        }
        if self.request_id is not None:
            wire["requestId"] = self.request_id
        return wire


BackendResponse = dict[str, Any]
BackendEvent = dict[str, Any]


class BackendTransport(Protocol):
    def request(self, request: dict[str, Any]) -> BackendResponse:
        ...

    def stream(self, request: dict[str, Any]) -> Iterator[BackendEvent]:
        ...

    def close(self) -> None:
        ...


@dataclass
class StdioBackendTransport:
    command: list[str]
    timeout_seconds: float = 600.0
    env: dict[str, str] | None = None
    _process: subprocess.Popen[str] | None = field(init=False, default=None)
    _stderr_buffer: str = field(init=False, default="")
    _stderr_lock: threading.Lock = field(init=False, default_factory=threading.Lock)
    _stderr_thread: threading.Thread | None = field(init=False, default=None)

    def request(self, request: dict[str, Any]) -> BackendResponse:
        self._write_json_line(request)
        response = self._read_response(request)
        if response.get("ok") is False:
            error = response.get("error")
            if not isinstance(error, dict):
                raise BackendTransportError("Backend protocol error response is missing error details.")
            raise BackendProtocolError(
                str(error.get("code", "backend_error")),
                str(error.get("message", "Backend protocol error.")),
                recoverable=bool(error.get("recoverable", False)),
            )
        return response

    def stream(self, request: dict[str, Any]) -> Iterator[BackendEvent]:
        self._write_json_line(request)
        while True:
            event = self._read_event(request)
            event_type = event.get("type")
            if event_type == "error":
                error = event.get("error")
                if not isinstance(error, dict):
                    raise BackendTransportError("Backend error event is missing error details.")
                raise BackendProtocolError(
                    str(error.get("code", "backend_error")),
                    str(error.get("message", "Backend stream error.")),
                    recoverable=bool(error.get("recoverable", False)),
                )
            yield event
            if event_type == "completed":
                return

    def close(self) -> None:
        process = self._process
        if process is None:
            return
        try:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=1)
        finally:
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None and not stream.closed:
                    stream.close()
            stderr_thread = self._stderr_thread
            if stderr_thread is not None and stderr_thread.is_alive():
                stderr_thread.join(timeout=0.2)
            self._process = None
            self._stderr_thread = None

    def _start(self) -> subprocess.Popen[str]:
        if not self.command:
            raise BackendTransportError("Backend command must not be empty.")
        if self._process is None:
            self._stderr_buffer = ""
            self._process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env=self.env,
            )
            self._start_stderr_reader(self._process)
        return self._process

    def _write_json_line(self, request: dict[str, Any]) -> None:
        process = self._start()
        if process.stdin is None:
            raise BackendTransportError("Backend process stdin is unavailable.")
        try:
            process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
            process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise self._process_error("Backend process exited before accepting a request.") from exc

    def _read_response(self, request: dict[str, Any]) -> BackendResponse:
        value = self._read_json_value("response")
        if not isinstance(value, dict):
            raise BackendTransportError("Backend response must be a JSON object.")
        if value.get("schemaVersion") != BACKEND_RESPONSE_SCHEMA_VERSION:
            raise BackendTransportError("Backend response has an unsupported schemaVersion.")
        self._assert_matching_request_id(request, value, "response")
        if not isinstance(value.get("ok"), bool):
            raise BackendTransportError("Backend response is missing boolean ok.")
        return value

    def _read_event(self, request: dict[str, Any]) -> BackendEvent:
        value = self._read_json_value("event")
        if not isinstance(value, dict):
            raise BackendTransportError("Backend event must be a JSON object.")
        if value.get("schemaVersion") != BACKEND_EVENT_SCHEMA_VERSION:
            raise BackendTransportError("Backend event has an unsupported schemaVersion.")
        self._assert_matching_request_id(request, value, "event")
        if not isinstance(value.get("type"), str):
            raise BackendTransportError("Backend event is missing type.")
        return value

    def _read_json_value(self, label: str) -> Any:
        line = self._read_stdout_line()
        try:
            return json.loads(line)
        except json.JSONDecodeError as exc:
            process = self._process
            returncode = process.poll() if process is not None else None
            if process is not None and returncode is None:
                try:
                    returncode = process.wait(timeout=0.05)
                except subprocess.TimeoutExpired:
                    returncode = None
            raise BackendTransportError(
                f"Backend returned invalid JSON {label}.",
                returncode=returncode,
                stderr=self._read_stderr(process),
            ) from exc

    def _read_stdout_line(self) -> str:
        process = self._start()
        stdout = process.stdout
        if stdout is None:
            raise BackendTransportError("Backend process stdout is unavailable.")

        result_queue: queue.Queue[str | BaseException] = queue.Queue(maxsize=1)

        def read_line() -> None:
            try:
                result_queue.put(stdout.readline())
            except BaseException as exc:  # pragma: no cover - defensive against stream teardown races.
                result_queue.put(exc)

        thread = threading.Thread(target=read_line, daemon=True)
        thread.start()

        try:
            result = result_queue.get(timeout=self.timeout_seconds)
        except queue.Empty:
            self.close()
            raise BackendTransportError(
                f"Backend timed out after {self.timeout_seconds} seconds.",
                returncode=None,
                stderr="",
            )

        if isinstance(result, BaseException):
            raise self._process_error("Backend process stdout read failed.") from result
        line = result
        if line == "":
            raise self._process_error("Backend process ended without producing a response.")
        return line

    def _assert_matching_request_id(self, request: dict[str, Any], value: dict[str, Any], label: str) -> None:
        request_id = request.get("requestId")
        if request_id is not None and value.get("requestId") != request_id:
            raise BackendTransportError(f"Backend {label} requestId did not match the request.")

    def _process_error(self, message: str) -> BackendTransportError:
        process = self._process
        returncode = process.poll() if process is not None else None
        if process is not None and returncode is None:
            try:
                returncode = process.wait(timeout=1.0)
            except subprocess.TimeoutExpired:
                returncode = None
        stderr_thread = self._stderr_thread
        if stderr_thread is not None and stderr_thread.is_alive():
            stderr_thread.join(timeout=0.5)
        stderr = self._read_stderr(process)
        if returncode is not None:
            return BackendTransportError(
                f"{message} Backend process exited with {returncode}.",
                returncode=returncode,
                stderr=stderr,
            )
        return BackendTransportError(message, returncode=None, stderr=stderr)

    def _start_stderr_reader(self, process: subprocess.Popen[str]) -> None:
        stderr = process.stderr
        if stderr is None:
            return

        def drain() -> None:
            try:
                while True:
                    chunk = stderr.read(1)
                    if chunk == "":
                        return
                    self._append_stderr(chunk)
            except (ValueError, OSError):
                return

        self._stderr_thread = threading.Thread(target=drain, daemon=True)
        self._stderr_thread.start()

    def _append_stderr(self, chunk: str) -> None:
        with self._stderr_lock:
            self._stderr_buffer = f"{self._stderr_buffer}{chunk}"[-4000:]

    def _read_stderr(self, process: subprocess.Popen[str] | None) -> str:
        if process is None:
            return ""
        with self._stderr_lock:
            return self._stderr_buffer


class BackendClient:
    def __init__(self, transport: BackendTransport) -> None:
        self._transport = transport
        self._next_request_id = 0

    def request(self, command: str, payload: dict[str, Any] | None = None) -> Any:
        response = self._transport.request(self._envelope(command, payload or {}))
        if response.get("ok") is False:
            error = response.get("error")
            if isinstance(error, dict):
                raise BackendProtocolError(
                    str(error.get("code", "backend_error")),
                    str(error.get("message", "Backend protocol error.")),
                    recoverable=bool(error.get("recoverable", False)),
                )
            raise BackendProtocolError("backend_error", "Backend protocol error.", recoverable=False)
        return response.get("result")

    def stream(self, command: str, payload: dict[str, Any] | None = None) -> Iterator[BackendEvent]:
        return self._transport.stream(self._envelope(command, payload or {}))

    def runner_run(self, agent: dict[str, Any], input: Any) -> dict[str, Any]:
        result = self.request("runner.run", {"agent": agent, "input": input})
        if not isinstance(result, dict):
            raise BackendTransportError("runner.run result must be a JSON object.")
        return result

    def runner_plan(self, agent: dict[str, Any], input: Any) -> dict[str, Any]:
        result = self.request("runner.plan", {"agent": agent, "input": input})
        if not isinstance(result, dict):
            raise BackendTransportError("runner.plan result must be a JSON object.")
        return result

    def runner_stream(self, agent: dict[str, Any], input: Any) -> Iterator[BackendEvent]:
        return self.stream("runner.stream", {"agent": agent, "input": input})

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        agent = payload.get("agent")
        if not isinstance(agent, dict):
            raise BackendTransportError("Legacy run payload must include agent as an object.")
        return self.runner_run(agent, payload.get("input"))

    def capabilities(self) -> dict[str, Any]:
        result = self.request("backend.capabilities")
        if not isinstance(result, dict):
            raise BackendTransportError("backend.capabilities result must be a JSON object.")
        return result

    def health(self) -> dict[str, Any]:
        result = self.request("backend.health")
        if not isinstance(result, dict):
            raise BackendTransportError("backend.health result must be a JSON object.")
        return result

    def close(self) -> None:
        self._transport.close()

    def _envelope(self, command: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._next_request_id += 1
        return BackendRequest(command, payload, f"py_req_{self._next_request_id}").to_wire()
