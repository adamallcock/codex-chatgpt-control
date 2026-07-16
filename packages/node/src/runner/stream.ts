import type { ChatGPTRunItem, ChatGPTRunResult } from "./types.js";

export type ChatGPTRunStreamEventName =
  | "thread_opened"
  | "experience_opened"
  | "configuration_applied"
  | "mode_selected"
  | "tool_selected"
  | "file_attached"
  | "message_submitted"
  | "message_in_progress"
  | "message_completed"
  | "file_downloaded"
  | "run_blocked";

export type ChatGPTRunStreamEvent = {
  type: "run_item_stream_event";
  name: ChatGPTRunStreamEventName;
  item: ChatGPTRunItem;
};

export type ChatGPTRunStream<TOutput = string> = AsyncIterable<ChatGPTRunStreamEvent> & {
  completed: Promise<ChatGPTRunResult<TOutput>>;
};

export function createMilestoneStream<TOutput = string>(
  run: (emit: (event: ChatGPTRunStreamEvent) => void) => Promise<ChatGPTRunResult<TOutput>>
): ChatGPTRunStream<TOutput> {
  const queue: ChatGPTRunStreamEvent[] = [];
  let resolveNext: (() => void) | undefined;
  let finished = false;

  const completed = run(event => {
    queue.push(event);
    resolveNext?.();
    resolveNext = undefined;
  }).finally(() => {
    finished = true;
    resolveNext?.();
    resolveNext = undefined;
  });

  return {
    completed,
    async *[Symbol.asyncIterator]() {
      while (!finished || queue.length > 0) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }

        await new Promise<void>(resolve => {
          resolveNext = resolve;
        });
      }
    }
  };
}

export function streamFromRunResult<TOutput>(
  run: () => Promise<ChatGPTRunResult<TOutput>>
): ChatGPTRunStream<TOutput> {
  return createMilestoneStream(async emit => {
    const result = await run();
    for (const item of result.newItems) {
      emit(runItemStreamEvent(item));
    }
    return result;
  });
}

export function runItemStreamEvent(item: ChatGPTRunItem): ChatGPTRunStreamEvent {
  return {
    type: "run_item_stream_event",
    name: runItemEventName(item),
    item
  };
}

function runItemEventName(item: ChatGPTRunItem): ChatGPTRunStreamEventName {
  switch (item.type) {
    case "thread.opened":
      return "thread_opened";
    case "experience.opened":
      return "experience_opened";
    case "configuration.applied":
      return "configuration_applied";
    case "mode.selected":
      return "mode_selected";
    case "tool.selected":
      return "tool_selected";
    case "file.attached":
      return "file_attached";
    case "message.submitted":
      return "message_submitted";
    case "message.in_progress":
      return "message_in_progress";
    case "message.completed":
      return "message_completed";
    case "file.downloaded":
      return "file_downloaded";
    case "approval.required":
    case "run.blocked":
      return "run_blocked";
  }
}
