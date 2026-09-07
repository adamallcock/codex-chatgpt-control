import { readdir, readFile, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  COLLECTOR_SCHEMA_VERSION,
  COLLECTOR_TERMINAL_SCHEMA_VERSION,
  type CollectorObservation
} from "../../src/operations/collector.js";
import { createJournalRpcClientFromDescriptor } from "../../src/operations/journal-rpc-client.js";
import { startJournalRpcServer } from "../../src/operations/journal-rpc-server.js";
import type { OperationJournalAuthority } from "../../src/operations/journal-authority.js";
import { OperationJournal, OperationJournalError } from "../../src/operations/journal.js";
import type {
  SubmissionAttachmentObservation,
  SubmissionFinalTransactionResult,
  SubmissionHandoffResult,
  SubmissionStageObservation
} from "../../src/operations/submission.js";
import {
  OperationService,
  OperationServiceError,
  type OperationBrowserAdapter,
  type OperationTargetEstablishmentRequest
} from "../../src/operations/service.js";
import {
  CONTROL_COORDINATOR_SCHEMA_VERSION,
  controlSteerPreparedDigestMaterial,
  type ControlSteerPrepareRequest,
  type ControlSteerPhaseResult,
  type ControlSteerPrepared,
  type ControlSteerVerifyRequest
} from "../../src/operations/control.js";
import type {
  OperationStagingMutationResult,
  OperationStagingObservation
} from "../../src/operations/staging.js";
import type {
  ArtifactTransferIntentV1,
  ArtifactTransferReceiptV1
} from "../../src/operations/artifact-transfer.js";
import {
  OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION,
  OPERATION_CONTROL_REQUEST_SCHEMA_VERSION,
  OPERATION_REQUEST_SCHEMA_VERSION,
  OPERATION_SUBMISSION_WITNESS_SCHEMA_VERSION,
  type OperationHandleV1,
  type OperationOwnershipBaselineV1,
  type OperationControlRequestV1,
  type OperationTargetBindingV1
} from "../../src/operations/types.js";
import {
  TURN_OWNERSHIP_SCHEMA_VERSION,
  type OwnershipBaseline,
  type OwnershipTargetEvidence
} from "../../src/operations/turn-ownership.js";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OPERATION_ID = "22222222-2222-4222-8222-222222222222";
const SEND_ACTION_ID = "33333333-3333-4333-8333-333333333333";
const CONTROL_ACTION_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_CONTROL_ACTION_ID = "55555555-5555-4555-8555-555555555555";
const AT = "2026-08-16T12:00:00.000Z";

describe("durable operation service", () => {
  it("bridges the submission lifecycle and never mutates twice on same-ID retry", async () => {
    const journal = await openJournal("submit");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const calls = { mutate: 0, observe: 0 };
    const adapter = makeAdapter({
      executeFinalTabTransaction: async request => {
        if (request.mode === "mutate_once") {
          calls.mutate += 1;
          return {
            status: "submitted",
            targetBindingDigest: request.expected.targetBindingDigest,
            evidenceDigest: digest("s"),
            userTurnId: "user-1",
            userTurnEvidenceDigest: digest("u"),
            postSendDeltaDigest: digest("d")
          };
        }
        calls.observe += 1;
        return {
          status: "already_submitted",
          targetBindingDigest: request.expected.targetBindingDigest,
          evidenceDigest: digest("s"),
          userTurnId: "user-1",
          userTurnEvidenceDigest: digest("u"),
          postSendDeltaDigest: digest("d")
        };
      }
    });

    const first = await service.submit(request(OPERATION_ID), [], adapter);
    const second = await service.submit(request(OPERATION_ID), [], adapter);

    expect(first.submission.kind).toBe("submitted");
    expect(second.submission.kind).toBe("already_submitted");
    expect(calls.mutate).toBe(1);
    expect(calls.observe).toBe(1);
    const inspected = await service.inspect(first.handle);
    expect(inspected.state.phase).toBe("submitted");
    expect(inspected.state.capturePolicy).toEqual({
      responseContent: "include",
      responseFormat: "markdown",
      artifacts: "receipt_only"
    });
    expect(inspected.state.actions).toMatchObject({
      [Object.keys(inspected.state.actions).find(key => inspected.state.actions[key]?.kind === "send")!]: {
        kind: "send",
        outcome: "satisfied"
      }
    });
    const events = (await journal.load(OPERATION_ID)).envelopes.map(envelope => envelope.event);
    expect(events[0]).toMatchObject({
      type: "operation_created",
      capturePolicy: { responseContent: "include", responseFormat: "markdown", artifacts: "receipt_only" }
    });
    expect(JSON.stringify(events[0])).not.toContain("outputDirectory");
    const witnessIndex = events.findIndex(event => event.type === "submission_witness");
    const sendActionId = Object.values(inspected.state.actions).find(action => action.kind === "send")?.actionId;
    const preparedIndex = events.findIndex(event => event.type === "action_prepared" && event.action.actionId === sendActionId);
    const sendPendingIndex = events.findIndex(event => event.type === "phase_changed" && event.to === "send_pending");
    const sendReceiptIndex = events.findIndex(event => event.type === "action_receipt" && event.actionId === sendActionId);
    const submittedPhaseIndex = events.findIndex(event => event.type === "phase_changed" && event.to === "submitted");
    expect(preparedIndex).toBeGreaterThanOrEqual(0);
    expect(sendPendingIndex).toBeGreaterThan(preparedIndex);
    expect(events.some(event => event.type === "action_intent" && event.action.kind === "send")).toBe(false);
    expect(events.some(event => event.type === "ownership_baseline")).toBe(false);
    expect(inspected.state.ownershipBaselines?.[sendActionId!]).toEqual(inspected.state.ownershipBaseline);
    expect(witnessIndex).toBeGreaterThanOrEqual(0);
    expect(sendReceiptIndex).toBeGreaterThan(witnessIndex);
    expect(submittedPhaseIndex).toBeGreaterThan(sendReceiptIndex);
  });

  it("fences Work steer, persists its witness before the generic receipt, and never serializes the prompt", async () => {
    const journal = await openJournal("service-work-steer");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const steerCalls: string[] = [];
    let prepared!: ControlSteerPrepared;
    const adapter = makeAdapter({
      resolveTarget: async () => ({ target: steerTarget() }),
      collector: {
        readContext: async context => ownershipContext(
          OPERATION_ID,
          context.targetBindingDigest,
          context.submissionActionId!,
          "work_steer"
        ),
        observe: async () => generatingObservation(false),
        sleep: async () => undefined
      },
      control: {
        observeTurn: vi.fn(async () => ({ status: "generating", assistantTurnId: "assistant-1", evidenceDigest: digest("t") } as const)),
        executeOnce: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        observePostcondition: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        prepareSteer: vi.fn(async request => {
          steerCalls.push("prepare");
          prepared = makePreparedSteer(journal, request);
          return preparedSteerPhase(prepared);
        }),
        executeSteerPrepared: vi.fn(async request => {
          steerCalls.push("execute");
          return executedSteerPhase(request.prepared);
        }),
        verifySteer: vi.fn(async request => {
          steerCalls.push("verify");
          return satisfiedSteerPhase(request.prepared, "verify");
        }),
        recoverSteer: vi.fn(async request => {
          steerCalls.push("recover");
          return satisfiedSteerPhase(request.prepared, "recovery");
        })
      }
    });

    const submitted = await service.submit(workRequest(OPERATION_ID), [], adapter);
    expect((await service.collect(submitted.handle, adapter)).kind).toBe("pending");
    const parent = (await service.inspect(submitted.handle)).handle;
    const controlRequest = {
      schemaVersion: OPERATION_CONTROL_REQUEST_SCHEMA_VERSION,
      controlActionId: CONTROL_ACTION_ID,
      parent,
      action: "steer" as const,
      expectedAssistantTurnId: "assistant-1",
      steerPrompt: "private steer prompt that must remain request-local",
      timeoutMs: 5_000
    };

    const result = await service.control(controlRequest, adapter);
    expect(result.kind).toBe("completed");
    expect(steerCalls).toEqual(["prepare", "execute", "verify"]);
    const replay = await service.control(controlRequest, adapter);
    expect(replay.kind).toBe("completed");
    expect(steerCalls).toEqual(["prepare", "execute", "verify"]);
    const inspected = await service.inspect(parent);
    expect(inspected.state.submissionWitnesses?.[CONTROL_ACTION_ID]).toMatchObject({
      actionId: CONTROL_ACTION_ID,
      actionKind: "work_steer",
      baselineSnapshotDigest: prepared.baselineSnapshotDigest,
      postSendDeltaDigest: digest("d"),
      userTurnId: "user-steer-1"
    });
    const events = (await journal.load(OPERATION_ID)).envelopes.map(envelope => envelope.event);
    const preparedIndex = events.findIndex(event => event.type === "action_prepared" && event.action.actionId === CONTROL_ACTION_ID);
    const witnessIndex = events.findIndex(event => event.type === "submission_witness" && event.witness.actionId === CONTROL_ACTION_ID);
    const receiptIndex = events.findIndex(event => event.type === "action_receipt" && event.actionId === CONTROL_ACTION_ID);
    expect(preparedIndex).toBeGreaterThanOrEqual(0);
    expect(witnessIndex).toBeGreaterThanOrEqual(0);
    expect(witnessIndex).toBeGreaterThan(preparedIndex);
    expect(receiptIndex).toBeGreaterThan(witnessIndex);
    expect(await durableCorpus(journal.stateRoot)).not.toContain("private steer prompt");
  });

  it("reconciles an action_prepared acknowledgement loss through recovery without executing Work steer", async () => {
    const journal = await openJournal("service-work-steer-commit-throw");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const append = journal.append.bind(journal);
    let injected = false;
    vi.spyOn(journal, "append").mockImplementation(async (operationId, expectedRevision, event) => {
      const loaded = await append(operationId, expectedRevision, event);
      if (!injected && event.type === "action_prepared" && event.action.kind === "work_steer") {
        injected = true;
        throw new Error("simulated lost Work action_prepared acknowledgement");
      }
      return loaded;
    });
    const calls: string[] = [];
    let prepared!: ControlSteerPrepared;
    let executeCount = 0;
    const adapter = makeAdapter({
      resolveTarget: async () => ({ target: steerTarget() }),
      collector: {
        readContext: async context => ownershipContext(OPERATION_ID, context.targetBindingDigest, context.submissionActionId!, "work_steer"),
        observe: async () => generatingObservation(false),
        sleep: async () => undefined
      },
      control: {
        observeTurn: vi.fn(async () => ({ status: "generating", assistantTurnId: "assistant-1", evidenceDigest: digest("t") } as const)),
        executeOnce: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        observePostcondition: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        prepareSteer: vi.fn(async request => {
          calls.push("prepare");
          prepared = makePreparedSteer(journal, request);
          return preparedSteerPhase(prepared);
        }),
        executeSteerPrepared: vi.fn(async () => {
          calls.push("execute");
          executeCount += 1;
          return executedSteerPhase(prepared);
        }),
        verifySteer: vi.fn(async request => {
          calls.push("verify");
          return satisfiedSteerPhase(request.prepared, "verify");
        }),
        recoverSteer: vi.fn(async request => {
          calls.push("recover");
          return satisfiedSteerPhase(request.prepared, "recovery");
        })
      }
    });
    const submitted = await service.submit(workRequest(OPERATION_ID), [], adapter);
    await service.collect(submitted.handle, adapter);
    const parent = (await service.inspect(submitted.handle)).handle;
    const requestValue = {
      schemaVersion: OPERATION_CONTROL_REQUEST_SCHEMA_VERSION,
      controlActionId: CONTROL_ACTION_ID,
      parent,
      action: "steer" as const,
      expectedAssistantTurnId: "assistant-1",
      steerPrompt: "commit-throw secret"
    };
    const result = await service.control(requestValue, adapter);
    expect(injected).toBe(true);
    expect(result.kind).toBe("completed");
    expect(executeCount).toBe(0);
    expect(calls).toEqual(["prepare", "recover"]);
    const state = (await service.inspect(parent)).state;
    expect(state.actions[CONTROL_ACTION_ID]).toMatchObject({ kind: "work_steer", outcome: "satisfied" });
    expect(state.submissionWitnesses?.[CONTROL_ACTION_ID]).toBeDefined();
    const events = (await journal.load(OPERATION_ID)).envelopes.map(envelope => envelope.event);
    const preparedIndex = events.findIndex(event => event.type === "action_prepared" && event.action.actionId === CONTROL_ACTION_ID);
    const witnessIndex = events.findIndex(event => event.type === "submission_witness" && event.witness.actionId === CONTROL_ACTION_ID);
    const receiptIndex = events.findIndex(event => event.type === "action_receipt" && event.actionId === CONTROL_ACTION_ID);
    expect(preparedIndex).toBeGreaterThanOrEqual(0);
    expect(witnessIndex).toBeGreaterThan(preparedIndex);
    expect(receiptIndex).toBeGreaterThan(witnessIndex);
  });

  it("converges a committed Work witness after acknowledgement loss before the generic receipt", async () => {
    const journal = await openJournal("service-work-steer-witness-commit-throw");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const append = journal.append.bind(journal);
    let injected = false;
    vi.spyOn(journal, "append").mockImplementation(async (operationId, expectedRevision, event) => {
      const loaded = await append(operationId, expectedRevision, event);
      if (!injected && event.type === "submission_witness" && event.witness.actionId === CONTROL_ACTION_ID) {
        injected = true;
        throw new Error("simulated lost Work witness acknowledgement");
      }
      return loaded;
    });
    const calls: string[] = [];
    let executeCount = 0;
    const adapter = makeAdapter({
      resolveTarget: async () => ({ target: steerTarget() }),
      collector: {
        readContext: async context => ownershipContext(OPERATION_ID, context.targetBindingDigest, context.submissionActionId!, "work_steer"),
        observe: async () => generatingObservation(false),
        sleep: async () => undefined
      },
      control: {
        observeTurn: vi.fn(async () => ({ status: "generating", assistantTurnId: "assistant-1", evidenceDigest: digest("t") } as const)),
        executeOnce: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        observePostcondition: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        prepareSteer: vi.fn(async requestValue => {
          calls.push("prepare");
          return preparedSteerPhase(makePreparedSteer(journal, requestValue));
        }),
        executeSteerPrepared: vi.fn(async requestValue => {
          calls.push("execute");
          executeCount += 1;
          return executedSteerPhase(requestValue.prepared);
        }),
        verifySteer: vi.fn(async requestValue => {
          calls.push("verify");
          return satisfiedSteerPhase(requestValue.prepared, "verify");
        }),
        recoverSteer: vi.fn(async requestValue => {
          calls.push("recover");
          return satisfiedSteerPhase(requestValue.prepared, "recovery");
        })
      }
    });
    const submitted = await service.submit(workRequest(OPERATION_ID), [], adapter);
    await service.collect(submitted.handle, adapter);
    const parent = (await service.inspect(submitted.handle)).handle;
    const requestValue = controlRequest(parent, CONTROL_ACTION_ID);

    const first = await service.control(requestValue, adapter);
    expect(first.kind).toBe("completed");
    expect(injected).toBe(true);
    expect(executeCount).toBe(1);
    expect(calls).toEqual(["prepare", "execute", "verify"]);

    const replay = await service.control(requestValue, adapter);
    expect(replay.kind).toBe("completed");
    expect(executeCount).toBe(1);
    expect(calls).toEqual(["prepare", "execute", "verify"]);
    const events = (await journal.load(OPERATION_ID)).envelopes.map(envelope => envelope.event);
    expect(events.filter(event => event.type === "submission_witness" && event.witness.actionId === CONTROL_ACTION_ID)).toHaveLength(1);
    expect(events.filter(event => event.type === "action_receipt" && event.actionId === CONTROL_ACTION_ID)).toHaveLength(1);
    const witnessIndex = events.findIndex(event => event.type === "submission_witness" && event.witness.actionId === CONTROL_ACTION_ID);
    const receiptIndex = events.findIndex(event => event.type === "action_receipt" && event.actionId === CONTROL_ACTION_ID);
    expect(receiptIndex).toBeGreaterThan(witnessIndex);
  });

  it("settles sequential caller-owned Work steers and gives collection the latest causal witness", async () => {
    const journal = await openJournal("service-work-steer-sequential");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const steerCalls: string[] = [];
    const collectorActionIds: string[] = [];
    let steerPreparationCount = 0;
    let collectionKind: "send" | "work_steer" = "send";
    const adapter = makeAdapter({
      resolveTarget: async () => ({ target: target() }),
      collector: {
        readContext: async context => {
          collectorActionIds.push(context.submissionActionId!);
          collectionKind = context.submissionActionKind ?? "send";
          return ownershipContext(
            OPERATION_ID,
            context.targetBindingDigest,
            context.submissionActionId!,
            context.submissionActionKind ?? "send"
          );
        },
        observe: async () => {
          return collectionKind === "work_steer" ? workGeneratingObservation() : generatingObservation();
        },
        sleep: async () => undefined
      },
      control: {
        observeTurn: vi.fn(async () => ({ status: "generating", assistantTurnId: "assistant-1", evidenceDigest: digest("t") } as const)),
        executeOnce: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        observePostcondition: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        prepareSteer: vi.fn(async requestValue => {
          steerCalls.push(`prepare:${requestValue.controlActionId}`);
          const baseline = steerPreparationCount === 0 ? makeSteerBaseline(steerTarget()) : makeSecondSteerBaseline();
          steerPreparationCount += 1;
          return preparedSteerPhase(makePreparedSteer(journal, requestValue, baseline));
        }),
        executeSteerPrepared: vi.fn(async requestValue => {
          steerCalls.push(`execute:${requestValue.prepared.controlActionId}`);
          return executedSteerPhase(requestValue.prepared);
        }),
        verifySteer: vi.fn(async (requestValue: ControlSteerVerifyRequest) => {
          steerCalls.push(`verify:${requestValue.prepared.controlActionId}`);
          const secondSteer = requestValue.prepared.baseline.userTurns.some(turn => turn.stableId === "user-steer-1");
          return satisfiedSteerPhase(
            requestValue.prepared,
            "verify",
            secondSteer
              ? {
                  userTurnId: "user-steer-2",
                  userTurnEvidenceDigest: digest("2"),
                  postSendDeltaDigest: digest("2"),
                  evidenceDigest: digest("f")
                }
              : undefined
          );
        }),
        recoverSteer: vi.fn(async requestValue => {
          steerCalls.push(`recover:${requestValue.prepared.controlActionId}`);
          return satisfiedSteerPhase(requestValue.prepared, "recovery");
        })
      }
    });

    const submitted = await service.submit(workRequest(OPERATION_ID), [], adapter);
    await service.collect(submitted.handle, adapter);
    const firstParent = (await service.inspect(submitted.handle)).handle;
    const sendActionId = Object.values((await service.inspect(submitted.handle)).state.actions)
      .find(action => action.kind === "send")?.actionId;
    expect(sendActionId).toBeDefined();
    expect(collectorActionIds[0]).toBe(sendActionId);
    const first = await service.control(controlRequest(firstParent, CONTROL_ACTION_ID), adapter);
    expect(first.kind).toBe("completed");

    const secondParent = (await service.inspect(submitted.handle)).handle;
    const second = await service.control(controlRequest(secondParent, SECOND_CONTROL_ACTION_ID), adapter);
    expect(second.kind).toBe("completed");

    const inspected = await service.inspect(submitted.handle);
    expect(inspected.state.actions[CONTROL_ACTION_ID]).toMatchObject({ kind: "work_steer", outcome: "satisfied" });
    expect(inspected.state.actions[SECOND_CONTROL_ACTION_ID]).toMatchObject({ kind: "work_steer", outcome: "satisfied" });
    expect(inspected.state.submissionWitnesses?.[CONTROL_ACTION_ID]).toMatchObject({
      baselineSnapshotDigest: digest("b"),
      postSendDeltaDigest: digest("d"),
      userTurnId: "user-steer-1"
    });
    expect(inspected.state.submissionWitnesses?.[SECOND_CONTROL_ACTION_ID]).toMatchObject({
      baselineSnapshotDigest: digest("c"),
      postSendDeltaDigest: digest("2"),
      userTurnId: "user-steer-2"
    });
    expect(steerCalls).toEqual([
      `prepare:${CONTROL_ACTION_ID}`,
      `execute:${CONTROL_ACTION_ID}`,
      `verify:${CONTROL_ACTION_ID}`,
      `prepare:${SECOND_CONTROL_ACTION_ID}`,
      `execute:${SECOND_CONTROL_ACTION_ID}`,
      `verify:${SECOND_CONTROL_ACTION_ID}`
    ]);

    const collected = await service.collect(inspected.handle, adapter);
    expect(collectorActionIds.at(-1)).toBe(SECOND_CONTROL_ACTION_ID);
    expect(collected.kind, JSON.stringify(collected)).toBe("pending");

    const events = (await journal.load(OPERATION_ID)).envelopes.map(envelope => envelope.event);
    for (const actionId of [CONTROL_ACTION_ID, SECOND_CONTROL_ACTION_ID]) {
      const preparedIndex = events.findIndex(event => event.type === "action_prepared" && event.action.actionId === actionId);
      const witnessIndex = events.findIndex(event => event.type === "submission_witness" && event.witness.actionId === actionId);
      const receiptIndex = events.findIndex(event => event.type === "action_receipt" && event.actionId === actionId);
      expect(preparedIndex).toBeGreaterThanOrEqual(0);
      expect(witnessIndex).toBeGreaterThan(preparedIndex);
      expect(receiptIndex).toBeGreaterThan(witnessIndex);
    }
  });

  it("persists a clean non-mutating Work rejection and leaves Send collection ownership usable", async () => {
    const journal = await openJournal("service-work-steer-not-satisfied");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const collectorActionIds: string[] = [];
    const adapter = makeAdapter({
      resolveTarget: async () => ({ target: target() }),
      collector: {
        readContext: async context => {
          collectorActionIds.push(context.submissionActionId!);
          return ownershipContext(OPERATION_ID, context.targetBindingDigest, context.submissionActionId!, "send");
        },
        observe: async () => generatingObservation(),
        sleep: async () => undefined
      },
      control: {
        observeTurn: vi.fn(async () => ({ status: "generating", assistantTurnId: "assistant-1", evidenceDigest: digest("t") } as const)),
        executeOnce: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        observePostcondition: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        prepareSteer: vi.fn(async requestValue => preparedSteerPhase(makePreparedSteer(journal, requestValue))),
        executeSteerPrepared: vi.fn(async requestValue => ({
          ...steerPhaseIdentity(requestValue.prepared),
          phase: "execute_prepared" as const,
          status: "blocked" as const,
          blockerCode: "target_binding_mismatch" as const,
          observationRequired: false,
          mutationBoundary: "none" as const,
          evidenceDigest: digest("m")
        })),
        verifySteer: vi.fn(async requestValue => satisfiedSteerPhase(requestValue.prepared, "verify")),
        recoverSteer: vi.fn(async requestValue => satisfiedSteerPhase(requestValue.prepared, "recovery"))
      }
    });

    const submitted = await service.submit(workRequest(OPERATION_ID), [], adapter);
    await service.collect(submitted.handle, adapter);
    const parent = (await service.inspect(submitted.handle)).handle;
    const sendActionId = Object.values((await service.inspect(submitted.handle)).state.actions)
      .find(action => action.kind === "send")?.actionId;
    expect(sendActionId).toBeDefined();
    const result = await service.control(controlRequest(parent, CONTROL_ACTION_ID), adapter);

    expect(result).toMatchObject({ kind: "blocked", blocker: { code: "target_binding_mismatch" }, receipt: { outcome: "not_satisfied" } });
    const inspected = await service.inspect(parent);
    expect(inspected.state.actions[CONTROL_ACTION_ID]).toMatchObject({ kind: "work_steer", outcome: "not_satisfied", blockerCode: "target_binding_mismatch" });
    expect(inspected.state.ownershipBaselines?.[CONTROL_ACTION_ID]).toBeDefined();
    expect(inspected.state.submissionWitnesses?.[CONTROL_ACTION_ID]).toBeUndefined();

    const replay = await service.control(controlRequest(inspected.handle, CONTROL_ACTION_ID), adapter);
    expect(replay).toMatchObject({ kind: "blocked", receipt: { outcome: "not_satisfied" } });
    expect(adapter.control!.prepareSteer).toHaveBeenCalledTimes(1);
    expect(adapter.control!.executeSteerPrepared).toHaveBeenCalledTimes(1);

    const collected = await service.collect(inspected.handle, adapter);
    expect(collected.kind).toBe("pending");
    expect(collectorActionIds.at(-1)).toBe(sendActionId);
    const events = (await journal.load(OPERATION_ID)).envelopes.map(envelope => envelope.event);
    const preparedIndex = events.findIndex(event => event.type === "action_prepared" && event.action.actionId === CONTROL_ACTION_ID);
    const witnessIndex = events.findIndex(event => event.type === "submission_witness" && event.witness.actionId === CONTROL_ACTION_ID);
    const receiptIndex = events.findIndex(event => event.type === "action_receipt" && event.actionId === CONTROL_ACTION_ID);
    expect(preparedIndex).toBeGreaterThanOrEqual(0);
    expect(witnessIndex).toBe(-1);
    expect(receiptIndex).toBeGreaterThan(preparedIndex);
  });

  it("records cancellation after the Work fence as not_satisfied and makes retry recovery-only", async () => {
    const journal = await openJournal("service-work-steer-cancelled");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const controller = new AbortController();
    const append = journal.append.bind(journal);
    let preparedAppend = false;
    vi.spyOn(journal, "append").mockImplementation(async (operationId, expectedRevision, event) => {
      const loaded = await append(operationId, expectedRevision, event);
      if (!preparedAppend && event.type === "action_prepared" && event.action.kind === "work_steer") {
        preparedAppend = true;
        controller.abort();
      }
      return loaded;
    });
    const calls: string[] = [];
    const adapter = makeAdapter({
      resolveTarget: async () => ({ target: target() }),
      collector: {
        readContext: async context => ownershipContext(OPERATION_ID, context.targetBindingDigest, context.submissionActionId!, context.submissionActionKind ?? "send"),
        observe: async () => generatingObservation(),
        sleep: async () => undefined
      },
      control: {
        observeTurn: vi.fn(async () => ({ status: "generating", assistantTurnId: "assistant-1", evidenceDigest: digest("t") } as const)),
        executeOnce: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        observePostcondition: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        prepareSteer: vi.fn(async requestValue => {
          calls.push("prepare");
          return preparedSteerPhase(makePreparedSteer(journal, requestValue));
        }),
        executeSteerPrepared: vi.fn(async requestValue => {
          calls.push("execute");
          return executedSteerPhase(requestValue.prepared);
        }),
        verifySteer: vi.fn(async requestValue => {
          calls.push("verify");
          return satisfiedSteerPhase(requestValue.prepared, "verify");
        }),
        recoverSteer: vi.fn(async requestValue => {
          calls.push("recover");
          return satisfiedSteerPhase(requestValue.prepared, "recovery");
        })
      }
    });
    const submitted = await service.submit(workRequest(OPERATION_ID), [], adapter);
    await service.collect(submitted.handle, adapter);
    const parent = (await service.inspect(submitted.handle)).handle;
    const requestValue = controlRequest(parent, CONTROL_ACTION_ID);
    const result = await service.control(requestValue, adapter, { signal: controller.signal });

    expect(preparedAppend).toBe(true);
    expect(result).toMatchObject({ kind: "blocked", blocker: { code: "operation_cancelled" }, receipt: { outcome: "not_satisfied" } });
    expect(calls).toEqual(["prepare"]);
    expect(adapter.control!.executeSteerPrepared).not.toHaveBeenCalled();
    const inspected = await service.inspect(parent);
    expect(inspected.state.actions[CONTROL_ACTION_ID]).toMatchObject({ outcome: "not_satisfied", blockerCode: "operation_cancelled" });
    expect(inspected.state.submissionWitnesses?.[CONTROL_ACTION_ID]).toBeUndefined();

    const replay = await service.control(requestValue, adapter);
    expect(replay).toMatchObject({ kind: "blocked", receipt: { outcome: "not_satisfied" } });
    expect(calls).toEqual(["prepare"]);
  });

  it("fences distinct concurrent Work steers, blocks the loser, and accepts its fresh retry after settlement", async () => {
    const journal = await openJournal("service-work-steer-concurrent");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    let prepareCount = 0;
    let releasePrepare!: () => void;
    const bothPrepared = new Promise<void>(resolve => { releasePrepare = resolve; });
    let executeCount = 0;
    const adapter = makeAdapter({
      resolveTarget: async () => ({ target: target() }),
      collector: {
        readContext: async context => ownershipContext(OPERATION_ID, context.targetBindingDigest, context.submissionActionId!, context.submissionActionKind ?? "send"),
        observe: async () => generatingObservation(),
        sleep: async () => undefined
      },
      control: {
        observeTurn: vi.fn(async () => ({ status: "generating", assistantTurnId: "assistant-1", evidenceDigest: digest("t") } as const)),
        executeOnce: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        observePostcondition: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        prepareSteer: vi.fn(async requestValue => {
          const prepared = preparedSteerPhase(makePreparedSteer(journal, requestValue));
          prepareCount += 1;
          if (prepareCount === 2) releasePrepare();
          if (prepareCount <= 2) await bothPrepared;
          return prepared;
        }),
        executeSteerPrepared: vi.fn(async requestValue => {
          executeCount += 1;
          return executedSteerPhase(requestValue.prepared);
        }),
        verifySteer: vi.fn(async requestValue => satisfiedSteerPhase(requestValue.prepared, "verify")),
        recoverSteer: vi.fn(async requestValue => satisfiedSteerPhase(requestValue.prepared, "recovery"))
      }
    });
    const submitted = await service.submit(workRequest(OPERATION_ID), [], adapter);
    await service.collect(submitted.handle, adapter);
    const parent = (await service.inspect(submitted.handle)).handle;
    const firstRequest = controlRequest(parent, CONTROL_ACTION_ID);
    const secondRequest = controlRequest(parent, SECOND_CONTROL_ACTION_ID);
    const [first, second] = await Promise.all([
      service.control(firstRequest, adapter),
      service.control(secondRequest, adapter)
    ]);

    expect(prepareCount).toBe(2);
    expect(executeCount).toBe(1);
    expect([first.kind, second.kind].sort()).toEqual(["blocked", "completed"]);
    const blocked = first.kind === "blocked" ? first : second;
    expect(blocked).toMatchObject({ blocker: { code: "provider_concurrency_unsupported" } });
    const afterWinner = await service.inspect(parent);
    const durableActions = Object.values(afterWinner.state.actions).filter(action => action.kind === "work_steer");
    expect(durableActions).toHaveLength(1);
    const winnerId = durableActions[0]!.actionId;
    const loserId = winnerId === CONTROL_ACTION_ID ? SECOND_CONTROL_ACTION_ID : CONTROL_ACTION_ID;
    const retry = await service.control(controlRequest(afterWinner.handle, loserId), adapter);
    expect(retry.kind).toBe("completed");
    expect(prepareCount).toBe(3);
    expect(executeCount).toBe(2);
    expect((await service.inspect(afterWinner.handle)).state.actions[loserId]).toMatchObject({ outcome: "satisfied" });
    const events = (await journal.load(OPERATION_ID)).envelopes.map(envelope => envelope.event);
    expect(events.flatMap(event => event.type === "action_prepared" && event.action.kind === "work_steer" ? [event.action.actionId] : [])).toEqual([winnerId, loserId]);
  });

  it("blocks a fresh Work steer behind an unresolved prepared action without appending or executing", async () => {
    const journal = await openJournal("service-work-steer-unresolved");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const adapter = makeAdapter({
      resolveTarget: async () => ({ target: target() }),
      collector: {
        readContext: async context => ownershipContext(OPERATION_ID, context.targetBindingDigest, context.submissionActionId!, context.submissionActionKind ?? "send"),
        observe: async () => generatingObservation(),
        sleep: async () => undefined
      },
      control: {
        observeTurn: vi.fn(async () => ({ status: "generating", assistantTurnId: "assistant-1", evidenceDigest: digest("t") } as const)),
        executeOnce: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        observePostcondition: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        prepareSteer: vi.fn(async requestValue => preparedSteerPhase(makePreparedSteer(journal, requestValue))),
        executeSteerPrepared: vi.fn(async requestValue => executedSteerPhase(requestValue.prepared)),
        verifySteer: vi.fn(async requestValue => satisfiedSteerPhase(requestValue.prepared, "verify")),
        recoverSteer: vi.fn(async requestValue => satisfiedSteerPhase(requestValue.prepared, "recovery"))
      }
    });
    const submitted = await service.submit(workRequest(OPERATION_ID), [], adapter);
    await service.collect(submitted.handle, adapter);
    const parent = (await service.inspect(submitted.handle)).handle;
    const sendActionId = Object.values((await service.inspect(submitted.handle)).state.actions)
      .find(action => action.kind === "send")?.actionId;
    expect(sendActionId).toBeDefined();
    const unresolvedRequest = controlRequest(parent, CONTROL_ACTION_ID);
    const unresolvedDigest = journal.controlRequestDigest(unresolvedRequest);
    const prepared = makePreparedSteer(journal, {
      schemaVersion: CONTROL_COORDINATOR_SCHEMA_VERSION,
      parentOperationId: OPERATION_ID,
      parentRequestDigest: parent.requestDigest,
      parentTargetBindingDigest: parent.targetBindingDigest!,
      controlActionId: CONTROL_ACTION_ID,
      requestDigest: unresolvedDigest,
      expectedAssistantTurnId: "assistant-1",
      signal: new AbortController().signal,
      deadlineAt: Date.parse(AT) + 5_000
    });
    const loaded = await journal.load(OPERATION_ID, parent.requestDigest);
    await journal.append(OPERATION_ID, loaded.state.revision, {
      type: "action_prepared",
      action: {
        actionId: CONTROL_ACTION_ID,
        kind: "work_steer",
        repeatPolicy: "observe_only_after_intent",
        requestDigest: unresolvedDigest,
        targetDigest: parent.targetBindingDigest!,
        parentActionId: sendActionId!
      },
      intentAt: loaded.state.updatedAt,
      baseline: {
        schemaVersion: OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION,
        operationId: OPERATION_ID,
        requestDigest: parent.requestDigest,
        targetBindingDigest: parent.targetBindingDigest!,
        actionId: CONTROL_ACTION_ID,
        baseline: prepared.baseline,
        observedAt: loaded.state.updatedAt
      }
    });

    const freshAction = await service.control(controlRequest(parent, SECOND_CONTROL_ACTION_ID), adapter);
    expect(freshAction).toMatchObject({ kind: "blocked", blocker: { code: "provider_concurrency_unsupported" } });
    expect(adapter.control!.executeSteerPrepared).not.toHaveBeenCalled();
    const state = (await service.inspect(parent)).state;
    expect(state.actions[CONTROL_ACTION_ID]?.kind).toBe("work_steer");
    expect(state.actions[CONTROL_ACTION_ID]?.outcome).toBeUndefined();
    expect(state.actions[SECOND_CONTROL_ACTION_ID]).toBeUndefined();
  });

  it("quarantines a satisfied Work steer whose causal witness is missing", async () => {
    const journal = await openJournal("service-work-steer-missing-witness");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const adapter = makeAdapter({
      resolveTarget: async () => ({ target: target() }),
      collector: {
        readContext: async context => ownershipContext(OPERATION_ID, context.targetBindingDigest, context.submissionActionId!, context.submissionActionKind ?? "send"),
        observe: async () => generatingObservation(),
        sleep: async () => undefined
      },
      control: {
        observeTurn: vi.fn(async () => ({ status: "generating", assistantTurnId: "assistant-1", evidenceDigest: digest("t") } as const)),
        executeOnce: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        observePostcondition: vi.fn(async () => ({ status: "uncertain", blockerCode: "send_control_unavailable" } as const)),
        prepareSteer: vi.fn(async requestValue => preparedSteerPhase(makePreparedSteer(journal, requestValue))),
        executeSteerPrepared: vi.fn(async requestValue => executedSteerPhase(requestValue.prepared)),
        verifySteer: vi.fn(async requestValue => satisfiedSteerPhase(requestValue.prepared, "verify")),
        recoverSteer: vi.fn(async requestValue => satisfiedSteerPhase(requestValue.prepared, "recovery"))
      }
    });
    const submitted = await service.submit(workRequest(OPERATION_ID), [], adapter);
    await service.collect(submitted.handle, adapter);
    const parent = (await service.inspect(submitted.handle)).handle;
    const sendActionId = Object.values((await service.inspect(submitted.handle)).state.actions)
      .find(action => action.kind === "send")?.actionId;
    expect(sendActionId).toBeDefined();

    const priorRequest = controlRequest(parent, CONTROL_ACTION_ID);
    const priorRequestDigest = journal.controlRequestDigest(priorRequest);
    const prepared = makePreparedSteer(journal, {
      schemaVersion: CONTROL_COORDINATOR_SCHEMA_VERSION,
      parentOperationId: OPERATION_ID,
      parentRequestDigest: parent.requestDigest,
      parentTargetBindingDigest: parent.targetBindingDigest!,
      controlActionId: CONTROL_ACTION_ID,
      requestDigest: priorRequestDigest,
      expectedAssistantTurnId: "assistant-1",
      signal: new AbortController().signal,
      deadlineAt: Date.parse(AT) + 5_000
    });
    const loaded = await journal.load(OPERATION_ID, parent.requestDigest);
    const baseline = {
      schemaVersion: OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION,
      operationId: OPERATION_ID,
      requestDigest: parent.requestDigest,
      targetBindingDigest: parent.targetBindingDigest!,
      actionId: CONTROL_ACTION_ID,
      baseline: prepared.baseline,
      observedAt: loaded.state.updatedAt
    } satisfies OperationOwnershipBaselineV1;
    const preparedState = await journal.append(OPERATION_ID, loaded.state.revision, {
      type: "action_prepared",
      action: {
        actionId: CONTROL_ACTION_ID,
        kind: "work_steer",
        repeatPolicy: "observe_only_after_intent",
        requestDigest: priorRequestDigest,
        targetDigest: parent.targetBindingDigest!,
        parentActionId: sendActionId!
      },
      intentAt: loaded.state.updatedAt,
      baseline
    });
    const satisfiedPrefix = await journal.append(OPERATION_ID, preparedState.state.revision, {
      type: "action_receipt",
      actionId: CONTROL_ACTION_ID,
      outcome: "satisfied",
      evidenceDigest: digest("x"),
      observedAt: preparedState.state.updatedAt
    });
    expect(satisfiedPrefix.state.actions[CONTROL_ACTION_ID]).toMatchObject({ outcome: "satisfied" });
    expect(satisfiedPrefix.state.submissionWitnesses?.[CONTROL_ACTION_ID]).toBeUndefined();

    const freshAction = await service.control(controlRequest(parent, SECOND_CONTROL_ACTION_ID), adapter);
    expect(freshAction).toMatchObject({ kind: "blocked", blocker: { code: "operation_state_corrupt" } });
    // Corrupt prior evidence is quarantined at parent read; no provider phase
    // is even entered, and certainly no browser mutation is authorized.
    expect(adapter.control!.prepareSteer).not.toHaveBeenCalled();
    expect(adapter.control!.executeSteerPrepared).not.toHaveBeenCalled();
    const state = (await service.inspect(parent)).state;
    expect(state.actions[CONTROL_ACTION_ID]?.outcome).toBe("satisfied");
    expect(state.actions[SECOND_CONTROL_ACTION_ID]).toBeUndefined();
  });

  it("persists new-thread establishment before the submitted receipt and never reactivates Send", async () => {
    const journal = await openJournal("new-submit-establishment");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    let mutate = 0;
    let observe = 0;
    const adapter = makeAdapter({
      resolveTarget: async () => ({ target: newPendingTarget() }),
      executeFinalTabTransaction: async request => {
        if (request.mode === "mutate_once") {
          mutate += 1;
          return {
            status: "submitted",
            targetBindingDigest: request.expected.targetBindingDigest,
            evidenceDigest: digest("s"),
            userTurnId: "user-new",
            userTurnEvidenceDigest: digest("u"),
            postSendDeltaDigest: digest("d"),
            targetEstablishment: {
              targetBindingDigest: request.expected.targetBindingDigest,
              anchorDigest: digest("a"),
              causalSendActionId: request.actionId,
              conversationId: "conversation-new",
              canonicalThreadUrl: "https://chatgpt.com/c/conversation-new",
              userTurnId: "user-new",
              userTurnEvidenceDigest: digest("u"),
              postSendDeltaDigest: digest("d"),
              evidenceDigest: digest("e")
            }
          };
        }
        observe += 1;
        return {
          status: "already_submitted",
          targetBindingDigest: request.expected.targetBindingDigest,
          evidenceDigest: digest("s"),
          userTurnId: "user-new",
          userTurnEvidenceDigest: digest("u"),
          postSendDeltaDigest: digest("d"),
          targetEstablishment: {
            targetBindingDigest: request.expected.targetBindingDigest,
            anchorDigest: digest("a"),
            causalSendActionId: request.actionId,
            conversationId: "conversation-new",
            canonicalThreadUrl: "https://chatgpt.com/c/conversation-new",
            userTurnId: "user-new",
            userTurnEvidenceDigest: digest("u"),
            postSendDeltaDigest: digest("d"),
            evidenceDigest: digest("e")
          }
        };
      }
    });

    const first = await service.submit(request(OPERATION_ID), [], adapter);
    expect(first.submission.kind).toBe("submitted");
    expect(mutate).toBe(1);
    const inspected = await service.inspect(first.handle);
    expect(inspected.state.phase).toBe("submitted");
    expect(inspected.state.target?.targetLifecycle).toBe("new_established");
    expect(inspected.state.target?.conversationId).toBe("conversation-new");
    expect(inspected.state.target?.targetEstablishment?.causalSendActionId).toBe(
      Object.values(inspected.state.actions).find(action => action.kind === "send")?.actionId
    );

    const second = await service.submit(request(OPERATION_ID), [], adapter);
    expect(second.submission.kind).toBe("already_submitted");
    expect(mutate).toBe(1);
    expect(observe).toBe(1);
  });

  it("persists explicit transfer policy without persisting its request-local destination", async () => {
    const journal = await openJournal("capture-policy");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const transferRequest = {
      ...request(OTHER_OPERATION_ID),
      capture: {
        responseContent: "metadata" as const,
        responseFormat: "text" as const,
        artifacts: "transfer" as const,
        outputDirectory: "/private/request-local-output"
      }
    };
    const adapter = makeAdapter({
      executeFinalTabTransaction: async submission => ({
        status: "submitted" as const,
        targetBindingDigest: submission.expected.targetBindingDigest,
        evidenceDigest: digest("s"),
        userTurnId: "user-1",
        userTurnEvidenceDigest: digest("u"),
        postSendDeltaDigest: digest("d")
      })
    });
    const result = await service.submit(transferRequest, [], adapter);
    const inspected = await service.inspect(result.handle);
    expect(inspected.state.capturePolicy).toEqual({
      responseContent: "metadata",
      responseFormat: "text",
      artifacts: "transfer"
    });
    expect(JSON.stringify(inspected.state)).not.toContain("request-local-output");
    expect(JSON.stringify(await journal.load(OTHER_OPERATION_ID))).not.toContain("outputDirectory");
  });

  it("transfers each terminal artifact through the path-free service journal port", async () => {
    const journal = await openJournal("artifact-transfer-success");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const source = digest("f");
    const transferCalls: string[] = [];
    const transfer = {
      transfer: async (request: Parameters<NonNullable<OperationBrowserAdapter["artifacts"]>["transfer"]>[0]) => {
        transferCalls.push(JSON.stringify({ ...request, journal: "redacted" }));
        expect(JSON.stringify(request)).not.toContain("/private/request-local-output");
        const intent = transferIntent(request);
        await request.journal.persistIntent(intent);
        const receipt = transferReceipt(request, intent);
        await request.journal.persistReceipt(receipt);
        return {
          schemaVersion: "chatgpt.browser_control.artifact_transfer.v1" as const,
          outcome: "satisfied" as const,
          replayed: false,
          intentPersistence: "durable" as const,
          receiptPersistence: "durable" as const,
          receipt
        };
      }
    } satisfies NonNullable<OperationBrowserAdapter["artifacts"]>;
    const submitAdapter = makeAdapter();
    const transferRequest = {
      ...request(OPERATION_ID),
      capture: {
        responseContent: "metadata" as const,
        responseFormat: "text" as const,
        artifacts: "transfer" as const,
        outputDirectory: "/private/request-local-output"
      }
    };
    const submitted = await service.submit(transferRequest, [], submitAdapter);
    const sendActionId = Object.values((await service.inspect(submitted.handle)).state.actions)
      .find(action => action.kind === "send")?.actionId;
    expect(sendActionId).toBeDefined();
    const collectorAdapter = makeAdapter({
      collector: exactTerminalCollector(OPERATION_ID, sendActionId!, terminalArtifactObservation("text", "metadata")),
      artifacts: transfer
    });
    const collected = await service.collect(submitted.handle, collectorAdapter, { responseContent: "metadata", responseFormat: "text" });
    expect(collected.kind).toBe("completed");
    if (collected.kind !== "completed") throw new Error("expected completion");
    expect(collected.response.artifacts).toEqual([{
      kind: "file",
      ordinal: 0,
      sourceIdentityDigest: source,
      mimeType: "text/plain",
      bytes: 4,
      contentDigest: `sha256:${"a".repeat(64)}`,
      status: "transferred",
      outputKey: "artifact-0",
      sha256: "a".repeat(64)
    }]);
    expect(transferCalls).toHaveLength(1);
    const corpus = await durableCorpus(journal.stateRoot);
    expect(corpus).not.toContain("/private/request-local-output");
    expect(corpus).not.toContain("outputDirectory");
  });

  it("leaves zero-artifact transfer capture valid without invoking a provider", async () => {
    const journal = await openJournal("artifact-transfer-zero");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    let transferCalls = 0;
    const submitted = await service.submit({
      ...request(OPERATION_ID),
      capture: { responseContent: "include", responseFormat: "markdown", artifacts: "transfer", outputDirectory: "/tmp/unused" }
    }, [], makeAdapter());
    const sendActionId = Object.values((await service.inspect(submitted.handle)).state.actions)
      .find(action => action.kind === "send")?.actionId;
    const collected = await service.collect(submitted.handle, makeAdapter({
      collector: exactTerminalCollector(OPERATION_ID, sendActionId!, terminalObservation()),
      artifacts: { transfer: async () => {
        transferCalls += 1;
        throw new Error("must not be called");
      } }
    }), { responseFormat: "markdown" });
    expect(collected.kind).toBe("completed");
    expect(transferCalls).toBe(0);
    expect((await service.inspect(submitted.handle)).state.artifactTransfers).toEqual({});
  });

  it("closes a transfer as blocked when a restart has no request-local artifact adapter", async () => {
    const journal = await openJournal("artifact-transfer-restart");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const submitted = await service.submit({
      ...request(OPERATION_ID),
      capture: { responseContent: "include", responseFormat: "markdown", artifacts: "transfer", outputDirectory: "/private/restart-only" }
    }, [], makeAdapter());
    const sendActionId = Object.values((await service.inspect(submitted.handle)).state.actions)
      .find(action => action.kind === "send")?.actionId;
    const collected = await service.collect(
      submitted.handle,
      makeAdapter({ collector: exactTerminalCollector(OPERATION_ID, sendActionId!, terminalArtifactObservation()) }),
      { responseFormat: "markdown" }
    );
    expect(collected.kind).toBe("completed");
    if (collected.kind !== "completed") throw new Error("expected completion");
    expect(collected.response.artifacts[0]).toMatchObject({ status: "blocked", blockerCode: "artifact_transfer_unavailable" });
    const state = (await service.inspect(submitted.handle)).state;
    const transfer = Object.values(state.artifactTransfers ?? {})[0];
    expect(transfer?.intent?.destinationIdentityDigest).toMatch(/^hmac-sha256:/);
    expect(JSON.stringify(state)).not.toContain("restart-only");
  });

  it("recovers an intent-only transfer without asking the provider to retry", async () => {
    const journal = await openJournal("artifact-transfer-intent-only");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const submitted = await service.submit({
      ...request(OPERATION_ID),
      capture: { responseContent: "include", responseFormat: "markdown", artifacts: "transfer", outputDirectory: "/private/intent-only" }
    }, [], makeAdapter());
    const inspected = await service.inspect(submitted.handle);
    const sendActionId = Object.values(inspected.state.actions).find(action => action.kind === "send")?.actionId;
    const source = digest("f");
    await journal.append(OPERATION_ID, inspected.state.revision, {
      type: "phase_changed",
      from: inspected.state.phase,
      to: "capturing",
      mutationBoundary: inspected.state.mutationBoundary,
      ...(sendActionId === undefined ? {} : { causeActionId: sendActionId }),
      evidenceDigest: digest("c"),
      observedAt: AT
    });
    const capturing = await journal.load(OPERATION_ID);
    const transferActionId = "44444444-4444-4444-8444-444444444444";
    await journal.append(OPERATION_ID, capturing.state.revision, {
      type: "artifact_transfer_intent",
      intent: {
        schemaVersion: "chatgpt.browser_control.artifact_transfer_intent.v1",
        operationId: OPERATION_ID,
        requestDigest: capturing.state.requestDigest,
        targetBindingDigest: capturing.state.target === undefined ? "" : journal.handleFromState(capturing.state).targetBindingDigest!,
        assistantTurnId: "assistant-1",
        sourceIdentityDigest: source,
        kind: "file",
        ordinal: 0,
        transferActionId,
        destinationIdentityDigest: digest("d"),
        actionKind: "local_output_commit",
        repeatPolicy: "reconcile_local_effect",
        intentAt: AT
      }
    });
    const handle = journal.handleFromState((await journal.load(OPERATION_ID)).state);
    let transferCalls = 0;
    const collected = await service.collect(handle, makeAdapter({
      collector: exactTerminalCollector(OPERATION_ID, sendActionId!, terminalArtifactObservation()),
      artifacts: { transfer: async () => {
        transferCalls += 1;
        throw new Error("the source must not be retried");
      } }
    }), { responseFormat: "markdown" });
    expect(collected.kind).toBe("completed");
    if (collected.kind !== "completed") throw new Error("expected completion");
    expect(collected.response.artifacts[0]).toMatchObject({ status: "partial", blockerCode: "artifact_transfer_partial" });
    expect(transferCalls).toBe(0);
  });

  it("converges concurrent terminal collectors to one adapter transfer", async () => {
    const journal = await openJournal("artifact-transfer-concurrent");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const submitted = await service.submit({
      ...request(OPERATION_ID),
      capture: { responseContent: "include", responseFormat: "markdown", artifacts: "transfer", outputDirectory: "/private/concurrent" }
    }, [], makeAdapter());
    const sendActionId = Object.values((await service.inspect(submitted.handle)).state.actions)
      .find(action => action.kind === "send")?.actionId;
    let transferCalls = 0;
    const artifacts = {
      transfer: async (request: Parameters<NonNullable<OperationBrowserAdapter["artifacts"]>["transfer"]>[0]) => {
        transferCalls += 1;
        const intent = transferIntent(request);
        await request.journal.persistIntent(intent);
        const receipt = transferReceipt(request, intent);
        await request.journal.persistReceipt(receipt);
        return {
          schemaVersion: "chatgpt.browser_control.artifact_transfer.v1" as const,
          outcome: "satisfied" as const,
          replayed: false,
          intentPersistence: "durable" as const,
          receiptPersistence: "durable" as const,
          receipt
        };
      }
    } satisfies NonNullable<OperationBrowserAdapter["artifacts"]>;
    let collectorObservations = 0;
    let releaseCollectorBarrier!: () => void;
    const bothCollectorsObserved = new Promise<void>(resolve => {
      releaseCollectorBarrier = resolve;
    });
    const collector = exactTerminalCollector(OPERATION_ID, sendActionId!, terminalArtifactObservation());
    const adapter = makeAdapter({
      collector: {
        ...collector,
        observe: async request => {
          collectorObservations += 1;
          if (collectorObservations === 2) releaseCollectorBarrier();
          await bothCollectorsObserved;
          return await collector.observe(request);
        }
      },
      artifacts
    });
    const results = await Promise.all([
      service.collect(submitted.handle, adapter, { responseFormat: "markdown" }),
      service.collect(submitted.handle, adapter, { responseFormat: "markdown" })
    ]);
    expect(results.every(result => result.kind === "completed")).toBe(true);
    expect(collectorObservations).toBe(2);
    expect(transferCalls).toBe(1);
  });

  it("projects a receipt when the adapter commits it and then throws", async () => {
    const journal = await openJournal("artifact-transfer-commit-throw");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const submitted = await service.submit({
      ...request(OPERATION_ID),
      capture: { responseContent: "include", responseFormat: "markdown", artifacts: "transfer", outputDirectory: "/private/commit-throw" }
    }, [], makeAdapter());
    const sendActionId = Object.values((await service.inspect(submitted.handle)).state.actions)
      .find(action => action.kind === "send")?.actionId;
    let transferCalls = 0;
    const collected = await service.collect(submitted.handle, makeAdapter({
      collector: exactTerminalCollector(OPERATION_ID, sendActionId!, terminalArtifactObservation()),
      artifacts: { transfer: async request => {
        transferCalls += 1;
        const intent = transferIntent(request);
        await request.journal.persistIntent(intent);
        await request.journal.persistReceipt(transferReceipt(request, intent));
        throw new Error("lost acknowledgement after receipt commit");
      } }
    }), { responseFormat: "markdown" });
    expect(collected.kind).toBe("completed");
    if (collected.kind !== "completed") throw new Error("expected completion");
    expect(collected.response.artifacts[0]?.status).toBe("transferred");
    expect(transferCalls).toBe(1);
  });

  it("rejects same operation ID with a different immutable request digest", async () => {
    const journal = await openJournal("identity");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const adapter = makeAdapter();
    await service.submit(request(OPERATION_ID), [], adapter);
    const mismatchedResolve = vi.fn(async () => ({ target: target() }));
    const mismatchedAdapter = makeAdapter({ resolveTarget: mismatchedResolve });
    await expect(service.submit({ ...request(OPERATION_ID), prompt: "different private intent" }, [], mismatchedAdapter)).rejects.toMatchObject({
      code: "operation_request_mismatch"
    });
    expect(mismatchedResolve).not.toHaveBeenCalled();
  });

  it("returns a durable unbound handle when read-only target resolution is blocked, then resumes", async () => {
    const journal = await openJournal("target-blocked");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const unsafeError = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(unsafeError, "code", {
      value: "browser_bridge_unavailable",
      enumerable: true
    });
    Object.defineProperty(unsafeError, "message", {
      get: () => {
        throw new Error("the adapter error message must never be read");
      }
    });
    const blockedAdapter = makeAdapter({
      resolveTarget: vi.fn(async () => {
        throw unsafeError;
      })
    });

    const blocked = await service.submit(request(OPERATION_ID), [], blockedAdapter);

    expect(blocked.handle).toMatchObject({
      operationId: OPERATION_ID,
      phase: "prepared",
      mutationBoundary: "none"
    });
    expect(blocked.handle.targetBindingDigest).toBeUndefined();
    expect(blocked.submission).toMatchObject({
      operationId: OPERATION_ID,
      kind: "blocked",
      blocker: {
        code: "browser_bridge_unavailable",
        mutationBoundary: "none",
        observationRequired: true
      }
    });
    expect(blocked.submission.targetBindingDigest).toBeUndefined();
    expect(blockedAdapter.submission.executeFinalTabTransaction).not.toHaveBeenCalled();
    expect((await service.inspect(blocked.handle)).state.lastBlocker?.code).toBe("browser_bridge_unavailable");

    const resumed = await service.submit(request(OPERATION_ID), [], makeAdapter());
    expect(resumed.handle.operationId).toBe(blocked.handle.operationId);
    expect(resumed.handle.requestDigest).toBe(blocked.handle.requestDigest);
    expect(resumed.handle.targetBindingDigest).toMatch(/^hmac-sha256:/);
    expect(resumed.submission.kind).toBe("submitted");
  });

  it("maps native journal failures to a fixed message without exposing provider paths", async () => {
    const journal = await openJournal("service-error-redaction");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const operationRequest = request(OPERATION_ID);
    const requestDigest = journal.submitRequestDigest(operationRequest, []);
    const created = await journal.create({
      type: "operation_created",
      operationId: OPERATION_ID,
      requestDigest,
      surface: operationRequest.surface,
      createdAt: AT
    });
    const handle = journal.handleFromState(created.state);
    const secret = "/example/user/Private/provider-account/token-7f3e.json";
    vi.spyOn(journal, "load").mockRejectedValue(new Error(`provider rejected ${secret}`));

    await expect(service.inspect(handle)).rejects.toMatchObject({
      code: "invalid_operation_handle",
      message: "Operation handle could not be validated."
    });
    await expect(service.inspect(handle)).rejects.not.toThrow(secret);
  });

  it("does not preserve an unrecognized journal error code across the service boundary", async () => {
    const journal = await openJournal("service-error-code-redaction");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const operationRequest = request(OPERATION_ID);
    const requestDigest = journal.submitRequestDigest(operationRequest, []);
    const created = await journal.create({
      type: "operation_created",
      operationId: OPERATION_ID,
      requestDigest,
      surface: operationRequest.surface,
      createdAt: AT
    });
    const handle = journal.handleFromState(created.state);
    const secretCode = "private_provider_path_users_alice_token";
    vi.spyOn(journal, "load").mockRejectedValue(new OperationJournalError(secretCode, "private native detail"));

    await expect(service.inspect(handle)).rejects.toMatchObject({
      code: "invalid_operation_handle",
      message: "Operation handle could not be validated."
    });
    await expect(service.inspect(handle)).rejects.not.toThrow(secretCode);
  });

  it("validates a handle against fresh durable state and keeps inspect browser-free", async () => {
    const journal = await openJournal("handle");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const adapter = makeAdapter();
    const result = await service.submit(request(OPERATION_ID), [], adapter);
    const tampered = { ...result.handle, targetBindingDigest: digest("x") };
    await expect(service.inspect(tampered)).rejects.toMatchObject({ code: "invalid_operation_handle" });
    const resolver = vi.spyOn(adapter, "resolveTarget");
    resolver.mockClear();
    await service.inspect(result.handle);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("converges identical new-target establishment and preserves the pre-Send handle digest", async () => {
    const journal = await openJournal("new-establishment");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const { requestDigest, handle } = await seedNewPendingSend(journal);
    const establishment = {
      operationId: OPERATION_ID,
      requestDigest,
      targetBindingDigest: handle.targetBindingDigest!,
      anchorDigest: digest("a"),
      causalSendActionId: SEND_ACTION_ID,
      conversationId: "conversation-new",
      canonicalThreadUrl: "https://chatgpt.com/c/conversation-new",
      userTurnId: "user-new",
      userTurnEvidenceDigest: digest("u"),
      postSendDeltaDigest: digest("d"),
      evidenceDigest: digest("e")
    } as const;

    const [first, second] = await Promise.all([
      service.establishTarget(establishment),
      service.establishTarget(establishment)
    ]);
    expect(first.handle.targetBindingDigest).toBe(handle.targetBindingDigest);
    expect(second.handle.targetBindingDigest).toBe(handle.targetBindingDigest);
    expect(second.state.revision).toBe(first.state.revision);
    expect(second.state.target?.targetLifecycle).toBe("new_established");
    expect(second.state.target?.targetEstablishment?.userTurnId).toBe("user-new");

    await expect(service.establishTarget({ ...establishment, conversationId: "conversation-other" }))
      .rejects.toMatchObject({ code: "target_establishment_conflict" });
  });

  it("requires the exact pending handle and durable Send action for new-target establishment", async () => {
    const journal = await openJournal("new-establishment-guards");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const operationRequest = request(OPERATION_ID);
    const requestDigest = journal.submitRequestDigest(operationRequest, []);
    let created = await journal.create({
      type: "operation_created",
      operationId: OPERATION_ID,
      requestDigest,
      surface: "chat",
      createdAt: AT
    });
    created = await journal.append(OPERATION_ID, created.state.revision, { type: "target_bound", target: newPendingTarget(), observedAt: AT });
    const handle = journal.handleFromState(created.state);
    await expect(service.establishTarget({
      operationId: OPERATION_ID,
      requestDigest,
      targetBindingDigest: handle.targetBindingDigest!,
      anchorDigest: digest("a"),
      causalSendActionId: SEND_ACTION_ID,
      conversationId: "conversation-new",
      canonicalThreadUrl: "https://chatgpt.com/c/conversation-new",
      userTurnId: "user-new",
      userTurnEvidenceDigest: digest("u"),
      postSendDeltaDigest: digest("d"),
      evidenceDigest: digest("e")
    })).rejects.toMatchObject({ code: "target_establishment_send_missing" });

    await expect(service.establishTarget({
      operationId: OPERATION_ID,
      requestDigest,
      targetBindingDigest: handle.targetBindingDigest!,
      anchorDigest: digest("a"),
      causalSendActionId: SEND_ACTION_ID,
      conversationId: "conversation-new",
      canonicalThreadUrl: "https://chatgpt.com/c/conversation-new",
      userTurnId: "user-new",
      userTurnEvidenceDigest: digest("u"),
      postSendDeltaDigest: digest("d"),
      evidenceDigest: digest("e"),
      prompt: "private prompt must not cross the identity boundary"
    } as OperationTargetEstablishmentRequest & Record<string, unknown>)).rejects.toMatchObject({ code: "invalid_target_establishment" });
  });

  it("rejects accessor-backed target establishment without invoking private getters", async () => {
    const journal = await openJournal("new-establishment-accessor");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    let reads = 0;
    const hostile = Object.defineProperty({}, "operationId", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("private provider value");
      }
    });

    await expect(service.establishTarget(hostile as OperationTargetEstablishmentRequest))
      .rejects.toMatchObject({ code: "invalid_target_establishment" });
    expect(reads).toBe(0);
  });

  it("recovers a durable append fault without repeating the Send action", async () => {
    let recordCount = 0;
    let injected = false;
    const root = await mkdtemp(join(tmpdir(), "codex-operation-service-fault-"));
    const journal = await OperationJournal.open({
      stateRoot: root,
      faultInjector: point => {
        if (point === "after_record_written" && ++recordCount === 3) {
          injected = true;
          throw new Error("simulated post-write crash");
        }
      }
    });
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    let mutate = 0;
    const adapter = makeAdapter({
      executeFinalTabTransaction: async request => {
        if (request.mode === "mutate_once") mutate += 1;
        return request.mode === "mutate_once"
          ? {
              status: "submitted",
              targetBindingDigest: request.expected.targetBindingDigest,
              evidenceDigest: digest("s"),
              userTurnId: "user-1",
              userTurnEvidenceDigest: digest("u"),
              postSendDeltaDigest: digest("d")
            }
          : {
              status: "already_submitted",
              targetBindingDigest: request.expected.targetBindingDigest,
              evidenceDigest: digest("s"),
              userTurnId: "user-1",
              userTurnEvidenceDigest: digest("u"),
              postSendDeltaDigest: digest("d")
            };
      }
    });
    const result = await service.submit(request(OTHER_OPERATION_ID), [], adapter);
    expect(injected).toBe(true);
    expect(result.submission.kind).toBe("submitted");
    expect(mutate).toBe(1);
    expect((await service.inspect(result.handle)).state.phase).toBe("submitted");
  });

  it("never activates Send when the atomic prepared event commits but its acknowledgement is lost", async () => {
    const journal = await openJournal("prepared-send-commit-then-throw");
    const append = journal.append.bind(journal);
    let injected = false;
    vi.spyOn(journal, "append").mockImplementation(async (operationId, expectedRevision, event) => {
      const loaded = await append(operationId, expectedRevision, event);
      if (!injected && event.type === "action_prepared" && event.action.kind === "send") {
        injected = true;
        throw new Error("simulated lost action_prepared acknowledgement");
      }
      return loaded;
    });

    let activations = 0;
    let recoveries = 0;
    const adapter = makeAdapter({
      submission: {
        executePreparedSend: vi.fn(async () => {
          activations += 1;
          return {
            status: "activated",
            activation: "activated",
            mutationMayHaveOccurred: true
          } as const;
        }),
        recoverSend: vi.fn(async () => {
          recoveries += 1;
          return { status: "uncertain", quarantine: "provider" } as const;
        })
      }
    });

    const result = await new OperationService(journal, { now: () => Date.parse(AT) })
      .submit(request(OPERATION_ID), [], adapter);

    expect(injected).toBe(true);
    expect(activations).toBe(0);
    expect(recoveries).toBe(1);
    expect(result.submission).toMatchObject({
      kind: "uncertain",
      blocker: { mutationBoundary: "send_may_have_occurred" }
    });
    const loaded = await journal.load(OPERATION_ID);
    expect(Object.values(loaded.state.actions).filter(action => action.kind === "send")).toHaveLength(1);
    expect(loaded.state.ownershipBaseline).toBeDefined();
  });

  it("collects the exact owned turn and verifies the terminal receipt before returning", async () => {
    const journal = await openJournal("collect");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    let submissionActionId: string | undefined;
    const adapter = makeAdapter({
      executeFinalTabTransaction: async request => {
        submissionActionId = request.actionId;
        return {
          status: "submitted",
          targetBindingDigest: request.expected.targetBindingDigest,
          evidenceDigest: digest("s"),
          userTurnId: "user-1",
          userTurnEvidenceDigest: digest("u"),
          postSendDeltaDigest: digest("d")
        };
      },
      collector: {
        readContext: async context => {
          const target = ownershipTarget();
          const userDigest = digest("u");
          return {
            binding: {
              schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
              operationId: OPERATION_ID,
              targetBindingDigest: context.targetBindingDigest,
              target,
              evidenceProfile: {
                stableConversationId: "required",
                stableUserTurnId: "required",
                stableAssistantTurnId: "required",
                stableBranchId: "required",
                authoritativeTabClaim: "required"
              },
              replacementTabRecovery: true,
              actionId: context.submissionActionId ?? submissionActionId!,
              actionKind: "send"
            },
            baseline: {
              schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
              snapshotDigest: digest("b"),
              target,
              userTurns: [],
              assistantTurns: [],
              completeness: "complete"
            },
            submissionWitness: {
              actionId: context.submissionActionId ?? submissionActionId!,
              actionKind: "send",
              baselineSnapshotDigest: digest("b"),
              postSendDeltaDigest: digest("d"),
              operationUserEvidenceDigest: userDigest
            }
          };
        },
        observe: async () => terminalObservation(),
        sleep: async () => undefined
      }
    });
    const submitted = await service.submit(request(OPERATION_ID), [], adapter);
    const collected = await service.collect(submitted.handle, adapter, { responseContent: "include" });

    expect(collected.kind).toBe("completed");
    const inspected = await service.inspect(submitted.handle);
    expect(inspected.state.phase).toBe("completed");
    expect(inspected.state.receipt?.assistantTurnId).toBe("assistant-1");
    const corpus = await durableCorpus(journal.stateRoot);
    expect(corpus).not.toContain("secret response");
    expect(corpus).not.toContain("/private/");
  });

  it("persists exact generating ownership so a fresh handle can authorize control", async () => {
    const journal = await openJournal("collect-generating");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    let submissionActionId: string | undefined;
    const adapter = makeAdapter({
      executeFinalTabTransaction: async request => {
        submissionActionId = request.actionId;
        return {
          status: "submitted",
          targetBindingDigest: request.expected.targetBindingDigest,
          evidenceDigest: digest("s"),
          userTurnId: "user-1",
          userTurnEvidenceDigest: digest("u"),
          postSendDeltaDigest: digest("d"),
          assistantTurnId: "assistant-1"
        };
      },
      collector: {
        readContext: async context => ownershipContext(
          OPERATION_ID,
          context.targetBindingDigest,
          context.submissionActionId ?? submissionActionId!
        ),
        observe: async () => generatingObservation(),
        sleep: async () => undefined
      }
    });
    const submitted = await service.submit(request(OPERATION_ID), [], adapter);

    const collected = await service.collect(submitted.handle, adapter);

    expect(collected).toMatchObject({ kind: "pending", phase: "generating" });
    const inspected = await service.inspect(submitted.handle);
    expect(inspected.handle.phase).toBe("generating");
    expect(inspected.state.actions[submissionActionId!]).toMatchObject({
      kind: "send",
      outcome: "satisfied"
    });
  });

  it.each(["ready", "send_pending"] as const)(
    "persists a terminal receipt through the legal Send crash-gap sequence from %s",
    async phase => {
      const journal = await openJournal(`collect-crash-gap-${phase}`);
      const service = new OperationService(journal, { now: () => Date.parse(AT) });
      const handle = await seedSendIntent(journal, phase);
      const adapter = makeAdapter({ collector: exactTerminalCollector(OPERATION_ID, SEND_ACTION_ID) });

      const result = await service.collect(handle, adapter, { responseContent: "include" });
      expect(result.kind).toBe("completed");
      const inspected = await service.inspect(handle);
      expect(inspected.state.phase).toBe("completed");
      expect(inspected.state.actions[SEND_ACTION_ID]).toMatchObject({ kind: "send", outcome: "satisfied" });
    }
  );

  it("allows concurrent callers to converge on one non-repeatable Send", async () => {
    const journal = await openJournal("concurrent");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    let mutate = 0;
    const adapter = makeAdapter({
      executeFinalTabTransaction: async request => {
        if (request.mode === "mutate_once") {
          mutate += 1;
          await new Promise(resolve => setTimeout(resolve, 5));
          return {
            status: "submitted",
            targetBindingDigest: request.expected.targetBindingDigest,
            evidenceDigest: digest("s"),
            userTurnId: "user-1",
            userTurnEvidenceDigest: digest("u"),
            postSendDeltaDigest: digest("d")
          };
        }
        return {
          status: "already_submitted",
          targetBindingDigest: request.expected.targetBindingDigest,
          evidenceDigest: digest("s"),
          userTurnId: "user-1",
          userTurnEvidenceDigest: digest("u"),
          postSendDeltaDigest: digest("d")
        };
      }
    });
    const results = await Promise.all([
      service.submit(request(OPERATION_ID), [], adapter),
      service.submit(request(OPERATION_ID), [], adapter)
    ]);
    expect(mutate).toBe(1);
    expect(results.some(result => result.submission.kind === "submitted" || result.submission.kind === "already_submitted")).toBe(true);
    expect((await service.inspect(results[0]!.handle)).state.phase).toBe("submitted");
  });

  it("keeps a pre-mutation staging blocker orthogonal to the durable phase", async () => {
    const journal = await openJournal("pre-mutation-blocker");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const adapter = makeAdapter({
      submission: {
        observeStaging: async () => ({ status: "mismatch", reason: "composer", evidenceDigest: digest("m") } satisfies SubmissionStageObservation),
        executeFileHandoffOnce: async request => ({ status: "satisfied", evidenceDigest: digest("h") }),
        observeAttachments: async () => ({ status: "absent", evidenceDigest: digest("a"), count: 0, orderPolicy: "exact", identityDigests: [] }),
        executeFinalTabTransaction: async request => ({
          status: "submitted",
          targetBindingDigest: request.expected.targetBindingDigest,
          evidenceDigest: digest("s"),
          userTurnId: "user-1",
          userTurnEvidenceDigest: digest("u"),
          postSendDeltaDigest: digest("d")
        })
      }
    });
    const result = await service.submit(request(OPERATION_ID), [], adapter);
    expect(result.submission.kind).toBe("blocked");
    const state = (await service.inspect(result.handle)).state;
    expect(state.phase).toBe("prepared");
    expect(state.mutationBoundary).toBe("none");
    expect(Object.keys(state.actions)).toHaveLength(0);
    expect(state.lastBlocker?.code).toBe("composer_drift");
  });

  it("journals each requested set-to-value stage before Send and preserves only keyed evidence", async () => {
    const journal = await openJournal("staging-integration");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const satisfied = new Set<string>();
    const order: string[] = [];
    const adapter = makeAdapter({
      staging: {
        readCurrent: vi.fn(async stage => ({
          status: "not_satisfied",
          desiredStateDigest: stage.desiredStateDigest,
          currentStateDigest: digest("1"),
          evidenceDigest: digest("2")
        } satisfies OperationStagingObservation)),
        mutateOnce: vi.fn(async stage => {
          order.push(`mutate:${stage.kind}`);
          satisfied.add(stage.kind);
          return { status: "started" } satisfies OperationStagingMutationResult;
        }),
        observe: vi.fn(async stage => ({
          status: satisfied.has(stage.kind) ? "satisfied" : "not_satisfied",
          desiredStateDigest: stage.desiredStateDigest,
          currentStateDigest: satisfied.has(stage.kind) ? stage.desiredStateDigest : digest("3"),
          evidenceDigest: digest("4")
        } satisfies OperationStagingObservation))
      },
      executeFinalTabTransaction: vi.fn(async final => {
        order.push("send");
        return {
          status: "submitted",
          targetBindingDigest: final.expected.targetBindingDigest,
          evidenceDigest: digest("5"),
          userTurnId: "user-1",
          userTurnEvidenceDigest: digest("6"),
          postSendDeltaDigest: digest("d")
        } satisfies SubmissionFinalTransactionResult;
      })
    });

    const result = await service.submit({
      ...request(OPERATION_ID),
      configuration: { model: "private-model-label" }
    }, [], adapter);

    expect(result.submission.kind).toBe("submitted");
    expect(order).toEqual(["mutate:configuration_set", "mutate:composer_set", "send"]);
    const state = (await service.inspect(result.handle)).state;
    expect(Object.values(state.actions).filter(action => action.kind === "configuration_set")).toHaveLength(1);
    expect(Object.values(state.actions).filter(action => action.kind === "composer_set")).toHaveLength(1);
    expect(Object.values(state.actions).every(action => action.outcome === "satisfied")).toBe(true);
    const corpus = await durableCorpus(journal.stateRoot);
    expect(corpus).not.toContain("private-model-label");
    expect(corpus).not.toContain("private prompt");
  });

  it("returns and records uncertain staging without crossing a non-repeatable boundary", async () => {
    const journal = await openJournal("staging-uncertain");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    let mutationAttempted = false;
    const send = vi.fn(async final => ({
      status: "submitted",
      targetBindingDigest: final.expected.targetBindingDigest,
      evidenceDigest: digest("5"),
      userTurnId: "user-1",
      userTurnEvidenceDigest: digest("6"),
      postSendDeltaDigest: digest("d")
    } satisfies SubmissionFinalTransactionResult));
    const adapter = makeAdapter({
      staging: {
        readCurrent: async stage => ({
          status: "not_satisfied",
          desiredStateDigest: stage.desiredStateDigest,
          currentStateDigest: digest("1"),
          evidenceDigest: digest("2")
        }),
        mutateOnce: async () => {
          mutationAttempted = true;
          return { status: "started" };
        },
        observe: async stage => mutationAttempted
          ? {
              status: "uncertain",
              desiredStateDigest: stage.desiredStateDigest,
              blockerCode: "selector_drift",
              evidenceDigest: digest("3")
            }
          : {
              status: "not_satisfied",
              desiredStateDigest: stage.desiredStateDigest,
              currentStateDigest: digest("1"),
              evidenceDigest: digest("2")
            }
      },
      executeFinalTabTransaction: send
    });

    const result = await service.submit(request(OPERATION_ID), [], adapter);

    expect(result.submission).toMatchObject({
      kind: "uncertain",
      blocker: { code: "composer_drift", mutationBoundary: "none", observationRequired: true }
    });
    expect(send).not.toHaveBeenCalled();
    const state = (await service.inspect(result.handle)).state;
    expect(state.phase).toBe("prepared");
    expect(state.mutationBoundary).toBe("none");
    expect(state.lastBlocker?.code).toBe("composer_drift");
    expect(Object.values(state.actions)).toEqual([
      expect.objectContaining({ kind: "composer_set", outcome: "uncertain" })
    ]);
  });

  it("serializes concurrent first staging intents so a set-to-value mutation and Send each run at most once", async () => {
    const journal = await openJournal("concurrent-staging");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    let releaseReads!: () => void;
    const bothReading = new Promise<void>(resolve => { releaseReads = resolve; });
    let reads = 0;
    let staged = false;
    let stageMutations = 0;
    let sendMutations = 0;
    const adapter = makeAdapter({
      staging: {
        readCurrent: async stage => {
          reads += 1;
          if (reads === 2) releaseReads();
          await bothReading;
          return {
            status: "not_satisfied",
            desiredStateDigest: stage.desiredStateDigest,
            currentStateDigest: digest("1"),
            evidenceDigest: digest("2")
          };
        },
        mutateOnce: async () => {
          stageMutations += 1;
          staged = true;
          return { status: "started" };
        },
        observe: async stage => ({
          status: staged ? "satisfied" : "not_satisfied",
          desiredStateDigest: stage.desiredStateDigest,
          currentStateDigest: staged ? stage.desiredStateDigest : digest("1"),
          evidenceDigest: digest("2")
        })
      },
      executeFinalTabTransaction: async final => {
        if (final.mode === "mutate_once") sendMutations += 1;
        return {
          status: final.mode === "mutate_once" ? "submitted" : "already_submitted",
          targetBindingDigest: final.expected.targetBindingDigest,
          evidenceDigest: digest("5"),
          userTurnId: "user-1",
          userTurnEvidenceDigest: digest("6"),
          postSendDeltaDigest: digest("d")
        };
      }
    });

    const results = await Promise.all([
      service.submit(request(OPERATION_ID), [], adapter),
      service.submit(request(OPERATION_ID), [], adapter)
    ]);

    expect(stageMutations).toBe(1);
    expect(sendMutations).toBe(1);
    expect(results.some(result => result.submission.kind === "submitted" || result.submission.kind === "already_submitted")).toBe(true);
    const state = (await service.inspect(results[0]!.handle)).state;
    expect(Object.values(state.actions).filter(action => action.kind === "send")).toHaveLength(1);
    expect(Object.values(state.actions).filter(action => action.kind === "composer_set" && action.outcome === undefined)).toHaveLength(0);
  });

  it("keeps a proven post-intent precondition blocker orthogonal while the Send intent prevents replay", async () => {
    const journal = await openJournal("post-intent-blocker");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const adapter = makeAdapter({
      executeFinalTabTransaction: vi.fn(async () => ({
        status: "blocked",
        blockerCode: "configuration_drift",
        evidenceDigest: digest("m")
      } satisfies SubmissionFinalTransactionResult))
    });

    const result = await service.submit(request(OPERATION_ID), [], adapter);

    expect(result.submission).toMatchObject({ kind: "blocked", blocker: { code: "configuration_drift" } });
    const state = (await service.inspect(result.handle)).state;
    expect(state.phase).toBe("send_pending");
    expect(state.mutationBoundary).toBe("send_may_have_occurred");
    expect(state.lastBlocker?.code).toBe("configuration_drift");
    expect(Object.values(state.actions).filter(action => action.kind === "send")).toHaveLength(1);
    await service.submit(request(OPERATION_ID), [], adapter);
    expect(adapter.submission.executePreparedSend).toHaveBeenCalledTimes(1);
    expect(adapter.submission.recoverSend).toHaveBeenCalledTimes(1);
    expect(adapter.submission.executeFinalTabTransaction).not.toHaveBeenCalled();
  });

  it("durably enters uncertain only when the post-intent outcome is actually ambiguous", async () => {
    const journal = await openJournal("ambiguous-submit");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const adapter = makeAdapter({
      executeFinalTabTransaction: vi.fn(async () => ({
        status: "uncertain",
        quarantine: "provider",
        evidenceDigest: digest("m")
      } satisfies SubmissionFinalTransactionResult))
    });

    const result = await service.submit(request(OPERATION_ID), [], adapter);

    expect(result.submission).toMatchObject({ kind: "uncertain", blocker: { code: "ambiguous_submit" } });
    const state = (await service.inspect(result.handle)).state;
    expect(state.phase).toBe("uncertain");
    expect(state.lastBlocker?.code).toBe("ambiguous_submit");
  });

  it("does not persist raw request or response material", async () => {
    const journal = await openJournal("privacy");
    const service = new OperationService(journal, { now: () => Date.parse(AT) });
    const adapter = makeAdapter({
      executeFinalTabTransaction: async request => ({
        status: "submitted",
        targetBindingDigest: request.expected.targetBindingDigest,
        evidenceDigest: digest("s"),
        userTurnId: "user-1",
        userTurnEvidenceDigest: digest("u"),
        postSendDeltaDigest: digest("d")
      })
    });
    await service.submit({ ...request(OPERATION_ID), prompt: "private prompt alpha" }, [], adapter);
    const corpus = await durableCorpus(journal.stateRoot);
    expect(corpus).not.toContain("private prompt alpha");
    expect(corpus).not.toContain("secret response");
  });
});

function request(operationId: string) {
  return {
    schemaVersion: OPERATION_REQUEST_SCHEMA_VERSION,
    operationId,
    surface: "chat" as const,
    prompt: "private prompt",
    target: { type: "new" as const }
  };
}

function workRequest(operationId: string) {
  return {
    ...request(operationId),
    surface: "work" as const
  };
}

function controlRequest(parent: OperationHandleV1, controlActionId: string): OperationControlRequestV1 {
  return {
    schemaVersion: OPERATION_CONTROL_REQUEST_SCHEMA_VERSION,
    controlActionId,
    parent,
    action: "steer",
    expectedAssistantTurnId: "assistant-1",
    steerPrompt: "request-local steer prompt",
    timeoutMs: 5_000
  };
}

function makePreparedSteer(
  journal: OperationJournal,
  request: ControlSteerPrepareRequest,
  baseline = makeSteerBaseline(steerTarget())
): ControlSteerPrepared {
  const material = controlSteerPreparedDigestMaterial({
    parentOperationId: request.parentOperationId,
    parentRequestDigest: request.parentRequestDigest,
    parentTargetBindingDigest: request.parentTargetBindingDigest,
    controlActionId: request.controlActionId,
    expectedAssistantTurnId: request.expectedAssistantTurnId,
    assistantBranchId: "branch-steer-1",
    assistantParentTurnId: "user-parent-1",
    baselineSnapshotDigest: baseline.snapshotDigest,
    baseline
  });
  return {
    schemaVersion: CONTROL_COORDINATOR_SCHEMA_VERSION,
    parentOperationId: request.parentOperationId,
    parentRequestDigest: request.parentRequestDigest,
    parentTargetBindingDigest: request.parentTargetBindingDigest,
    controlActionId: request.controlActionId,
    action: "steer",
    requestDigest: request.requestDigest,
    expectedAssistantTurnId: request.expectedAssistantTurnId,
    assistantBranchId: "branch-steer-1",
    assistantParentTurnId: "user-parent-1",
    baselineSnapshotDigest: baseline.snapshotDigest,
    preparedDigest: journal.evidenceDigest("work-steer-prepared", material),
    baseline
  };
}

function preparedSteerPhase(prepared: ControlSteerPrepared): ControlSteerPhaseResult {
  return {
    ...steerPhaseIdentity(prepared),
    phase: "prepare",
    status: "prepared",
    observationRequired: false,
    mutationBoundary: "none",
    prepared
  };
}

function executedSteerPhase(prepared: ControlSteerPrepared): ControlSteerPhaseResult {
  return {
    ...steerPhaseIdentity(prepared),
    phase: "execute_prepared",
    status: "executed",
    observationRequired: true,
    mutationBoundary: "control_may_have_occurred"
  };
}

function satisfiedSteerPhase(
  prepared: ControlSteerPrepared,
  phase: "verify" | "recovery",
  details: Readonly<{
    userTurnId: string;
    userTurnEvidenceDigest: string;
    postSendDeltaDigest: string;
    evidenceDigest: string;
  }> = {
    userTurnId: "user-steer-1",
    userTurnEvidenceDigest: digest("u"),
    postSendDeltaDigest: digest("d"),
    evidenceDigest: digest("e")
  }
): ControlSteerPhaseResult {
  const receipt = {
    schemaVersion: CONTROL_COORDINATOR_SCHEMA_VERSION,
    baselineSnapshotDigest: prepared.baselineSnapshotDigest,
    preparedDigest: prepared.preparedDigest,
    assistantTurnId: prepared.expectedAssistantTurnId,
    assistantBranchId: prepared.assistantBranchId,
    assistantParentTurnId: prepared.assistantParentTurnId,
    userTurnId: details.userTurnId,
    userTurnEvidenceDigest: details.userTurnEvidenceDigest,
    postSendDeltaDigest: details.postSendDeltaDigest,
    evidenceDigest: details.evidenceDigest
  };
  return {
    ...steerPhaseIdentity(prepared),
    phase,
    status: "satisfied",
    observationRequired: false,
    mutationBoundary: "control_may_have_occurred",
    receipt
  };
}

function steerPhaseIdentity(prepared: ControlSteerPrepared) {
  return {
    schemaVersion: CONTROL_COORDINATOR_SCHEMA_VERSION,
    parentOperationId: prepared.parentOperationId,
    parentRequestDigest: prepared.parentRequestDigest,
    parentTargetBindingDigest: prepared.parentTargetBindingDigest,
    controlActionId: prepared.controlActionId,
    action: "steer" as const,
    requestDigest: prepared.requestDigest,
    expectedAssistantTurnId: prepared.expectedAssistantTurnId,
    assistantBranchId: prepared.assistantBranchId,
    assistantParentTurnId: prepared.assistantParentTurnId,
    baselineSnapshotDigest: prepared.baselineSnapshotDigest,
    preparedDigest: prepared.preparedDigest
  };
}

function target(): OperationTargetBindingV1 {
  return {
    providerId: "provider-1",
    browserId: "browser-1",
    tabId: "tab-1",
    coordinationScope: "process",
    canonicalThreadUrl: "https://chatgpt.com/c/conversation-1",
    conversationId: "conversation-1",
    evidenceProfile: {
      providerIdentity: "required",
      stableTabId: "required",
      stableConversationId: "required",
      stableUserTurnId: "required",
      authoritativeTabClaim: "required",
      replacementTabRecovery: true
    }
  };
}

function steerTarget(): OperationTargetBindingV1 {
  const { canonicalThreadUrl: _canonicalThreadUrl, ...binding } = target();
  return binding;
}

function makeBaseline(binding: OperationTargetBindingV1): OwnershipBaseline {
  const available = (value: string) => ({ status: "available" as const, value });
  const unavailable = (reason: "not_exposed" | "not_observed" | "redacted" = "not_observed") => ({
    status: "unavailable" as const,
    reason
  });
  const targetEvidence: OwnershipTargetEvidence = {
    provider: available(binding.providerId),
    browser: available(binding.browserId),
    tab: available(binding.tabId),
    // The provider adapter's collector binding exposes the stable thread and
    // claim identities even though the operation target only stores the
    // conversation-level binding fields.
    thread: binding.conversationId === undefined ? unavailable() : available("thread-1"),
    conversation: binding.conversationId === undefined ? unavailable() : available(binding.conversationId),
    canonicalThreadUrl: binding.canonicalThreadUrl === undefined ? unavailable() : available(binding.canonicalThreadUrl),
    authoritativeTabClaim: binding.evidenceProfile.authoritativeTabClaim === "required"
      ? available("claim-1")
      : unavailable("not_exposed"),
    coordinationScope: binding.coordinationScope
  };
  return {
    schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
    snapshotDigest: digest("b"),
    target: targetEvidence,
    userTurns: [],
    assistantTurns: [],
    completeness: "complete"
  };
}

function makeSteerBaseline(binding: OperationTargetBindingV1): OwnershipBaseline {
  const base = makeBaseline(binding);
  return {
    ...base,
    target: {
      ...base.target,
      canonicalThreadUrl: { status: "unavailable", reason: "redacted" }
    },
    userTurns: [{
      stableId: "user-parent-1",
      evidenceDigest: digest("p"),
      structureDigest: digest("q"),
      ordinal: 0
    }],
    assistantTurns: [{
      stableId: "assistant-1",
      evidenceDigest: digest("a"),
      structureDigest: digest("v"),
      ordinal: 0,
      parentStableId: "user-parent-1",
      branchStableId: "branch-steer-1",
      state: "generating"
    }]
  };
}

function makeSecondSteerBaseline(): OwnershipBaseline {
  const first = makeSteerBaseline(steerTarget());
  return {
    ...first,
    snapshotDigest: digest("c"),
    userTurns: [
      ...first.userTurns,
      {
        stableId: "user-steer-1",
        evidenceDigest: digest("u"),
        structureDigest: digest("q"),
        ordinal: 1
      }
    ],
    assistantTurns: [
      ...first.assistantTurns,
      {
        stableId: "assistant-steer-1",
        evidenceDigest: digest("z"),
        structureDigest: digest("v"),
        ordinal: 1,
        parentStableId: "user-steer-1",
        branchStableId: "branch-steer-1",
        state: "generating"
      }
    ]
  };
}

function makeAdapter(overrides: Partial<Omit<OperationBrowserAdapter, "submission">> & {
  submission?: Partial<OperationBrowserAdapter["submission"]>;
  executeFinalTabTransaction?: OperationBrowserAdapter["submission"]["executeFinalTabTransaction"];
  collector?: OperationBrowserAdapter["collector"];
} = {}): OperationBrowserAdapter {
  let pendingVerification: SubmissionFinalTransactionResult | undefined;
  let resolvedTarget: OperationTargetBindingV1 = target();
  const resolveTarget = overrides.resolveTarget ?? vi.fn(async () => ({ target: target() }));
  const resolveTargetWithCapture: OperationBrowserAdapter["resolveTarget"] = async request => {
    const resolution = await resolveTarget(request);
    resolvedTarget = resolution.target;
    return resolution;
  };
  const finalTransaction = overrides.executeFinalTabTransaction ?? vi.fn(async request => ({
    status: "submitted",
    targetBindingDigest: request.expected.targetBindingDigest,
    evidenceDigest: digest("s"),
    userTurnId: "user-1",
    userTurnEvidenceDigest: digest("u"),
    postSendDeltaDigest: digest("d")
  } satisfies SubmissionFinalTransactionResult));
  const defaultSubmission: OperationBrowserAdapter["submission"] = {
    observeStaging: vi.fn(async () => ({ status: "exact", evidenceDigest: digest("e") } satisfies SubmissionStageObservation)),
    executeFileHandoffOnce: vi.fn(async () => ({ status: "satisfied", evidenceDigest: digest("h") } satisfies SubmissionHandoffResult)),
    observeAttachments: vi.fn(async () => ({ status: "absent", evidenceDigest: digest("a"), count: 0, orderPolicy: "exact", identityDigests: [] } satisfies SubmissionAttachmentObservation)),
    prepareSend: vi.fn(async request => {
      const baseline = makeBaseline(resolvedTarget);
      return {
        status: "prepared" as const,
        prepared: {
          prepared: Object.freeze({ actionId: request.actionId }),
          baseline,
          evidenceDigest: baseline.snapshotDigest
        }
      };
    }),
    executePreparedSend: vi.fn(async request => {
      const value = await finalTransaction({
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        surface: request.surface,
        actionId: request.actionId,
        mode: "mutate_once",
        expected: request.expected,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        ...(request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt })
      });
      if (value.status === "blocked") return { status: "blocked" as const, result: value };
      if (value.status === "uncertain") {
        return {
          status: "activation_threw" as const,
          activation: "activation_threw" as const,
          mutationMayHaveOccurred: true as const
        };
      }
      pendingVerification = value;
      return {
        status: "activated" as const,
        activation: "activated" as const,
        mutationMayHaveOccurred: true as const
      };
    }),
    verifyPreparedSend: vi.fn(async request => {
      if (pendingVerification !== undefined) {
        const value = pendingVerification;
        pendingVerification = undefined;
        return value;
      }
      return await finalTransaction({
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        surface: request.surface,
        actionId: request.actionId,
        mode: "observe_only",
        expected: request.expected,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        ...(request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt })
      });
    }),
    recoverSend: vi.fn(async request => await finalTransaction({
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      surface: request.surface,
      actionId: request.actionId,
      mode: "observe_only",
      expected: request.expected,
      durableBaseline: request.durableBaseline,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt })
    })),
    executeFinalTabTransaction: vi.fn(async request => {
      // Browser adapters must persist the exact redacted baseline supplied by
      // the final precondition before a test fake acknowledges Send. This
      // models the production ordering without leaking prompt/DOM material.
      if (request.mode === "mutate_once" && request.persistPreSendBaseline !== undefined) {
        await request.persistPreSendBaseline(makeBaseline(resolvedTarget));
      }
      return await finalTransaction(request);
    })
  };
  const submission: OperationBrowserAdapter["submission"] = {
    ...defaultSubmission,
    ...(overrides.submission ?? {})
  };
  const collector = overrides.collector ?? {
    readContext: vi.fn(async () => {
      throw new Error("collector not configured");
    }),
    observe: vi.fn(async () => terminalObservation()),
    sleep: vi.fn(async () => undefined)
  };
  return {
    resolveTarget: resolveTargetWithCapture,
    submission,
    collector,
    ...(overrides.artifacts === undefined ? {} : { artifacts: overrides.artifacts }),
    ...(overrides.staging === undefined ? {} : { staging: overrides.staging }),
    ...(overrides.control === undefined ? {} : { control: overrides.control })
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

function terminalObservation(): CollectorObservation {
  const userDigest = digest("u");
  const assistantDigest = digest("a");
  const targetEvidence = ownershipTarget();
  return {
    schemaVersion: COLLECTOR_SCHEMA_VERSION,
    snapshot: {
      schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
      snapshotDigest: digest("s"),
      target: targetEvidence,
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
      schemaVersion: COLLECTOR_TERMINAL_SCHEMA_VERSION,
      userTurnId: "user-1",
      assistantTurnId: "assistant-1",
      userTurnEvidenceDigest: userDigest,
      assistantTurnEvidenceDigest: assistantDigest,
      userOrdinal: 0,
      assistantOrdinal: 0,
      branchStableId: "branch-assistant-1",
      text: { digest: digest("x"), bytes: 15, chars: 15 },
      responseFormat: "markdown",
      rawText: "secret response",
      artifacts: [],
      finishReason: "stop"
    }
  };
}

function terminalArtifactObservation(
  responseFormat: "markdown" | "text" = "markdown",
  responseContent: "include" | "metadata" = "include"
): CollectorObservation {
  const sourceIdentityDigest = digest("f");
  const base = terminalObservation();
  const assistant = base.snapshot.assistantTurns[0]!;
  const { rawText: _rawText, ...terminalWithoutRawText } = base.terminal!;
  return {
    ...base,
    snapshot: {
      ...base.snapshot,
      assistantTurns: [{
        ...assistant,
        artifactEvidenceDigests: [sourceIdentityDigest]
      }]
    },
    terminal: {
      ...(responseContent === "metadata" ? terminalWithoutRawText : base.terminal!),
      responseFormat,
      artifacts: [{
        kind: "file",
        ordinal: 0,
        sourceIdentityDigest,
        mimeType: "text/plain"
      }]
    }
  };
}

function transferIntent(
  request: Parameters<NonNullable<OperationBrowserAdapter["artifacts"]>["transfer"]>[0],
  destinationIdentityDigest = digest("d")
): ArtifactTransferIntentV1 {
  return {
    schemaVersion: "chatgpt.browser_control.artifact_transfer_intent.v1",
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    targetBindingDigest: request.targetBindingDigest,
    assistantTurnId: request.assistantTurnId,
    sourceIdentityDigest: request.sourceIdentityDigest,
    kind: request.kind,
    ordinal: request.ordinal,
    transferActionId: request.transferActionId,
    destinationIdentityDigest,
    actionKind: "local_output_commit",
    repeatPolicy: "reconcile_local_effect",
    intentAt: AT
  };
}

function transferReceipt(
  request: Parameters<NonNullable<OperationBrowserAdapter["artifacts"]>["transfer"]>[0],
  intent: ArtifactTransferIntentV1,
  status: ArtifactTransferReceiptV1["status"] = "transferred"
): ArtifactTransferReceiptV1 {
  return {
    schemaVersion: "chatgpt.browser_control.artifact_transfer_receipt.v1",
    operationId: intent.operationId,
    requestDigest: intent.requestDigest,
    targetBindingDigest: intent.targetBindingDigest,
    assistantTurnId: intent.assistantTurnId,
    sourceIdentityDigest: intent.sourceIdentityDigest,
    kind: intent.kind,
    ordinal: intent.ordinal,
    transferActionId: intent.transferActionId,
    destinationIdentityDigest: intent.destinationIdentityDigest,
    ...(status === "transferred" ? {
      outputKey: "artifact-0",
      bytes: 4,
      sha256: "a".repeat(64)
    } : {}),
    status,
    ...(status === "transferred" ? {} : { blockerCode: "artifact_transfer_partial" }),
    observedAt: AT
  };
}

function generatingObservation(includeCanonicalThreadUrl = true): CollectorObservation {
  const userDigest = digest("u");
  const targetEvidence = includeCanonicalThreadUrl ? ownershipTarget() : ownershipTargetWithoutUrl();
  return {
    schemaVersion: COLLECTOR_SCHEMA_VERSION,
    snapshot: {
      schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
      snapshotDigest: digest("g"),
      target: targetEvidence,
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

function workGeneratingObservation(): CollectorObservation {
  const targetEvidence = ownershipTargetWithoutUrl();
  return {
    schemaVersion: COLLECTOR_SCHEMA_VERSION,
    snapshot: {
      schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
      snapshotDigest: digest("h"),
      target: targetEvidence,
      userTurns: [
        { stableId: "user-parent-1", evidenceDigest: digest("p"), structureDigest: digest("q"), ordinal: 0 },
        { stableId: "user-steer-1", evidenceDigest: digest("u"), structureDigest: digest("q"), ordinal: 1 },
        { stableId: "user-steer-2", evidenceDigest: digest("2"), structureDigest: digest("q"), ordinal: 2 }
      ],
      assistantTurns: [
        {
          stableId: "assistant-1",
          evidenceDigest: digest("a"),
          structureDigest: digest("v"),
          ordinal: 0,
          parentStableId: "user-parent-1",
          branchStableId: "branch-steer-1",
          state: "generating"
        },
        {
          stableId: "assistant-steer-1",
          evidenceDigest: digest("z"),
          structureDigest: digest("v"),
          ordinal: 1,
          parentStableId: "user-steer-1",
          branchStableId: "branch-steer-1",
          state: "generating"
        },
        {
          stableId: "assistant-steer-2",
          evidenceDigest: digest("y"),
          structureDigest: digest("v"),
          ordinal: 2,
          parentStableId: "user-steer-2",
          branchStableId: "branch-steer-1",
          state: "generating"
        }
      ],
      completeness: "complete",
      terminalState: "generating",
      postSendDelta: {
        baselineSnapshotDigest: digest("c"),
        addedUserEvidenceDigests: [digest("2")],
        deltaDigest: digest("2")
      }
    }
  };
}

function ownershipContext(
  operationId: string,
  targetBindingDigest: string,
  actionId: string,
  actionKind: "send" | "work_steer" = "send"
): Awaited<ReturnType<OperationBrowserAdapter["collector"]["readContext"]>> {
  const ownership = actionKind === "work_steer" ? ownershipTargetWithoutUrl() : ownershipTarget();
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
      actionKind
    },
    baseline: {
      schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
      snapshotDigest: digest("b"),
      target: ownership,
      userTurns: [],
      assistantTurns: [],
      completeness: "complete"
    },
    submissionWitness: {
      actionId,
      actionKind,
      baselineSnapshotDigest: digest("b"),
      postSendDeltaDigest: digest("d"),
      operationUserEvidenceDigest: digest("u")
    }
  };
}

function ownershipTargetWithoutUrl(): OwnershipTargetEvidence {
  return {
    ...ownershipTarget(),
    canonicalThreadUrl: { status: "unavailable", reason: "redacted" }
  };
}

async function openJournal(label: string): Promise<OperationJournal> {
  return await OperationJournal.open({ stateRoot: await mkdtemp(join(tmpdir(), `codex-operation-service-${label}-`)) });
}

async function seedSendIntent(
  journal: OperationJournal,
  phase: "ready" | "send_pending"
): Promise<OperationHandleV1> {
  const operationRequest = request(OPERATION_ID);
  const requestDigest = journal.submitRequestDigest(operationRequest, []);
  let loaded = await journal.create({
    type: "operation_created",
    operationId: OPERATION_ID,
    requestDigest,
    surface: "chat",
    createdAt: AT
  });
  loaded = await journal.append(OPERATION_ID, loaded.state.revision, {
    type: "target_bound",
    target: target(),
    observedAt: AT
  });
  const targetBindingDigest = journal.handleFromState(loaded.state).targetBindingDigest!;
  loaded = await journal.append(OPERATION_ID, loaded.state.revision, {
    type: "phase_changed",
    from: "prepared",
    to: "ready",
    mutationBoundary: "none",
    evidenceDigest: digest("e"),
    observedAt: AT
  });
  loaded = await journal.append(OPERATION_ID, loaded.state.revision, {
    type: "action_intent",
    action: {
      actionId: SEND_ACTION_ID,
      kind: "send",
      repeatPolicy: "observe_only_after_intent",
      requestDigest,
      targetDigest: targetBindingDigest
    },
    intentAt: AT
  });
  loaded = await journal.append(OPERATION_ID, loaded.state.revision, {
    type: "ownership_baseline",
    baseline: {
      schemaVersion: OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION,
      operationId: OPERATION_ID,
      requestDigest,
      targetBindingDigest,
      actionId: SEND_ACTION_ID,
      baseline: makeBaseline(target()),
      observedAt: AT
    }
  });
  loaded = await journal.append(OPERATION_ID, loaded.state.revision, {
    type: "submission_witness",
    witness: {
      schemaVersion: OPERATION_SUBMISSION_WITNESS_SCHEMA_VERSION,
      actionId: SEND_ACTION_ID,
      actionKind: "send",
      targetBindingDigest,
      baselineSnapshotDigest: digest("b"),
      postSendDeltaDigest: digest("d"),
      operationUserEvidenceDigest: digest("u"),
      userTurnId: "user-1",
      observedAt: AT
    }
  });
  if (phase === "send_pending") {
    loaded = await journal.append(OPERATION_ID, loaded.state.revision, {
      type: "phase_changed",
      from: "ready",
      to: "send_pending",
      mutationBoundary: "send_may_have_occurred",
      causeActionId: SEND_ACTION_ID,
      observedAt: AT
    });
  }
  return journal.handleFromState(loaded.state);
}

async function seedNewPendingSend(
  journal: OperationJournal
): Promise<{ requestDigest: string; handle: OperationHandleV1 }> {
  const operationRequest = request(OPERATION_ID);
  const requestDigest = journal.submitRequestDigest(operationRequest, []);
  let loaded = await journal.create({
    type: "operation_created",
    operationId: OPERATION_ID,
    requestDigest,
    surface: "chat",
    createdAt: AT
  });
  loaded = await journal.append(OPERATION_ID, loaded.state.revision, {
    type: "target_bound",
    target: newPendingTarget(),
    observedAt: AT
  });
  loaded = await journal.append(OPERATION_ID, loaded.state.revision, {
    type: "phase_changed",
    from: "prepared",
    to: "ready",
    mutationBoundary: "none",
    evidenceDigest: digest("e"),
    observedAt: AT
  });
  const targetBindingDigest = journal.handleFromState(loaded.state).targetBindingDigest!;
  loaded = await journal.append(OPERATION_ID, loaded.state.revision, {
    type: "action_intent",
    action: {
      actionId: SEND_ACTION_ID,
      kind: "send",
      repeatPolicy: "observe_only_after_intent",
      requestDigest,
      targetDigest: targetBindingDigest
    },
    intentAt: AT
  });
  const baseline: OperationOwnershipBaselineV1 = {
    schemaVersion: OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION,
    operationId: OPERATION_ID,
    requestDigest,
    targetBindingDigest,
    actionId: SEND_ACTION_ID,
    baseline: makeBaseline(newPendingTarget()),
    observedAt: AT
  };
  loaded = await journal.append(OPERATION_ID, loaded.state.revision, {
    type: "ownership_baseline",
    baseline
  });
  loaded = await journal.append(OPERATION_ID, loaded.state.revision, {
    type: "phase_changed",
    from: "ready",
    to: "send_pending",
    mutationBoundary: "send_may_have_occurred",
    causeActionId: SEND_ACTION_ID,
    observedAt: AT
  });
  return { requestDigest, handle: journal.handleFromState(loaded.state) };
}

function newPendingTarget(): OperationTargetBindingV1 {
  return {
    providerId: "provider-1",
    browserId: "browser-1",
    tabId: "tab-new",
    coordinationScope: "process",
    evidenceProfile: {
      providerIdentity: "required",
      stableTabId: "required",
      stableConversationId: "unavailable",
      stableUserTurnId: "unavailable",
      authoritativeTabClaim: "unavailable",
      replacementTabRecovery: false
    },
    targetLifecycle: "new_pending",
    newTargetAnchorDigest: digest("a"),
    blankTaskEvidenceDigest: digest("b")
  };
}

function exactTerminalCollector(
  operationId: string,
  actionId: string,
  observation: CollectorObservation = terminalObservation()
): OperationBrowserAdapter["collector"] {
  return {
    readContext: async context => {
      const ownership = ownershipTarget();
      return {
        binding: {
          schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
          operationId,
          targetBindingDigest: context.targetBindingDigest,
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
        baseline: {
          schemaVersion: TURN_OWNERSHIP_SCHEMA_VERSION,
          snapshotDigest: digest("b"),
          target: ownership,
          userTurns: [],
          assistantTurns: [],
          completeness: "complete"
        },
        submissionWitness: {
          actionId,
          actionKind: "send",
          baselineSnapshotDigest: digest("b"),
          postSendDeltaDigest: digest("d"),
          operationUserEvidenceDigest: digest("u")
        }
      };
    },
    observe: async () => observation,
    sleep: async () => undefined
  };
}

async function durableCorpus(root: string): Promise<string> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return (await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => readFile(join(entry.parentPath, entry.name), "utf8")))).join("\n");
}

function digest(letter: string): string {
  const nibble = /^[0-9a-f]$/.test(letter) ? letter : (letter.charCodeAt(0) % 16).toString(16);
  return `hmac-sha256:${nibble.repeat(64)}`;
}


function asynchronousJournal(journal: OperationJournal): OperationJournalAuthority {
  return {
    create: async (...args) => await journal.create(...args),
    append: async (...args) => await journal.append(...args),
    load: async (...args) => await journal.load(...args),
    submitRequestDigest: async (...args) => journal.submitRequestDigest(...args),
    controlRequestDigest: async (...args) => journal.controlRequestDigest(...args),
    evidenceDigest: async (...args) => journal.evidenceDigest(...args),
    handleFromState: async (...args) => journal.handleFromState(...args),
    validateHandle: async (...args) => journal.validateHandle(...args)
  };
}

describe("asynchronous journal authority service", () => {
  it("awaits signing and authenticates returned handles and replay without Promise fields", async () => {
    const journal = await openJournal("async-authority");
    const authority = asynchronousJournal(journal);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    authority.evidenceDigest = async (domain, material) => {
      if (domain === "configuration-request") { entered(); await pending; }
      return journal.evidenceDigest(domain, material);
    };
    const adapter = makeAdapter({ executeFinalTabTransaction: async request => ({
      status: request.mode === "mutate_once" ? "submitted" : "already_submitted",
      targetBindingDigest: request.expected.targetBindingDigest,
      evidenceDigest: digest("s"), userTurnId: "user-1", userTurnEvidenceDigest: digest("u"), postSendDeltaDigest: digest("d")
    }) });
    const service = new OperationService(authority);
    const first = service.submit(request(OPERATION_ID), [], adapter);
    await started;
    expect(adapter.submission.prepareSend).not.toHaveBeenCalled();
    expect(adapter.submission.executePreparedSend).not.toHaveBeenCalled();
    release();
    const submitted = await first;
    expect(submitted.submission.kind).toBe("submitted");
    expect(typeof submitted.handle.targetBindingDigest).toBe("string");
    const inspected = await service.inspect(submitted.handle);
    expect(inspected.state.phase).toBe("submitted");
    const replay = await service.submit(request(OPERATION_ID), [], adapter);
    expect(replay.submission.kind).toBe("already_submitted");
    expect(adapter.submission.executePreparedSend).toHaveBeenCalledTimes(1);
  });

  it("does not prepare or send when async evidence signing rejects", async () => {
    const journal = await openJournal("async-signing-rejection");
    const authority = asynchronousJournal(journal);
    authority.evidenceDigest = async () => { throw new OperationJournalError("journal_rpc_unavailable", "private transport failure"); };
    const adapter = makeAdapter();
    const result = await new OperationService(authority).submit(request(OPERATION_ID), [], adapter);
    expect(result.submission).toMatchObject({ kind: "blocked", blocker: { mutationBoundary: "none" } });
    expect(adapter.submission.prepareSend).not.toHaveBeenCalled();
    expect(adapter.submission.executePreparedSend).not.toHaveBeenCalled();
  });

  it("redacts unavailable async request signing failures before browser access", async () => {
    const journal = await openJournal("async-request-rejection");
    const authority = asynchronousJournal(journal);
    authority.submitRequestDigest = async () => { throw new OperationJournalError("journal_rpc_unavailable", "private transport failure"); };
    const adapter = makeAdapter();
    await expect(new OperationService(authority).submit(request(OPERATION_ID), [], adapter)).rejects.toMatchObject({ code: "journal_rpc_unavailable", message: "The operation journal authority is unavailable." });
    expect(adapter.submission.executePreparedSend).not.toHaveBeenCalled();
  });
});


it("keeps a remotely committed Send intent observation-only when its acknowledgement is lost", async () => {
  const journal = await openJournal("async-indeterminate-intent");
  const authority = asynchronousJournal(journal);
  let lost = false;
  authority.append = async (...args) => {
    const value = await journal.append(...args);
    if (args[2].type === "action_prepared" && args[2].action.kind === "send") {
      lost = true;
      throw new OperationJournalError("journal_rpc_outcome_indeterminate", "private transport failure");
    }
    return value;
  };
  const adapter = makeAdapter();
  const service = new OperationService(authority);
  const result = await service.submit(request(OPERATION_ID), [], adapter);
  expect(lost).toBe(true);
  expect(result.submission.kind).toBe("uncertain");
  expect(adapter.submission.executePreparedSend).not.toHaveBeenCalled();
  await service.submit(request(OPERATION_ID), [], adapter);
  expect(adapter.submission.executePreparedSend).not.toHaveBeenCalled();
  expect(Object.values((await service.inspect(result.handle)).state.actions).filter(action => action.kind === "send")).toHaveLength(1);
});


it.skipIf(process.platform === "win32")("submits and collects through the real POSIX remote authority and replays after sidecar restart without another Send", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codex-operation-service-rpc-")));
  const stateRoot = join(root, "state");
  let server = await startJournalRpcServer({ stateRoot, directory: join(root, "session-one"), pollIntervalMs: 1 });
  try {
    const authority = await createJournalRpcClientFromDescriptor(server.descriptorPath, { timeoutMs: 5_000 });
    const service = new OperationService(authority);
    const adapter = makeAdapter();
    const submitted = await service.submit(request(OPERATION_ID), [], adapter);
    expect(submitted.submission.kind).toBe("submitted");
    const before = await service.inspect(submitted.handle);
    const sendActionId = Object.values(before.state.actions).find(action => action.kind === "send")!.actionId;
    const collector = makeAdapter({ collector: exactTerminalCollector(OPERATION_ID, sendActionId, terminalObservation()) });
    expect((await service.collect(submitted.handle, collector)).kind).toBe("completed");
    const completed = await service.inspect(submitted.handle);
    await server.close();
    server = await startJournalRpcServer({ stateRoot, directory: join(root, "session-two"), pollIntervalMs: 1 });
    const restarted = new OperationService(await createJournalRpcClientFromDescriptor(server.descriptorPath, { timeoutMs: 5_000 }));
    const restartedAdapter = makeAdapter();
    const replay = await restarted.submit(request(OPERATION_ID), [], restartedAdapter);
    expect(replay.submission.kind).toBe("completed_receipt");
    expect(replay.handle).toEqual(completed.handle);
    expect((await restarted.collect(replay.handle, restartedAdapter)).kind).toBe("completed");
    expect(adapter.submission.executePreparedSend).toHaveBeenCalledTimes(1);
    expect(restartedAdapter.submission.prepareSend).not.toHaveBeenCalled();
    expect(restartedAdapter.submission.executePreparedSend).not.toHaveBeenCalled();
    expect(Object.values((await restarted.inspect(replay.handle)).state.actions).filter(action => action.kind === "send")).toHaveLength(1);
  } finally { await server.close(); }
}, 30_000);
