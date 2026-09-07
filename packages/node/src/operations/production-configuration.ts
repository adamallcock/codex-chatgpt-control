import { createHash } from "node:crypto";
import type { LocatorLike, PageLike } from "../types.js";
import { localeLabels } from "../dom/locale-labels.js";
import { normalizeForLabelMatch, visibleLabelMatches } from "../dom/label-match.js";
import {
  discoverPowerSlider,
  observedPowerSlider,
  resolvePowerTarget,
  type PowerDiscoveryResult
} from "../commands/power-discovery.js";
import type { BrowserObservationDigest } from "./browser-observation.js";
import type { OperationBrowserStagingPrimitive } from "./browser-adapter.js";
import type {
  OperationConfigurationRequestV1,
  OperationTargetBindingV1
} from "./types.js";
import type {
  OperationStagingCallbackRequest,
  OperationStagingKind,
  OperationStagingMutationResult,
  OperationStagingObservation
} from "./staging.js";
import { readTransactionalChatPower, transactionalPowerTrigger, transactionalPowerMenu, transactionalPowerSlider, preflightTransactionalPowerSlider, preflightTransactionalPowerTrigger, type TransactionalChatPower } from "./transactional-chat-power.js";
import { isPlainDataRecord } from "../runtime/value-boundaries.js";
import { configurationPowerValues } from "./configuration-routing.js";

/**
 * Provider-specific staging for the reversible configuration surfaces.
 *
 * The caller's configuration is copied into a request-scoped closure.  It is
 * never put into a callback result, an exception, a locator diagnostic, or a
 * digest material object.  The public staging protocol only carries keyed
 * state/evidence digests and stable blocker codes.
 */

const DIGEST_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,512}$/u;
const MAX_CONFIGURATION_FIELDS = 8;
const MAX_DOM_CONTROLS = 256;
const MAX_CONTROL_LABEL_LENGTH = 512;
const MAX_CACHED_ACTIONS = 32;
const MAX_POWER_STEPS = 32;
const MAX_CURRENT_LABEL_POWER_STEPS = 64;

export type ProductionConfigurationSurface = "chat" | "work";

export type ProductionConfigurationPrimitiveOptions = Readonly<{
  evidenceDigest: BrowserObservationDigest;
  operationId: string;
  requestDigest: string;
  surface: ProductionConfigurationSurface;
  configuration?: Readonly<OperationConfigurationRequestV1>;
}>;

export type ProductionConfigurationBlockerCode =
  | "operation_cancelled"
  | "operation_timeout"
  | "staging_request_mismatch"
  | "staging_observation_required"
  | "staging_mutation_already_attempted"
  | "staging_mutation_unreconciled"
  | "configuration_not_configured"
  | "configuration_surface_unavailable"
  | "configuration_surface_unsupported"
  | "configuration_control_ambiguous"
  | "configuration_option_unavailable"
  | "configuration_state_drift"
  | "configuration_observation_limit_exceeded"
  | "tool_not_configured"
  | "tool_surface_unavailable"
  | "tool_surface_unsupported"
  | "tool_selection_ambiguous"
  | "tool_option_unavailable"
  | "tool_state_unavailable"
  | "tool_state_drift"
  | "power_not_configured"
  | "power_surface_unavailable"
  | "power_surface_unsupported"
  | "power_mapping_incomplete"
  | "power_state_drift"
  | "power_restoration_required"
  | "power_control_unavailable"
  | "configuration_evidence_failed";

/**
 * A serializable probe result is exported so provider adapters and unit tests
 * can use deterministic fake pages without weakening the production path.
 * Labels remain internal to the primitive after this boundary and are never
 * returned by a staging callback.
 */
export type ProductionConfigurationDomControl = Readonly<{
  label: string;
  role?: string;
  testId?: string;
  id?: string;
  menuKey?: string;
  menuLabel?: string;
  selected?: boolean;
  visible?: boolean;
}>;

export type ProductionConfigurationDomSnapshot = Readonly<{
  surface: ProductionConfigurationSurface | "unknown";
  controls: readonly ProductionConfigurationDomControl[];
  truncated?: boolean;
}>;

export class ProductionConfigurationPrimitiveError extends Error {
  readonly code: ProductionConfigurationBlockerCode;

  constructor(code: ProductionConfigurationBlockerCode) {
    super("The provider configuration control could not prove the requested set-to-value action safely.");
    this.name = "ProductionConfigurationPrimitiveError";
    this.code = code;
  }
}

type PrimitiveRequest = Readonly<{
  callback: OperationStagingCallbackRequest & {
    page: Readonly<PageLike>;
    target: OperationTargetBindingV1;
  };
  key: string;
}>;

type Control = {
  label: string;
  normalized: string;
  role: string;
  testId?: string;
  id?: string;
  menuKey?: string;
  menuLabel?: string;
  selected: boolean;
  visible: boolean;
  index: number;
};

type Snapshot = Readonly<{
  surface: ProductionConfigurationSurface | "unknown";
  controls: readonly Control[];
  signature: string;
  opaqueSignature: string;
}>;

type CachedObservation = Readonly<{
  kind: OperationStagingKind;
  snapshot?: Snapshot;
  power?: Extract<PowerDiscoveryResult, { ok: true }>;
  powerSignature?: string;
  chatPower?: TransactionalChatPower;
  chatExperience?: TransactionalChatPower;
  status: OperationStagingObservation["status"];
}>;

type PrimitiveState = {
  observations: Map<string, CachedObservation>;
  attempted: Set<string>;
  restoredPower: Map<string, string>;
};

type StagingRequest = PrimitiveRequest["callback"];
type CapturedOptions = Readonly<{
  evidenceDigest: BrowserObservationDigest;
  operationId: string;
  requestDigest: string;
  surface: ProductionConfigurationSurface;
  configuration?: Readonly<OperationConfigurationRequestV1>;
}>;

type RawProductionConfigurationOptions = Readonly<{
  evidenceDigest: unknown;
  operationId: unknown;
  requestDigest: unknown;
  surface: unknown;
  configuration: unknown;
}>;

type RequestedValue = Readonly<{
  key: string;
  value: string;
  axes: readonly string[];
}>;

/** Create one request-scoped production configuration staging primitive. */
export function createProductionConfigurationStaging(
  options: ProductionConfigurationPrimitiveOptions
): OperationBrowserStagingPrimitive {
  let captured: CapturedOptions;
  try {
    // Snapshot the provider options once, before validating or cloning any
    // nested data.  In particular, do not validate one read of a mutable
    // options object and then capture a later read: a proxy/accessor must not
    // be able to redirect the request after construction.
    const raw = snapshotProductionOptions(options);
    const configuration = copyConfiguration(raw.configuration);
    validateOptions(raw, configuration);
    captured = Object.freeze({
      evidenceDigest: raw.evidenceDigest as BrowserObservationDigest,
      operationId: raw.operationId as string,
      requestDigest: raw.requestDigest as string,
      surface: raw.surface as ProductionConfigurationSurface,
      ...(configuration === undefined ? {} : { configuration })
    });
  } catch (error) {
    if (error instanceof ProductionConfigurationPrimitiveError) throw error;
    throw new ProductionConfigurationPrimitiveError("staging_request_mismatch");
  }
  const state: PrimitiveState = {
    observations: new Map(),
    attempted: new Set(),
    restoredPower: new Map()
  };

  const primitive: OperationBrowserStagingPrimitive = Object.freeze({
    readCurrent: request => readCurrent(request, captured, captured.configuration, state),
    observe: request => readCurrent(request, captured, captured.configuration, state),
    mutateOnce: request => mutateOnce(request, captured, captured.configuration, state)
  });
  return primitive;
}

/** Descriptive aliases for provider integrations that call this a primitive. */
export const createProductionConfigurationPrimitive = createProductionConfigurationStaging;
export const createOperationProductionConfigurationStaging = createProductionConfigurationStaging;

async function readCurrent(
  request: StagingRequest,
  options: CapturedOptions,
  configuration: Readonly<OperationConfigurationRequestV1> | undefined,
  state: PrimitiveState
): Promise<OperationStagingObservation> {
  let input: PrimitiveRequest;
  try {
    input = normalizeRequest(request);
  } catch (error) {
    return unavailableObservation(request, errorCode(error, "staging_request_mismatch"));
  }
  if (!await matchesOperation(input.callback, options)) {
    return unavailableObservation(input.callback, "staging_request_mismatch");
  }

  try {
    const result = input.callback.kind === "power_select"
      ? await observePower(input, options, configuration, state)
      : await observeMenuSurface(input, options, configuration, state);
    return result;
  } catch (error) {
    const code = errorCode(error, fallbackUnavailableCode(input.callback.kind));
    return unavailableObservation(input.callback, code);
  }
}

async function mutateOnce(
  request: StagingRequest,
  options: CapturedOptions,
  configuration: Readonly<OperationConfigurationRequestV1> | undefined,
  state: PrimitiveState
): Promise<OperationStagingMutationResult> {
  let input: PrimitiveRequest;
  try {
    input = normalizeRequest(request);
    if (!await matchesOperation(input.callback, options)) {
      throw new ProductionConfigurationPrimitiveError("staging_request_mismatch");
    }
    const { callback, key } = input;
    assertStagingActionActive(callback);
    const previous = state.observations.get(key);
    if (previous === undefined) {
      throw new ProductionConfigurationPrimitiveError("staging_observation_required");
    }
    if (state.attempted.has(key)) {
      throw new ProductionConfigurationPrimitiveError("staging_mutation_already_attempted");
    }

    if (callback.kind === "power_select") {
      return await mutatePower(input, options, configuration, state, previous);
    }
    return await mutateMenuSurface(input, options, configuration, state, previous);
  } catch (error) {
    if (error instanceof ProductionConfigurationPrimitiveError) throw error;
    const kind = inputOrKind(request);
    throw new ProductionConfigurationPrimitiveError(kind === "power_select" ? "power_state_drift" : kind === "tool_set" ? "tool_state_drift" : "configuration_state_drift");
  }
}

function inputOrKind(request: unknown): OperationStagingKind | "unknown" {
  const kind = readOwnDataProperty(request, "kind");
  return kind === "configuration_set" || kind === "tool_set" || kind === "power_select" ? kind : "unknown";
}

async function observeMenuSurface(
  input: PrimitiveRequest,
  options: CapturedOptions,
  configuration: Readonly<OperationConfigurationRequestV1> | undefined,
  state: PrimitiveState
): Promise<OperationStagingObservation> {
  const { callback, key } = input;
  const kind = callback.kind;
  const needed = requestedValues(configuration, kind, options.surface);
  if (needed === undefined) {
    return rememberAndReturn(state, key, {
      kind,
      status: "unavailable"
    }, unavailableObservation(callback, kind === "tool_set" ? "tool_not_configured" : "configuration_not_configured"));
  }

  if (kind === "configuration_set" && options.surface === "chat" && needed.length === 1
    && needed[0]?.key === "experience" && needed[0].value === "chat") {
    const chat = await readTransactionalChatPower(callback.page);
    if (chat !== undefined) {
      const signature = currentLabelPowerSignature(chat);
      const current = await keyedStateDigest(options.evidenceDigest, callback, kind, signature);
      const digest = await safeDigest(options.evidenceDigest, "configuration-staging-observation", {
        operationId: callback.operationId, targetBindingDigest: callback.targetBindingDigest,
        kind, stateFingerprint: signature, status: "satisfied"
      });
      const observation = satisfiedObservation(callback, current, digest);
      return rememberAndReturn(state, key, { kind, chatExperience: chat, status: observation.status }, observation);
    }
  }

  const snapshot = await discoverMenuSnapshot(callback.page, options.surface);
  const stateResult = evaluateMenuState(snapshot, kind, needed, options.surface);
  const currentStateDigest = stateResult.currentStateDigest === undefined
    ? undefined
    : await keyedStateDigest(options.evidenceDigest, callback, kind, stateResult.currentStateDigest);
  const digest = await observationDigest(options.evidenceDigest, callback, snapshot, stateResult.status);
  const observation = stateResult.status === "satisfied"
    ? satisfiedObservation(callback, currentStateDigest, digest)
      : stateResult.status === "not_satisfied"
        ? notSatisfiedObservation(callback, currentStateDigest, digest)
        : unavailableObservation(callback, stateResult.blockerCode, currentStateDigest, digest);
  const afterAttempt = state.attempted.has(key);
  const final = afterAttempt && observation.status !== "satisfied"
    ? uncertainObservation(callback, "staging_mutation_unreconciled", currentStateDigest, digest)
    : observation;
  return rememberAndReturn(state, key, { kind, snapshot, status: final.status }, final);
}

async function observePower(
  input: PrimitiveRequest,
  options: CapturedOptions,
  configuration: Readonly<OperationConfigurationRequestV1> | undefined,
  state: PrimitiveState
): Promise<OperationStagingObservation> {
  const { callback, key } = input;
  const requested = requestedValues(configuration, callback.kind, options.surface);
  if (requested === undefined || requested.length !== 1) {
    return rememberAndReturn(state, key, {
      kind: callback.kind,
      status: "unavailable"
    }, unavailableObservation(callback, "power_not_configured"));
  }
  if (options.surface === "chat") {
    const chatPower = await readTransactionalChatPower(callback.page);
    if (chatPower !== undefined) return observeCurrentLabelPower(input, options, requested[0]!.value, state, chatPower);
    if (state.observations.get(key)?.chatPower !== undefined) {
      return uncertainObservation(callback, "power_restoration_required");
    }
  }
  const discovery = await discoverPowerSlider(callback.page, {
    powerLabels: localeLabels.configurationAxes.power,
    expectedSurface: options.surface
  });
  if (!discovery.ok) {
    const blocker = discovery.reason === "surface_mismatch"
      ? "power_surface_unsupported"
      : discovery.reason === "no_visible_slider" || discovery.reason === "no_semantic_power_slider"
        ? "power_surface_unavailable"
        : discovery.reason === "unsupported_range" || discovery.reason === "invalid_aria_range" || discovery.reason === "missing_menu_relationship"
          ? "power_mapping_incomplete"
          : "power_surface_unavailable";
    if (state.attempted.has(key)) {
      return rememberAndReturn(state, key, { kind: callback.kind, status: "uncertain" }, uncertainObservation(callback, "power_restoration_required"));
    }
    return rememberAndReturn(state, key, { kind: callback.kind, status: "unavailable" }, unavailableObservation(callback, blocker));
  }
  const requestedLabels = valueAliases("power", requested[0]!.value);
  const target = resolvePowerTarget(discovery, requestedLabels);
  const satisfied = target !== undefined && discovery.range.current === target;
  const mappingComplete = target !== undefined || discovery.valueText !== undefined && requestedLabels.some(label => labelsMatch(discovery.valueText!, label));
  if (!mappingComplete) {
    if (state.attempted.has(key)) {
      return rememberAndReturn(state, key, {
        kind: callback.kind,
        power: discovery,
        powerSignature: powerSignature(discovery),
        status: "uncertain"
      }, uncertainObservation(callback, "power_restoration_required"));
    }
    return rememberAndReturn(state, key, {
      kind: callback.kind,
      power: discovery,
      powerSignature: powerSignature(discovery),
      status: "unavailable"
    }, unavailableObservation(callback, "power_mapping_incomplete"));
  }
  const currentDigest = await keyedStateDigest(options.evidenceDigest, callback, "power", powerSignature(discovery));
  const evidence = await safeDigest(options.evidenceDigest, "configuration-staging-observation", {
    operationId: callback.operationId,
    targetBindingDigest: callback.targetBindingDigest,
    kind: callback.kind,
    status: satisfied ? "satisfied" : "not_satisfied",
    current: currentDigest,
    power: powerSignature(discovery)
  });
  const observation = satisfied
    ? satisfiedObservation(callback, currentDigest, evidence)
    : notSatisfiedObservation(callback, currentDigest, evidence);
  const final = state.attempted.has(key) && observation.status !== "satisfied"
    ? uncertainObservation(callback, "power_restoration_required", currentDigest, evidence)
    : observation;
  return rememberAndReturn(state, key, {
    kind: callback.kind,
    power: discovery,
    powerSignature: powerSignature(discovery),
    status: final.status
  }, final);
}

async function mutateMenuSurface(
  input: PrimitiveRequest,
  options: CapturedOptions,
  configuration: Readonly<OperationConfigurationRequestV1> | undefined,
  state: PrimitiveState,
  previous: CachedObservation
): Promise<OperationStagingMutationResult> {
  const { callback, key } = input;
  const needed = requestedValues(configuration, callback.kind, options.surface);
  if (needed === undefined) {
    throw new ProductionConfigurationPrimitiveError(callback.kind === "tool_set" ? "tool_not_configured" : "configuration_not_configured");
  }
  if (previous.chatExperience !== undefined) {
    if (previous.status !== "satisfied") throw new ProductionConfigurationPrimitiveError("configuration_evidence_failed");
    if (await readTransactionalChatPower(callback.page) === undefined) throw new ProductionConfigurationPrimitiveError("configuration_state_drift");
    return { status: "started" };
  }
  const snapshot = await discoverMenuSnapshot(callback.page, options.surface);
  const evaluated = evaluateMenuState(snapshot, callback.kind, needed, options.surface);
  if (evaluated.status === "satisfied") {
    // A concurrent actor/user may have satisfied the value after the last
    // observation.  Do not issue a redundant browser action.
    remember(state, key, { kind: callback.kind, snapshot, status: "satisfied" });
    return { status: "started" };
  }
  if (evaluated.status === "unavailable") {
    throw new ProductionConfigurationPrimitiveError(evaluated.blockerCode);
  }
  if (previous.snapshot === undefined || previous.snapshot.signature !== snapshot.signature) {
    throw new ProductionConfigurationPrimitiveError(callback.kind === "tool_set" ? "tool_state_drift" : "configuration_state_drift");
  }

  for (const requested of needed) {
    const aliases = callback.kind === "tool_set"
      ? toolAliases(requested.value)
      : valueAliases("configuration", requested.value);
    if (findTarget(snapshot, aliases, callback.kind).status === "ambiguous") {
      throw new ProductionConfigurationPrimitiveError(callback.kind === "tool_set"
        ? "tool_selection_ambiguous"
        : "configuration_control_ambiguous");
    }
  }
  const plan = buildMenuPlan(snapshot, callback.kind, needed, options.surface);
  if (plan.length === 0) {
    throw new ProductionConfigurationPrimitiveError(callback.kind === "tool_set" ? "tool_option_unavailable" : "configuration_option_unavailable");
  }
  state.attempted.add(key);
  trimState(state);

  // Every click below is part of this one bounded plan.  Re-discover each
  // distinct set-to-value step because a selection can close/rebuild its
  // menu. Once a click rejects, there is no alternate locator or retry.
  for (const step of plan) {
    const current = await discoverMenuSnapshot(callback.page, options.surface);
    const currentState = evaluateMenuState(current, callback.kind, [step.requested], options.surface);
    if (currentState.status === "satisfied") continue;
    if (currentState.status === "unavailable") {
      throw new ProductionConfigurationPrimitiveError(currentState.blockerCode);
    }
    const aliases = callback.kind === "tool_set"
      ? toolAliases(step.requested.value)
      : valueAliases("configuration", step.requested.value);
    const target = findTarget(current, aliases, callback.kind);
    if (target.status === "ambiguous") {
      throw new ProductionConfigurationPrimitiveError(callback.kind === "tool_set" ? "tool_selection_ambiguous" : "configuration_control_ambiguous");
    }
    if (target.status === "found") {
      await clickControl(callback, target.control);
      continue;
    }
    const opener = findUniqueOpener(current, callback.kind, options.surface);
    if (opener === undefined) {
      throw new ProductionConfigurationPrimitiveError(callback.kind === "tool_set" ? "tool_option_unavailable" : "configuration_option_unavailable");
    }
    await clickControl(callback, opener);
    const afterOpen = await discoverMenuSnapshot(callback.page, options.surface);
    const targetAfterOpen = findTarget(afterOpen, aliases, callback.kind);
    if (targetAfterOpen.status === "ambiguous") {
      throw new ProductionConfigurationPrimitiveError(callback.kind === "tool_set" ? "tool_selection_ambiguous" : "configuration_control_ambiguous");
    }
    if (targetAfterOpen.status !== "found") {
      throw new ProductionConfigurationPrimitiveError(callback.kind === "tool_set" ? "tool_option_unavailable" : "configuration_option_unavailable");
    }
    await clickControl(callback, targetAfterOpen.control);
  }
  return { status: "started" };
}

async function mutatePower(
  input: PrimitiveRequest,
  options: CapturedOptions,
  configuration: Readonly<OperationConfigurationRequestV1> | undefined,
  state: PrimitiveState,
  previous: CachedObservation
): Promise<OperationStagingMutationResult> {
  const { callback, key } = input;
  const requested = requestedValues(configuration, callback.kind, options.surface);
  if (requested === undefined || requested.length !== 1) {
    throw new ProductionConfigurationPrimitiveError("power_not_configured");
  }
  if (previous.chatPower !== undefined) {
    if (previous.status !== "satisfied" && previous.status !== "not_satisfied") throw new ProductionConfigurationPrimitiveError("configuration_evidence_failed");
    return mutateCurrentLabelPower(input, requested[0]!.value, state, previous.chatPower);
  }
  const discovery = await discoverPowerSlider(callback.page, {
    powerLabels: localeLabels.configurationAxes.power,
    expectedSurface: options.surface
  });
  if (!discovery.ok) throw new ProductionConfigurationPrimitiveError("power_surface_unavailable");
  const target = resolvePowerTarget(discovery, valueAliases("power", requested[0]!.value));
  if (target === undefined) throw new ProductionConfigurationPrimitiveError("power_mapping_incomplete");
  if (previous.power === undefined || previous.powerSignature === undefined
    || previous.powerSignature !== powerSignature(discovery)) {
    if (discovery.range.current === target) {
      remember(state, key, { kind: callback.kind, power: discovery, powerSignature: powerSignature(discovery), status: "satisfied" });
      return { status: "started" };
    }
    throw new ProductionConfigurationPrimitiveError("power_state_drift");
  }
  if (discovery.range.current === target) {
    remember(state, key, { kind: callback.kind, power: discovery, powerSignature: powerSignature(discovery), status: "satisfied" });
    return { status: "started" };
  }
  const slider = observedPowerSlider(callback.page, discovery);
  if (slider === undefined || slider.count === undefined || slider.press === undefined || slider.isVisible === undefined) {
    throw new ProductionConfigurationPrimitiveError("power_control_unavailable");
  }
  if (await slider.count().catch(() => 0) !== 1 || !await slider.isVisible().catch(() => false)) {
    throw new ProductionConfigurationPrimitiveError("power_control_unavailable");
  }
  if (slider.evaluate === undefined) throw new ProductionConfigurationPrimitiveError("power_control_unavailable");
  const aria = await slider.evaluate(element => ({
    minimum: element.getAttribute("aria-valuemin"),
    maximum: element.getAttribute("aria-valuemax"),
    current: element.getAttribute("aria-valuenow")
  })).catch(() => undefined);
  if (aria === undefined || Number(aria.minimum) !== discovery.range.minimum
    || Number(aria.maximum) !== discovery.range.maximum || Number(aria.current) !== discovery.range.current) {
    throw new ProductionConfigurationPrimitiveError("power_state_drift");
  }
  const distance = Math.abs(target - discovery.range.current);
  if (!Number.isInteger(distance) || distance < 1 || distance > MAX_POWER_STEPS) {
    throw new ProductionConfigurationPrimitiveError("power_mapping_incomplete");
  }
  state.attempted.add(key);
  trimState(state);
  const direction = target > discovery.range.current ? "ArrowRight" : "ArrowLeft";
  for (let index = 0; index < distance; index += 1) {
    // No wait/poll is permitted while the coordinated tab actor is held.
    assertStagingActionActive(callback);
    await slider.press(direction);
  }
  return { status: "started" };
}

function currentLabelPowerSignature(snapshot: TransactionalChatPower): string {
  return opaqueFingerprint(JSON.stringify({
    trigger: snapshot.triggerId, model: snapshot.modelMarker, label: snapshot.currentLabel,
    presentation: snapshot.presentation,
    range: snapshot.popover?.slider === undefined ? undefined : {
      minimum: snapshot.popover.slider.minimum, maximum: snapshot.popover.slider.maximum, current: snapshot.popover.slider.current
    }
  }));
}

function exactPowerLabel(current: string, requested: string): boolean {
  const desired = normalizeForLabelMatch(requested);
  const actual = normalizeForLabelMatch(current);
  if (desired === actual) return true;
  // Substring alias expansion would turn High into Extra High. Only a proven
  // exact member of one locale group can authorize its translated equivalent.
  return [...Object.values(localeLabels.configurationOptions), ...Object.values(localeLabels.modeOptions)]
    .some(aliases => aliases.some(label => normalizeForLabelMatch(label) === desired)
      && aliases.some(label => normalizeForLabelMatch(label) === actual));
}

async function observeCurrentLabelPower(
  input: PrimitiveRequest, options: CapturedOptions, requested: string, state: PrimitiveState, snapshot: TransactionalChatPower
): Promise<OperationStagingObservation> {
  const { callback, key } = input;
  const satisfied = exactPowerLabel(snapshot.currentLabel, requested);
  const signature = currentLabelPowerSignature(snapshot);
  const current = await keyedStateDigest(options.evidenceDigest, callback, "power", signature);
  const evidence = await safeDigest(options.evidenceDigest, "configuration-staging-observation", {
    operationId: callback.operationId, targetBindingDigest: callback.targetBindingDigest,
    kind: callback.kind, stateFingerprint: signature, status: satisfied ? "satisfied" : "not_satisfied"
  });
  const observation = satisfied ? satisfiedObservation(callback, current, evidence)
    : state.attempted.has(key) && state.restoredPower.get(key) !== signature
      ? uncertainObservation(callback, "power_restoration_required", current, evidence)
      : notSatisfiedObservation(callback, current, evidence);
  return rememberAndReturn(state, key, { kind: callback.kind, chatPower: snapshot, status: observation.status }, observation);
}

function assertStagingActionActive(callback: StagingRequest): void {
  if (callback.signal?.aborted) throw new ProductionConfigurationPrimitiveError("operation_cancelled");
  if (Date.now() >= callback.deadlineAt) throw new ProductionConfigurationPrimitiveError("operation_timeout");
}

async function mutateCurrentLabelPower(
  input: PrimitiveRequest, requested: string, state: PrimitiveState, previous: TransactionalChatPower
): Promise<OperationStagingMutationResult> {
  const { callback, key } = input;
  assertStagingActionActive(callback);
  let current = await readTransactionalChatPower(callback.page);
  if (current === undefined) throw new ProductionConfigurationPrimitiveError("power_surface_unavailable");
  if (exactPowerLabel(current.currentLabel, requested)) return { status: "started" };
  if (currentLabelPowerSignature(current) !== currentLabelPowerSignature(previous)) throw new ProductionConfigurationPrimitiveError("power_state_drift");
  const initial = current;
  state.attempted.add(key);
  state.restoredPower.delete(key);
  trimState(state);
  if (current.presentation === "closed") {
    const trigger = transactionalPowerTrigger(callback.page, current);
    if (trigger?.click === undefined || !await preflightTransactionalPowerTrigger(trigger, current)) throw new ProductionConfigurationPrimitiveError("power_control_unavailable");
    assertStagingActionActive(callback);
    await trigger.click();
    assertStagingActionActive(callback);
    current = await readTransactionalChatPower(callback.page);
    if (current?.presentation !== "simple" || current.triggerId !== initial.triggerId || current.modelMarker !== initial.modelMarker || current.currentLabel !== initial.currentLabel) throw new ProductionConfigurationPrimitiveError("power_state_drift");
  }
  const original = current;
  const range = original.popover?.slider;
  if (range === undefined || 2 * (range.maximum - range.minimum) > MAX_CURRENT_LABEL_POWER_STEPS) throw new ProductionConfigurationPrimitiveError("power_mapping_incomplete");
  const observedLabels = new Map<number, string>([[range.current, original.currentLabel]]);
  let remainingSteps = 2 * (range.maximum - range.minimum);
  const read = async (): Promise<TransactionalChatPower> => {
    const observed = await readTransactionalChatPower(callback.page);
    if (observed?.presentation !== "simple" || observed.popover?.slider === undefined
      || observed.triggerId !== original.triggerId || observed.modelMarker !== original.modelMarker
      || observed.popover.slider.minimum !== range.minimum || observed.popover.slider.maximum !== range.maximum) throw new ProductionConfigurationPrimitiveError("power_state_drift");
    const known = observedLabels.get(observed.popover.slider.current);
    if (known !== undefined && known !== observed.currentLabel) throw new ProductionConfigurationPrimitiveError("power_state_drift");
    return observed;
  };
  const move = async (target: number): Promise<TransactionalChatPower> => {
    let observed = await read();
    while (observed.popover!.slider!.current !== target) {
      assertStagingActionActive(callback);
      if (remainingSteps-- <= 0) throw new ProductionConfigurationPrimitiveError("power_state_drift");
      const slider = transactionalPowerSlider(callback.page, observed);
      if (slider?.press === undefined || !await preflightTransactionalPowerSlider(slider, observed)) throw new ProductionConfigurationPrimitiveError("power_control_unavailable");
      const before = observed.popover!.slider!.current;
      const delta = target > before ? 1 : -1;
      assertStagingActionActive(callback);
      // One key, one exact observation. No sleep/poll while holding the tab actor.
      await slider.press(delta > 0 ? "ArrowRight" : "ArrowLeft");
      assertStagingActionActive(callback);
      observed = await read();
      if (observed.popover!.slider!.current !== before + delta) throw new ProductionConfigurationPrimitiveError("power_state_drift");
      observedLabels.set(observed.popover!.slider!.current, observed.currentLabel);
    }
    return observed;
  };
  let selected: TransactionalChatPower | undefined;
  for (let value = range.minimum; value <= range.maximum; value += 1) {
    const observed = await move(value);
    if (exactPowerLabel(observed.currentLabel, requested)) { selected = observed; break; }
  }
  let final = selected ?? await move(range.current);
  if (selected === undefined && (final.currentLabel !== original.currentLabel || final.popover!.slider!.current !== range.current)) throw new ProductionConfigurationPrimitiveError("power_restoration_required");
  if (initial.presentation === "closed") {
    const menu = transactionalPowerMenu(callback.page, final);
    if (menu?.press === undefined || await menu.count?.() !== 1) throw new ProductionConfigurationPrimitiveError("power_control_unavailable");
    assertStagingActionActive(callback);
    await menu.press("Escape");
    assertStagingActionActive(callback);
    const closed = await readTransactionalChatPower(callback.page);
    if (closed?.presentation !== "closed" || closed.triggerId !== final.triggerId || closed.modelMarker !== final.modelMarker || closed.currentLabel !== final.currentLabel) throw new ProductionConfigurationPrimitiveError("power_state_drift");
    final = closed;
  }
  if (selected === undefined) state.restoredPower.set(key, currentLabelPowerSignature(final));
  return { status: "started" };
}

type MenuPlanStep = Readonly<{
  requested: RequestedValue;
}>;

function buildMenuPlan(
  snapshot: Snapshot,
  kind: OperationStagingKind,
  needed: readonly RequestedValue[],
  surface: ProductionConfigurationSurface
): MenuPlanStep[] {
  const plan: MenuPlanStep[] = [];
  for (const requested of needed) {
    const aliases = kind === "tool_set"
      ? toolAliases(requested.value)
      : valueAliases("configuration", requested.value);
    const target = findTarget(snapshot, aliases, kind);
    if (target.status === "ambiguous") return [];
    if (target.status === "found") {
      plan.push({ requested });
      continue;
    }
    const opener = findUniqueOpener(snapshot, kind, surface);
    if (opener === undefined) return [];
    plan.push({ requested });
  }
  return plan;
}

type TargetResult =
  | Readonly<{ status: "found"; control: Control }>
  | Readonly<{ status: "absent" | "ambiguous" }>;

function findTarget(
  snapshot: Snapshot,
  aliases: readonly string[],
  kind: OperationStagingKind
): TargetResult {
  const allCandidates = snapshot.controls.filter(control => control.visible
    && (kind === "tool_set" ? control.menuKey !== undefined : true)
    && aliases.some(alias => labelsMatch(control.label, alias)));
  const menuCandidates = allCandidates.filter(control => control.menuKey !== undefined);
  const candidates = menuCandidates.length > 0 ? menuCandidates : allCandidates;
  if (candidates.length === 0) return { status: "absent" };
  if (candidates.length !== 1 || candidates[0] === undefined) return { status: "ambiguous" };
  return { status: "found", control: candidates[0] };
}

function findUniqueOpener(
  snapshot: Snapshot,
  kind: OperationStagingKind,
  surface: ProductionConfigurationSurface
): Control | undefined {
  const candidates = snapshot.controls.filter(control => control.visible
    && control.menuKey === undefined
    && (kind === "tool_set"
      // The transactional primitive requires the provider's structural plus
      // control.  Localized visible text alone is not enough to prove that a
      // button opens the tool menu (it may be an attachment or project action).
      ? control.id === "composer-plus-btn" || control.testId === "composer-plus-btn"
      : /model-switcher|model-selector|mode-selector|configuration/i.test(`${control.testId ?? ""} ${control.id ?? ""}`)
        || labelsMatchAny(control.label, surface === "work"
          ? [...localeLabels.configurationOptions.light, ...localeLabels.configurationOptions.medium, ...localeLabels.configurationOptions.high, ...localeLabels.configurationOptions.standard, ...localeLabels.configurationOptions.fast]
          : [...localeLabels.modeLabels, ...localeLabels.configurationOptions.instant, ...localeLabels.configurationOptions.medium, ...localeLabels.configurationOptions.high, ...localeLabels.configurationOptions.extraHigh, ...localeLabels.configurationOptions.pro])));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function evaluateMenuState(
  snapshot: Snapshot,
  kind: OperationStagingKind,
  needed: readonly RequestedValue[],
  surface: ProductionConfigurationSurface
): {
  status: "satisfied" | "not_satisfied" | "unavailable";
  currentStateDigest?: string;
  blockerCode: ProductionConfigurationBlockerCode;
} {
  if (snapshot.surface === "unknown") {
    return { status: "unavailable", blockerCode: kind === "tool_set" ? "tool_surface_unavailable" : "configuration_surface_unavailable" };
  }
  if (snapshot.surface !== surface) {
    return { status: "unavailable", blockerCode: kind === "tool_set" ? "tool_surface_unsupported" : "configuration_surface_unsupported" };
  }
  if (snapshot.controls.length === 0) {
    return { status: "unavailable", blockerCode: kind === "tool_set" ? "tool_surface_unavailable" : "configuration_surface_unavailable" };
  }
  if (needed.length > MAX_CONFIGURATION_FIELDS) {
    return { status: "unavailable", blockerCode: "configuration_observation_limit_exceeded" };
  }
  if (kind === "tool_set") {
    if (needed.length !== 1) return { status: "unavailable", blockerCode: "tool_selection_ambiguous" };
    const selected = snapshot.controls.filter(control => control.visible && control.selected
      && labelsMatchAny(control.label, toolAliases(needed[0]!.value)));
    const selectedTools = snapshot.controls.filter(control => control.visible && control.selected
      && isToolLabel(control.label));
    if (selectedTools.length === 0) {
      return { status: "unavailable", blockerCode: "tool_state_unavailable" };
    }
    const currentStateDigest = opaqueStateDigest(snapshot, selectedTools.map(control => control.label));
    const result: {
      status: "satisfied" | "not_satisfied";
      blockerCode: ProductionConfigurationBlockerCode;
      currentStateDigest?: string;
    } = {
      status: selected.length === 1 && selectedTools.length === 1 ? "satisfied" : "not_satisfied",
      blockerCode: "tool_state_unavailable"
    };
    if (currentStateDigest !== undefined) result.currentStateDigest = currentStateDigest;
    return result;
  }

  const values = new Map<string, string[]>();
  for (const control of snapshot.controls) {
    const axis = axisForControl(control.label);
    if (axis === undefined) continue;
    const value = axisValue(control.label, axis);
    if (value === undefined) continue;
    const current = values.get(axis) ?? [];
    current.push(value);
    values.set(axis, current);
  }
  const selectedValues = snapshot.controls
    .filter(control => control.visible && control.selected)
    .map(control => control.label)
    .filter(label => !isToolLabel(label));
  const unknown = [...needed].some(requested => {
    if (requested.key === "experience") return snapshot.surface === "unknown";
    const axes = axesForDesired(requested.value, requested.axes, configurationForKind(kind));
    const hasAxisValue = axes.some(axis => (values.get(axis)?.length ?? 0) > 0);
    const hasSelectedValue = selectedValues.some(value => labelsMatchAny(value, valueAliases("configuration", requested.value)));
    return axes.length === 0 || (!hasAxisValue && !hasSelectedValue);
  });
  if (unknown) {
    return { status: "unavailable", blockerCode: "configuration_control_ambiguous" };
  }
  const matches = needed.every(requested => {
    if (requested.key === "experience") return snapshot.surface === requested.value;
    const axes = axesForDesired(requested.value, requested.axes, configurationForKind(kind));
    return axes.some(axis => {
      const current = values.get(axis) ?? [];
      return current.length === 1 && labelsMatchAny(current[0]!, valueAliases("configuration", requested.value));
    }) || selectedValues.filter(value => labelsMatchAny(value, valueAliases("configuration", requested.value))).length === 1;
  });
  const currentValues = [...values.entries()].flatMap(([axis, current]) => current.map(value => `${axis}:${value}`));
  const result: {
    status: "satisfied" | "not_satisfied";
    blockerCode: ProductionConfigurationBlockerCode;
    currentStateDigest?: string;
  } = {
    status: matches ? "satisfied" : "not_satisfied",
    blockerCode: "configuration_control_ambiguous"
  };
  const currentStateDigest = opaqueStateDigest(snapshot, currentValues);
  if (currentStateDigest !== undefined) result.currentStateDigest = currentStateDigest;
  return result;
}

function configurationForKind(kind: OperationStagingKind): "configuration" | "tool" {
  return kind === "tool_set" ? "tool" : "configuration";
}

function axesForDesired(desired: string, explicitAxes: readonly string[], _kind: "configuration" | "tool"): string[] {
  if (explicitAxes.length > 0) return [...explicitAxes];
  const normalized = normalizeForLabelMatch(desired);
  if (normalized === "model" || normalized.startsWith("gpt ") || normalized.startsWith("gpt-")) return ["model", "modelVersion"];
  if (normalized === "model version") return ["modelVersion"];
  if (normalized === "reasoning" || normalized === "power") return ["power"];
  if (localeLabels.configurationAxes.intelligence.some(label => labelsMatch(desired, label))
    || localeLabels.configurationAxes.effort.some(label => labelsMatch(desired, label))) return ["intelligence", "effort"];
  if (localeLabels.configurationAxes.speed.some(label => labelsMatch(desired, label))) return ["speed"];
  return ["intelligence", "effort", "speed", "model", "modelVersion"];
}

function requestedValues(
  configuration: Readonly<OperationConfigurationRequestV1> | undefined,
  kind: OperationStagingKind,
  surface: ProductionConfigurationSurface
): readonly RequestedValue[] | undefined {
  if (configuration === undefined) return undefined;
  if (kind === "tool_set") {
    const tools = configuration.tools;
    return tools === undefined ? undefined : tools.map(value => ({ key: "tool", value, axes: [] }));
  }
  if (kind === "power_select") {
    const values = configurationPowerValues(configuration, surface);
    const value = values[0];
    return typeof value !== "string" || values.some(candidate => typeof candidate !== "string" || !exactPowerLabel(candidate, value))
      ? undefined : [{ key: "reasoning", value, axes: ["power"] }];
  }
  const values: RequestedValue[] = [];
  if (configuration.experience !== undefined) values.push({ key: "experience", value: configuration.experience, axes: ["surface"] });
  if (configuration.model !== undefined) values.push({ key: "model", value: configuration.model, axes: ["model"] });
  if (configuration.modelVersion !== undefined) values.push({ key: "modelVersion", value: configuration.modelVersion, axes: ["modelVersion"] });
  if (configuration.mode !== undefined) values.push({ key: "mode", value: configuration.mode, axes: ["intelligence", "effort"] });
  if (configuration.additional !== undefined) {
    const additional = configuration.additional;
    for (const [key, value] of Object.entries(additional)) {
      if (!["intelligence", "effort", "speed"].includes(key) || typeof value !== "string") return undefined;
      if (surface === "chat" && key === "effort") continue;
      values.push({ key, value, axes: [key] });
    }
  }
  return values.length === 0 ? undefined : values;
}

function valueAliases(kind: "configuration" | "tool" | "power", desired: string): readonly string[] {
  const values = new Set<string>([desired]);
  if (kind === "tool") {
    for (const aliases of Object.values(localeLabels.tools)) {
      if (aliases.some(alias => labelsMatch(alias, desired))) aliases.forEach(alias => values.add(alias));
    }
  } else if (kind === "power") {
    for (const aliases of [
      ...Object.values(localeLabels.configurationOptions),
      ...Object.values(localeLabels.modeOptions)
    ]) {
      if (aliases.some(alias => labelsMatch(alias, desired))) aliases.forEach(alias => values.add(alias));
    }
  } else {
    for (const aliases of [
      ...Object.values(localeLabels.configurationOptions),
      ...Object.values(localeLabels.modeOptions)
    ]) {
      if (aliases.some(alias => labelsMatch(alias, desired))) aliases.forEach(alias => values.add(alias));
    }
  }
  // Power discovery deliberately bounds the locale label set. Keep the
  // caller's canonical value first, then the first observed translations; an
  // unbounded locale expansion must never disable a proven selector.
  return [...values].slice(0, 64);
}

function toolAliases(desired: string): readonly string[] {
  const aliases = localeLabels.tools[desired];
  return aliases === undefined ? valueAliases("tool", desired) : [desired, ...aliases];
}

function isToolLabel(label: string): boolean {
  return Object.values(localeLabels.tools).some(aliases => aliases.some(alias => labelsMatch(label, alias)));
}

function axisForControl(label: string): string | undefined {
  for (const [axis, aliases] of Object.entries(localeLabels.configurationAxes)) {
    if (aliases.some(alias => {
      const normalized = normalizeForLabelMatch(label);
      const wanted = normalizeForLabelMatch(alias);
      return normalized === wanted || normalized.startsWith(`${wanted} `);
    })) return axis;
  }
  return undefined;
}

function axisValue(label: string, axis: string): string | undefined {
  const aliases = localeLabels.configurationAxes[axis as keyof typeof localeLabels.configurationAxes] ?? [];
  const normalized = normalizeForLabelMatch(label);
  for (const alias of aliases) {
    const wanted = normalizeForLabelMatch(alias);
    if (normalized === wanted) return undefined;
    if (normalized.startsWith(`${wanted} `)) return label.slice(alias.length).trim();
  }
  return undefined;
}

function labelsMatchAny(label: string, wanted: readonly string[]): boolean {
  return wanted.some(candidate => labelsMatch(label, candidate));
}

function labelsMatch(label: string, wanted: string): boolean {
  const left = normalizeForLabelMatch(label);
  const right = normalizeForLabelMatch(wanted);
  return left === right || visibleLabelMatches(label, wanted);
}

async function discoverMenuSnapshot(page: Readonly<PageLike>, surface: ProductionConfigurationSurface): Promise<Snapshot> {
  if (typeof page.evaluate !== "function") {
    throw new ProductionConfigurationPrimitiveError("configuration_surface_unavailable");
  }
  const value = await page.evaluate<unknown, Readonly<{
    surface: ProductionConfigurationSurface;
    maxControls: number;
    workComposerLabels: string[];
    chatComposerLabels: string[];
    workSurfaceLabels: string[];
    chatSurfaceLabels: string[];
  }>>((config) => {
    const normalize = (input: string): string => input.replace(/\s+/g, " ").trim().slice(0, 512);
    const elementParent = (node: Node): Element | null => {
      const parent: ParentNode | null = node.parentNode;
      return parent?.nodeType === 1 ? parent as Element : null;
    };
    const simpleMatch = (element: Element, rawToken: string): boolean => {
      const checked = rawToken.endsWith(":checked");
      const token = checked ? rawToken.slice(0, -":checked".length) : rawToken;
      let offset = 0;
      const tag = /^[A-Za-z][A-Za-z0-9-]*/u.exec(token);
      if (tag !== null) {
        if (element.tagName.toLocaleLowerCase() !== tag[0].toLocaleLowerCase()) return false;
        offset = tag[0].length;
      }
      while (offset < token.length) {
        if (token[offset] !== "[") return false;
        const close = token.indexOf("]", offset + 1);
        if (close < 0) return false;
        const expression = token.slice(offset + 1, close).trim();
        const attribute = /^([A-Za-z0-9_:-]+)(?:(\*=|=)'([^']*)'(?:\s+(i))?)?$/u.exec(expression);
        if (attribute === null) return false;
        const actual = element.getAttribute(attribute[1]!);
        if (attribute[2] === undefined) {
          if (actual === null) return false;
        } else {
          if (actual === null) return false;
          const insensitive = attribute[4] === "i";
          const left = insensitive ? actual.toLocaleLowerCase() : actual;
          const rightValue = attribute[3] ?? "";
          const right = insensitive ? rightValue.toLocaleLowerCase() : rightValue;
          if (attribute[2] === "=" ? left !== right : !left.includes(right)) return false;
        }
        offset = close + 1;
      }
      if (checked && (element as HTMLInputElement).checked !== true && !element.hasAttribute("checked")) return false;
      return true;
    };
    const selectorTokens = (branch: string): string[] => {
      const tokens: string[] = [];
      let depth = 0;
      let start = 0;
      for (let index = 0; index <= branch.length; index += 1) {
        const character = branch[index];
        if (character === "[") depth += 1;
        if (character === "]") depth -= 1;
        if ((character === undefined || /\s/u.test(character)) && depth === 0) {
          const token = branch.slice(start, index).trim();
          if (token.length > 0) tokens.push(token);
          start = index + 1;
        }
      }
      return tokens;
    };
    const selectorMatch = (element: Element, selector: string): boolean => {
      for (const rawBranch of selector.split(",")) {
        const tokens = selectorTokens(rawBranch.trim());
        if (tokens.length === 0 || !simpleMatch(element, tokens[tokens.length - 1]!)) continue;
        let ancestor: Element | null = elementParent(element);
        let tokenIndex = tokens.length - 2;
        while (tokenIndex >= 0) {
          while (ancestor !== null && !simpleMatch(ancestor, tokens[tokenIndex]!)) {
            ancestor = elementParent(ancestor);
          }
          if (ancestor === null) break;
          tokenIndex -= 1;
          ancestor = elementParent(ancestor);
        }
        if (tokenIndex < 0) return true;
      }
      return false;
    };
    const boundedQuery = <T extends Element>(
      root: Node,
      selector: string,
      maxMatched: number,
      maxVisited = 4096
    ): T[] => {
      const matches: T[] = [];
      let visited = 0;
      let current: Node | null = root.firstChild;
      while (current !== null) {
        visited += 1;
        if (visited > maxVisited) throw new Error("node limit exceeded");
        const element = current.nodeType === 1 ? current as Element : undefined;
        if (element !== undefined && selectorMatch(element, selector)) {
          matches.push(element as T);
          if (matches.length > maxMatched) throw new Error("node limit exceeded");
        }
        if (current.firstChild !== null) {
          current = current.firstChild;
          continue;
        }
        while (current !== null && current !== root && current.nextSibling === null) current = current.parentNode;
        current = current === null || current === root ? null : current.nextSibling;
      }
      return matches;
    };
    const boundedText = (node: Element): string => {
      const chunks: string[] = [];
      const ancestors: Node[] = [];
      let visited = 0;
      let total = 0;
      let current: Node | null = node;
      while (current !== null) {
        visited += 1;
        if (visited > 4096) throw new Error("node limit exceeded");
        if (current.nodeType === 3) {
          const value = current.nodeValue ?? "";
          total += value.length;
          if (total > 512) throw new Error("text limit exceeded");
          if (value.length > 0) chunks.push(value);
        }
        const child: Node | null = current.firstChild;
        if (child !== null) {
          if (ancestors.length >= 4096) throw new Error("node limit exceeded");
          ancestors.push(current);
          current = child;
          continue;
        }
        while (current !== null && current !== node && current.nextSibling === null) {
          current = ancestors.pop() ?? null;
        }
        if (current === node) break;
        if (current !== null) current = current.nextSibling;
      }
      return chunks.join("").replace(/\s+/g, " ").trim().slice(0, 512);
    };
    const visible = (node: Element): boolean => {
      let current: Element | null = node;
      let depth = 0;
      while (current !== null && depth < 4096) {
        const html = current as HTMLElement;
        if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true" || current.hasAttribute("inert")) return false;
        const style = typeof window !== "undefined" ? window.getComputedStyle?.(html) : undefined;
        if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") return false;
        current = elementParent(current);
        depth += 1;
      }
      if (current !== null) throw new Error("node limit exceeded");
      const rect = (node as HTMLElement).getBoundingClientRect?.();
      return rect === undefined || (rect.width > 0 && rect.height > 0);
    };
    const text = (node: Element): string => {
      return normalize(node.getAttribute("aria-label") ?? boundedText(node));
    };
    const surfaceOf = (): ProductionConfigurationSurface | "unknown" => {
      const signals = new Set<ProductionConfigurationSurface>();
      const addMarker = (raw: string): void => {
        const value = normalize(raw).toLocaleLowerCase();
        if (/(?:^|[-_\s/])work(?:$|[-_\s/])/.test(value)) signals.add("work");
        if (/(?:^|[-_\s/])chat(?:$|[-_\s/])/.test(value)) signals.add("chat");
      };
      const addLabel = (raw: string): void => {
        const value = normalize(raw).toLocaleLowerCase();
        if (config.workComposerLabels.some(label => value === normalize(label).toLocaleLowerCase())
          || config.workSurfaceLabels.some(label => value === normalize(label).toLocaleLowerCase())) signals.add("work");
        if (config.chatComposerLabels.some(label => value === normalize(label).toLocaleLowerCase())
          || config.chatSurfaceLabels.some(label => value === normalize(label).toLocaleLowerCase())) signals.add("chat");
      };
      const composerNodes = boundedQuery<HTMLElement>(document,
        "main textarea, main [contenteditable='true'], main [role='textbox']",
        32).filter(visible);
      for (const node of composerNodes) {
        addLabel(normalize(node.getAttribute("aria-label")
          ?? node.getAttribute("placeholder")
          ?? boundedText(node)
          ?? ""));
        // Surface markers are trusted only on the active, visible composer
        // subtree and its bounded ancestors. Global class/id scans can see a
        // hidden Work launcher while Chat is active (or vice versa).
        let current: Element | null = node;
        let depth = 0;
        while (current !== null && depth < 8) {
          for (const attribute of ["data-surface", "data-experience", "data-testid", "id", "class"]) {
            const value = current.getAttribute(attribute);
            if (value !== null) addMarker(value);
          }
          current = elementParent(current);
          depth += 1;
        }
      }
      for (const node of boundedQuery<HTMLElement>(document,
        "[role='radio'][aria-checked='true'], [role='radio'][data-state='checked'], input[type='radio']:checked",
        8).filter(visible)) {
        addLabel(normalize(node.getAttribute("aria-label") ?? boundedText(node)));
      }
      if (typeof window !== "undefined" && typeof window.location?.pathname === "string") {
        addMarker(window.location.pathname);
      }
      return signals.size === 1 ? [...signals][0]! : "unknown";
    };
    const all = boundedQuery<HTMLElement>(document,
      "button, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='option'], [role='radio']",
      config.maxControls);
    const controls: ProductionConfigurationDomControl[] = [];
    const menus = boundedQuery<HTMLElement>(document,
      "[role='menu'], [role='listbox'], [data-radix-popper-content-wrapper], [data-radix-menu-content]",
      config.maxControls);
    const menuIndices = new Map<Element, number>();
    for (let index = 0; index < menus.length; index += 1) menuIndices.set(menus[index]!, index);
    const menuIndex = (node: Element): number => {
      const menuSelector = "[role='menu'], [role='listbox'], [data-radix-popper-content-wrapper], [data-radix-menu-content]";
      let owner: Element | null = node;
      for (let depth = 0; owner !== null && depth < 4096; depth += 1) {
        if (selectorMatch(owner, menuSelector)) return menuIndices.get(owner) ?? -1;
        owner = elementParent(owner);
      }
      if (owner !== null) throw new Error("node limit exceeded");
      return -1;
    };
    for (const node of all) {
      if (!visible(node)) continue;
      const label = text(node);
      if (label.length === 0 || label.length > 512) continue;
      const role = node.getAttribute("role") ?? node.tagName.toLocaleLowerCase();
      const menu = menuIndex(node);
      const selected = node.getAttribute("aria-checked") === "true"
        || node.getAttribute("aria-selected") === "true"
        || node.getAttribute("aria-pressed") === "true"
        || node.getAttribute("data-state") === "checked"
        || node.getAttribute("data-selected") === "true";
      const testId = node.getAttribute("data-testid") ?? undefined;
      const id = node.getAttribute("id") ?? undefined;
      const menuRoot = menu < 0 ? null : menus[menu];
      const menuLabel = menuRoot === null || menuRoot === undefined ? undefined : text(menuRoot);
      controls.push({
        label,
        role,
        ...(testId === undefined ? {} : { testId }),
        ...(id === undefined ? {} : { id }),
        ...(menu < 0 ? {} : { menuKey: `menu:${menu}`, ...(menuLabel === undefined ? {} : { menuLabel }) }),
        ...(selected ? { selected: true } : {})
      });
    }
    return {
      surface: surfaceOf(),
      controls
    } satisfies ProductionConfigurationDomSnapshot;
  }, {
    surface,
    maxControls: MAX_DOM_CONTROLS,
    workComposerLabels: [...localeLabels.workComposerTextbox],
    chatComposerLabels: [...localeLabels.composerTextbox],
    workSurfaceLabels: [...localeLabels.experienceOptions.work],
    chatSurfaceLabels: [...localeLabels.experienceOptions.chat]
  });
  return normalizeSnapshot(value);
}

function normalizeSnapshot(value: unknown): Snapshot {
  const source = snapshotDataRecord(value, "configuration_surface_unavailable");
  if (Object.keys(source).some(key => !["surface", "controls", "truncated"].includes(key))) {
    throw new ProductionConfigurationPrimitiveError("configuration_surface_unavailable");
  }
  const surfaceValue = source.surface;
  if (surfaceValue !== "chat" && surfaceValue !== "work" && surfaceValue !== "unknown") {
    throw new ProductionConfigurationPrimitiveError("configuration_surface_unavailable");
  }
  if (source.truncated !== undefined && typeof source.truncated !== "boolean") {
    throw new ProductionConfigurationPrimitiveError("configuration_surface_unavailable");
  }
  if (source.truncated === true) throw new ProductionConfigurationPrimitiveError("configuration_observation_limit_exceeded");
  const rawControls = snapshotDataArray(source.controls, "configuration_surface_unavailable");
  if (rawControls.length > MAX_DOM_CONTROLS) {
    throw new ProductionConfigurationPrimitiveError("configuration_observation_limit_exceeded");
  }
  const controls: Control[] = [];
  for (let index = 0; index < rawControls.length; index += 1) {
    const raw = snapshotDataRecord(rawControls[index], "configuration_surface_unavailable");
    if (Object.keys(raw).some(key => !["label", "role", "testId", "id", "menuKey", "menuLabel", "selected", "visible"].includes(key))
      || typeof raw.label !== "string" || raw.label.length === 0 || raw.label.length > MAX_CONTROL_LABEL_LENGTH) {
      throw new ProductionConfigurationPrimitiveError("configuration_surface_unavailable");
    }
    const role = raw.role === undefined ? "button" : raw.role;
    if (typeof role !== "string" || role.length > 64) throw new ProductionConfigurationPrimitiveError("configuration_surface_unavailable");
    for (const field of ["testId", "id", "menuKey", "menuLabel"] as const) {
      const fieldValue = raw[field];
      if (fieldValue !== undefined && (typeof fieldValue !== "string" || fieldValue.length === 0 || fieldValue.length > MAX_CONTROL_LABEL_LENGTH)) {
        throw new ProductionConfigurationPrimitiveError("configuration_surface_unavailable");
      }
    }
    if ((raw.selected !== undefined && typeof raw.selected !== "boolean")
      || (raw.visible !== undefined && typeof raw.visible !== "boolean")) {
      throw new ProductionConfigurationPrimitiveError("configuration_surface_unavailable");
    }
    controls.push({
      label: raw.label,
      normalized: normalizeForLabelMatch(raw.label),
      role,
      ...(typeof raw.testId === "string" ? { testId: raw.testId } : {}),
      ...(typeof raw.id === "string" ? { id: raw.id } : {}),
      ...(typeof raw.menuKey === "string" ? { menuKey: raw.menuKey } : {}),
      ...(typeof raw.menuLabel === "string" ? { menuLabel: raw.menuLabel } : {}),
      selected: raw.selected === true,
      visible: raw.visible !== false,
      index
    });
  }
  const signature = controls.map(control => [
    control.index,
    control.role,
    control.testId ?? "",
    control.id ?? "",
    control.menuKey ?? "",
    control.label,
    control.selected ? "1" : "0"
  ].join("\u001f")).join("\u001e");
  return {
    surface: surfaceValue,
    controls: Object.freeze(controls),
    signature: `${surfaceValue}\u001d${signature}`,
    opaqueSignature: opaqueFingerprint(`${surfaceValue}\u001d${signature}`)
  };
}

async function clickControl(callback: StagingRequest, control: Control): Promise<void> {
  const locator = await resolveControlLocator(callback.page, control);
  if (locator === undefined || locator.click === undefined) {
    throw new ProductionConfigurationPrimitiveError("configuration_control_ambiguous");
  }
  assertStagingActionActive(callback);
  await locator.click();
}

async function resolveControlLocator(page: Readonly<PageLike>, control: Control): Promise<LocatorLike | undefined> {
  if (control.testId !== undefined && page.locator !== undefined) {
    const locator = page.locator(`[data-testid="${escapeAttribute(control.testId)}"]`);
    const status = await locatorStatus(locator);
    if (status === "unique") return locator;
    if (status === "ambiguous" || status === "hidden") return undefined;
  }
  if (control.id !== undefined && page.locator !== undefined) {
    const locator = page.locator(`#${escapeAttribute(control.id)}`);
    const status = await locatorStatus(locator);
    if (status === "unique") return locator;
    if (status === "ambiguous" || status === "hidden") return undefined;
  }
  if (page.getByRole !== undefined) {
    const locator = page.getByRole(control.role, { name: control.label, exact: true });
    const status = await locatorStatus(locator);
    if (status === "unique") return locator;
    if (status === "ambiguous" || status === "hidden") return undefined;
  }
  if (page.locator !== undefined) {
    const escaped = escapeRegExp(control.label);
    const locator = page.locator("button, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='option'], [role='radio']")
      .filter?.({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, "i") });
    if (locator !== undefined && await locatorStatus(locator) === "unique") return locator;
  }
  return undefined;
}

type LocatorStatus = "unique" | "absent" | "ambiguous" | "hidden";

async function locatorStatus(locator: LocatorLike): Promise<LocatorStatus> {
  try {
    if (locator.count === undefined) return "absent";
    const count = await locator.count();
    if (count === 0) return "absent";
    if (count !== 1) return "ambiguous";
    return locator.isVisible === undefined || await locator.isVisible() ? "unique" : "hidden";
  } catch {
    return "absent";
  }
}

function rememberAndReturn(
  state: PrimitiveState,
  key: string,
  observation: CachedObservation,
  result: OperationStagingObservation
): OperationStagingObservation {
  remember(state, key, observation);
  return result;
}

function remember(state: PrimitiveState, key: string, observation: CachedObservation): void {
  state.observations.delete(key);
  state.observations.set(key, observation);
  trimState(state);
}

function trimState(state: PrimitiveState): void {
  while (state.observations.size > MAX_CACHED_ACTIONS) {
    const first = state.observations.keys().next().value as string | undefined;
    if (first === undefined) break;
    state.observations.delete(first);
    state.attempted.delete(first);
    state.restoredPower.delete(first);
  }
  while (state.attempted.size > MAX_CACHED_ACTIONS) {
    const first = state.attempted.values().next().value as string | undefined;
    if (first === undefined) break;
    state.attempted.delete(first);
    state.restoredPower.delete(first);
  }
}

function satisfiedObservation(
  request: StagingRequest,
  currentStateDigest?: string,
  evidenceDigest?: string
): OperationStagingObservation {
  if (currentStateDigest === undefined || evidenceDigest === undefined) {
    return {
      status: "uncertain",
      desiredStateDigest: safeDesiredDigest(request),
      blockerCode: "configuration_evidence_failed"
    };
  }
  return {
    status: "satisfied",
    desiredStateDigest: request.desiredStateDigest,
    currentStateDigest,
    evidenceDigest
  };
}

function notSatisfiedObservation(
  request: StagingRequest,
  currentStateDigest?: string,
  evidenceDigest?: string
): OperationStagingObservation {
  if (currentStateDigest === undefined || evidenceDigest === undefined) {
    return {
      status: "uncertain",
      desiredStateDigest: safeDesiredDigest(request),
      blockerCode: "configuration_evidence_failed"
    };
  }
  return {
    status: "not_satisfied",
    desiredStateDigest: request.desiredStateDigest,
    currentStateDigest,
    evidenceDigest
  };
}

function unavailableObservation(
  request: StagingRequest,
  blockerCode: string,
  currentStateDigest?: string,
  evidenceDigest?: string
): OperationStagingObservation {
  return {
    status: "unavailable",
    desiredStateDigest: safeDesiredDigest(request),
    blockerCode: isBlockerCode(blockerCode) ? blockerCode : "configuration_surface_unavailable",
    ...(currentStateDigest === undefined ? {} : { currentStateDigest }),
    ...(evidenceDigest === undefined ? {} : { evidenceDigest })
  };
}

function uncertainObservation(
  request: StagingRequest,
  blockerCode: ProductionConfigurationBlockerCode,
  currentStateDigest?: string,
  evidenceDigest?: string
): OperationStagingObservation {
  return {
    status: "uncertain",
    desiredStateDigest: safeDesiredDigest(request),
    blockerCode,
    ...(currentStateDigest === undefined ? {} : { currentStateDigest }),
    ...(evidenceDigest === undefined ? {} : { evidenceDigest })
  };
}

async function observationDigest(
  evidenceDigest: BrowserObservationDigest,
  request: StagingRequest,
  snapshot: Snapshot | Readonly<Record<string, unknown>>,
  status: string
): Promise<string | undefined> {
  const fingerprint = "opaqueSignature" in snapshot && typeof snapshot.opaqueSignature === "string"
    ? snapshot.opaqueSignature
    : opaqueFingerprint(JSON.stringify(snapshot));
  return safeDigest(evidenceDigest, "configuration-staging-observation", {
    operationId: request.operationId,
    targetBindingDigest: request.targetBindingDigest,
    kind: request.kind,
    status,
    stateFingerprint: fingerprint
  });
}

async function keyedStateDigest(
  evidenceDigest: BrowserObservationDigest,
  request: StagingRequest,
  kind: string,
  fingerprint: string
): Promise<string | undefined> {
  return safeDigest(evidenceDigest, "configuration-staging-state", {
    operationId: request.operationId,
    targetBindingDigest: request.targetBindingDigest,
    kind,
    stateFingerprint: fingerprint
  });
}

function opaqueStateDigest(snapshot: Snapshot, values: readonly string[]): string {
  return `opaque:${opaqueFingerprint(`${snapshot.opaqueSignature}\u001d${values.map(opaqueFingerprint).join("\u001e")}`)}`;
}

function powerSignature(discovery: Extract<PowerDiscoveryResult, { ok: true }>): string {
  const evidence = discovery.evidence;
  const options = discovery.options.map(option => `${opaqueFingerprint(option.label)}:${option.value ?? ""}`).join("\u001e");
  return opaqueFingerprint([
    discovery.sliderIndex,
    discovery.range.minimum,
    discovery.range.maximum,
    discovery.range.current,
    evidence.surface,
    evidence.selectorProfile,
    evidence.relationship,
    options,
    evidence.valueText === undefined ? "" : opaqueFingerprint(evidence.valueText)
  ].join("\u001d"));
}

async function safeDigest(
  evidenceDigest: BrowserObservationDigest,
  domain: string,
  material: unknown
): Promise<string | undefined> {
  try {
    const value = await evidenceDigest(domain, material);
    return typeof value === "string" && DIGEST_PATTERN.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function opaqueFingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeRequest(request: StagingRequest): PrimitiveRequest {
  const source = snapshotDataRecord(request, "staging_request_mismatch");
  const kind = source.kind;
  if (kind !== "configuration_set" && kind !== "tool_set" && kind !== "power_select") {
    throw new ProductionConfigurationPrimitiveError("staging_request_mismatch");
  }
  const operationId = source.operationId;
  const requestDigest = source.requestDigest;
  const targetBindingDigest = source.targetBindingDigest;
  const actionId = source.actionId;
  const desiredStateDigest = source.desiredStateDigest;
  const deadlineAt = source.deadlineAt;
  const page = source.page;
  const target = source.target;
  const signal = source.signal;
  if (typeof operationId !== "string" || !ID_PATTERN.test(operationId)
    || typeof requestDigest !== "string" || !DIGEST_PATTERN.test(requestDigest)
    || typeof targetBindingDigest !== "string" || !DIGEST_PATTERN.test(targetBindingDigest)
    || typeof actionId !== "string" || !ID_PATTERN.test(actionId)
    || typeof desiredStateDigest !== "string" || !DIGEST_PATTERN.test(desiredStateDigest)
    || typeof deadlineAt !== "number" || !Number.isSafeInteger(deadlineAt)
    || page === null || typeof page !== "object"
    || target === null || typeof target !== "object") {
    throw new ProductionConfigurationPrimitiveError("staging_request_mismatch");
  }
  const callback = Object.freeze({
    operationId,
    requestDigest,
    targetBindingDigest,
    actionId,
    kind,
    desiredStateDigest,
    signal: signal as AbortSignal,
    deadlineAt,
    page: page as Readonly<PageLike>,
    target: target as OperationTargetBindingV1
  });
  return {
    callback,
    key: `${operationId}\u001d${actionId}\u001d${kind}`
  };
}

async function matchesOperation(
  request: StagingRequest,
  options: ProductionConfigurationPrimitiveOptions
): Promise<boolean> {
  const expected = await safeDigest(options.evidenceDigest, "staging-desired", {
    requestDigest: request.requestDigest,
    kind: request.kind
  });
  return request.operationId === options.operationId
    && request.requestDigest === options.requestDigest
    && expected !== undefined
    && request.desiredStateDigest === expected;
}

function safeDesiredDigest(request: unknown): string {
  const desiredStateDigest = readOwnDataProperty(request, "desiredStateDigest");
  return typeof desiredStateDigest === "string" && DIGEST_PATTERN.test(desiredStateDigest)
    ? desiredStateDigest
    : "hmac-sha256:" + "0".repeat(64);
}

function fallbackUnavailableCode(kind: OperationStagingKind): ProductionConfigurationBlockerCode {
  return kind === "tool_set"
    ? "tool_surface_unavailable"
    : kind === "power_select"
      ? "power_surface_unavailable"
      : "configuration_surface_unavailable";
}

function errorCode(error: unknown, fallback: string): ProductionConfigurationBlockerCode {
  if (error instanceof ProductionConfigurationPrimitiveError && isBlockerCode(error.code)) return error.code;
  return isBlockerCode(fallback) ? fallback : "configuration_surface_unavailable";
}

function isBlockerCode(value: string): value is ProductionConfigurationBlockerCode {
  return new Set<string>([
    "operation_cancelled", "operation_timeout",
    "staging_request_mismatch", "staging_observation_required", "staging_mutation_already_attempted", "staging_mutation_unreconciled",
    "configuration_not_configured", "configuration_surface_unavailable", "configuration_surface_unsupported", "configuration_control_ambiguous",
    "configuration_option_unavailable", "configuration_state_drift", "configuration_observation_limit_exceeded", "tool_not_configured",
    "tool_surface_unavailable", "tool_surface_unsupported", "tool_selection_ambiguous", "tool_option_unavailable", "tool_state_unavailable",
    "tool_state_drift", "power_not_configured", "power_surface_unavailable", "power_surface_unsupported", "power_mapping_incomplete",
    "power_state_drift", "power_restoration_required", "power_control_unavailable", "configuration_evidence_failed"
  ]).has(value);
}

function validateOptions(
  options: RawProductionConfigurationOptions,
  configuration: Readonly<OperationConfigurationRequestV1> | undefined
): void {
  if (typeof options.evidenceDigest !== "function"
    || typeof options.operationId !== "string" || !ID_PATTERN.test(options.operationId)
    || typeof options.requestDigest !== "string" || !DIGEST_PATTERN.test(options.requestDigest)
    || (options.surface !== "chat" && options.surface !== "work")) {
    throw new ProductionConfigurationPrimitiveError("staging_request_mismatch");
  }
  if (options.configuration !== undefined && configuration === undefined) {
    throw new ProductionConfigurationPrimitiveError("configuration_not_configured");
  }
  if (configuration?.experience !== undefined && configuration.experience !== options.surface) {
    throw new ProductionConfigurationPrimitiveError("configuration_surface_unsupported");
  }
}

function copyConfiguration(
  configuration: unknown
): Readonly<OperationConfigurationRequestV1> | undefined {
  if (configuration === undefined) return undefined;
  const source = snapshotDataRecord(configuration, "configuration_not_configured");
  const allowed = new Set(["experience", "model", "modelVersion", "reasoning", "mode", "tools", "additional"]);
  if (Object.keys(source).some(key => !allowed.has(key))) {
    throw new ProductionConfigurationPrimitiveError("configuration_not_configured");
  }
  const copy: OperationConfigurationRequestV1 = {};
  for (const key of ["model", "modelVersion", "reasoning", "mode"] as const) {
    const value = source[key];
    if (value !== undefined && typeof value !== "string") {
      throw new ProductionConfigurationPrimitiveError("configuration_not_configured");
    }
    if (value !== undefined) copy[key] = value;
  }
  const experience = source.experience;
  if (experience !== undefined) {
    if (experience !== "chat" && experience !== "work") {
      throw new ProductionConfigurationPrimitiveError("configuration_not_configured");
    }
    copy.experience = experience;
  }
  const tools = source.tools;
  if (tools !== undefined) {
    const values = snapshotDataArray(tools, "configuration_not_configured");
    if (values.length === 0 || values.length > MAX_CONFIGURATION_FIELDS
      || values.some(value => typeof value !== "string" || value.length === 0 || value.length > MAX_CONTROL_LABEL_LENGTH)) {
      throw new ProductionConfigurationPrimitiveError("configuration_not_configured");
    }
    copy.tools = values as string[];
    Object.freeze(copy.tools);
  }
  const additional = source.additional;
  if (additional !== undefined) {
    copy.additional = copyAdditionalAxes(additional);
  }
  if (Object.keys(copy).length === 0) {
    throw new ProductionConfigurationPrimitiveError("configuration_not_configured");
  }
  return Object.freeze(copy);
}

function copyAdditionalAxes(value: unknown): { [key: string]: string } {
  const source = snapshotDataRecord(value, "configuration_not_configured");
  if (Object.keys(source).length === 0) {
    throw new ProductionConfigurationPrimitiveError("configuration_not_configured");
  }
  const axes: Record<string, string> = {};
  const supported = new Set(["intelligence", "effort", "speed"]);
  for (const [key, child] of Object.entries(source)) {
    if (!supported.has(key) || typeof child !== "string"
      || child.length === 0 || child.length > MAX_CONTROL_LABEL_LENGTH) {
      throw new ProductionConfigurationPrimitiveError("configuration_not_configured");
    }
    axes[key] = child;
  }
  Object.freeze(axes);
  return axes;
}

function snapshotProductionOptions(value: unknown): RawProductionConfigurationOptions {
  const source = snapshotDataRecord(value, "staging_request_mismatch");
  const allowed = new Set(["evidenceDigest", "operationId", "requestDigest", "surface", "configuration"]);
  if (Object.keys(source).some(key => !allowed.has(key))) {
    throw new ProductionConfigurationPrimitiveError("staging_request_mismatch");
  }
  return {
    evidenceDigest: source.evidenceDigest,
    operationId: source.operationId,
    requestDigest: source.requestDigest,
    surface: source.surface,
    configuration: source.configuration
  };
}

function snapshotDataRecord(value: unknown, code: ProductionConfigurationBlockerCode): Record<string, unknown> {
  if (!isPlainDataRecord(value)) throw new ProductionConfigurationPrimitiveError(code);
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new ProductionConfigurationPrimitiveError(code);
  }
  // A null-prototype snapshot prevents a hostile own `__proto__` key from
  // changing the snapshot object's prototype while it is being copied.
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw new ProductionConfigurationPrimitiveError(code);
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)
      || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new ProductionConfigurationPrimitiveError(code);
    }
    output[key] = descriptor.value;
  }
  return output;
}

function snapshotDataArray(value: unknown, code: ProductionConfigurationBlockerCode): unknown[] {
  if (!Array.isArray(value)) throw new ProductionConfigurationPrimitiveError(code);
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  } catch {
    throw new ProductionConfigurationPrimitiveError(code);
  }
  const lengthDescriptor = descriptors.length;
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)
    || lengthDescriptor.get !== undefined || lengthDescriptor.set !== undefined
    || typeof lengthDescriptor.value !== "number"
    || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
    || lengthDescriptor.value > 1024) {
    throw new ProductionConfigurationPrimitiveError(code);
  }
  const length = lengthDescriptor.value;
  const output: unknown[] = [];
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw new ProductionConfigurationPrimitiveError(code);
    if (key === "length") continue;
    if (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length) {
      throw new ProductionConfigurationPrimitiveError(code);
    }
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor)
      || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new ProductionConfigurationPrimitiveError(code);
    }
    output.push(descriptor.value);
  }
  return output;
}

function readOwnDataProperty(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor
      && descriptor.get === undefined && descriptor.set === undefined
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttribute(value: string): string {
  return value.replace(/[\\"\u0000-\u001f\u007f]/g, "\\$&");
}
