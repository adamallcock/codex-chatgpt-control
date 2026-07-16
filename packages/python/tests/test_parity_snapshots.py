import json
import unittest
from pathlib import Path

from codex_chatgpt_control import BackendRequest, ChatGPTResponse, ChatGPTRunResult, ChatGPTStreamEvent
from codex_chatgpt_control.models import (
    BackendCapabilities,
    BackendEvent,
    BackendResponse,
    ChatGPTAgentModel,
    CommandDescriptor,
    CommandResult,
    SequencePlan,
    SurfaceProfile,
)


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "node" / "contracts" / "v1"


class PythonParitySnapshotTests(unittest.TestCase):
    def test_all_json_fixtures_round_trip_to_wire(self) -> None:
        manifest = json.loads((CONTRACT / "manifest.json").read_text(encoding="utf-8"))

        for fixture in manifest["fixtures"]:
            if fixture["file"].endswith(".ndjson"):
                continue

            with self.subTest(fixture=fixture["file"]):
                payload = json.loads(
                    (CONTRACT / "fixtures" / fixture["file"]).read_text(encoding="utf-8")
                )
                if fixture["schema"] == "runResult":
                    model = ChatGPTRunResult.from_wire(payload["result"])
                elif fixture["schema"] == "response":
                    model = ChatGPTResponse.from_wire(payload["response"])
                elif fixture["schema"] == "commandResult":
                    model = CommandResult.from_wire(payload["result"])
                elif fixture["schema"] == "commandDescriptor":
                    model = CommandDescriptor.from_wire(payload)
                elif fixture["schema"] == "sequencePlan":
                    model = SequencePlan.from_wire(payload)
                elif fixture["schema"] == "agent":
                    model = ChatGPTAgentModel.from_wire(payload)
                elif fixture["schema"] == "capabilities":
                    model = BackendCapabilities.from_wire(payload)
                elif fixture["schema"] == "backendResponse":
                    model = BackendResponse.from_wire(payload)
                elif fixture["schema"] == "backendEvent":
                    model = BackendEvent.from_wire(payload)
                elif fixture["schema"] == "backendRequest":
                    request = BackendRequest(
                        command=payload["command"],
                        payload=payload.get("payload", {}),
                        request_id=payload.get("requestId"),
                    )
                    self.assertEqual(request.to_wire(), payload)
                    continue
                elif fixture["schema"] == "surfaceProfile":
                    model = SurfaceProfile.from_wire(payload)
                else:
                    self.fail(f"Unhandled JSON fixture schema {fixture['schema']} for {fixture['file']}")

                wire = model.to_wire()
                self.assertEqual(model.__class__.from_wire(wire).to_wire(), wire)
                self.assertNotIn("final_output", wire)
                self.assertNotIn("new_items", wire)

    def test_all_stream_fixtures_round_trip_to_wire(self) -> None:
        manifest = json.loads((CONTRACT / "manifest.json").read_text(encoding="utf-8"))

        for fixture in manifest["fixtures"]:
            if not fixture["file"].endswith(".ndjson"):
                continue

            with self.subTest(fixture=fixture["file"]):
                events = [
                    json.loads(line)
                    for line in (CONTRACT / "fixtures" / fixture["file"])
                    .read_text(encoding="utf-8")
                    .strip()
                    .splitlines()
                ]
                self.assertGreater(len(events), 0)
                event_model = BackendEvent if fixture["schema"] == "backendEvent" else ChatGPTStreamEvent
                for event in events:
                    model = event_model.from_wire(event)
                    wire = model.to_wire()
                    self.assertEqual(event_model.from_wire(wire).to_wire(), wire)

    def test_existing_tab_diagnostics_fixture_preserves_metadata_only(self) -> None:
        payload = json.loads(
            (CONTRACT / "fixtures" / "existing-tab-diagnostics-blocker.json").read_text(encoding="utf-8")
        )
        model = CommandResult.from_wire(payload["result"])
        wire = model.to_wire()
        diagnostics = wire["blocker"]["diagnostics"]["existingTab"]

        self.assertEqual(diagnostics["requestedTarget"], {
            "type": "conversationId",
            "conversationId": "abc-123",
        })
        self.assertEqual(diagnostics["mismatchReason"], "conversation_id_mismatch")
        self.assertEqual(diagnostics["candidateTabs"][0]["conversationId"], "other")
        self.assertNotIn("visibleText", diagnostics)
        self.assertNotIn("content", diagnostics["candidateTabs"][0])


if __name__ == "__main__":
    unittest.main()
