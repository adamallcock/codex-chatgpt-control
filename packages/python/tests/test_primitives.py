import unittest

from codex_chatgpt_control import ChatGPT, CommandResult
from codex_chatgpt_control.commands import wire_kwargs


class RecordingBackend:
    def __init__(self) -> None:
        self.requests: list[tuple[str, dict]] = []

    def request(self, command: str, payload: dict | None = None):
        payload = payload or {}
        self.requests.append((command, payload))
        return {
            "ok": True,
            "status": "ok",
            "data": {"command": command},
            "warnings": [],
            "context": {"timestamp": "2026-06-06T00:00:00.000Z"},
        }


class PrimitiveFacadeTests(unittest.TestCase):
    def test_nested_wire_normalization_only_rewrites_known_sdk_fields(self) -> None:
        self.assertEqual(
            wire_kwargs(
                configuration={
                    "model_version": "5.6",
                    "provider_specific_key": "preserved",
                },
                existing_tab={
                    "target": {"conversation_id": "abc", "custom_key": "preserved"},
                    "if_missing": "block",
                },
                metadata={"user_owned_key": "preserved"},
            ),
            {
                "configuration": {
                    "modelVersion": "5.6",
                    "provider_specific_key": "preserved",
                },
                "existingTab": {
                    "target": {"conversationId": "abc", "custom_key": "preserved"},
                    "ifMissing": "block",
                },
                "metadata": {"user_owned_key": "preserved"},
            },
        )

    def test_primitive_groups_map_to_backend_commands(self) -> None:
        backend = RecordingBackend()
        chatgpt = ChatGPT(backend=backend)

        calls = [
            (lambda: chatgpt.session.bootstrap(prefer_existing_tab=True), "session.bootstrap", {"preferExistingTab": True}),
            (lambda: chatgpt.experience.detect(timeout_ms=100), "experience.detect", {"timeoutMs": 100}),
            (lambda: chatgpt.experience.open(experience="work"), "experience.open", {"experience": "work"}),
            (lambda: chatgpt.configuration.inspect(experience="work", include_options=True), "configuration.inspect", {"experience": "work", "includeOptions": True}),
            (
                lambda: chatgpt.configuration.apply(
                    experience="work",
                    desired={"model": "GPT-5.6 Sol", "model_version": "5.6", "speed": "Fast"},
                ),
                "configuration.apply",
                {
                    "experience": "work",
                    "desired": {"model": "GPT-5.6 Sol", "modelVersion": "5.6", "speed": "Fast"},
                },
            ),
            (
                lambda: chatgpt.work.start(
                    prompt="Analyze.",
                    new_task=True,
                    configuration={"model": "GPT-5.6 Sol", "effort": "High"},
                ),
                "work.start",
                {
                    "prompt": "Analyze.",
                    "newTask": True,
                    "configuration": {"model": "GPT-5.6 Sol", "effort": "High"},
                },
            ),
            (lambda: chatgpt.work.status(include_artifacts=True), "work.status", {"includeArtifacts": True}),
            (lambda: chatgpt.work.wait(timeout_ms=100), "work.wait", {"timeoutMs": 100}),
            (lambda: chatgpt.work.steer(prompt="Focus on deployment."), "work.steer", {"prompt": "Focus on deployment."}),
            (lambda: chatgpt.work.read_latest(format="markdown"), "work.readLatest", {"format": "markdown"}),
            (lambda: chatgpt.work.artifacts.list_latest(kind="image"), "artifacts.listLatest", {"kind": "image"}),
            (lambda: chatgpt.threads.new(timeout_ms=100), "threads.new", {"timeoutMs": 100}),
            (lambda: chatgpt.threads.search(query="sdk", limit=5), "threads.search", {"query": "sdk", "limit": 5}),
            (lambda: chatgpt.threads.open(conversation_id="abc"), "threads.open", {"conversationId": "abc"}),
            (lambda: chatgpt.messages.compose(text="hi"), "messages.compose", {"text": "hi"}),
            (lambda: chatgpt.messages.submit(text="hi"), "messages.submit", {"text": "hi"}),
            (lambda: chatgpt.messages.ask(text="hi"), "messages.ask", {"text": "hi"}),
            (lambda: chatgpt.messages.wait(timeout_ms=100, response_content="metadata"), "messages.wait", {"timeoutMs": 100, "responseContent": "metadata"}),
            (lambda: chatgpt.messages.read_latest(format="markdown"), "messages.readLatest", {"format": "markdown"}),
            (lambda: chatgpt.messages.status(max_preview_chars=80), "messages.status", {"maxPreviewChars": 80}),
            (lambda: chatgpt.messages.wait_and_read(format="markdown"), "messages.waitAndRead", {"format": "markdown"}),
            (lambda: chatgpt.artifacts.list_latest(kind="image"), "artifacts.listLatest", {"kind": "image"}),
            (lambda: chatgpt.artifacts.wait(kind="image", after_artifact_count=0, require_download=True), "artifacts.wait", {"kind": "image", "afterArtifactCount": 0, "requireDownload": True}),
            (lambda: chatgpt.artifacts.download_latest(dest_dir="/tmp", prefer="visible_image_source"), "artifacts.downloadLatest", {"destDir": "/tmp", "prefer": "visible_image_source"}),
            (lambda: chatgpt.files.preflight(paths=["/tmp/a.txt"], max_total_bytes=100), "files.preflight", {"paths": ["/tmp/a.txt"], "maxTotalBytes": 100}),
            (lambda: chatgpt.files.attach(paths=["/tmp/a.txt"]), "files.attach", {"paths": ["/tmp/a.txt"]}),
            (lambda: chatgpt.files.download_latest(dest_dir="/tmp"), "files.downloadLatest", {"destDir": "/tmp"}),
            (lambda: chatgpt.projects.sources.list(project_url="https://chatgpt.com/g/g-p-example/project"), "projects.sources.list", {"projectUrl": "https://chatgpt.com/g/g-p-example/project"}),
            (lambda: chatgpt.projects.sources.plan_add(project_url="https://chatgpt.com/g/g-p-example/project", files=["/tmp/a.txt"], batch_size=2), "projects.sources.planAdd", {"projectUrl": "https://chatgpt.com/g/g-p-example/project", "files": ["/tmp/a.txt"], "batchSize": 2}),
            (lambda: chatgpt.projects.sources.add(project_url="https://chatgpt.com/g/g-p-example/project", files=["/tmp/a.txt"], confirm_mutation=True), "projects.sources.add", {"projectUrl": "https://chatgpt.com/g/g-p-example/project", "files": ["/tmp/a.txt"], "confirmMutation": True}),
            (
                lambda: chatgpt.modes.set(model="Pro", intelligence="Pro", model_version="5.4"),
                "modes.set",
                {"model": "Pro", "intelligence": "Pro", "modelVersion": "5.4"},
            ),
            (lambda: chatgpt.modes.get(), "modes.get", {}),
            (lambda: chatgpt.tools.select(tool="web_search"), "tools.select", {"tool": "web_search"}),
            (lambda: chatgpt.response.copy(which="latest"), "response.copy", {"which": "latest"}),
        ]

        for call, command, payload in calls:
            with self.subTest(command=command):
                result = call()
                self.assertIsInstance(result, CommandResult)
                self.assertEqual(backend.requests[-1], (command, payload))


if __name__ == "__main__":
    unittest.main()
