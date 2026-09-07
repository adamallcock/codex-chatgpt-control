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
from codex_chatgpt_control.operation_models import (
    BackendCompatibilityReport,
    OperationActionRecord,
    OperationArtifactReceipt,
    OperationBlocker,
    OperationCollectRequest,
    OperationControlReceipt,
    OperationControlRequest,
    OperationEventEnvelope,
    OperationHandle,
    OperationInspectRequest,
    OperationReceipt,
    OperationState,
    OperationSubmissionWitness,
    OperationSubmitRequest,
    validate_recovery_payload,
)
from codex_chatgpt_control.operations import (
    OperationCollectResult,
    OperationControlResult,
    OperationInspectResult,
    OperationSubmitResult,
)


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "node" / "contracts" / "v1"

OPERATION_FIXTURE_MODELS = {
    "operationAction": OperationActionRecord,
    "operationArtifactReceipt": OperationArtifactReceipt,
    "operationBlocker": OperationBlocker,
    "operationCollectRequest": OperationCollectRequest,
    "operationCollectResult": OperationCollectResult,
    "operationControlReceipt": OperationControlReceipt,
    "operationControlRequest": OperationControlRequest,
    "operationControlResult": OperationControlResult,
    "operationEvent": OperationEventEnvelope,
    "operationHandle": OperationHandle,
    "operationInspectRequest": OperationInspectRequest,
    "operationInspectResult": OperationInspectResult,
    "operationReceipt": OperationReceipt,
    "operationRequest": OperationSubmitRequest,
    "operationState": OperationState,
    "operationSubmissionWitness": OperationSubmissionWitness,
    "operationSubmitResult": OperationSubmitResult,
}


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
                elif fixture["schema"] == "backendCompatibility":
                    model = BackendCompatibilityReport.from_wire(payload)
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
                elif fixture["schema"] == "operationRecovery":
                    model = validate_recovery_payload(payload)
                elif fixture["schema"] in OPERATION_FIXTURE_MODELS:
                    model = OPERATION_FIXTURE_MODELS[fixture["schema"]].from_wire(payload)
                else:
                    self.fail(f"Unhandled JSON fixture schema {fixture['schema']} for {fixture['file']}")

                wire = model.to_wire()
                self.assertEqual(model.__class__.from_wire(wire).to_wire(), wire)
                self.assertNotIn("final_output", wire)
                self.assertNotIn("new_items", wire)

    def test_journal_runtime_blocker_round_trips_without_losing_nonretryable_remediation(self) -> None:
        payload = json.loads((CONTRACT / "fixtures" / "journal-runtime-unavailable.json").read_text(encoding="utf-8"))["result"]
        model = CommandResult.from_wire(payload)

        self.assertEqual(model.to_wire(), payload)
        assert model.blocker is not None
        assert model.error is not None
        self.assertEqual(model.blocker["kind"], "unknown")
        self.assertEqual(model.blocker["code"], "journal_runtime_unavailable")
        self.assertFalse(model.blocker["resumable"])
        self.assertFalse(model.error["recoverable"])
        self.assertFalse(model.blocker["remediation"][0]["userActionRequired"])

    def test_indeterminate_journal_authority_preserves_identity_and_nonretryable_status(self) -> None:
        payload = json.loads((CONTRACT / "fixtures" / "journal-rpc-indeterminate.json").read_text(encoding="utf-8"))["result"]
        model = CommandResult.from_wire(payload)

        self.assertEqual(model.to_wire(), payload)
        self.assertEqual(model.status, "partial")
        self.assertEqual(model.data["operationId"], "123e4567-e89b-42d3-a456-426614174000")
        assert model.blocker is not None
        assert model.error is not None
        self.assertEqual(model.blocker["code"], "journal_rpc_outcome_indeterminate")
        self.assertFalse(model.blocker["resumable"])
        self.assertFalse(model.error["recoverable"])
        self.assertIn("same operation identity", model.blocker["remediation"][0]["instruction"])
        self.assertNotIn("Private transport", str(model.to_wire()))

    def test_unsupported_journal_transport_platform_preserves_nonretryable_guidance(self) -> None:
        payload = json.loads((CONTRACT / "fixtures" / "journal-rpc-unsupported-platform.json").read_text(encoding="utf-8"))["result"]
        model = CommandResult.from_wire(payload)

        self.assertEqual(model.to_wire(), payload)
        self.assertEqual(model.status, "blocked")
        assert model.blocker is not None
        assert model.error is not None
        self.assertEqual(model.blocker["code"], "journal_rpc_unsupported_platform")
        self.assertFalse(model.blocker["resumable"])
        self.assertFalse(model.error["recoverable"])
        self.assertIn("ordinary Node browser host", model.blocker["remediation"][0]["instruction"])
        self.assertIn("POSIX", model.blocker["message"])
        self.assertNotIn("Private transport", str(model.to_wire()))

    def test_download_receipt_timeout_preserves_unverified_nonretryable_result(self) -> None:
        payload = json.loads((CONTRACT / "fixtures" / "download-receipt-timeout.json").read_text(encoding="utf-8"))["result"]
        model = CommandResult.from_wire(payload)

        self.assertEqual(model.to_wire(), payload)
        self.assertEqual(model.status, "blocked")
        self.assertIsNone(model.data)
        assert model.blocker is not None
        assert model.error is not None
        self.assertEqual(model.blocker["code"], "download_receipt_timeout")
        self.assertFalse(model.blocker["resumable"])
        self.assertFalse(model.error["recoverable"])
        self.assertIn("Completion is unverified", model.blocker["message"])

    def test_browser_blocked_download_preserves_nonretryable_result_without_receipt(self) -> None:
        payload = json.loads((CONTRACT / "fixtures" / "download-blocked-by-browser.json").read_text(encoding="utf-8"))["result"]
        model = CommandResult.from_wire(payload)

        self.assertEqual(model.to_wire(), payload)
        self.assertFalse(model.ok)
        self.assertEqual(model.status, "blocked")
        self.assertIsNone(model.data)
        assert model.blocker is not None
        assert model.error is not None
        self.assertEqual(model.blocker["kind"], "download_unavailable")
        self.assertEqual(model.blocker["code"], "download_blocked_by_browser")
        self.assertFalse(model.blocker["resumable"])
        self.assertEqual(model.error["name"], "DownloadBrowserBlockedError")
        self.assertFalse(model.error["recoverable"])
        self.assertEqual(model.error["message"], model.blocker["message"])
        self.assertIn("Chrome displayed ERR_BLOCKED_BY_CLIENT", model.blocker["message"])
        self.assertIn("completion is unverified", model.blocker["message"])

    def test_native_download_failure_preserves_sanitized_nonretryable_result(self) -> None:
        payload = json.loads((CONTRACT / "fixtures" / "download-receipt-failed.json").read_text(encoding="utf-8"))["result"]
        model = CommandResult.from_wire(payload)

        self.assertEqual(model.to_wire(), payload)
        self.assertFalse(model.ok)
        self.assertEqual(model.status, "blocked")
        self.assertIsNone(model.data)
        assert model.blocker is not None
        assert model.error is not None
        self.assertEqual(model.blocker["kind"], "download_unavailable")
        self.assertEqual(model.blocker["code"], "download_receipt_failed")
        self.assertFalse(model.blocker["resumable"])
        self.assertEqual(model.error["name"], "DownloadReceiptFailedError")
        self.assertFalse(model.error["recoverable"])
        self.assertEqual(model.error["message"], model.blocker["message"])
        self.assertIn("completion is unverified", model.blocker["message"])
        self.assertNotIn("Private transport", str(model.to_wire()))

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

    def test_indeterminate_mutation_fixtures_remain_non_resumable(self) -> None:
        expectations = {
            "messages-stop-indeterminate.json": ("timeout", "stop_generation_unverified"),
            "files-attach-indeterminate.json": ("partial", "attachment_outcome_indeterminate"),
        }

        for file_name, (status, code) in expectations.items():
            with self.subTest(fixture=file_name):
                payload = json.loads((CONTRACT / "fixtures" / file_name).read_text(encoding="utf-8"))
                model = BackendResponse.from_wire(payload)
                wire = model.to_wire()

                self.assertEqual(wire["result"]["status"], status)
                self.assertEqual(wire["result"]["blocker"]["code"], code)
                self.assertIs(wire["result"]["blocker"]["resumable"], False)
                self.assertIn("data", wire["result"])


if __name__ == "__main__":
    unittest.main()
