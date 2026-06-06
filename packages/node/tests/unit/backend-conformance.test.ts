import { describe, expect, it } from "vitest";
import { createChatGPT, type ChatGPTClient, type ChatGPTClientOptions } from "../../src/client.js";
import { createChatGPTBackendClient, type BackendTransport } from "../../src/backend/client.js";
import { BackendSession } from "../../src/backend/session.js";
import type { BackendEvent, BackendRequest, BackendResponse } from "../../src/backend/protocol.js";
import { BROWSER_BRIDGE_UNAVAILABLE_MESSAGE } from "../../src/errors.js";
import type { BrowserLike, CommandResult, LocatorLike, PageLike } from "../../src/types.js";

describe("backend conformance", () => {
  it("matches in-process and backend-client runner plans", async () => {
    const { inProcess, backend } = createClientPair();
    const agentConfig = {
      name: "visible-prefix-agent",
      instructions: "Answer with terse implementation guidance.",
      instructionsMode: "visible_prefix" as const
    };
    const input = "Assess the SDK architecture.";

    const expected = inProcess.runner.plan(inProcess.agent(agentConfig), input);
    const actual = await backend.runner.plan(backend.agent(agentConfig), input);

    expect(actual).toEqual(expected);
  });

  it("matches in-process and backend-client Responses unsupported output", async () => {
    const { inProcess, backend } = createClientPair();
    const args = { input: "Visible request.", instructions: "Hidden instruction request." };

    await expect(backend.responses.create(args)).resolves.toEqual(await inProcess.responses.create(args));
  });

  it("matches command registry and help surfaces", async () => {
    const { inProcess, backend } = createClientPair();

    await expect(backend.commands()).resolves.toEqual(inProcess.commands());
    await expect(backend.commands({ layer: "primitive" })).resolves.toEqual(inProcess.commands({ layer: "primitive" }));
    await expect(backend.describe("runner.run")).resolves.toEqual(inProcess.describe("runner.run"));
    await expect(backend.help()).resolves.toEqual(inProcess.help());
    await expect(backend.help("runner.run")).resolves.toEqual(inProcess.help("runner.run"));
  });

  it("matches diagnostics, reports, and browser-blocked primitive commands", async () => {
    const { inProcess, backend } = createClientPair();
    const sensitiveValue = {
      prompt: "private@example.com",
      file: "/example/user/private/report.txt",
      token: "token_12345678901234567890123456789012"
    };
    const blockedResult = {
      ok: false,
      status: "blocked" as const,
      warnings: ["contains sensitive preview"],
      blocker: {
        kind: "browser_bridge_unavailable" as const,
        message: BROWSER_BRIDGE_UNAVAILABLE_MESSAGE,
        visibleText: "private@example.com"
      },
      context: { timestamp: "2026-06-06T00:00:00.000Z" }
    } satisfies CommandResult<unknown>;

    expect(normalizeDynamic(await backend.doctor({ check: ["bridge", "upload"] }))).toEqual(
      normalizeDynamic(await inProcess.doctor({ check: ["bridge", "upload"] }))
    );
    await expect(backend.session.bootstrap()).resolves.toEqual(await inProcess.session.bootstrap());
    expect(normalizeDynamic(await backend.reports.redact(sensitiveValue))).toEqual(
      normalizeDynamic(await inProcess.reports.redact(sensitiveValue))
    );
    expect(normalizeDynamic(await backend.reports.summarize(blockedResult))).toEqual(
      normalizeDynamic(await inProcess.reports.summarize(blockedResult))
    );
  });

  it("matches workflow command execution through a deterministic browser", async () => {
    const { inProcess, backend } = createClientPair(() => deterministicOptions({
      browser: fakeBrowser({ assistantText: "hi" })
    }));
    const args = {
      prompt: "Reply with hi.",
      wait: { stableMs: 0, pollMs: 0, timeoutMs: 100 },
      read: { format: "normalized_text" as const }
    };

    expect(normalizeDynamic(await backend.ask(args))).toEqual(normalizeDynamic(await inProcess.ask(args)));
  });

  it("matches stream event names and final status", async () => {
    const { inProcess, backend } = createClientPair(() => deterministicOptions({ limits: { maxPromptsPerRun: 0 } }));
    const inProcessStream = inProcess.runner.run(inProcess.agent({ name: "stream-agent" }), "hi", { stream: true });
    const backendStream = backend.runner.stream(backend.agent({ name: "stream-agent" }), "hi");

    const expectedNames: string[] = [];
    for await (const event of inProcessStream) expectedNames.push(event.name);
    const actualNames: string[] = [];
    for await (const event of backendStream) actualNames.push(event.name);

    expect(actualNames).toEqual(expectedNames);
    await expect(backendStream.completed).resolves.toMatchObject({
      status: (await inProcessStream.completed).status
    });
  });
});

function createClientPair(optionsFactory: () => ChatGPTClientOptions = deterministicOptions): {
  inProcess: ChatGPTClient;
  backend: ReturnType<typeof createChatGPTBackendClient>;
} {
  const inProcess = createChatGPT(optionsFactory());
  const backend = createChatGPTBackendClient(new SessionTransport(new BackendSession(optionsFactory())));
  return { inProcess, backend };
}

function deterministicOptions(overrides: ChatGPTClientOptions = {}): ChatGPTClientOptions {
  return {
    now: () => new Date("2026-06-06T00:00:00.000Z"),
    ...overrides
  };
}

class SessionTransport implements BackendTransport {
  constructor(private readonly session: BackendSession) {}

  async request(request: BackendRequest): Promise<BackendResponse> {
    return this.session.dispatch(request);
  }

  stream(request: BackendRequest): AsyncIterable<BackendEvent> {
    return this.session.stream(request);
  }
}

function fakeBrowser({ assistantText }: { assistantText: string }): BrowserLike {
  return {
    name: "chrome",
    tabs: {
      selected: () => fakeChatGPTPage({ assistantText })
    }
  };
}

function fakeChatGPTPage({ assistantText }: { assistantText: string }): PageLike {
  let currentUrl = "https://chatgpt.com/";
  let composerText = "";
  let submittedPrompt = "";

  const emptyLocator: LocatorLike = {
    count: async () => 0,
    isVisible: async () => false,
    first: () => emptyLocator,
    last: () => emptyLocator,
    nth: () => emptyLocator
  };

  const textbox: LocatorLike = {
    click: async () => {},
    fill: async value => {
      composerText = value;
    },
    innerText: async () => composerText,
    textContent: async () => composerText
  };

  const sendButton: LocatorLike = {
    click: async () => {
      submittedPrompt = composerText;
    },
    count: async () => 1,
    isVisible: async () => true
  };

  const newChatButton: LocatorLike = {
    click: async () => {
      currentUrl = "https://chatgpt.com/";
      composerText = "";
      submittedPrompt = "";
    },
    count: async () => 1,
    isVisible: async () => true
  };

  const copyButton: LocatorLike = {
    count: async () => submittedPrompt.length > 0 ? 1 : 0,
    isVisible: async () => submittedPrompt.length > 0
  };

  return {
    url: () => currentUrl,
    title: async () => "ChatGPT",
    goto: async url => {
      currentUrl = String(url);
    },
    content: async () => renderFakeChatGPTHtml(submittedPrompt, assistantText),
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => {
      const previousDocument = globalThis.document;
      try {
        globalThis.document = {
          querySelectorAll: (selector: string) => {
            if (selector === "button, [role='button']") {
              return ["New chat", "Search chats", "Thinking", "Send prompt"].map(label => ({
                getAttribute: () => undefined,
                innerText: label,
                textContent: label
              }));
            }
            const roleMatch = selector.match(/^\[data-message-author-role(?:="([^"]+)")?\]$/);
            if (roleMatch !== null) {
              const wantedRole = roleMatch[1];
              return fakeMessageNodes(submittedPrompt, assistantText)
                .filter(node => wantedRole === undefined || node.getAttribute("data-message-author-role") === wantedRole);
            }
            return [];
          }
        } as unknown as Document;
        return await fn(arg as A);
      } finally {
        globalThis.document = previousDocument;
      }
    },
    locator: () => emptyLocator,
    getByRole: (role, options = {}) => {
      const name = options.name;
      if (role === "textbox" && roleNameMatches(name, "Chat with ChatGPT")) return textbox;
      if (role === "button" && roleNameMatches(name, "Send prompt")) return sendButton;
      if (role === "button" && roleNameMatches(name, "New chat")) return newChatButton;
      if (role === "button" && roleNameMatches(name, "Copy response")) return copyButton;
      return emptyLocator;
    },
    waitForTimeout: async () => {},
    waitForEvent: async () => ({})
  };
}

function fakeMessageNodes(prompt: string, assistantText: string) {
  if (prompt.length === 0) return [];
  return [
    fakeMessageNode("user", prompt, 1),
    fakeMessageNode("assistant", assistantText, 2)
  ];
}

function fakeMessageNode(role: "user" | "assistant", text: string, turn: number) {
  const html = escapeHtml(text);
  const turnNode = {
    outerHTML: `<div data-testid="conversation-turn-${turn}"><div data-message-author-role="${role}">${html}</div></div>`
  };
  return {
    getAttribute: (name: string) => name === "data-message-author-role" ? role : undefined,
    innerHTML: html,
    innerText: text,
    textContent: text,
    outerHTML: `<div data-message-author-role="${role}">${html}</div>`,
    closest: (selector: string) => selector === "[data-testid^='conversation-turn']" ? turnNode : null
  };
}

function renderFakeChatGPTHtml(prompt: string, assistantText: string): string {
  const turns = prompt.length === 0
    ? ""
    : [
        `<div data-testid="conversation-turn-1"><div data-message-author-role="user">${escapeHtml(prompt)}</div></div>`,
        `<div data-testid="conversation-turn-2"><div data-message-author-role="assistant">${escapeHtml(assistantText)}</div><button aria-label="Copy response">Copy response</button></div>`
      ].join("");

  return [
    "<main>",
    "<button>New chat</button>",
    "<button>Search chats</button>",
    "<button>Thinking</button>",
    "<label>Chat with ChatGPT</label>",
    turns,
    "</main>"
  ].join("");
}

function roleNameMatches(name: unknown, expected: string): boolean {
  if (typeof name === "string") return name === expected;
  if (name instanceof RegExp) return name.test(expected);
  return false;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeDynamic(value: unknown): unknown {
  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ? "<iso-timestamp>" : value;
  }
  if (Array.isArray(value)) return value.map(item => normalizeDynamic(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDynamic(item)])
    );
  }
  return value;
}
