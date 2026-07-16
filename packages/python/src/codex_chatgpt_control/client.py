from __future__ import annotations

from typing import Any, Protocol

from .agent import Agent
from .commands import CommandClient
from .diagnostics import explain_blocker
from .models import ChatGPTRunResult, SequencePlan
from .primitives import (
    ArtifactsClient,
    ConfigurationClient,
    ExperienceClient,
    FilesClient,
    MessagesClient,
    ModesClient,
    ProjectsClient,
    ResponseClient,
    SessionClient,
    ThreadsClient,
    ToolsClient,
    WorkClient,
)
from .reports import ReportsClient
from .responses import ResponsesClient
from .workflows import WorkflowClient


class RunTransport(Protocol):
    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Run a ChatGPT browser-control request and return the wire result."""
        ...


ChatGPTAgent = Agent


class MissingTransport:
    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError(
            "No ChatGPT browser-control transport is configured. Pass a fake transport, "
            "BackendClient, or NodeSidecarTransport for the TypeScript backend."
        )


class ChatGPTRunner:
    def __init__(self, transport: RunTransport) -> None:
        self._transport = transport

    def run(self, agent: ChatGPTAgent, input: Any) -> ChatGPTRunResult:
        runner_run = getattr(self._transport, "runner_run", None)
        if callable(runner_run):
            result = runner_run(agent.to_wire(), input)
            if not isinstance(result, dict):
                raise RuntimeError("runner.run transport result must be a JSON object.")
            return ChatGPTRunResult.from_wire(result)
        payload = {
            "schemaVersion": "chatgpt.browser_control.run.v1",
            "agent": agent.to_wire(),
            "input": input,
        }
        return ChatGPTRunResult.from_wire(self._transport.run(payload))

    def plan(self, agent: ChatGPTAgent, input: Any) -> SequencePlan:
        runner_plan = getattr(self._transport, "runner_plan", None)
        if not callable(runner_plan):
            raise RuntimeError("This ChatGPT transport does not support runner.plan.")
        result = runner_plan(agent.to_wire(), input)
        if not isinstance(result, dict):
            raise RuntimeError("runner.plan transport result must be a JSON object.")
        return SequencePlan.from_wire(result)


class ChatGPT:
    def __init__(self, transport: RunTransport | None = None, *, backend: Any | None = None) -> None:
        self._transport = backend or transport or MissingTransport()
        self.runner = ChatGPTRunner(self._transport)
        self.responses = ResponsesClient(self._transport)
        self._workflows = WorkflowClient(self._transport)
        self._commands = CommandClient(self._transport)
        self.session = SessionClient(self._transport)
        self.experience = ExperienceClient(self._transport)
        self.configuration = ConfigurationClient(self._transport)
        self.work = WorkClient(self._transport)
        self.threads = ThreadsClient(self._transport)
        self.messages = MessagesClient(self._transport)
        self.files = FilesClient(self._transport)
        self.projects = ProjectsClient(self._transport)
        self.artifacts = ArtifactsClient(self._transport)
        self.modes = ModesClient(self._transport)
        self.tools = ToolsClient(self._transport)
        self.response = ResponseClient(self._transport)
        self.reports = ReportsClient(self._transport)

    def run(self, agent: ChatGPTAgent, input: Any) -> ChatGPTRunResult:
        return self.runner.run(agent, input)

    def ask(self, **kwargs: Any):
        return self._workflows.ask(**kwargs)

    def ask_in_thread(self, **kwargs: Any):
        return self._workflows.ask_in_thread(**kwargs)

    def ask_with_files(self, **kwargs: Any):
        return self._workflows.ask_with_files(**kwargs)

    def ask_and_download(self, **kwargs: Any):
        return self._workflows.ask_and_download(**kwargs)

    def run_messages(self, **kwargs: Any):
        return self._workflows.run_messages(**kwargs)

    def open_thread(self, thread: dict[str, Any]):
        return self._workflows.open_thread(thread)

    def read_latest(self, **kwargs: Any):
        return self._workflows.read_latest(**kwargs)

    def copy_latest(self, **kwargs: Any):
        return self._workflows.copy_latest(**kwargs)

    def download_latest(self, **kwargs: Any):
        return self._workflows.download_latest(**kwargs)

    def run_plan(self, plan: dict[str, Any]):
        return self._workflows.run_plan(plan)

    def doctor(self, **kwargs: Any):
        return self._workflows.doctor(**kwargs)

    def create_report(self, result: dict[str, Any], **kwargs: Any):
        return self._workflows.create_report(result, **kwargs)

    def explain_blocker(self, result_or_blocker: Any, **kwargs: Any) -> dict[str, Any]:
        return explain_blocker(result_or_blocker, **kwargs)

    def commands(self, *, layer: str | None = None):
        return self._commands.commands(layer=layer)

    def describe(self, name: str):
        return self._commands.describe(name)

    def help(self, topic: str | None = None):
        return self._commands.help(topic)

    def agent(
        self,
        *,
        name: str,
        instructions: str | None = None,
        instructions_mode: str = "visible_prefix",
        defaults: dict[str, Any] | None = None,
        tools: list[dict[str, Any]] | None = None,
        guardrails: list[dict[str, Any]] | None = None,
        output: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ChatGPTAgent:
        return ChatGPTAgent(
            name=name,
            instructions=instructions,
            instructions_mode=instructions_mode,  # type: ignore[arg-type]
            defaults=defaults or {},
            tools=tools or [],
            guardrails=guardrails or [],
            output=output,
            metadata=metadata,
        )
