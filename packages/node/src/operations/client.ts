import {
  fingerprintOperationFile,
  revalidateOperationFile,
  type OperationFileHashOptions,
  type OperationFileIdentity,
  type OperationFileManifestEntryV1
} from "./file-identity.js";
import type { CollectorOptions, CollectorResult } from "./collector.js";
import type {
  ControlOptions,
  ControlResult,
  ControlSteerExecutePreparedRequest,
  ControlSteerPhaseResult,
  ControlSteerPrepareRequest,
  ControlSteerRecoverRequest,
  ControlSteerVerifyRequest
} from "./control.js";
import { assertDurableCapturePolicyShape } from "./state-machine.js";
import {
  OperationService,
  type OperationBrowserAdapter,
  type OperationInspectResult,
  type OperationRunResult,
  type OperationSubmitOptions,
  type OperationSubmitResult
} from "./service.js";
import type {
  OperationControlRequestV1,
  OperationDurableCapturePolicyV1,
  OperationHandleV1,
  OperationStateV1,
  OperationTargetBindingV1,
  OperationSubmitRequestV1
} from "./types.js";

/**
 * The public operations facade is deliberately a thin composition layer.
 *
 * `OperationService` owns request identity, journal state, and non-repeatable
 * action idempotency.  This class owns only the local-file boundary: it
 * snapshots the caller request, hashes local files in request order, and
 * supplies a browser adapter whose one file-handoff callback revalidates the
 * same file identities immediately before handing them to the provider.
 *
 * The browser adapter factory is optional.  A direct adapter is useful for
 * callers that already created a request-scoped closure.  The factory exists
 * for the normal SDK path, where prompt/configuration/path values should stay
 * in an ephemeral adapter closure rather than crossing the service boundary.
 */

const SAFE_INPUT_PATH_PREFIX = "operation-input-";
const SAFE_OUTPUT_PATH = "operation-output";
/** Keep ephemeral raw-path closures bounded even when callers never collect. */
const DEFAULT_MAX_CACHED_ADAPTERS = 8;
const MAX_CACHED_ADAPTERS = 256;

export type OperationFileFingerprinter = (
  sourcePath: string,
  displayName?: string,
  options?: OperationFileHashOptions
) => Promise<OperationFileIdentity>;

export type OperationFileRevalidator = (
  identity: OperationFileIdentity,
  options?: OperationFileHashOptions
) => Promise<void>;

export type OperationAdapterFactoryContext = Readonly<{
  /** A frozen snapshot; mutating the caller's request cannot affect the closure. */
  request: OperationSubmitRequestV1;
  /** Frozen identities retain source paths only in the ephemeral adapter closure. */
  files: readonly OperationFileIdentity[];
  signal: AbortSignal;
}>;

export type OperationAdapterFactory = (
  context: OperationAdapterFactoryContext
) => OperationBrowserAdapter | Promise<OperationBrowserAdapter>;

/**
 * Authenticated, redacted state exposed to a post-restart adapter factory.
 *
 * This is intentionally a projection rather than `OperationStateV1`: action
 * records, receipts, blockers, and any future fields are not needed to bind a
 * browser target and therefore must not cross this boundary by accident.
 */
export type OperationAdapterDurableState = Readonly<Pick<
  OperationStateV1,
  "schemaVersion" | "operationId" | "requestDigest" | "surface" | "phase" | "mutationBoundary" | "revision"
> & {
  target: OperationTargetBindingV1;
  /** Path-free immutable capture contract; absent only on legacy records. */
  capturePolicy?: OperationDurableCapturePolicyV1;
}>;

/**
 * Restart-safe handle-factory context.
 *
 * The enumerable shape remains the legacy `OperationHandleV1` so existing
 * one-argument factories continue to work.  The nested `handle`, `state`,
 * and `target` properties are non-enumerable and frozen; new factories should
 * use those properties to bind the exact authenticated durable target.
 */
export type OperationHandleAdapterFactoryContext = Readonly<OperationHandleV1 & {
  handle: OperationHandleV1;
  state: OperationAdapterDurableState;
  target: OperationTargetBindingV1;
}>;

export type OperationHandleAdapterFactory = (
  /** Frozen locator-compatible context; never contains prompt or local paths. */
  context: OperationHandleAdapterFactoryContext
) => OperationBrowserAdapter | Promise<OperationBrowserAdapter>;

/**
 * Request-local control adapter context.
 *
 * `request` is the validated, frozen control request and may contain the raw
 * Work-steer prompt for the duration of this one factory invocation. The
 * authenticated `handle`, `state`, and `target` projections are frozen and
 * deliberately non-enumerable so a factory cannot accidentally serialize
 * durable reconstruction material alongside its ephemeral browser closure.
 * `durable` is the same authenticated context supplied to a handle factory,
 * also kept non-enumerable for the same privacy boundary. Nothing in this
 * context is journaled or retained by the client after `control` returns.
 */
export type OperationControlAdapterFactoryContext = Readonly<{
  request: OperationControlRequestV1;
  handle: OperationHandleV1;
  state: OperationAdapterDurableState;
  target: OperationTargetBindingV1;
  durable: OperationHandleAdapterFactoryContext;
}>;

export type OperationControlAdapterFactory = (
  context: OperationControlAdapterFactoryContext
) => OperationBrowserAdapter | Promise<OperationBrowserAdapter>;

export type OperationServicePort = Pick<
  OperationService,
  "submit" | "collect" | "inspect" | "control" | "run"
>;

export type OperationClientOptions = Readonly<{
  /** Optional request-scoped adapter construction for raw prompt/path closure. */
  adapterFactory?: OperationAdapterFactory;
  /** Recreate a target-bound adapter after a process/backend restart. */
  handleAdapterFactory?: OperationHandleAdapterFactory;
  /**
   * Create a fresh target-bound adapter for one Stop/Work control call. This
   * is intentionally never cached: a steer prompt must not become a general
   * operation adapter closure or survive the invocation that consumed it.
   */
  controlAdapterFactory?: OperationControlAdapterFactory;
  /** Maximum number of ephemeral request/handle adapter closures retained. */
  maxCachedAdapters?: number;
  /** Injectable for deterministic file-boundary tests. */
  fingerprint?: OperationFileFingerprinter;
  /** Injectable for deterministic changed-file tests. */
  revalidate?: OperationFileRevalidator;
}>;

export type OperationClientSubmitOptions = Readonly<
  Pick<OperationSubmitOptions, "signal" | "deadlineAt">
>;

export type OperationClientCollectOptions = CollectorOptions;
export type OperationClientControlOptions = ControlOptions;
export type OperationClientRunOptions = Readonly<
  Omit<OperationSubmitOptions, "requestDigest"> & CollectorOptions
>;

export class OperationClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "OperationClientError";
  }
}

type PreparedSubmit = Readonly<{
  /** Frozen public snapshot retained by the adapter factory. */
  request: OperationSubmitRequestV1;
  /** Sanitized transient request accepted by the service. */
  serviceRequest: OperationSubmitRequestV1;
  identities: readonly OperationFileIdentity[];
  manifest: readonly OperationFileManifestEntryV1[];
  signal: AbortSignal;
}>;

/**
 * Additive TypeScript operations API.  The supplied adapter is also used for
 * browser-free completion paths because the service requires a uniform port;
 * `inspect` remains entirely browser-free.  A request-scoped factory may
 * replace the base adapter for submit/run and is cached in memory only for
 * subsequent collect/control calls in the same process.
 */
export class OperationClient {
  private readonly fingerprint: OperationFileFingerprinter;
  private readonly revalidate: OperationFileRevalidator;
  private readonly adapterFactory: OperationAdapterFactory | undefined;
  private readonly handleAdapterFactory: OperationHandleAdapterFactory | undefined;
  private readonly controlAdapterFactory: OperationControlAdapterFactory | undefined;
  private readonly maxCachedAdapters: number;
  private readonly requestAdapters = new Map<string, OperationBrowserAdapter>();

  constructor(
    private readonly service: OperationServicePort,
    private readonly adapter: OperationBrowserAdapter,
    options: OperationClientOptions = {}
  ) {
    this.fingerprint = options.fingerprint ?? fingerprintOperationFile;
    this.revalidate = options.revalidate ?? revalidateOperationFile;
    this.adapterFactory = options.adapterFactory;
    this.handleAdapterFactory = options.handleAdapterFactory;
    this.controlAdapterFactory = options.controlAdapterFactory;
    this.maxCachedAdapters = validateMaxCachedAdapters(options.maxCachedAdapters);
  }

  /** Fingerprint inputs, then execute the service's one-submit protocol. */
  async submit(
    request: OperationSubmitRequestV1,
    options: OperationClientSubmitOptions = {}
  ): Promise<OperationSubmitResult> {
    const prepared = await this.prepareSubmit(request, options.signal);
    const adapter = await this.adapterForSubmit(prepared);
    const result = await this.service.submit(
      prepared.serviceRequest,
      prepared.manifest,
      adapter,
      forwardSubmitOptions(options, prepared.signal)
    );
    if (isTerminalSubmitResult(result)) {
      this.forgetAdapter(result.handle);
    } else {
      this.rememberAdapter(result.handle, adapter);
    }
    return freshResult(result);
  }

  /** Collect only the exact operation-owned turn; never composes or submits. */
  async collect(
    handle: OperationHandleV1,
    options: OperationClientCollectOptions = {}
  ): Promise<CollectorResult> {
    const snapshot = cloneFrozen(handle, "invalid_operation_handle");
    const adapter = await this.adapterForHandle(snapshot, options.signal);
    const result = await this.service.collect(snapshot, adapter, forwardCollectorOptions(options));
    if (result.kind === "completed") this.forgetAdapter(snapshot);
    return freshResult(result);
  }

  /** Inspect durable state without touching the browser. */
  async inspect(handle: OperationHandleV1): Promise<OperationInspectResult> {
    const snapshot = cloneFrozen(handle, "invalid_operation_handle");
    return freshResult(await this.service.inspect(snapshot));
  }

  /** Apply one operation-bound Stop or Work steer. */
  async control(
    request: OperationControlRequestV1,
    options: OperationClientControlOptions = {}
  ): Promise<ControlResult> {
    const snapshot = cloneFrozen(request, "invalid_operation_control_request");
    // Authenticate exactly once before selecting an adapter. A control
    // factory receives the same durable target/state snapshot used below;
    // invoking it before inspection would permit a stale target binding and
    // invoking adapterForHandle first would perform a second inspect and/or
    // accidentally reuse a submit adapter that cannot carry steer prompt
    // state.
    const reconstruction = await this.reconstructionForHandle(snapshot.parent);
    const adapter = this.controlAdapterFactory === undefined
      ? await this.adapterForAuthenticatedHandle(snapshot.parent, options.signal, reconstruction)
      : await this.adapterForControl(snapshot, options.signal, reconstruction);
    return freshResult(await this.service.control(snapshot, adapter, forwardControlOptions(options)));
  }

  /** SDK-only composition of one submit followed by one collect. */
  async run(
    request: OperationSubmitRequestV1,
    options: OperationClientRunOptions = {}
  ): Promise<OperationRunResult> {
    const prepared = await this.prepareSubmit(request, options.signal);
    const adapter = await this.adapterForSubmit(prepared);
    const result = await this.service.run(
      prepared.serviceRequest,
      prepared.manifest,
      adapter,
      forwardRunOptions(options, prepared.signal)
    );
    if (isTerminalRunResult(result)) {
      this.forgetAdapter(result.submit.handle);
    } else {
      this.rememberAdapter(result.submit.handle, adapter);
    }
    return freshResult(result);
  }

  private async prepareSubmit(
    request: OperationSubmitRequestV1,
    requestedSignal: AbortSignal | undefined
  ): Promise<PreparedSubmit> {
    const snapshot = cloneFrozen(request, "invalid_operation_request");
    const signal = requestedSignal ?? new AbortController().signal;
    assertAbortSignal(signal);

    const requestedFiles = readRequestedFiles(snapshot);
    const identities: OperationFileIdentity[] = [];
    for (const file of requestedFiles) {
      try {
        const identity = await this.fingerprint(file.path, file.displayName, { signal });
        identities.push(freezeIdentity(identity));
      } catch (error) {
        throw fileBoundaryError(error);
      }
    }

    const manifest = Object.freeze(identities.map(identity => identity.manifest));
    const serviceRequest = sanitizeServiceRequest(snapshot, identities);
    return Object.freeze({
      request: snapshot,
      serviceRequest,
      identities: Object.freeze(identities),
      manifest,
      signal
    });
  }

  private async adapterForSubmit(prepared: PreparedSubmit): Promise<OperationBrowserAdapter> {
    // A non-terminal submit result deliberately retains its request-scoped
    // adapter so an identical same-operation retry can reconcile the durable
    // Send boundary observation-only.  The client cannot recompute the
    // journal's keyed request digest, so select by the already validated
    // operation ID. OperationService authenticates the immutable request
    // digest before it invokes any adapter method; a changed same-ID request
    // therefore still fails browser-free with operation_request_mismatch.
    const cached = this.cachedAdapterForOperation(prepared.request.operationId);
    if (cached !== undefined) return cached;

    let adapter = this.adapter;
    if (this.adapterFactory !== undefined) {
      try {
        adapter = await this.adapterFactory(Object.freeze({
          request: prepared.request,
          files: prepared.identities,
          signal: prepared.signal
        }));
      } catch {
        // Let OperationService create the durable request record before the
        // read-only target probe reports this blocker. Throwing here would
        // lose the operation handle and make a same-ID recovery opaque.
        adapter = unavailableAdapter("adapter_unavailable");
      }
    }
    try {
      return this.guardAdapter(adapter, prepared.identities, prepared.signal);
    } catch {
      throw new OperationClientError("adapter_unavailable", "The operation browser adapter is incomplete.");
    }
  }

  private guardAdapter(
    adapter: OperationBrowserAdapter,
    identities: readonly OperationFileIdentity[],
    signal: AbortSignal
  ): OperationBrowserAdapter {
    if (adapter === null || typeof adapter !== "object") {
      throw new OperationClientError("adapter_unavailable", "The operation browser adapter is incomplete.");
    }

    // Factory output is untrusted at this boundary. Read only own data
    // descriptors so an accessor (or a proxy get trap) cannot run while the
    // facade is merely validating the adapter. Capture every method before
    // building wrappers so a later mutation/accessor replacement cannot alter
    // the validated surface.
    const resolveTarget = requiredMethod<OperationBrowserAdapter["resolveTarget"]>(adapter, "resolveTarget");
    const submissionInput = requiredAdapterObject(adapter, "submission");
    const observeStaging = requiredMethod<OperationBrowserAdapter["submission"]["observeStaging"]>(submissionInput, "observeStaging");
    const executeFileHandoffOnce = requiredMethod<OperationBrowserAdapter["submission"]["executeFileHandoffOnce"]>(submissionInput, "executeFileHandoffOnce");
    const observeAttachments = requiredMethod<OperationBrowserAdapter["submission"]["observeAttachments"]>(submissionInput, "observeAttachments");
    const prepareSend = requiredMethod<OperationBrowserAdapter["submission"]["prepareSend"]>(submissionInput, "prepareSend");
    const executePreparedSend = requiredMethod<OperationBrowserAdapter["submission"]["executePreparedSend"]>(submissionInput, "executePreparedSend");
    const verifyPreparedSend = requiredMethod<OperationBrowserAdapter["submission"]["verifyPreparedSend"]>(submissionInput, "verifyPreparedSend");
    const recoverSend = requiredMethod<OperationBrowserAdapter["submission"]["recoverSend"]>(submissionInput, "recoverSend");
    const recoverAuthenticatedSend = optionalMethod<NonNullable<OperationBrowserAdapter["submission"]["recoverAuthenticatedSend"]>>(submissionInput, "recoverAuthenticatedSend");
    const executeFinalTabTransaction = requiredMethod<OperationBrowserAdapter["submission"]["executeFinalTabTransaction"]>(submissionInput, "executeFinalTabTransaction");
    const collectorInput = requiredAdapterObject(adapter, "collector");
    const readContext = requiredMethod<OperationBrowserAdapter["collector"]["readContext"]>(collectorInput, "readContext");
    const observe = requiredMethod<OperationBrowserAdapter["collector"]["observe"]>(collectorInput, "observe");
    const sleep = requiredMethod<OperationBrowserAdapter["collector"]["sleep"]>(collectorInput, "sleep");

    const submission = Object.freeze({
      observeStaging: (request: Parameters<OperationBrowserAdapter["submission"]["observeStaging"]>[0]) =>
        observeStaging(request),
      executeFileHandoffOnce: async (request: Parameters<OperationBrowserAdapter["submission"]["executeFileHandoffOnce"]>[0]) => {
        for (const identity of identities) {
          try {
            await this.revalidate(identity, { signal });
          } catch (error) {
            throw fileBoundaryError(error);
          }
        }
        return executeFileHandoffOnce(request);
      },
      observeAttachments: (request: Parameters<OperationBrowserAdapter["submission"]["observeAttachments"]>[0]) =>
        observeAttachments(request),
      prepareSend: (request: Parameters<OperationBrowserAdapter["submission"]["prepareSend"]>[0]) =>
        prepareSend(request),
      executePreparedSend: (request: Parameters<OperationBrowserAdapter["submission"]["executePreparedSend"]>[0]) =>
        executePreparedSend(request),
      verifyPreparedSend: (request: Parameters<OperationBrowserAdapter["submission"]["verifyPreparedSend"]>[0]) =>
        verifyPreparedSend(request),
      recoverSend: (request: Parameters<OperationBrowserAdapter["submission"]["recoverSend"]>[0]) =>
        recoverSend(request),
      ...(recoverAuthenticatedSend === undefined ? {} : { recoverAuthenticatedSend }),
      executeFinalTabTransaction: (request: Parameters<OperationBrowserAdapter["submission"]["executeFinalTabTransaction"]>[0]) =>
        executeFinalTabTransaction(request)
    });
    const collector = Object.freeze({
      readContext: (request: Parameters<OperationBrowserAdapter["collector"]["readContext"]>[0]) =>
        readContext(request),
      observe: (request: Parameters<OperationBrowserAdapter["collector"]["observe"]>[0]) =>
        observe(request),
      sleep: (milliseconds: number, sleepSignal: AbortSignal) =>
        sleep(milliseconds, sleepSignal)
    });
    let control: OperationBrowserAdapter["control"];
    const controlInput = optionalDataProperty(adapter, "control");
    if (controlInput !== undefined) {
      const controlObject = adapterObject(controlInput);
      const observeTurn = requiredMethod<NonNullable<OperationBrowserAdapter["control"]>["observeTurn"]>(controlObject, "observeTurn");
      const executeOnce = requiredMethod<NonNullable<OperationBrowserAdapter["control"]>["executeOnce"]>(controlObject, "executeOnce");
      const observePostcondition = requiredMethod<NonNullable<OperationBrowserAdapter["control"]>["observePostcondition"]>(controlObject, "observePostcondition");
      const postconditionRetryInput = optionalDataProperty(controlObject, "postconditionRetry");
      const postconditionRetry = postconditionRetryInput === undefined
        ? undefined
        : (() => {
            const policy = adapterObject(postconditionRetryInput);
            const maxAttempts = optionalDataProperty(policy, "maxAttempts");
            const intervalMs = optionalDataProperty(policy, "intervalMs");
            if (!Number.isSafeInteger(maxAttempts) || !Number.isSafeInteger(intervalMs)) {
              throw new OperationClientError("adapter_unavailable", "The operation control adapter has an invalid postcondition retry policy.");
            }
            return Object.freeze({
              maxAttempts: maxAttempts as number,
              intervalMs: intervalMs as number
            });
          })();
      // Work-steer is an optional four-phase capability. Existing Stop-only
      // adapters remain valid, but a partially supplied phase surface is not
      // safe: allowing it through would defer an adapter contract failure
      // until after a durable control intent exists.
      const prepareSteer = optionalMethod<(request: ControlSteerPrepareRequest) => Promise<ControlSteerPhaseResult>>(controlObject, "prepareSteer");
      const executeSteerPrepared = optionalMethod<(request: ControlSteerExecutePreparedRequest) => Promise<ControlSteerPhaseResult>>(controlObject, "executeSteerPrepared");
      const verifySteer = optionalMethod<(request: ControlSteerVerifyRequest) => Promise<ControlSteerPhaseResult>>(controlObject, "verifySteer");
      const recoverSteer = optionalMethod<(request: ControlSteerRecoverRequest) => Promise<ControlSteerPhaseResult>>(controlObject, "recoverSteer");
      const steerPhaseMethods = [prepareSteer, executeSteerPrepared, verifySteer, recoverSteer];
      const steerPhaseCount = steerPhaseMethods.filter(method => method !== undefined).length;
      if (steerPhaseCount !== 0 && steerPhaseCount !== steerPhaseMethods.length) {
        throw new OperationClientError("adapter_unavailable", "The operation control adapter has incomplete Work-steer phases.");
      }
      const guardedControl: Record<string, unknown> = {
        observeTurn: (request: Parameters<NonNullable<OperationBrowserAdapter["control"]>["observeTurn"]>[0]) =>
          observeTurn(request),
        executeOnce: (request: Parameters<NonNullable<OperationBrowserAdapter["control"]>["executeOnce"]>[0]) =>
          executeOnce(request),
        observePostcondition: (request: Parameters<NonNullable<OperationBrowserAdapter["control"]>["observePostcondition"]>[0]) =>
          observePostcondition(request)
      };
      if (postconditionRetry !== undefined) guardedControl.postconditionRetry = postconditionRetry;
      if (prepareSteer !== undefined && executeSteerPrepared !== undefined && verifySteer !== undefined && recoverSteer !== undefined) {
        guardedControl.prepareSteer = (request: ControlSteerPrepareRequest) => prepareSteer(request);
        guardedControl.executeSteerPrepared = (request: ControlSteerExecutePreparedRequest) => executeSteerPrepared(request);
        guardedControl.verifySteer = (request: ControlSteerVerifyRequest) => verifySteer(request);
        guardedControl.recoverSteer = (request: ControlSteerRecoverRequest) => recoverSteer(request);
      }
      control = Object.freeze(guardedControl) as OperationBrowserAdapter["control"];
    }
    let artifacts: OperationBrowserAdapter["artifacts"];
    const artifactsInput = optionalDataProperty(adapter, "artifacts");
    if (artifactsInput !== undefined) {
      const artifactsObject = adapterObject(artifactsInput);
      const transfer = requiredMethod<NonNullable<OperationBrowserAdapter["artifacts"]>["transfer"]>(artifactsObject, "transfer");
      artifacts = Object.freeze({
        transfer: (request: Parameters<NonNullable<OperationBrowserAdapter["artifacts"]>["transfer"]>[0]) =>
          transfer(request)
      });
    }
    let staging: OperationBrowserAdapter["staging"];
    const stagingInput = optionalDataProperty(adapter, "staging");
    if (stagingInput !== undefined) {
      const stagingObject = adapterObject(stagingInput);
      const readCurrent = requiredMethod<NonNullable<OperationBrowserAdapter["staging"]>["readCurrent"]>(stagingObject, "readCurrent");
      const mutateOnce = requiredMethod<NonNullable<OperationBrowserAdapter["staging"]>["mutateOnce"]>(stagingObject, "mutateOnce");
      const observeStagingState = requiredMethod<NonNullable<OperationBrowserAdapter["staging"]>["observe"]>(stagingObject, "observe");
      staging = Object.freeze({
        readCurrent: (request: Parameters<NonNullable<OperationBrowserAdapter["staging"]>["readCurrent"]>[0]) =>
          readCurrent(request),
        mutateOnce: (request: Parameters<NonNullable<OperationBrowserAdapter["staging"]>["mutateOnce"]>[0]) =>
          mutateOnce(request),
        observe: (request: Parameters<NonNullable<OperationBrowserAdapter["staging"]>["observe"]>[0]) =>
          observeStagingState(request)
      });
    }
    const guarded: OperationBrowserAdapter = {
      resolveTarget: (request: Parameters<OperationBrowserAdapter["resolveTarget"]>[0]) =>
        resolveTarget(request),
      submission,
      collector,
      ...(artifacts === undefined ? {} : { artifacts }),
      ...(staging === undefined ? {} : { staging }),
      ...(control === undefined ? {} : { control })
    };
    return Object.freeze(guarded);
  }

  private async adapterForHandle(
    handle: OperationHandleV1,
    requestedSignal: AbortSignal | undefined
  ): Promise<OperationBrowserAdapter> {
    const reconstruction = await this.reconstructionForHandle(handle);
    return await this.adapterForAuthenticatedHandle(handle, requestedSignal, reconstruction);
  }

  /**
   * Authenticate a handle and project only the immutable target context
   * needed by a request-local adapter. The inspect result is intentionally
   * consumed once and passed to adapter selection; callers that need a
   * prompt-bearing control closure must not repeat this read.
   */
  private async reconstructionForHandle(
    handle: OperationHandleV1
  ): Promise<Reconstruction | undefined> {
    // Always authenticate the locator before consulting the in-process cache.
    // Otherwise a caller could mutate revision/phase on a still-cacheable
    // identity and reuse a target-bound adapter without a fresh journal read.
    const inspected = await this.service.inspect(handle);
    try {
      return reconstructionContext(inspected, handle);
    } catch (error) {
      // A pre-target record cannot supply a target-bound reconstruction
      // context. Do not invoke a factory with a type-unsound partial context;
      // OperationService remains authoritative and rejects the missing target
      // before browser use.
      if (error instanceof OperationClientError && error.code === "target_binding_missing") {
        return undefined;
      }
      throw error;
    }
  }

  private async adapterForAuthenticatedHandle(
    handle: OperationHandleV1,
    requestedSignal: AbortSignal | undefined,
    reconstruction: Reconstruction | undefined
  ): Promise<OperationBrowserAdapter> {
    if (reconstruction === undefined) return this.adapter;
    if (reconstruction.target.targetLifecycle === "new_pending") {
      throw new OperationClientError(
        "new_target_not_established",
        "A pending new target cannot be reconstructed for collection or control."
      );
    }
    if (reconstruction.state.phase === "completed") {
      // OperationService returns completed receipts without touching its
      // adapter. Keep that browser-free guarantee after a process restart too.
      return this.adapter;
    }
    const factoryContext = reconstruction.context;

    const key = adapterKey(handle.operationId, handle.requestDigest);
    const cached = this.requestAdapters.get(key);
    if (cached !== undefined) {
      // Map insertion order is the LRU order.  A read promotes this entry.
      this.requestAdapters.delete(key);
      this.requestAdapters.set(key, cached);
      return cached;
    }
    if (this.handleAdapterFactory === undefined) return this.adapter;
    let recreated: OperationBrowserAdapter;
    try {
      recreated = await this.handleAdapterFactory(factoryContext);
    } catch {
      throw new OperationClientError("adapter_unavailable", "The operation browser adapter could not be recreated from the operation handle.");
    }
    const signal = requestedSignal ?? new AbortController().signal;
    assertAbortSignal(signal);
    let guarded: OperationBrowserAdapter;
    try {
      guarded = this.guardAdapter(recreated, [], signal);
    } catch {
      throw new OperationClientError("adapter_unavailable", "The operation browser adapter could not be recreated from the operation handle.");
    }
    this.rememberAdapter(factoryContext.handle, guarded);
    return guarded;
  }

  private async adapterForControl(
    request: OperationControlRequestV1,
    requestedSignal: AbortSignal | undefined,
    reconstruction: Reconstruction | undefined
  ): Promise<OperationBrowserAdapter> {
    // Completed records and pre-target records remain browser-free/legacy
    // compatible. There is no safe target-bound context with which to invoke
    // a control factory in either case, and OperationService owns the final
    // blocker/receipt decision.
    if (reconstruction === undefined || reconstruction.state.phase === "completed") {
      return await this.adapterForAuthenticatedHandle(request.parent, requestedSignal, reconstruction);
    }
    if (reconstruction.target.targetLifecycle === "new_pending") {
      throw new OperationClientError(
        "new_target_not_established",
        "A pending new target cannot be reconstructed for collection or control."
      );
    }
    const signal = requestedSignal ?? new AbortController().signal;
    assertAbortSignal(signal);
    let created: OperationBrowserAdapter;
    try {
      created = await this.controlAdapterFactory!(makeControlFactoryContext(request, reconstruction));
    } catch {
      // The control factory is the only component that can hold a raw steer
      // prompt and a provider/browser closure. If it fails, do not fall back
      // to a cached submit adapter: that would either lose the prompt or
      // mutate an unintended target. Keep this message static and redacted.
      throw new OperationClientError("adapter_unavailable", "The operation control browser adapter is unavailable.");
    }
    try {
      // Control adapters are deliberately not remembered in requestAdapters.
      // Their closure may contain a steer prompt and must die with this call.
      return this.guardAdapter(created, [], signal);
    } catch {
      throw new OperationClientError("adapter_unavailable", "The operation control browser adapter is incomplete.");
    }
  }

  private rememberAdapter(handle: OperationHandleV1, adapter: OperationBrowserAdapter): void {
    const key = adapterKey(handle.operationId, handle.requestDigest);
    this.requestAdapters.delete(key);
    this.requestAdapters.set(key, adapter);
    while (this.requestAdapters.size > this.maxCachedAdapters) {
      const oldest = this.requestAdapters.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.requestAdapters.delete(oldest);
    }
  }

  private cachedAdapterForOperation(operationId: string): OperationBrowserAdapter | undefined {
    const prefix = `${operationId}\0`;
    let matchedKey: string | undefined;
    let matchedAdapter: OperationBrowserAdapter | undefined;
    for (const [key, adapter] of this.requestAdapters) {
      if (key.startsWith(prefix)) {
        matchedKey = key;
        matchedAdapter = adapter;
      }
    }
    if (matchedKey === undefined || matchedAdapter === undefined) return undefined;
    // Preserve the cache's LRU invariant when a submit retry hits it.
    this.requestAdapters.delete(matchedKey);
    this.requestAdapters.set(matchedKey, matchedAdapter);
    return matchedAdapter;
  }

  private forgetAdapter(handle: OperationHandleV1): void {
    this.requestAdapters.delete(adapterKey(handle.operationId, handle.requestDigest));
  }
}

/** Alias kept for callers that prefer the plural namespace terminology. */
export const OperationsClient = OperationClient;

export function createOperationClient(
  service: OperationServicePort,
  adapter: OperationBrowserAdapter,
  options: OperationClientOptions = {}
): OperationClient {
  return new OperationClient(service, adapter, options);
}

type Reconstruction = Readonly<{
  context: OperationHandleAdapterFactoryContext;
  state: OperationAdapterDurableState;
  target: OperationTargetBindingV1;
}>;

/**
 * Project one authenticated inspect result into the restart factory surface.
 * Only own data descriptors are read. This is deliberately verbose: using a
 * spread, structuredClone, or direct property access here would execute a
 * hostile getter before the adapter factory has even been called.
 */
function reconstructionContext(
  inspected: unknown,
  requestedHandle: OperationHandleV1
): Reconstruction {
  const inspectedRecord = requiredObject(inspected, "inspect result");
  const freshHandle = normalizeHandle(requiredData(inspectedRecord, "handle"), requestedHandle);
  const rawState = requiredData(inspectedRecord, "state");
  const stateRecord = requiredObject(rawState, "durable operation state");
  const state = normalizeDurableState(stateRecord, freshHandle);
  const target = state.target;
  const context = makeFactoryContext(freshHandle, state, target);
  return Object.freeze({ context, state, target });
}

function normalizeHandle(value: unknown, requested: OperationHandleV1): OperationHandleV1 {
  const record = requiredObject(value, "operation handle");
  const schemaVersion = requiredString(record, "schemaVersion");
  const operationId = requiredString(record, "operationId");
  const requestDigest = requiredString(record, "requestDigest");
  const surface = requiredString(record, "surface");
  const revision = requiredSafeInteger(record, "revision");
  const phase = requiredString(record, "phase");
  const mutationBoundary = requiredString(record, "mutationBoundary");
  const targetBindingDigest = optionalString(record, "targetBindingDigest");
  if (
    schemaVersion !== requested.schemaVersion
    || operationId !== requested.operationId
    || requestDigest !== requested.requestDigest
    || surface !== requested.surface
    || revision < requested.revision
    || !isOperationSurface(surface)
    || !isOperationPhase(phase)
    || !isMutationBoundary(mutationBoundary)
    || (targetBindingDigest !== undefined && !isDigest(targetBindingDigest))
    || (requested.targetBindingDigest !== undefined
      && targetBindingDigest !== requested.targetBindingDigest)
    || (revision === requested.revision
      && (phase !== requested.phase
        || mutationBoundary !== requested.mutationBoundary
        || targetBindingDigest !== requested.targetBindingDigest))
  ) {
    throw new OperationClientError("invalid_operation_handle", "The authenticated operation handle is inconsistent.");
  }
  return Object.freeze({
    schemaVersion: schemaVersion as OperationHandleV1["schemaVersion"],
    operationId,
    requestDigest,
    surface: surface as OperationHandleV1["surface"],
    revision,
    phase: phase as OperationHandleV1["phase"],
    mutationBoundary: mutationBoundary as OperationHandleV1["mutationBoundary"],
    ...(targetBindingDigest === undefined ? {} : { targetBindingDigest })
  });
}

function normalizeDurableState(
  value: Record<string, unknown>,
  handle: OperationHandleV1
): OperationAdapterDurableState {
  const schemaVersion = requiredString(value, "schemaVersion");
  const operationId = requiredString(value, "operationId");
  const requestDigest = requiredString(value, "requestDigest");
  const surface = requiredString(value, "surface");
  const phase = requiredString(value, "phase");
  const mutationBoundary = requiredString(value, "mutationBoundary");
  const revision = requiredSafeInteger(value, "revision");
  const capturePolicyValue = optionalDataProperty(value, "capturePolicy");
  if (capturePolicyValue !== undefined) assertDurableCapturePolicyShape(capturePolicyValue);
  const targetValue = optionalDataProperty(value, "target");
  if (targetValue === undefined) {
    throw new OperationClientError("target_binding_missing", "The durable operation has no target binding.");
  }
  const target = normalizeTarget(targetValue);
  if (
    schemaVersion !== "chatgpt.browser_control.operation.v1"
    || operationId !== handle.operationId
    || requestDigest !== handle.requestDigest
    || surface !== handle.surface
    || revision !== handle.revision
    || phase !== handle.phase
    || mutationBoundary !== handle.mutationBoundary
    || handle.targetBindingDigest === undefined
    || (target.targetEstablishment !== undefined
      && target.targetEstablishment.targetBindingDigest !== handle.targetBindingDigest)
    || !isOperationSurface(surface)
    || !isOperationPhase(phase)
    || !isMutationBoundary(mutationBoundary)
  ) {
    throw new OperationClientError("invalid_operation_state", "The authenticated operation state is inconsistent.");
  }
  return Object.freeze({
    schemaVersion: schemaVersion as OperationStateV1["schemaVersion"],
    operationId,
    requestDigest,
    surface: surface as OperationStateV1["surface"],
    phase: phase as OperationStateV1["phase"],
    mutationBoundary: mutationBoundary as OperationStateV1["mutationBoundary"],
    revision,
    target,
    ...(capturePolicyValue === undefined ? {} : { capturePolicy: capturePolicyValue as OperationDurableCapturePolicyV1 })
  });
}

function normalizeTarget(value: unknown): OperationTargetBindingV1 {
  const record = requiredObject(value, "durable target binding");
  const providerId = requiredBoundedString(record, "providerId");
  const browserId = requiredBoundedString(record, "browserId");
  const tabId = requiredBoundedString(record, "tabId");
  const coordinationScope = requiredString(record, "coordinationScope");
  const evidenceProfile = normalizeEvidenceProfile(requiredData(record, "evidenceProfile"));
  const targetLifecycle = optionalString(record, "targetLifecycle") ?? "fixed";
  const tabClaimEvidenceDigest = optionalDigest(record, "tabClaimEvidenceDigest");
  const canonicalThreadUrl = optionalBoundedString(record, "canonicalThreadUrl");
  const conversationId = optionalBoundedString(record, "conversationId");
  const userTurnBaselineDigest = optionalDigest(record, "userTurnBaselineDigest");
  const assistantTurnBaselineDigest = optionalDigest(record, "assistantTurnBaselineDigest");
  const configurationReceiptDigest = optionalDigest(record, "configurationReceiptDigest");
  const newTargetAnchorDigest = optionalDigest(record, "newTargetAnchorDigest");
  const blankTaskEvidenceDigest = optionalDigest(record, "blankTaskEvidenceDigest");
  const targetEstablishmentValue = optionalDataProperty(record, "targetEstablishment");
  const targetEstablishment = targetEstablishmentValue === undefined
    ? undefined
    : normalizeTargetEstablishment(targetEstablishmentValue);
  if (
    (coordinationScope !== "process" && coordinationScope !== "provider")
    || (targetLifecycle !== "fixed" && targetLifecycle !== "new_pending" && targetLifecycle !== "new_established")
    || (coordinationScope === "provider"
      && (tabClaimEvidenceDigest === undefined || evidenceProfile.authoritativeTabClaim !== "required"))
  ) {
    throw new OperationClientError("invalid_operation_state", "The authenticated target binding is invalid.");
  }
  validateTargetLifecycle(
    targetLifecycle as "fixed" | "new_pending" | "new_established",
    evidenceProfile,
    canonicalThreadUrl,
    conversationId,
    newTargetAnchorDigest,
    blankTaskEvidenceDigest,
    targetEstablishment
  );
  return Object.freeze({
    providerId,
    browserId,
    tabId,
    coordinationScope,
    ...(tabClaimEvidenceDigest === undefined ? {} : { tabClaimEvidenceDigest }),
    ...(canonicalThreadUrl === undefined ? {} : { canonicalThreadUrl }),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(userTurnBaselineDigest === undefined ? {} : { userTurnBaselineDigest }),
    ...(assistantTurnBaselineDigest === undefined ? {} : { assistantTurnBaselineDigest }),
    ...(configurationReceiptDigest === undefined ? {} : { configurationReceiptDigest }),
    evidenceProfile,
    ...(targetLifecycle === "fixed" ? {} : { targetLifecycle }),
    ...(newTargetAnchorDigest === undefined ? {} : { newTargetAnchorDigest }),
    ...(blankTaskEvidenceDigest === undefined ? {} : { blankTaskEvidenceDigest }),
    ...(targetEstablishment === undefined ? {} : { targetEstablishment })
  });
}

function validateTargetLifecycle(
  lifecycle: "fixed" | "new_pending" | "new_established",
  evidenceProfile: OperationTargetBindingV1["evidenceProfile"],
  canonicalThreadUrl: string | undefined,
  conversationId: string | undefined,
  newTargetAnchorDigest: string | undefined,
  blankTaskEvidenceDigest: string | undefined,
  targetEstablishment: NonNullable<OperationTargetBindingV1["targetEstablishment"]> | undefined
): void {
  if (lifecycle === "fixed") {
    if (newTargetAnchorDigest !== undefined || blankTaskEvidenceDigest !== undefined || targetEstablishment !== undefined) {
      throw new OperationClientError("invalid_operation_state", "A fixed target contains new-target establishment fields.");
    }
    return;
  }
  if (newTargetAnchorDigest === undefined || blankTaskEvidenceDigest === undefined) {
    throw new OperationClientError("invalid_operation_state", "A new target is missing its immutable anchor evidence.");
  }
  if (lifecycle === "new_pending") {
    if (canonicalThreadUrl !== undefined || conversationId !== undefined || targetEstablishment !== undefined) {
      throw new OperationClientError("invalid_operation_state", "A pending new target contains provider identity too early.");
    }
    if (evidenceProfile.stableConversationId !== "unavailable" || evidenceProfile.stableUserTurnId !== "unavailable") {
      throw new OperationClientError("invalid_operation_state", "A pending new target advertises provider identity too early.");
    }
    return;
  }
  if (
    canonicalThreadUrl === undefined
    || conversationId === undefined
    || targetEstablishment === undefined
    || evidenceProfile.stableConversationId !== "required"
    || evidenceProfile.stableUserTurnId !== "required"
  ) {
    throw new OperationClientError("invalid_operation_state", "An established new target is missing provider identity evidence.");
  }
  if (
    targetEstablishment.conversationId !== conversationId
    || targetEstablishment.canonicalThreadUrl !== canonicalThreadUrl
    || targetEstablishment.anchorDigest !== newTargetAnchorDigest
  ) {
    throw new OperationClientError("invalid_operation_state", "New-target establishment identity does not match its durable binding.");
  }
}

function normalizeEvidenceProfile(value: unknown): OperationTargetBindingV1["evidenceProfile"] {
  const record = requiredObject(value, "target evidence profile");
  const providerIdentity = requiredString(record, "providerIdentity");
  const stableTabId = requiredString(record, "stableTabId");
  const stableConversationId = requiredString(record, "stableConversationId");
  const stableUserTurnId = requiredString(record, "stableUserTurnId");
  const authoritativeTabClaim = requiredString(record, "authoritativeTabClaim");
  const replacementTabRecovery = requiredBoolean(record, "replacementTabRecovery");
  if (
    !isAvailability(providerIdentity)
    || !isAvailability(stableTabId)
    || !isAvailability(stableConversationId)
    || !isAvailability(stableUserTurnId)
    || !isAvailability(authoritativeTabClaim)
  ) {
    throw new OperationClientError("invalid_operation_state", "The authenticated target evidence profile is invalid.");
  }
  return Object.freeze({
    providerIdentity: providerIdentity as OperationTargetBindingV1["evidenceProfile"]["providerIdentity"],
    stableTabId: stableTabId as OperationTargetBindingV1["evidenceProfile"]["stableTabId"],
    stableConversationId: stableConversationId as OperationTargetBindingV1["evidenceProfile"]["stableConversationId"],
    stableUserTurnId: stableUserTurnId as OperationTargetBindingV1["evidenceProfile"]["stableUserTurnId"],
    authoritativeTabClaim: authoritativeTabClaim as OperationTargetBindingV1["evidenceProfile"]["authoritativeTabClaim"],
    replacementTabRecovery
  });
}

function normalizeTargetEstablishment(value: unknown): NonNullable<OperationTargetBindingV1["targetEstablishment"]> {
  const record = requiredObject(value, "target establishment");
  const targetBindingDigest = requiredDigest(record, "targetBindingDigest");
  const anchorDigest = requiredDigest(record, "anchorDigest");
  const causalSendActionId = requiredBoundedString(record, "causalSendActionId");
  const conversationId = requiredBoundedString(record, "conversationId");
  const canonicalThreadUrl = requiredBoundedString(record, "canonicalThreadUrl");
  const userTurnId = requiredBoundedString(record, "userTurnId");
  const userTurnEvidenceDigest = requiredDigest(record, "userTurnEvidenceDigest");
  const evidenceDigest = requiredDigest(record, "evidenceDigest");
  const observedAt = requiredBoundedString(record, "observedAt");
  return Object.freeze({
    targetBindingDigest,
    anchorDigest,
    causalSendActionId,
    conversationId,
    canonicalThreadUrl,
    userTurnId,
    userTurnEvidenceDigest,
    evidenceDigest,
    observedAt
  });
}

function makeFactoryContext(
  handle: OperationHandleV1,
  state: OperationAdapterDurableState,
  target: OperationTargetBindingV1
): OperationHandleAdapterFactoryContext {
  const context = { ...handle } as OperationHandleAdapterFactoryContext;
  Object.defineProperties(context, {
    handle: { value: handle, enumerable: false, writable: false, configurable: false },
    state: { value: state, enumerable: false, writable: false, configurable: false },
    target: { value: target, enumerable: false, writable: false, configurable: false }
  });
  return Object.freeze(context);
}

function makeControlFactoryContext(
  request: OperationControlRequestV1,
  reconstruction: Reconstruction
): OperationControlAdapterFactoryContext {
  const context = { request } as OperationControlAdapterFactoryContext;
  Object.defineProperties(context, {
    handle: {
      value: reconstruction.context.handle,
      enumerable: false,
      writable: false,
      configurable: false
    },
    state: {
      value: reconstruction.context.state,
      enumerable: false,
      writable: false,
      configurable: false
    },
    target: {
      value: reconstruction.context.target,
      enumerable: false,
      writable: false,
      configurable: false
    },
    durable: {
      value: reconstruction.context,
      enumerable: false,
      writable: false,
      configurable: false
    }
  });
  return Object.freeze(context);
}

function unavailableAdapter(code: "adapter_unavailable"): OperationBrowserAdapter {
  const unavailable = async (): Promise<never> => {
    throw Object.freeze({ code });
  };
  return Object.freeze({
    resolveTarget: unavailable as OperationBrowserAdapter["resolveTarget"],
    submission: Object.freeze({
      observeStaging: unavailable,
      executeFileHandoffOnce: unavailable,
      observeAttachments: unavailable,
      prepareSend: unavailable,
      executePreparedSend: unavailable,
      verifyPreparedSend: unavailable,
      recoverSend: unavailable,
      executeFinalTabTransaction: unavailable
    }) as OperationBrowserAdapter["submission"],
    collector: Object.freeze({
      readContext: unavailable,
      observe: unavailable,
      sleep: unavailable
    }) as OperationBrowserAdapter["collector"]
  });
}

function readRequestedFiles(request: OperationSubmitRequestV1): readonly { path: string; displayName?: string }[] {
  if (request.files === undefined) return [];
  if (!Array.isArray(request.files)) {
    throw new OperationClientError("invalid_operation_request", "Operation request files must be an array.");
  }
  return request.files as readonly { path: string; displayName?: string }[];
}

function sanitizeServiceRequest(
  request: OperationSubmitRequestV1,
  identities: readonly OperationFileIdentity[]
): OperationSubmitRequestV1 {
  const copy = cloneFrozen(request, "invalid_operation_request", false) as OperationSubmitRequestV1 & {
    files?: Array<{ path: string; displayName?: string }>;
    capture?: OperationSubmitRequestV1["capture"];
  };

  if (request.files !== undefined) {
    copy.files = identities.map((identity, index) => ({
      path: `${SAFE_INPUT_PATH_PREFIX}${index + 1}`,
      displayName: identity.manifest.displayName
    }));
  }
  if (request.capture !== undefined && request.capture.outputDirectory !== undefined) {
    copy.capture = {
      ...request.capture,
      outputDirectory: SAFE_OUTPUT_PATH
    };
  }
  return freezeDeep(copy);
}

function freezeIdentity(identity: OperationFileIdentity): OperationFileIdentity {
  const snapshot = cloneDataGraph(identity, "invalid_file_identity", false) as OperationFileIdentity;
  if (snapshot === null || typeof snapshot !== "object" || snapshot.manifest === undefined || snapshot.proof === undefined) {
    throw new OperationClientError("invalid_file_identity", "The operation file identity is invalid.");
  }
  return freezeDeep({
    sourcePath: snapshot.sourcePath,
    manifest: { ...snapshot.manifest },
    proof: { ...snapshot.proof }
  });
}

function forwardSubmitOptions(
  options: OperationClientSubmitOptions,
  signal: AbortSignal
): OperationSubmitOptions {
  return Object.freeze({
    signal,
    ...(options.deadlineAt === undefined ? {} : { deadlineAt: options.deadlineAt })
  });
}

function forwardCollectorOptions(options: OperationClientCollectOptions): CollectorOptions {
  const forwarded: CollectorOptions = {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.wait === undefined ? {} : { wait: options.wait }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.responseContent === undefined ? {} : { responseContent: options.responseContent }),
    ...(options.responseFormat === undefined ? {} : { responseFormat: options.responseFormat }),
    ...(options.now === undefined ? {} : { now: options.now })
  };
  return Object.freeze(forwarded);
}

function forwardControlOptions(options: OperationClientControlOptions): ControlOptions {
  return Object.freeze({
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.deadlineAt === undefined ? {} : { deadlineAt: options.deadlineAt }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

function forwardRunOptions(options: OperationClientRunOptions, signal: AbortSignal): OperationSubmitOptions & CollectorOptions {
  const forwarded: OperationSubmitOptions & CollectorOptions = {
    signal,
    ...(options.deadlineAt === undefined ? {} : { deadlineAt: options.deadlineAt }),
    ...(options.wait === undefined ? {} : { wait: options.wait }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.responseContent === undefined ? {} : { responseContent: options.responseContent }),
    ...(options.responseFormat === undefined ? {} : { responseFormat: options.responseFormat }),
    ...(options.now === undefined ? {} : { now: options.now })
  };
  return Object.freeze(forwarded);
}

function adapterKey(operationId: string, requestDigest: string): string {
  return `${operationId}\0${requestDigest}`;
}

function validateMaxCachedAdapters(value: number | undefined): number {
  const result = value ?? DEFAULT_MAX_CACHED_ADAPTERS;
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_CACHED_ADAPTERS) {
    throw new OperationClientError(
      "invalid_adapter_cache_size",
      `maxCachedAdapters must be a positive integer no greater than ${MAX_CACHED_ADAPTERS}.`
    );
  }
  return result;
}

function isTerminalSubmitResult(result: OperationSubmitResult): boolean {
  return result.submission.kind === "completed_receipt";
}

function isTerminalRunResult(result: OperationRunResult): boolean {
  return result.submit.submission.kind === "completed_receipt"
    || result.collect?.kind === "completed";
}

function assertAbortSignal(value: unknown): asserts value is AbortSignal {
  if (value === null || typeof value !== "object" || typeof AbortSignal !== "function") {
    throw new OperationClientError("invalid_signal", "Operation signal must be an AbortSignal.");
  }
  const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  if (abortedGetter === undefined) {
    throw new OperationClientError("invalid_signal", "Operation signal must be an AbortSignal.");
  }
  try {
    if (typeof Reflect.apply(abortedGetter, value, []) !== "boolean") throw new Error("invalid");
  } catch {
    throw new OperationClientError("invalid_signal", "Operation signal must be an AbortSignal.");
  }
}

function fileBoundaryError(error: unknown): OperationClientError {
  let candidate = "operation_file_identity_failed";
  if (error !== null && typeof error === "object") {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(error, "code");
      if (descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string") {
        candidate = descriptor.value;
      }
    } catch {
      // Treat proxies and accessors as untrusted provider input.
    }
  }
  const code = /^[a-z][a-z0-9_]{0,63}$/.test(candidate)
    ? candidate
    : "operation_file_identity_failed";
  return new OperationClientError(code, "The operation input file could not be established or revalidated safely.");
}

function cloneFrozen<T>(value: T, code: string, freeze = true): T {
  if (value === null || typeof value !== "object") {
    throw new OperationClientError(code, "The operation input is invalid.");
  }
  const clone = cloneDataGraph(value, code, false) as T;
  return freeze ? freezeDeep(clone) : clone;
}

function freezeDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(object);
  } catch {
    throw new OperationClientError("invalid_operation_input", "The operation input could not be frozen safely.");
  }
  for (const descriptor of Object.values(descriptors)) {
    if ("value" in descriptor) freezeDeep(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function freshResult<T>(value: T): T {
  return cloneDataGraph(value, "result_clone_failed", false) as T;
}

/**
 * Bounded descriptor-only clone used at all untrusted facade boundaries.
 * `structuredClone` is unsuitable here because it invokes enumerable
 * getters. Unknown future fields are preserved for ordinary results, but any
 * accessor, function, symbol, exotic object, cycle, or oversized graph fails
 * closed with a static client error.
 */
function cloneDataGraph<T>(value: T, code: string, _freeze: boolean, depth = 0, seen = new WeakSet<object>(), budget = { nodes: 0 }): T {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol") {
      throw new OperationClientError(code, "The operation data could not be copied safely.");
    }
    return value;
  }
  if (depth > MAX_SAFE_DATA_DEPTH || budget.nodes >= MAX_SAFE_DATA_NODES) {
    throw new OperationClientError(code, "The operation data exceeds its safety bound.");
  }
  const object = value as object;
  if (seen.has(object)) {
    throw new OperationClientError(code, "The operation data contains a cycle.");
  }
  seen.add(object);
  budget.nodes += 1;
  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(object);
    descriptors = Object.getOwnPropertyDescriptors(object);
  } catch {
    throw new OperationClientError(code, "The operation data could not be copied safely.");
  }
  if (!Array.isArray(object) && !isPlainDataPrototype(prototype)) {
    throw new OperationClientError(code, "The operation data contains an unsupported object.");
  }
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) {
    throw new OperationClientError(code, "The operation data contains an unsupported symbol property.");
  }

  if (Array.isArray(object)) {
    const lengthDescriptor = descriptors.length;
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number") {
      throw new OperationClientError(code, "The operation data contains an invalid array.");
    }
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_SAFE_DATA_NODES) {
      throw new OperationClientError(code, "The operation data contains an oversized array.");
    }
    const clone: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new OperationClientError(code, "The operation data contains an unsafe array entry.");
      }
      clone.push(cloneDataGraph(descriptor.value, code, false, depth + 1, seen, budget));
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "length" || /^\d+$/u.test(key)) continue;
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new OperationClientError(code, "The operation data contains an unsafe property.");
      }
      Object.defineProperty(clone, key, {
        value: cloneDataGraph(descriptor.value, code, false, depth + 1, seen, budget),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    seen.delete(object);
    return clone as T;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) continue;
    if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new OperationClientError(code, "The operation data contains an unsafe property.");
    }
    Object.defineProperty(clone, key, {
      value: cloneDataGraph(descriptor.value, code, false, depth + 1, seen, budget),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  seen.delete(object);
  return clone as T;
}

/**
 * Recognize ordinary records from another JavaScript realm without trusting
 * constructors, `Symbol.toStringTag`, or inherited accessors. A realm's
 * intrinsic `Object.prototype` is itself a direct child of `null`; custom
 * class instances have at least one additional prototype layer. The clone
 * remains descriptor-only and always discards the source prototype.
 */
function isPlainDataPrototype(prototype: object | null): boolean {
  if (prototype === null || prototype === Object.prototype) return true;
  try {
    return Object.getPrototypeOf(prototype) === null;
  } catch {
    return false;
  }
}

function isDigest(value: string): boolean {
  return DIGEST_PATTERN.test(value);
}

function isOperationSurface(value: string): value is OperationHandleV1["surface"] {
  return value === "chat" || value === "work";
}

function isOperationPhase(value: string): value is OperationHandleV1["phase"] {
  return value === "prepared"
    || value === "handoff_pending"
    || value === "ready"
    || value === "send_pending"
    || value === "submitted"
    || value === "generating"
    || value === "capturing"
    || value === "completed"
    || value === "uncertain";
}

function isMutationBoundary(value: string): value is OperationHandleV1["mutationBoundary"] {
  return value === "none"
    || value === "handoff_may_have_occurred"
    || value === "send_may_have_occurred"
    || value === "control_may_have_occurred";
}

function isAvailability(value: string): boolean {
  return value === "required" || value === "unavailable";
}

const MAX_SAFE_DATA_DEPTH = 24;
const MAX_SAFE_DATA_NODES = 4096;
const DIGEST_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/u;

function requiredObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationClientError("invalid_operation_state", `The ${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function requiredData(record: Record<string, unknown>, key: string): unknown {
  const value = optionalDataProperty(record, key);
  if (value === undefined) {
    throw new OperationClientError("invalid_operation_state", "The authenticated operation data is incomplete.");
  }
  return value;
}

/** Read only an own data property; accessor descriptors are never invoked. */
function optionalDataProperty(record: object, key: string): unknown | undefined {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new OperationClientError("invalid_operation_state", "The operation data could not be read safely.");
  }
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
    throw new OperationClientError("invalid_operation_state", "The operation data contains an unsafe property.");
  }
  return descriptor.value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = requiredData(record, key);
  if (typeof value !== "string") {
    throw new OperationClientError("invalid_operation_state", "The operation data contains an invalid value.");
  }
  return value;
}

function requiredBoundedString(record: Record<string, unknown>, key: string): string {
  const value = requiredString(record, key);
  if (value.length === 0 || value.length > 4096) {
    throw new OperationClientError("invalid_operation_state", "The operation data contains an unbounded value.");
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = optionalDataProperty(record, key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new OperationClientError("invalid_operation_state", "The operation data contains an invalid value.");
  }
  return value;
}

function optionalBoundedString(record: Record<string, unknown>, key: string): string | undefined {
  const value = optionalString(record, key);
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > 4096) {
    throw new OperationClientError("invalid_operation_state", "The operation data contains an unbounded value.");
  }
  return value;
}

function requiredSafeInteger(record: Record<string, unknown>, key: string): number {
  const value = requiredData(record, key);
  if (!Number.isSafeInteger(value)) {
    throw new OperationClientError("invalid_operation_state", "The operation data contains an invalid revision.");
  }
  return value as number;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = requiredData(record, key);
  if (typeof value !== "boolean") {
    throw new OperationClientError("invalid_operation_state", "The operation data contains an invalid flag.");
  }
  return value;
}

function requiredDigest(record: Record<string, unknown>, key: string): string {
  const value = requiredString(record, key);
  if (!isDigest(value)) {
    throw new OperationClientError("invalid_operation_state", "The operation data contains an invalid digest.");
  }
  return value;
}

function optionalDigest(record: Record<string, unknown>, key: string): string | undefined {
  const value = optionalString(record, key);
  if (value === undefined) return undefined;
  if (!isDigest(value)) {
    throw new OperationClientError("invalid_operation_state", "The operation data contains an invalid digest.");
  }
  return value;
}

function requiredMethod<T extends (...args: never[]) => unknown>(record: object, key: string): T {
  const value = optionalDataProperty(record, key);
  if (typeof value !== "function") {
    throw new OperationClientError("adapter_unavailable", "The operation browser adapter is incomplete.");
  }
  // Bind the captured function to the exact validated owner.  The returned
  // callable no longer consults a mutable property or depends on the caller's
  // `this`, while the descriptor-only read above keeps accessors/proxies out
  // of the validation path.
  return Reflect.apply(Function.prototype.bind, value, [record]) as T;
}

/** Read and bind an optional method using the same accessor-free boundary. */
function optionalMethod<T extends (...args: never[]) => unknown>(record: object, key: string): T | undefined {
  const value = optionalDataProperty(record, key);
  if (value === undefined) return undefined;
  if (typeof value !== "function") {
    throw new OperationClientError("adapter_unavailable", "The operation browser adapter contains an invalid optional method.");
  }
  return Reflect.apply(Function.prototype.bind, value, [record]) as T;
}

function requiredAdapterObject(record: unknown, key: string): Record<string, unknown> {
  if (record === null || typeof record !== "object") {
    throw new OperationClientError("adapter_unavailable", "The operation browser adapter is incomplete.");
  }
  const value = optionalDataProperty(record, key);
  if (value === undefined) {
    throw new OperationClientError("adapter_unavailable", "The operation browser adapter is incomplete.");
  }
  return adapterObject(value);
}

function adapterObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationClientError("adapter_unavailable", "The operation browser adapter is incomplete.");
  }
  return value as Record<string, unknown>;
}
