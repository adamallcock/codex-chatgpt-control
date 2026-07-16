from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .commands import to_wire_value


InstructionsMode = Literal["visible_prefix", "visible_setup_message", "metadata_only"]


@dataclass(frozen=True)
class Agent:
    name: str
    instructions: str | None = None
    instructions_mode: InstructionsMode = "visible_prefix"
    defaults: dict[str, Any] = field(default_factory=dict)
    tools: list[dict[str, Any]] = field(default_factory=list)
    guardrails: list[dict[str, Any]] = field(default_factory=list)
    output: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        normalized = self.name.strip()
        if not normalized:
            raise ValueError("Agent name must not be empty.")
        object.__setattr__(self, "name", normalized)

    def to_wire(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "kind": "chatgpt_browser_agent",
            "name": self.name,
            "instructionsMode": self.instructions_mode,
            "defaults": to_wire_value(self.defaults),
            "tools": to_wire_value(self.tools),
            "guardrails": to_wire_value(self.guardrails),
        }
        if self.instructions is not None:
            payload["instructions"] = self.instructions
        if self.output is not None:
            payload["output"] = to_wire_value(self.output)
        if self.metadata is not None:
            payload["metadata"] = to_wire_value(self.metadata)
        return payload


AgentConfig = Agent
