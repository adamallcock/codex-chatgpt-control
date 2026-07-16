from __future__ import annotations

from typing import Any

from .commands import request_backend, wire_kwargs
from .models import CommandResult


def command_result(backend: Any, command: str, payload: dict[str, Any] | None = None) -> CommandResult:
    result = request_backend(backend, command, payload)
    if not isinstance(result, dict):
        raise RuntimeError(f"{command} backend result must be a CommandResult object.")
    return CommandResult.from_wire(result)


class SessionClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def bootstrap(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "session.bootstrap", wire_kwargs(**kwargs))


class ExperienceClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def detect(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "experience.detect", wire_kwargs(**kwargs))

    def open(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "experience.open", wire_kwargs(**kwargs))


class ConfigurationClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def inspect(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "configuration.inspect", wire_kwargs(**kwargs))

    def apply(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "configuration.apply", wire_kwargs(**kwargs))


class ThreadsClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def new(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "threads.new", wire_kwargs(**kwargs))

    def search(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "threads.search", wire_kwargs(**kwargs))

    def open(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "threads.open", wire_kwargs(**kwargs))


class MessagesClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def compose(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "messages.compose", wire_kwargs(**kwargs))

    def submit(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "messages.submit", wire_kwargs(**kwargs))

    def ask(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "messages.ask", wire_kwargs(**kwargs))

    def wait(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "messages.wait", wire_kwargs(**kwargs))

    def read_latest(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "messages.readLatest", wire_kwargs(**kwargs))

    def status(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "messages.status", wire_kwargs(**kwargs))

    def wait_and_read(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "messages.waitAndRead", wire_kwargs(**kwargs))


class FilesClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def preflight(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "files.preflight", wire_kwargs(**kwargs))

    def attach(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "files.attach", wire_kwargs(**kwargs))

    def download_latest(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "files.downloadLatest", wire_kwargs(**kwargs))


class ProjectSourcesClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def list(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "projects.sources.list", wire_kwargs(**kwargs))

    def plan_add(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "projects.sources.planAdd", wire_kwargs(**kwargs))

    def add(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "projects.sources.add", wire_kwargs(**kwargs))


class ProjectsClient:
    def __init__(self, backend: Any) -> None:
        self.sources = ProjectSourcesClient(backend)


class ArtifactsClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def list_latest(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "artifacts.listLatest", wire_kwargs(**kwargs))

    def wait(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "artifacts.wait", wire_kwargs(**kwargs))

    def download_latest(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "artifacts.downloadLatest", wire_kwargs(**kwargs))


class WorkClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend
        self.artifacts = ArtifactsClient(backend)

    def start(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "work.start", wire_kwargs(**kwargs))

    def status(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "work.status", wire_kwargs(**kwargs))

    def wait(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "work.wait", wire_kwargs(**kwargs))

    def steer(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "work.steer", wire_kwargs(**kwargs))

    def read_latest(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "work.readLatest", wire_kwargs(**kwargs))


class ModesClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def set(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "modes.set", wire_kwargs(**kwargs))

    def get(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "modes.get", wire_kwargs(**kwargs))


class ToolsClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def select(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "tools.select", wire_kwargs(**kwargs))


class ResponseClient:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def copy(self, **kwargs: Any) -> CommandResult:
        return command_result(self._backend, "response.copy", wire_kwargs(**kwargs))
