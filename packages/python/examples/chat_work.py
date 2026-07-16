from __future__ import annotations

from _backend import create_backend
from codex_chatgpt_control import ChatGPT


def main() -> None:
    backend = create_backend()
    chatgpt = ChatGPT(backend=backend)
    try:
        surface = chatgpt.experience.detect()
        print(surface.status, surface.data)

        capabilities = chatgpt.configuration.inspect(experience="work")
        print(capabilities.status, capabilities.data)

        started = chatgpt.work.start(
            prompt="Produce a decision-ready implementation brief.",
            new_task=True,
            configuration={
                "model": "GPT-5.6 Sol",
                "effort": "High",
                "speed": "Standard",
            },
            wait=False,
            read=False,
        )
        print(started.status, started.blocker)

        if started.ok:
            status = chatgpt.work.status(include_artifacts=True)
            print(status.status, status.data)
    finally:
        backend.close()


if __name__ == "__main__":
    main()
