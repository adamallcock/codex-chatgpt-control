import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadBrowserBlockedError, DownloadReceiptFailedError, DownloadReceiptTimeoutError, waitForDownloadFromClick, type DownloadLike } from "../../src/browser/downloads.js";
import { downloadLatestArtifact } from "../../src/commands/artifacts.js";
import { downloadLatestFile } from "../../src/commands/files.js";
import { createChatGPT } from "../../src/client.js";
import { createCoordinatedPage } from "../../src/runtime/coordinated-page.js";
import { createTabResourceKey, ProcessTabCoordinator } from "../../src/runtime/tab-coordinator.js";
import type { LocatorLike, PageLike } from "../../src/types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function errorPageProbe(options: { bodyClass?: string; code?: string; frames?: number; codes?: number } = {}): NonNullable<PageLike["evaluate"]> {
  const code = { textContent: options.code ?? "ERR_BLOCKED_BY_CLIENT" };
  const frame = { querySelectorAll: () => Array(options.codes ?? 1).fill(code) };
  const document = {
    body: {
      getAttribute: () => options.bodyClass ?? "neterror",
      get textContent() { throw new Error("Browser diagnostic must not read body text"); }
    },
    get documentURI() { throw new Error("Bridge does not expose documentURI"); },
    querySelectorAll: () => Array(options.frames ?? 1).fill(frame)
  };
  return async fn => runInNewContext(`(${fn.toString()})()`, { document });
}

describe("bounded browser download receipts", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "chatgpt-download-deadline-")); });
  afterEach(async () => { vi.useRealTimers(); await rm(directory, { recursive: true, force: true }); });

  it("rejects an already blocked Chrome error page before arming or activating a download", async () => {
    const waitForEvent = vi.fn(async () => ({}));
    const click = vi.fn(async () => {});
    await expect(waitForDownloadFromClick({ evaluate: errorPageProbe(), waitForEvent }, click, directory, 1000))
      .rejects.toMatchObject({ name: "DownloadBrowserBlockedError", kind: "download_unavailable", recoverable: false,
        blockerDetails: { code: "download_blocked_by_browser", resumable: false } });
    expect(waitForEvent).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it.each([
    { bodyClass: "chatgpt", code: "ERR_BLOCKED_BY_CLIENT" },
    { code: "Quoted ERR_BLOCKED_BY_CLIENT in an assistant response" },
    { code: "ERR_CONNECTION_RESET" },
    { frames: 0 }, { frames: 2 }, { codes: 2 }
  ])("requires the structural Chrome error page and exact error code: %j", async options => {
    const saveAs = vi.fn(async (target: string) => { await writeFile(target, "complete"); });
    const click = vi.fn(async () => {});
    const result = await waitForDownloadFromClick({ evaluate: errorPageProbe(options), waitForEvent: async () => ({ saveAs }) }, click, directory, 1000);
    expect(result.bytes).toBe(8);
    expect(click).toHaveBeenCalledOnce();
    expect(saveAs).toHaveBeenCalledOnce();
  });

  it.each([false, true])("detects a Chrome error after activation, including a rejected click: %s", async rejectClick => {
    const event = deferred<DownloadLike>();
    let probe = errorPageProbe({ bodyClass: "chatgpt" });
    const evaluateCalls = vi.fn();
    const evaluate: NonNullable<PageLike["evaluate"]> = async fn => { evaluateCalls(); return probe(fn); };
    const saveAs = vi.fn(async () => {});
    const click = vi.fn(async () => {
      probe = errorPageProbe();
      if (rejectClick) throw new Error("click navigation failed");
    });
    await expect(waitForDownloadFromClick({ evaluate, waitForEvent: () => event.promise }, click, directory, 1000)).rejects.toBeInstanceOf(DownloadBrowserBlockedError);
    event.resolve({ saveAs });
    await Promise.resolve();
    expect(click).toHaveBeenCalledOnce();
    expect(evaluateCalls).toHaveBeenCalledTimes(2);
    expect(saveAs).not.toHaveBeenCalled();
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it.each(["throw", "reject"] as const)("retains the native download path when the optional probe is unavailable: %s", async failure => {
    const evaluate: NonNullable<PageLike["evaluate"]> = () => {
      if (failure === "throw") throw new Error("evaluate unsupported");
      return Promise.reject(new Error("evaluate unsupported"));
    };
    const saveAs = vi.fn(async (target: string) => { await writeFile(target, "complete"); });
    const result = await waitForDownloadFromClick({ evaluate, waitForEvent: async () => ({ saveAs }) }, async () => {}, directory, 1000);
    expect(result.bytes).toBe(8);
  });

  it("bounds stalled diagnostics, reserves the native path, and ignores late diagnostic results", async () => {
    vi.useFakeTimers();
    const first = deferred<void>();
    const second = deferred<void>();
    const diagnostic = deferred<"blocked_by_client">();
    const evaluateCalls = vi.fn();
    const evaluate: NonNullable<PageLike["evaluate"]> = () => {
      evaluateCalls();
      (evaluateCalls.mock.calls.length === 1 ? first : second).resolve();
      return diagnostic.promise as Promise<never>;
    };
    const saveAs = vi.fn(async (target: string) => { await writeFile(target, "complete"); });
    const waitForEvent = vi.fn(async () => ({ saveAs }));
    const click = vi.fn(async () => {});
    const task = waitForDownloadFromClick({ evaluate, waitForEvent }, click, directory, 1000);
    await first.promise;
    await vi.advanceTimersByTimeAsync(250);
    await second.promise;
    await vi.advanceTimersByTimeAsync(187);
    const result = await task;
    expect(result.bytes).toBe(8);
    expect(waitForEvent).toHaveBeenCalledExactlyOnceWith("download", { timeout: 750, timeoutMs: 750 });
    expect(click).toHaveBeenCalledOnce();
    expect(saveAs).toHaveBeenCalledOnce();
    diagnostic.resolve("blocked_by_client");
    await Promise.resolve();
    expect(saveAs).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps stalled probes and a missing native event within one deadline", async () => {
    vi.useFakeTimers();
    const first = deferred<void>();
    const clicked = deferred<void>();
    const evaluate: NonNullable<PageLike["evaluate"]> = () => { first.resolve(); return new Promise(() => {}); };
    const task = waitForDownloadFromClick({ evaluate, waitForEvent: () => new Promise(() => {}) }, async () => { clicked.resolve(); }, directory, 100);
    const failed = expect(task).rejects.toBeInstanceOf(DownloadReceiptTimeoutError);
    await first.promise;
    await vi.advanceTimersByTimeAsync(25);
    await clicked.promise;
    await vi.advanceTimersByTimeAsync(75);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a post-click diagnostic after the event receipt has already failed", async () => {
    const event = deferred<DownloadLike>();
    const clicked = deferred<void>();
    const releaseClick = deferred<void>();
    const evaluated = vi.fn();
    const evaluate: NonNullable<PageLike["evaluate"]> = async () => { evaluated(); return "unavailable" as never; };
    const task = waitForDownloadFromClick({ evaluate, waitForEvent: () => event.promise }, async () => {
      clicked.resolve();
      await releaseClick.promise;
    }, directory, 1000);
    await clicked.promise;
    const failure = new Error("native event failed");
    const rejected = expect(task).rejects.toBeInstanceOf(DownloadReceiptFailedError);
    event.reject(failure);
    await rejected;
    releaseClick.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(evaluated).toHaveBeenCalledOnce();
  });

  it.each(["event failure", "deadline"] as const)("removes queued activation before returning a terminal %s", async cause => {
    const event = deferred<DownloadLike>();
    const registered = deferred<void>();
    const occupied = deferred<void>();
    const release = deferred<void>();
    const coordinator = new ProcessTabCoordinator();
    const key = createTabResourceKey("codex", "chrome", "cancel-download-tab");
    const click = vi.fn(async () => {});
    const page = createCoordinatedPage({ waitForEvent: () => { registered.resolve(); return event.promise; }, locator: () => ({ click }) },
      { coordinator, resource: { kind: "tab", key }, owner: { backendSessionId: "download-test" } });
    const task = waitForDownloadFromClick(page, () => page.locator!("button").click!(), directory, cause === "deadline" ? 60 : 1000);
    const failed = expect(task).rejects.toBeInstanceOf(cause === "deadline" ? DownloadReceiptTimeoutError : DownloadReceiptFailedError);
    await registered.promise;
    const otherMutation = coordinator.withTabTransaction(key, { owner: { backendSessionId: "other-owner" }, priority: "mutation" }, async () => {
      occupied.resolve();
      await release.promise;
    });
    await occupied.promise;
    if (cause === "event failure") event.reject(new Error("private native event detail"));
    await failed;
    release.resolve();
    await otherMutation;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(click).not.toHaveBeenCalled();
    expect(coordinator.getTabDiagnostics(key).queueDepth).toBe(0);
  });

  it("copies a completed path receipt and preserves the browser's original file", async () => {
    const source = join(directory, "source.csv");
    await writeFile(source, "name,value\nsmoke,1\n");
    const click = vi.fn(async () => {});
    const result = await waitForDownloadFromClick({ waitForEvent: async () => ({ path: async () => source }) }, click, join(directory, "out"), 1000);
    expect(result).toEqual({ path: join(directory, "out", "source.csv"), suggestedFilename: "source.csv", bytes: 19 });
    expect(click).toHaveBeenCalledTimes(1);
    await expect(readFile(result.path, "utf8")).resolves.toBe("name,value\nsmoke,1\n");
    await expect(readFile(source, "utf8")).resolves.toBe("name,value\nsmoke,1\n");
  });

  it("uses a usable saveAs receipt without waiting for an optional stalled path", async () => {
    const path = vi.fn(() => new Promise<string>(() => {}));
    const saveAs = vi.fn(async (target: string) => { await writeFile(target, "complete"); });
    const result = await waitForDownloadFromClick({ waitForEvent: async () => ({ path, saveAs, suggestedFilename: () => "answer.txt" }) }, async () => {}, directory, 1000);
    expect(path).not.toHaveBeenCalled();
    expect(saveAs).toHaveBeenCalledOnce();
    expect(result.bytes).toBe(8);
  });

  it("arms the coordinated event listener before a higher-priority download click", async () => {
    const order: string[] = [];
    const event = deferred<DownloadLike>();
    const active = deferred<void>();
    const release = deferred<void>();
    const registrationRequested = deferred<void>();
    const coordinator = new ProcessTabCoordinator({ maxConsecutiveReads: 1 });
    const key = createTabResourceKey("codex", "chrome", "download-tab");
    const occupied = coordinator.withTabTransaction(key, { owner: { backendSessionId: "other-reader" }, priority: "read" }, async () => { active.resolve(); await release.promise; });
    await active.promise;
    const raw: PageLike = {
      waitForEvent: () => { order.push("registered"); return event.promise; },
      locator: () => ({ click: async () => {
        order.push("clicked");
        if (order[0] !== "registered") throw new Error("download event missed before listener registration");
        event.resolve({ saveAs: async path => { await writeFile(path, "complete"); }, suggestedFilename: () => "answer.txt" });
      } })
    };
    const coordinated = createCoordinatedPage(raw, { coordinator, resource: { kind: "tab", key }, owner: { backendSessionId: "download-test" } });
    const page: PageLike = { ...coordinated, waitForEvent: (event, options) => { const pending = coordinated.waitForEvent!(event, options); registrationRequested.resolve(); return pending; } };
    const task = waitForDownloadFromClick(page, () => page.locator!("button").click!(), directory, 1000);
    await registrationRequested.promise;
    release.resolve();
    await occupied;
    const result = await task;
    expect(order).toEqual(["registered", "clicked"]);
    expect(result.bytes).toBe(8);
  });

  it("bounds a missing event and never finalizes a late receipt or deletes an existing download", async () => {
    const original = join(directory, "browser.csv");
    await writeFile(original, "already downloaded");
    vi.useFakeTimers();
    const event = deferred<DownloadLike>();
    const entered = deferred<void>();
    const saveAs = vi.fn(async () => {});
    const click = vi.fn(async () => { entered.resolve(); });
    const task = waitForDownloadFromClick({ waitForEvent: () => event.promise }, click, join(directory, "out"), 100);
    const failed = expect(task).rejects.toMatchObject({ name: "DownloadReceiptTimeoutError", blockerDetails: { code: "download_receipt_timeout", resumable: false }, recoverable: false });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(100);
    await failed;
    event.resolve({ saveAs });
    await Promise.resolve();
    expect(click).toHaveBeenCalledOnce();
    expect(saveAs).not.toHaveBeenCalled();
    await expect(readdir(join(directory, "out"))).resolves.toEqual([]);
    await expect(readFile(original, "utf8")).resolves.toBe("already downloaded");
  });

  it("never clicks when coordinated listener registration itself fails", async () => {
    const failure = new Error("listener registration failed");
    const click = vi.fn(async () => {});
    const raw: PageLike = { waitForEvent: () => { throw failure; }, locator: () => ({ click }) };
    const page = createCoordinatedPage(raw, { coordinator: new ProcessTabCoordinator(), resource: { kind: "tab", key: createTabResourceKey("codex", "chrome", "rejected-download-tab") }, owner: { backendSessionId: "download-test" } });
    await expect(waitForDownloadFromClick(page, () => page.locator!("button").click!(), directory, 1000)).rejects.toBeInstanceOf(DownloadReceiptFailedError);
    expect(click).not.toHaveBeenCalled();
  });

  it.each(["path", "saveAs"] as const)("bounds stalled %s finalization", async capability => {
    vi.useFakeTimers();
    const entered = deferred<void>();
    const finalize = vi.fn(() => { entered.resolve(); return new Promise<never>(() => {}); });
    const click = vi.fn(async () => {});
    const task = waitForDownloadFromClick({ waitForEvent: async () => ({ [capability]: finalize }) }, click, directory, 100);
    const failed = expect(task).rejects.toBeInstanceOf(DownloadReceiptTimeoutError);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(100);
    await failed;
    expect(finalize).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });

  it("spends one shared deadline across event receipt and finalization", async () => {
    vi.useFakeTimers();
    const armed = deferred<void>();
    const event = deferred<DownloadLike>();
    const finalizing = deferred<void>();
    const task = waitForDownloadFromClick({ waitForEvent: () => { armed.resolve(); return event.promise; } }, async () => {}, directory, 100);
    let settled = false;
    const failed = expect(task.finally(() => { settled = true; })).rejects.toBeInstanceOf(DownloadReceiptTimeoutError);
    await armed.promise;
    await vi.advanceTimersByTimeAsync(70);
    event.resolve({ saveAs: () => { finalizing.resolve(); return new Promise<void>(() => {}); } });
    await finalizing.promise;
    await vi.advanceTimersByTimeAsync(29);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await failed;
    expect(settled).toBe(true);
  });

  it("passes the remaining deadline to the native path receipt capability", async () => {
    vi.useFakeTimers();
    const armed = deferred<void>();
    const event = deferred<DownloadLike>();
    const finalizing = deferred<void>();
    const path = vi.fn((_options?: { timeoutMs?: number }) => { finalizing.resolve(); return new Promise<null>(() => {}); });
    const task = waitForDownloadFromClick({ waitForEvent: () => { armed.resolve(); return event.promise; } }, async () => {}, directory, 100);
    const failed = expect(task).rejects.toBeInstanceOf(DownloadReceiptTimeoutError);
    await armed.promise;
    await vi.advanceTimersByTimeAsync(60);
    event.resolve({ path });
    await finalizing.promise;
    expect(path).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 40 });
    await vi.advanceTimersByTimeAsync(40);
    await failed;
  });

  it("observes a late event rejection when activation fails without retrying", async () => {
    const event = deferred<DownloadLike>();
    const clickFailure = new Error("activation failed");
    const click = vi.fn(async () => { throw clickFailure; });
    await expect(waitForDownloadFromClick({ waitForEvent: () => event.promise }, click, directory, 1000)).rejects.toBeInstanceOf(DownloadReceiptFailedError);
    event.reject(new Error("late event failure"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(click).toHaveBeenCalledOnce();
  });

  it.each(["file", "artifact", "file-artifact-fallback", "public-file", "public-artifact"] as const)("returns a bounded %s blocker without context reads or another strategy after activation", async command => {
    vi.useFakeTimers();
    let clicked = false;
    const entered = deferred<void>();
    const click = vi.fn(async () => { clicked = true; entered.resolve(); });
    const locator: LocatorLike = { count: async () => 1, click, last: () => locator };
    const emptyLocator: LocatorLike = { count: async () => 0 };
    const content = vi.fn(async () => { if (clicked) throw new Error("unexpected source fallback"); return "<main></main>"; });
    const url = vi.fn(() => clicked ? new Promise<string>(() => {}) : "https://chatgpt.com/c/synthetic");
    // The generic file selector is distinct from the image download selector.
    const page: PageLike = {
      locator: selector => command === "file-artifact-fallback" && !selector.includes("Download image") ? emptyLocator : locator,
      waitForEvent: () => new Promise(() => {}),
      content, url
    };
    const task = command === "public-file" ? createChatGPT({ page }).files.downloadLatest({ destDir: directory, timeoutMs: 100 })
      : command === "public-artifact" ? createChatGPT({ page }).artifacts.downloadLatest({ destDir: directory, timeoutMs: 100 })
      : command === "artifact"
      ? downloadLatestArtifact({ page }, { destDir: directory, timeoutMs: 100 })
      : downloadLatestFile({ page }, { destDir: directory, timeoutMs: 100 });
    await entered.promise;
    const readsBeforeTimeout = { url: url.mock.calls.length, content: content.mock.calls.length };
    await vi.advanceTimersByTimeAsync(100);
    const result = await task;
    expect(result).toMatchObject({ ok: false, status: "blocked", blocker: { kind: "download_unavailable", code: "download_receipt_timeout", resumable: false } });
    expect(result.context).toEqual({ timestamp: expect.any(String) });
    expect(click).toHaveBeenCalledOnce();
    expect(url).toHaveBeenCalledTimes(readsBeforeTimeout.url);
    expect(content).toHaveBeenCalledTimes(readsBeforeTimeout.content);
  });

  it.each(["file", "artifact", "file-artifact-fallback", "public-file", "public-artifact"] as const)("preserves the Chrome blocker through %s without source fallback or page context capture", async command => {
    let clicked = false;
    const unexpectedRead = vi.fn();
    const click = vi.fn(async () => { clicked = true; });
    const locator: LocatorLike = { count: async () => 1, click, last: () => locator };
    const emptyLocator: LocatorLike = { count: async () => 0 };
    const page: PageLike = {
      locator: selector => command === "file-artifact-fallback" && !selector.includes("Download image") ? emptyLocator : locator,
      waitForEvent: () => new Promise(() => {}),
      evaluate: async fn => {
        if (fn.name === "inspectBrowserDownloadError") return (clicked ? "blocked_by_client" : "unavailable") as never;
        if (clicked) unexpectedRead();
        return [] as never;
      },
      content: async () => { if (clicked) unexpectedRead(); return "<main></main>"; },
      url: () => { if (clicked) unexpectedRead(); return "https://chatgpt.com/c/synthetic"; }
    };
    const result = await (command === "public-file" ? createChatGPT({ page }).files.downloadLatest({ destDir: directory, timeoutMs: 100 })
      : command === "public-artifact" ? createChatGPT({ page }).artifacts.downloadLatest({ destDir: directory, timeoutMs: 100 })
      : command === "artifact" ? downloadLatestArtifact({ page }, { destDir: directory, timeoutMs: 100 })
      : downloadLatestFile({ page }, { destDir: directory, timeoutMs: 100 }));
    expect(result).toMatchObject({ ok: false, status: "blocked", blocker: { kind: "download_unavailable", code: "download_blocked_by_browser", resumable: false },
      error: { name: "DownloadBrowserBlockedError", recoverable: false } });
    expect(result.context).toEqual({ timestamp: expect.any(String) });
    expect(result.data).toBeUndefined();
    expect(click).toHaveBeenCalledOnce();
    expect(unexpectedRead).not.toHaveBeenCalled();
  });

  it.each(["file", "artifact", "file-artifact-fallback", "public-file", "public-artifact"] as const)("sanitizes native receipt failure through %s without fallback or private context", async command => {
    const event = deferred<DownloadLike>();
    const privateUrl = "https://estuary.openai.com/private?sig=synthetic-signature-secret";
    let clicked = false;
    const unexpectedRead = vi.fn();
    const click = vi.fn(async () => { clicked = true; event.reject(new Error(`Native failure at ${privateUrl}`)); });
    const locator: LocatorLike = { count: async () => 1, click, last: () => locator };
    const emptyLocator: LocatorLike = { count: async () => 0 };
    const page: PageLike = {
      locator: selector => command === "file-artifact-fallback" && !selector.includes("Download image") ? emptyLocator : locator,
      waitForEvent: () => event.promise,
      content: async () => { if (clicked) unexpectedRead(); return "<main></main>"; },
      url: () => { if (clicked) unexpectedRead(); return clicked ? privateUrl : "https://chatgpt.com/c/synthetic"; }
    };
    const result = await (command === "public-file" ? createChatGPT({ page }).files.downloadLatest({ destDir: directory, timeoutMs: 100 })
      : command === "public-artifact" ? createChatGPT({ page }).artifacts.downloadLatest({ destDir: directory, timeoutMs: 100 })
      : command === "artifact" ? downloadLatestArtifact({ page }, { destDir: directory, timeoutMs: 100 })
      : downloadLatestFile({ page }, { destDir: directory, timeoutMs: 100 }));
    expect(result).toMatchObject({ ok: false, status: "blocked", blocker: { kind: "download_unavailable", code: "download_receipt_failed", resumable: false },
      error: { name: "DownloadReceiptFailedError", recoverable: false } });
    expect(result.context).toEqual({ timestamp: expect.any(String) });
    expect(result.data).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("synthetic-signature-secret");
    expect(click).toHaveBeenCalledOnce();
    expect(unexpectedRead).not.toHaveBeenCalled();
  });
});
