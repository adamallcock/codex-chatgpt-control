import unittest

from codex_chatgpt_control import (
    ApplyConfigurationData,
    ConfigurationInspectionData,
    DetectExperienceData,
    StartWorkData,
    SurfaceProfile,
    WorkStatusData,
)


class SurfaceModelTests(unittest.TestCase):
    def test_experience_and_configuration_models_preserve_wire_aliases(self) -> None:
        detected = DetectExperienceData.from_wire({
            "experience": "work",
            "selectorProfile": "work_advanced_v1",
            "confidence": "high",
            "evidence": [{"source": "composer", "label": "Work on anything"}],
        })
        inspection = ConfigurationInspectionData.from_wire(configuration_wire())
        applied = ApplyConfigurationData.from_wire({
            "requested": {"model": "GPT-5.6 Sol", "effort": "High"},
            "selected": [
                {"axis": "model", "requested": "GPT-5.6 Sol", "selected": "GPT-5.6 Sol"},
                {"axis": "effort", "requested": "High", "selected": "High"},
            ],
            "before": configuration_wire(effort="Light"),
            "after": configuration_wire(effort="High"),
            "verified": True,
        })

        self.assertEqual(detected.selector_profile, "work_advanced_v1")
        self.assertEqual(inspection.available_axes, ["model", "effort", "speed"])
        self.assertEqual(applied.after.active["effort"], "High")
        self.assertEqual(detected.to_wire()["selectorProfile"], "work_advanced_v1")

    def test_work_models_capture_task_and_progress(self) -> None:
        started = StartWorkData.from_wire({
            "task": {
                "url": "https://chatgpt.com/c/sanitized",
                "conversationId": "sanitized",
                "baselineTurnCount": 0,
            },
            "submitted": {"submitted": True, "submissionState": "submitted"},
        })
        status = WorkStatusData.from_wire({
            "experience": "work",
            "task": started.task.to_wire(),
            "message": {
                "turnCount": 2,
                "assistantTurnCount": 1,
                "completionState": "generating",
                "generationActive": True,
            },
        })

        self.assertEqual(started.task.conversation_id, "sanitized")
        self.assertEqual(status.experience, "work")
        self.assertTrue(status.message["generationActive"])

    def test_surface_profile_keeps_rollout_context_without_inferring_entitlements(self) -> None:
        profile = SurfaceProfile.from_wire({
            "schemaVersion": "chatgpt.browser_control.surface_profile.v1",
            "id": "work-basic-en",
            "observedAt": "2026-07-15",
            "provenance": "Sanitized observed profile.",
            "locale": "en-US",
            "region": "not-recorded",
            "accountScope": "not-recorded",
            "planScope": "not-recorded",
            "workspaceScope": "not-recorded",
            "supportState": "current",
            "snapshot": {},
            "panel": {},
            "menuItems": [],
            "expected": {},
        })

        self.assertEqual(profile.support_state, "current")
        self.assertEqual(profile.plan_scope, "not-recorded")
        self.assertEqual(profile.to_wire()["workspaceScope"], "not-recorded")


def configuration_wire(*, effort: str = "Light") -> dict:
    return {
        "experience": "work",
        "selectorProfile": "work_advanced_v1",
        "availableAxes": ["model", "effort", "speed"],
        "active": {
            "model": "GPT-5.6 Sol",
            "effort": effort,
            "speed": "Standard",
        },
        "options": {
            "effort": [
                {"id": "light", "label": "Light", "selected": effort == "Light"},
                {"id": "high", "label": "High", "selected": effort == "High"},
            ]
        },
        "verified": True,
        "evidence": [{"source": "composer", "label": "Work on anything"}],
    }


if __name__ == "__main__":
    unittest.main()
