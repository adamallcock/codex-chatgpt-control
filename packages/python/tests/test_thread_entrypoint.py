import unittest

from codex_chatgpt_control import CommandResult
from codex_chatgpt_control.thread_entrypoint import (
    parse_continue_thread_args,
    run_continue_thread,
    thread_selector_from_target,
)


class RecordingChatGPT:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.session = RecordingSession(self.calls)

    def ask_in_thread(self, **kwargs):
        thread = kwargs["thread"]
        self.calls.append(f"ask_in_thread:{thread.get('query') or thread.get('url') or thread.get('type')}:{kwargs['prompt']}")
        return ok({"responseText": "continued"})

    def open_thread(self, thread: dict):
        self.calls.append(f"open_thread:{thread.get('url') or thread}")
        return ok({})

    def read_latest(self, **kwargs):
        self.calls.append(f"read_latest:{kwargs.get('format', 'default')}")
        return ok({"text": "latest"})


class RecordingSession:
    def __init__(self, calls: list[str]) -> None:
        self._calls = calls

    def bootstrap(self, **kwargs):
        existing_tab = kwargs.get("existingTab")
        if existing_tab is True:
            target = "true"
        elif isinstance(existing_tab, dict) and existing_tab.get("target", {}).get("type") == "selected":
            target = "selected"
        elif isinstance(existing_tab, dict) and existing_tab.get("target", {}).get("type") == "conversationId":
            target = f"conversation:{existing_tab['target']['conversationId']}"
        else:
            target = "none"
        self._calls.append(f"bootstrap:{target}")
        return ok({})


class ContinueThreadEntrypointTests(unittest.TestCase):
    def test_treats_pasted_chatgpt_thread_urls_as_url_thread_selectors(self) -> None:
        self.assertEqual(
            thread_selector_from_target("https://chatgpt.com/c/6a20e900-4744-83ea-9b80-2c75fb85bd63"),
            {
                "type": "url",
                "url": "https://chatgpt.com/c/6a20e900-4744-83ea-9b80-2c75fb85bd63",
            },
        )

    def test_treats_ordinary_text_as_history_search_selector(self) -> None:
        self.assertEqual(
            thread_selector_from_target("Naming macOS Utility"),
            {
                "type": "search",
                "query": "Naming macOS Utility",
                "select": "first",
                "limit": 5,
            },
        )

    def test_parses_cli_arguments_from_positional_target_and_prompt_flags(self) -> None:
        self.assertEqual(
            parse_continue_thread_args(
                [
                    "Naming",
                    "macOS",
                    "Utility",
                    "--prompt",
                    "Continue from the latest answer.",
                ],
                {},
            ),
            {
                "target": "Naming macOS Utility",
                "prompt": "Continue from the latest answer.",
                "format": "markdown",
            },
        )

    def test_parses_selected_existing_tab_mode_without_a_search_target(self) -> None:
        self.assertEqual(
            parse_continue_thread_args(
                [
                    "--existing",
                    "selected",
                    "--format",
                    "normalized_text",
                ],
                {},
            ),
            {
                "existing": {
                    "target": {"type": "selected", "host": "chatgpt"},
                    "ifMissing": "block",
                },
                "format": "normalized_text",
            },
        )

    def test_parses_existing_conversation_ids_with_explicit_open_if_missing_fallback(self) -> None:
        self.assertEqual(
            parse_continue_thread_args(
                [
                    "--existing-conversation-id",
                    "abc-123",
                    "--open-if-missing",
                ],
                {},
            ),
            {
                "existing": {
                    "target": {"type": "conversationId", "conversationId": "abc-123"},
                    "ifMissing": "open",
                },
                "format": "markdown",
            },
        )

    def test_opens_and_reads_when_no_prompt_is_supplied(self) -> None:
        chatgpt = RecordingChatGPT()

        result = run_continue_thread(
            chatgpt,
            {
                "target": "https://chatgpt.com/c/6a20e900-4744-83ea-9b80-2c75fb85bd63",
                "format": "normalized_text",
            },
        )

        self.assertTrue(result.ok)
        self.assertEqual(
            chatgpt.calls,
            [
                "open_thread:https://chatgpt.com/c/6a20e900-4744-83ea-9b80-2c75fb85bd63",
                "read_latest:normalized_text",
            ],
        )

    def test_bootstraps_and_reads_the_current_thread_when_selected_existing_tab_mode_is_supplied(self) -> None:
        chatgpt = RecordingChatGPT()

        result = run_continue_thread(
            chatgpt,
            {
                "existing": {
                    "target": {"type": "selected", "host": "chatgpt"},
                    "ifMissing": "block",
                },
                "format": "markdown",
            },
        )

        self.assertTrue(result.ok)
        self.assertEqual(
            chatgpt.calls,
            [
                "bootstrap:selected",
                "read_latest:markdown",
            ],
        )

    def test_bootstraps_and_continues_the_current_thread_when_existing_tab_mode_has_a_prompt(self) -> None:
        chatgpt = RecordingChatGPT()

        result = run_continue_thread(
            chatgpt,
            {
                "existing": {
                    "target": {"type": "selected", "host": "chatgpt"},
                    "ifMissing": "block",
                },
                "prompt": "Continue.",
                "format": "markdown",
            },
        )

        self.assertTrue(result.ok)
        self.assertEqual(
            chatgpt.calls,
            [
                "bootstrap:selected",
                "ask_in_thread:current:Continue.",
            ],
        )

    def test_continues_the_selected_thread_when_prompt_is_supplied(self) -> None:
        chatgpt = RecordingChatGPT()

        result = run_continue_thread(
            chatgpt,
            {
                "target": "Naming macOS Utility",
                "prompt": "Continue from the latest answer.",
                "format": "markdown",
            },
        )

        self.assertTrue(result.ok)
        self.assertEqual(
            chatgpt.calls,
            ["ask_in_thread:Naming macOS Utility:Continue from the latest answer."],
        )


def ok(data: object) -> CommandResult:
    return CommandResult.from_wire(
        {
            "ok": True,
            "status": "ok",
            "data": data,
            "warnings": [],
            "context": {"timestamp": "2026-06-06T00:00:00.000Z"},
        }
    )


if __name__ == "__main__":
    unittest.main()
