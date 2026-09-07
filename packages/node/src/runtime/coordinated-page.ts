import { AsyncLocalStorage } from "node:async_hooks";
import type {
  BrowserOperationOptions,
  FileChooserLike,
  LocatorLike,
  PageLike,
  WaitForEventOptions
} from "../types.js";
import {
  type BrowserResourceKey,
  type CoordinatorOwner,
  type CoordinatorPriority,
  type ProcessTabCoordinator,
  type TabResourceKey
} from "./tab-coordinator.js";

/** The two coordinator resources understood by the page facade. */
export type CoordinatedPageResource = Readonly<{
  kind: "tab";
  key: TabResourceKey;
}> | Readonly<{
  kind: "browser";
  key: BrowserResourceKey;
}>;

export type CoordinatedPageOptions = Readonly<{
  coordinator: ProcessTabCoordinator;
  resource: CoordinatedPageResource;
  owner: CoordinatorOwner;
  /** Optional default deadline for one browser transaction. */
  defaultTimeoutMs?: number;
}>;

/**
 * The priority mapping is deliberately public.  It makes a call site review
 *able without having to infer scheduler intent from a method name.
 */
export const COORDINATED_PAGE_PRIORITIES: Readonly<Record<string, CoordinatorPriority>> = Object.freeze({
  read: "read",
  mutation: "mutation",
  control: "control"
});

const MAX_PROTO_DEPTH = 12;
const MAX_CAPABILITY_DEPTH = 8;
const MAX_ARGUMENTS = 16;
const MAX_CACHED_PAGE_AFFINITIES = 256;

type ObjectLike = object | ((...args: never[]) => unknown);
type AnyFunction = (...args: any[]) => any;

export class CoordinatedPageError extends Error {
  readonly code = "coordinated_page_invalid";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CoordinatedPageError";
  }
}

type NormalizedOwner = Readonly<{
  backendSessionId: string;
  ownerId?: string;
  operationId?: string;
}>;

type NormalizedOptions = Readonly<{
  coordinator: ProcessTabCoordinator;
  resource: CoordinatedPageResource;
  owner: NormalizedOwner;
  defaultTimeoutMs?: number;
}>;

type WrapperState = {
  readonly rawPage: PageLike;
  readonly options: NormalizedOptions;
  readonly locatorWrappers: WeakMap<ObjectLike, LocatorLike>;
  readonly capabilityWrappers: WeakMap<ObjectLike, unknown>;
  readonly fileChooserWrappers: WeakMap<ObjectLike, FileChooserLike>;
  readonly playwrightWrappers: WeakMap<ObjectLike, unknown>;
};

const pageWrappers = new WeakMap<ObjectLike, WeakMap<ProcessTabCoordinator, Map<string, WeakRef<PageLike>>>>();
const rawValues = new WeakMap<ObjectLike, ObjectLike>();
// waitForEvent has a short actor-held registration lifetime and a potentially
// long event lifetime outside the actor. Mutation flows need an explicit
// fence for the former before they click.
const eventRegistrationBarriers = new WeakMap<object, Promise<void>>();
const mutationGuards = new AsyncLocalStorage<{ signal: AbortSignal; assertActive: () => void }>();

/** Carry a short-lived activation guard into already queued locator mutations. */
export function withCoordinatedMutationGuard<T>(signal: AbortSignal, assertActive: () => void, run: () => Promise<T>): Promise<T> {
  return mutationGuards.run({ signal, assertActive }, () => {
    assertActive();
    return run();
  });
}

/** Return the registration fence for a coordinated waitForEvent promise. */
export function coordinatedEventRegistrationBarrier(value: unknown): Promise<void> | undefined {
  return isObjectLike(value) ? eventRegistrationBarriers.get(value) : undefined;
}

function isObjectLike(value: unknown): value is ObjectLike {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function labelForKey(key: PropertyKey): string {
  try {
    return typeof key === "symbol" ? key.toString() : String(key);
  } catch {
    return "unknown";
  }
}

function invalid(message: string, cause?: unknown): never {
  throw new CoordinatedPageError(message, cause === undefined ? undefined : { cause });
}

function readDataMember<T>(value: ObjectLike, key: PropertyKey, label: string): T | undefined {
  let current: ObjectLike | null = value;
  for (let depth = 0; current !== null && depth < MAX_PROTO_DEPTH; depth += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, key);
    } catch (error) {
      return invalid(`Cannot inspect ${label}: the provider object rejected a bounded descriptor read`, error);
    }
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) {
        return invalid(`Cannot use ${label}: accessor-backed provider members are not supported`);
      }
      if (current !== value && typeof descriptor.value === "function") {
        // The Codex browser bridge exposes class instances through proxies.
        // Its normal property read returns a receiver-safe bound callable;
        // applying the raw prototype method to the proxy fails private-field
        // brand checks. Only consult the provider binding after proving the
        // member is an inherited data method, never for an accessor.
        try {
          const receiverSafe = Reflect.get(value, key, value);
          if (typeof receiverSafe === "function") return receiverSafe as T;
        } catch (error) {
          return invalid(`Cannot use ${label}: provider method binding failed`, error);
        }
      }
      return descriptor.value as T;
    }
    try {
      const prototype = Object.getPrototypeOf(current);
      current = isObjectLike(prototype) ? prototype : null;
    } catch (error) {
      return invalid(`Cannot inspect ${label}: the provider prototype chain is not readable`, error);
    }
  }
  if (current !== null) return invalid(`Cannot inspect ${label}: provider prototype depth exceeded`);
  return undefined;
}

function requiredCallable(value: ObjectLike, key: PropertyKey, label: string): AnyFunction {
  const member = readDataMember<unknown>(value, key, label);
  if (typeof member !== "function") return invalid(`${label} is not available as a callable provider method`);
  return member as AnyFunction;
}

function optionalCallable(value: ObjectLike, key: PropertyKey, label: string): AnyFunction | undefined {
  const member = readDataMember<unknown>(value, key, label);
  if (member === undefined) return undefined;
  if (typeof member !== "function") return invalid(`${label} is not callable`);
  return member as AnyFunction;
}

function requiredRecord(value: unknown, label: string): ObjectLike {
  if (!isObjectLike(value)) return invalid(`${label} must be an object`);
  return value;
}

function validateStableOwnerId(value: unknown, label: string): string {
  if (typeof value !== "string") return invalid(`${label} must be a stable string`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 512 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return invalid(`${label} must be a non-empty stable string`);
  }
  return normalized;
}

function normalizeOwner(value: unknown): NormalizedOwner {
  const owner = requiredRecord(value, "owner");
  const backendSessionId = validateStableOwnerId(
    readDataMember<unknown>(owner, "backendSessionId", "owner.backendSessionId"),
    "owner.backendSessionId"
  );
  const ownerIdValue = readDataMember<unknown>(owner, "ownerId", "owner.ownerId");
  const operationIdValue = readDataMember<unknown>(owner, "operationId", "owner.operationId");
  const ownerId = ownerIdValue === undefined ? undefined : validateStableOwnerId(ownerIdValue, "owner.ownerId");
  const operationId = operationIdValue === undefined
    ? undefined
    : validateStableOwnerId(operationIdValue, "owner.operationId");
  return Object.freeze({
    backendSessionId,
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(operationId === undefined ? {} : { operationId })
  });
}

function normalizeResource(value: unknown): CoordinatedPageResource {
  const resource = requiredRecord(value, "resource");
  const kind = readDataMember<unknown>(resource, "kind", "resource.kind");
  const key = readDataMember<unknown>(resource, "key", "resource.key");
  if (kind !== "tab" && kind !== "browser") return invalid("resource.kind must be tab or browser");
  if (typeof key !== "string" || key.length === 0) return invalid("resource.key must be a canonical coordinator key");
  const parts = key.split(":");
  const expectedParts = kind === "tab" ? 4 : 3;
  if (parts.length !== expectedParts || parts[0] !== kind) return invalid("resource.key must be a canonical coordinator key");
  for (let index = 1; index < parts.length; index += 1) {
    const encoded = parts[index];
    if (encoded === undefined || encoded.length === 0) return invalid("resource.key must be a canonical coordinator key");
    let decoded: string;
    try {
      decoded = decodeURIComponent(encoded);
    } catch (error) {
      return invalid("resource.key must be a canonical coordinator key", error);
    }
    if (encodeURIComponent(decoded) !== encoded) return invalid("resource.key must be a canonical coordinator key");
    validateStableOwnerId(decoded, `resource.key part ${index}`);
    if (["unknown", "undefined", "null", "n/a", "na"].includes(decoded.toLowerCase())) {
      return invalid("resource.key must be a canonical coordinator key");
    }
  }
  return Object.freeze({ kind, key } as CoordinatedPageResource);
}

function normalizeOptions(value: unknown): NormalizedOptions {
  const options = requiredRecord(value, "coordinated page options");
  const coordinator = readDataMember<unknown>(options, "coordinator", "options.coordinator");
  if (!isObjectLike(coordinator)) return invalid("options.coordinator must be a ProcessTabCoordinator");
  if (
    typeof readDataMember<unknown>(coordinator, "withTabTransaction", "coordinator.withTabTransaction") !== "function"
    || typeof readDataMember<unknown>(coordinator, "withBrowserAcquisition", "coordinator.withBrowserAcquisition") !== "function"
  ) {
    return invalid("options.coordinator must expose both coordinator transaction methods");
  }
  const resource = normalizeResource(readDataMember<unknown>(options, "resource", "options.resource"));
  const owner = normalizeOwner(readDataMember<unknown>(options, "owner", "options.owner"));
  const timeoutValue = readDataMember<unknown>(options, "defaultTimeoutMs", "options.defaultTimeoutMs");
  if (timeoutValue !== undefined && (!Number.isSafeInteger(timeoutValue) || (timeoutValue as number) < 0)) {
    return invalid("options.defaultTimeoutMs must be a non-negative safe integer");
  }
  const defaultTimeoutMs = timeoutValue === undefined ? undefined : timeoutValue as number;
  return Object.freeze({
    coordinator: coordinator as ProcessTabCoordinator,
    resource,
    owner,
    ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs })
  });
}

function safeInvocation<T>(fn: AnyFunction, receiver: ObjectLike, args: readonly unknown[]): T {
  if (args.length > MAX_ARGUMENTS) return invalid("Provider invocation argument count exceeded the bounded facade limit");
  try {
    return Reflect.apply(fn, receiver, args) as T;
  } catch (error) {
    throw error;
  }
}

function absorbRejection<T>(promise: Promise<T>): Promise<T> {
  // Keep the original promise for caller-visible error identity while
  // attaching a rejection handler immediately if a caller abandons it.
  void promise.catch(() => undefined);
  return promise;
}

function timeoutFromArg(value: unknown, label: string): number | undefined {
  if (!isObjectLike(value)) return undefined;
  const timeout = readDataMember<unknown>(value, "timeoutMs", `${label}.timeoutMs`);
  if (timeout === undefined) return undefined;
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0) {
    return invalid(`${label}.timeoutMs must be a non-negative finite number`);
  }
  return timeout;
}

function timeoutFromEventOptions(value: unknown): number | undefined {
  // Event settlement is intentionally not governed by this deadline: only
  // provider registration runs under the actor.  Reading timeoutMs here is
  // still useful to reject malformed accessor-backed options early without
  // ever holding the actor while the event waits.
  if (!isObjectLike(value)) return undefined;
  const timeoutMs = readDataMember<unknown>(value, "timeoutMs", "waitForEvent.options.timeoutMs");
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    return invalid("waitForEvent.options.timeoutMs must be a non-negative finite number");
  }
  const timeout = readDataMember<unknown>(value, "timeout", "waitForEvent.options.timeout");
  if (timeout !== undefined && (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0)) {
    return invalid("waitForEvent.options.timeout must be a non-negative finite number");
  }
  if (timeoutMs === undefined) return timeout as number | undefined;
  if (timeout === undefined) return timeoutMs as number;
  return Math.min(timeoutMs as number, timeout as number);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isObjectLike(value) && typeof readDataMember<unknown>(value, "then", "provider promise.then") === "function";
}

function makeCacheKey(options: NormalizedOptions): string {
  const owner = options.owner;
  return [
    options.resource.kind,
    options.resource.key,
    owner.backendSessionId,
    owner.ownerId ?? "",
    owner.operationId ?? "",
    options.defaultTimeoutMs === undefined ? "" : String(options.defaultTimeoutMs)
  ].map(part => encodeURIComponent(part)).join(":");
}

function getPageCache(rawPage: ObjectLike, coordinator: ProcessTabCoordinator): Map<string, WeakRef<PageLike>> {
  let byCoordinator = pageWrappers.get(rawPage);
  if (byCoordinator === undefined) {
    byCoordinator = new WeakMap<ProcessTabCoordinator, Map<string, WeakRef<PageLike>>>();
    pageWrappers.set(rawPage, byCoordinator);
  }
  let byAffinity = byCoordinator.get(coordinator);
  if (byAffinity === undefined) {
    byAffinity = new Map<string, WeakRef<PageLike>>();
    byCoordinator.set(coordinator, byAffinity);
  }
  return byAffinity;
}

function cachePage(cache: Map<string, WeakRef<PageLike>>, affinity: string, page: PageLike): void {
  cache.delete(affinity);
  cache.set(affinity, new WeakRef(page));
  for (const [key, reference] of cache) {
    if (reference.deref() === undefined) cache.delete(key);
  }
  while (cache.size > MAX_CACHED_PAGE_AFFINITIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function wrapResult<T>(value: T, state: WrapperState, label: string, depth = 0): T {
  if (depth > MAX_CAPABILITY_DEPTH || !isObjectLike(value)) return value;
  if (isFileChooserCandidate(value)) return wrapFileChooser(value, state, label) as T;
  // Capability methods generally return ordinary data (inventories, assets,
  // and receipts), not another provider object.  Do not proxy those values:
  // array/string helpers must remain local synchronous operations.
  return value;
}

function isFileChooserCandidate(value: ObjectLike): boolean {
  return typeof readDataMember<unknown>(value, "setFiles", "file chooser.setFiles") === "function";
}

function assertProxyInterceptable(target: ObjectLike, key: PropertyKey, label: string): void {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(target, key);
  } catch (error) {
    invalid(`Cannot wrap ${label}: provider object rejected a descriptor read`, error);
  }
  if (descriptor !== undefined && descriptor.configurable === false && "value" in descriptor && descriptor.writable === false) {
    return invalid(`Cannot wrap ${label}: provider method is a non-configurable immutable property`);
  }
}

function wrapFileChooser(rawChooser: ObjectLike, state: WrapperState, label: string): FileChooserLike {
  const existing = state.fileChooserWrappers.get(rawChooser);
  if (existing !== undefined) return existing;
  assertProxyInterceptable(rawChooser, "setFiles", `${label}.setFiles`);
  const wrapper = new Proxy(rawChooser, {
    get(target, property) {
      const propertyLabel = `${label}.${labelForKey(property)}`;
      if (property === "setFiles") {
        const setFiles = requiredCallable(target, property, propertyLabel);
        return (paths: string[], options?: BrowserOperationOptions): Promise<void> => {
          return routeTransaction(state, "mutation", propertyLabel, timeoutFromArg(options, propertyLabel), () =>
            safeInvocation<Promise<void>>(setFiles, target, [paths, options])
          );
        };
      }
      if (property === "element") {
        assertProxyInterceptable(target, property, propertyLabel);
        const element = optionalCallable(target, property, propertyLabel);
        if (element === undefined) return undefined;
        return (): Promise<LocatorLike> => routeTransaction(state, "read", propertyLabel, undefined, async () => {
          const result = await safeInvocation<LocatorLike | Promise<LocatorLike>>(element, target, []);
          return wrapLocator(await result, state, propertyLabel);
        });
      }
      if (property === "isMultiple") {
        assertProxyInterceptable(target, property, propertyLabel);
        const isMultiple = optionalCallable(target, property, propertyLabel);
        if (isMultiple === undefined) return undefined;
        return (): Promise<boolean> => routeTransaction(state, "read", propertyLabel, undefined, () =>
          safeInvocation<boolean | Promise<boolean>>(isMultiple, target, [])
        );
      }
      const member = readDataMember<unknown>(target, property, propertyLabel);
      if (typeof member === "function") return member.bind(target);
      return member;
    }
  }) as FileChooserLike;
  state.fileChooserWrappers.set(rawChooser, wrapper);
  rawValues.set(wrapper, rawChooser);
  return wrapper;
}

function capabilityPriority(name: string): CoordinatorPriority {
  const lower = name.toLowerCase();
  if (/^(get|list|read|inspect|status|count|query|fetch|metadata|inventory)/u.test(lower)) return "read";
  if (/^(stop|cancel)/u.test(lower)) return "control";
  return "mutation";
}

function wrapCapability(value: ObjectLike, state: WrapperState, label: string, depth: number): unknown {
  const existing = state.capabilityWrappers.get(value);
  if (existing !== undefined) return existing;
  const wrapper = new Proxy(value, {
    get(target, property) {
      if (property === "then") return undefined;
      const propertyLabel = `${label}.${labelForKey(property)}`;
      const member = readDataMember<unknown>(target, property, propertyLabel);
      if (typeof member !== "function") return member;
      if (typeof property === "symbol") return member;
      assertProxyInterceptable(target, property, propertyLabel);
      return (...args: unknown[]): Promise<unknown> => routeTransaction(
        state,
        capabilityPriority(labelForKey(property)),
        propertyLabel,
        timeoutFromArg(args.at(-1), propertyLabel),
        async () => wrapResult(await safeInvocation<unknown>(member as AnyFunction, target, args), state, propertyLabel, depth + 1)
      );
    }
  });
  state.capabilityWrappers.set(value, wrapper);
  rawValues.set(wrapper, value);
  return wrapper;
}

function wrapLocator(rawLocator: unknown, state: WrapperState, label: string): LocatorLike {
  if (!isObjectLike(rawLocator)) return invalid(`${label} did not return a locator object`);
  const existing = state.locatorWrappers.get(rawLocator);
  if (existing !== undefined) return existing;
  const wrapper: Record<string, unknown> = {};
  const locator = rawLocator;
  state.locatorWrappers.set(locator, wrapper as LocatorLike);
  rawValues.set(wrapper as ObjectLike, locator);

  const sync = (name: string): void => {
    const member = optionalCallable(locator, name, `${label}.${name}`);
    if (member === undefined) return;
    wrapper[name] = (...args: unknown[]): LocatorLike => {
      const child = safeInvocation<unknown>(member, locator, args);
      return wrapLocator(child, state, `${label}.${name}`);
    };
  };
  sync("nth");
  sync("first");
  sync("last");
  sync("locator");
  sync("filter");
  sync("getByRole");
  sync("getByText");

  const transaction = (name: string, priority: CoordinatorPriority, argumentTimeoutIndex: number | undefined): void => {
    const member = optionalCallable(locator, name, `${label}.${name}`);
    if (member === undefined) return;
    wrapper[name] = (...args: unknown[]): Promise<unknown> => routeTransaction(
      state,
      priority,
      `${label}.${name}`,
      argumentTimeoutIndex === undefined ? state.options.defaultTimeoutMs : timeoutFromArg(args[argumentTimeoutIndex], `${label}.${name}`) ?? state.options.defaultTimeoutMs,
      () => safeInvocation<unknown>(member, locator, args)
    );
  };
  transaction("click", "mutation", 0);
  transaction("press", "mutation", 1);
  transaction("fill", "mutation", 1);
  transaction("textContent", "read", 0);
  transaction("innerText", "read", 0);
  transaction("innerHTML", "read", 0);
  transaction("count", "read", undefined);
  transaction("allTextContents", "read", 0);
  transaction("isVisible", "read", 0);
  transaction("evaluate", "mutation", 2);
  transaction("setInputFiles", "mutation", 1);
  return wrapper as LocatorLike;
}

function wrapPlaywright(value: ObjectLike, state: WrapperState, label: string): unknown {
  const existing = state.playwrightWrappers.get(value);
  if (existing !== undefined) return existing;
  const wrapper = new Proxy(value, {
    get(target, property) {
      const propertyLabel = `${label}.${labelForKey(property)}`;
      const member = readDataMember<unknown>(target, property, propertyLabel);
      if (typeof member !== "function") return member;
      if (typeof property === "symbol") return member;
      if (property === "waitForTimeout") {
        assertProxyInterceptable(target, property, propertyLabel);
        return (milliseconds: number): Promise<void> => {
          const result = safeInvocation<Promise<void>>(member as AnyFunction, target, [milliseconds]);
          return absorbRejection(Promise.resolve(result));
        };
      }
      assertProxyInterceptable(target, property, propertyLabel);
      return (...args: unknown[]): Promise<unknown> => routeTransaction(
        state,
        "read",
        propertyLabel,
        timeoutFromArg(args.at(-1), propertyLabel) ?? state.options.defaultTimeoutMs,
        async () => wrapResult(await safeInvocation<unknown>(member as AnyFunction, target, args), state, propertyLabel)
      );
    }
  });
  state.playwrightWrappers.set(value, wrapper);
  rawValues.set(wrapper, value);
  return wrapper;
}

function routeTransaction<T>(
  state: WrapperState,
  priority: CoordinatorPriority,
  label: string,
  timeoutMs: number | undefined,
  callback: () => T | PromiseLike<T>
): Promise<T> {
  const guard = priority === "mutation" ? mutationGuards.getStore() : undefined;
  const requestOptions = {
    owner: state.options.owner,
    priority,
    label,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(guard === undefined ? {} : { signal: guard.signal })
  } as const;
  const { coordinator, resource } = state.options;
  const guardedCallback = () => {
    // The guard must run inside the actor: a listener can fail while a
    // different owner holds the tab and this mutation is waiting in its queue.
    guard?.assertActive();
    return callback();
  };
  const pending = resource.kind === "tab"
    ? coordinator.withTabTransaction(resource.key, requestOptions, guardedCallback)
    : coordinator.withBrowserAcquisition(resource.key, requestOptions, guardedCallback);
  return absorbRejection(pending);
}

function waitForEvent(state: WrapperState, rawPage: ObjectLike, event: string, optionsOrCallback?: WaitForEventOptions | unknown): Promise<unknown> {
  const wait = requiredCallable(rawPage, "waitForEvent", "page.waitForEvent");
  const eventTimeoutMs = timeoutFromEventOptions(optionsOrCallback);
  const registrationTimeoutMs = eventTimeoutMs === undefined
    ? state.options.defaultTimeoutMs
    : state.options.defaultTimeoutMs === undefined
      ? eventTimeoutMs
      : Math.min(eventTimeoutMs, state.options.defaultTimeoutMs);
  const registration = routeTransaction(state, "read", "page.waitForEvent.register", registrationTimeoutMs, () => {
    let candidate: unknown;
    try {
      candidate = safeInvocation<unknown>(wait, rawPage, [event, optionsOrCallback]);
    } catch (error) {
      throw error;
    }
    const providerPromise = Promise.resolve(candidate);
    const settled = providerPromise.then(value => value, error => { throw error; });
    void settled.catch(() => undefined);
    return { promise: settled };
  });
  const result = registration.then(async ({ promise }) => wrapResult(await promise, state, "page.waitForEvent.result"));
  const handled = absorbRejection(result);
  // Registration failure must also reject the fence so mutation callers never
  // activate after a listener failed to arm. Event data stays on its promise.
  const barrier = registration.then(() => undefined);
  void barrier.catch(() => undefined);
  eventRegistrationBarriers.set(handled, barrier);
  return handled;
}

function makeKeyboard(rawKeyboard: ObjectLike, state: WrapperState): PageLike["keyboard"] {
  const press = optionalCallable(rawKeyboard, "press", "page.keyboard.press");
  if (press === undefined) return {};
  return {
    press: (key: string): Promise<void> => routeTransaction(state, "mutation", "page.keyboard.press", state.options.defaultTimeoutMs, () =>
      safeInvocation<Promise<void>>(press, rawKeyboard, [key])
    )
  };
}

function makeMouse(rawMouse: ObjectLike, state: WrapperState): PageLike["mouse"] {
  const move = optionalCallable(rawMouse, "move", "page.mouse.move");
  const click = optionalCallable(rawMouse, "click", "page.mouse.click");
  return {
    ...(move === undefined ? {} : {
      move: (x: number, y: number): Promise<void> => routeTransaction(state, "mutation", "page.mouse.move", state.options.defaultTimeoutMs, () =>
        safeInvocation<Promise<void> | void>(move, rawMouse, [x, y])
      )
    }),
    ...(click === undefined ? {} : {
      click: (x: number, y: number): Promise<void> => routeTransaction(state, "mutation", "page.mouse.click", state.options.defaultTimeoutMs, () =>
        safeInvocation<Promise<void> | void>(click, rawMouse, [x, y])
      )
    })
  };
}

function makeCua(rawCua: ObjectLike, state: WrapperState): PageLike["cua"] {
  const move = optionalCallable(rawCua, "move", "page.cua.move");
  const click = optionalCallable(rawCua, "click", "page.cua.click");
  const keypress = optionalCallable(rawCua, "keypress", "page.cua.keypress");
  return {
    ...(move === undefined ? {} : {
      move: (options: { x: number; y: number }): Promise<void> => routeTransaction(state, "mutation", "page.cua.move", state.options.defaultTimeoutMs, () =>
        safeInvocation<Promise<void> | void>(move, rawCua, [options])
      )
    }),
    ...(click === undefined ? {} : {
      click: (options: { x: number; y: number; button?: number }): Promise<void> => routeTransaction(state, "mutation", "page.cua.click", state.options.defaultTimeoutMs, () =>
        safeInvocation<Promise<void> | void>(click, rawCua, [options])
      )
    }),
    ...(keypress === undefined ? {} : {
      keypress: (options: { keys: string[] }): Promise<void> => routeTransaction(state, "mutation", "page.cua.keypress", state.options.defaultTimeoutMs, () =>
        safeInvocation<Promise<void> | void>(keypress, rawCua, [options])
      )
    })
  };
}

function makeCapabilities(rawCapabilities: ObjectLike, state: WrapperState): PageLike["capabilities"] {
  const get = optionalCallable(rawCapabilities, "get", "page.capabilities.get");
  if (get === undefined) return {};
  return {
    get: (id: string): Promise<unknown> => routeTransaction(state, "read", "page.capabilities.get", state.options.defaultTimeoutMs, async () => {
      const value = await safeInvocation<unknown>(get, rawCapabilities, [id]);
      return isObjectLike(value) ? wrapCapability(value, state, "page.capabilities.result", 0) : value;
    })
  };
}

function buildPage(state: WrapperState): PageLike {
  const rawPage = state.rawPage as ObjectLike;
  const wrapper: Record<string, unknown> = {};
  rawValues.set(wrapper as ObjectLike, rawPage);

  for (const property of ["id", "tabId"] as const) {
    const value = readDataMember<unknown>(rawPage, property, `page.${property}`);
    if (value !== undefined) wrapper[property] = value;
  }

  const locator = optionalCallable(rawPage, "locator", "page.locator");
  if (locator !== undefined) wrapper.locator = (selector: string): LocatorLike => wrapLocator(
    safeInvocation<unknown>(locator, rawPage, [selector]), state, "page.locator"
  );
  const getByRole = optionalCallable(rawPage, "getByRole", "page.getByRole");
  if (getByRole !== undefined) wrapper.getByRole = (role: string, options?: Record<string, unknown>): LocatorLike => wrapLocator(
    safeInvocation<unknown>(getByRole, rawPage, [role, options]), state, "page.getByRole"
  );
  const getByPlaceholder = optionalCallable(rawPage, "getByPlaceholder", "page.getByPlaceholder");
  if (getByPlaceholder !== undefined) wrapper.getByPlaceholder = (text: string | RegExp, options?: Record<string, unknown>): LocatorLike => wrapLocator(
    safeInvocation<unknown>(getByPlaceholder, rawPage, [text, options]), state, "page.getByPlaceholder"
  );
  const getByText = optionalCallable(rawPage, "getByText", "page.getByText");
  if (getByText !== undefined) wrapper.getByText = (text: string | RegExp, options?: Record<string, unknown>): LocatorLike => wrapLocator(
    safeInvocation<unknown>(getByText, rawPage, [text, options]), state, "page.getByText"
  );

  const url = optionalCallable(rawPage, "url", "page.url");
  if (url !== undefined) wrapper.url = (): Promise<string> => routeTransaction(state, "read", "page.url", state.options.defaultTimeoutMs, () =>
    safeInvocation<string | Promise<string>>(url, rawPage, [])
  );
  const title = optionalCallable(rawPage, "title", "page.title");
  if (title !== undefined) wrapper.title = (): Promise<string> => routeTransaction(state, "read", "page.title", state.options.defaultTimeoutMs, () =>
    safeInvocation<Promise<string>>(title, rawPage, [])
  );
  const goto = optionalCallable(rawPage, "goto", "page.goto");
  if (goto !== undefined) wrapper.goto = (urlValue: string, options?: unknown): Promise<unknown> => routeTransaction(state, "mutation", "page.goto", timeoutFromArg(options, "page.goto") ?? state.options.defaultTimeoutMs, () =>
    safeInvocation<Promise<unknown>>(goto, rawPage, [urlValue, options])
  );
  const evaluate = optionalCallable(rawPage, "evaluate", "page.evaluate");
  if (evaluate !== undefined) wrapper.evaluate = <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A, options?: BrowserOperationOptions): Promise<T> => routeTransaction(state, "mutation", "page.evaluate", timeoutFromArg(options, "page.evaluate") ?? state.options.defaultTimeoutMs, () =>
    safeInvocation<T | Promise<T>>(evaluate, rawPage, [fn, arg, options])
  );
  const content = optionalCallable(rawPage, "content", "page.content");
  if (content !== undefined) wrapper.content = (options?: BrowserOperationOptions): Promise<string> => routeTransaction(state, "read", "page.content", timeoutFromArg(options, "page.content") ?? state.options.defaultTimeoutMs, () =>
    safeInvocation<Promise<string>>(content, rawPage, [options])
  );
  const close = optionalCallable(rawPage, "close", "page.close");
  if (close !== undefined) wrapper.close = (): Promise<void> => routeTransaction(state, "mutation", "page.close", state.options.defaultTimeoutMs, () =>
    safeInvocation<Promise<void>>(close, rawPage, [])
  );

  const waitForTimeout = optionalCallable(rawPage, "waitForTimeout", "page.waitForTimeout");
  if (waitForTimeout !== undefined) wrapper.waitForTimeout = (milliseconds: number): Promise<void> => {
    const result = safeInvocation<Promise<void>>(waitForTimeout, rawPage, [milliseconds]);
    return absorbRejection(Promise.resolve(result));
  };
  const waitForEventMethod = optionalCallable(rawPage, "waitForEvent", "page.waitForEvent");
  if (waitForEventMethod !== undefined) wrapper.waitForEvent = (event: string, optionsOrCallback?: WaitForEventOptions | unknown): Promise<unknown> =>
    waitForEvent(state, rawPage, event, optionsOrCallback);

  const keyboard = readDataMember<unknown>(rawPage, "keyboard", "page.keyboard");
  if (keyboard !== undefined) wrapper.keyboard = makeKeyboard(requiredRecord(keyboard, "page.keyboard"), state);
  const mouse = readDataMember<unknown>(rawPage, "mouse", "page.mouse");
  if (mouse !== undefined) wrapper.mouse = makeMouse(requiredRecord(mouse, "page.mouse"), state);
  const cua = readDataMember<unknown>(rawPage, "cua", "page.cua");
  if (cua !== undefined) wrapper.cua = makeCua(requiredRecord(cua, "page.cua"), state);
  const capabilities = readDataMember<unknown>(rawPage, "capabilities", "page.capabilities");
  if (capabilities !== undefined) wrapper.capabilities = makeCapabilities(requiredRecord(capabilities, "page.capabilities"), state);
  const playwright = readDataMember<unknown>(rawPage, "playwright", "page.playwright");
  if (playwright !== undefined) wrapper.playwright = wrapPlaywright(requiredRecord(playwright, "page.playwright"), state, "page.playwright");
  return wrapper as PageLike;
}

/**
 * Wrap one provider page.  The raw page is never enumerated or copied; only
 * the documented PageLike members are read through bounded data descriptors.
 * Locator construction remains synchronous, while each locator action is a
 * separate short coordinator transaction.
 */
export function createCoordinatedPage(page: PageLike, options: CoordinatedPageOptions): PageLike {
  if (!isObjectLike(page)) return invalid("page must be a provider PageLike object");
  const normalized = normalizeOptions(options);
  const cache = getPageCache(page as ObjectLike, normalized.coordinator);
  const affinity = makeCacheKey(normalized);
  const existing = cache.get(affinity)?.deref();
  if (existing !== undefined) {
    cachePage(cache, affinity, existing);
    return existing;
  }
  cache.delete(affinity);
  const state: WrapperState = {
    rawPage: page,
    options: normalized,
    locatorWrappers: new WeakMap<ObjectLike, LocatorLike>(),
    capabilityWrappers: new WeakMap<ObjectLike, unknown>(),
    fileChooserWrappers: new WeakMap<ObjectLike, FileChooserLike>(),
    playwrightWrappers: new WeakMap<ObjectLike, unknown>()
  };
  const wrapper = buildPage(state);
  cachePage(cache, affinity, wrapper);
  rawValues.set(wrapper as ObjectLike, page as ObjectLike);
  return wrapper;
}

/** Explicit identity seam for integrations that need the underlying provider page. */
export function unwrapCoordinatedPage<T extends PageLike>(page: T): PageLike {
  if (!isObjectLike(page)) return page;
  return (rawValues.get(page as ObjectLike) as PageLike | undefined) ?? page;
}
