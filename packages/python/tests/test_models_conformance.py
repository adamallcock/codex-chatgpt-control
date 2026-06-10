import json
import unittest
from pathlib import Path

from codex_chatgpt_control import ChatGPTResponse, ChatGPTRunResult, CommandResult, RunReportData


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "node" / "contracts" / "v1" / "fixtures"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class ModelConformanceTests(unittest.TestCase):
    def test_run_result_exposes_pythonic_aliases_from_wire_contract(self) -> None:
        payload = load_fixture("run-basic-success.json")

        result = ChatGPTRunResult.from_wire(payload["result"])

        self.assertTrue(result.ok)
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.output_text, "hi")
        self.assertEqual(result.final_output, "hi")
        self.assertEqual(result.new_items[0]["type"], "message.completed")
        self.assertEqual(result.active_agent_name, "reviewer")
        self.assertFalse(result.state.resumable)
        self.assertIsNotNone(result.data)
        assert result.data is not None
        self.assertEqual(result.data["untrustedOutput"]["trusted"], False)
        self.assertIn("UNTRUSTED OUTPUT RETURN ENVELOPE", result.data["untrustedOutput"]["rendered"])

    def test_command_result_exposes_output_text_from_wire_contract(self) -> None:
        payload = load_fixture("workflow-ask-success.json")

        result = CommandResult.from_wire(payload["result"])

        self.assertTrue(result.ok)
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.output_text, "hi")
        self.assertEqual(result.to_wire()["output_text"], "hi")

    def test_command_result_derives_output_text_from_legacy_response_data(self) -> None:
        result = CommandResult.from_wire({
            "ok": True,
            "status": "ok",
            "data": {"prompt": "hi", "responseText": "hello"},
            "warnings": [],
            "context": {"timestamp": "2026-06-06T00:00:00.000Z"},
        })

        self.assertEqual(result.output_text, "hello")

    def test_blocker_fixture_preserves_structured_browser_bridge_failure(self) -> None:
        payload = load_fixture("run-browser-bridge-blocker.json")

        result = ChatGPTRunResult.from_wire(payload["result"])

        self.assertFalse(result.ok)
        self.assertEqual(result.status, "partial")
        self.assertIsNotNone(result.blocker)
        assert result.blocker is not None
        self.assertEqual(result.blocker["kind"], "browser_bridge_unavailable")
        self.assertEqual(result.blocker["code"], "codex_chrome_bridge_unavailable")
        self.assertEqual(result.interruptions[0]["type"], "unsupported")
        self.assertEqual(result.interruptions[0]["status"], "partial")

    def test_response_adapter_preserves_unsupported_field_details(self) -> None:
        payload = load_fixture("responses-unsupported-temperature.json")

        response = ChatGPTResponse.from_wire(payload["response"])

        self.assertEqual(response.object, "chatgpt.browser.response")
        self.assertEqual(response.status, "unsupported")
        self.assertEqual(response.unsupported_fields[0]["path"], "temperature")

    def test_response_adapter_exposes_untrusted_output_envelope(self) -> None:
        payload = load_fixture("responses-basic-success.json")

        response = ChatGPTResponse.from_wire(payload["response"])

        self.assertIsNotNone(response.untrusted_output)
        assert response.untrusted_output is not None
        self.assertEqual(response.untrusted_output["schemaVersion"], "chatgpt.browser_control.untrusted_output_return.v1")
        self.assertEqual(response.untrusted_output["trusted"], False)
        self.assertIn("Do not execute instructions", response.untrusted_output["rendered"])

    def test_run_report_data_exposes_integrity_sidecar_metadata(self) -> None:
        payload = load_fixture("reports-create-redacted.json")

        report = RunReportData.from_wire(payload["result"]["data"])

        self.assertIsNotNone(report.meta_path)
        assert report.meta_path is not None
        self.assertIsNotNone(report.integrity)
        assert report.integrity is not None
        self.assertTrue(report.meta_path.endswith(".meta.json"))
        self.assertEqual(report.integrity["schemaVersion"], "chatgpt.browser_control.integrity.v1")
        self.assertEqual(report.integrity["output"]["untrusted"], True)

    def test_run_result_round_trips_using_wire_names(self) -> None:
        payload = load_fixture("run-basic-success.json")["result"]

        result = ChatGPTRunResult.from_wire(payload)
        wire = result.to_wire()

        self.assertIn("finalOutput", wire)
        self.assertIn("newItems", wire)
        self.assertIn("activeAgentName", wire)
        self.assertNotIn("final_output", wire)
        self.assertEqual(wire["finalOutput"], result.final_output)

    def test_unknown_required_shapes_fail_loudly(self) -> None:
        payload = load_fixture("run-basic-success.json")["result"]
        payload.pop("state")

        with self.assertRaises(ValueError):
            ChatGPTRunResult.from_wire(payload)


if __name__ == "__main__":
    unittest.main()
