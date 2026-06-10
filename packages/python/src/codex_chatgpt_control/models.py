from __future__ import annotations

from typing import Any, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


TWireModel = TypeVar("TWireModel", bound="WireModel")


class WireModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    @classmethod
    def from_wire(cls: type[TWireModel], payload: dict[str, Any]) -> TWireModel:
        try:
            return cls.model_validate(payload)
        except ValidationError as exc:
            raise ValueError(str(exc)) from exc

    def to_wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True)


CommandStatus = Literal[
    "ok",
    "partial",
    "timeout",
    "blocked",
    "needs_confirmation",
    "not_found",
    "unsupported",
    "error",
]


class ChatGPTRunState(WireModel):
    id: str
    resumable: bool
    thread: dict[str, Any] | None = None
    next_step_id: str | None = Field(default=None, alias="nextStepId")


class SequencePolicy(WireModel):
    stop_on_error: bool | None = Field(default=None, alias="stopOnError")
    return_partial: bool | None = Field(default=None, alias="returnPartial")
    default_timeout_ms: int | None = Field(default=None, alias="defaultTimeoutMs")
    screenshot_on_blocker: bool | None = Field(default=None, alias="screenshotOnBlocker")
    allow_prompt_resubmit: str | None = Field(default=None, alias="allowPromptResubmit")


class SequenceStep(WireModel):
    id: str
    command: str
    args: dict[str, Any] | None = None


class SequenceStepResult(WireModel):
    id: str
    command: str
    status: CommandStatus
    ok: bool
    started_at: str | None = Field(default=None, alias="startedAt")
    ended_at: str | None = Field(default=None, alias="endedAt")
    data_preview: Any = Field(default=None, alias="dataPreview")
    warnings: list[str] = Field(default_factory=list)


class SequencePlan(WireModel):
    name: str
    input: dict[str, Any] | None = None
    policy: SequencePolicy | None = None
    steps: list[SequenceStep]


class CommandResult(WireModel):
    ok: bool
    status: CommandStatus
    data: Any = None
    output_text: str | None = None
    warnings: list[str]
    context: dict[str, Any]
    report_path: str | None = Field(default=None, alias="reportPath")
    error: dict[str, Any] | None = None
    blocker: dict[str, Any] | None = None
    steps: list[SequenceStepResult] | None = None

    @model_validator(mode="after")
    def populate_output_text(self) -> "CommandResult":
        if self.output_text is None:
            self.output_text = _command_output_text(self.data)
        return self


class ChatGPTRunResult(WireModel):
    ok: bool
    status: CommandStatus
    output_text: str
    final_output: Any = Field(default=None, alias="finalOutput")
    output: list[dict[str, Any]]
    new_items: list[dict[str, Any]] = Field(alias="newItems")
    interruptions: list[dict[str, Any]]
    state: ChatGPTRunState
    active_agent_name: str = Field(default="", alias="activeAgentName")
    last_agent_name: str = Field(default="", alias="lastAgentName")
    warnings: list[str]
    context: dict[str, Any]
    blocker: dict[str, Any] | None = None
    report_path: str | None = Field(default=None, alias="reportPath")
    steps: list[SequenceStepResult] | None = None


class ChatGPTResponse(WireModel):
    id: str
    object: Literal["chatgpt.browser.response"]
    created_at: int
    status: CommandStatus
    output_text: str
    output: list[dict[str, Any]]
    browser_control: dict[str, Any]

    @property
    def unsupported_fields(self) -> list[dict[str, Any]]:
        value = self.browser_control.get("unsupported")
        return value if isinstance(value, list) else []


StreamEventType = Literal[
    "run_item_stream_event",
    "agent_updated_stream_event",
    "completed",
    "error",
]


class ChatGPTStreamEvent(WireModel):
    type: StreamEventType
    name: str | None = None
    item: dict[str, Any] | None = None
    result: ChatGPTRunResult | None = None
    error: dict[str, Any] | None = None


class ChatGPTAgentModel(WireModel):
    kind: Literal["chatgpt_browser_agent"]
    name: str
    instructions: str | None = None
    instructions_mode: Literal["visible_prefix", "visible_setup_message", "metadata_only"] = Field(
        alias="instructionsMode"
    )
    defaults: dict[str, Any]
    tools: list[dict[str, Any]]
    guardrails: list[dict[str, Any]]
    output: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class ChatGPTRunInput(WireModel):
    input: Any
    thread: dict[str, Any] | None = None
    existing_tab: dict[str, Any] | bool | None = Field(default=None, alias="existingTab")
    prefer_existing_tab: bool | None = Field(default=None, alias="preferExistingTab")
    attachments: list[dict[str, Any]] | None = None
    mode: dict[str, Any] | None = None
    tools: list[dict[str, Any]] | None = None
    response: dict[str, Any] | None = None
    download: dict[str, Any] | bool | None = None
    copy_: dict[str, Any] | bool | None = Field(default=None, alias="copy")
    report: dict[str, Any] | bool | None = None
    metadata: dict[str, Any] | None = None


class CommandDescriptor(WireModel):
    name: str
    layer: str
    summary: str
    risk: Literal["low", "medium", "high"]
    args: dict[str, str]
    defaults: dict[str, Any]
    retry_policy: str = Field(alias="retryPolicy")
    blockers: list[str]
    examples: list[str]
    default_timeout_ms: int | None = Field(default=None, alias="defaultTimeoutMs")


class BackendCapabilities(WireModel):
    protocol_version: str = Field(alias="protocolVersion")
    commands: list[str]
    transports: list[str]
    streaming: dict[str, Any]


class BackendResponse(WireModel):
    schema_version: Literal["chatgpt.browser_control.backend_response.v1"] = Field(alias="schemaVersion")
    request_id: str | None = Field(default=None, alias="requestId")
    ok: bool
    result: Any = None
    error: dict[str, Any] | None = None


class BackendEvent(WireModel):
    schema_version: Literal["chatgpt.browser_control.backend_event.v1"] = Field(alias="schemaVersion")
    request_id: str | None = Field(default=None, alias="requestId")
    type: StreamEventType
    name: str | None = None
    item: dict[str, Any] | None = None
    agent: dict[str, Any] | None = None
    result: ChatGPTRunResult | dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class RunReportData(WireModel):
    path: str
    bytes: int | None = None
    redacted: bool | None = None


class DoctorReport(WireModel):
    checks: dict[str, dict[str, Any]]


def _command_output_text(data: Any) -> str | None:
    if not isinstance(data, dict):
        return None
    response_text = data.get("responseText")
    if isinstance(response_text, str):
        return response_text
    text = data.get("text")
    if isinstance(text, str) and data.get("role") != "user":
        return text
    markdown = data.get("markdown")
    if isinstance(markdown, str):
        return markdown
    for key, value in data.items():
        if key in {"prompt", "input"}:
            continue
        nested = _command_output_text(value)
        if nested is not None:
            return nested
    return None
