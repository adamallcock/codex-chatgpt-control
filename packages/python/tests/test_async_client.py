import unittest

from codex_chatgpt_control.async_client import AsyncChatGPT


class FakeAsyncBackend:
    def __init__(self) -> None:
        self.requests: list[tuple[str, dict]] = []
        self.stream_requests: list[tuple[str, dict]] = []

    async def request(self, command: str, payload: dict | None = None):
        payload = payload or {}
        self.requests.append((command, payload))
        if command == "runner.run":
            return run_result(payload["agent"]["name"], "async-ok")
        if command == "runner.plan":
            return {
                "name": f"agent-run:{payload['agent']['name']}",
                "steps": [{"id": "ask", "command": "messages.ask", "args": {"text": payload["input"]}}],
            }
        if command == "responses.create":
            return {
                "id": "chatgpt-browser-async",
                "object": "chatgpt.browser.response",
                "created_at": 1780704000,
                "status": "ok",
                "output_text": "async-response",
                "output": [],
                "browser_control": {"visibleUi": True, "resultStatus": "ok"},
            }
        if command == "commands":
            return [{
                "name": "runner.run",
                "layer": "workflow",
                "summary": "Run agent.",
                "risk": "medium",
                "args": {},
                "defaults": {},
                "retryPolicy": "retry-safe",
                "blockers": [],
                "examples": [],
            }]
        if command == "describe":
            return {
                "name": payload["name"],
                "layer": "workflow",
                "summary": "Describe command.",
                "risk": "medium",
                "args": {},
                "defaults": {},
                "retryPolicy": "retry-safe",
                "blockers": [],
                "examples": [],
            }
        if command == "help":
            return "help text"
        return command_result({"command": command, "payload": payload})

    async def stream(self, command: str, payload: dict | None = None):
        payload = payload or {}
        self.stream_requests.append((command, payload))
        yield {
            "schemaVersion": "chatgpt.browser_control.backend_event.v1",
            "type": "run_item_stream_event",
            "name": "message_completed",
            "item": {"type": "message.completed"},
        }
        yield {
            "schemaVersion": "chatgpt.browser_control.backend_event.v1",
            "type": "completed",
            "result": run_result(payload["agent"]["name"], "stream-ok"),
        }


class FakeLegacyAsyncTransport:
    def __init__(self) -> None:
        self.requests = []

    async def run(self, payload: dict) -> dict:
        self.requests.append(payload)
        return run_result(payload["agent"]["name"], "legacy-ok")


class AsyncClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_runner_uses_backend_protocol_request(self) -> None:
        backend = FakeAsyncBackend()
        chatgpt = AsyncChatGPT(transport=backend)
        agent = chatgpt.agent(name="reviewer", instructions="Review deeply.")

        result = await chatgpt.runner.run(agent, input="hi")

        self.assertEqual(result.final_output, "async-ok")
        self.assertEqual(backend.requests[0][0], "runner.run")
        self.assertEqual(backend.requests[0][1]["agent"]["kind"], "chatgpt_browser_agent")
        self.assertEqual(backend.requests[0][1]["input"], "hi")

    async def test_async_runner_plan_and_stream_use_backend_protocol(self) -> None:
        backend = FakeAsyncBackend()
        chatgpt = AsyncChatGPT(transport=backend)
        agent = chatgpt.agent(name="planner")

        plan = await chatgpt.runner.plan(agent, "draft")
        stream = chatgpt.runner.run_streamed(agent, "hi")
        events = [event async for event in stream]

        self.assertEqual(plan.name, "agent-run:planner")
        self.assertEqual(backend.requests[0][0], "runner.plan")
        self.assertEqual(backend.stream_requests[0][0], "runner.stream")
        self.assertEqual(events[0].name, "message_completed")
        self.assertIsNotNone(stream.final_result)
        assert stream.final_result is not None
        self.assertEqual(stream.final_result.final_output, "stream-ok")

    async def test_async_responses_create_uses_backend_protocol(self) -> None:
        backend = FakeAsyncBackend()
        chatgpt = AsyncChatGPT(transport=backend)

        response = await chatgpt.responses.create(
            {
                "input": "hi",
                "thread": {"type": "new"},
                "text": {"format": "normalized_text"},
                "stream": False,
            }
        )

        self.assertEqual(response.object, "chatgpt.browser.response")
        self.assertEqual(response.status, "ok")
        self.assertEqual(response.output_text, "async-response")
        self.assertEqual(backend.requests[0][0], "responses.create")

    async def test_async_responses_unsupported_fields_do_not_submit(self) -> None:
        backend = FakeAsyncBackend()
        chatgpt = AsyncChatGPT(transport=backend)

        response = await chatgpt.responses.create({"input": "hi", "temperature": 0.2})

        self.assertEqual(response.status, "unsupported")
        self.assertEqual([field["path"] for field in response.unsupported_fields], ["temperature"])
        self.assertEqual(backend.requests, [])

    async def test_async_workflows_primitives_reports_and_commands_use_backend_protocol(self) -> None:
        backend = FakeAsyncBackend()
        chatgpt = AsyncChatGPT(transport=backend)

        ask = await chatgpt.ask(prompt="hi")
        bootstrap = await chatgpt.session.bootstrap(prefer_existing_tab=False)
        experience = await chatgpt.experience.detect()
        opened = await chatgpt.experience.open(experience="work")
        configuration = await chatgpt.configuration.apply(
            experience="work",
            desired={"model": "GPT-5.6 Sol", "model_version": "5.6"},
        )
        work_start = await chatgpt.work.start(prompt="Analyze.", new_task=True)
        work_status = await chatgpt.work.status(include_artifacts=False)
        work_artifact = await chatgpt.work.artifacts.list_latest(kind="image")
        status = await chatgpt.messages.status(max_preview_chars=120)
        artifact = await chatgpt.artifacts.wait(kind="image", require_download=True)
        project_sources = await chatgpt.projects.sources.plan_add(
            project_url="https://chatgpt.com/g/g-p-example/project",
            files=["/tmp/a.txt"],
        )
        mode_set = await chatgpt.modes.set(model="Pro")
        mode_get = await chatgpt.modes.get()
        report = await chatgpt.reports.redact({"prompt": "private"})
        commands = await chatgpt.commands()
        described = await chatgpt.describe("runner.run")
        help_text = await chatgpt.help()

        self.assertEqual(ask.data["command"], "ask")
        self.assertEqual(bootstrap.data["command"], "session.bootstrap")
        self.assertEqual(experience.data["command"], "experience.detect")
        self.assertEqual(opened.data["command"], "experience.open")
        self.assertEqual(configuration.data["command"], "configuration.apply")
        self.assertEqual(work_start.data["command"], "work.start")
        self.assertEqual(work_status.data["command"], "work.status")
        self.assertEqual(work_artifact.data["command"], "artifacts.listLatest")
        self.assertEqual(status.data["command"], "messages.status")
        self.assertEqual(artifact.data["command"], "artifacts.wait")
        self.assertEqual(project_sources.data["command"], "projects.sources.planAdd")
        self.assertEqual(mode_set.data["command"], "modes.set")
        self.assertEqual(mode_get.data["command"], "modes.get")
        self.assertEqual(report.data["command"], "reports.redact")
        self.assertEqual(commands[0].name, "runner.run")
        self.assertEqual(described.name, "runner.run")
        self.assertEqual(help_text, "help text")
        self.assertEqual([request[0] for request in backend.requests], [
            "ask",
            "session.bootstrap",
            "experience.detect",
            "experience.open",
            "configuration.apply",
            "work.start",
            "work.status",
            "artifacts.listLatest",
            "messages.status",
            "artifacts.wait",
            "projects.sources.planAdd",
            "modes.set",
            "modes.get",
            "reports.redact",
            "commands",
            "describe",
            "help",
        ])
        self.assertEqual(
            next(payload for command, payload in backend.requests if command == "configuration.apply"),
            {
                "experience": "work",
                "desired": {"model": "GPT-5.6 Sol", "modelVersion": "5.6"},
            },
        )
        self.assertEqual(next(payload for command, payload in backend.requests if command == "modes.set"), {"model": "Pro"})
        self.assertEqual(next(payload for command, payload in backend.requests if command == "modes.get"), {})

    async def test_legacy_async_runner_fallback_still_runs(self) -> None:
        transport = FakeLegacyAsyncTransport()
        chatgpt = AsyncChatGPT(transport=transport)
        agent = chatgpt.agent(name="legacy")

        result = await chatgpt.runner.run(agent, input="hi")

        self.assertEqual(result.final_output, "legacy-ok")
        self.assertEqual(transport.requests[0]["agent"]["kind"], "chatgpt_browser_agent")


def run_result(agent_name: str, output_text: str) -> dict:
    return {
        "ok": True,
        "status": "ok",
        "output_text": output_text,
        "finalOutput": output_text,
        "output": [],
        "newItems": [],
        "interruptions": [],
        "state": {"id": "state-async", "resumable": False},
        "activeAgentName": agent_name,
        "lastAgentName": agent_name,
        "warnings": [],
        "context": {"timestamp": "2026-06-06T00:00:00.000Z"},
    }


def command_result(data: dict) -> dict:
    return {
        "ok": True,
        "status": "ok",
        "data": data,
        "warnings": [],
        "context": {"timestamp": "2026-06-06T00:00:00.000Z"},
    }


if __name__ == "__main__":
    unittest.main()
