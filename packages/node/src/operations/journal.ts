import { constants as fsConstants, type BigIntStats, type Stats } from "node:fs";
import {
  chmod,
  lstat,
  link,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import { homedir, hostname, platform } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { nodeErrorCode } from "../errors.js";
import { isByteArrayView } from "../runtime/value-boundaries.js";
import { canonicalJson, hmacDigest } from "./canonical.js";
import {
  operationControlRequestDigest,
  operationHandleFromState,
  operationSubmitRequestDigest,
  validateOperationHandle
} from "./handle.js";
import type { OperationFileManifestEntryV1 } from "./file-identity.js";
import {
  assertOperationEventShape,
  assertOperationId,
  assertOperationStateShape,
  reduceOperationEvents
} from "./state-machine.js";
import {
  OPERATION_EVENT_SCHEMA_VERSION,
  OPERATION_RECEIPT_SCHEMA_VERSION,
  OPERATION_SCHEMA_VERSION,
  type OperationJournalSnapshotV1,
  type OperationEventEnvelopeV1,
  type OperationEventV1,
  type OperationControlRequestV1,
  type OperationHandleV1,
  type OperationSubmitRequestV1,
  type OperationStateV1
} from "./types.js";

const KEY_BYTES = 32;
const KEY_FILE = "journal.key";
const LOG_DIRECTORY = "logs";
const LOCK_DIRECTORY = "locks";
const TERMINAL_DIRECTORY = "terminals";
const SNAPSHOT_DIRECTORY = "snapshots";
const TOMBSTONE_DIRECTORY = "tombstones";
const TRACKED_STATE_DIRECTORIES = [
  LOG_DIRECTORY,
  TERMINAL_DIRECTORY,
  SNAPSHOT_DIRECTORY,
  TOMBSTONE_DIRECTORY
] as const;
const QUOTA_LOCK_FILE = "quota-admission.lock";
const QUOTA_COUNTER_FILE = "quota-state.json";
const LOCK_RECOVERY_SUFFIX = ".reclaim";
const TERMINAL_SCHEMA_VERSION = "chatgpt.browser_control.operation_terminal.v1" as const;
const TOMBSTONE_SCHEMA_VERSION = "chatgpt.browser_control.operation_tombstone.v1" as const;
const QUOTA_COUNTER_SCHEMA_VERSION = "chatgpt.browser_control.operation_quota_state.v1" as const;
const GENESIS_EVENT_DIGEST = `hmac-sha256:${"0".repeat(64)}`;
const DEFAULT_MAX_STATE_BYTES = 64 * 1024 * 1024;
const MAX_SINGLE_RECORD_FILE_BYTES = 64 * 1024 * 1024;
const MAX_LOCK_RECORD_BYTES = 8 * 1024;
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
/**
 * Quota admission must remain bounded even when an attacker or a broken
 * provider leaves a directory full of entries.  This is deliberately an
 * implementation ceiling, not a caller-controlled option: a scan that would
 * exceed it fails closed before materializing the directory.
 */
const MAX_QUOTA_SCAN_ENTRIES = 65_536;
/** Absolute byte ceiling for a quota scan, independent of a permissive option. */
const MAX_QUOTA_SCAN_BYTES = 256 * 1024 * 1024;
const LOCK_RETRY_MS = 10;
const POSIX_DIRECTORY_MODE = 0o700;
const POSIX_FILE_MODE = 0o600;
const EVIDENCE_DOMAIN_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_EVIDENCE_MATERIAL_BYTES = 8 * 1024 * 1024;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

export type JournalFaultPoint =
  | "after_lock_acquired"
  | "after_partial_tail_truncated"
  | "after_record_written"
  | "after_record_synced"
  | "after_snapshot_synced"
  | "after_terminal_synced"
  | "after_tombstone_synced"
  | "after_log_deleted";

/**
 * Injectable wall-clock and wait boundary used by lock acquisition.  The
 * default implementation is backed by the host clock and timers; tests may
 * provide a deterministic implementation without changing journal semantics.
 */
export type OperationJournalClock = Readonly<{
  now: () => number;
  sleep: (milliseconds: number) => void | Promise<void>;
}>;

/**
 * Injectable entropy boundary for journal keys, lock tokens, and temporary
 * filenames.  Defaults always use the OS CSPRNG and crypto UUID generator.
 */
export type OperationJournalEntropy = Readonly<{
  randomBytes: (size: number) => Uint8Array;
  randomUUID: () => string;
}>;

export type OperationJournalOptions = {
  stateRoot?: string;
  maxStateBytes?: number;
  lockTimeoutMs?: number;
  faultInjector?: (point: JournalFaultPoint) => void | Promise<void>;
  clock?: OperationJournalClock;
  entropy?: OperationJournalEntropy;
};

export type LoadedOperationJournalV1 = {
  state: OperationStateV1;
  envelopes: OperationEventEnvelopeV1[];
  committedBytes: number;
  partialTailBytes: number;
  /** The authenticated final event digest. Compacted records have no envelopes. */
  lastEventDigest?: string;
};

export type OperationCompactionResultV1 = {
  status: "compacted" | "already_compacted";
  operationId: string;
  requestDigest: string;
  revision: number;
  lastEventDigest: string;
  deletedLogBytes: number;
};

export type OperationSnapshotResultV1 = OperationJournalSnapshotV1;

export type OperationReceiptPruneResultV1 = {
  status: "pruned" | "already_pruned";
  operationId: string;
  requestDigest: string;
  deletedTerminalBytes: number;
  deletedSnapshotBytes: number;
};

export type OperationTombstonePurgeResultV1 = {
  operationId: string;
  requestDigest: string;
  deleted: Array<"tombstone" | "terminal" | "snapshot" | "log">;
  deletedBytes: number;
};

type ParsedLog = {
  exists: boolean;
  envelopes: OperationEventEnvelopeV1[];
  committedBytes: number;
  partialTailBytes: number;
};

type OperationTerminalRecordV1 = {
  schemaVersion: typeof TERMINAL_SCHEMA_VERSION;
  operationId: string;
  requestDigest: string;
  revision: number;
  lastEventDigest: string;
  state: OperationStateV1;
  receipt: NonNullable<OperationStateV1["receipt"]>;
  artifactManifest: NonNullable<OperationStateV1["receipt"]>["artifacts"];
  ownershipEvidenceDigests: string[];
  terminalDigest: string;
};

type OperationTombstoneV1 = {
  schemaVersion: typeof TOMBSTONE_SCHEMA_VERSION;
  operationId: string;
  requestDigest: string;
  tombstoneDigest: string;
};

type AuthenticatedOperationSnapshotV1 = OperationJournalSnapshotV1 & {
  snapshotDigest: string;
};

type QuotaDirectoryFingerprintV1 = Readonly<{
  device: string;
  inode: string;
  modifiedNs: string;
  changedNs: string;
}>;

type OperationQuotaCounterV1 = Readonly<{
  schemaVersion: typeof QUOTA_COUNTER_SCHEMA_VERSION;
  revision: number;
  totalBytes: number;
  entryCount: number;
  dirty: boolean;
  directories: Readonly<Record<
    typeof LOG_DIRECTORY | typeof TERMINAL_DIRECTORY | typeof SNAPSHOT_DIRECTORY | typeof TOMBSTONE_DIRECTORY,
    QuotaDirectoryFingerprintV1
  >>;
  counterDigest: string;
}>;

type StateUsage = Readonly<{
  totalBytes: number;
  entryCount: number;
}>;

type QuotaMutationResult<T> = Readonly<{
  value: T;
  byteDelta: number;
  entryDelta: number;
}>;

type HeldLock = {
  path: string;
  token: string;
};

type LockRecord = {
  schemaVersion: "chatgpt.browser_control.operation_lock.v1";
  token: string;
  pid: number;
  hostname: string;
  createdAt: string;
};

const inProcessQueues = new Map<string, Promise<void>>();

export class OperationJournalError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "OperationJournalError";
  }
}

export class OperationJournal {
  readonly stateRoot: string;
  readonly maxStateBytes: number;
  readonly lockTimeoutMs: number;

  private constructor(
    stateRoot: string,
    private readonly key: Buffer,
    private readonly clock: OperationJournalClock,
    private readonly entropy: OperationJournalEntropy,
    options: OperationJournalOptions
  ) {
    this.stateRoot = stateRoot;
    this.maxStateBytes = options.maxStateBytes ?? DEFAULT_MAX_STATE_BYTES;
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    this.faultInjector = options.faultInjector;
  }

  private readonly faultInjector: OperationJournalOptions["faultInjector"];

  /** Compute immutable request identity inside the journal key domain. */
  submitRequestDigest(
    request: OperationSubmitRequestV1,
    files: readonly OperationFileManifestEntryV1[]
  ): string {
    return operationSubmitRequestDigest(this.key, request, files);
  }

  /** Compute child control identity inside the same stable key domain. */
  controlRequestDigest(request: OperationControlRequestV1): string {
    return operationControlRequestDigest(this.key, request);
  }

  /**
   * Derive privacy-preserving evidence in the stable journal key domain.
   * Callers receive only the HMAC, never the state-root key.  The bounded,
   * explicit domain keeps unrelated evidence classes cryptographically
   * separated while allowing browser adapters to avoid bare hashes of user
   * content.
   */
  evidenceDigest(domain: string, material: unknown): string {
    if (!EVIDENCE_DOMAIN_PATTERN.test(domain)) {
      throw new OperationJournalError("invalid_evidence_domain", "Evidence domain must be a bounded canonical label.");
    }
    let encoded: string;
    try {
      encoded = canonicalJson(material);
    } catch {
      throw new OperationJournalError("invalid_evidence_material", "Evidence material must be finite canonical JSON.");
    }
    if (Buffer.byteLength(encoded, "utf8") > MAX_EVIDENCE_MATERIAL_BYTES) {
      throw new OperationJournalError("evidence_material_too_large", "Evidence material exceeds the bounded digest input limit.");
    }
    return hmacDigest(
      this.key,
      `codex-chatgpt-control/operation-evidence/${domain}/v1`,
      material
    );
  }

  /** Issue a locator from durable state without exposing the journal key. */
  handleFromState(state: OperationStateV1): OperationHandleV1 {
    return operationHandleFromState(this.key, state);
  }

  /** Reconcile a caller locator with freshly loaded durable state. */
  validateHandle(
    handle: OperationHandleV1,
    state: OperationStateV1
  ): ReturnType<typeof validateOperationHandle> {
    return validateOperationHandle(this.key, handle, state);
  }

  static async open(options: OperationJournalOptions = {}): Promise<OperationJournal> {
    validatePositiveInteger(options.maxStateBytes, "maxStateBytes");
    validatePositiveInteger(options.lockTimeoutMs, "lockTimeoutMs");
    requireJournalRuntime(true);
    const clock = resolveClock(options.clock);
    const entropy = resolveEntropy(options.entropy);
    const requestedRoot = options.stateRoot ?? defaultOperationStateRoot();
    if (!isAbsolute(requestedRoot)) {
      throw new OperationJournalError("state_root_not_absolute", "Operation stateRoot must be an absolute path.");
    }

    await ensureSecureDirectory(requestedRoot);
    const canonicalRoot = await realpath(requestedRoot);
    await ensureSecureDirectory(join(canonicalRoot, LOG_DIRECTORY));
    await ensureSecureDirectory(join(canonicalRoot, LOCK_DIRECTORY));
    await ensureSecureDirectory(join(canonicalRoot, TERMINAL_DIRECTORY));
    await ensureSecureDirectory(join(canonicalRoot, SNAPSHOT_DIRECTORY));
    await ensureSecureDirectory(join(canonicalRoot, TOMBSTONE_DIRECTORY));
    const key = await loadOrCreateKey(canonicalRoot, entropy);
    const journal = new OperationJournal(canonicalRoot, key, clock, entropy, options);
    await journal.ensureQuotaCounter();
    return journal;
  }

  async create(event: Extract<OperationEventV1, { type: "operation_created" }>): Promise<LoadedOperationJournalV1> {
    try {
      return await this.append(event.operationId, 0, event);
    } catch (error) {
      if (error instanceof OperationJournalError && error.code === "revision_conflict") {
        return await this.load(event.operationId, event.requestDigest);
      }
      throw error;
    }
  }

  async append(
    operationId: string,
    expectedRevision: number,
    event: OperationEventV1
  ): Promise<LoadedOperationJournalV1> {
    assertOperationId(operationId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new OperationJournalError("invalid_expected_revision", "expectedRevision must be a non-negative safe integer.");
    }

    const logPath = this.operationLogPath(operationId);
    const lockPath = this.operationLockPath(operationId);
    return serializeInProcess(lockPath, async () => {
      const lock = await acquireLock(lockPath, this.lockTimeoutMs, this.clock, this.entropy);
      try {
        await this.inject("after_lock_acquired");
        await this.assertNoTerminalOrTombstoneForAppend(operationId, expectedRevision);
        const parsed = await readLog(logPath, this.key, true);
        if (parsed.envelopes.length !== expectedRevision) {
          throw new OperationJournalError(
            "revision_conflict",
            `Expected operation revision ${expectedRevision}, found ${parsed.envelopes.length}.`
          );
        }
        if (expectedRevision === 0) {
          if (event.type !== "operation_created" || event.operationId !== operationId) {
            throw new OperationJournalError("creation_event_required", "Revision zero requires the matching operation_created event.");
          }
        } else if (event.type === "operation_created") {
          throw new OperationJournalError("duplicate_operation_created", "operation_created cannot be appended after revision one.");
        }

        const priorEvents = parsed.envelopes.map(envelope => envelope.event);
        const storedEvent = jsonRoundTrip(event);
        try {
          assertOperationEventShape(storedEvent);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new OperationJournalError("invalid_operation_event", `Operation event is not safe to persist: ${message}`);
        }
        const nextState = reduceSafely([...priorEvents, storedEvent]);
        if (nextState.operationId !== operationId) {
          throw new OperationJournalError("operation_binding_mismatch", "Journal event does not match the requested operation ID.");
        }

        const revision = expectedRevision + 1;
        const previousEventDigest = parsed.envelopes.at(-1)?.eventDigest ?? GENESIS_EVENT_DIGEST;
        const eventDigest = journalEventDigest(this.key, revision, previousEventDigest, storedEvent);
        const envelope: OperationEventEnvelopeV1 = {
          schemaVersion: OPERATION_EVENT_SCHEMA_VERSION,
          revision,
          previousEventDigest,
          eventDigest,
          event: storedEvent
        };
        const encoded = Buffer.from(`${canonicalJson(envelope)}\n`, "utf8");
        const persist = () => appendRecord({
          logPath,
          encoded,
          committedBytes: parsed.committedBytes,
          partialTailBytes: parsed.partialTailBytes,
          createExclusive: !parsed.exists,
          syncParent: expectedRevision === 0,
          inject: point => this.inject(point)
        });
        const byteDelta = encoded.byteLength - parsed.partialTailBytes;
        await this.mutateQuotaTrackedState(
          async () => {
            await persist();
            return {
              value: undefined,
              byteDelta,
              entryDelta: parsed.exists ? 0 : 1
            };
          },
          expectedRevision === 0
            ? counter => this.assertQuotaForNewOperation(counter, Math.max(0, byteDelta))
            : undefined
        );

        return {
          state: nextState,
          envelopes: [...parsed.envelopes, envelope],
          committedBytes: parsed.committedBytes + encoded.byteLength,
          partialTailBytes: 0,
          lastEventDigest: eventDigest
        };
      } finally {
        await releaseLock(lock);
      }
    });
  }

  async load(operationId: string, expectedRequestDigest?: string): Promise<LoadedOperationJournalV1> {
    assertOperationId(operationId);
    const lockPath = this.operationLockPath(operationId);
    const result = serializeInProcess(lockPath, async () => {
      const lock = await acquireLock(lockPath, this.lockTimeoutMs, this.clock, this.entropy);
      try {
        return await this.loadLocked(operationId, expectedRequestDigest);
      } finally {
        await releaseLock(lock);
      }
    });
    result.catch(() => undefined);
    return result;
  }

  /**
   * Rebuilds the materialized snapshot cache from authoritative journal state.
   * A snapshot is never used as a substitute for the authenticated log or
   * terminal record, so a damaged cache can always be safely overwritten.
   */
  async refreshSnapshot(operationId: string): Promise<OperationSnapshotResultV1> {
    assertOperationId(operationId);
    const lockPath = this.operationLockPath(operationId);
    return serializeInProcess(lockPath, async () => {
      const lock = await acquireLock(lockPath, this.lockTimeoutMs, this.clock, this.entropy);
      try {
        const loaded = await this.loadLocked(operationId);
        const lastEventDigest = loaded.lastEventDigest ?? loaded.envelopes.at(-1)?.eventDigest;
        if (lastEventDigest === undefined) {
          throw corrupt("Authoritative operation state has no final event digest.");
        }
        const snapshot: OperationJournalSnapshotV1 = {
          schemaVersion: OPERATION_SCHEMA_VERSION,
          lastEventDigest,
          state: jsonRoundTrip(loaded.state)
        };
        const snapshotPath = this.snapshotPath(operationId);
        await this.mutateQuotaTrackedState(async () => {
          const beforeBytes = await optionalFileSize(snapshotPath);
          await writeAuthenticatedAtomic(
            snapshotPath,
            snapshot,
            this.key,
            "codex-chatgpt-control/operation-snapshot/v1",
            "snapshotDigest",
            this.entropy,
            point => this.inject(point),
            true
          );
          const afterBytes = await fileSize(snapshotPath);
          return {
            value: undefined,
            byteDelta: afterBytes - (beforeBytes ?? 0),
            entryDelta: beforeBytes === undefined ? 1 : 0
          };
        });
        return snapshot;
      } finally {
        await releaseLock(lock);
      }
    });
  }

  /** Reads and authenticates a snapshot cache without treating it as authority. */
  async readSnapshot(operationId: string): Promise<OperationSnapshotResultV1> {
    assertOperationId(operationId);
    const snapshotPath = this.snapshotPath(operationId);
    const snapshot = await readAuthenticatedFile<AuthenticatedOperationSnapshotV1>(
      snapshotPath,
      this.key,
      "codex-chatgpt-control/operation-snapshot/v1",
      "snapshotDigest",
      "journal_snapshot_corrupt"
    );
    if (
      !hasExactKeys(snapshot, ["schemaVersion", "lastEventDigest", "state", "snapshotDigest"])
      ||
      snapshot.schemaVersion !== OPERATION_SCHEMA_VERSION
      || !isDigest(snapshot.lastEventDigest)
      || !isRecord(snapshot.state)
      || snapshot.state.operationId !== operationId
      || !Number.isSafeInteger(snapshot.state.revision)
    ) {
      throw new OperationJournalError("journal_snapshot_corrupt", "Authenticated snapshot has an invalid shape.");
    }
    try {
      assertOperationStateShape(snapshot.state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new OperationJournalError("journal_snapshot_corrupt", `Authenticated snapshot state is invalid: ${message}`);
    }
    const { snapshotDigest: _snapshotDigest, ...publicSnapshot } = snapshot;
    return publicSnapshot;
  }

  /**
   * Converts a completed, receipt-bearing log into a durable terminal record.
   * The terminal is fsynced before the historical log is removed. If a crash
   * occurs between those steps, load() authenticates and reconciles both.
   */
  async compactCompleted(operationId: string): Promise<OperationCompactionResultV1> {
    assertOperationId(operationId);
    const lockPath = this.operationLockPath(operationId);
    return serializeInProcess(lockPath, async () => {
      const lock = await acquireLock(lockPath, this.lockTimeoutMs, this.clock, this.entropy);
      try {
        return await this.compactCompletedLocked(operationId);
      } finally {
        await releaseLock(lock);
      }
    });
  }

  /**
   * Explicitly prunes a completed terminal into a minimal authenticated
   * tombstone. Pruning is never automatic and leaves an unmistakable expiry
   * result instead of turning the operation into operation_not_found.
   */
  async pruneReceipt(operationId: string): Promise<OperationReceiptPruneResultV1> {
    assertOperationId(operationId);
    // Ensure the terminal record is durable before replacing it with a tombstone.
    try {
      await this.compactCompleted(operationId);
    } catch (error) {
      if (!(error instanceof OperationJournalError) || error.code !== "operation_receipt_expired") throw error;
    }
    const lockPath = this.operationLockPath(operationId);
    return serializeInProcess(lockPath, async () => {
      const lock = await acquireLock(lockPath, this.lockTimeoutMs, this.clock, this.entropy);
      try {
        const tombstonePath = this.tombstonePath(operationId);
        const terminalPath = this.terminalPath(operationId);
        if (await pathExists(tombstonePath)) {
          const tombstone = await readTombstone(tombstonePath, this.key);
          let deletedTerminalBytes = 0;
          if (await pathExists(terminalPath)) {
            const terminal = await readTerminal(terminalPath, this.key);
            assertSameIdentity(tombstone.operationId, tombstone.requestDigest, terminal.operationId, terminal.requestDigest);
            deletedTerminalBytes = await this.removeQuotaTrackedFile(terminalPath);
          }
          const snapshotPath = this.snapshotPath(operationId);
          const deletedSnapshotBytes = await this.removeQuotaTrackedFile(snapshotPath);
          return {
            status: "already_pruned",
            operationId: tombstone.operationId,
            requestDigest: tombstone.requestDigest,
            deletedTerminalBytes,
            deletedSnapshotBytes
          };
        }
        const terminal = await readTerminal(terminalPath, this.key);
        const tombstone: OperationTombstoneV1 = {
          schemaVersion: TOMBSTONE_SCHEMA_VERSION,
          operationId: terminal.operationId,
          requestDigest: terminal.requestDigest,
          tombstoneDigest: ""
        };
        tombstone.tombstoneDigest = hmacDigest(
          this.key,
          "codex-chatgpt-control/operation-tombstone/v1",
          withoutField(tombstone, "tombstoneDigest")
        );
        await this.mutateQuotaTrackedState(async () => {
          const beforeBytes = await optionalFileSize(tombstonePath);
          await writeAtomicJson(
            tombstonePath,
            tombstone,
            this.entropy,
            point => this.inject(point),
            false
          );
          const afterBytes = await fileSize(tombstonePath);
          return {
            value: undefined,
            byteDelta: afterBytes - (beforeBytes ?? 0),
            entryDelta: beforeBytes === undefined ? 1 : 0
          };
        });

        const terminalBytes = await this.removeQuotaTrackedFile(terminalPath);
        const snapshotPath = this.snapshotPath(operationId);
        const snapshotBytes = await this.removeQuotaTrackedFile(snapshotPath);
        return {
          status: "pruned",
          operationId: terminal.operationId,
          requestDigest: terminal.requestDigest,
          deletedTerminalBytes: terminalBytes,
          deletedSnapshotBytes: snapshotBytes
        };
      } finally {
        await releaseLock(lock);
      }
    });
  }

  /**
   * Permanently removes a pruned tombstone and any crash-residue state. This
   * is intentionally a separately named destructive operation and requires an
   * explicit acknowledgement at the call site.
   */
  async purgeTombstone(
    operationId: string,
    options?: { acknowledge?: boolean }
  ): Promise<OperationTombstonePurgeResultV1> {
    assertOperationId(operationId);
    if (options?.acknowledge !== true) {
      throw new OperationJournalError(
        "journal_purge_ack_required",
        "Purging a receipt tombstone requires acknowledge: true."
      );
    }
    const lockPath = this.operationLockPath(operationId);
    return serializeInProcess(lockPath, async () => {
      const lock = await acquireLock(lockPath, this.lockTimeoutMs, this.clock, this.entropy);
      try {
        const tombstonePath = this.tombstonePath(operationId);
        const tombstone = await readTombstone(tombstonePath, this.key);
        const terminalPath = this.terminalPath(operationId);
        if (await pathExists(terminalPath)) {
          const terminal = await readTerminal(terminalPath, this.key);
          if (terminal.operationId !== tombstone.operationId || terminal.requestDigest !== tombstone.requestDigest) {
            throw corrupt("Tombstone and terminal identity do not match.");
          }
        }
        const logPath = this.operationLogPath(operationId);
        if (await pathExists(logPath)) {
          const parsed = await readLog(logPath, this.key, false);
          const state = reduceSafely(parsed.envelopes.map(envelope => envelope.event));
          assertCompletedState(state, operationId);
          if (state.requestDigest !== tombstone.requestDigest) throw corrupt("Tombstone and log identity do not match.");
        }
        const paths: Array<["tombstone" | "terminal" | "snapshot" | "log", string]> = [
          ["tombstone", tombstonePath],
          ["terminal", terminalPath],
          ["snapshot", this.snapshotPath(operationId)],
          ["log", logPath]
        ];
        const deleted: OperationTombstonePurgeResultV1["deleted"] = [];
        let deletedBytes = 0;
        for (const [kind, path] of paths) {
          const bytes = await this.removeQuotaTrackedFile(path);
          if (bytes > 0) {
            deleted.push(kind);
            deletedBytes += bytes;
          }
        }
        return { operationId: tombstone.operationId, requestDigest: tombstone.requestDigest, deleted, deletedBytes };
      } finally {
        await releaseLock(lock);
      }
    });
  }

  private operationLogPath(operationId: string): string {
    const stem = this.operationStem(operationId);
    return childPath(this.stateRoot, LOG_DIRECTORY, `${stem}.jsonl`);
  }

  private operationLockPath(operationId: string): string {
    const stem = this.operationStem(operationId);
    return childPath(this.stateRoot, LOCK_DIRECTORY, `${stem}.lock`);
  }

  private quotaLockPath(): string {
    return childPath(this.stateRoot, LOCK_DIRECTORY, QUOTA_LOCK_FILE);
  }

  private quotaCounterPath(): string {
    return childPath(this.stateRoot, QUOTA_COUNTER_FILE);
  }

  private terminalPath(operationId: string): string {
    const stem = this.operationStem(operationId);
    return childPath(this.stateRoot, TERMINAL_DIRECTORY, `${stem}.terminal.json`);
  }

  private snapshotPath(operationId: string): string {
    const stem = this.operationStem(operationId);
    return childPath(this.stateRoot, SNAPSHOT_DIRECTORY, `${stem}.snapshot.json`);
  }

  private tombstonePath(operationId: string): string {
    const stem = this.operationStem(operationId);
    return childPath(this.stateRoot, TOMBSTONE_DIRECTORY, `${stem}.tombstone.json`);
  }

  private operationStem(operationId: string): string {
    return hmacDigest(this.key, "codex-chatgpt-control/operation-path/v1", operationId).slice("hmac-sha256:".length);
  }

  private async loadLocked(operationId: string, expectedRequestDigest?: string): Promise<LoadedOperationJournalV1> {
    const tombstonePath = this.tombstonePath(operationId);
    if (await pathExists(tombstonePath)) {
      const tombstone = await readTombstone(tombstonePath, this.key);
      if (expectedRequestDigest !== undefined && tombstone.requestDigest !== expectedRequestDigest) {
        throw new OperationJournalError(
          "operation_request_mismatch",
          "The operation ID already exists with a different immutable request digest."
        );
      }
      const terminalPath = this.terminalPath(operationId);
      if (await pathExists(terminalPath)) {
        const terminal = await readTerminal(terminalPath, this.key);
        assertSameIdentity(tombstone.operationId, tombstone.requestDigest, terminal.operationId, terminal.requestDigest);
      }
      const logPath = this.operationLogPath(operationId);
      if (await pathExists(logPath)) {
        const parsed = await readLog(logPath, this.key, false);
        const state = reduceSafely(parsed.envelopes.map(envelope => envelope.event));
        assertCompletedState(state, operationId);
        if (state.requestDigest !== tombstone.requestDigest) throw corrupt("Tombstone and log identity do not match.");
      }
      throw new OperationJournalError(
        "operation_receipt_expired",
        "The operation receipt was explicitly pruned; its durable tombstone remains."
      );
    }

    const terminalPath = this.terminalPath(operationId);
    if (await pathExists(terminalPath)) {
      const terminal = await readTerminal(terminalPath, this.key);
      if (terminal.operationId !== operationId) throw corrupt("Terminal record operation identity does not match its path.");
      if (expectedRequestDigest !== undefined && terminal.requestDigest !== expectedRequestDigest) {
        throw new OperationJournalError(
          "operation_request_mismatch",
          "The operation ID already exists with a different immutable request digest."
        );
      }
      const logPath = this.operationLogPath(operationId);
      if (await pathExists(logPath)) {
        const parsed = await readLog(logPath, this.key, false);
        reconcileTerminalWithLog(terminal, parsed, operationId);
        return { ...parsed, state: terminal.state, lastEventDigest: terminal.lastEventDigest };
      }
      return terminalLoaded(terminal);
    }

    const parsed = await readLog(this.operationLogPath(operationId), this.key, false);
    if (parsed.envelopes.length === 0) {
      throw new OperationJournalError("operation_not_found", "No durable operation exists for this operation ID.");
    }
    const state = reduceSafely(parsed.envelopes.map(envelope => envelope.event));
    if (state.operationId !== operationId) {
      throw new OperationJournalError("operation_binding_mismatch", "The operation log is bound to a different operation ID.");
    }
    if (expectedRequestDigest !== undefined && state.requestDigest !== expectedRequestDigest) {
      throw new OperationJournalError(
        "operation_request_mismatch",
        "The operation ID already exists with a different immutable request digest."
      );
    }
    const lastEventDigest = parsed.envelopes.at(-1)?.eventDigest;
    if (lastEventDigest === undefined) throw corrupt("Operation log has no final event digest.");
    return { ...parsed, state, lastEventDigest };
  }

  private async assertNoTerminalOrTombstoneForAppend(operationId: string, expectedRevision: number): Promise<void> {
    const tombstonePath = this.tombstonePath(operationId);
    if (await pathExists(tombstonePath)) {
      throw new OperationJournalError(
        "operation_receipt_expired",
        "The operation receipt was explicitly pruned; its durable tombstone remains."
      );
    }
    const terminalPath = this.terminalPath(operationId);
    if (!(await pathExists(terminalPath))) return;
    const terminal = await readTerminal(terminalPath, this.key);
    if (expectedRevision === 0) {
      throw new OperationJournalError("revision_conflict", "The operation already has a durable terminal record.");
    }
    throw new OperationJournalError(
      "operation_compacted",
      `The completed operation is compacted at revision ${terminal.revision}; its terminal receipt is immutable.`
    );
  }

  private async compactCompletedLocked(operationId: string): Promise<OperationCompactionResultV1> {
    const tombstonePath = this.tombstonePath(operationId);
    if (await pathExists(tombstonePath)) {
      throw new OperationJournalError(
        "operation_receipt_expired",
        "The operation receipt was explicitly pruned; its durable tombstone remains."
      );
    }
    const terminalPath = this.terminalPath(operationId);
    const logPath = this.operationLogPath(operationId);
    if (await pathExists(terminalPath)) {
      const terminal = await readTerminal(terminalPath, this.key);
      if (await pathExists(logPath)) {
        const parsed = await readLog(logPath, this.key, false);
        reconcileTerminalWithLog(terminal, parsed, operationId);
        const deletedLogBytes = await this.removeQuotaTrackedFile(
          logPath,
          () => this.inject("after_log_deleted")
        );
        return {
          status: "already_compacted",
          operationId: terminal.operationId,
          requestDigest: terminal.requestDigest,
          revision: terminal.revision,
          lastEventDigest: terminal.lastEventDigest,
          deletedLogBytes
        };
      }
      assertCompletedState(terminal.state, operationId);
      return {
        status: "already_compacted",
        operationId: terminal.operationId,
        requestDigest: terminal.requestDigest,
        revision: terminal.revision,
        lastEventDigest: terminal.lastEventDigest,
        deletedLogBytes: 0
      };
    }

    const parsed = await readLog(logPath, this.key, false);
    if (parsed.envelopes.length === 0) throw new OperationJournalError("operation_not_found", "No durable operation exists for this operation ID.");
    const state = reduceSafely(parsed.envelopes.map(envelope => envelope.event));
    assertCompletedState(state, operationId);
    const lastEventDigest = parsed.envelopes.at(-1)?.eventDigest;
    if (lastEventDigest === undefined) throw corrupt("Completed operation has no final event digest.");
    const terminal = makeTerminalRecord(this.key, state, lastEventDigest);
    await this.mutateQuotaTrackedState(async () => {
      const beforeBytes = await optionalFileSize(terminalPath);
      await writeAuthenticatedAtomic(
        terminalPath,
        terminal,
        this.key,
        "codex-chatgpt-control/operation-terminal/v1",
        "terminalDigest",
        this.entropy,
        point => this.inject(point),
        false
      );
      const afterBytes = await fileSize(terminalPath);
      return {
        value: undefined,
        byteDelta: afterBytes - (beforeBytes ?? 0),
        entryDelta: beforeBytes === undefined ? 1 : 0
      };
    });
    // Re-read the newly durable record before deleting the only historical log.
    const durableTerminal = await readTerminal(terminalPath, this.key);
    reconcileTerminalWithLog(durableTerminal, parsed, operationId);
    const deletedLogBytes = await this.removeQuotaTrackedFile(
      logPath,
      () => this.inject("after_log_deleted")
    );
    return {
      status: "compacted",
      operationId: durableTerminal.operationId,
      requestDigest: durableTerminal.requestDigest,
      revision: durableTerminal.revision,
      lastEventDigest: durableTerminal.lastEventDigest,
      deletedLogBytes
    };
  }

  private async ensureQuotaCounter(): Promise<void> {
    const quotaLockPath = this.quotaLockPath();
    await serializeInProcess(quotaLockPath, async () => {
      const quotaLock = await acquireLock(quotaLockPath, this.lockTimeoutMs, this.clock, this.entropy);
      try {
        await this.loadCurrentQuotaCounter();
      } finally {
        await releaseLock(quotaLock);
      }
    });
  }

  private async mutateQuotaTrackedState<T>(
    mutation: () => Promise<QuotaMutationResult<T>>,
    preflight?: (counter: OperationQuotaCounterV1) => void
  ): Promise<T> {
    const quotaLockPath = this.quotaLockPath();
    return await serializeInProcess(quotaLockPath, async () => {
      const quotaLock = await acquireLock(quotaLockPath, this.lockTimeoutMs, this.clock, this.entropy);
      try {
        const counter = await this.loadCurrentQuotaCounter();
        preflight?.(counter);
        const dirty = await writeQuotaCounter(
          this.quotaCounterPath(),
          {
            ...counter,
            revision: nextQuotaRevision(counter.revision),
            dirty: true,
            counterDigest: ""
          },
          this.key,
          this.entropy
        );
        try {
          const result = await mutation();
          assertQuotaDelta(result.byteDelta, "byteDelta");
          assertQuotaDelta(result.entryDelta, "entryDelta");
          const totalBytes = dirty.totalBytes + result.byteDelta;
          const entryCount = dirty.entryCount + result.entryDelta;
          if (!Number.isSafeInteger(totalBytes) || totalBytes < 0
            || !Number.isSafeInteger(entryCount) || entryCount < 0) {
            throw new OperationJournalError("journal_quota_counter_corrupt", "Operation quota accounting produced an invalid total.");
          }
          await writeQuotaCounter(
            this.quotaCounterPath(),
            {
              schemaVersion: QUOTA_COUNTER_SCHEMA_VERSION,
              revision: nextQuotaRevision(dirty.revision),
              totalBytes,
              entryCount,
              dirty: false,
              directories: await readQuotaDirectoryFingerprints(this.stateRoot),
              counterDigest: ""
            },
            this.key,
            this.entropy
          );
          return result.value;
        } catch (error) {
          // A thrown mutation may still have changed durable state. Rebuild
          // while the global quota lock is held; if this process actually
          // dies, the authenticated dirty bit forces the next opener to scan.
          try {
            await this.rebuildQuotaCounter(nextQuotaRevision(dirty.revision));
          } catch {
            // Preserve the original mutation failure. The dirty counter is a
            // fail-closed recovery marker for the next admission attempt.
          }
          throw error;
        }
      } finally {
        await releaseLock(quotaLock);
      }
    });
  }

  private async removeQuotaTrackedFile(
    path: string,
    afterDelete?: () => void | Promise<void>
  ): Promise<number> {
    return await this.mutateQuotaTrackedState(async () => {
      const beforeBytes = await optionalFileSize(path);
      if (beforeBytes === undefined) {
        return { value: 0, byteDelta: 0, entryDelta: 0 };
      }
      await unlink(path);
      await syncDirectory(dirname(path));
      await afterDelete?.();
      return { value: beforeBytes, byteDelta: -beforeBytes, entryDelta: -1 };
    });
  }

  private async loadCurrentQuotaCounter(): Promise<OperationQuotaCounterV1> {
    const path = this.quotaCounterPath();
    if (!(await pathExists(path))) return await this.rebuildQuotaCounter(1);
    const counter = await readQuotaCounter(path, this.key);
    if (counter.dirty) return await this.rebuildQuotaCounter(nextQuotaRevision(counter.revision));
    const currentDirectories = await readQuotaDirectoryFingerprints(this.stateRoot);
    if (!sameQuotaDirectoryFingerprints(counter.directories, currentDirectories)) {
      return await this.rebuildQuotaCounter(nextQuotaRevision(counter.revision));
    }
    return counter;
  }

  private async rebuildQuotaCounter(revision: number): Promise<OperationQuotaCounterV1> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await readQuotaDirectoryFingerprints(this.stateRoot);
      const usage = await scanStateUsage(this.stateRoot);
      const after = await readQuotaDirectoryFingerprints(this.stateRoot);
      if (!sameQuotaDirectoryFingerprints(before, after)) continue;
      return await writeQuotaCounter(
        this.quotaCounterPath(),
        {
          schemaVersion: QUOTA_COUNTER_SCHEMA_VERSION,
          revision,
          totalBytes: usage.totalBytes,
          entryCount: usage.entryCount,
          dirty: false,
          directories: after,
          counterDigest: ""
        },
        this.key,
        this.entropy
      );
    }
    throw new OperationJournalError(
      "journal_quota_state_changed",
      "Operation state changed while rebuilding its quota counter."
    );
  }

  private assertQuotaForNewOperation(counter: OperationQuotaCounterV1, additionalBytes: number): void {
    const total = counter.totalBytes;
    if (counter.entryCount > MAX_QUOTA_SCAN_ENTRIES || total > MAX_QUOTA_SCAN_BYTES
      || !Number.isSafeInteger(additionalBytes) || additionalBytes < 0 || additionalBytes > MAX_QUOTA_SCAN_BYTES - total) {
      throw new OperationJournalError("journal_scan_limit", "Operation journal quota scan exceeded its hard byte limit.");
    }
    if (total + additionalBytes > this.maxStateBytes) {
      throw new OperationJournalError(
        "journal_quota_exceeded",
        "Operation journal quota is exhausted; existing safety evidence was preserved."
      );
    }
  }

  private async inject(point: JournalFaultPoint): Promise<void> {
    await this.faultInjector?.(point);
  }
}

export const JOURNAL_RUNTIME_UNAVAILABLE_MESSAGE =
  "Transactional operations require a Node host with process identity, file ownership, and process liveness APIs. This host cannot safely open the operation journal.";

/** Validate security-critical host capabilities before creating any journal paths. */
function requireJournalRuntime(probeLiveness = false): NodeJS.Process {
  try {
    if (typeof process === "undefined"
      || !Number.isSafeInteger(process.pid) || process.pid <= 0
      || typeof process.kill !== "function"
      || typeof process.env !== "object" || process.env === null) {
      throw new Error("unavailable");
    }
    if (platform() !== "win32") {
      if (typeof process.getuid !== "function") throw new Error("unavailable");
      const uid = process.getuid();
      if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("unavailable");
    }
    if (probeLiveness) process.kill(process.pid, 0);
    return process;
  } catch {
    throw new OperationJournalError("journal_runtime_unavailable", JOURNAL_RUNTIME_UNAVAILABLE_MESSAGE);
  }
}

export function defaultOperationStateRoot(): string {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "codex-chatgpt-control", "operations-v1");
  }
  if (platform() === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData !== undefined && isAbsolute(localAppData)) {
      return join(localAppData, "codex-chatgpt-control", "operations-v1");
    }
    return join(homedir(), "AppData", "Local", "codex-chatgpt-control", "operations-v1");
  }
  const xdgState = process.env.XDG_STATE_HOME;
  if (xdgState !== undefined && isAbsolute(xdgState)) {
    return join(xdgState, "codex-chatgpt-control", "operations-v1");
  }
  return join(homedir(), ".local", "state", "codex-chatgpt-control", "operations-v1");
}

function journalEventDigest(
  key: Uint8Array,
  revision: number,
  previousEventDigest: string,
  event: OperationEventV1
): string {
  return hmacDigest(key, "codex-chatgpt-control/operation-event/v1", {
    schemaVersion: OPERATION_EVENT_SCHEMA_VERSION,
    revision,
    previousEventDigest,
    event
  });
}

function makeTerminalRecord(
  key: Uint8Array,
  state: OperationStateV1,
  lastEventDigest: string
): OperationTerminalRecordV1 {
  assertCompletedState(state, state.operationId);
  const receipt = state.receipt;
  if (receipt === undefined) throw corrupt("Completed operation has no terminal receipt.");
  const copiedReceipt = jsonRoundTrip(receipt);
  const ownershipEvidenceDigests = terminalOwnershipEvidenceDigests(state);
  const terminal: OperationTerminalRecordV1 = {
    schemaVersion: TERMINAL_SCHEMA_VERSION,
    operationId: state.operationId,
    requestDigest: state.requestDigest,
    revision: state.revision,
    lastEventDigest,
    state: jsonRoundTrip(state),
    receipt: copiedReceipt,
    artifactManifest: jsonRoundTrip(copiedReceipt.artifacts),
    ownershipEvidenceDigests,
    terminalDigest: ""
  };
  terminal.terminalDigest = hmacDigest(
    key,
    "codex-chatgpt-control/operation-terminal/v1",
    withoutField(terminal, "terminalDigest")
  );
  return terminal;
}

function assertCompletedState(state: OperationStateV1, operationId: string): void {
  if (state.operationId !== operationId) throw corrupt("Terminal state operation identity does not match its path.");
  if (state.phase !== "completed" || state.receipt === undefined) {
    throw new OperationJournalError(
      "operation_not_compactable",
      "Only an operation with a durable completed receipt may be compacted."
    );
  }
  if (state.receipt.operationId !== operationId || state.receipt.requestDigest !== state.requestDigest) {
    throw corrupt("Terminal receipt identity does not match operation state.");
  }
  if (state.receipt.schemaVersion !== OPERATION_RECEIPT_SCHEMA_VERSION) {
    throw corrupt("Terminal receipt schema is unsupported.");
  }
}

function assertSameIdentity(
  leftOperationId: string,
  leftRequestDigest: string,
  rightOperationId: string,
  rightRequestDigest: string
): void {
  if (leftOperationId !== rightOperationId || leftRequestDigest !== rightRequestDigest) {
    throw corrupt("Durable operation records disagree about immutable identity.");
  }
}

function terminalLoaded(terminal: OperationTerminalRecordV1): LoadedOperationJournalV1 {
  return {
    state: jsonRoundTrip(terminal.state),
    envelopes: [],
    committedBytes: 0,
    partialTailBytes: 0,
    lastEventDigest: terminal.lastEventDigest
  };
}

function reconcileTerminalWithLog(
  terminal: OperationTerminalRecordV1,
  parsed: ParsedLog,
  operationId: string
): void {
  if (parsed.envelopes.length === 0) throw corrupt("Terminal record has an empty authoritative log beside it.");
  const state = reduceSafely(parsed.envelopes.map(envelope => envelope.event));
  assertCompletedState(state, operationId);
  const lastEventDigest = parsed.envelopes.at(-1)?.eventDigest;
  if (
    terminal.operationId !== state.operationId
    || terminal.requestDigest !== state.requestDigest
    || terminal.revision !== state.revision
    || terminal.lastEventDigest !== lastEventDigest
    || canonicalJson(terminal.state) !== canonicalJson(state)
  ) {
    throw corrupt("Durable terminal record and operation log disagree.");
  }
}

async function readTerminal(path: string, key: Uint8Array): Promise<OperationTerminalRecordV1> {
  const value = await readAuthenticatedFile<OperationTerminalRecordV1>(
    path,
    key,
    "codex-chatgpt-control/operation-terminal/v1",
    "terminalDigest",
    "journal_terminal_corrupt"
  );
  if (
    !hasExactKeys(value, [
      "schemaVersion",
      "operationId",
      "requestDigest",
      "revision",
      "lastEventDigest",
      "state",
      "receipt",
      "artifactManifest",
      "ownershipEvidenceDigests",
      "terminalDigest"
    ])
    ||
    value.schemaVersion !== TERMINAL_SCHEMA_VERSION
    || typeof value.operationId !== "string"
    || typeof value.requestDigest !== "string"
    || !Number.isSafeInteger(value.revision)
    || value.revision <= 0
    || !isDigest(value.lastEventDigest)
    || !isRecord(value.state)
    || !isRecord(value.receipt)
    || !Array.isArray(value.artifactManifest)
    || !Array.isArray(value.ownershipEvidenceDigests)
  ) {
    throw corrupt("Authenticated terminal record has an invalid shape.");
  }
  assertOperationId(value.operationId);
  if (!isDigest(value.requestDigest)) throw corrupt("Authenticated terminal request digest is invalid.");
  const state = value.state as OperationStateV1;
  try {
    assertOperationStateShape(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw corrupt(`Authenticated terminal state has an invalid shape: ${message}`);
  }
  if (state.schemaVersion !== OPERATION_SCHEMA_VERSION) throw corrupt("Authenticated terminal state schema is unsupported.");
  assertCompletedState(state, value.operationId);
  if (state.requestDigest !== value.requestDigest || state.revision !== value.revision) {
    throw corrupt("Authenticated terminal identity does not match its state.");
  }
  if (canonicalJson(state.receipt) !== canonicalJson(value.receipt)) {
    throw corrupt("Authenticated terminal receipt does not match its state.");
  }
  if (state.receipt === undefined || canonicalJson(state.receipt.artifacts) !== canonicalJson(value.artifactManifest)) {
    throw corrupt("Authenticated terminal artifact manifest does not match its receipt.");
  }
  if (!value.ownershipEvidenceDigests.every(isDigest)) {
    throw corrupt("Authenticated terminal ownership evidence is invalid.");
  }
  const expectedOwnershipEvidence = terminalOwnershipEvidenceDigests(state);
  if (canonicalJson(value.ownershipEvidenceDigests) !== canonicalJson(expectedOwnershipEvidence)) {
    throw corrupt("Authenticated terminal ownership evidence does not match its state.");
  }
  return value;
}

/**
 * Preserve every action-keyed ownership proof in a compact terminal record.
 * The singular fields are compatibility projections of the original Send;
 * include them as well so older authenticated state remains verifiable while
 * Work-steer witnesses and baselines cannot disappear during compaction.
 */
function terminalOwnershipEvidenceDigests(state: OperationStateV1): string[] {
  const receipt = state.receipt;
  if (receipt === undefined) throw corrupt("Completed operation has no terminal receipt.");
  const witnesses = [
    ...Object.values(state.submissionWitnesses ?? {}),
    ...(state.submissionWitness === undefined ? [] : [state.submissionWitness])
  ];
  const baselines = [
    ...Object.values(state.ownershipBaselines ?? {}),
    ...(state.ownershipBaseline === undefined ? [] : [state.ownershipBaseline])
  ];
  return Array.from(new Set([
    receipt.userTurnEvidenceDigest,
    receipt.ownershipEvidenceDigest,
    ...witnesses.flatMap(witness => [
      witness.baselineSnapshotDigest,
      witness.postSendDeltaDigest,
      witness.operationUserEvidenceDigest
    ]),
    ...baselines.flatMap(baseline => [
      baseline.targetBindingDigest,
      baseline.baseline.snapshotDigest
    ]),
    ...Object.values(state.actions)
      .map(action => action.evidenceDigest)
      .filter((digest): digest is string => digest !== undefined)
  ])).sort();
}

async function readTombstone(path: string, key: Uint8Array): Promise<OperationTombstoneV1> {
  const value = await readAuthenticatedFile<OperationTombstoneV1>(
    path,
    key,
    "codex-chatgpt-control/operation-tombstone/v1",
    "tombstoneDigest",
    "journal_tombstone_corrupt"
  );
  if (
    !hasExactKeys(value, ["schemaVersion", "operationId", "requestDigest", "tombstoneDigest"])
    ||
    value.schemaVersion !== TOMBSTONE_SCHEMA_VERSION
    || typeof value.operationId !== "string"
    || !isDigest(value.requestDigest)
  ) {
    throw corrupt("Authenticated tombstone has an invalid shape.");
  }
  assertOperationId(value.operationId);
  return value;
}

async function writeAuthenticatedAtomic<T extends Record<string, unknown>>(
  path: string,
  value: T,
  key: Uint8Array,
  domain: string,
  digestField: string,
  entropy: OperationJournalEntropy,
  inject: (point: JournalFaultPoint) => Promise<void>,
  replaceExisting: boolean
): Promise<void> {
  const withDigest = {
    ...value,
    [digestField]: hmacDigest(key, domain, withoutField(value, digestField))
  } as T;
  await writeAtomicJson(path, withDigest, entropy, inject, replaceExisting);
}

async function readAuthenticatedFile<T>(
  path: string,
  key: Uint8Array,
  domain: string,
  digestField: string,
  errorCode: string
): Promise<T> {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new OperationJournalError("operation_not_found", "No durable operation record exists.");
    }
    if (isNodeError(error, "ELOOP")) throw new OperationJournalError("unsafe_journal_entry", "Refusing to follow a symlinked operation record.");
    throw error;
  }
  let raw: string;
  try {
    const metadata = await assertSecureFileHandle(handle, path);
    if (!Number.isSafeInteger(metadata.size) || metadata.size > MAX_SINGLE_RECORD_FILE_BYTES) {
      throw new OperationJournalError(errorCode, "Authenticated operation record exceeds its hard safety limit.");
    }
    raw = await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new OperationJournalError(errorCode, "Authenticated operation record contains invalid JSON.");
  }
  if (!isRecord(value) || typeof value[digestField] !== "string") {
    throw new OperationJournalError(errorCode, "Authenticated operation record has no valid checksum.");
  }
  const expected = hmacDigest(key, domain, withoutField(value, digestField));
  if (value[digestField] !== expected) {
    throw new OperationJournalError(errorCode, "Authenticated operation record checksum is invalid.");
  }
  return value as T;
}

async function readQuotaCounter(path: string, key: Uint8Array): Promise<OperationQuotaCounterV1> {
  const value = await readAuthenticatedFile<OperationQuotaCounterV1>(
    path,
    key,
    "codex-chatgpt-control/operation-quota-state/v1",
    "counterDigest",
    "journal_quota_counter_corrupt"
  );
  if (!hasExactKeys(value, [
    "schemaVersion",
    "revision",
    "totalBytes",
    "entryCount",
    "dirty",
    "directories",
    "counterDigest"
  ])
    || value.schemaVersion !== QUOTA_COUNTER_SCHEMA_VERSION
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 0
    || !Number.isSafeInteger(value.entryCount) || value.entryCount < 0
    || typeof value.dirty !== "boolean"
    || !isDigest(value.counterDigest)
    || !isQuotaDirectoryFingerprintRecord(value.directories)) {
    throw new OperationJournalError(
      "journal_quota_counter_corrupt",
      "Authenticated operation quota state has an invalid shape."
    );
  }
  return value;
}

async function writeQuotaCounter(
  path: string,
  material: OperationQuotaCounterV1,
  key: Uint8Array,
  entropy: OperationJournalEntropy
): Promise<OperationQuotaCounterV1> {
  const withoutDigest = withoutField(material, "counterDigest");
  const value = {
    ...withoutDigest,
    counterDigest: hmacDigest(
      key,
      "codex-chatgpt-control/operation-quota-state/v1",
      withoutDigest
    )
  } as OperationQuotaCounterV1;
  await writeAtomicJson(path, value, entropy, async () => undefined, true);
  return value;
}

async function readQuotaDirectoryFingerprints(
  stateRoot: string
): Promise<OperationQuotaCounterV1["directories"]> {
  const entries = await Promise.all(TRACKED_STATE_DIRECTORIES.map(async directoryName => {
    const path = childPath(stateRoot, directoryName);
    const metadata = await lstat(path, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new OperationJournalError("unsafe_state_root", "Operation state path is not a secure directory.");
    }
    assertOwnerAndMode(metadata, path, POSIX_DIRECTORY_MODE);
    const fingerprint: QuotaDirectoryFingerprintV1 = {
      device: String(metadata.dev),
      inode: String(metadata.ino),
      modifiedNs: String(metadata.mtimeNs),
      changedNs: String(metadata.ctimeNs)
    };
    return [directoryName, fingerprint] as const;
  }));
  return Object.fromEntries(entries) as OperationQuotaCounterV1["directories"];
}

function sameQuotaDirectoryFingerprints(
  left: OperationQuotaCounterV1["directories"],
  right: OperationQuotaCounterV1["directories"]
): boolean {
  return TRACKED_STATE_DIRECTORIES.every(directoryName => {
    const a = left[directoryName];
    const b = right[directoryName];
    return a.device === b.device
      && a.inode === b.inode
      && a.modifiedNs === b.modifiedNs
      && a.changedNs === b.changedNs;
  });
}

function isQuotaDirectoryFingerprintRecord(
  value: unknown
): value is OperationQuotaCounterV1["directories"] {
  if (!isRecord(value) || !hasExactKeys(value, [...TRACKED_STATE_DIRECTORIES])) return false;
  return TRACKED_STATE_DIRECTORIES.every(directoryName => {
    const fingerprint = value[directoryName];
    return isRecord(fingerprint)
      && hasExactKeys(fingerprint, ["device", "inode", "modifiedNs", "changedNs"])
      && [fingerprint.device, fingerprint.inode, fingerprint.modifiedNs, fingerprint.changedNs]
        .every(item => typeof item === "string" && /^\d+$/u.test(item));
  });
}

function nextQuotaRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new OperationJournalError("journal_quota_counter_corrupt", "Operation quota revision is invalid.");
  }
  return revision + 1;
}

function assertQuotaDelta(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new OperationJournalError("journal_quota_counter_corrupt", `Operation quota ${label} is invalid.`);
  }
}

function withoutField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

async function writeAtomicJson(
  path: string,
  value: Record<string, unknown>,
  entropy: OperationJournalEntropy,
  inject: (point: JournalFaultPoint) => Promise<void>,
  replaceExisting: boolean
): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = join(directory, `.${path.split(sep).at(-1) ?? "operation"}-${entropyUuid(entropy)}.tmp`);
  let handle;
  let createdTemporary = false;
  try {
    try {
      handle = await open(
        temporaryPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
        POSIX_FILE_MODE
      );
    } catch (error) {
      if (isNodeError(error, "EEXIST")) {
        throw new OperationJournalError("journal_temp_conflict", "A temporary operation state file already exists.");
      }
      throw error;
    }
    createdTemporary = true;
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (replaceExisting) {
      await assertReplaceableRegularFile(path);
      await rename(temporaryPath, path);
    } else {
      try {
        await link(temporaryPath, path);
      } catch (error) {
        if (isNodeError(error, "EEXIST")) {
          throw new OperationJournalError("durable_record_conflict", "Refusing to replace an existing durable operation record.");
        }
        throw error;
      }
      await unlink(temporaryPath);
    }
    await syncDirectory(directory);
    await inject(injectPointForPath(path));
  } finally {
    await handle?.close();
    if (createdTemporary) {
      await unlink(temporaryPath).catch(error => {
        if (!isNodeError(error, "ENOENT")) throw error;
      });
    }
  }
}

function injectPointForPath(path: string): JournalFaultPoint {
  if (path.includes(`${SNAPSHOT_DIRECTORY}${sep}`)) return "after_snapshot_synced";
  if (path.includes(`${TERMINAL_DIRECTORY}${sep}`)) return "after_terminal_synced";
  return "after_tombstone_synced";
}

async function assertReplaceableRegularFile(path: string): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new OperationJournalError("unsafe_journal_entry", "Refusing to replace a non-regular or symlinked operation cache.");
  }
  assertOwnerAndMode(metadata, path, POSIX_FILE_MODE);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

async function fileSize(path: string): Promise<number> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new OperationJournalError("unsafe_journal_entry", "Expected a regular operation state file.");
  }
  return metadata.size;
}

async function optionalFileSize(path: string): Promise<number | undefined> {
  try {
    return await fileSize(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function hasDurableState(stateRoot: string): Promise<boolean> {
  if (await pathExists(childPath(stateRoot, QUOTA_COUNTER_FILE))) return true;
  let scannedEntries = 0;
  for (const directoryName of TRACKED_STATE_DIRECTORIES) {
    const directory = childPath(stateRoot, directoryName);
    const handle = await opendir(directory);
    try {
      for await (const entry of handle) {
        scannedEntries += 1;
        assertQuotaScanEntryLimit(scannedEntries);
        if (entry.name !== ".DS_Store") return true;
      }
    } finally {
      await closeDirectory(handle);
    }
  }
  return false;
}

async function scanStateUsage(stateRoot: string): Promise<StateUsage> {
  let total = 0;
  let entryCount = 0;
  let scannedEntries = 0;
  const directories: Array<[string, RegExp]> = [
    [LOG_DIRECTORY, /^[0-9a-f]{64}\.jsonl$/],
    [TERMINAL_DIRECTORY, /^[0-9a-f]{64}\.terminal\.json$/],
    [SNAPSHOT_DIRECTORY, /^[0-9a-f]{64}\.snapshot\.json$/],
    [TOMBSTONE_DIRECTORY, /^[0-9a-f]{64}\.tombstone\.json$/]
  ];
  const temporaryPattern = /^\.[a-z0-9][a-z0-9.-]*-[0-9a-f-]+\.tmp$/;
  for (const [directoryName, canonicalPattern] of directories) {
    const directory = childPath(stateRoot, directoryName);
    const handle = await opendir(directory);
    try {
      for await (const entry of handle) {
        scannedEntries += 1;
        assertQuotaScanEntryLimit(scannedEntries);
        if (entry.name === ".DS_Store") continue;
        entryCount += 1;
        if (!canonicalPattern.test(entry.name) && !temporaryPattern.test(entry.name)) {
          throw new OperationJournalError("unsafe_journal_entry", "Unexpected journal entry in operation state.");
        }
        const filePath = childPath(directory, entry.name);
        const metadata = await lstat(filePath);
        if (metadata.isSymbolicLink() || !metadata.isFile()) {
          throw new OperationJournalError("unsafe_journal_entry", "Unexpected operation state entry type.");
        }
        assertOwnerAndMode(metadata, filePath, POSIX_FILE_MODE);
        if (!Number.isSafeInteger(metadata.size) || metadata.size > MAX_QUOTA_SCAN_BYTES - total) {
          throw new OperationJournalError("journal_scan_limit", "Operation journal quota scan exceeded its hard byte limit.");
        }
        total += metadata.size;
      }
    } finally {
      await closeDirectory(handle);
    }
  }
  return { totalBytes: total, entryCount };
}

function assertQuotaScanEntryLimit(scannedEntries: number): void {
  if (scannedEntries > MAX_QUOTA_SCAN_ENTRIES) {
    throw new OperationJournalError("journal_scan_limit", "Operation journal quota scan exceeded its hard entry limit.");
  }
}

async function closeDirectory(handle: Awaited<ReturnType<typeof opendir>>): Promise<void> {
  try {
    await handle.close();
  } catch (error) {
    if (isNodeError(error, "ERR_DIR_CLOSED")) return;
    throw error;
  }
}

async function appendRecord(args: {
  logPath: string;
  encoded: Buffer;
  committedBytes: number;
  partialTailBytes: number;
  createExclusive: boolean;
  syncParent: boolean;
  inject: (point: JournalFaultPoint) => Promise<void>;
}): Promise<void> {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const createFlags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow;
  const appendFlags = fsConstants.O_WRONLY | fsConstants.O_APPEND | noFollow;
  const repairFlags = fsConstants.O_WRONLY | noFollow;
  let handle;
  try {
    handle = await open(
      args.logPath,
      args.createExclusive ? createFlags : args.partialTailBytes > 0 ? repairFlags : appendFlags,
      POSIX_FILE_MODE
    );
  } catch (error) {
    if (args.createExclusive && isNodeError(error, "EEXIST")) {
      throw new OperationJournalError("revision_conflict", "The operation log appeared during exclusive creation.");
    }
    throw error;
  }

  try {
    const metadata = await assertSecureFileHandle(handle, args.logPath);
    if (metadata.size !== args.committedBytes + args.partialTailBytes) {
      throw new OperationJournalError(
        "revision_conflict",
        "The operation log changed before its next record could be appended."
      );
    }
    if (args.committedBytes + args.encoded.byteLength > MAX_SINGLE_RECORD_FILE_BYTES) {
      throw new OperationJournalError(
        "journal_log_too_large",
        "The operation log reached its hard safety limit; existing evidence was preserved."
      );
    }
    if (args.partialTailBytes > 0) {
      await handle.truncate(args.committedBytes);
      await args.inject("after_partial_tail_truncated");
      await writeBufferAt(handle, args.encoded, args.committedBytes);
    } else {
      await handle.writeFile(args.encoded);
    }
    await args.inject("after_record_written");
    await handle.sync();
    await args.inject("after_record_synced");
  } finally {
    await handle.close();
  }
  if (args.syncParent) await syncDirectory(dirname(args.logPath));
}

async function writeBufferAt(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Buffer,
  position: number
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      position + offset
    );
    if (bytesWritten <= 0) {
      throw new OperationJournalError("journal_write_failed", "Operation journal write made no progress.");
    }
    offset += bytesWritten;
  }
}

async function readLog(logPath: string, key: Uint8Array, allowMissing: boolean): Promise<ParsedLog> {
  let handle;
  try {
    handle = await open(logPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (isNodeError(error, "ENOENT") && allowMissing) {
      return { exists: false, envelopes: [], committedBytes: 0, partialTailBytes: 0 };
    }
    if (isNodeError(error, "ENOENT")) {
      throw new OperationJournalError("operation_not_found", "No durable operation exists for this operation ID.");
    }
    if (isNodeError(error, "ELOOP")) {
      throw new OperationJournalError("unsafe_journal_entry", "Refusing to follow a symlinked operation log.");
    }
    throw error;
  }

  let bytes: Buffer;
  try {
    const metadata = await assertSecureFileHandle(handle, logPath);
    if (!Number.isSafeInteger(metadata.size) || metadata.size > MAX_SINGLE_RECORD_FILE_BYTES) {
      throw new OperationJournalError("journal_log_too_large", "The operation log exceeds its hard safety limit.");
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }

  const lastNewline = bytes.lastIndexOf(0x0a);
  const committedBytes = lastNewline < 0 ? 0 : lastNewline + 1;
  const partialTailBytes = bytes.byteLength - committedBytes;
  const committedText = bytes.subarray(0, committedBytes).toString("utf8");
  const lines = committedText.length === 0 ? [] : committedText.slice(0, -1).split("\n");
  const envelopes: OperationEventEnvelopeV1[] = [];
  let expectedPrevious = GENESIS_EVENT_DIGEST;

  for (const [index, line] of lines.entries()) {
    if (line.length === 0) throw corrupt(`Empty committed record at revision ${index + 1}.`);
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw corrupt(`Invalid committed JSON at revision ${index + 1}.`);
    }
    const envelope = assertEnvelope(value, index + 1);
    if (envelope.previousEventDigest !== expectedPrevious) {
      throw corrupt(`Broken previous-event hash at revision ${index + 1}.`);
    }
    const expectedDigest = journalEventDigest(key, envelope.revision, envelope.previousEventDigest, envelope.event);
    if (envelope.eventDigest !== expectedDigest) {
      throw corrupt(`Invalid event checksum at revision ${index + 1}.`);
    }
    envelopes.push(envelope);
    expectedPrevious = envelope.eventDigest;
  }

  if (envelopes.length > 0) reduceSafely(envelopes.map(envelope => envelope.event));
  // A prior process can stop after writing a complete checksummed line but
  // before confirming fsync. Re-loading that line must make it durable before
  // its intent can authorize any browser mutation.
  await ensureLogDurable(logPath);
  return { exists: true, envelopes, committedBytes, partialTailBytes };
}

async function ensureLogDurable(logPath: string): Promise<void> {
  let handle;
  try {
    handle = await open(logPath, fsConstants.O_RDWR | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (isNodeError(error, "ELOOP")) {
      throw new OperationJournalError("unsafe_journal_entry", "Refusing to follow a symlinked operation log.");
    }
    throw error;
  }
  try {
    await assertSecureFileHandle(handle, logPath);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(logPath));
}

function assertEnvelope(value: unknown, expectedRevision: number): OperationEventEnvelopeV1 {
  if (!isRecord(value)) throw corrupt(`Committed revision ${expectedRevision} is not an object.`);
  if (!hasExactKeys(value, ["schemaVersion", "revision", "previousEventDigest", "eventDigest", "event"])) {
    throw corrupt(`Committed revision ${expectedRevision} has unexpected fields.`);
  }
  if (value.schemaVersion !== OPERATION_EVENT_SCHEMA_VERSION) {
    throw corrupt(`Unknown operation event schema at revision ${expectedRevision}.`);
  }
  if (value.revision !== expectedRevision) throw corrupt(`Non-sequential journal revision ${String(value.revision)}.`);
  if (!isDigest(value.previousEventDigest) || !isDigest(value.eventDigest)) {
    throw corrupt(`Invalid digest encoding at revision ${expectedRevision}.`);
  }
  if (!isRecord(value.event) || typeof value.event.type !== "string") {
    throw corrupt(`Invalid event payload at revision ${expectedRevision}.`);
  }
  return value as OperationEventEnvelopeV1;
}

async function loadOrCreateKey(stateRoot: string, entropy: OperationJournalEntropy): Promise<Buffer> {
  const keyPath = childPath(stateRoot, KEY_FILE);
  try {
    return await readKey(keyPath);
  } catch (error) {
    if (!(error instanceof OperationJournalError && error.code === "journal_key_missing")) throw error;
  }

  if (await hasDurableState(stateRoot)) {
    throw new OperationJournalError(
      "journal_key_missing_with_state",
      "Durable operation state exists but its journal key is missing; refusing to create a new identity domain."
    );
  }

  const key = entropyBytes(entropy, KEY_BYTES);
  const temporaryKeyPath = childPath(stateRoot, `.journal-key-${entropyUuid(entropy)}.tmp`);
  let handle;
  try {
    handle = await open(
      temporaryKeyPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      POSIX_FILE_MODE
    );
    await handle.writeFile(key);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  try {
    await link(temporaryKeyPath, keyPath);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  } finally {
    await unlink(temporaryKeyPath).catch(error => {
      if (!isNodeError(error, "ENOENT")) throw error;
    });
  }
  await syncDirectory(stateRoot);
  return readKey(keyPath);
}

async function readKey(keyPath: string): Promise<Buffer> {
  let handle;
  try {
    handle = await open(keyPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) throw new OperationJournalError("journal_key_missing", "Operation journal key is missing.");
    if (isNodeError(error, "ELOOP")) throw new OperationJournalError("unsafe_journal_key", "Refusing to follow a symlinked journal key.");
    throw error;
  }
  try {
    await assertSecureFileHandle(handle, keyPath);
    const key = await handle.readFile();
    if (key.byteLength !== KEY_BYTES) {
      throw new OperationJournalError("invalid_journal_key", `Operation journal key must be ${KEY_BYTES} bytes.`);
    }
    if (key.every(byte => byte === 0)) {
      throw new OperationJournalError("invalid_journal_key", "Operation journal key is invalid.");
    }
    return key;
  } finally {
    await handle.close();
  }
}

async function ensureSecureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: POSIX_DIRECTORY_MODE });
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new OperationJournalError("unsafe_state_root", "Operation state path is not a secure directory.");
  }
  assertOwnerAndMode(metadata, directory, POSIX_DIRECTORY_MODE);
}

async function assertSecureFileHandle(handle: Awaited<ReturnType<typeof open>>, path: string): Promise<Stats> {
  const metadata = await handle.stat();
  if (!metadata.isFile()) throw new OperationJournalError("unsafe_journal_entry", "Expected a regular operation state file.");
  assertOwnerAndMode(metadata, path, POSIX_FILE_MODE);
  return metadata;
}

function assertOwnerAndMode(
  metadata: Pick<Stats, "uid" | "mode"> | Pick<BigIntStats, "uid" | "mode">,
  path: string,
  expectedMode: number
): void {
  if (platform() === "win32") return;
  const runtime = requireJournalRuntime();
  if (Number(metadata.uid) !== runtime.getuid!()) {
    throw new OperationJournalError("unsafe_state_owner", "Operation state path is not owned by the current user.");
  }
  if ((Number(metadata.mode) & 0o077) !== 0) {
    throw new OperationJournalError(
      "unsafe_state_permissions",
      `Operation state path permissions must be ${expectedMode.toString(8)} or stricter.`
    );
  }
}

async function acquireLock(
  lockPath: string,
  timeoutMs: number,
  clock: OperationJournalClock,
  entropy: OperationJournalEntropy
): Promise<HeldLock> {
  const token = entropyUuid(entropy);
  const record: LockRecord = {
    schemaVersion: "chatgpt.browser_control.operation_lock.v1",
    token,
    pid: process.pid,
    hostname: hostname(),
    createdAt: clockTimestamp(clock)
  };
  const deadline = safeDeadline(clockNow(clock), timeoutMs);
  // Treat the configured timeout as a finite retry budget as well as a wall
  // deadline. An injected or adjusted wall clock may remain constant or move
  // backwards; neither condition may turn lock acquisition into an unbounded
  // loop. Forward wall-clock movement can still expire the wait earlier.
  let remainingWaitBudgetMs = timeoutMs;
  while (true) {
    let handle;
    let createdIdentity: Pick<Stats, "dev" | "ino"> | undefined;
    try {
      handle = await open(
        lockPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
        POSIX_FILE_MODE
      );
      const metadata = await handle.stat();
      createdIdentity = { dev: metadata.dev, ino: metadata.ino };
      await handle.writeFile(`${canonicalJson(record)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      return { path: lockPath, token };
    } catch (error) {
      await handle?.close();
      if (createdIdentity !== undefined) {
        await removeFailedExclusiveLock(lockPath, createdIdentity);
      }
      if (!isNodeError(error, "EEXIST")) throw error;
      let owner: LockRecord;
      try {
        owner = await readLock(lockPath);
      } catch (readError) {
        if (readError instanceof OperationJournalError && readError.code === "journal_lock_changed") {
          continue;
        }
        throw readError;
      }
      if (owner.hostname === hostname() && !processExists(owner.pid)) {
        const reclaimed = await quarantineAbandonedLock(lockPath, owner.token, clock, entropy);
        if (!reclaimed) {
          const remaining = Math.min(deadline - clockNow(clock), remainingWaitBudgetMs);
          if (remaining <= 0) {
            throw new OperationJournalError(
              "journal_lock_timeout",
              "Timed out while another process was recovering an abandoned operation journal lock."
            );
          }
          const waitMs = Math.min(LOCK_RETRY_MS, remaining);
          remainingWaitBudgetMs -= waitMs;
          await clockSleep(clock, waitMs);
        }
        continue;
      }
      const remaining = Math.min(deadline - clockNow(clock), remainingWaitBudgetMs);
      if (remaining <= 0) {
        throw new OperationJournalError(
          "journal_lock_timeout",
          "Timed out waiting for the operation journal lock."
        );
      }
      const waitMs = Math.min(LOCK_RETRY_MS, remaining);
      remainingWaitBudgetMs -= waitMs;
      await clockSleep(clock, waitMs);
    }
  }
}

async function readLock(lockPath: string): Promise<LockRecord> {
  let handle;
  try {
    handle = await open(lockPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new OperationJournalError("journal_lock_changed", "Operation journal lock changed while being inspected.");
    }
    if (isNodeError(error, "ELOOP")) {
      throw new OperationJournalError("journal_lock_corrupt", "Refusing to follow a symlinked operation lock.");
    }
    throw error;
  }
  let raw: string;
  try {
    const metadata = await assertSecureFileHandle(handle, lockPath);
    if (!Number.isSafeInteger(metadata.size) || metadata.size > MAX_LOCK_RECORD_BYTES) {
      throw new OperationJournalError("journal_lock_corrupt", "Operation journal lock record is too large.");
    }
    raw = await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new OperationJournalError("journal_lock_corrupt", "Operation journal lock record is corrupt.");
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "token", "pid", "hostname", "createdAt"]) ||
    value.schemaVersion !== "chatgpt.browser_control.operation_lock.v1" ||
    typeof value.token !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.token) ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.hostname !== "string" ||
    value.hostname.length === 0 ||
    value.hostname.length > 255 ||
    typeof value.createdAt !== "string" ||
    !isIsoTimestamp(value.createdAt)
  ) {
    throw new OperationJournalError("journal_lock_corrupt", "Operation journal lock record has an invalid shape.");
  }
  return value as LockRecord;
}

/**
 * Reclaim one provably dead local owner without racing another reclaimer.
 *
 * A read-token-then-rename sequence is not a compare-and-swap: after the old
 * lock is renamed, another process can create a new canonical lock before a
 * second reclaimer performs its rename.  The second rename would then steal
 * the live owner's lock.  An exclusive recovery guard elects exactly one
 * cooperating reclaimer before it re-reads and moves the canonical path.
 *
 * Recovery guards are never reclaimed on age alone.  If their owner dies,
 * recovery fails closed for manual diagnosis; this trades liveness for never
 * authorising overlapping journal writers.
 */
async function quarantineAbandonedLock(
  lockPath: string,
  expectedToken: string,
  clock: OperationJournalClock,
  entropy: OperationJournalEntropy
): Promise<boolean> {
  const guard = await tryAcquireRecoveryGuard(lockPath, clock, entropy);
  if (guard === undefined) return false;

  const quarantinePath = `${lockPath}.abandoned-${entropyUuid(entropy)}`;
  try {
    let current: LockRecord;
    try {
      current = await readLock(lockPath);
    } catch (error) {
      if (error instanceof OperationJournalError && error.code === "journal_lock_changed") return false;
      throw error;
    }
    if (
      current.token !== expectedToken ||
      current.hostname !== hostname() ||
      processExists(current.pid)
    ) {
      return false;
    }

    try {
      await rename(lockPath, quarantinePath);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
    const moved = await readLock(quarantinePath);
    if (moved.token !== expectedToken) {
      // Never rename the unexpected record back: POSIX rename could atomically
      // overwrite a legitimate owner that acquired the canonical path meanwhile.
      // Preserve the quarantined claim for explicit diagnosis and fail closed.
      throw new OperationJournalError("journal_lock_changed", "Operation journal lock ownership changed during recovery.");
    }
    await unlink(quarantinePath);
    return true;
  } finally {
    await releaseLock(guard);
  }
}

async function tryAcquireRecoveryGuard(
  lockPath: string,
  clock: OperationJournalClock,
  entropy: OperationJournalEntropy
): Promise<HeldLock | undefined> {
  const guardPath = `${lockPath}${LOCK_RECOVERY_SUFFIX}`;
  const token = entropyUuid(entropy);
  const record: LockRecord = {
    schemaVersion: "chatgpt.browser_control.operation_lock.v1",
    token,
    pid: process.pid,
    hostname: hostname(),
    createdAt: clockTimestamp(clock)
  };
  let handle;
  let createdIdentity: Pick<Stats, "dev" | "ino"> | undefined;
  try {
    handle = await open(
      guardPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      POSIX_FILE_MODE
    );
    const metadata = await handle.stat();
    createdIdentity = { dev: metadata.dev, ino: metadata.ino };
    await handle.writeFile(`${canonicalJson(record)}\n`, "utf8");
    await handle.sync();
    return { path: guardPath, token };
  } catch (error) {
    if (createdIdentity !== undefined) {
      await handle?.close();
      handle = undefined;
      await removeFailedExclusiveLock(guardPath, createdIdentity);
    }
    if (!isNodeError(error, "EEXIST")) throw error;
    let owner: LockRecord;
    try {
      owner = await readLock(guardPath);
    } catch (readError) {
      if (readError instanceof OperationJournalError && readError.code === "journal_lock_changed") return undefined;
      throw readError;
    }
    if (owner.hostname === hostname() && !processExists(owner.pid)) {
      throw new OperationJournalError(
        "journal_lock_recovery_abandoned",
        "An abandoned journal lock-recovery guard requires manual diagnosis; it will not be reclaimed automatically."
      );
    }
    return undefined;
  } finally {
    await handle?.close();
  }
}

async function removeFailedExclusiveLock(
  path: string,
  created: Pick<Stats, "dev" | "ino">
): Promise<void> {
  let current: Stats;
  try {
    current = await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
  if (
    current.isSymbolicLink()
    || !current.isFile()
    || current.dev !== created.dev
    || current.ino !== created.ino
  ) {
    throw new OperationJournalError(
      "journal_lock_cleanup_failed",
      "A failed exclusive lock creation no longer names the file that this process created."
    );
  }
  await unlink(path);
}

async function releaseLock(lock: HeldLock): Promise<void> {
  let owner: LockRecord;
  try {
    owner = await readLock(lock.path);
  } catch (error) {
    if (error instanceof OperationJournalError && error.code === "journal_lock_changed") return;
    throw error;
  }
  if (owner.token !== lock.token) {
    throw new OperationJournalError("journal_lock_lost", "Operation journal lock ownership changed before release.");
  }
  await unlink(lock.path);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, "ESRCH");
  }
}

async function serializeInProcess<T>(key: string, action: () => Promise<T>): Promise<T> {
  const prior = inProcessQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolveGate => { release = resolveGate; });
  const tail = prior.catch(() => undefined).then(() => gate);
  inProcessQueues.set(key, tail);
  await prior.catch(() => undefined);
  try {
    // Mark the in-flight operation as observed immediately. Callers still
    // receive the original rejection, while Node/Vitest cannot misclassify a
    // deliberately handled error as an unhandled rejection during lock
    // cleanup.
    const result = action();
    result.catch(() => undefined);
    return await result;
  } finally {
    release();
    if (inProcessQueues.get(key) === tail) inProcessQueues.delete(key);
  }
}

async function syncDirectory(directory: string): Promise<void> {
  if (platform() === "win32") return;
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function childPath(root: string, ...parts: string[]): string {
  const candidate = resolve(root, ...parts);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(prefix)) {
    throw new OperationJournalError("state_path_escape", "Resolved operation state path escaped the configured root.");
  }
  return candidate;
}

function reduceSafely(events: readonly OperationEventV1[]): OperationStateV1 {
  try {
    return reduceOperationEvents(events);
  } catch (error) {
    if (error instanceof OperationJournalError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw corrupt(`Operation state reduction failed: ${message}`);
  }
}

function jsonRoundTrip<T>(value: T): T {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new OperationJournalError("event_not_serializable", "Operation value is not JSON serializable.");
  return JSON.parse(encoded) as T;
}

function corrupt(message: string): OperationJournalError {
  return new OperationJournalError("journal_corrupt", message);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^hmac-sha256:[0-9a-f]{64}$/.test(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

function isIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return nodeErrorCode(error) === code;
}

function validatePositiveInteger(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new OperationJournalError("invalid_journal_option", `${label} must be a positive safe integer.`);
  }
}

function resolveClock(value: OperationJournalClock | undefined): OperationJournalClock {
  if (value === undefined) {
    return {
      now: () => Date.now(),
      sleep: milliseconds => delay(milliseconds)
    };
  }
  try {
    if (
      value === null
      || typeof value !== "object"
      || typeof value.now !== "function"
      || typeof value.sleep !== "function"
    ) {
      throw new Error("invalid clock");
    }
  } catch {
    throw new OperationJournalError(
      "invalid_journal_clock",
      "Operation journal clock must provide callable now and sleep functions."
    );
  }
  return value;
}

function resolveEntropy(value: OperationJournalEntropy | undefined): OperationJournalEntropy {
  if (value === undefined) {
    return {
      randomBytes: size => randomBytes(size),
      randomUUID: () => randomUUID()
    };
  }
  try {
    if (
      value === null
      || typeof value !== "object"
      || typeof value.randomBytes !== "function"
      || typeof value.randomUUID !== "function"
    ) {
      throw new Error("invalid entropy");
    }
  } catch {
    throw new OperationJournalError(
      "invalid_journal_entropy",
      "Operation journal entropy must provide callable randomBytes and randomUUID functions."
    );
  }
  return value;
}

function entropyUuid(entropy: OperationJournalEntropy): string {
  let value: unknown;
  try {
    value = entropy.randomUUID();
  } catch {
    throw new OperationJournalError("invalid_journal_entropy", "Operation journal entropy failed to provide a UUID.");
  }
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    throw new OperationJournalError(
      "invalid_journal_entropy",
      "Operation journal entropy must provide canonical version-four UUIDs."
    );
  }
  return value;
}

function entropyBytes(entropy: OperationJournalEntropy, size: number): Buffer {
  let value: unknown;
  try {
    value = entropy.randomBytes(size);
  } catch {
    throw new OperationJournalError("invalid_journal_entropy", "Operation journal entropy failed to provide key bytes.");
  }
  if (!isByteArrayView(value) || value.byteLength !== size) {
    throw new OperationJournalError(
      "invalid_journal_entropy",
      "Operation journal entropy returned key bytes with an invalid length."
    );
  }
  const key = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (key.every(byte => byte === 0)) {
    throw new OperationJournalError("invalid_journal_entropy", "Operation journal entropy returned an invalid key.");
  }
  return key;
}

function clockNow(clock: OperationJournalClock): number {
  let value: unknown;
  try {
    value = clock.now();
  } catch {
    throw new OperationJournalError("invalid_journal_clock", "Operation journal clock failed to provide time.");
  }
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < -MAX_TIMESTAMP_MS
    || value > MAX_TIMESTAMP_MS
  ) {
    throw new OperationJournalError("invalid_journal_clock", "Operation journal clock returned an invalid timestamp.");
  }
  return value;
}

function clockTimestamp(clock: OperationJournalClock): string {
  return new Date(clockNow(clock)).toISOString();
}

async function clockSleep(clock: OperationJournalClock, milliseconds: number): Promise<void> {
  try {
    await clock.sleep(milliseconds);
  } catch {
    throw new OperationJournalError("invalid_journal_clock", "Operation journal clock wait failed.");
  }
}

function safeDeadline(now: number, timeoutMs: number): number {
  const deadline = now + timeoutMs;
  return Number.isSafeInteger(deadline) ? deadline : Number.MAX_SAFE_INTEGER;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}
