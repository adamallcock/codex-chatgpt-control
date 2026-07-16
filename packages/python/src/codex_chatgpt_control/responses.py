from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from .commands import to_wire_value
from .models import ChatGPTResponse, ChatGPTRunResult


UNSUPPORTED_ALTERNATIVES = {
    "model": "Use experience plus configuration for visible ChatGPT UI preferences. Legacy mode remains supported. These do not select an API model.",
    "temperature": "No browser-control equivalent. ChatGPT web does not expose API temperature.",
    "top_p": "No browser-control equivalent. ChatGPT web does not expose API nucleus sampling.",
    "seed": "No browser-control equivalent. Visible ChatGPT web does not expose deterministic API seeds.",
    "logprobs": "No browser-control equivalent. Visible ChatGPT web does not expose token log probabilities.",
    "top_logprobs": "No browser-control equivalent. Visible ChatGPT web does not expose token log probabilities.",
    "previous_response_id": "Use thread: { type: \"conversationId\", conversationId } or a ChatGPT thread URL.",
    "store": "No browser-control equivalent. Use visible ChatGPT settings or temporary chat controls when implemented.",
    "service_tier": "No browser-control equivalent. Visible ChatGPT web does not expose API service tiers.",
    "max_output_tokens": "Use response.maxChars/read maxChars for capture limits. This does not control model generation.",
    "parallel_tool_calls": "No browser-control equivalent. Visible ChatGPT browser control selects visible tools sequentially.",
    "truncation": "No browser-control equivalent. Use prompt design and response capture limits instead.",
}

ACCEPTED_TOP_LEVEL_FIELDS = {
    "input",
    "thread",
    "existingTab",
    "preferExistingTab",
    "experience",
    "configuration",
    "attachments",
    "mode",
    "tools",
    "text",
    "stream",
    "report",
    "instructions",
    "instructionsMode",
}

RESPONSE_FORMATS = {
    "markdown",
    "text",
    "normalized_text",
    "visible_text",
    "html",
    "blocks",
    "all",
}


@dataclass(frozen=True)
class ResponsesValidationResult:
    ok: bool
    unsupported: list[dict[str, str]]


class ResponsesClient:
    def __init__(self, backend: Any, *, now: Callable[[], datetime] | None = None) -> None:
        self._backend = backend
        self._now = now or (lambda: datetime.now(timezone.utc))

    def create(self, args: dict[str, Any] | None = None, **kwargs: Any) -> ChatGPTResponse:
        payload = normalize_create_args({**(args or {}), **kwargs})
        validation = validate_responses_create_args(payload)
        if not validation.ok:
            return unsupported_response(validation.unsupported, self._now())

        result = self._request_backend("responses.create", payload)
        if isinstance(result, dict) and result.get("schemaVersion") == "chatgpt.browser_control.backend_response.v1":
            if result.get("ok") is not True:
                error = result.get("error")
                message = error.get("message") if isinstance(error, dict) else "Backend response failed."
                raise RuntimeError(str(message))
            result = result.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("responses.create backend result must be a JSON object.")
        return ChatGPTResponse.from_wire(result)

    def _request_backend(self, command: str, payload: dict[str, Any]) -> Any:
        request = getattr(self._backend, "request", None)
        if callable(request):
            return request(command, payload)
        responses_create = getattr(self._backend, "responses_create", None)
        if callable(responses_create):
            return responses_create(payload)
        raise RuntimeError("This ChatGPT backend does not support responses.create.")


def normalize_create_args(args: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        key: to_wire_value(value)
        for key, value in args.items()
        if value is not None
    }
    if "instructions_mode" in normalized and "instructionsMode" not in normalized:
        normalized["instructionsMode"] = normalized.pop("instructions_mode")
    if "existing_tab" in normalized and "existingTab" not in normalized:
        normalized["existingTab"] = normalized.pop("existing_tab")
    if "prefer_existing_tab" in normalized and "preferExistingTab" not in normalized:
        normalized["preferExistingTab"] = normalized.pop("prefer_existing_tab")
    return normalized


def validate_responses_create_args(args: dict[str, Any]) -> ResponsesValidationResult:
    payload = normalize_create_args(args)
    unsupported: list[dict[str, str]] = []

    for path, alternative in UNSUPPORTED_ALTERNATIVES.items():
        if payload.get(path) is not None:
            unsupported.append(api_only_field(path, alternative))

    for path in payload:
        if path not in ACCEPTED_TOP_LEVEL_FIELDS and path not in UNSUPPORTED_ALTERNATIVES:
            unsupported.append({
                "path": path,
                "reason": "This field is not part of the narrow ChatGPT browser-control Responses adapter.",
                "alternative": "Use chatgpt.runner.run(...) for lower-level browser-control options.",
            })

    if payload.get("input") is None:
        unsupported.append({
            "path": "input",
            "reason": "Responses adapter calls must include visible input text or input items.",
            "alternative": "Provide input: \"your visible prompt\".",
        })

    if "stream" in payload and payload.get("stream") is not False:
        unsupported.append({
            "path": "stream",
            "reason": "This adapter stage supports only non-streaming calls.",
            "alternative": "Set stream: false, or use the runner milestone stream when enabled.",
        })

    if payload.get("instructions") is not None and payload.get("instructionsMode") != "visible_prefix":
        unsupported.append({
            "path": "instructions",
            "reason": "Responses API instructions are hidden context, but ChatGPT browser control can only submit visible text.",
            "alternative": "Set instructionsMode: \"visible_prefix\" to send instructions visibly.",
        })

    if "instructionsMode" in payload and payload.get("instructionsMode") != "visible_prefix":
        unsupported.append({
            "path": "instructionsMode",
            "reason": "Only explicit visible-prefix instructions are supported by this adapter.",
            "alternative": "Use instructionsMode: \"visible_prefix\" or omit instructionsMode.",
        })

    text = payload.get("text")
    if isinstance(text, dict):
        text_format = text.get("format")
        if text_format is not None and (not isinstance(text_format, str) or text_format not in RESPONSE_FORMATS):
            unsupported.append({
                "path": "text.format",
                "reason": "The requested response text format is not supported by ChatGPT browser-control capture.",
                "alternative": "Use markdown, visible_text, normalized_text, html, blocks, or all.",
            })
        for path in text:
            if path != "format":
                unsupported.append({
                    "path": f"text.{path}",
                    "reason": "Only text.format is supported by the narrow Responses adapter.",
                    "alternative": "Use chatgpt.runner.run(...) for lower-level browser-control options.",
                })

    return ResponsesValidationResult(ok=len(unsupported) == 0, unsupported=unsupported)


def unsupported_response(unsupported: list[dict[str, str]], now: datetime) -> ChatGPTResponse:
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    created_at = int(now.timestamp())
    return ChatGPTResponse.from_wire({
        "id": f"chatgpt-browser-{base36(int(now.timestamp() * 1000))}",
        "object": "chatgpt.browser.response",
        "created_at": created_at,
        "status": "unsupported",
        "output_text": "",
        "output": [],
        "browser_control": {
            "visibleUi": True,
            "resultStatus": "unsupported",
            "unsupported": unsupported,
        },
    })


def responses_create_args_to_run_input(args: dict[str, Any]) -> dict[str, Any]:
    text = args.get("text")
    text_format = text.get("format") if isinstance(text, dict) else None
    run_input: dict[str, Any] = {
        "input": args["input"],
        "response": {"format": text_format or "markdown"},
    }
    for key in (
        "thread",
        "existingTab",
        "preferExistingTab",
        "experience",
        "configuration",
        "attachments",
        "mode",
        "tools",
        "report",
    ):
        if key in args:
            run_input[key] = args[key]
    return run_input


def response_from_run_result(result: ChatGPTRunResult, now: datetime) -> ChatGPTResponse:
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    created_at = int(now.timestamp())
    browser_control: dict[str, Any] = {
        "visibleUi": True,
        "resultStatus": result.status,
    }
    data = getattr(result, "data", None)
    if isinstance(data, dict):
        if isinstance(data.get("thread"), dict):
            browser_control["thread"] = data["thread"]
        if isinstance(data.get("reportPath"), str):
            browser_control["reportPath"] = data["reportPath"]
        for key in ("submissionState", "completionState", "generationActive"):
            if key in data:
                browser_control[key] = data[key]
    state = getattr(result, "state", None)
    if state is not None:
        state_wire = state.to_wire() if hasattr(state, "to_wire") else {}
        for key in ("submissionState", "completionState"):
            if key in state_wire:
                browser_control[key] = state_wire[key]
    if result.report_path is not None:
        browser_control["reportPath"] = result.report_path

    return ChatGPTResponse.from_wire({
        "id": f"chatgpt-browser-{base36(int(now.timestamp() * 1000))}",
        "object": "chatgpt.browser.response",
        "created_at": created_at,
        "status": result.status,
        "output_text": result.output_text,
        "output": result.output,
        "browser_control": browser_control,
    })


def api_only_field(path: str, alternative: str) -> dict[str, str]:
    return {
        "path": path,
        "reason": "This is an OpenAI API field that visible ChatGPT browser control cannot honestly support.",
        "alternative": alternative,
    }


def base36(value: int) -> str:
    if value == 0:
        return "0"
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    digits = []
    current = value
    while current:
        current, remainder = divmod(current, 36)
        digits.append(alphabet[remainder])
    return "".join(reversed(digits))
