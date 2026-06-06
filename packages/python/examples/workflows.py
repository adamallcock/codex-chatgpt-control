from __future__ import annotations

import argparse
from pathlib import Path

from _backend import create_backend
from codex_chatgpt_control import ChatGPT


def main() -> None:
    parser = argparse.ArgumentParser(description="Run ChatGPT browser-control Python workflow examples.")
    parser.add_argument("--file", type=Path, help="Optional file to attach for ask_with_files.")
    parser.add_argument("--report-dir", type=Path, default=Path("reports/python-examples"))
    args = parser.parse_args()

    backend = create_backend()
    chatgpt = ChatGPT(backend=backend)
    try:
        if args.file is not None:
            attached = chatgpt.ask_with_files(
                prompt="Summarize this file in one sentence.",
                files=[str(args.file)],
                thread={"type": "new"},
                wait={"timeoutMs": 120000, "stableMs": 2000},
                read={"format": "markdown"},
            )
            print(attached.status)

        named = chatgpt.run_plan(
            {
                "name": "new-ask-read",
                "input": {"prompt": "Reply with the word hi."},
            }
        )
        print(named.status)

        doctor = chatgpt.doctor(check=["bridge", "login", "upload"])
        print(doctor.status)

        report = chatgpt.reports.create(
            {
                "ok": True,
                "status": "ok",
                "data": {"responseText": "private@example.com /example/user/private"},
                "warnings": [],
                "context": {"timestamp": "2026-06-06T00:00:00.000Z"},
            },
            dest_dir=str(args.report_dir),
            basename="python-workflow-example",
            include_content=False,
        )
        print(report.status)
        if isinstance(report.data, dict):
            print(report.data.get("path"))
    finally:
        backend.close()


if __name__ == "__main__":
    main()
