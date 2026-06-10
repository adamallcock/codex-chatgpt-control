import json
import unittest
from pathlib import Path

from codex_chatgpt_control.models import (
    BackendCapabilities,
    BackendEvent,
    CapabilityCheck,
    BackendResponse,
    ChatGPTAgentModel,
    ChatGPTRunInput,
    ChatGPTRunResult,
    ChatGPTResponse,
    CommandDescriptor,
    CommandResult,
    DoctorReport,
    FilePreflightData,
    ProjectSourcesAddPlanData,
    RunReportData,
    SequencePlan,
)


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "node" / "contracts" / "v1" / "fixtures"


def load_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def load_ndjson(name: str) -> list[dict]:
    return [
        json.loads(line)
        for line in (FIXTURES / name).read_text(encoding="utf-8").strip().splitlines()
    ]


class CompleteModelTests(unittest.TestCase):
    def test_agent_fixture_uses_python_aliases_and_wire_names(self) -> None:
        agent = ChatGPTAgentModel.from_wire(load_json("runner-full-agent-config.json"))

        self.assertEqual(agent.name, "parity-reviewer")
        self.assertEqual(agent.instructions_mode, "visible_prefix")
        self.assertIsNotNone(agent.output)
        assert agent.output is not None
        self.assertEqual(agent.output["parse"], "json")
        self.assertIn("instructionsMode", agent.to_wire())
        self.assertNotIn("instructions_mode", agent.to_wire())

    def test_sequence_plan_fixture_parses_steps_and_policy(self) -> None:
        plan = SequencePlan.from_wire(load_json("runner-input-items-and-files-plan.json"))

        self.assertEqual(plan.name, "agent-run:file-agent")
        self.assertIn("files.attach", [step.command for step in plan.steps])
        self.assertIsNotNone(plan.policy)
        assert plan.policy is not None
        self.assertTrue(plan.policy.stop_on_error)
        self.assertIn("stopOnError", plan.to_wire()["policy"])

    def test_command_result_fixture_parses_redacted_report_output(self) -> None:
        result = CommandResult.from_wire(load_json("report-redaction-default.json")["result"])

        self.assertTrue(result.ok)
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.data["prompt"], "[redacted:19 chars]")
        self.assertEqual(result.context["timestamp"], "2026-06-06T00:00:00.000Z")

    def test_command_descriptor_fixture_parses_descriptor(self) -> None:
        descriptor = CommandDescriptor.from_wire(load_json("describe-runner-run.json"))

        self.assertEqual(descriptor.name, "runner.run")
        self.assertEqual(descriptor.layer, "workflow")
        self.assertEqual(descriptor.default_timeout_ms, 120000)
        self.assertIn("defaultTimeoutMs", descriptor.to_wire())

    def test_backend_capabilities_and_response_models_parse_backend_fixtures(self) -> None:
        capabilities = BackendCapabilities.from_wire(load_json("backend-capabilities.json"))
        version = BackendResponse.from_wire(load_json("backend-version.json"))

        self.assertEqual(capabilities.protocol_version, "chatgpt.browser_control.backend_request.v1")
        self.assertIn("stdio", capabilities.transports)
        self.assertTrue(version.ok)
        self.assertEqual(version.result["runtime"], "node")

    def test_backend_event_completed_result_parses_nested_run_result(self) -> None:
        event = BackendEvent.from_wire(load_ndjson("stream-submitted-completed.ndjson")[-1])

        self.assertEqual(event.type, "completed")
        self.assertIsNotNone(event.result)
        self.assertIsInstance(event.result, ChatGPTRunResult)
        assert isinstance(event.result, ChatGPTRunResult)
        self.assertEqual(event.result.status, "ok")
        self.assertEqual(event.result.final_output, "done")

    def test_response_unsupported_fields_parse_new_fixtures(self) -> None:
        hidden = ChatGPTResponse.from_wire(load_json("responses-hidden-instructions-unsupported.json")["response"])
        unknown = ChatGPTResponse.from_wire(load_json("responses-unknown-field-unsupported.json")["response"])

        self.assertEqual(hidden.unsupported_fields[0]["path"], "instructions")
        self.assertEqual(unknown.unsupported_fields[0]["path"], "unknown_control")

    def test_run_input_report_and_doctor_models_are_available(self) -> None:
        run_input = ChatGPTRunInput.from_wire({
            "input": "Review this.",
            "thread": {"type": "new"},
            "existingTab": True,
            "preferExistingTab": True,
            "attachments": [{"path": "/tmp/context.md"}],
            "response": {"format": "markdown"},
        })
        report = RunReportData.from_wire({"path": "reports/run.json", "bytes": 123})
        doctor = DoctorReport.from_wire({
            "checks": {
                "bridge": {"status": "ok", "message": "Bridge available."}
            }
        })

        self.assertEqual(run_input.input, "Review this.")
        self.assertTrue(run_input.existing_tab)
        self.assertTrue(run_input.prefer_existing_tab)
        self.assertIsNotNone(run_input.attachments)
        assert run_input.attachments is not None
        self.assertEqual(run_input.attachments[0]["path"], "/tmp/context.md")
        self.assertEqual(report.path, "reports/run.json")
        self.assertEqual(doctor.checks["bridge"].status, "ok")

    def test_doctor_report_parses_scenario_preflight_fixture(self) -> None:
        result = CommandResult.from_wire(load_json("doctor-scenario-preflight.json")["result"])
        doctor = DoctorReport.from_wire(result.data)

        self.assertFalse(doctor.ready)
        self.assertIsInstance(doctor.checks["existing_tab"], CapabilityCheck)
        self.assertEqual(doctor.checks["existing_tab"].status, "blocked")
        self.assertEqual(doctor.checks["existing_tab"].blocker_kind, "not_found")
        self.assertEqual(doctor.checks["existing_tab"].code, "existing_tab_not_found")
        self.assertEqual(doctor.checks["existing_tab"].next_command, "session.bootstrap")
        self.assertIsNotNone(doctor.checks["existing_tab"].details)
        assert doctor.checks["existing_tab"].details is not None
        self.assertEqual(
            doctor.checks["existing_tab"].details["existingTab"]["mismatchReason"],
            "conversation_id_mismatch",
        )
        self.assertEqual(doctor.checks["localization"].status, "unknown")
        self.assertEqual(doctor.checks["reports"].status, "unknown")
        self.assertEqual(doctor.checks["file_preflight"].status, "ok")
        self.assertIsNotNone(doctor.checks["file_preflight"].details)
        assert doctor.checks["file_preflight"].details is not None
        self.assertEqual(doctor.checks["file_preflight"].details["totalBytes"], 16)
        self.assertIn("blockerKind", doctor.to_wire()["checks"]["existing_tab"])

    def test_file_preflight_fixture_parses_metadata_aliases(self) -> None:
        result = CommandResult.from_wire(load_json("files-preflight-success.json")["result"])
        data = FilePreflightData.from_wire(result.data)

        self.assertTrue(result.ok)
        self.assertEqual(data.total_bytes, 16)
        self.assertEqual(data.files[0].name, "spec.md")
        self.assertEqual(data.files[0].mime_type, "text/markdown")
        self.assertIn("mimeType", data.to_wire()["files"][0])

    def test_project_sources_plan_add_fixture_parses_aliases(self) -> None:
        result = CommandResult.from_wire(load_json("project-sources-plan-add.json")["result"])
        data = ProjectSourcesAddPlanData.from_wire(result.data)

        self.assertTrue(result.ok)
        self.assertEqual(data.project_url, "https://chatgpt.com/g/g-p-example/project")
        self.assertEqual(data.total_bytes, 16)
        self.assertEqual(data.files[0].display_path, data.files[0].path)
        self.assertEqual(data.batches[0].total_bytes, 5)
        self.assertIn("displayPath", data.to_wire()["files"][0])


if __name__ == "__main__":
    unittest.main()
