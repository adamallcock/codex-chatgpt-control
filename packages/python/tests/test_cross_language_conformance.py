import importlib.util
import json
import re
import unittest
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Any, cast

from codex_chatgpt_control import BackendClient, BackendEvent, BackendProtocolError, ChatGPTRunResult, StdioBackendTransport
from codex_chatgpt_control.backend import BACKEND_REQUEST_SCHEMA_VERSION


ROOT = Path(__file__).resolve().parents[2]
NODE_PACKAGE = ROOT / "node"
PYTHON_PACKAGE = ROOT / "python"
CONTRACT = NODE_PACKAGE / "contracts" / "v1"
BACKEND_BUNDLE = NODE_PACKAGE / "dist" / "codex-chatgpt-control-backend.mjs"
NORMALIZER = PYTHON_PACKAGE / "scripts" / "normalize_fixtures.py"


def load_script_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module {name} from {path}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


normalizer = load_script_module("normalize_fixtures", NORMALIZER)
canonical_json = cast(Callable[[Any], str], getattr(normalizer, "canonical_json"))
load_fixture_value = cast(Callable[[Path, dict[str, str]], Any], getattr(normalizer, "load_fixture_value"))
normalize = cast(Callable[[Any], Any], getattr(normalizer, "normalize"))
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


class CrossLanguageConformanceTests(unittest.TestCase):
    def test_python_backend_client_matches_node_backend_plan_fixtures(self) -> None:
        self.assertTrue(BACKEND_BUNDLE.exists(), "Run npm run bundle:backend before Python conformance tests.")
        transport = StdioBackendTransport(command=["node", str(BACKEND_BUNDLE)])
        client = BackendClient(transport)
        try:
            cases = [
                (
                    "runner-visible-prefix-plan.json",
                    {
                        "name": "visible-prefix-agent",
                        "instructions": "Answer with terse implementation guidance.",
                        "instructionsMode": "visible_prefix",
                    },
                    "Assess the SDK architecture.",
                ),
                (
                    "runner-visible-setup-plan.json",
                    {
                        "name": "visible-setup-agent",
                        "instructions": "Maintain a careful review checklist.",
                        "instructionsMode": "visible_setup_message",
                    },
                    "Review parity gates.",
                ),
                (
                    "runner-metadata-only-plan.json",
                    {
                        "name": "metadata-agent",
                        "instructions": "This should not become visible prompt text.",
                        "instructionsMode": "metadata_only",
                    },
                    {
                        "input": "Summarize visible-only behavior.",
                        "thread": {"type": "conversationId", "conversationId": "conv_metadata_123"},
                        "response": {"format": "markdown"},
                    },
                ),
                (
                    "runner-input-items-and-files-plan.json",
                    {
                        "name": "file-agent",
                        "instructions": "Use the attached file context.",
                        "instructionsMode": "visible_prefix",
                        "defaults": {"wait": False, "read": {"format": "markdown"}},
                    },
                    {
                        "input": [
                            {"type": "visible_instruction", "text": "Use concise bullets."},
                            {"type": "input_text", "text": "Review the implementation handoff."},
                            {
                                "type": "input_file",
                                "path": "/tmp/contract-fixtures/handoff.md",
                                "description": "SDK parity handoff.",
                            },
                        ],
                        "attachments": [
                            {"path": "/tmp/contract-fixtures/context.json", "description": "Structured context."}
                        ],
                        "mode": {"model": "auto"},
                        "tools": [{"tool": "web_search", "ifUnavailable": "skip"}],
                        "response": {"format": "markdown"},
                    },
                ),
            ]

            for fixture_file, agent, run_input in cases:
                with self.subTest(fixture=fixture_file):
                    plan = client.runner_plan(agent, run_input)
                    expected = load_fixture_file(fixture_file)
                    self.assertFixtureEqual(plan, expected)
        finally:
            client.close()

    def test_python_backend_client_matches_backend_response_fixtures(self) -> None:
        transport = StdioBackendTransport(command=["node", str(BACKEND_BUNDLE)])
        try:
            raw_cases = [
                ("backend-version.json", "backend.version", {}),
                ("command-descriptors.json", "commands", {}),
                ("help-root.json", "help", {}),
            ]
            for fixture_file, command, payload in raw_cases:
                with self.subTest(fixture=fixture_file):
                    expected = load_fixture_file(fixture_file)
                    response = transport.request(backend_envelope(command, payload, expected.get("requestId")))
                    self.assertFixtureEqual(response, expected)

            client = BackendClient(transport)
            self.assertFixtureEqual(client.capabilities(), load_fixture_file("backend-capabilities.json"))
            self.assertFixtureEqual(
                client.request("describe", {"name": "runner.run"}),
                load_fixture_file("describe-runner-run.json"),
            )
        finally:
            transport.close()

    def test_python_backend_client_matches_response_adapter_fixtures(self) -> None:
        transport = StdioBackendTransport(command=["node", str(BACKEND_BUNDLE)])
        client = BackendClient(transport)
        try:
            cases = [
                (
                    "responses-hidden-instructions-unsupported.json",
                    {"input": "Visible request.", "instructions": "Hidden instruction request."},
                ),
                (
                    "responses-unknown-field-unsupported.json",
                    {"input": "Visible request.", "unknown_control": True},
                ),
                (
                    "responses-unsupported-previous-response-id.json",
                    {"input": "Visible request.", "previous_response_id": "resp_123"},
                ),
                (
                    "responses-unsupported-temperature.json",
                    {"input": "Visible request.", "temperature": 0.2},
                ),
            ]
            for fixture_file, payload in cases:
                with self.subTest(fixture=fixture_file):
                    response = client.request("responses.create", payload)
                    self.assertFixtureEqual(response, load_fixture_file(fixture_file)["response"])
        finally:
            client.close()

    def test_python_backend_client_matches_command_result_fixtures(self) -> None:
        transport = StdioBackendTransport(command=["node", str(BACKEND_BUNDLE)])
        client = BackendClient(transport)
        try:
            cases = [
                ("doctor-bridge-upload.json", "doctor", {"check": ["bridge", "upload"]}),
                ("primitive-bootstrap-blocker.json", "session.bootstrap", {}),
                (
                    "report-redaction-default.json",
                    "reports.redact",
                    {
                        "value": {
                            "prompt": "private@example.com",
                            "file": "/example/user/secret/contract.pdf",
                            "token": "token_12345678901234567890123456789012",
                        }
                    },
                ),
                (
                    "reports-summarize-redacted.json",
                    "reports.summarize",
                    {
                        "result": {
                            "ok": False,
                            "status": "blocked",
                            "warnings": ["contains sensitive preview"],
                            "blocker": {
                                "kind": "browser_bridge_unavailable",
                                "message": "Codex cannot access the ChatGPT browser bridge from this backend process. In an ordinary shell this is expected; for a live Codex Chrome run, bootstrap the Chrome plugin runtime with setupBrowserRuntime({ globals: globalThis }) before using globalThis.agent.",
                                "visibleText": "private@example.com",
                            },
                            "context": {"timestamp": "2026-06-06T00:00:00.000Z"},
                        }
                    },
                ),
            ]
            for fixture_file, command, payload in cases:
                with self.subTest(fixture=fixture_file):
                    result = client.request(command, payload)
                    self.assertFixtureEqual(result, load_fixture_file(fixture_file)["result"])
        finally:
            client.close()

    def test_python_backend_protocol_errors_match_node_contract_fixtures(self) -> None:
        transport = StdioBackendTransport(command=["node", str(BACKEND_BUNDLE)])
        client = BackendClient(transport)
        try:
            with self.assertRaises(BackendProtocolError) as run_error:
                client.request("runner.run", {"agent": {"name": "invalid-run-agent"}})
            self.assertProtocolErrorMatches(run_error.exception, load_fixture_file("backend-error-missing-run-input.json"))

            with self.assertRaises(BackendProtocolError) as stream_error:
                list(client.stream("runner.stream", {"agent": {"name": "invalid-stream-agent"}}))
            self.assertProtocolErrorMatches(stream_error.exception, load_fixture_file("backend-error-event-missing-stream-input.json"))
        finally:
            client.close()

    def test_python_normalized_models_match_node_contract_fixtures(self) -> None:
        manifest = json.loads((CONTRACT / "manifest.json").read_text(encoding="utf-8"))

        for fixture in manifest["fixtures"]:
            with self.subTest(fixture=fixture["file"]):
                value = load_fixture_value(CONTRACT, fixture)
                self.assertEqual(canonical_json(normalize(value)), canonical_json(value))

    def test_stream_event_names_and_final_status_match_fixture(self) -> None:
        fixture = {
            "file": "stream-submitted-completed.ndjson",
            "schema": "backendEvent",
            "case": "stream_submitted_completed",
        }
        events = [BackendEvent.from_wire(event) for event in load_fixture_value(CONTRACT, fixture)]

        self.assertEqual([event.name for event in events[:-1]], ["message_submitted", "message_completed"])
        final = events[-1].result
        self.assertIsInstance(final, ChatGPTRunResult)
        assert isinstance(final, ChatGPTRunResult)
        self.assertEqual(final.status, "ok")

    def assertFixtureEqual(self, actual: Any, expected: Any) -> None:
        self.assertEqual(canonical_json(normalize_dynamic(actual)), canonical_json(normalize_dynamic(expected)))

    def assertProtocolErrorMatches(self, actual: BackendProtocolError, fixture: dict[str, Any]) -> None:
        expected = fixture["error"]
        self.assertEqual(actual.code, expected["code"])
        self.assertEqual(str(actual), expected["message"])
        self.assertEqual(actual.recoverable, expected["recoverable"])


def load_fixture_file(file_name: str) -> Any:
    return json.loads((CONTRACT / "fixtures" / file_name).read_text(encoding="utf-8"))


def backend_envelope(command: str, payload: dict[str, Any], request_id: str | None) -> dict[str, Any]:
    envelope: dict[str, Any] = {
        "schemaVersion": BACKEND_REQUEST_SCHEMA_VERSION,
        "command": command,
        "payload": payload,
    }
    if request_id is not None:
        envelope["requestId"] = request_id
    return envelope


def normalize_dynamic(value: Any, key: str | None = None) -> Any:
    if isinstance(value, list):
        return [normalize_dynamic(item, key) for item in value]
    if isinstance(value, dict):
        return {
            item_key: normalize_dynamic(item_value, item_key)
            for item_key, item_value in sorted(value.items())
        }
    if isinstance(value, str):
        if key in {"timestamp", "startedAt", "endedAt", "createdAt"} and ISO_RE.fullmatch(value):
            return "<iso-timestamp>"
        if key == "id" and value.startswith("chatgpt-browser-"):
            return "<chatgpt-response-id>"
        return value
    if key == "created_at" and isinstance(value, int):
        return "<created-at>"
    return value


if __name__ == "__main__":
    unittest.main()
