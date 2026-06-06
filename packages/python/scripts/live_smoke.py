from __future__ import annotations

import argparse
import json
import os
import shlex
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = ROOT / "python"
BACKEND_BUNDLE = ROOT / "node" / "dist" / "codex-chatgpt-control-backend.mjs"
BACKEND_COMMAND_ENV = "CHATGPT_BROWSER_BACKEND_COMMAND"
DOCUMENTED_BLOCKER_KINDS = {
    "browser_bridge_unavailable",
    "login_required",
    "captcha",
    "rate_limit",
    "selector_drift",
    "permission",
}

sys.path.insert(0, str(PYTHON_ROOT / "src"))

from codex_chatgpt_control import BackendClient, ChatGPT, CommandResult, Runner, StdioBackendTransport


def ordinary_shell_smoke() -> tuple[int, dict[str, Any]]:
    if not BACKEND_BUNDLE.exists():
        return 2, {
            "mode": "ordinary-shell",
            "ok": False,
            "error": f"Backend bundle not found: {BACKEND_BUNDLE}",
        }

    transport = StdioBackendTransport(command=["node", str(BACKEND_BUNDLE)], timeout_seconds=30)
    client = BackendClient(transport)
    try:
        health = client.health()
        commands = client.request("commands")
        runner_result = client.runner_run(
            {"name": "ordinary-shell-smoke", "instructionsMode": "visible_prefix"},
            "Reply with the word smoke.",
        )
    finally:
        client.close()

    blocker = runner_result.get("blocker") if isinstance(runner_result, dict) else None
    documented_blocker = (
        isinstance(blocker, dict)
        and blocker.get("kind") == "browser_bridge_unavailable"
        and runner_result.get("status") in {"blocked", "partial", "error"}
    )
    summary = {
        "mode": "ordinary-shell",
        "ok": documented_blocker,
        "health": health,
        "commandsCount": len(commands) if isinstance(commands, list) else 0,
        "runnerRun": {
            "status": runner_result.get("status"),
            "blocker": blocker,
        },
    }
    return (0 if documented_blocker else 1), summary


def browser_bridge_smoke(backend_command: str | None, report_dir: Path) -> tuple[int, dict[str, Any]]:
    command, command_source = resolve_backend_command(backend_command)
    if command_source == "default-node-bundle" and not BACKEND_BUNDLE.exists():
        return 2, {
            "mode": "browser-bridge",
            "ok": False,
            "status": "blocked",
            "backendCommandSource": command_source,
            "error": f"Backend bundle not found: {BACKEND_BUNDLE}",
        }

    report_dir.mkdir(parents=True, exist_ok=True)
    transport = StdioBackendTransport(command=command, timeout_seconds=180)
    backend = BackendClient(transport)
    chatgpt = ChatGPT(backend=backend)
    scenarios: list[dict[str, Any]] = []

    try:
        health = backend.health()
        commands = backend.request("commands")
        scenarios.append(run_scenario("runner.run new ask/read", lambda: runner_run_scenario(chatgpt)))
        scenarios.append(run_scenario("runner.run_streamed milestones", lambda: runner_streamed_scenario(backend, chatgpt)))
        scenarios.append(run_scenario("responses.create basic", lambda: responses_create_scenario(chatgpt)))
        scenarios.append(run_scenario("run_plan new-ask-read", lambda: run_plan_scenario(chatgpt)))
        scenarios.append(run_scenario("reports.create redacted", lambda: report_redaction_scenario(chatgpt, report_dir)))
    finally:
        backend.close()

    failed = [scenario for scenario in scenarios if scenario["status"] == "fail"]
    blocked = [scenario for scenario in scenarios if scenario["status"] == "blocked"]
    status = "fail" if failed else "blocked" if blocked else "pass"
    ok = not failed
    summary = {
        "mode": "browser-bridge",
        "ok": ok,
        "status": status,
        "backendCommandSource": command_source,
        "health": health,
        "commandsCount": len(commands) if isinstance(commands, list) else 0,
        "reportDir": str(report_dir),
        "scenarios": scenarios,
        "privacy": {
            "rawPromptPersisted": False,
            "rawResponsePersisted": False,
            "reportsRedactedByDefault": True,
        },
    }
    return (1 if failed else 2 if blocked else 0), summary


def runner_run_scenario(chatgpt: ChatGPT) -> dict[str, Any]:
    agent = chatgpt.agent(
        name="python-browser-bridge-runner",
        defaults={
            "wait": {"timeoutMs": 120000, "stableMs": 2000},
            "read": {"format": "normalized_text"},
        },
    )
    result = chatgpt.runner.run(
        agent,
        {
            "input": "reply with the word hi",
            "thread": {"type": "new"},
            "response": {"format": "normalized_text"},
        },
    )
    return summarize_text_result(result.status, result.ok, result.output_text, first_blocker(result))


def runner_streamed_scenario(backend: BackendClient, chatgpt: ChatGPT) -> dict[str, Any]:
    runner = Runner(backend)
    agent = chatgpt.agent(
        name="python-browser-bridge-stream",
        defaults={
            "wait": {"timeoutMs": 120000, "stableMs": 2000},
            "read": {"format": "normalized_text"},
        },
    )
    stream = runner.run_streamed(
        agent,
        {
            "input": "reply with the word hi",
            "thread": {"type": "new"},
            "response": {"format": "normalized_text"},
        },
    )
    event_names = [event.name for event in stream if event.name is not None]
    final = stream.final_result
    if final is None:
        return {"status": "fail", "details": {"error": "stream did not produce a completed event"}}
    summary = summarize_text_result(final.status, final.ok, final.output_text, first_blocker(final))
    summary["details"]["eventNames"] = event_names
    summary["details"]["completed"] = True
    return summary


def responses_create_scenario(chatgpt: ChatGPT) -> dict[str, Any]:
    response = chatgpt.responses.create(
        {
            "input": "reply with the word hi",
            "thread": {"type": "new"},
            "text": {"format": "normalized_text"},
            "stream": False,
        }
    )
    blocker = first_blocker(response)
    return summarize_text_result(response.status, response.status == "ok", response.output_text, blocker)


def run_plan_scenario(chatgpt: ChatGPT) -> dict[str, Any]:
    result = chatgpt.run_plan(
        {
            "name": "new-ask-read",
            "input": {"prompt": "reply with the word hi"},
        }
    )
    text = command_text(result)
    summary = summarize_text_result(result.status, result.ok, text, first_blocker(result))
    summary["details"]["stepStatuses"] = [
        {"id": step.id, "command": step.command, "status": step.status, "ok": step.ok}
        for step in (result.steps or [])
    ]
    return summary


def report_redaction_scenario(chatgpt: ChatGPT, report_dir: Path) -> dict[str, Any]:
    secret = "pythonbrowserbridgesecret"
    private_path = "/example/user/private/python-browser-bridge-smoke.txt"
    private_email = "private@example.com"
    command = {
        "ok": True,
        "status": "ok",
        "data": {
            "responseText": f"{private_email} {private_path} {secret}",
        },
        "warnings": [],
        "context": {
            "timestamp": "2026-06-06T00:00:00.000Z",
            "url": "https://chatgpt.com/c/python-browser-bridge-smoke",
        },
    }
    result = chatgpt.reports.create(
        command,
        dest_dir=str(report_dir),
        basename="python-browser-bridge-redacted-report",
        include_content=False,
    )
    path = report_path(result)
    body = Path(path).read_text(encoding="utf-8") if path is not None else ""
    redacted = (
        result.ok
        and path is not None
        and "[redacted:" in body
        and secret not in body
        and private_path not in body
        and private_email not in body
    )
    return {
        "status": "pass" if redacted else "fail",
        "details": {
            "reportWritten": path is not None,
            "reportPath": path,
            "redacted": redacted,
            "bytes": result.data.get("bytes") if isinstance(result.data, dict) else None,
            "includeContent": result.data.get("includeContent") if isinstance(result.data, dict) else None,
        },
    }


def run_scenario(name: str, body: Any) -> dict[str, Any]:
    try:
        result = body()
    except Exception as exc:  # pragma: no cover - exercised by live failures.
        result = {
            "status": "fail",
            "details": {
                "errorType": type(exc).__name__,
                "error": str(exc),
            },
        }
    return {"name": name, **result}


def summarize_text_result(status: str, ok: bool, output_text: str, blocker: dict[str, Any] | None) -> dict[str, Any]:
    output_matched = normalized_text(output_text) == "hi"
    if ok and output_matched:
        scenario_status = "pass"
    elif documented_blocker(blocker):
        scenario_status = "blocked"
    else:
        scenario_status = "fail"
    return {
        "status": scenario_status,
        "details": {
            "resultStatus": status,
            "resultOk": ok,
            "outputMatched": output_matched,
            "outputChars": len(output_text),
            "blocker": redact_blocker(blocker),
        },
    }


def command_text(result: CommandResult) -> str:
    data = result.data
    if isinstance(data, dict):
        for key in ("responseText", "text", "markdown"):
            value = data.get(key)
            if isinstance(value, str):
                return value
    return ""


def report_path(result: CommandResult) -> str | None:
    if result.report_path is not None:
        return result.report_path
    data = result.data
    if isinstance(data, dict) and isinstance(data.get("path"), str):
        return data["path"]
    return None


def first_blocker(value: Any) -> dict[str, Any] | None:
    blocker = getattr(value, "blocker", None)
    if isinstance(blocker, dict):
        return blocker

    interruptions = getattr(value, "interruptions", None)
    if isinstance(interruptions, list):
        for item in interruptions:
            if isinstance(item, dict) and isinstance(item.get("blocker"), dict):
                return item["blocker"]

    output = getattr(value, "output", None)
    if isinstance(output, list):
        for item in output:
            if isinstance(item, dict) and isinstance(item.get("blocker"), dict):
                return item["blocker"]

    return None


def documented_blocker(blocker: dict[str, Any] | None) -> bool:
    return isinstance(blocker, dict) and blocker.get("kind") in DOCUMENTED_BLOCKER_KINDS


def redact_blocker(blocker: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(blocker, dict):
        return None
    redacted: dict[str, Any] = {}
    if isinstance(blocker.get("kind"), str):
        redacted["kind"] = blocker["kind"]
    if isinstance(blocker.get("code"), str):
        redacted["code"] = blocker["code"]
    if isinstance(blocker.get("recoverable"), bool):
        redacted["recoverable"] = blocker["recoverable"]
    return redacted or None


def normalized_text(value: str) -> str:
    return value.strip().lower().rstrip(".!?")


def resolve_backend_command(backend_command: str | None) -> tuple[list[str], str]:
    if backend_command is not None:
        return shlex.split(backend_command), "cli"

    env_command = os.environ.get(BACKEND_COMMAND_ENV)
    if env_command:
        return shlex.split(env_command), BACKEND_COMMAND_ENV

    return ["node", str(BACKEND_BUNDLE)], "default-node-bundle"


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test the ChatGPT browser-control backend.")
    parser.add_argument("--mode", choices=["ordinary-shell", "browser-bridge"], required=True)
    parser.add_argument(
        "--backend-command",
        help=f"Override stdio backend command for browser-bridge mode. Defaults to ${BACKEND_COMMAND_ENV} or the Node bundle.",
    )
    parser.add_argument(
        "--report-dir",
        type=Path,
        default=PYTHON_ROOT / "reports" / "live-smoke-python",
        help="Directory for redacted browser-bridge smoke reports.",
    )
    args = parser.parse_args()

    if args.mode == "browser-bridge":
        code, summary = browser_bridge_smoke(args.backend_command, args.report_dir)
        print(json.dumps(summary, indent=2, sort_keys=True))
        return code

    code, summary = ordinary_shell_smoke()
    print(json.dumps(summary, indent=2, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
