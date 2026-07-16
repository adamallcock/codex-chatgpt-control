import unittest

from codex_chatgpt_control import Agent, ChatGPTAgentModel


class AgentTests(unittest.TestCase):
    def test_name_is_normalized(self) -> None:
        agent = Agent(name=" reviewer ")

        self.assertEqual(agent.name, "reviewer")

    def test_empty_name_fails(self) -> None:
        with self.assertRaises(ValueError):
            Agent(name="  ")

    def test_defaults_to_visible_prefix_instructions_mode(self) -> None:
        agent = Agent(name="reviewer")

        self.assertEqual(agent.instructions_mode, "visible_prefix")

    def test_full_config_round_trips_to_wire(self) -> None:
        agent = Agent(
            name="reviewer",
            instructions="Review deeply.",
            defaults={"wait": {"stableMs": 0}, "read": {"format": "markdown"}},
            tools=[{"name": "web search", "command": "tools.select", "risk": "medium"}],
            guardrails=[{"name": "redact", "scope": "report"}],
            output={"parse": "json", "onParseError": "error"},
            metadata={"team": "sdk"},
        )

        wire = agent.to_wire()

        self.assertEqual(wire["kind"], "chatgpt_browser_agent")
        self.assertEqual(wire["name"], "reviewer")
        self.assertEqual(wire["instructionsMode"], "visible_prefix")
        self.assertEqual(wire["defaults"]["wait"]["stableMs"], 0)
        self.assertEqual(wire["tools"][0]["command"], "tools.select")
        self.assertNotIn("instructions_mode", wire)
        self.assertEqual(ChatGPTAgentModel.from_wire(wire).kind, "chatgpt_browser_agent")

    def test_surface_defaults_recursively_normalize_to_wire(self) -> None:
        agent = Agent(
            name="work-reviewer",
            defaults={
                "experience": "work",
                "configuration": {
                    "model": "GPT-5.6 Sol",
                    "model_version": "5.6",
                },
            },
        )

        wire = agent.to_wire()

        self.assertEqual(wire["defaults"]["experience"], "work")
        self.assertEqual(
            wire["defaults"]["configuration"],
            {"model": "GPT-5.6 Sol", "modelVersion": "5.6"},
        )


if __name__ == "__main__":
    unittest.main()
