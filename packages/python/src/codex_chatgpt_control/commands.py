from __future__ import annotations

from typing import Any

from .models import CommandDescriptor


_NESTED_WIRE_ALIASES = {
    "after_artifact_count": "afterArtifactCount",
    "after_assistant_turn_count": "afterAssistantTurnCount",
    "after_step": "afterStep",
    "after_turn_count": "afterTurnCount",
    "allow_prompt_resubmit": "allowPromptResubmit",
    "assistant_index": "assistantIndex",
    "batch_size": "batchSize",
    "confirm_mutation": "confirmMutation",
    "conversation_id": "conversationId",
    "default_timeout_ms": "defaultTimeoutMs",
    "dest_dir": "destDir",
    "existing_tab": "existingTab",
    "filename_pattern": "filenamePattern",
    "from_step": "fromStep",
    "if_missing": "ifMissing",
    "if_multiple": "ifMultiple",
    "include_artifacts": "includeArtifacts",
    "include_content": "includeContent",
    "include_diagnostics": "includeDiagnostics",
    "include_hashes": "includeHashes",
    "include_options": "includeOptions",
    "input_paths": "inputPaths",
    "instructions_mode": "instructionsMode",
    "max_array_items": "maxArrayItems",
    "max_bytes_per_file": "maxBytesPerFile",
    "max_chars": "maxChars",
    "max_depth": "maxDepth",
    "max_object_entries": "maxObjectEntries",
    "max_preview_chars": "maxPreviewChars",
    "max_total_bytes": "maxTotalBytes",
    "model_version": "modelVersion",
    "new_task": "newTask",
    "poll_ms": "pollMs",
    "prefer_existing_tab": "preferExistingTab",
    "project_url": "projectUrl",
    "require_chatgpt": "requireChatGPT",
    "require_download": "requireDownload",
    "response_content": "responseContent",
    "return_partial": "returnPartial",
    "screenshot_on_blocker": "screenshotOnBlocker",
    "stable_ms": "stableMs",
    "stop_on_error": "stopOnError",
    "tab_id": "tabId",
    "timeout_ms": "timeoutMs",
}


def request_backend(backend: Any, command: str, payload: dict[str, Any] | None = None) -> Any:
    request = getattr(backend, "request", None)
    if not callable(request):
        raise RuntimeError(f"This ChatGPT backend does not support {command}.")
    return request(command, payload or {})


def wire_kwargs(**kwargs: Any) -> dict[str, Any]:
    return {
        snake_to_camel(key): to_wire_value(value)
        for key, value in kwargs.items()
        if value is not None
    }


def snake_to_camel(key: str) -> str:
    head, *tail = key.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def to_wire_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            nested_wire_key(str(key)): to_wire_value(child)
            for key, child in value.items()
            if child is not None
        }
    if isinstance(value, list):
        return [to_wire_value(item) for item in value]
    if isinstance(value, tuple):
        return [to_wire_value(item) for item in value]
    to_wire = getattr(value, "to_wire", None)
    if callable(to_wire):
        return to_wire()
    return value


def nested_wire_key(key: str) -> str:
    return _NESTED_WIRE_ALIASES.get(key, key)


class CommandClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def commands(self, *, layer: str | None = None) -> list[CommandDescriptor]:
        payload: dict[str, Any] = {}
        if layer is not None:
            payload["filter"] = {"layer": layer}
        result = request_backend(self._backend, "commands", payload)
        if not isinstance(result, list):
            raise RuntimeError("commands backend result must be a list.")
        return [CommandDescriptor.from_wire(item) for item in result]

    def describe(self, name: str) -> CommandDescriptor:
        result = request_backend(self._backend, "describe", {"name": name})
        if not isinstance(result, dict):
            raise RuntimeError("describe backend result must be a command descriptor.")
        return CommandDescriptor.from_wire(result)

    def help(self, topic: str | None = None) -> str:
        payload = {} if topic is None else {"topic": topic}
        result = request_backend(self._backend, "help", payload)
        if not isinstance(result, str):
            raise RuntimeError("help backend result must be a string.")
        return result
