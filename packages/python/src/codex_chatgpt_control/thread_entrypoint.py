from __future__ import annotations

import json
import os
import shlex
import sys
from pathlib import Path
from typing import Any, Mapping, Protocol
from urllib.parse import urljoin, urlparse, urlunparse

from .backend import BackendClient, StdioBackendTransport
from .client import ChatGPT
from .models import CommandResult


DEFAULT_SEARCH_LIMIT = 5
DEFAULT_FORMAT = "markdown"
BACKEND_COMMAND_ENV = "CHATGPT_BROWSER_BACKEND_COMMAND"
CHATGPT_HOSTS = {"chatgpt.com", "www.chatgpt.com", "chat.openai.com"}
RESPONSE_FORMATS = {
    "markdown",
    "text",
    "normalized_text",
    "visible_text",
    "html",
    "blocks",
    "all",
}
WORK_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_BACKEND = WORK_ROOT / "node" / "dist" / "codex-chatgpt-control-backend.mjs"

USAGE = "\n".join(
    [
        "Usage:",
        '  python -m codex_chatgpt_control.thread_entrypoint "<ChatGPT thread URL or history search query>"',
        '  python -m codex_chatgpt_control.thread_entrypoint "<target>" --prompt "Continue from the latest answer."',
        '  python -m codex_chatgpt_control.thread_entrypoint --existing selected',
        '  python -m codex_chatgpt_control.thread_entrypoint --existing-conversation-id "<conversation-id>" --prompt "Continue."',
        '  CHATGPT_THREAD_TARGET="<target>" CHATGPT_THREAD_PROMPT="<prompt>" python -m codex_chatgpt_control.thread_entrypoint',
        "",
        "Options:",
        "  --target, -t                  ChatGPT /c/... URL or history search query.",
        "  --existing selected           Claim the selected open ChatGPT tab instead of opening/searching.",
        "  --existing-url                Claim an open tab by exact ChatGPT thread URL.",
        "  --existing-conversation-id    Claim an open tab by ChatGPT conversation id.",
        "  --existing-tab-id             Claim an open user tab by browser bridge tab id.",
        "  --open-if-missing             Open a URL/conversation target if no matching open tab exists.",
        "  --prompt, -p                  Optional prompt to send after opening the thread. Omit to read only.",
        "  --format                      Response format for the read step. Default: markdown.",
        "  --max-chars                   Maximum response characters to return.",
        "  --timeout-ms                  Wait timeout for continue prompts.",
        "  --stable-ms                   Stable wait window for continue prompts.",
        f"  --backend-command             Stdio backend command. Defaults to ${BACKEND_COMMAND_ENV} or the local Node bundle.",
    ]
)


class ContinueThreadSession(Protocol):
    def bootstrap(self, **kwargs: Any) -> CommandResult:
        ...


class ContinueThreadClient(Protocol):
    @property
    def session(self) -> ContinueThreadSession:
        ...

    def ask_in_thread(self, **kwargs: Any) -> CommandResult:
        ...

    def open_thread(self, thread: dict[str, Any]) -> CommandResult:
        ...

    def read_latest(self, **kwargs: Any) -> CommandResult:
        ...


class ContinueThreadUsageError(Exception):
    def __init__(self, message: str, exit_code: int = 2) -> None:
        super().__init__(message)
        self.exit_code = exit_code


def parse_continue_thread_args(
    argv: list[str],
    env: Mapping[str, str | None] = os.environ,
) -> dict[str, Any]:
    target_flag: str | None = None
    prompt_flag: str | None = None
    format_flag: str | None = None
    max_chars_flag: str | None = None
    timeout_ms_flag: str | None = None
    stable_ms_flag: str | None = None
    backend_command_flag: str | None = None
    existing_flag: str | None = None
    existing_url_flag: str | None = None
    existing_conversation_id_flag: str | None = None
    existing_tab_id_flag: str | None = None
    open_if_missing_flag = False
    positionals: list[str] = []

    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg in {"--help", "-h"}:
            raise ContinueThreadUsageError(USAGE, 0)
        if arg in {"--target", "-t"}:
            index += 1
            target_flag = _required_value(argv, index, arg)
        elif arg in {"--prompt", "-p"}:
            index += 1
            prompt_flag = _required_value(argv, index, arg)
        elif arg == "--format":
            index += 1
            format_flag = _required_value(argv, index, arg)
        elif arg == "--max-chars":
            index += 1
            max_chars_flag = _required_value(argv, index, arg)
        elif arg == "--timeout-ms":
            index += 1
            timeout_ms_flag = _required_value(argv, index, arg)
        elif arg == "--stable-ms":
            index += 1
            stable_ms_flag = _required_value(argv, index, arg)
        elif arg == "--backend-command":
            index += 1
            backend_command_flag = _required_value(argv, index, arg)
        elif arg == "--existing":
            index += 1
            existing_flag = _required_value(argv, index, arg)
        elif arg == "--existing-url":
            index += 1
            existing_url_flag = _required_value(argv, index, arg)
        elif arg == "--existing-conversation-id":
            index += 1
            existing_conversation_id_flag = _required_value(argv, index, arg)
        elif arg == "--existing-tab-id":
            index += 1
            existing_tab_id_flag = _required_value(argv, index, arg)
        elif arg == "--open-if-missing":
            open_if_missing_flag = True
        else:
            positionals.append(arg)
        index += 1

    target = _first_text(target_flag, " ".join(positionals), env.get("CHATGPT_THREAD_TARGET"))
    existing = _parse_existing_tab_policy(
        existing=_first_text(existing_flag, env.get("CHATGPT_THREAD_EXISTING")),
        url=_first_text(existing_url_flag, env.get("CHATGPT_THREAD_EXISTING_URL")),
        conversation_id=_first_text(existing_conversation_id_flag, env.get("CHATGPT_THREAD_EXISTING_CONVERSATION_ID")),
        tab_id=_first_text(existing_tab_id_flag, env.get("CHATGPT_THREAD_EXISTING_TAB_ID")),
        open_if_missing=open_if_missing_flag or _env_truthy(env.get("CHATGPT_THREAD_OPEN_IF_MISSING")),
    )
    if target is None and existing is None:
        raise ContinueThreadUsageError(f"Missing ChatGPT thread URL, search query, or existing-tab selector.\n\n{USAGE}")
    if target is not None and existing is not None:
        raise ContinueThreadUsageError(f"Use either a target/search query or an existing-tab selector, not both.\n\n{USAGE}")

    options: dict[str, Any] = {
        "format": _parse_response_format(_first_text(format_flag, env.get("CHATGPT_THREAD_FORMAT")) or DEFAULT_FORMAT),
    }
    if target is not None:
        options["target"] = target
    if existing is not None:
        options["existing"] = existing

    prompt = _first_text(prompt_flag, env.get("CHATGPT_THREAD_PROMPT"))
    if prompt is not None:
        options["prompt"] = prompt

    max_chars = _parse_positive_int(_first_text(max_chars_flag, env.get("CHATGPT_THREAD_MAX_CHARS")), "--max-chars")
    if max_chars is not None:
        options["max_chars"] = max_chars

    timeout_ms = _parse_positive_int(_first_text(timeout_ms_flag, env.get("CHATGPT_THREAD_TIMEOUT_MS")), "--timeout-ms")
    if timeout_ms is not None:
        options["timeout_ms"] = timeout_ms

    stable_ms = _parse_positive_int(_first_text(stable_ms_flag, env.get("CHATGPT_THREAD_STABLE_MS")), "--stable-ms")
    if stable_ms is not None:
        options["stable_ms"] = stable_ms

    backend_command = _first_text(backend_command_flag, env.get(BACKEND_COMMAND_ENV))
    if backend_command is not None:
        options["backend_command"] = backend_command

    return options


def thread_selector_from_target(target: str, *, limit: int = DEFAULT_SEARCH_LIMIT) -> dict[str, Any]:
    value = target.strip()
    if not value:
        raise ContinueThreadUsageError("Thread target must not be empty.")

    url = _chatgpt_url_from_target(value)
    if url is not None:
        return {"type": "url", "url": url}

    return {
        "type": "search",
        "query": value,
        "select": "first",
        "limit": limit,
    }


def run_continue_thread(chatgpt: ContinueThreadClient, options: dict[str, Any]) -> CommandResult:
    read = _read_kwargs(options)
    prompt = str(options.get("prompt", "")).strip()

    existing = options.get("existing")
    if existing is not None:
        bootstrapped = chatgpt.session.bootstrap(existingTab=existing)
        if not bootstrapped.ok:
            return bootstrapped
        if prompt:
            wait = _wait_kwargs(options) or True
            asked = chatgpt.ask_in_thread(thread={"type": "current"}, prompt=prompt, wait=wait, read=read)
            return _merge_open_read_result(bootstrapped, asked)
        latest = chatgpt.read_latest(**read)
        return _merge_open_read_result(bootstrapped, latest)

    target = options.get("target")
    if target is None:
        raise ContinueThreadUsageError(f"Missing ChatGPT thread URL, search query, or existing-tab selector.\n\n{USAGE}")

    thread = thread_selector_from_target(str(target))
    if prompt:
        wait = _wait_kwargs(options) or True
        return chatgpt.ask_in_thread(thread=thread, prompt=prompt, wait=wait, read=read)

    opened = chatgpt.open_thread(thread)
    if not opened.ok:
        return opened

    latest = chatgpt.read_latest(**read)
    return _merge_open_read_result(opened, latest)


def render_continue_thread_output(result: CommandResult) -> dict[str, Any]:
    output: dict[str, Any] = {
        "ok": result.ok,
        "status": result.status,
        "context": result.context,
    }

    text = _text_from_data(result.data)
    if text is not None:
        output["text"] = text
    elif result.data is not None:
        output["data"] = result.data
    if result.warnings:
        output["warnings"] = result.warnings
    if result.blocker is not None:
        output["blocker"] = result.blocker
    if result.error is not None:
        output["error"] = result.error
    if result.report_path is not None:
        output["reportPath"] = result.report_path
    return output


def main(argv: list[str] | None = None) -> int:
    try:
        options = parse_continue_thread_args(sys.argv[1:] if argv is None else argv)
        backend = _create_backend(options.get("backend_command"))
        chatgpt = ChatGPT(backend=backend)
        try:
            result = run_continue_thread(chatgpt, options)
        finally:
            backend.close()
        print(json.dumps(render_continue_thread_output(result), indent=2, sort_keys=True))
        return 0 if result.ok else 2 if result.blocker is not None else 1
    except ContinueThreadUsageError as exc:
        print(str(exc), file=sys.stderr)
        return exc.exit_code
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


def _create_backend(backend_command: Any = None) -> BackendClient:
    command = _backend_command(str(backend_command) if backend_command is not None else None)
    return BackendClient(StdioBackendTransport(command=command))


def _backend_command(backend_command: str | None = None) -> list[str]:
    command = _first_text(backend_command, os.environ.get(BACKEND_COMMAND_ENV))
    if command is not None:
        return shlex.split(command)
    return ["node", str(DEFAULT_BACKEND)]


def _required_value(argv: list[str], index: int, flag: str) -> str:
    if index >= len(argv) or argv[index].startswith("--"):
        raise ContinueThreadUsageError(f"Missing value for {flag}.\n\n{USAGE}")
    return argv[index]


def _first_text(*values: str | None) -> str | None:
    for value in values:
        if value is not None and value.strip():
            return value.strip()
    return None


def _parse_response_format(value: str) -> str:
    if value in RESPONSE_FORMATS:
        return value
    raise ContinueThreadUsageError(
        f"Unsupported response format {value!r}. Use one of: {', '.join(sorted(RESPONSE_FORMATS))}."
    )


def _parse_existing_tab_policy(
    *,
    existing: str | None = None,
    url: str | None = None,
    conversation_id: str | None = None,
    tab_id: str | None = None,
    open_if_missing: bool = False,
) -> dict[str, Any] | None:
    selectors = [
        label
        for label, value in (
            ("existing", existing),
            ("existing-url", url),
            ("existing-conversation-id", conversation_id),
            ("existing-tab-id", tab_id),
        )
        if value is not None
    ]

    if not selectors:
        return None
    if len(selectors) > 1:
        raise ContinueThreadUsageError(f"Use only one existing-tab selector, not {', '.join(selectors)}.\n\n{USAGE}")

    if_missing = "open" if open_if_missing else "block"
    if existing is not None:
        mode = existing.strip().lower()
        if mode != "selected":
            raise ContinueThreadUsageError(f"Unsupported --existing value {existing!r}. Use: selected.")
        return {"target": {"type": "selected", "host": "chatgpt"}, "ifMissing": if_missing}
    if url is not None:
        chatgpt_url = _chatgpt_url_from_target(url)
        if chatgpt_url is None:
            raise ContinueThreadUsageError("--existing-url must be a ChatGPT thread URL.")
        return {"target": {"type": "url", "url": chatgpt_url}, "ifMissing": if_missing}
    if conversation_id is not None:
        return {"target": {"type": "conversationId", "conversationId": conversation_id}, "ifMissing": if_missing}
    if tab_id is not None:
        return {"target": {"type": "tabId", "tabId": tab_id}, "ifMissing": if_missing}
    return None


def _env_truthy(value: str | None) -> bool:
    return value is not None and value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_positive_int(value: str | None, label: str) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ContinueThreadUsageError(f"{label} must be a positive integer.") from exc
    if parsed <= 0:
        raise ContinueThreadUsageError(f"{label} must be a positive integer.")
    return parsed


def _chatgpt_url_from_target(target: str) -> str | None:
    raw_url = urljoin("https://chatgpt.com", target) if target.startswith("/c/") else target
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    if parsed.hostname not in CHATGPT_HOSTS:
        raise ContinueThreadUsageError("Target URL must be a ChatGPT thread URL from chatgpt.com or chat.openai.com.")
    return urlunparse(parsed)


def _read_kwargs(options: dict[str, Any]) -> dict[str, Any]:
    read = {
        "role": "assistant",
        "format": options.get("format", DEFAULT_FORMAT),
    }
    if "max_chars" in options:
        read["maxChars"] = options["max_chars"]
    return read


def _wait_kwargs(options: dict[str, Any]) -> dict[str, Any] | None:
    wait: dict[str, Any] = {}
    if "timeout_ms" in options:
        wait["timeoutMs"] = options["timeout_ms"]
    if "stable_ms" in options:
        wait["stableMs"] = options["stable_ms"]
    return wait or None


def _merge_open_read_result(opened: CommandResult, latest: CommandResult) -> CommandResult:
    wire = latest.to_wire()
    wire["warnings"] = [*opened.warnings, *latest.warnings]
    wire["context"] = _merge_context(opened.context, latest.context)
    if opened.steps is not None or latest.steps is not None:
        wire["steps"] = [
            *[step.to_wire() for step in (opened.steps or [])],
            *[step.to_wire() for step in (latest.steps or [])],
        ]
    return CommandResult.from_wire(wire)


def _merge_context(opened: dict[str, Any], latest: dict[str, Any]) -> dict[str, Any]:
    context = dict(opened)
    context.update({key: value for key, value in latest.items() if value is not None})
    if "timestamp" not in context:
        context["timestamp"] = latest.get("timestamp") or opened.get("timestamp")
    return context


def _text_from_data(data: Any) -> str | None:
    if not isinstance(data, dict):
        return None
    for key in ("text", "responseText", "markdown"):
        value = data.get(key)
        if isinstance(value, str):
            return value
    return None


if __name__ == "__main__":
    raise SystemExit(main())
