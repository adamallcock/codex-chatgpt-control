from __future__ import annotations

import inspect
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from .agent import Agent
from .commands import wire_kwargs
from .models import BackendEvent, ChatGPTResponse, ChatGPTRunResult, CommandDescriptor, CommandResult, SequencePlan
from .responses import (
    normalize_create_args,
    response_from_run_result,
    responses_create_args_to_run_input,
    unsupported_response,
    validate_responses_create_args,
)


class AsyncBackendProtocol(Protocol):
    def request(self, command: str, payload: dict[str, Any] | None = None) -> Any:
        ...


class AsyncRunTransport(Protocol):
    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Legacy async sidecar run shape kept as a compatibility fallback."""
        ...


async def maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def async_request_backend(backend: Any, command: str, payload: dict[str, Any] | None = None) -> Any:
    request = getattr(backend, "request", None)
    if not callable(request):
        raise RuntimeError(f"This ChatGPT backend does not support {command}.")
    return await maybe_await(request(command, payload or {}))


def command_result_from_wire(value: Any, command: str) -> CommandResult:
    if not isinstance(value, dict):
        raise RuntimeError(f"{command} backend result must be a CommandResult object.")
    return CommandResult.from_wire(value)


class AsyncChatGPTRunner:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    async def run(self, agent: Agent, input: Any) -> ChatGPTRunResult:
        runner_run = getattr(self._backend, "runner_run", None)
        if callable(runner_run):
            result = await maybe_await(runner_run(agent.to_wire(), input))
            if not isinstance(result, dict):
                raise RuntimeError("runner.run backend result must be a JSON object.")
            return ChatGPTRunResult.from_wire(result)

        request = getattr(self._backend, "request", None)
        if callable(request):
            result = await async_request_backend(self._backend, "runner.run", {"agent": agent.to_wire(), "input": input})
            if not isinstance(result, dict):
                raise RuntimeError("runner.run backend result must be a JSON object.")
            return ChatGPTRunResult.from_wire(result)

        legacy_run = getattr(self._backend, "run", None)
        if not callable(legacy_run):
            raise RuntimeError("This ChatGPT backend does not support runner.run.")
        payload = {
            "schemaVersion": "chatgpt.browser_control.run.v1",
            "agent": agent.to_wire(),
            "input": input,
        }
        return ChatGPTRunResult.from_wire(await maybe_await(legacy_run(payload)))

    async def plan(self, agent: Agent, input: Any) -> SequencePlan:
        runner_plan = getattr(self._backend, "runner_plan", None)
        if callable(runner_plan):
            result = await maybe_await(runner_plan(agent.to_wire(), input))
        else:
            result = await async_request_backend(self._backend, "runner.plan", {"agent": agent.to_wire(), "input": input})
        if not isinstance(result, dict):
            raise RuntimeError("runner.plan backend result must be a JSON object.")
        return SequencePlan.from_wire(result)

    def run_streamed(self, agent: Agent, input: Any) -> "AsyncRunResultStreaming":
        runner_stream = getattr(self._backend, "runner_stream", None)
        if callable(runner_stream):
            events = runner_stream(agent.to_wire(), input)
        else:
            stream = getattr(self._backend, "stream", None)
            if not callable(stream):
                raise RuntimeError("This ChatGPT backend does not support runner.stream.")
            events = stream("runner.stream", {"agent": agent.to_wire(), "input": input})
        return AsyncRunResultStreaming(events)


@dataclass
class AsyncRunResultStreaming:
    _events: Any
    final_result: ChatGPTRunResult | None = None
    _iterator: Iterator[Any] | None = None

    def __aiter__(self) -> "AsyncRunResultStreaming":
        return self

    async def __anext__(self) -> BackendEvent:
        if hasattr(self._events, "__anext__"):
            raw = await self._events.__anext__()
        else:
            if self._iterator is None:
                self._iterator = iter(self._events)
            try:
                raw = next(self._iterator)
            except StopIteration as exc:
                raise StopAsyncIteration from exc
        event = BackendEvent.from_wire(raw)
        if event.type == "completed" and isinstance(event.result, ChatGPTRunResult):
            self.final_result = event.result
        return event


class AsyncResponsesClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    async def create(self, args: dict[str, Any] | None = None, **kwargs: Any) -> ChatGPTResponse:
        payload = normalize_create_args({**(args or {}), **kwargs})
        validation = validate_responses_create_args(payload)
        now = datetime.now(timezone.utc)
        if not validation.ok:
            return unsupported_response(validation.unsupported, now)

        request = getattr(self._backend, "request", None)
        if callable(request):
            result = await async_request_backend(self._backend, "responses.create", payload)
            if not isinstance(result, dict):
                raise RuntimeError("responses.create backend result must be a JSON object.")
            return ChatGPTResponse.from_wire(result)

        responses_create = getattr(self._backend, "responses_create", None)
        if callable(responses_create):
            result = await maybe_await(responses_create(payload))
            if not isinstance(result, dict):
                raise RuntimeError("responses.create backend result must be a JSON object.")
            return ChatGPTResponse.from_wire(result)

        legacy_run = getattr(self._backend, "run", None)
        if not callable(legacy_run):
            raise RuntimeError("This ChatGPT backend does not support responses.create.")
        agent = Agent(
            name="responses-adapter",
            instructions=payload.get("instructions") if isinstance(payload.get("instructions"), str) else None,
            instructions_mode=payload.get("instructionsMode", "visible_prefix"),  # type: ignore[arg-type]
        )
        result = await maybe_await(legacy_run({
            "schemaVersion": "chatgpt.browser_control.run.v1",
            "agent": agent.to_wire(),
            "input": responses_create_args_to_run_input(payload),
        }))
        return response_from_run_result(ChatGPTRunResult.from_wire(result), now)


class AsyncWorkflowClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    async def ask(self, **kwargs: Any) -> CommandResult:
        return command_result_from_wire(await async_request_backend(self._backend, "ask", wire_kwargs(**kwargs)), "ask")

    async def ask_in_thread(self, **kwargs: Any) -> CommandResult:
        return command_result_from_wire(await async_request_backend(self._backend, "askInThread", wire_kwargs(**kwargs)), "askInThread")

    async def ask_with_files(self, **kwargs: Any) -> CommandResult:
        return command_result_from_wire(await async_request_backend(self._backend, "askWithFiles", wire_kwargs(**kwargs)), "askWithFiles")

    async def ask_and_download(self, **kwargs: Any) -> CommandResult:
        return command_result_from_wire(await async_request_backend(self._backend, "askAndDownload", wire_kwargs(**kwargs)), "askAndDownload")

    async def run_messages(self, **kwargs: Any) -> CommandResult:
        return command_result_from_wire(await async_request_backend(self._backend, "runMessages", wire_kwargs(**kwargs)), "runMessages")

    async def open_thread(self, thread: dict[str, Any]) -> CommandResult:
        return command_result_from_wire(await async_request_backend(self._backend, "openThread", thread), "openThread")

    async def read_latest(self, **kwargs: Any) -> CommandResult:
        return command_result_from_wire(await async_request_backend(self._backend, "readLatest", wire_kwargs(**kwargs)), "readLatest")

    async def copy_latest(self, **kwargs: Any) -> CommandResult:
        return command_result_from_wire(await async_request_backend(self._backend, "copyLatest", wire_kwargs(**kwargs)), "copyLatest")

    async def download_latest(self, **kwargs: Any) -> CommandResult:
        return command_result_from_wire(await async_request_backend(self._backend, "downloadLatest", wire_kwargs(**kwargs)), "downloadLatest")

    async def run_plan(self, plan: dict[str, Any]) -> CommandResult:
        return command_result_from_wire(await async_request_backend(self._backend, "runPlan", plan), "runPlan")

    async def doctor(self, **kwargs: Any) -> CommandResult:
        return command_result_from_wire(await async_request_backend(self._backend, "doctor", wire_kwargs(**kwargs)), "doctor")

    async def create_report(self, result: dict[str, Any], **kwargs: Any) -> CommandResult:
        payload: dict[str, Any] = {"result": result}
        args = wire_kwargs(**kwargs)
        if args:
            payload["args"] = args
        return command_result_from_wire(await async_request_backend(self._backend, "createReport", payload), "createReport")


class AsyncCommandClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    async def commands(self, *, layer: str | None = None) -> list[CommandDescriptor]:
        payload: dict[str, Any] = {}
        if layer is not None:
            payload["filter"] = {"layer": layer}
        result = await async_request_backend(self._backend, "commands", payload)
        if not isinstance(result, list):
            raise RuntimeError("commands backend result must be a list.")
        return [CommandDescriptor.from_wire(item) for item in result]

    async def describe(self, name: str) -> CommandDescriptor:
        result = await async_request_backend(self._backend, "describe", {"name": name})
        if not isinstance(result, dict):
            raise RuntimeError("describe backend result must be a command descriptor.")
        return CommandDescriptor.from_wire(result)

    async def help(self, topic: str | None = None) -> str:
        payload = {} if topic is None else {"topic": topic}
        result = await async_request_backend(self._backend, "help", payload)
        if not isinstance(result, str):
            raise RuntimeError("help backend result must be a string.")
        return result


class AsyncReportsClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    async def create(self, result: dict[str, Any], **kwargs: Any) -> CommandResult:
        return await async_report_command(self._backend, "reports.create", {"result": result}, **kwargs)

    async def redact(self, value: Any, **kwargs: Any) -> CommandResult:
        return await async_report_command(self._backend, "reports.redact", {"value": value}, **kwargs)

    async def summarize(self, result: dict[str, Any], **kwargs: Any) -> CommandResult:
        return await async_report_command(self._backend, "reports.summarize", {"result": result}, **kwargs)


async def async_report_command(backend: Any, command: str, payload: dict[str, Any], **kwargs: Any) -> CommandResult:
    args = wire_kwargs(**kwargs)
    if args:
        payload["args"] = args
    return command_result_from_wire(await async_request_backend(backend, command, payload), command)


class AsyncPrimitiveGroup:
    def __init__(self, backend: Any, commands: dict[str, str]) -> None:
        self._backend = backend
        self._commands = commands

    def __getattr__(self, name: str):
        command = self._commands.get(name)
        if command is None:
            raise AttributeError(name)

        async def call(**kwargs: Any) -> CommandResult:
            return command_result_from_wire(await async_request_backend(self._backend, command, wire_kwargs(**kwargs)), command)

        return call


class AsyncProjectsClient:
    def __init__(self, backend: Any) -> None:
        self.sources = AsyncPrimitiveGroup(backend, {
            "list": "projects.sources.list",
            "plan_add": "projects.sources.planAdd",
            "add": "projects.sources.add",
        })


class AsyncWorkClient(AsyncPrimitiveGroup):
    def __init__(self, backend: Any) -> None:
        super().__init__(backend, {
            "start": "work.start",
            "status": "work.status",
            "wait": "work.wait",
            "steer": "work.steer",
            "read_latest": "work.readLatest",
        })
        self.artifacts = AsyncPrimitiveGroup(backend, {
            "list_latest": "artifacts.listLatest",
            "wait": "artifacts.wait",
            "download_latest": "artifacts.downloadLatest",
        })


class AsyncChatGPT:
    def __init__(self, transport: Any) -> None:
        self._backend = transport
        self.responses = AsyncResponsesClient(transport)
        self.runner = AsyncChatGPTRunner(transport)
        self._workflows = AsyncWorkflowClient(transport)
        self._commands = AsyncCommandClient(transport)
        self.session = AsyncPrimitiveGroup(transport, {"bootstrap": "session.bootstrap"})
        self.experience = AsyncPrimitiveGroup(transport, {
            "detect": "experience.detect",
            "open": "experience.open",
        })
        self.configuration = AsyncPrimitiveGroup(transport, {
            "inspect": "configuration.inspect",
            "apply": "configuration.apply",
        })
        self.work = AsyncWorkClient(transport)
        self.threads = AsyncPrimitiveGroup(transport, {"new": "threads.new", "search": "threads.search", "open": "threads.open"})
        self.messages = AsyncPrimitiveGroup(transport, {
            "compose": "messages.compose",
            "submit": "messages.submit",
            "ask": "messages.ask",
            "wait": "messages.wait",
            "read_latest": "messages.readLatest",
            "status": "messages.status",
            "wait_and_read": "messages.waitAndRead",
        })
        self.files = AsyncPrimitiveGroup(transport, {"preflight": "files.preflight", "attach": "files.attach", "download_latest": "files.downloadLatest"})
        self.projects = AsyncProjectsClient(transport)
        self.artifacts = AsyncPrimitiveGroup(transport, {
            "list_latest": "artifacts.listLatest",
            "wait": "artifacts.wait",
            "download_latest": "artifacts.downloadLatest",
        })
        self.modes = AsyncPrimitiveGroup(transport, {"set": "modes.set", "get": "modes.get"})
        self.tools = AsyncPrimitiveGroup(transport, {"select": "tools.select"})
        self.response = AsyncPrimitiveGroup(transport, {"copy": "response.copy"})
        self.reports = AsyncReportsClient(transport)

    async def run(self, agent: Agent, input: Any) -> ChatGPTRunResult:
        return await self.runner.run(agent, input)

    async def ask(self, **kwargs: Any) -> CommandResult:
        return await self._workflows.ask(**kwargs)

    async def ask_in_thread(self, **kwargs: Any) -> CommandResult:
        return await self._workflows.ask_in_thread(**kwargs)

    async def ask_with_files(self, **kwargs: Any) -> CommandResult:
        return await self._workflows.ask_with_files(**kwargs)

    async def ask_and_download(self, **kwargs: Any) -> CommandResult:
        return await self._workflows.ask_and_download(**kwargs)

    async def run_messages(self, **kwargs: Any) -> CommandResult:
        return await self._workflows.run_messages(**kwargs)

    async def open_thread(self, thread: dict[str, Any]) -> CommandResult:
        return await self._workflows.open_thread(thread)

    async def read_latest(self, **kwargs: Any) -> CommandResult:
        return await self._workflows.read_latest(**kwargs)

    async def copy_latest(self, **kwargs: Any) -> CommandResult:
        return await self._workflows.copy_latest(**kwargs)

    async def download_latest(self, **kwargs: Any) -> CommandResult:
        return await self._workflows.download_latest(**kwargs)

    async def run_plan(self, plan: dict[str, Any]) -> CommandResult:
        return await self._workflows.run_plan(plan)

    async def doctor(self, **kwargs: Any) -> CommandResult:
        return await self._workflows.doctor(**kwargs)

    async def create_report(self, result: dict[str, Any], **kwargs: Any) -> CommandResult:
        return await self._workflows.create_report(result, **kwargs)

    async def commands(self, *, layer: str | None = None) -> list[CommandDescriptor]:
        return await self._commands.commands(layer=layer)

    async def describe(self, name: str) -> CommandDescriptor:
        return await self._commands.describe(name)

    async def help(self, topic: str | None = None) -> str:
        return await self._commands.help(topic)

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
    ) -> Agent:
        return Agent(
            name=name,
            instructions=instructions,
            instructions_mode=instructions_mode,  # type: ignore[arg-type]
            defaults=defaults or {},
            tools=tools or [],
            guardrails=guardrails or [],
            output=output,
            metadata=metadata,
        )
