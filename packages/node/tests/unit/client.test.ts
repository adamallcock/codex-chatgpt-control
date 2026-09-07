import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createChatGPT } from "../../src/client.js";
import type { BrowserLike, CommandResult, PageLike } from "../../src/types.js";
import { OperationJournal, OperationJournalError, JOURNAL_RUNTIME_UNAVAILABLE_MESSAGE } from "../../src/operations/journal.js";
import type { OperationHandleAdapterFactoryContext } from "../../src/operations/client.js";
import type { OperationBrowserAdapter } from "../../src/operations/service.js";
import { OPERATION_REQUEST_SCHEMA_VERSION, type OperationHandleV1, type OperationSubmitRequestV1 } from "../../src/operations/types.js";
import { COLLECTOR_SCHEMA_VERSION, type CollectorObservation } from "../../src/operations/collector.js";
import { TURN_OWNERSHIP_SCHEMA_VERSION } from "../../src/operations/turn-ownership.js";
import { coordinatedBrowserResource } from "../../src/runtime/coordinated-browser.js";
import type {
  SubmissionAttachmentObservation,
  SubmissionExecutePreparedSendResult,
  SubmissionFinalTransactionResult,
  SubmissionHandoffResult,
  SubmissionPrepareSendResult,
  SubmissionStageObservation
} from "../../src/operations/submission.js";
import { vi } from "vitest";

describe("createChatGPT", () => {
  it.each(["chat", "work"] as const)("returns an actionable nonresumable journal host blocker for %s", async surface => {
    const opening = vi.spyOn(OperationJournal, "open").mockRejectedValue(
      new OperationJournalError("journal_runtime_unavailable", "private host implementation detail")
    );
    const browser = { tabs: { create: vi.fn(() => { throw new Error("must not touch browser"); }) } };
    const chatgpt = createChatGPT({ browser });
    const args = { operationId: "34343434-3434-4434-8434-343434343434", prompt: "synthetic test" };
    try {
      const result = surface === "chat" ? await chatgpt.ask(args) : await chatgpt.work.start(args);
      expect(result).toMatchObject({
        ok: false, status: "blocked",
        blocker: { kind: "unknown", code: "journal_runtime_unavailable", resumable: false },
        error: { message: JOURNAL_RUNTIME_UNAVAILABLE_MESSAGE, recoverable: false }
      });
      expect(result.blocker?.remediation?.[0]?.instruction).toContain("supported Node host");
      expect(JSON.stringify(result)).not.toContain("private host implementation detail");
      expect(browser.tabs.create).not.toHaveBeenCalled();
    } finally { opening.mockRestore(); }
  });

  it("exposes one stable lazy operations facade and honors an explicit state root", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-operations-client-"));
    try {
      const journal = await OperationJournal.open({ stateRoot: root });
      const request: OperationSubmitRequestV1 = {
        schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
        operationId: "11111111-1111-4111-8111-111111111111",
        surface: "chat",
        prompt: "private prompt that must not be persisted",
        target: { type: "new" },
        files: [{ path: "/private/secret/input.txt" }]
      };
      const requestDigest = journal.submitRequestDigest(request, [{
        displayName: "input.txt",
        bytes: 1,
        contentSha256: "a".repeat(64)
      }]);
      const loaded = await journal.create({
        type: "operation_created",
        operationId: request.operationId,
        requestDigest,
        surface: request.surface,
        createdAt: "2026-08-16T00:00:00.000Z"
      });
      const handle = journal.handleFromState(loaded.state);
      const browser: BrowserLike = {
        tabs: { selected: () => { throw new Error("inspect must not touch the browser"); } }
      };
      const chatgpt = createChatGPT({ browser, operations: { stateRoot: root } });

      expect(chatgpt.operations).toBe(chatgpt.operations);
      const [first, second] = await Promise.all([
        chatgpt.operations.inspect(handle),
        chatgpt.operations.inspect(handle)
      ]);
      expect(first.state.operationId).toBe(request.operationId);
      expect(second.state.requestDigest).toBe(requestDigest);
      expect(first.state).toEqual(second.state);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the lazy ChatGPT runtime by default instead of an unavailable placeholder", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-default-operation-runtime-"));
    let createCalls = 0;
    const browser: BrowserLike = {
      name: "chrome",
      tabs: {
        create: () => {
          createCalls += 1;
          throw new Error("provider failed after default runtime acquisition began");
        }
      }
    };
    const chatgpt = createChatGPT({ browser, operations: { stateRoot: root } });

    try {
      const result = await chatgpt.operations.submit({
        schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
        operationId: "12121212-1212-4212-8212-121212121212",
        surface: "chat",
        prompt: "private prompt",
        target: { type: "new" }
      });

      expect(createCalls).toBe(1);
      expect(result.handle).toMatchObject({ phase: "prepared", mutationBoundary: "none" });
      expect(result.submission.kind).toBe("blocked");
      if (result.submission.kind !== "blocked") throw new Error("expected blocked submission");
      expect(result.submission.blocker?.code).toBe("target_evidence_unavailable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refreshes the default runtime from the invocation after legacy bootstrap activity", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-operation-runtime-snapshot-"));
    const firstPage = operationRuntimePage("first", "https://chatgpt.com/c/first");
    const secondPage = operationRuntimePage("second", "https://chatgpt.com/c/second");
    let createCalls = 0;
    const browser: BrowserLike = {
      name: "chrome",
      tabs: {
        create: (url: string) => {
          createCalls += 1;
          if (createCalls === 1) return secondPage;
          throw new Error("a stale operation runtime must not create another tab");
        }
      }
    };
    const chatgpt = createChatGPT({
      browser,
      page: firstPage,
      operations: { stateRoot: root }
    });

    try {
      const bootstrapped = await chatgpt.session.bootstrap({
        url: secondPage.currentUrl,
        preferExistingTab: false
      });
      expect(bootstrapped.ok).toBe(true);

      const result = await chatgpt.operations.submit({
        schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
        operationId: "23232323-2323-4232-8232-232323232323",
        surface: "chat",
        prompt: "private prompt",
        target: { type: "url", url: secondPage.currentUrl }
      });

      expect(createCalls).toBe(1);
      expect(result.submission.kind).toBe("blocked");
      if (result.submission.kind !== "blocked") throw new Error("expected a bounded submission blocker");
      expect(result.handle.targetBindingDigest).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
      expect(result.submission.blocker?.code).toBe("composer_drift");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps concurrent default submissions on their invocation-specific browser and tab snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-operation-runtime-concurrency-"));
    const firstUrl = "https://chatgpt.com/c/concurrent-first";
    const secondUrl = "https://chatgpt.com/c/concurrent-second";
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    let firstBlocked = true;
    let firstReleased = false;
    const firstPage = operationRuntimePage("tab-first", firstUrl, {
      onEvaluation: async source => {
        if (firstBlocked && source.includes("blockerText")) {
          firstBlocked = false;
          firstStarted.resolve();
          await releaseFirst.promise;
        }
      }
    });
    const secondPage = operationRuntimePage("tab-second", secondUrl);
    const createCalls: Array<{ browser: string; url: string }> = [];
    const browserFor = (name: string, page: OperationRuntimePage, expectedUrl: string): BrowserLike => ({
      name,
      tabs: {
        create: (url: string) => {
          createCalls.push({ browser: name, url });
          if (url !== expectedUrl) {
            throw new Error(`cross-tab create on ${name} for ${url}`);
          }
          return page;
        }
      }
    });
    const firstBrowser = browserFor("chrome-first", firstPage, firstUrl);
    const secondBrowser = browserFor("chrome-second", secondPage, secondUrl);
    let providerLookups = 0;
    const chatgpt = createChatGPT({
      agent: {
        browsers: {
          get: async () => {
            providerLookups += 1;
            // A stale creation-time factory would ask the provider again for
            // the second submission. Returning the first browser then makes
            // that submission visibly cross-bind (and fail exact navigation).
            return providerLookups === 1 || providerLookups > 2 ? firstBrowser : secondBrowser;
          }
        }
      },
      operations: { stateRoot: root }
    });

    const firstRequest: OperationSubmitRequestV1 = {
      schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
      operationId: "31313131-3131-4313-8313-313131313131",
      surface: "chat",
      prompt: "first private prompt",
      target: { type: "url", url: firstUrl }
    };
    const secondRequest: OperationSubmitRequestV1 = {
      schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
      operationId: "32323232-3232-4323-8323-323232323232",
      surface: "chat",
      prompt: "second private prompt",
      target: { type: "url", url: secondUrl }
    };

    try {
      // Open and cache the OperationClient before any browser is resolved.
      // This is the stale-factory adversary: factories must still read the
      // invocation-local RuntimeEnv when their browser phase begins.
      await expect(chatgpt.operations.inspect({
        schemaVersion: "chatgpt.browser_control.operation_handle.v1",
        operationId: "30303030-3030-4303-8303-303030303030",
        requestDigest: digest("0"),
        surface: "chat",
        revision: 0,
        phase: "prepared",
        mutationBoundary: "none"
      })).rejects.toBeDefined();

      // The first operation has no durable browser snapshot yet, so its
      // request-local factory must resolve the first provider and reach its
      // first page observation before the second legacy bootstrap begins.
      const firstSubmission = chatgpt.operations.submit(firstRequest);
      await firstStarted.promise;

      // The operation's page actor is blocked, but the second provider has a
      // distinct browser resource. Bootstrap therefore commits a second
      // browser/page snapshot while the first browser-touching submission is
      // still in flight.
      const secondBootstrap = await chatgpt.session.bootstrap({
        url: secondUrl,
        preferExistingTab: false
      });
      expect(secondBootstrap.ok).toBe(true);
      const secondSubmission = chatgpt.operations.submit(secondRequest);
      // The second submission is launched before releasing the first page
      // barrier. Its durable target assertion below proves that the call
      // reached a browser-bound adapter rather than being browser-free.
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(firstBlocked).toBe(false);
      expect(firstReleased).toBe(false);
      releaseFirst.resolve();
      firstReleased = true;

      const [first, second] = await Promise.all([firstSubmission, secondSubmission]);
      expect(first.submission.kind).toBe("blocked");
      expect(second.submission.kind).toBe("blocked");
      expect(providerLookups).toBe(2);
      expect(createCalls).toEqual([
        { browser: "chrome-first", url: firstUrl },
        { browser: "chrome-second", url: secondUrl }
      ]);

      const firstState = await chatgpt.operations.inspect(first.handle);
      const secondState = await chatgpt.operations.inspect(second.handle);
      expect(firstState.state.target).toMatchObject({
        browserId: coordinatedBrowserResource(firstBrowser).key,
        tabId: firstPage.id,
        conversationId: "concurrent-first"
      });
      expect(secondState.state.target).toMatchObject({
        browserId: coordinatedBrowserResource(secondBrowser).key,
        tabId: secondPage.id,
        conversationId: "concurrent-second"
      });
      expect(firstState.state.target?.browserId).not.toBe(secondState.state.target?.browserId);
      expect(firstState.state.target?.tabId).not.toBe(secondState.state.target?.tabId);
    } finally {
      releaseFirst.resolve();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recreates collect/control adapters from an authenticated handle without exposing request content", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-operations-restart-"));
    try {
      const journal = await OperationJournal.open({ stateRoot: root });
      const request: OperationSubmitRequestV1 = {
        schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
        operationId: "22222222-2222-4222-8222-222222222222",
        surface: "chat",
        prompt: "private prompt not supplied to a restart factory",
        target: { type: "new" },
        files: [{ path: "/private/secret/input.txt" }]
      };
      const requestDigest = journal.submitRequestDigest(request, [{
        displayName: "input.txt",
        bytes: 1,
        contentSha256: "b".repeat(64)
      }]);
      const loaded = await journal.create({
        type: "operation_created",
        operationId: request.operationId,
        requestDigest,
        surface: request.surface,
        createdAt: "2026-08-16T00:00:00.000Z"
      });
      const handle = journal.handleFromState(loaded.state);
      const recreated = vi.fn(async (factoryHandle: OperationHandleV1) => {
        expect(JSON.stringify(factoryHandle)).not.toContain("private");
        return minimalOperationAdapter();
      });
      const chatgpt = createChatGPT({
        operations: { stateRoot: root, handleAdapterFactory: recreated }
      });

      // The prepared operation is intentionally not collectable yet. The
      // authenticated inspect proves there is no durable target to recreate,
      // so the factory must not receive a type-unsound partial context (and,
      // in particular, must not receive prompt/path data).
      await expect(chatgpt.operations.collect(handle, { wait: false })).rejects.toMatchObject({
        code: "target_binding_missing"
      });
      expect(recreated).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not recover request-local artifact output authority on restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-operations-artifact-restart-"));
    const outputDirectory = join(root, "private-output");
    const operationId = "27272727-2727-4272-8272-272727272727";
    const calls = { send: 0, observeSend: 0 };
    const request: OperationSubmitRequestV1 = {
      schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
      operationId,
      surface: "chat",
      prompt: "private prompt that must not reach restart recovery",
      target: { type: "conversation_id", conversationId: "conversation-1" },
      capture: {
        responseContent: "metadata",
        responseFormat: "markdown",
        artifacts: "transfer",
        outputDirectory
      }
    };

    try {
      const first = createChatGPT({
        operations: {
          stateRoot: root,
          adapterFactory: async () => pendingOperationAdapter(calls)
        }
      });
      const submitted = await first.operations.submit(request);
      expect(submitted.handle.targetBindingDigest).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
      expect(submitted.handle.phase).toBe("submitted");

      const assertRestartContext = (context: OperationHandleAdapterFactoryContext): void => {
        expect(JSON.stringify(context)).not.toContain("private prompt");
        expect(JSON.stringify(context)).not.toContain(outputDirectory);
        expect(context.state.capturePolicy).toEqual({
          responseContent: "metadata",
          responseFormat: "markdown",
          artifacts: "transfer"
        });
        expect(context.state.capturePolicy).not.toHaveProperty("outputDirectory");
        expect(context.target).not.toHaveProperty("outputDirectory");
      };

      const collectFactory = vi.fn(async (context: OperationHandleAdapterFactoryContext) => {
        assertRestartContext(context);
        return minimalOperationAdapter();
      });
      const restarted = createChatGPT({
        operations: { stateRoot: root, handleAdapterFactory: collectFactory }
      });
      await expect(restarted.operations.collect(submitted.handle, { wait: false })).resolves.toMatchObject({
        kind: "blocked"
      });
      expect(collectFactory).toHaveBeenCalledTimes(1);

      const controlFactory = vi.fn(async (context: OperationHandleAdapterFactoryContext) => {
        assertRestartContext(context);
        return minimalOperationAdapter();
      });
      const controlClient = createChatGPT({
        operations: { stateRoot: root, handleAdapterFactory: controlFactory }
      });
      await expect(controlClient.operations.control({
        schemaVersion: "chatgpt.browser_control.operation_control_request.v1",
        controlActionId: "28282828-2828-4282-8282-282828282828",
        parent: submitted.handle,
        action: "stop",
        expectedAssistantTurnId: "assistant-1"
      })).rejects.toMatchObject({
        code: "control_unavailable"
      });
      expect(controlFactory).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed for a partial custom adapter seam instead of mixing default factories", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-operations-custom-seam-"));
    let browserCreateCalls = 0;
    const browser: BrowserLike = {
      tabs: {
        create: () => {
          browserCreateCalls += 1;
          throw new Error("default runtime must not be selected for a partial custom seam");
        }
      }
    };
    const factory = vi.fn(async () => pendingOperationAdapter({ send: 0, observeSend: 0 }));
    const chatgpt = createChatGPT({
      browser,
      operations: {
        stateRoot: root,
        adapterFactory: factory,
        maxCachedAdapters: 1
      }
    });

    try {
      const first = await chatgpt.operations.submit({
        schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
        operationId: "29292929-2929-4292-8292-292929292929",
        surface: "chat",
        prompt: "private one",
        target: { type: "conversation_id", conversationId: "conversation-1" }
      });
      await chatgpt.operations.submit({
        schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
        operationId: "30303030-3030-4303-8303-303030303030",
        surface: "chat",
        prompt: "private two",
        target: { type: "conversation_id", conversationId: "conversation-1" }
      });

      const collect = await chatgpt.operations.collect(first.handle, { wait: false });
      expect(collect.kind).toBe("blocked");
      expect(browserCreateCalls).toBe(0);
      expect(factory).toHaveBeenCalledTimes(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps legacy ask routing unchanged when operationId is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-legacy-ask-routing-"));
    const factory = vi.fn(async () => throwingOperationAdapter());
    const chatgpt = createChatGPT({ operations: { stateRoot: root, adapterFactory: factory } });

    const result = await chatgpt.ask({ prompt: "legacy", wait: false, read: false });

    expect(result.status).not.toBe("unsupported");
    expect(factory).not.toHaveBeenCalled();
    await rm(root, { recursive: true, force: true });
  });

  it("persists a durable blocker when the operation adapter factory rejects", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-transactional-adapter-reject-"));
    const operationId = "33333333-3333-4333-8333-333333333333";
    let codeRead = false;
    let messageRead = false;
    const unsafeFactoryFailure = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(unsafeFactoryFailure, "code", {
      get() {
        codeRead = true;
        throw new Error("code must not be read");
      }
    });
    Object.defineProperty(unsafeFactoryFailure, "message", {
      get() {
        messageRead = true;
        throw new Error("message must not be read");
      }
    });
    const chatgpt = createChatGPT({
      operations: {
        stateRoot: root,
        adapterFactory: async () => Promise.reject(unsafeFactoryFailure)
      }
    });

    try {
      const result = await chatgpt.ask({
        operationId,
        prompt: "private prompt that must not cross the boundary",
        wait: false,
        read: false
      });

      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        blocker: { code: "backend_unavailable" },
        data: { operationId, handle: { operationId, phase: "prepared" } }
      });
      expect(codeRead).toBe(false);
      expect(messageRead).toBe(false);
      expect(JSON.stringify(result)).not.toContain("private prompt");
      const handle = (result.data as { handle: OperationHandleV1 }).handle;
      const inspected = await chatgpt.operations.inspect(handle);
      expect(inspected.state).toMatchObject({
        operationId,
        phase: "prepared",
        mutationBoundary: "none",
        lastBlocker: { code: "backend_unavailable" }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("maps transactional ask intent and rejects unsupported fields before adapter use", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-transactional-ask-input-"));
    const input = join(root, "brief.md");
    await writeFile(input, "brief");
    const captured: OperationSubmitRequestV1[] = [];
    const factory = vi.fn(async ({ request }: { request: OperationSubmitRequestV1 }) => {
      captured.push(request);
      return throwingOperationAdapter();
    });
    const chatgpt = createChatGPT({
      operations: { stateRoot: root, adapterFactory: factory }
    });
    const operationId = "44444444-4444-4444-8444-444444444444";

    const blocked = await chatgpt.askWithFiles({
      operationId,
      prompt: "private prompt",
      thread: { type: "url", url: "https://chatgpt.com/c/one" },
      configuration: { intelligence: "Pro" },
      mode: { model: "gpt-5" },
      tools: [{ tool: "web_search" }],
      files: [input],
      wait: { timeoutMs: 17, pollMs: 3 },
      read: { format: "markdown", maxChars: 20 }
    });

    expect(blocked.status).toBe("blocked");
    expect((blocked.data as { operationId?: string }).operationId).toBe(operationId);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(captured[0]).toMatchObject({
      operationId,
      surface: "chat",
      prompt: "private prompt",
      target: { type: "url", url: "https://chatgpt.com/c/one" },
      configuration: {
        model: "gpt-5",
        additional: { intelligence: "Pro" },
        tools: ["web_search"]
      },
      files: [{ path: input }],
      capture: { responseContent: "include", artifacts: "receipt_only" }
    });

    const unsupportedFactory = vi.fn(async () => {
      throw new Error("adapter factory must not run for unsupported input");
    });
    const unsupportedClient = createChatGPT({ operations: { stateRoot: root, adapterFactory: unsupportedFactory } });
    const unsupported = await unsupportedClient.ask({
      operationId: "55555555-5555-4555-8555-555555555555",
      prompt: "private",
      thread: { type: "search", query: "private search" }
    });
    expect(unsupported.status).toBe("unsupported");
    expect(unsupportedFactory).not.toHaveBeenCalled();

    await rm(root, { recursive: true, force: true });
  });

  it("propagates one caller operationId and does not resubmit on the same-ID retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-transactional-ask-retry-"));
    const operationId = "66666666-6666-4666-8666-666666666666";
    const calls = { send: 0, observeSend: 0, legacy: 0 };
    const adapter = pendingOperationAdapter(calls);
    const factory = vi.fn(async () => adapter);
    const chatgpt = createChatGPT({ operations: { stateRoot: root, adapterFactory: factory } });

    const first = await chatgpt.ask({ operationId, prompt: "private prompt", wait: false, read: false });
    const second = await chatgpt.ask({ operationId, prompt: "private prompt", wait: false, read: false });

    expect(first.status).toBe("partial");
    expect(second.status).toBe("partial");
    expect((first.data as { operationId?: string }).operationId).toBe(operationId);
    expect((second.data as { operationId?: string }).operationId).toBe(operationId);
    expect((first.data as { handle?: OperationHandleV1 }).handle).toMatchObject({ operationId });
    expect((second.data as { handle?: OperationHandleV1 }).handle).toMatchObject({ operationId });
    expect(calls.send).toBe(1);
    expect(calls.observeSend).toBe(1);
    expect(calls.legacy ?? 0).toBe(0);

    await rm(root, { recursive: true, force: true });
  });

  it("returns the effective operationId and fresh handle for a transactional blocker", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-transactional-ask-blocker-"));
    const operationId = "77777777-7777-4777-8777-777777777777";
    const adapter = pendingOperationAdapter({ send: 0, observeSend: 0 }, "blocked");
    const chatgpt = createChatGPT({ operations: { stateRoot: root, adapterFactory: async () => adapter } });

    const result = await chatgpt.ask({ operationId, prompt: "private prompt", wait: false, read: false });

    expect(result.status).toBe("partial");
    expect((result.data as { operationId?: string }).operationId).toBe(operationId);
    expect((result.data as { handle?: OperationHandleV1 }).handle).toMatchObject({ operationId });
    expect(result.blocker?.code).toBe("configuration_drift");

    await rm(root, { recursive: true, force: true });
  });

  it("returns ephemeral response data only after a completed transactional collect", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-transactional-ask-complete-"));
    const operationId = "88888888-8888-4888-8888-888888888888";
    const adapter = pendingOperationAdapter({ send: 0, observeSend: 0 }, "completed");
    const chatgpt = createChatGPT({ operations: { stateRoot: root, adapterFactory: async () => adapter } });

    const result = await chatgpt.ask({ operationId, prompt: "private prompt", wait: true, read: { format: "text" } });

    expect(result.status).toBe("ok");
    expect((result.data as { operationId?: string }).operationId).toBe(operationId);
    expect((result.data as { handle?: OperationHandleV1 }).handle).toMatchObject({ operationId, phase: "completed" });
    expect((result.data as { responseText?: string }).responseText).toBe("private response");
    expect((result.data as { responseFormat?: string }).responseFormat).toBe("text");

    const replay = await chatgpt.ask({ operationId, prompt: "private prompt", wait: true, read: { format: "text" } });
    expect(replay.status).toBe("ok");
    expect((replay.data as { handle?: OperationHandleV1 }).handle).toMatchObject({ operationId, phase: "completed" });
    expect((replay.data as { responseText?: string }).responseText).toBeUndefined();
    expect((replay.data as { responseDigest?: string }).responseDigest).toBe(digest("x"));
    expect((replay.data as { responseBytes?: number }).responseBytes).toBe(16);

    await rm(root, { recursive: true, force: true });
  });

  it("does not misreport an uncertain attachment handoff as a submitted prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-transactional-ask-handoff-"));
    const input = join(root, "brief.md");
    await writeFile(input, "brief");
    const operationId = "99999999-9999-4999-8999-999999999999";
    const chatgpt = createChatGPT({
      operations: {
        stateRoot: root,
        adapterFactory: async () => pendingOperationAdapter({ send: 0, observeSend: 0 }, "handoff_uncertain")
      }
    });

    const result = await chatgpt.askWithFiles({ operationId, prompt: "private prompt", files: [input], wait: false, read: false });

    expect(result.status).toBe("partial");
    expect((result.data as { submissionState?: string }).submissionState).toBe("not_submitted");
    expect((result.data as { handle?: OperationHandleV1 }).handle?.mutationBoundary).toBe("handoff_may_have_occurred");

    await rm(root, { recursive: true, force: true });
  });

  it("routes runner operation opt-in through the same journal and preserves rendered instructions", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-transactional-runner-"));
    const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const calls = { send: 0, observeSend: 0 };
    const captured: OperationSubmitRequestV1[] = [];
    const adapter = pendingOperationAdapter(calls);
    const chatgpt = createChatGPT({
      operations: {
        stateRoot: root,
        adapterFactory: vi.fn(async ({ request }: { request: OperationSubmitRequestV1 }) => {
          captured.push(request);
          return adapter;
        })
      }
    });
    const agent = chatgpt.agent({
      name: "reviewer",
      instructions: "Review deeply.",
      defaults: {
        thread: { type: "conversationId", conversationId: "conversation-1" },
        wait: false,
        read: false
      }
    });

    const first = await chatgpt.runner.run(agent, {
      operationId,
      input: [
        { type: "visible_instruction", text: "Use concise headings." },
        { type: "input_text", text: "Assess the SDK." }
      ]
    });
    const second = await chatgpt.runner.run(agent, {
      operationId,
      input: [
        { type: "visible_instruction", text: "Use concise headings." },
        { type: "input_text", text: "Assess the SDK." }
      ]
    });

    expect(first.status).toBe("partial");
    expect(second.status).toBe("partial");
    expect(first.data?.operationId).toBe(operationId);
    expect(first.data?.handle).toMatchObject({ operationId });
    expect(first.state).toMatchObject({ operationId, id: operationId, handle: { operationId } });
    expect(second.data?.handle).toMatchObject({ operationId });
    expect(captured[0]).toMatchObject({
      operationId,
      target: { type: "conversation_id", conversationId: "conversation-1" }
    });
    expect(captured[0]?.prompt).toContain("<chatgpt_browser_agent>");
    expect(captured[0]?.prompt).toContain("Review deeply.");
    expect(captured[0]?.prompt).toContain("<visible_instructions>");
    expect(captured[0]?.prompt).toContain("Use concise headings.");
    expect(captured[0]?.prompt).toContain("<user_request>");
    expect(calls.send).toBe(1);
    expect(calls.observeSend).toBe(1);

    await rm(root, { recursive: true, force: true });
  });

  it("keeps metadata-only runner instructions out of the transactional prompt and rejects unsupported fields before adapter use", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-transactional-runner-input-"));
    const factory = vi.fn(async () => {
      throw new Error("runner adapter must not be used for unsupported input");
    });
    const chatgpt = createChatGPT({ operations: { stateRoot: root, adapterFactory: factory } });
    const agent = chatgpt.agent({
      name: "local-router",
      instructions: "Never send this local routing note.",
      instructionsMode: "metadata_only"
    });

    const unsupported = await chatgpt.runner.run(agent, {
      operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      input: "Summarize the latest response.",
      copy: { prefer: "dom" }
    });

    expect(unsupported.status).toBe("unsupported");
    expect(unsupported.data?.operationId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(unsupported.blocker?.fieldPath).toBe("copy");
    expect(factory).not.toHaveBeenCalled();
    await rm(root, { recursive: true, force: true });
  });

  it("returns the operation identity and handle through Responses on transactional opt-in", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-transactional-responses-"));
    const operationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const calls = { send: 0, observeSend: 0 };
    const chatgpt = createChatGPT({
      operations: {
        stateRoot: root,
        adapterFactory: async () => pendingOperationAdapter(calls, "completed")
      }
    });

    const response = await chatgpt.responses.create({
      operationId,
      input: "Summarize the latest response.",
      instructions: "Use concise headings.",
      instructionsMode: "visible_prefix",
      thread: { type: "conversationId", conversationId: "conversation-1" },
      stream: false
    });

    expect(response.status).toBe("ok");
    expect(response.browser_control.operationId).toBe(operationId);
    expect(response.browser_control.handle).toMatchObject({ operationId });
    expect(calls.send).toBe(1);
    await rm(root, { recursive: true, force: true });
  });

  it("keeps runner streaming as milestone events for a transactional operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgpt-transactional-runner-stream-"));
    const operationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const chatgpt = createChatGPT({
      operations: {
        stateRoot: root,
        adapterFactory: async () => pendingOperationAdapter({ send: 0, observeSend: 0 }, "completed")
      }
    });
    const agent = chatgpt.agent({ name: "stream-reviewer" });
    const stream = chatgpt.runner.run(agent, {
      operationId,
      input: "Summarize the latest response."
    }, { stream: true });
    const events: Array<{ type: string; name: string }> = [];
    for await (const event of stream) events.push(event);
    const result = await stream.completed;

    expect(result.status).toBe("ok");
    expect(result.data?.operationId).toBe(operationId);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(event => event.type === "run_item_stream_event")).toBe(true);
    expect(events.some(event => event.name === "message_completed")).toBe(true);
    expect(events.some(event => event.name === "token_delta")).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  it("plans ask as a new-thread Markdown workflow by default", () => {
    const chatgpt = createChatGPT();
    const plan = chatgpt.plan("new-ask-read", { prompt: "reply with the word hi" });

    expect(plan?.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.new",
      "messages.ask"
    ]);
    expect(plan?.steps.at(-1)).toMatchObject({
      command: "messages.ask",
      args: {
        text: "reply with the word hi",
        wait: true,
        read: { format: "markdown" }
      }
    });
  });

  it("preserves visible mode by default but honors explicit client mode defaults", () => {
    const preserving = createChatGPT();
    const configured = createChatGPT({ defaults: { mode: { effort: "Thinking" } } });

    expect(preserving.plan("new-ask-read", { prompt: "reply with hi" })?.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.new",
      "messages.ask"
    ]);

    const configuredPlan = configured.plan("new-ask-read", { prompt: "reply with hi" });
    expect(configuredPlan?.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.new",
      "modes.set",
      "messages.ask"
    ]);
    expect(configuredPlan?.steps[2]).toMatchObject({
      command: "modes.set",
      args: { effort: "Thinking" }
    });
  });

  it("exposes registry-backed help and descriptors", () => {
    const chatgpt = createChatGPT();

    expect(chatgpt.commands({ layer: "workflow" }).map(command => command.name)).toContain("ask");
    expect(chatgpt.describe("messages.readLatest")).toMatchObject({
      layer: "primitive",
      risk: "medium",
      args: expect.objectContaining({ format: expect.stringContaining("markdown") }),
      retryPolicy: expect.stringContaining("CommandResult")
    });
    expect(chatgpt.describe("ask")).toMatchObject({
      defaults: expect.objectContaining({ wait: true, read: { format: "markdown" } })
    });
    expect(chatgpt.describe("files.preflight")).toMatchObject({
      layer: "primitive",
      risk: "low",
      blockers: expect.arrayContaining(["not_found", "permission", "upload_failed"])
    });
    expect(chatgpt.describe("modes.get")).toMatchObject({
      layer: "primitive",
      risk: "low",
      blockers: expect.arrayContaining(["selector_drift"])
    });
    expect(chatgpt.help("ask")).toContain("Ask ChatGPT");
    expect(chatgpt.help("ask")).toContain("Retry policy:");
  });

  it("builds named macro plans", () => {
    const chatgpt = createChatGPT();
    const plan = chatgpt.plan("find-open-copy-latest", { query: "SDK Design Proposal" });
    const askPlan = chatgpt.plan("find-open-ask-read", { query: "SDK Design Proposal", prompt: "Continue." });

    expect(plan?.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.search",
      "threads.open",
      "response.copy"
    ]);
    expect(askPlan?.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.search",
      "threads.open",
      "messages.ask"
    ]);
  });

  it("returns structured failures for invalid named workflows", async () => {
    const chatgpt = createChatGPT();

    const unknown = await chatgpt.runPlan({ name: "missing-plan" });
    const invalid = await chatgpt.runPlan({ name: "new-ask-read", input: {} });

    expect(unknown.ok).toBe(false);
    expect(unknown.status).toBe("error");
    expect(unknown.error?.message).toContain("Unknown ChatGPT workflow plan");
    expect(invalid.ok).toBe(false);
    expect(invalid.status).toBe("error");
    expect(invalid.error?.message).toContain("prompt");
  });

  it("runs direct named diagnostic and report macros", async () => {
    const page = fakeChatGPTPage();
    const browser: BrowserLike = { name: "chrome", tabs: { selected: () => page } };
    const chatgpt = createChatGPT({ browser });

    const doctorResult = await chatgpt.runPlan({ name: "doctor-upload" });
    expect(doctorResult.ok).toBe(true);
    expect((doctorResult.data as { checks?: unknown }).checks).toBeDefined();

    const dir = await mkdtemp(join(tmpdir(), "chatgpt-macro-report-"));
    const reportResult = await chatgpt.runPlan({
      name: "redacted-run-report",
      input: {
        result: {
          ok: true,
          status: "ok",
          data: { responseText: "private@example.com" },
          warnings: [],
          context: { timestamp: "2026-06-05T00:00:00.000Z" }
        }
      },
      report: { destDir: dir }
    });

    expect(reportResult.ok).toBe(true);
    expect((reportResult.data as { path?: string }).path).toContain(dir);
  });

  it("offers primitive namespaces", () => {
    const chatgpt = createChatGPT();

    expect(typeof chatgpt.session.bootstrap).toBe("function");
    expect(typeof chatgpt.threads.search).toBe("function");
    expect(typeof chatgpt.messages.readLatest).toBe("function");
    expect(typeof chatgpt.messages.status).toBe("function");
    expect(typeof chatgpt.messages.stop).toBe("function");
    expect(typeof chatgpt.artifacts.downloadLatest).toBe("function");
    expect(typeof chatgpt.files.preflight).toBe("function");
    expect(typeof chatgpt.files.attach).toBe("function");
    expect(typeof chatgpt.response.copy).toBe("function");
  });

  it("plans create-image downloads through artifact primitives", () => {
    const chatgpt = createChatGPT();
    const agent = chatgpt.agent({
      name: "image-agent",
      defaults: { wait: { timeoutMs: 120000, stableMs: 0, pollMs: 1 } }
    });

    const plan = chatgpt.runner.plan(agent, {
      input: "Create an image of a golden dog on grass.",
      tools: [{ tool: "create_image" }],
      download: { destDir: "/tmp/generated" }
    });

    expect(plan.steps.map(step => step.command)).toEqual([
      "session.bootstrap",
      "threads.new",
      "tools.select",
      "artifacts.listLatest",
      "messages.ask",
      "artifacts.wait",
      "artifacts.downloadLatest"
    ]);
    expect(plan.steps.find(step => step.id === "ask")).toMatchObject({
      command: "messages.ask",
      args: {
        wait: false,
        read: false
      }
    });
    expect(plan.steps.find(step => step.id === "artifact")).toMatchObject({
      command: "artifacts.wait",
      args: {
        kind: "image",
        afterArtifactCount: "${artifactBaseline.data.count}",
        requireDownload: true,
        timeoutMs: 120000,
        stableMs: 0,
        pollMs: 1
      }
    });
  });

  it("blocks workflows that exceed run budgets before opening the browser", async () => {
    const chatgpt = createChatGPT({ limits: { maxPromptsPerRun: 1 } });
    const result = await chatgpt.runMessages({
      messages: [
        { prompt: "first" },
        { prompt: "second" }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("needs_confirmation");
    expect(result.blocker?.message).toContain("prompts 2/1");
  });

  it("plans existingTab reuse as an exact URL claim for high-level runner calls", () => {
    const chatgpt = createChatGPT();
    const agent = chatgpt.agent({ name: "existing-tab-agent" });

    const plan = chatgpt.runner.plan(agent, {
      input: "Continue.",
      thread: { type: "url", url: "https://chatgpt.com/c/abc-123" },
      existingTab: true
    });

    expect(plan.steps[0]).toEqual({
      id: "bootstrap",
      command: "session.bootstrap",
      args: {
        existingTab: {
          target: { type: "url", url: "https://chatgpt.com/c/abc-123" },
          ifMissing: "block",
          ifMultiple: "block",
          requireChatGPT: true
        }
      }
    });
  });

  it("returns confirmation when a generated report exceeds the byte budget", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-budget-report-"));
    const chatgpt = createChatGPT({ limits: { maxReportBytesPerRun: 1 }, reporting: { destDir: dir } });

    const result = await chatgpt.runPlan({
      name: "new-ask-read",
      input: { prompt: "reply with hi" },
      report: true
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("needs_confirmation");
    expect(result.reportPath).toContain(dir);
    expect(result.warnings.join(" ")).toContain("byte budget");
    expect(result.blocker?.message).toContain("larger than the configured budget");
    expect(result.context.timestamp).toBeDefined();
    expect(result.steps?.map(step => ({
      id: step.id,
      command: step.command,
      status: step.status,
      ok: step.ok
    }))).toEqual([
      {
        id: "bootstrap",
        command: "session.bootstrap",
        status: "blocked",
        ok: false
      }
    ]);
  });

  it("writes redacted reports by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-report-"));
    const chatgpt = createChatGPT();
    const result: CommandResult<unknown> = {
      ok: true,
      status: "ok",
      data: {
        name: "customer-contract-private.pdf",
        files: [
          {
            name: "private@example.com-contract.pdf",
            path: "/example/user/secret/private@example.com-contract.pdf"
          }
        ],
        responseText: "private@example.com /example/user/secret token_12345678901234567890123456789012"
      },
      warnings: ["warning includes private@example.com"],
      error: { name: "PrivateError", message: "/example/user/secret", recoverable: true },
      blocker: { kind: "unknown", message: "token_12345678901234567890123456789012", visibleText: "private@example.com" },
      context: { timestamp: "2026-06-05T00:00:00.000Z", title: "private@example.com", url: "https://chatgpt.com/c/private" }
    };

    const report = await chatgpt.createReport(result, { destDir: dir });

    expect(report.ok).toBe(true);
    const body = await readFile(report.data!.path, "utf8");
    expect(body).toContain("[redacted:");
    expect(body).not.toContain("private@example.com");
    expect(body).not.toContain("/example/user/secret");
    expect(body).not.toContain("token_12345678901234567890123456789012");
    expect(body).not.toContain("customer-contract-private.pdf");
    expect(body).not.toContain("private@example.com-contract.pdf");
    expect(body).toContain("\"status\": \"ok\"");
  });

  it("summarizes and redacts report values through the reports namespace", async () => {
    const chatgpt = createChatGPT();
    const result: CommandResult<unknown> = {
      ok: false,
      status: "blocked",
      warnings: ["private@example.com"],
      blocker: { kind: "unknown", message: "private@example.com" },
      context: { timestamp: "2026-06-05T00:00:00.000Z", title: "private@example.com" }
    };

    const summary = await chatgpt.reports.summarize(result);
    const redacted = await chatgpt.reports.redact({ text: "private@example.com" });

    expect(summary.ok).toBe(true);
    expect(JSON.stringify(summary.data)).not.toContain("private@example.com");
    expect(redacted.data).toEqual({ text: "[redacted:19 chars]" });
  });

  it("doctor reports upload permission remediation", async () => {
    const page = fakeChatGPTPage();
    const browser: BrowserLike = { name: "chrome", tabs: { selected: () => page } };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({ check: ["bridge", "login", "upload"] });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.bridge?.status).toBe("ok");
    expect(result.data?.checks.login?.status).toBe("ok");
    expect(result.data?.checks.upload?.remediation?.join(" ")).toContain("Codex Settings > Computer Use > Chrome");
    expect(result.data?.checks.upload?.remediation?.join(" ")).toContain("Allow access to file URLs");
  });

  it("doctor preserves the lightweight default checks", async () => {
    const page = fakeChatGPTPage();
    const browser: BrowserLike = { name: "chrome", tabs: { selected: () => page } };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor();

    expect(result.ok).toBe(true);
    expect(Object.keys(result.data?.checks ?? {})).toEqual([
      "compatibility",
      "bridge",
      "login",
      "upload",
      "download",
      "clipboard",
      "modes",
      "tools",
      "selectors"
    ]);
    expect(result.data?.checks).not.toHaveProperty("existing_tab");
    expect(result.data?.checks).not.toHaveProperty("artifacts");
    expect(result.data?.checks).not.toHaveProperty("file_preflight");
    expect(result.data?.checks).not.toHaveProperty("localization");
    expect(result.data?.checks).not.toHaveProperty("reports");
  });

  it("doctor explains ordinary-shell bridge blockers and live bootstrap recovery", async () => {
    const chatgpt = createChatGPT({ now: () => new Date("2026-06-06T00:00:00.000Z") });

    const result = await chatgpt.doctor({ check: ["bridge"] });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.bridge).toMatchObject({
      status: "blocked",
      message: expect.stringContaining("ordinary shell")
    });
    expect(result.data?.checks.bridge?.message).toContain("setupBrowserRuntime");
    expect(result.data?.checks.bridge?.remediation?.join(" ")).toContain("scripts/http_stdio_relay.mjs");
  });

  it("doctor does not show bridge bootstrap remediation when ChatGPT login is required", async () => {
    const browser: BrowserLike = { name: "chrome", tabs: { selected: () => fakeLoginPage() } };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({ check: ["bridge", "login"] });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.bridge).toMatchObject({
      status: "ok",
      message: expect.stringContaining("login is required")
    });
    expect(result.data?.checks.bridge?.remediation).toBeUndefined();
    expect(result.data?.checks.login).toMatchObject({
      status: "blocked",
      remediation: [expect.stringContaining("sign in")]
    });
  });

  it("doctor reports missing existing-tab targets without opening or claiming a tab", async () => {
    const claimed: unknown[] = [];
    const created: string[] = [];
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "other", url: "https://chatgpt.com/c/other", title: "Other Chat" }
        ],
        claimTab: async tab => {
          claimed.push(tab);
          throw new Error("claimTab should not be called for a missing existing-tab target.");
        }
      },
      tabs: {
        create: async url => {
          created.push(url);
          return fakeChatGPTPage();
        }
      }
    };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({
      check: ["existing_tab"],
      existingTab: {
        target: { type: "conversationId", conversationId: "abc-123" },
        ifMissing: "block"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.data?.ready).toBe(false);
    expect(result.data?.checks.existing_tab).toMatchObject({
      status: "blocked",
      blockerKind: "not_found",
      code: "existing_tab_not_found",
      nextCommand: "session.bootstrap",
      details: {
        existingTab: {
          requestedTarget: {
            type: "conversationId",
            conversationId: "abc-123"
          },
          mismatchReason: "conversation_id_mismatch",
          chatgptTabCount: 1
        }
      }
    });
    expect(claimed).toEqual([]);
    expect(created).toEqual([]);
  });

  it("doctor reuses exact existing-tab bootstrap for other requested bootstrap checks", async () => {
    const claimed: string[] = [];
    const selected: string[] = [];
    const created: string[] = [];
    const pages = new Map([
      ["other", fakeChatGPTPage("https://chatgpt.com/c/other")],
      ["target", fakeChatGPTPage("https://chatgpt.com/c/target")]
    ]);
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "other", url: "https://chatgpt.com/c/other", title: "Other Chat" },
          { id: "target", url: "https://chatgpt.com/c/target", title: "Target Chat" }
        ],
        claimTab: async tab => {
          const tabId = typeof tab === "string" ? tab : tab.id;
          const tabUrl = typeof tab === "string" ? undefined : tab.url;
          claimed.push(tabId);
          return pages.get(tabId) ?? fakeChatGPTPage(tabUrl);
        }
      },
      tabs: {
        selected: () => {
          selected.push("selected");
          return pages.get("other")!;
        },
        create: async url => {
          created.push(url);
          return fakeChatGPTPage(url);
        }
      }
    };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({
      check: ["bridge", "existing_tab"],
      existingTab: {
        target: { type: "conversationId", conversationId: "target" },
        ifMissing: "block"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.bridge?.status).toBe("ok");
    expect(result.data?.checks.existing_tab?.status).toBe("ok");
    expect(claimed).toEqual(["target"]);
    expect(selected).toEqual([]);
    expect(created).toEqual([]);
  });

  it("doctor reports ambiguous existing-tab targets with metadata-only candidates", async () => {
    const browser: BrowserLike = {
      name: "chrome",
      user: {
        openTabs: async () => [
          { id: "one", url: "https://chatgpt.com/c/one", title: "SDK Review" },
          { id: "two", url: "https://chatgpt.com/c/two", title: "SDK Review" }
        ],
        claimTab: async () => {
          throw new Error("claimTab should not be called for ambiguous existing-tab targets.");
        }
      }
    };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({
      check: ["existing_tab"],
      existingTab: {
        target: { type: "title", title: "SDK Review" },
        ifMultiple: "block"
      }
    });

    expect(result.data?.checks.existing_tab).toMatchObject({
      status: "blocked",
      code: "existing_tab_ambiguous",
      details: {
        existingTab: {
          mismatchReason: "multiple_candidates",
          candidateTabs: [
            {
              id: "one",
              url: "https://chatgpt.com/c/one",
              title: "SDK Review",
              conversationId: "one"
            },
            {
              id: "two",
              url: "https://chatgpt.com/c/two",
              title: "SDK Review",
              conversationId: "two"
            }
          ]
        }
      }
    });
  });

  it("doctor verifies localization registry readiness without a browser bridge", async () => {
    const chatgpt = createChatGPT();

    const result = await chatgpt.doctor({ check: ["localization"] });

    expect(result.ok).toBe(true);
    expect(result.data?.ready).toBe(true);
    expect(result.data?.checks.localization).toMatchObject({
      status: "unknown",
      message: expect.stringContaining("registry-only"),
      details: {
        englishCanonicalPresent: true,
        requiredKeysMissing: [],
        missingConfigurationAxisIds: [],
        missingConfigurationOptionIds: [],
        runtimeSelectorCoverage: "registry_only_stage_2",
        runningStateLabelCoverage: {
          support: "partial",
          nonEnglishStopControlLocaleCount: expect.any(Number),
          nonEnglishStoppedAssistantLocaleCount: 0,
          stopControlCandidateCount: expect.any(Number),
          stoppedAssistantCandidateCount: expect.any(Number)
        },
        toolIds: expect.arrayContaining(["web_search", "deep_research", "create_image"]),
        configurationAxisIds: expect.arrayContaining(["power", "model", "effort", "speed", "advanced"]),
        configurationOptionIds: expect.arrayContaining(["instant", "light", "medium", "high", "extraHigh", "max", "ultra", "pro", "standard", "fast"])
      }
    });
    const coverage = result.data?.checks.localization?.details?.runningStateLabelCoverage as {
      nonEnglishLocaleCount?: number;
      nonEnglishStopControlLocaleCount?: number;
    } | undefined;
    expect(coverage?.nonEnglishStopControlLocaleCount).toBe((coverage?.nonEnglishLocaleCount ?? 0) - 1);
  });

  it("doctor verifies report output policy and existing directory writability", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-doctor-reports-"));
    const chatgpt = createChatGPT();

    const result = await chatgpt.doctor({
      check: ["reports"],
      report: { destDir: dir }
    });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.reports).toMatchObject({
      status: "ok",
      message: expect.stringContaining("writable"),
      details: {
        destDir: dir,
        includeContent: false,
        redactionDefault: true
      }
    });
  });

  it("doctor reports when requested report policy persists raw content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-doctor-reports-raw-"));
    const chatgpt = createChatGPT();

    const result = await chatgpt.doctor({
      check: ["reports"],
      report: { destDir: dir, includeContent: true }
    });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.reports).toMatchObject({
      status: "ok",
      message: expect.stringContaining("raw content persistence is enabled"),
      details: {
        destDir: dir,
        includeContent: true,
        redactionDefault: false
      }
    });
    expect(result.data?.checks.reports?.message).not.toContain("redaction is enabled");
  });

  it("askWithFiles stops on local file preflight blockers before opening a browser", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-preflight-client-missing-"));
    const missing = join(dir, "missing.md");
    const opened: string[] = [];
    const browser: BrowserLike = {
      name: "chrome",
      tabs: {
        selected: () => {
          throw new Error("selected tab should not be read when file preflight fails.");
        },
        create: async url => {
          opened.push(url);
          return fakeChatGPTPage();
        }
      }
    };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.askWithFiles({
      prompt: "summarize",
      files: [missing],
      wait: false,
      read: false
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("not_found");
    expect(result.blocker).toMatchObject({
      kind: "not_found",
      code: "file_missing",
      fieldPath: "paths[0]"
    });
    expect(result.steps).toBeUndefined();
    expect(opened).toEqual([]);
  });

  it("doctor validates file preflight metadata without opening a browser", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-doctor-file-preflight-"));
    const file = join(dir, "spec.md");
    await writeFile(file, "hello");
    const opened: string[] = [];
    const browser: BrowserLike = {
      name: "chrome",
      tabs: {
        create: async url => {
          opened.push(url);
          return fakeChatGPTPage();
        }
      }
    };
    const chatgpt = createChatGPT({ browser });

    const result = await chatgpt.doctor({
      check: ["file_preflight"],
      files: [file]
    });

    expect(result.ok).toBe(true);
    expect(result.data?.ready).toBe(true);
    expect(result.data?.checks.file_preflight).toMatchObject({
      status: "ok",
      details: {
        pathCount: 1,
        totalBytes: 5,
        files: [
          {
            name: "spec.md",
            bytes: 5,
            extension: ".md",
            mimeType: "text/markdown",
            category: "text"
          }
        ]
      }
    });
    expect(opened).toEqual([]);
  });

  it("doctor reports artifact primitive readiness without requesting generation", async () => {
    const page = fakeChatGPTPage();
    const chatgpt = createChatGPT({ page });

    const result = await chatgpt.doctor({ check: ["artifacts"] });

    expect(result.ok).toBe(true);
    expect(result.data?.checks.artifacts).toMatchObject({
      status: "ok",
      details: {
        pageAvailable: true,
        selectorsAvailable: true,
        downloadEventsAvailable: true
      }
    });
  });

  it("blocks direct primitives when the claimed tab changes after bootstrap", async () => {
    const page = fakeChatGPTPage() as PageLike;
    page.id = "tab-1";
    const browser: BrowserLike = { name: "chrome", tabs: { selected: () => page } };
    const chatgpt = createChatGPT({ browser });

    const boot = await chatgpt.session.bootstrap({ preferExistingTab: true });
    page.id = "tab-2";
    const result = await chatgpt.messages.status();

    expect(boot.ok).toBe(true);
    expect(boot.context.tabId).toBe("tab-1");
    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      kind: "selector_drift",
      code: "tab_affinity_lost"
    });
  });
});

function fakeChatGPTPage(url = "https://chatgpt.com/"): PageLike {
  return {
    url: () => url,
    title: async () => "ChatGPT",
    content: async () => "<main>New chat Search chats Chat with ChatGPT</main>",
    locator: () => ({ count: async () => 0 }),
    waitForEvent: async () => ({})
  };
}

function fakeLoginPage(): PageLike {
  return {
    url: () => "https://chatgpt.com/",
    title: async () => "ChatGPT",
    content: async () => "<main>Welcome back. Sign in to continue to ChatGPT.</main>",
    locator: () => ({ count: async () => 0 }),
    waitForEvent: async () => ({})
  };
}

type OperationRuntimePage = PageLike & {
  id: string;
  currentUrl: string;
};

type EvaluationHook = (source: string) => void | Promise<void>;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(next => {
    resolve = next;
  });
  return { promise, resolve };
}

function operationRuntimePage(
  id: string,
  currentUrl: string,
  options: { onEvaluation?: EvaluationHook } = {}
): OperationRuntimePage {
  const result: OperationRuntimePage = {
    id,
    currentUrl,
    url: () => result.currentUrl,
    title: async () => "ChatGPT",
    content: async () => "<main>Chat with ChatGPT</main>",
    locator: () => ({ count: async () => 0 }),
    evaluate: async <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => {
      const source = String(fn);
      await options.onEvaluation?.(source);
      if (source.includes("surfaceOptionLabels")) {
        return {
          composerLabels: ["Chat with ChatGPT"],
          mainControls: [],
          mainText: "Chat with ChatGPT",
          selectedSurfaceLabels: ["Chat"]
        } as T;
      }
      if (source.includes("allowBlankTask")) {
        return {
          canonicalUrl: result.currentUrl,
          conversationId: result.currentUrl.split("/").at(-1),
          threadId: `thread-${id}`,
          turns: [],
          completeness: "complete",
          terminalState: "idle"
        } as T;
      }
      if (source.includes("document.body") || source.includes("blockerText")) {
        return {
          visibleText: "Chat with ChatGPT",
          blockerText: "",
          hasConversationMessages: false
        } as T;
      }
      return undefined as T;
    }
  };
  return result;
}

function minimalOperationAdapter(): OperationBrowserAdapter {
  const unavailable = async (): Promise<never> => {
    throw new Error("browser operation should not be reached for a prepared operation");
  };
  return {
    resolveTarget: unavailable as OperationBrowserAdapter["resolveTarget"],
    submission: {
      observeStaging: unavailable,
      executeFileHandoffOnce: unavailable,
      observeAttachments: unavailable,
      prepareSend: unavailable,
      executePreparedSend: unavailable,
      verifyPreparedSend: unavailable,
      recoverSend: unavailable,
      executeFinalTabTransaction: unavailable
    } as OperationBrowserAdapter["submission"],
    collector: {
      readContext: unavailable,
      observe: unavailable,
      sleep: unavailable
    } as OperationBrowserAdapter["collector"]
  };
}

function throwingOperationAdapter(): OperationBrowserAdapter {
  const unavailable = async (): Promise<never> => {
    throw new Error("browser operation should not continue after target resolution");
  };
  return {
    resolveTarget: unavailable as OperationBrowserAdapter["resolveTarget"],
    submission: {
      observeStaging: unavailable,
      executeFileHandoffOnce: unavailable,
      observeAttachments: unavailable,
      prepareSend: unavailable,
      executePreparedSend: unavailable,
      verifyPreparedSend: unavailable,
      recoverSend: unavailable,
      executeFinalTabTransaction: unavailable
    } as OperationBrowserAdapter["submission"],
    collector: {
      readContext: unavailable,
      observe: unavailable,
      sleep: unavailable
    } as OperationBrowserAdapter["collector"]
  };
}

function pendingOperationAdapter(
  calls: { send: number; observeSend: number; legacy?: number },
  finalStatus: "pending" | "blocked" | "completed" | "handoff_uncertain" = "pending"
): OperationBrowserAdapter {
  return {
    resolveTarget: async () => ({ target: operationTarget() }),
    submission: {
      observeStaging: async () => ({ status: "exact", evidenceDigest: digest("e") } satisfies SubmissionStageObservation),
      executeFileHandoffOnce: async () => finalStatus === "handoff_uncertain"
        ? ({ status: "uncertain", evidenceDigest: digest("h"), quarantine: "provider" } satisfies SubmissionHandoffResult)
        : ({ status: "satisfied", evidenceDigest: digest("h") } satisfies SubmissionHandoffResult),
      observeAttachments: async () => ({ status: "absent", evidenceDigest: digest("a"), count: 0, orderPolicy: "exact", identityDigests: [] } satisfies SubmissionAttachmentObservation),
      prepareSend: async (): Promise<SubmissionPrepareSendResult> => ({
        status: "prepared",
        prepared: {
          prepared: { token: "send-once" },
          baseline: ownershipBaseline(),
          evidenceDigest: digest("p")
        }
      }),
      executePreparedSend: async (): Promise<SubmissionExecutePreparedSendResult> => {
        calls.send += 1;
        if (finalStatus === "blocked") {
          return {
            status: "blocked",
            result: {
              status: "blocked",
              blockerCode: "configuration_drift",
              evidenceDigest: digest("m")
            }
          };
        }
        return { status: "activated", activation: "activated", mutationMayHaveOccurred: true };
      },
      verifyPreparedSend: async request => ({
        status: "submitted",
        targetBindingDigest: request.expected.targetBindingDigest,
        evidenceDigest: digest("s"),
        userTurnId: "user-1",
        userTurnEvidenceDigest: digest("u"),
        postSendDeltaDigest: digest("d")
      } satisfies SubmissionFinalTransactionResult),
      recoverSend: async request => {
        calls.observeSend += 1;
        return {
          status: "already_submitted",
          targetBindingDigest: request.expected.targetBindingDigest,
          evidenceDigest: digest("s"),
          userTurnId: "user-1",
          userTurnEvidenceDigest: digest("u"),
          postSendDeltaDigest: digest("d")
        } satisfies SubmissionFinalTransactionResult;
      },
      // Kept only to prove the coordinator never falls back to the old
      // mutation-capable surface after a prepared Send boundary.
      executeFinalTabTransaction: async () => {
        calls.legacy = (calls.legacy ?? 0) + 1;
        throw new Error("legacy Send transaction must never be called");
      }
    },
    collector: {
      readContext: async context => ownershipContext(
        context.operationId,
        context.targetBindingDigest,
        context.submissionActionId ?? "33333333-3333-4333-8333-333333333333"
      ),
      observe: async request => finalStatus === "completed"
        ? terminalObservation(request.responseFormat ?? "markdown")
        : generatingObservation(),
      sleep: async () => undefined
    }
  };
}

function operationTarget() {
  return {
    providerId: "provider-1",
    browserId: "browser-1",
    tabId: "tab-1",
    coordinationScope: "process" as const,
    canonicalThreadUrl: "https://chatgpt.com/c/conversation-1",
    conversationId: "conversation-1",
    evidenceProfile: {
      providerIdentity: "required" as const,
      stableTabId: "required" as const,
      stableConversationId: "required" as const,
      stableUserTurnId: "required" as const,
      authoritativeTabClaim: "required" as const,
      replacementTabRecovery: true
    }
  };
}

function ownershipTarget() {
  return {
    provider: { status: "available" as const, value: "provider-1" },
    browser: { status: "available" as const, value: "browser-1" },
    tab: { status: "available" as const, value: "tab-1" },
    thread: { status: "available" as const, value: "thread-1" },
    conversation: { status: "available" as const, value: "conversation-1" },
    canonicalThreadUrl: { status: "available" as const, value: "https://chatgpt.com/c/conversation-1" },
    authoritativeTabClaim: { status: "available" as const, value: "claim-1" },
    coordinationScope: "process" as const
  };
}

function ownershipContext(
  operationId: string,
  targetBindingDigest: string,
  actionId: string
): Awaited<ReturnType<OperationBrowserAdapter["collector"]["readContext"]>> {
  const ownership = ownershipTarget();
  return {
    binding: {
      schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
      operationId,
      targetBindingDigest,
      target: ownership,
      evidenceProfile: {
        stableConversationId: "required",
        stableUserTurnId: "required",
        stableAssistantTurnId: "required",
        stableBranchId: "required",
        authoritativeTabClaim: "required"
      },
      replacementTabRecovery: true,
      actionId,
      actionKind: "send"
    },
    baseline: ownershipBaseline(),
    submissionWitness: {
      actionId,
      actionKind: "send",
      baselineSnapshotDigest: digest("b"),
      postSendDeltaDigest: digest("d"),
      operationUserEvidenceDigest: digest("u")
    }
  };
}

function ownershipBaseline() {
  return {
    schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
    snapshotDigest: digest("b"),
    target: ownershipTarget(),
    userTurns: [],
    assistantTurns: [],
    completeness: "complete" as const
  };
}

function generatingObservation(): CollectorObservation {
  const userDigest = digest("u");
  const ownership = ownershipTarget();
  return {
    schemaVersion: COLLECTOR_SCHEMA_VERSION,
    snapshot: {
      schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
      snapshotDigest: digest("g"),
      target: ownership,
      userTurns: [{ stableId: "user-1", evidenceDigest: userDigest, structureDigest: digest("q"), ordinal: 0 }],
      assistantTurns: [{
        stableId: "assistant-1",
        evidenceDigest: digest("z"),
        structureDigest: digest("v"),
        ordinal: 0,
        parentStableId: "user-1",
        branchStableId: "branch-assistant-1",
        state: "generating"
      }],
      completeness: "complete",
      terminalState: "generating",
      postSendDelta: {
        baselineSnapshotDigest: digest("b"),
        addedUserEvidenceDigests: [userDigest],
        deltaDigest: digest("d")
      }
    }
  };
}

function terminalObservation(responseFormat: "markdown" | "text" = "markdown"): CollectorObservation {
  const userDigest = digest("u");
  const assistantDigest = digest("a");
  const ownership = ownershipTarget();
  return {
    schemaVersion: COLLECTOR_SCHEMA_VERSION,
    snapshot: {
      schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
      snapshotDigest: digest("s"),
      target: ownership,
      userTurns: [{ stableId: "user-1", evidenceDigest: userDigest, structureDigest: digest("q"), ordinal: 0 }],
      assistantTurns: [{ stableId: "assistant-1", evidenceDigest: assistantDigest, structureDigest: digest("v"), ordinal: 0, parentStableId: "user-1", branchStableId: "branch-assistant-1", state: "terminal" }],
      completeness: "complete",
      terminalState: "terminal",
      postSendDelta: {
        baselineSnapshotDigest: digest("b"),
        addedUserEvidenceDigests: [userDigest],
        deltaDigest: digest("d")
      }
    },
    terminal: {
      schemaVersion: "chatgpt.browser_control.collector_terminal.v1",
      userTurnId: "user-1",
      assistantTurnId: "assistant-1",
      userTurnEvidenceDigest: userDigest,
      assistantTurnEvidenceDigest: assistantDigest,
      userOrdinal: 0,
      assistantOrdinal: 0,
      branchStableId: "branch-assistant-1",
      text: { digest: digest("x"), bytes: 16, chars: 16 },
      responseFormat,
      rawText: "private response",
      artifacts: [],
      finishReason: "stop"
    }
  };
}

function digest(letter: string): string {
  const nibble = /^[0-9a-f]$/.test(letter) ? letter : (letter.charCodeAt(0) % 16).toString(16);
  return `hmac-sha256:${nibble.repeat(64)}`;
}
