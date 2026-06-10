import unittest

from codex_chatgpt_control import ChatGPT, CommandResult


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
    def test_primitive_groups_map_to_backend_commands(self) -> None:
        backend = RecordingBackend()
        chatgpt = ChatGPT(backend=backend)

        calls = [
            (lambda: chatgpt.session.bootstrap(prefer_existing_tab=True), "session.bootstrap", {"preferExistingTab": True}),
            (lambda: chatgpt.threads.new(timeout_ms=100), "threads.new", {"timeoutMs": 100}),
            (lambda: chatgpt.threads.search(query="sdk", limit=5), "threads.search", {"query": "sdk", "limit": 5}),
            (lambda: chatgpt.threads.open(conversation_id="abc"), "threads.open", {"conversationId": "abc"}),
            (lambda: chatgpt.messages.compose(text="hi"), "messages.compose", {"text": "hi"}),
            (lambda: chatgpt.messages.submit(text="hi"), "messages.submit", {"text": "hi"}),
            (lambda: chatgpt.messages.ask(text="hi"), "messages.ask", {"text": "hi"}),
            (lambda: chatgpt.messages.wait(timeout_ms=100), "messages.wait", {"timeoutMs": 100}),
            (lambda: chatgpt.messages.read_latest(format="markdown"), "messages.readLatest", {"format": "markdown"}),
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
