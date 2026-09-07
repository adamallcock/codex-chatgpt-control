import { describe, expect, it } from "vitest";
import type { FileChooserLike, LocatorLike, PageLike } from "../../src/types.js";
import {
  CoordinatedPageError,
  COORDINATED_PAGE_PRIORITIES,
  createCoordinatedPage,
  withCoordinatedMutationGuard,
  unwrapCoordinatedPage
} from "../../src/runtime/coordinated-page.js";
import {
  CoordinatorDeadlineExceededError,
  ProcessTabCoordinator,
  createBrowserResourceKey,
  createTabResourceKey
} from "../../src/runtime/tab-coordinator.js";

const owner = (backendSessionId: string, operationId?: string) => ({
  backendSessionId,
  ...(operationId === undefined ? {} : { operationId })
});

const waitForTurn = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

function resource(tabId: string, browserId = "browser-1") {
  return { kind: "tab" as const, key: createTabResourceKey("provider", browserId, tabId) };
}

function browserResource(browserId = "browser-1") {
  return { kind: "browser" as const, key: createBrowserResourceKey("provider", browserId) };
}

function pageFixture(options: Readonly<{
  click?: (options?: unknown) => Promise<void>;
  count?: () => Promise<number>;
  textContent?: () => Promise<string | null>;
  event?: () => Promise<unknown>;
  capabilities?: PageLike["capabilities"];
}> = {}): PageLike {
  const locator: LocatorLike = {
    click: options.click ?? (async () => undefined),
    count: options.count ?? (async () => 0),
    textContent: options.textContent ?? (async () => "text")
  };
  return {
    locator: () => locator,
    waitForEvent: options.event ?? (async () => undefined),
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities })
  };
}

function wrap(page: PageLike, coordinator: ProcessTabCoordinator, tabId: string, ownerId = tabId): PageLike {
  return createCoordinatedPage(page, {
    coordinator,
    resource: resource(tabId),
    owner: owner("session", ownerId)
  });
}

describe("coordinated PageLike facade", () => {
  it("checks a queued mutation guard inside the actor without affecting unrelated calls", async () => {
    const coordinator = new ProcessTabCoordinator();
    const entered = deferred();
    const release = deferred();
    const events: string[] = [];
    const page = wrap(pageFixture({ click: async () => { events.push("clicked"); } }), coordinator, "guarded-tab");
    const occupied = coordinator.withTabTransaction(resource("guarded-tab").key, { owner: owner("other-session"), priority: "mutation" }, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    let active = true;
    const failure = new Error("activation expired");
    const controller = new AbortController();
    const guarded = withCoordinatedMutationGuard(controller.signal, () => { if (!active) throw failure; }, () => page.locator!("button").click!());
    const failed = expect(guarded).rejects.toBe(failure);
    // Keep the signal un-aborted so this exercises the guard inside the actor,
    // independently of the coordinator's cancellation of queued requests.
    active = false;
    const unrelated = page.locator!("button").click!();
    release.resolve();
    await occupied;
    await failed;
    await unrelated;
    expect(events).toEqual(["clicked"]);
    expect(controller.signal.aborted).toBe(false);
  });

  it("keeps page and locator affinity stable while serializing same-tab calls", async () => {
    const coordinator = new ProcessTabCoordinator();
    const gate = deferred();
    const events: string[] = [];
    let clickCalls = 0;
    const rawPage = pageFixture({
      click: async () => {
        clickCalls += 1;
        events.push(`click-${clickCalls}:start`);
        if (clickCalls === 1) await gate.promise;
        events.push(`click-${clickCalls}:end`);
      }
    });
    const page = wrap(rawPage, coordinator, "tab-a");
    const samePage = wrap(rawPage, coordinator, "tab-a");
    expect(samePage).toBe(page);
    expect(unwrapCoordinatedPage(page)).toBe(rawPage);
    const firstLocator = page.locator!("textarea");
    expect(page.locator!("textarea")).toBe(firstLocator);

    const first = firstLocator.click!();
    await waitForTurn();
    const second = firstLocator.click!();
    await waitForTurn();
    expect(events).toEqual(["click-1:start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(["click-1:start", "click-1:end", "click-2:start", "click-2:end"]);
    expect(clickCalls).toBe(2);
  });

  it("allows different tab actors to overlap and keeps the browser hierarchy exclusive", async () => {
    const coordinator = new ProcessTabCoordinator();
    const firstGate = deferred();
    const events: string[] = [];
    const first = wrap(pageFixture({
      click: async () => {
        events.push("tab-a:start");
        await firstGate.promise;
        events.push("tab-a:end");
      }
    }), coordinator, "tab-a");
    const second = wrap(pageFixture({
      click: async () => { events.push("tab-b"); }
    }), coordinator, "tab-b");
    const browserPage = createCoordinatedPage(pageFixture({
      click: async () => { events.push("browser"); }
    }), {
      coordinator,
      resource: browserResource(),
      owner: owner("session", "browser")
    });
    const firstRun = first.locator!("button").click!();
    await waitForTurn();
    const secondRun = second.locator!("button").click!();
    await waitForTurn();
    expect(events).toEqual(["tab-a:start", "tab-b"]);
    const browserRun = browserPage.locator!("button").click!();
    await waitForTurn();
    expect(events).toEqual(["tab-a:start", "tab-b"]);
    firstGate.resolve();
    await Promise.all([firstRun, secondRun]);
    await browserRun;
    expect(events).toEqual(["tab-a:start", "tab-b", "tab-a:end", "browser"]);
  });

  it("routes keyboard, pointer, CUA, capabilities, and locator actions with explicit priorities", async () => {
    const calls: string[] = [];
    const capability = {
      list: async () => {
        calls.push("capability.list");
        return { inventoryId: "inventory" };
      },
      bundle: async () => {
        calls.push("capability.bundle");
        return { assets: [] };
      }
    };
    const rawPage: PageLike = {
      locator: () => ({
        click: async () => { calls.push("locator.click"); },
        textContent: async () => {
          calls.push("locator.textContent");
          return "text";
        }
      }),
      keyboard: { press: async key => { calls.push(`keyboard.${key}`); } },
      mouse: { move: async () => { calls.push("mouse.move"); }, click: async () => { calls.push("mouse.click"); } },
      cua: {
        move: async () => { calls.push("cua.move"); },
        click: async () => { calls.push("cua.click"); },
        keypress: async () => { calls.push("cua.keypress"); }
      },
      capabilities: { get: async () => capability }
    };
    const coordinator = new ProcessTabCoordinator();
    const page = wrap(rawPage, coordinator, "tab-a");
    await page.keyboard!.press!("Enter");
    await page.mouse!.move!(1, 2);
    await page.mouse!.click!(1, 2);
    await page.cua!.move!({ x: 1, y: 2 });
    await page.cua!.click!({ x: 1, y: 2 });
    await page.cua!.keypress!({ keys: ["ENTER"] });
    await page.locator!("button").textContent!();
    await page.locator!("button").click!();
    const wrappedCapability = await page.capabilities!.get!("pageAssets") as { list: () => Promise<unknown>; bundle: () => Promise<unknown> };
    await wrappedCapability.list();
    await wrappedCapability.bundle();
    expect(calls).toEqual([
      "keyboard.Enter",
      "mouse.move",
      "mouse.click",
      "cua.move",
      "cua.click",
      "cua.keypress",
      "locator.textContent",
      "locator.click",
      "capability.list",
      "capability.bundle"
    ]);
    const diagnostics = coordinator.getTabDiagnostics(createTabResourceKey("provider", "browser-1", "tab-a"));
    expect(diagnostics.lastCompleted?.priority).toBe(COORDINATED_PAGE_PRIORITIES.mutation);
  });

  it("keeps timeout helpers outside actors", async () => {
    const timeoutGate = deferred();
    let countCalls = 0;
    const rawPage: PageLike = {
      waitForTimeout: async () => timeoutGate.promise,
      playwright: { waitForTimeout: async () => timeoutGate.promise },
      locator: () => ({ count: async () => {
        countCalls += 1;
        return 1;
      } })
    };
    const page = wrap(rawPage, new ProcessTabCoordinator(), "tab-a");
    const firstSleep = page.waitForTimeout!(50);
    const secondSleep = page.playwright!.waitForTimeout!(50);
    await page.locator!("button").count!();
    expect(countCalls).toBe(1);
    timeoutGate.resolve();
    await Promise.all([firstSleep, secondSleep]);
  });

  it("registers an event inside one actor but settles it outside, then routes chooser mutations", async () => {
    const event = deferred<FileChooserLike>();
    const chooserGate = deferred();
    let registrations = 0;
    let countCalls = 0;
    let setFilesCalls = 0;
    const chooser: FileChooserLike = {
      setFiles: async () => {
        setFilesCalls += 1;
        await chooserGate.promise;
      },
      isMultiple: () => false
    };
    const rawPage: PageLike = {
      waitForEvent: async () => {
        registrations += 1;
        return event.promise;
      },
      locator: () => ({ count: async () => {
        countCalls += 1;
        return 1;
      } })
    };
    const page = wrap(rawPage, new ProcessTabCoordinator(), "tab-a");
    const waitingChooser = page.waitForEvent!("filechooser");
    await waitForTurn();
    expect(registrations).toBe(1);
    await page.locator!("button").count!();
    expect(countCalls).toBe(1);
    event.resolve(chooser);
    const wrappedChooser = await waitingChooser as FileChooserLike;
    expect(await wrappedChooser.isMultiple!()).toBe(false);
    const setting = wrappedChooser.setFiles(["/tmp/example.txt"]);
    await waitForTurn();
    expect(setFilesCalls).toBe(1);
    chooserGate.resolve();
    await setting;
    expect(setFilesCalls).toBe(1);
  });

  it("keeps nested locator construction synchronous and invokes each provider method once", async () => {
    const calls: string[] = [];
    const leaf: LocatorLike = {
      textContent: async () => {
        calls.push("textContent");
        return "nested";
      }
    };
    const child: LocatorLike = {
      getByText: (text) => {
        calls.push(`getByText:${String(text)}`);
        return leaf;
      }
    };
    const root: LocatorLike = {
      locator: selector => {
        calls.push(`locator:${selector}`);
        return child;
      }
    };
    const rawPage: PageLike = { locator: () => root };
    const page = wrap(rawPage, new ProcessTabCoordinator(), "tab-a");
    const nested = page.locator!("main").locator!("article").getByText!("hello");
    expect(await nested.textContent!()).toBe("nested");
    expect(calls).toEqual(["locator:article", "getByText:hello", "textContent"]);
  });

  it("quarantines a timed-out in-flight provider call until it settles", async () => {
    const firstGate = deferred();
    let calls = 0;
    const rawPage = pageFixture({
      click: async () => {
        calls += 1;
        if (calls === 1) await firstGate.promise;
      }
    });
    const coordinator = new ProcessTabCoordinator();
    const page = wrap(rawPage, coordinator, "tab-a");
    const locator = page.locator!("button");
    const first = locator.click!({ timeoutMs: 5 });
    const second = locator.click!();
    await sleep(10);
    expect(calls).toBe(1);
    firstGate.resolve();
    await expect(first).rejects.toBeInstanceOf(CoordinatorDeadlineExceededError);
    await second;
    expect(calls).toBe(2);
  });

  it("fails closed for malformed resources, accessors, and hostile proxies", () => {
    const coordinator = new ProcessTabCoordinator();
    expect(() => createCoordinatedPage(pageFixture(), {
      coordinator,
      resource: { kind: "tab", key: "not-canonical" as never },
      owner: owner("session")
    })).toThrow(CoordinatedPageError);
    expect(() => createCoordinatedPage(pageFixture(), {
      coordinator,
      resource: resource("tab-a"),
      owner: { get backendSessionId(): string { throw new Error("getter should not run"); } }
    })).toThrow(CoordinatedPageError);
    const accessorPage = {
      get locator(): never { throw new Error("getter should not run"); }
    } as unknown as PageLike;
    expect(() => createCoordinatedPage(accessorPage, {
      coordinator,
      resource: resource("tab-a"),
      owner: owner("session")
    })).toThrow(CoordinatedPageError);
    const hostile = new Proxy(pageFixture(), {
      getOwnPropertyDescriptor(): never { throw new Error("proxy trap"); }
    });
    expect(() => createCoordinatedPage(hostile, {
      coordinator,
      resource: resource("tab-a"),
      owner: owner("session")
    })).toThrow(CoordinatedPageError);
    expect(() => createCoordinatedPage(pageFixture(), {
      coordinator,
      resource: resource("tab-a"),
      owner: owner("session"),
      defaultTimeoutMs: 1.5
    })).toThrow(CoordinatedPageError);
  });

  it("keeps caller selectors and capability ids out of coordinator diagnostics", async () => {
    const coordinator = new ProcessTabCoordinator();
    const rawPage: PageLike = {
      getByText: () => ({ click: async () => undefined }),
      capabilities: { get: async () => ({ list: async () => [] }) }
    };
    const page = wrap(rawPage, coordinator, "tab-private");
    await page.getByText!("private-prompt-fragment").click!();
    const capability = await page.capabilities!.get!("private-capability-id") as { list: () => Promise<unknown> };
    await capability.list();
    const diagnostics = coordinator.getTabDiagnostics(createTabResourceKey("provider", "browser-1", "tab-private"));
    expect(JSON.stringify(diagnostics)).not.toContain("private-prompt-fragment");
    expect(JSON.stringify(diagnostics)).not.toContain("private-capability-id");
  });
});
