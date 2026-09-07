#!/usr/bin/env node

// src/operations/journal-rpc-server.ts
import { randomBytes as randomBytes3, randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir2, opendir as opendir2, unlink as unlink3 } from "node:fs/promises";
import { isAbsolute as isAbsolute3, join as join3, resolve as resolve3 } from "node:path";

// src/operations/journal.ts
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  unlink
} from "node:fs/promises";
import { homedir, hostname, platform } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// src/errors.ts
function nodeErrorCode(error) {
  if (error === null || typeof error !== "object" && typeof error !== "function") return void 0;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    if (descriptor === void 0 || !("value" in descriptor) || typeof descriptor.value !== "string") {
      return void 0;
    }
    return descriptor.value;
  } catch {
    return void 0;
  }
}

// src/runtime/value-boundaries.ts
function isByteArrayView(value) {
  if (!ArrayBuffer.isView(value)) return false;
  try {
    const view = value;
    return view.BYTES_PER_ELEMENT === 1 && Number.isSafeInteger(view.length) && view.length === view.byteLength;
  } catch {
    return false;
  }
}

// src/operations/canonical.ts
import { createHmac } from "node:crypto";
var DIGEST_PREFIX = "hmac-sha256:";
var MAX_CANONICAL_DEPTH = 32;
var MAX_CANONICAL_NODES = 1e5;
var MAX_CANONICAL_PROPERTIES = 32768;
var MAX_CANONICAL_ARRAY_LENGTH = 32768;
var MAX_CANONICAL_BYTES = 16 * 1024 * 1024;
var MAX_CANONICAL_KEY_BYTES = 4096;
var SAFE_CANONICAL_ERROR = "Canonical JSON input could not be inspected safely.";
var RESERVED_CANONICAL_KEYS = /* @__PURE__ */ new Set(["$undefined", "$date", "$bytes"]);
var TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
var TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength"
)?.get;
function canonicalJson(value) {
  const budget = { nodes: 0, properties: 0, bytes: 0 };
  const canonical = canonicalValue(value, /* @__PURE__ */ new WeakSet(), budget, 0);
  let encoded;
  try {
    encoded = JSON.stringify(canonical);
  } catch {
    throw new TypeError(SAFE_CANONICAL_ERROR);
  }
  if (typeof encoded !== "string") throw new TypeError(SAFE_CANONICAL_ERROR);
  if (Buffer.byteLength(encoded, "utf8") > MAX_CANONICAL_BYTES) {
    throw new TypeError("Canonical JSON exceeds the bounded byte limit.");
  }
  return encoded;
}
function hmacDigest(key, domain, value) {
  const hmac = createHmac("sha256", key);
  hmac.update(`${domain}\0`, "utf8");
  hmac.update(canonicalJson(value), "utf8");
  return `${DIGEST_PREFIX}${hmac.digest("hex")}`;
}
function operationRequestDigest(key, input) {
  const inputValues = safeRecordValues(input, [
    "operationId",
    "surface",
    "target",
    "prompt",
    "configuration",
    "tools",
    "files",
    "capturePolicy",
    "behavior"
  ]);
  const operationId = inputValues.get("operationId");
  const surface = inputValues.get("surface");
  const target = inputValues.get("target");
  const prompt = inputValues.get("prompt");
  const configuration = inputValues.get("configuration");
  const tools = inputValues.get("tools");
  const files = inputValues.get("files");
  const capturePolicy = inputValues.get("capturePolicy");
  const behavior = inputValues.get("behavior");
  if (typeof prompt !== "string") throw new TypeError(SAFE_CANONICAL_ERROR);
  const fileProjection = [];
  if (files !== void 0) {
    for (const file of safeArrayElements(files)) {
      fileProjection.push(canonicalFileProjection(key, file));
    }
  }
  return hmacDigest(key, "codex-chatgpt-control/operation-request/v1", {
    schemaVersion: "chatgpt.browser_control.operation_request_identity.v1",
    operationId,
    surface,
    target,
    prompt: {
      digest: hmacDigest(key, "codex-chatgpt-control/prompt/v1", prompt),
      bytes: Buffer.byteLength(prompt, "utf8")
    },
    configuration,
    tools,
    files: fileProjection,
    // Capture format is part of the immutable request identity. Older
    // request records omitted it, so canonicalize an omitted/undefined value
    // to the historical default instead of allowing an equivalent request to
    // hash differently after a restart.
    capturePolicy: canonicalCapturePolicy(capturePolicy),
    behavior
  });
}
function canonicalFileProjection(key, value) {
  const values = safeRecordValues(value, ["displayName", "bytes", "contentSha256"]);
  const displayName = values.get("displayName");
  const bytes = values.get("bytes");
  const contentSha256 = values.get("contentSha256");
  if (typeof displayName !== "string" || !Number.isSafeInteger(bytes) || typeof contentSha256 !== "string") {
    throw new TypeError(SAFE_CANONICAL_ERROR);
  }
  const byteCount = bytes;
  return {
    displayNameDigest: hmacDigest(
      key,
      "codex-chatgpt-control/file-display-name/v1",
      displayName.normalize("NFC")
    ),
    bytes: byteCount,
    contentDigest: hmacDigest(
      key,
      "codex-chatgpt-control/file-content-sha256/v1",
      contentSha256.toLowerCase()
    )
  };
}
function canonicalCapturePolicy(value) {
  if (value === void 0) {
    return {
      responseContent: "include",
      responseFormat: "markdown",
      artifacts: "receipt_only"
    };
  }
  const values = safeRecordValues(value, ["responseContent", "responseFormat", "artifacts", "outputDirectory"]);
  return {
    responseContent: values.get("responseContent") ?? "include",
    responseFormat: values.get("responseFormat") ?? "markdown",
    artifacts: values.get("artifacts") ?? "receipt_only"
  };
}
function canonicalValue(value, ancestors, budget, depth) {
  consumeNode(budget, depth);
  if (value === void 0) return { $undefined: true };
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    consumeBytes(budget, value);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`Canonical JSON does not support ${typeof value} values.`);
  }
  if (typeof value !== "object") throw new TypeError(SAFE_CANONICAL_ERROR);
  const object = value;
  if (ancestors.has(object)) {
    throw new TypeError("Canonical JSON does not support cyclic values.");
  }
  ancestors.add(object);
  try {
    const prototype = safeGetPrototype(object);
    let isArray = false;
    try {
      isArray = Array.isArray(object);
    } catch {
      throw new TypeError(SAFE_CANONICAL_ERROR);
    }
    if (isArray) {
      if (prototype !== Array.prototype) throw new TypeError("Canonical JSON supports only standard arrays.");
      return canonicalArray(object, ancestors, budget, depth);
    }
    if (prototype === Date.prototype) return canonicalDate(object, budget);
    if (prototype === Uint8Array.prototype) return canonicalBytes(object, budget);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON supports only plain objects, arrays, dates, and byte arrays.");
    }
    return canonicalObject(object, ancestors, budget, depth);
  } finally {
    ancestors.delete(object);
  }
}
function canonicalObject(value, ancestors, budget, depth) {
  const descriptors = safeDescriptors(value);
  const keys = descriptorKeys(descriptors);
  if (keys.length > MAX_CANONICAL_PROPERTIES) throw new TypeError("Canonical JSON exceeds the bounded property limit.");
  const result = /* @__PURE__ */ Object.create(null);
  const stringKeys = [];
  for (const key of keys) {
    if (typeof key !== "string") throw new TypeError("Canonical JSON does not support symbol properties.");
    stringKeys.push(key);
  }
  stringKeys.sort();
  for (const key of stringKeys) {
    if (RESERVED_CANONICAL_KEYS.has(key)) {
      throw new TypeError("Canonical JSON contains a reserved marker key.");
    }
    const descriptor = descriptorValue(descriptors, key);
    assertDataDescriptor(descriptor);
    if (descriptor.enumerable !== true) throw new TypeError("Canonical JSON supports only enumerable own data properties.");
    consumeProperty(budget, key);
    Object.defineProperty(result, key, {
      value: canonicalValue(descriptor.value, ancestors, budget, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return result;
}
function canonicalArray(value, ancestors, budget, depth) {
  const descriptors = safeDescriptors(value);
  const keys = descriptorKeys(descriptors);
  const lengthDescriptor = descriptorValue(descriptors, "length");
  assertDataDescriptor(lengthDescriptor);
  if (lengthDescriptor.enumerable !== false || lengthDescriptor.configurable !== false || typeof lengthDescriptor.value !== "number") {
    throw new TypeError("Canonical JSON contains an invalid array length.");
  }
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_CANONICAL_ARRAY_LENGTH) {
    throw new TypeError("Canonical JSON contains an oversized array.");
  }
  for (const key of keys) {
    if (typeof key !== "string") throw new TypeError("Canonical JSON does not support symbol properties.");
  }
  if (keys.length !== length + 1) throw new TypeError("Canonical JSON does not support sparse or custom arrays.");
  for (const key of keys) {
    if (typeof key !== "string" || key !== "length" && parseArrayIndex(key) === void 0) {
      throw new TypeError("Canonical JSON does not support sparse or custom arrays.");
    }
  }
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptorValue(descriptors, String(index));
    assertDataDescriptor(descriptor);
    if (descriptor.enumerable !== true) throw new TypeError("Canonical JSON supports only enumerable array entries.");
    consumeProperty(budget, String(index));
    result.push(canonicalValue(descriptor.value, ancestors, budget, depth + 1));
  }
  return result;
}
function canonicalDate(value, budget) {
  const descriptors = safeDescriptors(value);
  if (descriptorKeys(descriptors).length !== 0) throw new TypeError("Canonical JSON does not support custom date properties.");
  let iso;
  try {
    iso = Date.prototype.toISOString.call(value);
  } catch {
    throw new TypeError("Canonical JSON contains an invalid date.");
  }
  consumeBytes(budget, iso);
  return { $date: iso };
}
function canonicalBytes(value, budget) {
  if (TYPED_ARRAY_BYTE_LENGTH_GETTER === void 0) throw new TypeError(SAFE_CANONICAL_ERROR);
  let byteLength;
  try {
    byteLength = TYPED_ARRAY_BYTE_LENGTH_GETTER.call(value);
  } catch {
    throw new TypeError(SAFE_CANONICAL_ERROR);
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > MAX_CANONICAL_BYTES) {
    throw new TypeError("Canonical JSON contains an oversized byte array.");
  }
  const descriptors = safeDescriptors(value);
  const keys = descriptorKeys(descriptors);
  if (keys.length !== byteLength) throw new TypeError("Canonical JSON does not support custom byte-array properties.");
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    const key = String(index);
    const descriptor = descriptorValue(descriptors, key);
    assertDataDescriptor(descriptor);
    if (descriptor.enumerable !== true || typeof descriptor.value !== "number" || !Number.isInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > 255) {
      throw new TypeError("Canonical JSON contains an invalid byte-array entry.");
    }
    bytes[index] = descriptor.value;
    consumeProperty(budget, key);
  }
  const encoded = Buffer.from(bytes).toString("base64");
  consumeBytes(budget, encoded);
  return { $bytes: encoded };
}
function safeRecordValues(value, allowed) {
  if (value === null || typeof value !== "object") throw new TypeError(SAFE_CANONICAL_ERROR);
  const prototype = safeGetPrototype(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(SAFE_CANONICAL_ERROR);
  const descriptors = safeDescriptors(value);
  const allowedSet = new Set(allowed);
  const values = /* @__PURE__ */ new Map();
  for (const key of descriptorKeys(descriptors)) {
    if (typeof key !== "string") throw new TypeError("Canonical JSON does not support symbol properties.");
    if (!allowedSet.has(key)) throw new TypeError("Canonical JSON contains an unsupported field.");
    const descriptor = descriptorValue(descriptors, key);
    assertDataDescriptor(descriptor);
    if (descriptor.enumerable !== true) throw new TypeError(SAFE_CANONICAL_ERROR);
    values.set(key, descriptor.value);
  }
  return values;
}
function safeArrayElements(value) {
  if (value === null || typeof value !== "object") throw new TypeError(SAFE_CANONICAL_ERROR);
  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    throw new TypeError(SAFE_CANONICAL_ERROR);
  }
  if (!isArray || safeGetPrototype(value) !== Array.prototype) throw new TypeError(SAFE_CANONICAL_ERROR);
  const descriptors = safeDescriptors(value);
  const lengthDescriptor = descriptorValue(descriptors, "length");
  assertDataDescriptor(lengthDescriptor);
  if (typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > MAX_CANONICAL_ARRAY_LENGTH) {
    throw new TypeError(SAFE_CANONICAL_ERROR);
  }
  const length = lengthDescriptor.value;
  const keys = descriptorKeys(descriptors);
  if (keys.length !== length + 1) throw new TypeError(SAFE_CANONICAL_ERROR);
  for (const key of keys) {
    if (typeof key !== "string" || key !== "length" && parseArrayIndex(key) === void 0) {
      throw new TypeError(SAFE_CANONICAL_ERROR);
    }
  }
  const values = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptorValue(descriptors, String(index));
    assertDataDescriptor(descriptor);
    if (descriptor.enumerable !== true) throw new TypeError(SAFE_CANONICAL_ERROR);
    values.push(descriptor.value);
  }
  return values;
}
function safeGetPrototype(value) {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    throw new TypeError(SAFE_CANONICAL_ERROR);
  }
}
function safeDescriptors(value) {
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError(SAFE_CANONICAL_ERROR);
  }
  return descriptors;
}
function descriptorKeys(descriptors) {
  try {
    return Reflect.ownKeys(descriptors);
  } catch {
    throw new TypeError(SAFE_CANONICAL_ERROR);
  }
}
function descriptorValue(descriptors, key) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(descriptors, key);
  } catch {
    throw new TypeError(SAFE_CANONICAL_ERROR);
  }
  if (descriptor === void 0 || !("value" in descriptor)) throw new TypeError(SAFE_CANONICAL_ERROR);
  return descriptor.value;
}
function assertDataDescriptor(descriptor) {
  if (!("value" in descriptor) || descriptor.get !== void 0 || descriptor.set !== void 0) {
    throw new TypeError("Canonical JSON supports only own data properties.");
  }
}
function parseArrayIndex(key) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) return void 0;
  const index = Number(key);
  if (!Number.isSafeInteger(index) || index < 0 || index > 4294967294 || String(index) !== key) return void 0;
  return index;
}
function consumeNode(budget, depth) {
  if (depth > MAX_CANONICAL_DEPTH || ++budget.nodes > MAX_CANONICAL_NODES) {
    throw new TypeError("Canonical JSON exceeds the bounded graph limit.");
  }
}
function consumeProperty(budget, key) {
  if (++budget.properties > MAX_CANONICAL_PROPERTIES) throw new TypeError("Canonical JSON exceeds the bounded property limit.");
  const bytes = Buffer.byteLength(key, "utf8");
  if (bytes > MAX_CANONICAL_KEY_BYTES) throw new TypeError("Canonical JSON contains an oversized property name.");
  consumeBytes(budget, key);
}
function consumeBytes(budget, value) {
  budget.bytes += Buffer.byteLength(value, "utf8");
  if (budget.bytes > MAX_CANONICAL_BYTES) throw new TypeError("Canonical JSON exceeds the bounded byte limit.");
}

// src/operations/types.ts
var OPERATION_SCHEMA_VERSION = "chatgpt.browser_control.operation.v1";
var OPERATION_EVENT_SCHEMA_VERSION = "chatgpt.browser_control.operation_event.v1";
var OPERATION_RECEIPT_SCHEMA_VERSION = "chatgpt.browser_control.operation_receipt.v1";
var OPERATION_REQUEST_SCHEMA_VERSION = "chatgpt.browser_control.operation_request.v1";
var OPERATION_HANDLE_SCHEMA_VERSION = "chatgpt.browser_control.operation_handle.v1";
var OPERATION_CONTROL_REQUEST_SCHEMA_VERSION = "chatgpt.browser_control.operation_control_request.v1";
var OPERATION_ARTIFACT_RECEIPT_SCHEMA_VERSION = "chatgpt.browser_control.operation_artifact_receipt.v1";
var OPERATION_SUBMISSION_WITNESS_SCHEMA_VERSION = "chatgpt.browser_control.operation_submission_witness.v1";
var OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION = "chatgpt.browser_control.operation_ownership_baseline.v1";
var OPERATION_ARTIFACT_TRANSFER_INTENT_SCHEMA_VERSION = "chatgpt.browser_control.artifact_transfer_intent.v1";
var OPERATION_ARTIFACT_TRANSFER_RECEIPT_SCHEMA_VERSION = "chatgpt.browser_control.artifact_transfer_receipt.v1";

// src/operations/state-machine.ts
var BOUNDARY_RANK = {
  none: 0,
  handoff_may_have_occurred: 1,
  send_may_have_occurred: 2,
  control_may_have_occurred: 3
};
var LEGAL_EDGES = {
  prepared: /* @__PURE__ */ new Set(["handoff_pending", "ready", "uncertain"]),
  handoff_pending: /* @__PURE__ */ new Set(["ready", "uncertain"]),
  ready: /* @__PURE__ */ new Set(["send_pending", "uncertain"]),
  send_pending: /* @__PURE__ */ new Set(["submitted", "uncertain"]),
  submitted: /* @__PURE__ */ new Set(["generating", "capturing", "uncertain"]),
  generating: /* @__PURE__ */ new Set(["capturing", "uncertain"]),
  capturing: /* @__PURE__ */ new Set(["uncertain"]),
  completed: /* @__PURE__ */ new Set(),
  uncertain: /* @__PURE__ */ new Set(["ready", "submitted", "generating", "capturing"])
};
var ACTION_POLICY = {
  status_read: "read_only",
  configuration_set: "reconcile_set_to_value",
  tool_set: "reconcile_set_to_value",
  composer_set: "reconcile_set_to_value",
  power_discovery: "read_only",
  power_select: "reconcile_set_to_value",
  file_handoff: "observe_only_after_intent",
  send: "observe_only_after_intent",
  work_steer: "observe_only_after_intent",
  stop: "observe_only_after_intent",
  download: "reconcile_local_effect",
  local_output_commit: "reconcile_local_effect",
  clipboard_capture_restore: "reconcile_local_effect"
};
var ACTION_PHASES = {
  status_read: /* @__PURE__ */ new Set(["prepared", "handoff_pending", "ready", "send_pending", "submitted", "generating", "capturing", "completed", "uncertain"]),
  configuration_set: /* @__PURE__ */ new Set(["prepared"]),
  tool_set: /* @__PURE__ */ new Set(["prepared"]),
  composer_set: /* @__PURE__ */ new Set(["prepared"]),
  power_discovery: /* @__PURE__ */ new Set(["prepared"]),
  power_select: /* @__PURE__ */ new Set(["prepared"]),
  file_handoff: /* @__PURE__ */ new Set(["prepared"]),
  send: /* @__PURE__ */ new Set(["ready"]),
  work_steer: /* @__PURE__ */ new Set(["generating"]),
  stop: /* @__PURE__ */ new Set(["generating"]),
  download: /* @__PURE__ */ new Set(["capturing"]),
  local_output_commit: /* @__PURE__ */ new Set(["capturing"]),
  clipboard_capture_restore: /* @__PURE__ */ new Set(["capturing"])
};
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
var DIGEST_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/;
var SHA256_PATTERN = /^[0-9a-f]{64}$/;
var CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
var TRANSFER_OUTPUT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var FINISH_REASON_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
var ARTIFACT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
var MIME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+/-]{0,126}$/;
var MAX_ARTIFACTS = 32;
var MAX_BASELINE_TURNS = 256;
var MAX_BASELINE_ARTIFACTS_PER_TURN = 32;
var MAX_SUBMISSION_WITNESSES = 64;
function isSingleIntentKind(kind) {
  return kind === "file_handoff" || kind === "send";
}
var OperationStateError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "OperationStateError";
  }
  code;
};
function assertOperationId(value, label = "operationId") {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new OperationStateError("invalid_operation_id", `${label} must be a canonical UUID.`);
  }
}
function reduceOperationEvents(events) {
  let state;
  for (let index = 0; index < events.length; index += 1) {
    state = applyOperationEvent(state, events[index], index + 1);
  }
  if (state === void 0) {
    throw new OperationStateError("empty_operation_log", "Operation log does not contain an operation_created event.");
  }
  return state;
}
function applyOperationEvent(state, event, revision) {
  assertOperationEventShape(event);
  if (event.type === "operation_created") {
    if (state !== void 0 || revision !== 1) {
      throw new OperationStateError("duplicate_operation_created", "operation_created must be the first and only creation event.");
    }
    assertOperationId(event.operationId);
    assertDigest(event.requestDigest, "requestDigest");
    assertTimestamp(event.createdAt, "createdAt");
    if (event.surface !== "chat" && event.surface !== "work") {
      throw new OperationStateError("invalid_operation_surface", "Operation surface must be chat or work.");
    }
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operationId: event.operationId,
      requestDigest: event.requestDigest,
      surface: event.surface,
      phase: "prepared",
      mutationBoundary: "none",
      revision,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      actions: {},
      ownershipBaselines: {},
      artifactTransfers: {},
      ...event.capturePolicy === void 0 ? {} : {
        capturePolicy: event.capturePolicy,
        // Keep the existing responseFormat projection for old collector and
        // inspect consumers while the path-free policy becomes authoritative.
        responseFormat: event.capturePolicy.responseFormat
      }
    };
  }
  if (state === void 0) {
    throw new OperationStateError("missing_operation_created", "Operation event occurred before operation_created.");
  }
  if (revision !== state.revision + 1) {
    throw new OperationStateError("revision_gap", `Expected revision ${state.revision + 1}, received ${revision}.`);
  }
  switch (event.type) {
    case "target_bound":
      assertTimestamp(event.observedAt, "observedAt");
      assertTimestampNotBefore(state.updatedAt, event.observedAt, "observedAt");
      return withRevision({ ...state, target: validatedTarget(state, event.target) }, revision, event.observedAt);
    case "target_established":
      assertTimestamp(event.establishment.observedAt, "target_established.observedAt");
      assertTimestampNotBefore(state.updatedAt, event.establishment.observedAt, "target_established.observedAt");
      return withRevision({ ...state, target: establishTarget(state, event.establishment) }, revision, event.establishment.observedAt);
    case "ownership_baseline":
      assertTimestamp(event.baseline.observedAt, "ownership_baseline.observedAt");
      assertTimestampNotBefore(state.updatedAt, event.baseline.observedAt, "ownership_baseline.observedAt");
      return withRevision(applyOwnershipBaseline(state, event.baseline), revision, event.baseline.observedAt);
    case "submission_witness":
      assertTimestamp(event.witness.observedAt, "submission_witness.observedAt");
      assertTimestampNotBefore(state.updatedAt, event.witness.observedAt, "submission_witness.observedAt");
      return withRevision(applySubmissionWitness(state, event.witness), revision, event.witness.observedAt);
    case "action_intent":
      assertTimestamp(event.intentAt, "intentAt");
      assertTimestampNotBefore(state.updatedAt, event.intentAt, "intentAt");
      return withRevision(applyActionIntent(state, event.action, revision, event.intentAt), revision, event.intentAt);
    case "action_prepared": {
      assertTimestamp(event.intentAt, "intentAt");
      assertTimestamp(event.baseline.observedAt, "action_prepared.baseline.observedAt");
      assertTimestampNotBefore(state.updatedAt, event.intentAt, "intentAt");
      if (event.baseline.observedAt !== event.intentAt) {
        throw new OperationStateError(
          "action_prepared_timestamp_mismatch",
          "Atomic action preparation requires baseline.observedAt to equal intentAt."
        );
      }
      assertPreparedActionBaselineIdentity(event.action, event.baseline, state);
      const withAction = applyActionIntent(state, event.action, revision, event.intentAt);
      const withBaseline = applyOwnershipBaseline(withAction, event.baseline);
      return withRevision(withBaseline, revision, event.intentAt);
    }
    case "artifact_transfer_intent":
      assertTimestamp(event.intent.intentAt, "artifact_transfer_intent.intentAt");
      assertTimestampNotBefore(state.updatedAt, event.intent.intentAt, "artifact_transfer_intent.intentAt");
      return withRevision(applyArtifactTransferIntent(state, event.intent, revision), revision, event.intent.intentAt);
    case "artifact_transfer_receipt":
      assertTimestamp(event.receipt.observedAt, "artifact_transfer_receipt.observedAt");
      assertTimestampNotBefore(state.updatedAt, event.receipt.observedAt, "artifact_transfer_receipt.observedAt");
      return withRevision(applyArtifactTransferReceipt(state, event.receipt, revision), revision, event.receipt.observedAt);
    case "action_receipt":
      assertTimestamp(event.observedAt, "observedAt");
      assertTimestampNotBefore(state.updatedAt, event.observedAt, "observedAt");
      return withRevision(applyActionReceipt(state, event, revision), revision, event.observedAt);
    case "phase_changed":
      assertTimestamp(event.observedAt, "observedAt");
      assertTimestampNotBefore(state.updatedAt, event.observedAt, "observedAt");
      return withRevision(applyPhaseChange(state, event), revision, event.observedAt);
    case "blocker_observed":
      assertTimestamp(event.blocker.observedAt, "blocker.observedAt");
      assertTimestampNotBefore(state.updatedAt, event.blocker.observedAt, "blocker.observedAt");
      assertDigest(event.blocker.messageDigest, "blocker.messageDigest");
      validateBlockerObservation(event.blocker);
      return withRevision({ ...state, lastBlocker: event.blocker }, revision, event.blocker.observedAt);
    case "receipt_completed":
      assertTimestamp(event.observedAt, "observedAt");
      assertTimestampNotBefore(state.updatedAt, event.observedAt, "observedAt");
      return withRevision(applyCompletedReceipt(state, event.receipt, event.observedAt), revision, event.observedAt);
    case "content_availability_changed":
      assertTimestamp(event.observedAt, "observedAt");
      assertTimestampNotBefore(state.updatedAt, event.observedAt, "observedAt");
      if (typeof event.available !== "boolean") {
        throw new OperationStateError("invalid_content_availability", "Content availability must be boolean.");
      }
      if (state.receipt === void 0) {
        throw new OperationStateError("receipt_missing", "Content availability cannot change before a terminal receipt exists.");
      }
      if (state.phase !== "completed") {
        throw new OperationStateError("receipt_phase_invalid", "Content availability can change only on a completed operation.");
      }
      if (event.available || !state.receipt.contentAvailable) {
        throw new OperationStateError(
          "content_availability_not_monotonic",
          "Content availability may only transition once from available to unavailable."
        );
      }
      return withRevision({
        ...state,
        receipt: { ...state.receipt, contentAvailable: event.available }
      }, revision, event.observedAt);
    default: {
      const unknownEvent = event;
      throw new OperationStateError("unknown_operation_event", `Unknown operation event type: ${String(unknownEvent.type)}.`);
    }
  }
}
function assertOperationEventShape(value) {
  assertExactRecord(value, "operation event", ["type"], ["type"], true);
  const event = value;
  switch (event.type) {
    case "operation_created":
      assertExactRecord(event, "operation_created", ["type", "operationId", "requestDigest", "surface", "createdAt", "capturePolicy"], ["type", "operationId", "requestDigest", "surface", "createdAt"]);
      if (event.capturePolicy !== void 0) assertDurableCapturePolicyShape(event.capturePolicy);
      return;
    case "target_bound":
      assertExactRecord(event, "target_bound", ["type", "target", "observedAt"], ["type", "target", "observedAt"]);
      assertTargetShape(event.target);
      return;
    case "target_established":
      assertExactRecord(event, "target_established", ["type", "establishment"], ["type", "establishment"]);
      assertTargetEstablishmentShape(event.establishment);
      return;
    case "ownership_baseline":
      assertExactRecord(event, "ownership_baseline", ["type", "baseline"], ["type", "baseline"]);
      assertOwnershipBaselineShape(event.baseline);
      return;
    case "submission_witness":
      assertExactRecord(event, "submission_witness", ["type", "witness"], ["type", "witness"]);
      assertSubmissionWitnessShape(event.witness);
      return;
    case "action_intent":
      assertExactRecord(event, "action_intent", ["type", "action", "intentAt"], ["type", "action", "intentAt"]);
      assertActionIntentShape(event.action);
      return;
    case "action_prepared":
      assertExactRecord(event, "action_prepared", ["type", "action", "intentAt", "baseline"], ["type", "action", "intentAt", "baseline"]);
      assertActionIntentShape(event.action);
      assertOwnershipBaselineShape(event.baseline);
      return;
    case "artifact_transfer_intent":
      assertExactRecord(event, "artifact_transfer_intent", ["type", "intent"], ["type", "intent"]);
      assertArtifactTransferIntentShape(event.intent);
      return;
    case "artifact_transfer_receipt":
      assertExactRecord(event, "artifact_transfer_receipt", ["type", "receipt"], ["type", "receipt"]);
      assertArtifactTransferReceiptShape(event.receipt);
      return;
    case "action_receipt":
      assertExactRecord(event, "action_receipt", ["type", "actionId", "outcome", "evidenceDigest", "blockerCode", "observedAt"], ["type", "actionId", "outcome", "observedAt"]);
      return;
    case "phase_changed":
      assertExactRecord(event, "phase_changed", ["type", "from", "to", "mutationBoundary", "causeActionId", "evidenceDigest", "observedAt"], ["type", "from", "to", "mutationBoundary", "observedAt"]);
      return;
    case "blocker_observed":
      assertExactRecord(event, "blocker_observed", ["type", "blocker"], ["type", "blocker"]);
      assertBlockerObservationShape(event.blocker);
      return;
    case "receipt_completed":
      assertExactRecord(event, "receipt_completed", ["type", "receipt", "observedAt"], ["type", "receipt", "observedAt"]);
      assertReceiptShape(event.receipt);
      return;
    case "content_availability_changed":
      assertExactRecord(event, "content_availability_changed", ["type", "available", "observedAt"], ["type", "available", "observedAt"]);
      return;
    default:
      throw new OperationStateError("unknown_operation_event", `Unknown operation event type: ${String(event.type)}.`);
  }
}
function assertOperationStateShape(value) {
  assertExactRecord(
    value,
    "operation state",
    ["schemaVersion", "operationId", "requestDigest", "surface", "phase", "mutationBoundary", "revision", "createdAt", "updatedAt", "capturePolicy", "responseFormat", "target", "actions", "ownershipBaseline", "ownershipBaselines", "artifactTransfers", "submissionWitnesses", "submissionWitness", "lastBlocker", "receipt"],
    ["schemaVersion", "operationId", "requestDigest", "surface", "phase", "mutationBoundary", "revision", "createdAt", "updatedAt", "actions"]
  );
  const state = value;
  if (state.schemaVersion !== OPERATION_SCHEMA_VERSION) {
    throw new OperationStateError("unsupported_operation_state", "Operation state schemaVersion is unsupported.");
  }
  assertOperationId(state.operationId);
  assertDigest(state.requestDigest, "state.requestDigest");
  if (state.surface !== "chat" && state.surface !== "work") {
    throw new OperationStateError("invalid_operation_surface", "Operation state surface must be chat or work.");
  }
  if (!(typeof state.phase === "string" && state.phase in LEGAL_EDGES)) {
    throw new OperationStateError("invalid_operation_phase", "Operation state phase is unsupported.");
  }
  if (!(typeof state.mutationBoundary === "string" && state.mutationBoundary in BOUNDARY_RANK)) {
    throw new OperationStateError("invalid_mutation_boundary", "Operation state mutationBoundary is unsupported.");
  }
  if (!Number.isSafeInteger(state.revision) || state.revision < 1) {
    throw new OperationStateError("invalid_operation_revision", "Operation state revision must be a positive safe integer.");
  }
  assertTimestamp(state.createdAt, "state.createdAt");
  assertTimestamp(state.updatedAt, "state.updatedAt");
  assertTimestampNotBefore(state.createdAt, state.updatedAt, "state.updatedAt");
  if (state.responseFormat !== void 0 && state.responseFormat !== "markdown" && state.responseFormat !== "text") {
    throw new OperationStateError("invalid_response_format", "Operation responseFormat must be markdown or text.");
  }
  if (state.capturePolicy !== void 0) {
    assertDurableCapturePolicyShape(state.capturePolicy);
    if (state.responseFormat !== void 0 && state.responseFormat !== state.capturePolicy.responseFormat) {
      throw new OperationStateError("capture_policy_format_mismatch", "Operation responseFormat conflicts with its durable capture policy.");
    }
  }
  if (state.target !== void 0) assertTargetShape(state.target);
  if (!isPlainRecord(state.actions)) {
    throw new OperationStateError("invalid_operation_state", "Operation state actions must be an object.");
  }
  for (const [actionId, action] of Object.entries(state.actions)) {
    assertOperationId(actionId, "action map key");
    assertActionRecordShape(action);
    if (action.actionId !== actionId) {
      throw new OperationStateError("invalid_operation_state", "Operation action map key must match actionId.");
    }
    assertPersistedActionRecord(action, state);
  }
  if (state.target !== void 0) validateTargetValues(state.target);
  if (state.ownershipBaseline !== void 0) {
    assertOwnershipBaselineShape(state.ownershipBaseline);
    validateOwnershipBaselineValues(state.ownershipBaseline, state);
  }
  if (state.ownershipBaselines !== void 0) {
    if (!isPlainRecord(state.ownershipBaselines)) {
      throw new OperationStateError("invalid_operation_state", "Operation ownershipBaselines must be an object.");
    }
    for (const actionId of Object.keys(state.ownershipBaselines)) {
      const descriptor = Object.getOwnPropertyDescriptor(state.ownershipBaselines, actionId);
      if (descriptor === void 0 || !Object.hasOwn(descriptor, "value") || descriptor.get !== void 0 || descriptor.set !== void 0) {
        throw new OperationStateError("invalid_operation_shape", "Operation ownershipBaselines contains an unsafe property (accessor).");
      }
      const baseline = descriptor.value;
      assertOperationId(actionId, "ownershipBaselines map key");
      assertOwnershipBaselineShape(baseline);
      if (baseline.actionId !== actionId) {
        throw new OperationStateError("invalid_operation_state", "Ownership baseline map key must match actionId.");
      }
      validateOwnershipBaselineValues(baseline, state);
    }
  }
  if (state.artifactTransfers !== void 0) {
    assertArtifactTransfersStateShape(state.artifactTransfers);
    for (const [transferActionId, transfer] of Object.entries(state.artifactTransfers)) {
      validateArtifactTransferStateValues(transferActionId, transfer, state);
    }
  }
  validateSubmissionWitnessCollection(state);
  if (state.lastBlocker !== void 0) {
    assertBlockerObservationShape(state.lastBlocker);
    validateBlockerObservation(state.lastBlocker);
  }
  if (state.receipt !== void 0) {
    assertReceiptShape(state.receipt);
    validateReceiptValues(state.receipt, state);
  }
  if (state.phase === "completed" && state.receipt === void 0) {
    throw new OperationStateError("receipt_missing", "Completed operation state requires a terminal receipt.");
  }
  if (state.phase !== "completed" && state.receipt !== void 0) {
    throw new OperationStateError("receipt_phase_invalid", "Only completed operation state may contain a terminal receipt.");
  }
  validateStateCoherence(state);
}
function requiredRepeatPolicy(kind) {
  return ACTION_POLICY[kind];
}
function boundaryForAction(kind) {
  if (kind === "file_handoff") return "handoff_may_have_occurred";
  if (kind === "send") return "send_may_have_occurred";
  if (kind === "work_steer" || kind === "stop") return "control_may_have_occurred";
  return void 0;
}
function assertPreparedActionBaselineIdentity(action, baseline, state) {
  if (action.kind !== "send" && action.kind !== "work_steer") {
    throw new OperationStateError(
      "action_prepared_kind_invalid",
      "Atomic action preparation is supported only for send or work_steer."
    );
  }
  if (baseline.actionId !== action.actionId) {
    throw new OperationStateError(
      "action_prepared_action_mismatch",
      "Atomic action preparation baseline must name the prepared action."
    );
  }
  if (baseline.operationId !== state.operationId || baseline.requestDigest !== state.requestDigest) {
    throw new OperationStateError(
      "ownership_baseline_identity_mismatch",
      "Atomic action preparation baseline must use the parent operation identity."
    );
  }
  if (action.targetDigest === void 0 || action.targetDigest !== baseline.targetBindingDigest) {
    throw new OperationStateError(
      "ownership_baseline_target_mismatch",
      "Atomic action preparation baseline must match the exact action target digest."
    );
  }
}
function applyActionIntent(state, action, revision, intentAt) {
  assertOperationId(action.actionId, "actionId");
  assertDigest(action.requestDigest, "action.requestDigest");
  if (action.kind !== "stop" && action.kind !== "work_steer" && action.requestDigest !== state.requestDigest) {
    throw new OperationStateError(
      "action_request_mismatch",
      "Only caller-owned control actions may carry a request digest distinct from the parent operation."
    );
  }
  if (!(action.kind in ACTION_POLICY)) {
    throw new OperationStateError("invalid_action_kind", `Unknown operation action kind: ${String(action.kind)}.`);
  }
  if (state.actions[action.actionId] !== void 0) {
    throw new OperationStateError("duplicate_action_intent", `Action ${action.actionId} already has an intent.`);
  }
  if (action.repeatPolicy !== requiredRepeatPolicy(action.kind)) {
    throw new OperationStateError(
      "invalid_repeat_policy",
      `Action ${action.kind} requires ${requiredRepeatPolicy(action.kind)}, received ${action.repeatPolicy}.`
    );
  }
  if (!ACTION_PHASES[action.kind].has(state.phase)) {
    throw new OperationStateError(
      "action_phase_invalid",
      `Action ${action.kind} cannot begin while the operation is ${state.phase}.`
    );
  }
  if (action.kind !== "status_read" && state.target === void 0) {
    throw new OperationStateError("target_not_bound", `Action ${action.kind} requires a durable target binding.`);
  }
  if (action.parentActionId !== void 0 && state.actions[action.parentActionId] === void 0) {
    throw new OperationStateError("unknown_parent_action", `Parent action ${action.parentActionId} is not recorded.`);
  }
  if (action.parentActionId !== void 0) assertOperationId(action.parentActionId, "parentActionId");
  if (action.kind !== "status_read" && action.targetDigest === void 0) {
    throw new OperationStateError("action_target_missing", `Action ${action.kind} requires the exact target binding digest.`);
  }
  if (action.targetDigest !== void 0) assertDigest(action.targetDigest, "action.targetDigest");
  if (isSingleIntentKind(action.kind) && Object.values(state.actions).some((existing) => existing.kind === action.kind)) {
    throw new OperationStateError(
      "nonrepeatable_action_already_intended",
      `Operation already contains a non-repeatable ${action.kind} intent.`
    );
  }
  const record = {
    ...action,
    intentRevision: revision,
    intentAt
  };
  const actionBoundary = boundaryForAction(action.kind);
  const mutationBoundary = actionBoundary !== void 0 && BOUNDARY_RANK[actionBoundary] > BOUNDARY_RANK[state.mutationBoundary] ? actionBoundary : state.mutationBoundary;
  return { ...state, mutationBoundary, actions: { ...state.actions, [action.actionId]: record } };
}
function applyActionReceipt(state, event, revision) {
  const action = state.actions[event.actionId];
  if (action === void 0) {
    throw new OperationStateError("action_intent_missing", `Action ${event.actionId} has no durable intent.`);
  }
  if (action.outcome !== void 0) {
    throw new OperationStateError("duplicate_action_receipt", `Action ${event.actionId} already has a receipt.`);
  }
  if (event.outcome !== "satisfied" && event.outcome !== "not_satisfied" && event.outcome !== "uncertain") {
    throw new OperationStateError("invalid_action_outcome", `Unknown action outcome: ${String(event.outcome)}.`);
  }
  assertTimestampNotBefore(action.intentAt, event.observedAt, "action receipt observedAt");
  if (event.outcome === "satisfied" && event.evidenceDigest === void 0) {
    throw new OperationStateError("action_evidence_missing", `Satisfied action ${event.actionId} requires evidenceDigest.`);
  }
  if (event.evidenceDigest !== void 0) assertDigest(event.evidenceDigest, "action.evidenceDigest");
  if (event.blockerCode !== void 0 && !CODE_PATTERN.test(event.blockerCode)) {
    throw new OperationStateError("invalid_blocker_code", "Action blockerCode must be a bounded canonical code.");
  }
  const updated = {
    ...action,
    outcome: event.outcome,
    receiptRevision: revision,
    receiptAt: event.observedAt
  };
  if (event.evidenceDigest !== void 0) updated.evidenceDigest = event.evidenceDigest;
  if (event.blockerCode !== void 0) updated.blockerCode = event.blockerCode;
  return { ...state, actions: { ...state.actions, [event.actionId]: updated } };
}
function applySubmissionWitness(state, witness) {
  const existingWitnesses = state.submissionWitnesses === void 0 ? state.submissionWitness === void 0 ? {} : { [state.submissionWitness.actionId]: state.submissionWitness } : state.submissionWitnesses;
  assertSubmissionWitnessesMapShape(existingWitnesses);
  validateSubmissionWitnessCollection({ ...state, submissionWitnesses: existingWitnesses });
  const existing = existingWitnesses[witness.actionId];
  if (existing !== void 0) {
    if (canonicalJson(existing) !== canonicalJson(witness)) {
      throw new OperationStateError(
        "submission_witness_conflict",
        `Submission witness for action ${witness.actionId} conflicts with the durable record.`
      );
    }
    return state.submissionWitnesses === void 0 ? { ...state, submissionWitnesses: existingWitnesses } : state;
  }
  if (Object.keys(existingWitnesses).length >= MAX_SUBMISSION_WITNESSES) {
    throw new OperationStateError(
      "submission_witness_limit",
      `An operation may record at most ${MAX_SUBMISSION_WITNESSES} submission witnesses.`
    );
  }
  const candidateState = {
    ...state,
    submissionWitnesses: { ...existingWitnesses, [witness.actionId]: witness }
  };
  validateSubmissionWitnessValues(witness, candidateState);
  if (witness.actionKind === "send") {
    if (state.submissionWitness !== void 0 && canonicalJson(state.submissionWitness) !== canonicalJson(witness)) {
      throw new OperationStateError(
        "submission_witness_projection_mismatch",
        "The original Send submission witness must match its legacy projection exactly."
      );
    }
    return { ...candidateState, submissionWitness: witness };
  }
  return candidateState;
}
function applyOwnershipBaseline(state, baseline) {
  validateOwnershipBaselineValues(baseline, state);
  const existing = state.ownershipBaselines?.[baseline.actionId];
  if (existing !== void 0) {
    throw new OperationStateError(
      "ownership_baseline_duplicate",
      `An operation may record only one immutable ownership baseline for action ${baseline.actionId}.`
    );
  }
  const action = state.actions[baseline.actionId];
  if (action?.kind === "send" && state.ownershipBaseline !== void 0) {
    throw new OperationStateError(
      "ownership_baseline_duplicate",
      "An operation may record only one immutable pre-Send ownership baseline."
    );
  }
  const ownershipBaselines = {
    ...state.ownershipBaselines ?? {},
    [baseline.actionId]: baseline
  };
  return {
    ...state,
    ownershipBaselines,
    ...action?.kind === "send" && state.ownershipBaseline === void 0 ? { ownershipBaseline: baseline } : {}
  };
}
function applyArtifactTransferIntent(state, intent, revision) {
  if (state.capturePolicy?.artifacts !== "transfer") {
    throw new OperationStateError(
      "artifact_transfer_policy_mismatch",
      "Artifact transfer intent requires the immutable transfer capture policy."
    );
  }
  if (state.phase !== "capturing") {
    throw new OperationStateError("artifact_transfer_phase_invalid", "Artifact transfer intent requires a capturing operation.");
  }
  validateArtifactTransferIntentValues(intent, state);
  const transfers = state.artifactTransfers ?? {};
  assertArtifactTransfersStateShape(transfers);
  if (transfers[intent.transferActionId] !== void 0) {
    throw new OperationStateError("artifact_transfer_intent_duplicate", "Artifact transfer intent is already durable.");
  }
  const tuple = artifactTransferTuple(intent);
  for (const transfer of Object.values(transfers)) {
    if (transfer.intent !== void 0 && artifactTransferTuple(transfer.intent) === tuple) {
      throw new OperationStateError("artifact_transfer_duplicate_tuple", "An artifact transfer tuple may only be transferred once.");
    }
  }
  const action = {
    actionId: intent.transferActionId,
    kind: "local_output_commit",
    repeatPolicy: "reconcile_local_effect",
    requestDigest: intent.requestDigest,
    targetDigest: intent.targetBindingDigest,
    intentRevision: revision,
    intentAt: intent.intentAt
  };
  const withAction = applyActionIntent(state, action, revision, intent.intentAt);
  return {
    ...withAction,
    artifactTransfers: {
      ...transfers,
      [intent.transferActionId]: { intent }
    }
  };
}
function applyArtifactTransferReceipt(state, receipt, revision) {
  if (state.phase !== "capturing") {
    throw new OperationStateError("artifact_transfer_phase_invalid", "Artifact transfer receipt requires a capturing operation.");
  }
  const transfers = state.artifactTransfers ?? {};
  assertArtifactTransfersStateShape(transfers);
  const transfer = transfers[receipt.transferActionId];
  if (transfer?.intent === void 0) {
    throw new OperationStateError("artifact_transfer_intent_missing", "Artifact transfer receipt requires its durable intent.");
  }
  if (transfer.receipt !== void 0) {
    throw new OperationStateError("artifact_transfer_receipt_duplicate", "Artifact transfer receipt is already durable.");
  }
  validateArtifactTransferReceiptValues(receipt, transfer.intent, state);
  if (receipt.observedAt < transfer.intent.intentAt) {
    throw new OperationStateError("artifact_transfer_timestamp_regression", "Artifact transfer receipt cannot precede its intent.");
  }
  const outcome = receipt.status === "transferred" ? "satisfied" : receipt.status === "blocked" && receipt.blockerCode === "output_collision" ? "not_satisfied" : "uncertain";
  const actionEvent = {
    type: "action_receipt",
    actionId: receipt.transferActionId,
    outcome,
    observedAt: receipt.observedAt,
    ...receipt.status === "transferred" ? { evidenceDigest: receipt.destinationIdentityDigest } : {},
    ...receipt.blockerCode === void 0 ? {} : { blockerCode: receipt.blockerCode }
  };
  const withAction = applyActionReceipt(state, actionEvent, revision);
  return {
    ...withAction,
    artifactTransfers: {
      ...transfers,
      [receipt.transferActionId]: { intent: transfer.intent, receipt }
    }
  };
}
function validateArtifactTransferIdentityValues(value, state) {
  if (value.operationId !== state.operationId || value.requestDigest !== state.requestDigest) {
    throw new OperationStateError("artifact_transfer_identity_mismatch", "Artifact transfer operation identity does not match state.");
  }
  if (state.target === void 0) {
    throw new OperationStateError("target_not_bound", "Artifact transfer requires a durable target binding.");
  }
  const originalSend = Object.values(state.actions).find((action) => action.kind === "send");
  if (originalSend?.targetDigest !== value.targetBindingDigest) {
    throw new OperationStateError(
      "artifact_transfer_target_mismatch",
      "Artifact transfer targetBindingDigest must match the durable original Send target."
    );
  }
  assertDigest(value.targetBindingDigest, "artifactTransfer.targetBindingDigest");
  assertStableIdentifier(value.assistantTurnId, "artifactTransfer.assistantTurnId");
  assertDigest(value.sourceIdentityDigest, "artifactTransfer.sourceIdentityDigest");
  if (value.kind !== "file" && value.kind !== "image" && value.kind !== "other") {
    throw new OperationStateError("artifact_transfer_kind_invalid", "Artifact transfer kind is unsupported.");
  }
  if (!Number.isSafeInteger(value.ordinal) || value.ordinal < 0) {
    throw new OperationStateError("artifact_transfer_ordinal_invalid", "Artifact transfer ordinal must be a non-negative safe integer.");
  }
  assertOperationId(value.transferActionId, "artifactTransfer.transferActionId");
  assertDigest(value.destinationIdentityDigest, "artifactTransfer.destinationIdentityDigest");
}
function validateArtifactTransferIntentValues(intent, state) {
  if (intent.schemaVersion !== OPERATION_ARTIFACT_TRANSFER_INTENT_SCHEMA_VERSION) {
    throw new OperationStateError("artifact_transfer_intent_schema_invalid", "Artifact transfer intent schemaVersion is unsupported.");
  }
  if (intent.actionKind !== "local_output_commit" || intent.repeatPolicy !== "reconcile_local_effect") {
    throw new OperationStateError("artifact_transfer_action_policy_invalid", "Artifact transfer intent action policy is unsupported.");
  }
  assertTimestamp(intent.intentAt, "artifactTransfer.intentAt");
  validateArtifactTransferIdentityValues(intent, state);
}
function validateArtifactTransferReceiptValues(receipt, intent, state) {
  if (receipt.schemaVersion !== OPERATION_ARTIFACT_TRANSFER_RECEIPT_SCHEMA_VERSION) {
    throw new OperationStateError("artifact_transfer_receipt_schema_invalid", "Artifact transfer receipt schemaVersion is unsupported.");
  }
  validateArtifactTransferIdentityValues(receipt, state);
  if (receipt.operationId !== intent.operationId || receipt.requestDigest !== intent.requestDigest || receipt.targetBindingDigest !== intent.targetBindingDigest || receipt.assistantTurnId !== intent.assistantTurnId || receipt.sourceIdentityDigest !== intent.sourceIdentityDigest || receipt.kind !== intent.kind || receipt.ordinal !== intent.ordinal || receipt.transferActionId !== intent.transferActionId || receipt.destinationIdentityDigest !== intent.destinationIdentityDigest) {
    throw new OperationStateError("artifact_transfer_identity_mismatch", "Artifact transfer receipt identity does not match its intent.");
  }
  if (receipt.outputKey !== void 0 && (typeof receipt.outputKey !== "string" || !TRANSFER_OUTPUT_KEY_PATTERN.test(receipt.outputKey))) {
    throw new OperationStateError("artifact_transfer_output_key_invalid", "Artifact transfer outputKey is unsupported.");
  }
  if (receipt.bytes !== void 0 && (!Number.isSafeInteger(receipt.bytes) || receipt.bytes < 0)) {
    throw new OperationStateError("artifact_transfer_bytes_invalid", "Artifact transfer bytes must be a non-negative safe integer.");
  }
  if (receipt.sha256 !== void 0 && (typeof receipt.sha256 !== "string" || !SHA256_PATTERN.test(receipt.sha256))) {
    throw new OperationStateError("artifact_transfer_sha256_invalid", "Artifact transfer sha256 must be lowercase hexadecimal.");
  }
  if (receipt.blockerCode !== void 0 && (typeof receipt.blockerCode !== "string" || !CODE_PATTERN.test(receipt.blockerCode))) {
    throw new OperationStateError("artifact_transfer_blocker_invalid", "Artifact transfer blockerCode is unsupported.");
  }
  if (receipt.status !== "transferred" && receipt.status !== "partial" && receipt.status !== "blocked") {
    throw new OperationStateError("artifact_transfer_status_invalid", "Artifact transfer status is unsupported.");
  }
  if (receipt.status === "transferred" && (receipt.outputKey === void 0 || receipt.bytes === void 0 || receipt.sha256 === void 0 || receipt.blockerCode !== void 0)) {
    throw new OperationStateError("artifact_transfer_receipt_incomplete", "Transferred artifact receipts require outputKey, bytes, and sha256 without a blocker.");
  }
  if (receipt.status !== "transferred" && receipt.blockerCode === void 0) {
    throw new OperationStateError("artifact_transfer_blocker_missing", "Partial or blocked artifact receipts require blockerCode.");
  }
}
function artifactTransferTuple(intent) {
  return canonicalJson({
    operationId: intent.operationId,
    requestDigest: intent.requestDigest,
    targetBindingDigest: intent.targetBindingDigest,
    assistantTurnId: intent.assistantTurnId,
    sourceIdentityDigest: intent.sourceIdentityDigest,
    kind: intent.kind,
    ordinal: intent.ordinal,
    destinationIdentityDigest: intent.destinationIdentityDigest
  });
}
function assertArtifactTransferIntentShape(value) {
  assertExactRecord(
    value,
    "artifact transfer intent",
    ["schemaVersion", "operationId", "requestDigest", "targetBindingDigest", "assistantTurnId", "sourceIdentityDigest", "kind", "ordinal", "transferActionId", "destinationIdentityDigest", "actionKind", "repeatPolicy", "intentAt"],
    ["schemaVersion", "operationId", "requestDigest", "targetBindingDigest", "assistantTurnId", "sourceIdentityDigest", "kind", "ordinal", "transferActionId", "destinationIdentityDigest", "actionKind", "repeatPolicy", "intentAt"]
  );
  if (value.schemaVersion !== OPERATION_ARTIFACT_TRANSFER_INTENT_SCHEMA_VERSION) throw new OperationStateError("artifact_transfer_intent_schema_invalid", "Artifact transfer intent schemaVersion is unsupported.");
  assertOperationId(value.operationId, "artifactTransfer.operationId");
  assertDigest(value.requestDigest, "artifactTransfer.requestDigest");
  assertDigest(value.targetBindingDigest, "artifactTransfer.targetBindingDigest");
  assertStableIdentifier(value.assistantTurnId, "artifactTransfer.assistantTurnId");
  assertDigest(value.sourceIdentityDigest, "artifactTransfer.sourceIdentityDigest");
  if (value.kind !== "file" && value.kind !== "image" && value.kind !== "other") throw new OperationStateError("artifact_transfer_kind_invalid", "Artifact transfer kind is unsupported.");
  if (!Number.isSafeInteger(value.ordinal) || value.ordinal < 0) throw new OperationStateError("artifact_transfer_ordinal_invalid", "Artifact transfer ordinal must be non-negative.");
  assertOperationId(value.transferActionId, "artifactTransfer.transferActionId");
  assertDigest(value.destinationIdentityDigest, "artifactTransfer.destinationIdentityDigest");
  if (value.actionKind !== "local_output_commit" || value.repeatPolicy !== "reconcile_local_effect") throw new OperationStateError("artifact_transfer_action_policy_invalid", "Artifact transfer intent action policy is unsupported.");
  assertTimestamp(value.intentAt, "artifactTransfer.intentAt");
}
function assertArtifactTransferReceiptShape(value) {
  assertExactRecord(
    value,
    "artifact transfer receipt",
    ["schemaVersion", "operationId", "requestDigest", "targetBindingDigest", "assistantTurnId", "sourceIdentityDigest", "kind", "ordinal", "transferActionId", "destinationIdentityDigest", "outputKey", "bytes", "sha256", "status", "blockerCode", "observedAt"],
    ["schemaVersion", "operationId", "requestDigest", "targetBindingDigest", "assistantTurnId", "sourceIdentityDigest", "kind", "ordinal", "transferActionId", "destinationIdentityDigest", "status", "observedAt"]
  );
  if (value.schemaVersion !== OPERATION_ARTIFACT_TRANSFER_RECEIPT_SCHEMA_VERSION) throw new OperationStateError("artifact_transfer_receipt_schema_invalid", "Artifact transfer receipt schemaVersion is unsupported.");
  assertOperationId(value.operationId, "artifactTransfer.operationId");
  assertDigest(value.requestDigest, "artifactTransfer.requestDigest");
  assertDigest(value.targetBindingDigest, "artifactTransfer.targetBindingDigest");
  assertStableIdentifier(value.assistantTurnId, "artifactTransfer.assistantTurnId");
  assertDigest(value.sourceIdentityDigest, "artifactTransfer.sourceIdentityDigest");
  if (value.kind !== "file" && value.kind !== "image" && value.kind !== "other") throw new OperationStateError("artifact_transfer_kind_invalid", "Artifact transfer kind is unsupported.");
  if (!Number.isSafeInteger(value.ordinal) || value.ordinal < 0) throw new OperationStateError("artifact_transfer_ordinal_invalid", "Artifact transfer ordinal must be non-negative.");
  assertOperationId(value.transferActionId, "artifactTransfer.transferActionId");
  assertDigest(value.destinationIdentityDigest, "artifactTransfer.destinationIdentityDigest");
  if (value.outputKey !== void 0 && (typeof value.outputKey !== "string" || !TRANSFER_OUTPUT_KEY_PATTERN.test(value.outputKey))) throw new OperationStateError("artifact_transfer_output_key_invalid", "Artifact transfer outputKey is unsupported.");
  if (value.bytes !== void 0 && (!Number.isSafeInteger(value.bytes) || value.bytes < 0)) throw new OperationStateError("artifact_transfer_bytes_invalid", "Artifact transfer bytes must be non-negative.");
  if (value.sha256 !== void 0 && (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256))) throw new OperationStateError("artifact_transfer_sha256_invalid", "Artifact transfer sha256 is unsupported.");
  if (value.status !== "transferred" && value.status !== "partial" && value.status !== "blocked") throw new OperationStateError("artifact_transfer_status_invalid", "Artifact transfer status is unsupported.");
  if (value.blockerCode !== void 0 && (typeof value.blockerCode !== "string" || !CODE_PATTERN.test(value.blockerCode))) throw new OperationStateError("artifact_transfer_blocker_invalid", "Artifact transfer blockerCode is unsupported.");
  assertTimestamp(value.observedAt, "artifactTransfer.observedAt");
  if (value.status === "transferred" && (value.outputKey === void 0 || value.bytes === void 0 || value.sha256 === void 0 || value.blockerCode !== void 0)) throw new OperationStateError("artifact_transfer_receipt_incomplete", "Transferred artifact receipts require outputKey, bytes, and sha256 without a blocker.");
  if (value.status !== "transferred" && value.blockerCode === void 0) throw new OperationStateError("artifact_transfer_blocker_missing", "Partial or blocked artifact receipts require blockerCode.");
}
function assertArtifactTransfersStateShape(value) {
  if (!isPlainRecord(value)) throw new OperationStateError("invalid_operation_state", "Operation artifactTransfers must be an object.");
  for (const transferActionId of Object.keys(value)) {
    assertOperationId(transferActionId, "artifactTransfers map key");
    const descriptor = Object.getOwnPropertyDescriptor(value, transferActionId);
    if (descriptor === void 0 || !Object.hasOwn(descriptor, "value") || descriptor.get !== void 0 || descriptor.set !== void 0) throw new OperationStateError("invalid_operation_shape", "Operation artifactTransfers contains an unsafe property (accessor).");
    const transfer = descriptor.value;
    assertExactRecord(transfer, "artifact transfer state", ["intent", "receipt"], ["intent"]);
    assertArtifactTransferIntentShape(transfer.intent);
    if (transfer.receipt !== void 0) assertArtifactTransferReceiptShape(transfer.receipt);
  }
}
function validateArtifactTransferStateValues(transferActionId, transfer, state) {
  if (transfer.intent === void 0 || transfer.intent.transferActionId !== transferActionId) {
    throw new OperationStateError("artifact_transfer_map_mismatch", "Artifact transfer map key must match its intent transferActionId.");
  }
  validateArtifactTransferIntentValues(transfer.intent, state);
  const action = state.actions[transferActionId];
  if (action === void 0 || action.kind !== "local_output_commit" || action.repeatPolicy !== "reconcile_local_effect" || action.requestDigest !== transfer.intent.requestDigest || action.targetDigest !== transfer.intent.targetBindingDigest || action.intentAt !== transfer.intent.intentAt) {
    throw new OperationStateError("artifact_transfer_action_mismatch", "Artifact transfer intent must match its generic local-output action.");
  }
  if (transfer.receipt === void 0) {
    if (action.outcome !== void 0) throw new OperationStateError("artifact_transfer_action_mismatch", "Unreceipted artifact transfer cannot have a settled generic action.");
    return;
  }
  validateArtifactTransferReceiptValues(transfer.receipt, transfer.intent, state);
  if (transfer.receipt.observedAt < transfer.intent.intentAt) throw new OperationStateError("artifact_transfer_timestamp_regression", "Artifact transfer receipt cannot precede its intent.");
  const expectedOutcome = transfer.receipt.status === "transferred" ? "satisfied" : transfer.receipt.status === "blocked" && transfer.receipt.blockerCode === "output_collision" ? "not_satisfied" : "uncertain";
  if (action.outcome !== expectedOutcome || action.receiptAt !== transfer.receipt.observedAt) throw new OperationStateError("artifact_transfer_action_mismatch", "Artifact transfer receipt must match its generic action receipt.");
  if (expectedOutcome === "satisfied" && action.evidenceDigest !== transfer.receipt.destinationIdentityDigest) throw new OperationStateError("artifact_transfer_action_mismatch", "Transferred artifact receipt evidence must match destination identity.");
  if (expectedOutcome !== "satisfied" && action.blockerCode !== transfer.receipt.blockerCode) throw new OperationStateError("artifact_transfer_action_mismatch", "Artifact transfer blocker must match its generic action receipt.");
}
function applyPhaseChange(state, event) {
  if (!(event.from in LEGAL_EDGES) || !(event.to in LEGAL_EDGES)) {
    throw new OperationStateError("invalid_operation_phase", "Phase transition contains an unknown phase.");
  }
  if (!(event.mutationBoundary in BOUNDARY_RANK)) {
    throw new OperationStateError("invalid_mutation_boundary", "Phase transition contains an unknown mutation boundary.");
  }
  if (event.evidenceDigest !== void 0) assertDigest(event.evidenceDigest, "phase.evidenceDigest");
  if (state.target === void 0 && event.to !== "uncertain") {
    throw new OperationStateError("target_not_bound", `Transition to ${event.to} requires a durable target binding.`);
  }
  if (state.target?.targetLifecycle === "new_pending" && (event.to === "submitted" || event.to === "generating" || event.to === "capturing" || event.to === "completed")) {
    throw new OperationStateError(
      "new_target_not_established",
      "A pending new target must be established from post-Send evidence before submission can be reported."
    );
  }
  if (event.from !== state.phase) {
    throw new OperationStateError("phase_mismatch", `Phase event expected ${event.from}, current phase is ${state.phase}.`);
  }
  if (!LEGAL_EDGES[state.phase].has(event.to)) {
    throw new OperationStateError("illegal_phase_transition", `Illegal operation transition ${state.phase} -> ${event.to}.`);
  }
  if (event.mutationBoundary !== state.mutationBoundary) {
    throw new OperationStateError(
      "mutation_boundary_mismatch",
      `Phase transition must preserve the durable mutation boundary ${state.mutationBoundary}.`
    );
  }
  const cause = event.causeActionId === void 0 ? void 0 : state.actions[event.causeActionId];
  if (event.causeActionId !== void 0 && cause === void 0) {
    throw new OperationStateError("transition_cause_missing", `Transition cause ${event.causeActionId} is not recorded.`);
  }
  assertCausalTransition(state, event.to, event.mutationBoundary, cause, event.evidenceDigest);
  return { ...state, phase: event.to, mutationBoundary: event.mutationBoundary };
}
function assertCausalTransition(state, to, boundary, cause, evidenceDigest) {
  if (state.phase === "uncertain") {
    if (cause === void 0 || cause.outcome !== "satisfied") {
      throw new OperationStateError("uncertain_recovery_unproven", "Recovery from uncertain requires a satisfied causal action receipt.");
    }
    if (to === "ready") requireCause(cause, "file_handoff", "satisfied");
    if (to === "generating" || to === "capturing") requireCause(cause, "send", "satisfied");
    requireEvidence(evidenceDigest ?? cause.evidenceDigest);
  }
  if (to === "handoff_pending") {
    requireUnreceiptedCause(cause, "file_handoff");
    requireBoundary(boundary, "handoff_may_have_occurred");
    return;
  }
  if (to === "send_pending") {
    requireUnreceiptedCause(cause, "send");
    requireBoundary(boundary, "send_may_have_occurred");
    return;
  }
  if (to === "submitted") {
    if (cause?.kind !== "send") {
      throw new OperationStateError("invalid_transition_cause", "submitted requires the causal original Send action.");
    }
    requireSatisfiedCause(cause, evidenceDigest);
    requireDurableOriginalSendOwnership(state);
    return;
  }
  if (to === "ready" && state.phase === "prepared") {
    requireEvidence(evidenceDigest);
    return;
  }
  if (to === "ready" && state.phase === "handoff_pending") {
    requireCause(cause, "file_handoff", "satisfied");
    requireEvidence(evidenceDigest);
    return;
  }
  if (to === "generating" || to === "capturing" || to === "completed") {
    requireEvidence(evidenceDigest);
    requireDurableOriginalSendOwnership(state);
  }
}
function applyCompletedReceipt(state, receipt, observedAt) {
  if (state.phase !== "capturing" && state.phase !== "uncertain") {
    throw new OperationStateError("receipt_phase_invalid", "Terminal receipt can only be persisted while capturing or after ownership recovery.");
  }
  if (receipt.operationId !== state.operationId || receipt.requestDigest !== state.requestDigest) {
    throw new OperationStateError("receipt_identity_mismatch", "Terminal receipt does not match the operation identity.");
  }
  if (state.receipt !== void 0) {
    throw new OperationStateError("duplicate_terminal_receipt", "Operation already has a terminal receipt.");
  }
  if (state.target === void 0) {
    throw new OperationStateError("target_not_bound", "Terminal receipt requires a durable target binding.");
  }
  if (state.target.targetLifecycle === "new_pending") {
    throw new OperationStateError("new_target_not_established", "Terminal receipt requires an established new-target identity.");
  }
  requireDurableOriginalSendOwnership(state);
  validateReceiptValues(receipt, state);
  assertTimestampNotBefore(receipt.completedAt, observedAt, "receipt observedAt");
  return { ...state, phase: "completed", receipt };
}
function assertPersistedActionRecord(action, state) {
  assertOperationId(action.actionId, "actionId");
  if (!(action.kind in ACTION_POLICY) || action.repeatPolicy !== requiredRepeatPolicy(action.kind)) {
    throw new OperationStateError("invalid_repeat_policy", "Persisted action kind and repeat policy are inconsistent.");
  }
  assertDigest(action.requestDigest, "action.requestDigest");
  if (action.kind !== "stop" && action.kind !== "work_steer" && action.requestDigest !== state.requestDigest) {
    throw new OperationStateError(
      "action_request_mismatch",
      "Only caller-owned control actions may carry a request digest distinct from the parent operation."
    );
  }
  if (action.parentActionId !== void 0) {
    assertOperationId(action.parentActionId, "action.parentActionId");
    if (state.actions[action.parentActionId] === void 0) {
      throw new OperationStateError("unknown_parent_action", "Persisted action parent is not present in the operation ledger.");
    }
  }
  if (action.targetDigest !== void 0) assertDigest(action.targetDigest, "action.targetDigest");
  if (action.kind !== "status_read" && (state.target === void 0 || action.targetDigest === void 0)) {
    throw new OperationStateError("action_target_missing", "Persisted mutating or target-bound action requires a durable target digest.");
  }
  if (!Number.isSafeInteger(action.intentRevision) || action.intentRevision < 1 || action.intentRevision > state.revision) {
    throw new OperationStateError("invalid_action_revision", "Action intent revision is outside the durable state revision.");
  }
  assertTimestamp(action.intentAt, "action.intentAt");
  assertTimestampNotBefore(action.intentAt, state.updatedAt, "state.updatedAt");
  if (action.outcome === void 0) {
    if (action.receiptRevision !== void 0 || action.receiptAt !== void 0 || action.evidenceDigest !== void 0 || action.blockerCode !== void 0) {
      throw new OperationStateError("action_receipt_incomplete", "Unsettled action cannot contain receipt-only fields.");
    }
    return;
  }
  if (action.outcome !== "satisfied" && action.outcome !== "not_satisfied" && action.outcome !== "uncertain") {
    throw new OperationStateError("invalid_action_outcome", "Persisted action outcome is unsupported.");
  }
  if (!Number.isSafeInteger(action.receiptRevision) || action.receiptRevision <= action.intentRevision || action.receiptRevision > state.revision || action.receiptAt === void 0) {
    throw new OperationStateError("action_receipt_incomplete", "Settled action requires a later bounded receipt revision and timestamp.");
  }
  assertTimestamp(action.receiptAt, "action.receiptAt");
  assertTimestampNotBefore(action.intentAt, action.receiptAt, "action.receiptAt");
  assertTimestampNotBefore(action.receiptAt, state.updatedAt, "state.updatedAt");
  if (action.evidenceDigest !== void 0) assertDigest(action.evidenceDigest, "action.evidenceDigest");
  if (action.outcome === "satisfied" && action.evidenceDigest === void 0) {
    throw new OperationStateError("action_evidence_missing", "Satisfied action requires durable evidence.");
  }
  if (action.blockerCode !== void 0 && !CODE_PATTERN.test(action.blockerCode)) {
    throw new OperationStateError("invalid_blocker_code", "Action blockerCode must be a bounded canonical code.");
  }
}
function validateBlockerObservation(blocker) {
  if (!CODE_PATTERN.test(blocker.code)) {
    throw new OperationStateError("invalid_blocker_code", "Blocker code must be a bounded canonical code.");
  }
  assertDigest(blocker.messageDigest, "blocker.messageDigest");
  if (typeof blocker.recoverable !== "boolean") {
    throw new OperationStateError("invalid_blocker_recoverability", "Blocker recoverable must be boolean.");
  }
  assertTimestamp(blocker.observedAt, "blocker.observedAt");
}
function validateReceiptValues(receipt, state) {
  if (receipt.schemaVersion !== OPERATION_RECEIPT_SCHEMA_VERSION) {
    throw new OperationStateError("unsupported_operation_receipt", "Terminal receipt schemaVersion is unsupported.");
  }
  if (state.capturePolicy !== void 0 && receipt.responseFormat !== state.capturePolicy.responseFormat) {
    throw new OperationStateError("receipt_capture_policy_mismatch", "Terminal receipt format does not match the immutable capture policy.");
  }
  assertOperationId(receipt.operationId);
  if (receipt.operationId !== state.operationId || receipt.requestDigest !== state.requestDigest) {
    throw new OperationStateError("receipt_identity_mismatch", "Terminal receipt does not match the operation identity.");
  }
  assertDigest(receipt.requestDigest, "receipt.requestDigest");
  assertDigest(receipt.targetBindingDigest, "receipt.targetBindingDigest");
  assertDigest(receipt.userTurnEvidenceDigest, "receipt.userTurnEvidenceDigest");
  assertDigest(receipt.ownershipEvidenceDigest, "receipt.ownershipEvidenceDigest");
  assertStableIdentifier(receipt.userTurnId, "receipt.userTurnId");
  assertStableIdentifier(receipt.assistantTurnId, "receipt.assistantTurnId");
  if (!FINISH_REASON_PATTERN.test(receipt.finishReason)) {
    throw new OperationStateError("receipt_finish_reason_invalid", "Terminal receipt finishReason must be a bounded canonical value.");
  }
  if (typeof receipt.contentAvailable !== "boolean") {
    throw new OperationStateError("receipt_content_availability_invalid", "Terminal receipt contentAvailable must be boolean.");
  }
  const hasResponseDigest = receipt.responseDigest !== void 0;
  const hasResponseBytes = receipt.responseBytes !== void 0;
  if (hasResponseDigest !== hasResponseBytes || receipt.contentAvailable && !hasResponseDigest) {
    throw new OperationStateError("receipt_response_metadata_incomplete", "Response digest and byte count must be paired and present when content is available.");
  }
  if (receipt.responseDigest !== void 0) assertDigest(receipt.responseDigest, "receipt.responseDigest");
  if (receipt.responseBytes !== void 0 && (!Number.isSafeInteger(receipt.responseBytes) || receipt.responseBytes < 0)) {
    throw new OperationStateError("receipt_response_bytes_invalid", "Terminal receipt responseBytes must be a non-negative safe integer.");
  }
  assertTimestamp(receipt.completedAt, "receipt.completedAt");
  assertTimestampNotBefore(state.createdAt, receipt.completedAt, "receipt.completedAt");
  if (state.phase === "completed") assertTimestampNotBefore(receipt.completedAt, state.updatedAt, "state.updatedAt");
  const submitAction = Object.values(state.actions).find((action) => action.kind === "send");
  if (submitAction?.targetDigest === void 0 || submitAction.targetDigest !== receipt.targetBindingDigest) {
    throw new OperationStateError("receipt_target_mismatch", "Terminal receipt does not match the submitted target binding.");
  }
  if (submitAction.outcome !== "satisfied") {
    throw new OperationStateError("receipt_submission_unproven", "Terminal receipt requires a satisfied original Send action.");
  }
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length > MAX_ARTIFACTS) {
    throw new OperationStateError("receipt_artifacts_invalid", `Terminal receipt may contain at most ${MAX_ARTIFACTS} artifacts.`);
  }
  const artifactKeys = /* @__PURE__ */ new Set();
  const artifactOrdinals = /* @__PURE__ */ new Set();
  for (const artifact of receipt.artifacts) {
    if (artifact.schemaVersion !== OPERATION_ARTIFACT_RECEIPT_SCHEMA_VERSION) {
      throw new OperationStateError("unsupported_artifact_receipt", "Artifact receipt schemaVersion is unsupported.");
    }
    if (artifact.operationId !== receipt.operationId) {
      throw new OperationStateError("artifact_operation_mismatch", "Artifact receipt must belong to the terminal operation.");
    }
    if (artifact.assistantTurnId !== receipt.assistantTurnId) {
      throw new OperationStateError("artifact_turn_mismatch", "Artifact receipt must belong to the terminal assistant turn.");
    }
    if (!ARTIFACT_KEY_PATTERN.test(artifact.artifactKey) || artifactKeys.has(artifact.artifactKey)) {
      throw new OperationStateError("artifact_key_invalid", "Artifact receipt keys must be bounded canonical values and unique.");
    }
    artifactKeys.add(artifact.artifactKey);
    assertDigest(artifact.sourceIdentityDigest, "artifact.sourceIdentityDigest");
    if (artifact.kind !== "file" && artifact.kind !== "image" && artifact.kind !== "other") {
      throw new OperationStateError("artifact_kind_invalid", "Artifact receipt kind is unsupported.");
    }
    if (artifact.status !== "available" && artifact.status !== "transferred" && artifact.status !== "partial" && artifact.status !== "blocked") {
      throw new OperationStateError("artifact_status_invalid", "Artifact receipt status is unsupported.");
    }
    if (!Number.isSafeInteger(artifact.ordinal) || artifact.ordinal < 0 || artifact.ordinal >= MAX_ARTIFACTS || artifactOrdinals.has(artifact.ordinal)) {
      throw new OperationStateError(
        "artifact_ordinal_invalid",
        `Artifact receipt ordinals must be unique safe integers from 0 through ${MAX_ARTIFACTS - 1}.`
      );
    }
    artifactOrdinals.add(artifact.ordinal);
    if (artifact.outputKey !== void 0 && !isSafeRelativeOutputKey(artifact.outputKey)) {
      throw new OperationStateError("artifact_output_key_invalid", "Artifact outputKey must be a safe relative opaque key.");
    }
    if (artifact.mimeType !== void 0 && !MIME_PATTERN.test(artifact.mimeType)) {
      throw new OperationStateError("artifact_mime_type_invalid", "Artifact MIME type must be a bounded canonical value.");
    }
    if (artifact.bytes !== void 0 && (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0)) {
      throw new OperationStateError("artifact_bytes_invalid", "Artifact receipt bytes must be a non-negative safe integer.");
    }
    if (artifact.sha256 !== void 0 && !SHA256_PATTERN.test(artifact.sha256)) {
      throw new OperationStateError("artifact_digest_invalid", "Artifact receipt sha256 must be lowercase hexadecimal.");
    }
    if (artifact.blockerCode !== void 0 && !CODE_PATTERN.test(artifact.blockerCode)) {
      throw new OperationStateError("artifact_blocker_invalid", "Artifact blockerCode must be a bounded canonical code.");
    }
    if (artifact.status === "transferred" && (artifact.outputKey === void 0 || artifact.bytes === void 0 || artifact.sha256 === void 0)) {
      throw new OperationStateError("artifact_transfer_receipt_incomplete", "Transferred artifacts require outputKey, bytes, and sha256.");
    }
    if ((artifact.status === "partial" || artifact.status === "blocked") && artifact.blockerCode === void 0) {
      throw new OperationStateError("artifact_blocker_missing", "Partial or blocked artifacts require blockerCode.");
    }
    if ((artifact.status === "available" || artifact.status === "transferred") && artifact.blockerCode !== void 0) {
      throw new OperationStateError("artifact_blocker_unexpected", "Available or transferred artifacts cannot contain a blockerCode.");
    }
  }
  validateTerminalArtifactCapturePolicy(receipt, state);
}
function validateTerminalArtifactCapturePolicy(receipt, state) {
  const policy = state.capturePolicy?.artifacts;
  if (policy === void 0) return;
  const transfers = state.artifactTransfers ?? {};
  const transferEntries = Object.entries(transfers);
  if (policy === "receipt_only") {
    if (transferEntries.length > 0) {
      throw new OperationStateError(
        "artifact_transfer_policy_mismatch",
        "Receipt-only completion cannot contain durable artifact transfers."
      );
    }
    for (const artifact of receipt.artifacts) {
      if (artifact.status !== "available" || artifact.outputKey !== void 0) {
        throw new OperationStateError(
          "artifact_transfer_policy_mismatch",
          "Receipt-only completion cannot contain transfer-enriched artifacts."
        );
      }
    }
    return;
  }
  if (policy !== "transfer") {
    throw new OperationStateError("invalid_capture_policy", "Terminal artifact policy is unsupported.");
  }
  const transferByArtifact = /* @__PURE__ */ new Map();
  for (const [transferActionId, transfer] of transferEntries) {
    if (transfer.receipt === void 0) {
      throw new OperationStateError(
        "artifact_transfer_unsettled",
        `Transfer ${transferActionId} has no durable receipt before terminal completion.`
      );
    }
    const identity = artifactTransferArtifactIdentity(transfer.intent);
    if (transferByArtifact.has(identity)) {
      throw new OperationStateError(
        "artifact_transfer_duplicate_artifact",
        "Terminal completion requires at most one settled transfer per exact artifact identity."
      );
    }
    transferByArtifact.set(identity, transfer);
  }
  const receiptIdentities = /* @__PURE__ */ new Set();
  for (const artifact of receipt.artifacts) {
    if (artifact.status === "available") {
      throw new OperationStateError(
        "artifact_transfer_unsettled",
        "Transfer-policy completion cannot contain an artifact that remains available."
      );
    }
    const identity = artifactReceiptIdentity(artifact);
    if (receiptIdentities.has(identity)) {
      throw new OperationStateError(
        "artifact_transfer_duplicate_artifact",
        "Terminal receipt contains duplicate exact artifact identities."
      );
    }
    receiptIdentities.add(identity);
    const transfer = transferByArtifact.get(identity);
    if (transfer === void 0 || transfer.receipt === void 0) {
      throw new OperationStateError(
        "artifact_transfer_intent_missing",
        "Every terminal transfer-policy artifact requires one matching durable transfer receipt."
      );
    }
    assertTerminalArtifactMatchesTransfer(artifact, transfer.receipt);
  }
  if (transferByArtifact.size !== receiptIdentities.size) {
    throw new OperationStateError(
      "artifact_transfer_extra",
      "Every durable transfer must have one matching terminal artifact receipt."
    );
  }
}
function artifactReceiptIdentity(artifact) {
  return canonicalJson({
    operationId: artifact.operationId,
    assistantTurnId: artifact.assistantTurnId,
    sourceIdentityDigest: artifact.sourceIdentityDigest,
    kind: artifact.kind,
    ordinal: artifact.ordinal
  });
}
function artifactTransferArtifactIdentity(intent) {
  return canonicalJson({
    operationId: intent.operationId,
    assistantTurnId: intent.assistantTurnId,
    sourceIdentityDigest: intent.sourceIdentityDigest,
    kind: intent.kind,
    ordinal: intent.ordinal
  });
}
function assertTerminalArtifactMatchesTransfer(artifact, transfer) {
  if (artifact.status !== transfer.status || artifact.outputKey !== transfer.outputKey || artifact.bytes !== transfer.bytes || artifact.sha256 !== transfer.sha256 || artifact.blockerCode !== transfer.blockerCode) {
    throw new OperationStateError(
      "artifact_transfer_receipt_mismatch",
      "Terminal artifact status and transfer receipt facts must match exactly."
    );
  }
}
function validateStateCoherence(state) {
  if (state.target?.targetLifecycle === "new_pending" && (state.phase === "submitted" || state.phase === "generating" || state.phase === "capturing" || state.phase === "completed")) {
    throw new OperationStateError(
      "new_target_not_established",
      "A pending new target cannot have a submitted, generating, capturing, or completed state."
    );
  }
  const revisions = /* @__PURE__ */ new Set();
  const singleIntentKinds = /* @__PURE__ */ new Set();
  let expectedBoundary = "none";
  for (const action of Object.values(state.actions)) {
    if (revisions.has(action.intentRevision) || action.receiptRevision !== void 0 && revisions.has(action.receiptRevision)) {
      throw new OperationStateError("duplicate_action_revision", "Action ledger revisions must be unique.");
    }
    revisions.add(action.intentRevision);
    if (action.receiptRevision !== void 0) revisions.add(action.receiptRevision);
    if (isSingleIntentKind(action.kind)) {
      if (singleIntentKinds.has(action.kind)) {
        throw new OperationStateError("nonrepeatable_action_already_intended", "Persisted operation contains duplicate operation-singleton action kinds.");
      }
      singleIntentKinds.add(action.kind);
    }
    const boundary = boundaryForAction(action.kind);
    if (boundary !== void 0 && BOUNDARY_RANK[boundary] > BOUNDARY_RANK[expectedBoundary]) expectedBoundary = boundary;
  }
  if (state.mutationBoundary !== expectedBoundary) {
    throw new OperationStateError("mutation_boundary_inconsistent", "Persisted mutation boundary does not match the durable action ledger.");
  }
  const actions = Object.values(state.actions);
  const hasHandoff = actions.some((action) => action.kind === "file_handoff");
  const submitActions = actions.filter((action) => action.kind === "send");
  const hasSubmit = submitActions.length > 0;
  validateSubmissionWitnessCollection(state);
  const ownershipBaselines = state.ownershipBaselines ?? {};
  for (const [actionId, baseline] of Object.entries(ownershipBaselines)) {
    const action = state.actions[actionId];
    if (action === void 0 || action.kind !== "send" && action.kind !== "work_steer") {
      throw new OperationStateError("ownership_baseline_action_missing", "Per-action ownership baselines require a durable Send or steer action.");
    }
    if (baseline.actionId !== actionId) {
      throw new OperationStateError("ownership_baseline_map_mismatch", "Per-action ownership baseline key must match its actionId.");
    }
    if (action.kind === "send") {
      if (state.ownershipBaseline === void 0 || canonicalJson(state.ownershipBaseline) !== canonicalJson(baseline)) {
        throw new OperationStateError("ownership_baseline_projection_mismatch", "The Send ownership baseline must match the compatibility projection.");
      }
    }
  }
  if (state.ownershipBaseline !== void 0) {
    const projected = ownershipBaselines[state.ownershipBaseline.actionId];
    if (projected !== void 0 && canonicalJson(projected) !== canonicalJson(state.ownershipBaseline)) {
      throw new OperationStateError("ownership_baseline_projection_mismatch", "The ownership baseline compatibility projection conflicts with its per-action record.");
    }
  }
  if (state.artifactTransfers !== void 0) {
    assertArtifactTransfersStateShape(state.artifactTransfers);
    if (Object.keys(state.artifactTransfers).length > 0 && state.capturePolicy?.artifacts !== "transfer") {
      throw new OperationStateError(
        "artifact_transfer_policy_mismatch",
        "Durable artifact transfers require the immutable transfer capture policy."
      );
    }
    const seenTuples = /* @__PURE__ */ new Set();
    for (const [transferActionId, transfer] of Object.entries(state.artifactTransfers)) {
      validateArtifactTransferStateValues(transferActionId, transfer, state);
      const intent = transfer.intent;
      const tuple = artifactTransferTuple(intent);
      if (seenTuples.has(tuple)) {
        throw new OperationStateError("artifact_transfer_duplicate_tuple", "An artifact transfer tuple may only be transferred once.");
      }
      seenTuples.add(tuple);
    }
  }
  if (state.target?.targetLifecycle === "new_established") {
    const establishment = state.target.targetEstablishment;
    const submit = submitActions.length === 1 ? submitActions[0] : void 0;
    if (establishment === void 0 || submit === void 0) {
      throw new OperationStateError("new_target_establishment_send_missing", "An established new target requires exactly one durable Send intent.");
    }
    if (establishment.causalSendActionId !== submit.actionId || establishment.targetBindingDigest !== submit.targetDigest) {
      throw new OperationStateError("new_target_establishment_target_mismatch", "Established target identity does not match the durable Send action.");
    }
  }
  if (state.phase === "handoff_pending" && !hasHandoff) {
    throw new OperationStateError("operation_state_inconsistent", "handoff_pending requires a durable file-handoff intent.");
  }
  if (state.phase === "send_pending" && !hasSubmit) {
    throw new OperationStateError("operation_state_inconsistent", "send_pending requires the durable original Send intent.");
  }
  if (["submitted", "generating", "capturing", "completed"].includes(state.phase)) {
    requireDurableOriginalSendOwnership(state);
  }
}
function requireDurableOriginalSendOwnership(state) {
  const sendActions = Object.values(state.actions).filter((action) => action.kind === "send");
  if (sendActions.length !== 1) {
    throw new OperationStateError(
      "operation_state_inconsistent",
      "Owned submission state requires exactly one durable original Send intent."
    );
  }
  const send = sendActions[0];
  if (send.outcome !== "satisfied") {
    throw new OperationStateError(
      "operation_state_inconsistent",
      "Owned submission state requires a satisfied original Send action."
    );
  }
  const baseline = state.ownershipBaselines?.[send.actionId];
  if (baseline === void 0) {
    throw new OperationStateError(
      "ownership_baseline_missing",
      "Owned submission state requires the keyed pre-Send ownership baseline."
    );
  }
  const witness = state.submissionWitnesses?.[send.actionId];
  if (witness === void 0) {
    throw new OperationStateError(
      "submission_witness_missing",
      "Owned submission state requires the keyed original Send submission witness."
    );
  }
  if (baseline.actionId !== send.actionId || baseline.operationId !== state.operationId || baseline.requestDigest !== state.requestDigest || baseline.targetBindingDigest !== send.targetDigest || witness.actionId !== send.actionId || witness.actionKind !== "send" || witness.targetBindingDigest !== send.targetDigest || witness.baselineSnapshotDigest !== baseline.baseline.snapshotDigest) {
    throw new OperationStateError(
      "submission_ownership_mismatch",
      "Original Send ownership baseline and witness do not match the durable action identity."
    );
  }
  if (state.ownershipBaseline === void 0 || canonicalJson(state.ownershipBaseline) !== canonicalJson(baseline) || state.submissionWitness === void 0 || canonicalJson(state.submissionWitness) !== canonicalJson(witness)) {
    throw new OperationStateError(
      "submission_ownership_projection_mismatch",
      "Original Send ownership compatibility projections must mirror the keyed durable proof."
    );
  }
}
function validatedTarget(state, target) {
  validateTargetValues(target);
  if (state.target === void 0 && target.targetLifecycle === "new_established") {
    throw new OperationStateError(
      "new_target_establishment_order",
      "A new target must be bound as pending before its target_established event."
    );
  }
  if (state.target !== void 0 && canonicalJson(state.target) !== canonicalJson(target)) {
    throw new OperationStateError("target_binding_mismatch", "Operation target binding is immutable.");
  }
  return target;
}
function establishTarget(state, establishment) {
  const target = state.target;
  if (target === void 0) {
    throw new OperationStateError("target_not_bound", "Target establishment requires a durable target anchor.");
  }
  const lifecycle = target.targetLifecycle ?? "fixed";
  if (lifecycle === "fixed") {
    throw new OperationStateError("fixed_target_establishment", "A fixed target cannot be established as a new conversation.");
  }
  if (lifecycle === "new_established") {
    throw new OperationStateError("target_already_established", "A new target can be established only once.");
  }
  validateTargetEstablishmentValues(
    {
      ...establishment
      // The nested record is checked again below against the send intent and
      // current target. Keeping the full record here makes the event/state
      // shapes closed and lets authenticated snapshots replay without context.
    },
    {
      ...target,
      targetLifecycle: "new_established",
      conversationId: establishment.conversationId,
      canonicalThreadUrl: establishment.canonicalThreadUrl,
      targetEstablishment: establishment,
      evidenceProfile: {
        ...target.evidenceProfile,
        stableConversationId: "required",
        stableUserTurnId: "required"
      }
    }
  );
  assertOperationId(establishment.causalSendActionId, "target_established.causalSendActionId");
  const send = state.actions[establishment.causalSendActionId];
  if (send === void 0 || send.kind !== "send") {
    throw new OperationStateError("target_establishment_send_missing", "Target establishment requires the causal original Send intent.");
  }
  if (send.outcome === "not_satisfied") {
    throw new OperationStateError("target_establishment_send_rejected", "Target establishment cannot follow a rejected Send intent.");
  }
  if (send.targetDigest !== establishment.targetBindingDigest) {
    throw new OperationStateError("target_establishment_target_mismatch", "Target establishment target digest does not match the causal Send intent.");
  }
  if (establishment.observedAt < send.intentAt) {
    throw new OperationStateError("target_establishment_before_send", "Target establishment cannot precede the durable Send intent.");
  }
  if (state.phase === "prepared" || state.phase === "handoff_pending" || state.phase === "completed") {
    throw new OperationStateError("target_establishment_phase_invalid", "Target establishment requires a durable Send lifecycle phase.");
  }
  const establishedTarget = {
    ...target,
    targetLifecycle: "new_established",
    conversationId: establishment.conversationId,
    canonicalThreadUrl: establishment.canonicalThreadUrl,
    evidenceProfile: {
      ...target.evidenceProfile,
      stableConversationId: "required",
      stableUserTurnId: "required"
    },
    targetEstablishment: establishment
  };
  validateTargetValues(establishedTarget);
  return establishedTarget;
}
function validateTargetValues(target) {
  for (const [label, value] of [["providerId", target.providerId], ["browserId", target.browserId], ["tabId", target.tabId]]) {
    assertStableIdentifier(value, label);
  }
  if (target.conversationId !== void 0) assertStableIdentifier(target.conversationId, "conversationId");
  for (const [label, digest] of [
    ["userTurnBaselineDigest", target.userTurnBaselineDigest],
    ["assistantTurnBaselineDigest", target.assistantTurnBaselineDigest],
    ["configurationReceiptDigest", target.configurationReceiptDigest]
  ]) {
    if (digest !== void 0) assertDigest(digest, `target.${label}`);
  }
  const profile = target.evidenceProfile;
  if (!profile || profile.providerIdentity !== "required" && profile.providerIdentity !== "unavailable" || profile.stableTabId !== "required" && profile.stableTabId !== "unavailable" || profile.stableConversationId !== "required" && profile.stableConversationId !== "unavailable" || profile.stableUserTurnId !== "required" && profile.stableUserTurnId !== "unavailable" || profile.authoritativeTabClaim !== "required" && profile.authoritativeTabClaim !== "unavailable" || typeof profile.replacementTabRecovery !== "boolean") {
    throw new OperationStateError("invalid_target_evidence_profile", "Target evidence profile is invalid.");
  }
  if (profile.stableConversationId === "required" && target.conversationId === void 0) {
    throw new OperationStateError("target_conversation_missing", "Required stable conversation identity is absent.");
  }
  if (target.coordinationScope !== "process" && target.coordinationScope !== "provider") {
    throw new OperationStateError("invalid_coordination_scope", "Target coordinationScope must be process or provider.");
  }
  if (target.tabClaimEvidenceDigest !== void 0) {
    assertDigest(target.tabClaimEvidenceDigest, "target.tabClaimEvidenceDigest");
  }
  if (target.coordinationScope === "provider" && (profile.authoritativeTabClaim !== "required" || target.tabClaimEvidenceDigest === void 0)) {
    throw new OperationStateError(
      "target_claim_evidence_missing",
      "Provider-scoped coordination requires authoritative tab-claim evidence."
    );
  }
  if (target.canonicalThreadUrl !== void 0) assertCanonicalThreadUrl(target.canonicalThreadUrl);
  const lifecycle = target.targetLifecycle ?? "fixed";
  if (lifecycle !== "fixed" && lifecycle !== "new_pending" && lifecycle !== "new_established") {
    throw new OperationStateError("invalid_target_lifecycle", "Target lifecycle must be fixed, new_pending, or new_established.");
  }
  if (target.newTargetAnchorDigest !== void 0) assertDigest(target.newTargetAnchorDigest, "target.newTargetAnchorDigest");
  if (target.blankTaskEvidenceDigest !== void 0) assertDigest(target.blankTaskEvidenceDigest, "target.blankTaskEvidenceDigest");
  if (lifecycle === "fixed") {
    if (target.newTargetAnchorDigest !== void 0 || target.blankTaskEvidenceDigest !== void 0 || target.targetEstablishment !== void 0) {
      throw new OperationStateError("fixed_target_new_identity", "Fixed targets cannot contain new-conversation identity fields.");
    }
    return;
  }
  if (target.newTargetAnchorDigest === void 0 || target.blankTaskEvidenceDigest === void 0) {
    throw new OperationStateError("new_target_anchor_missing", "New targets require an immutable anchor and blank-task evidence digest.");
  }
  if (target.canonicalThreadUrl !== void 0 || target.conversationId !== void 0) {
    if (lifecycle === "new_pending") {
      throw new OperationStateError("new_target_identity_early", "A pending new target cannot contain provider conversation identity before establishment.");
    }
  }
  if (lifecycle === "new_pending") {
    if (target.targetEstablishment !== void 0) {
      throw new OperationStateError("new_target_establishment_early", "A pending new target cannot contain an establishment record.");
    }
    if (target.evidenceProfile.stableConversationId !== "unavailable") {
      throw new OperationStateError("new_target_conversation_profile", "A pending new target must mark stable conversation identity unavailable.");
    }
    if (target.evidenceProfile.stableUserTurnId !== "unavailable") {
      throw new OperationStateError("new_target_user_profile", "A pending new target must mark stable user-turn identity unavailable.");
    }
    return;
  }
  const establishment = target.targetEstablishment;
  if (establishment === void 0) {
    throw new OperationStateError("new_target_establishment_missing", "An established new target requires its durable establishment record.");
  }
  validateTargetEstablishmentValues(establishment, target);
  if (target.evidenceProfile.stableConversationId !== "required" || target.evidenceProfile.stableUserTurnId !== "required") {
    throw new OperationStateError("new_target_established_profile", "An established new target must require stable conversation and user-turn identity.");
  }
}
function validateTargetEstablishmentValues(establishment, target) {
  assertDigest(establishment.targetBindingDigest, "targetEstablishment.targetBindingDigest");
  assertDigest(establishment.anchorDigest, "targetEstablishment.anchorDigest");
  assertOperationId(establishment.causalSendActionId, "targetEstablishment.causalSendActionId");
  assertStableIdentifier(establishment.conversationId, "targetEstablishment.conversationId");
  assertCanonicalThreadUrl(establishment.canonicalThreadUrl);
  assertStableIdentifier(establishment.userTurnId, "targetEstablishment.userTurnId");
  assertDigest(establishment.userTurnEvidenceDigest, "targetEstablishment.userTurnEvidenceDigest");
  if (establishment.postSendDeltaDigest !== void 0) {
    assertDigest(establishment.postSendDeltaDigest, "targetEstablishment.postSendDeltaDigest");
  }
  assertDigest(establishment.evidenceDigest, "targetEstablishment.evidenceDigest");
  assertTimestamp(establishment.observedAt, "targetEstablishment.observedAt");
  if (establishment.anchorDigest !== target.newTargetAnchorDigest) {
    throw new OperationStateError("new_target_anchor_mismatch", "Target establishment does not match the immutable new-target anchor.");
  }
  if (target.conversationId !== establishment.conversationId || target.canonicalThreadUrl !== establishment.canonicalThreadUrl) {
    throw new OperationStateError("new_target_identity_mismatch", "Target establishment identity disagrees with the durable target binding.");
  }
}
function assertSubmissionWitnessesMapShape(value) {
  if (!isPlainRecord(value)) {
    throw new OperationStateError("invalid_operation_state", "Operation submissionWitnesses must be an object.");
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_SUBMISSION_WITNESSES) {
    throw new OperationStateError(
      "submission_witness_limit",
      `An operation may record at most ${MAX_SUBMISSION_WITNESSES} submission witnesses.`
    );
  }
  for (const actionId of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, actionId);
    if (descriptor === void 0 || !Object.hasOwn(descriptor, "value") || descriptor.get !== void 0 || descriptor.set !== void 0) {
      throw new OperationStateError(
        "invalid_operation_shape",
        "Operation submissionWitnesses contains an unsafe property (accessor)."
      );
    }
    assertOperationId(actionId, "submissionWitnesses map key");
    assertSubmissionWitnessShape(descriptor.value);
  }
}
function validateSubmissionWitnessCollection(state) {
  if (state.submissionWitnesses !== void 0) {
    assertSubmissionWitnessesMapShape(state.submissionWitnesses);
    for (const [actionId, witness] of Object.entries(state.submissionWitnesses)) {
      if (witness.actionId !== actionId) {
        throw new OperationStateError(
          "submission_witness_map_mismatch",
          "Submission witness map key must match its actionId."
        );
      }
      validateSubmissionWitnessValues(witness, state);
    }
  }
  if (state.submissionWitness !== void 0) {
    assertSubmissionWitnessShape(state.submissionWitness);
    if (state.submissionWitness.actionKind !== "send") {
      throw new OperationStateError(
        "submission_witness_projection_mismatch",
        "The legacy submissionWitness field must project the original Send witness."
      );
    }
    validateSubmissionWitnessValues(state.submissionWitness, state);
    if (state.submissionWitnesses !== void 0) {
      const projected = state.submissionWitnesses[state.submissionWitness.actionId];
      if (projected === void 0 || canonicalJson(projected) !== canonicalJson(state.submissionWitness)) {
        throw new OperationStateError(
          "submission_witness_projection_mismatch",
          "The original Send submission witness must match its keyed projection exactly."
        );
      }
    }
  }
  if (state.submissionWitnesses !== void 0) {
    const sendWitnesses = Object.values(state.submissionWitnesses).filter((witness) => witness.actionKind === "send");
    if (sendWitnesses.length > 1) {
      throw new OperationStateError(
        "submission_witness_duplicate_send",
        "An operation may record only one original Send submission witness."
      );
    }
    if (sendWitnesses.length === 1 && (state.submissionWitness === void 0 || canonicalJson(state.submissionWitness) !== canonicalJson(sendWitnesses[0]))) {
      throw new OperationStateError(
        "submission_witness_projection_mismatch",
        "The original Send submission witness must be retained through the legacy projection."
      );
    }
  }
}
function assertSubmissionWitnessShape(value) {
  assertExactRecord(
    value,
    "operation submission witness",
    [
      "schemaVersion",
      "actionId",
      "actionKind",
      "targetBindingDigest",
      "baselineSnapshotDigest",
      "postSendDeltaDigest",
      "operationUserEvidenceDigest",
      "userTurnId",
      "observedAt"
    ],
    [
      "schemaVersion",
      "actionId",
      "actionKind",
      "targetBindingDigest",
      "baselineSnapshotDigest",
      "postSendDeltaDigest",
      "operationUserEvidenceDigest",
      "observedAt"
    ]
  );
}
function validateSubmissionWitnessValues(witness, state) {
  if (witness.schemaVersion !== OPERATION_SUBMISSION_WITNESS_SCHEMA_VERSION) {
    throw new OperationStateError("unsupported_submission_witness", "Submission witness schemaVersion is unsupported.");
  }
  assertOperationId(witness.actionId, "submissionWitness.actionId");
  if (witness.actionKind !== "send" && witness.actionKind !== "work_steer") {
    throw new OperationStateError("invalid_submission_witness", "Submission witness actionKind is unsupported.");
  }
  assertDigest(witness.targetBindingDigest, "submissionWitness.targetBindingDigest");
  assertDigest(witness.baselineSnapshotDigest, "submissionWitness.baselineSnapshotDigest");
  assertDigest(witness.postSendDeltaDigest, "submissionWitness.postSendDeltaDigest");
  assertDigest(witness.operationUserEvidenceDigest, "submissionWitness.operationUserEvidenceDigest");
  if (witness.userTurnId !== void 0) assertStableIdentifier(witness.userTurnId, "submissionWitness.userTurnId");
  assertTimestamp(witness.observedAt, "submissionWitness.observedAt");
  const action = state.actions[witness.actionId];
  if (action === void 0 || action.kind !== witness.actionKind) {
    throw new OperationStateError("submission_witness_action_missing", "Submission witness must name its durable causal action.");
  }
  if (action.targetDigest !== witness.targetBindingDigest) {
    throw new OperationStateError("submission_witness_target_mismatch", "Submission witness target does not match its causal action.");
  }
  if (action.outcome === "not_satisfied" || action.outcome === "uncertain") {
    throw new OperationStateError("submission_witness_action_unproven", "Submission witness cannot follow an unsatisfied or uncertain action.");
  }
  if (witness.observedAt < action.intentAt) {
    throw new OperationStateError("submission_witness_before_action", "Submission witness cannot precede its causal action intent.");
  }
  if (state.target === void 0) {
    throw new OperationStateError("target_not_bound", "Submission witness requires a durable target binding.");
  }
  const witnessBaseline = state.ownershipBaselines === void 0 ? state.ownershipBaseline?.actionId === witness.actionId ? state.ownershipBaseline : void 0 : state.ownershipBaselines[witness.actionId];
  if (witnessBaseline === void 0) {
    throw new OperationStateError("ownership_baseline_missing", "Submission witness requires the durable ownership baseline for its causal action.");
  }
  if (witnessBaseline.operationId !== state.operationId || witnessBaseline.requestDigest !== state.requestDigest || witnessBaseline.targetBindingDigest !== witness.targetBindingDigest || witnessBaseline.actionId !== witness.actionId || witnessBaseline.baseline.snapshotDigest !== witness.baselineSnapshotDigest) {
    throw new OperationStateError("ownership_baseline_mismatch", "Submission witness does not match the durable ownership baseline.");
  }
  if (state.target.targetLifecycle === "new_pending") {
    throw new OperationStateError(
      "new_target_establishment_required",
      "A pending new target must be established before its submission witness is durable."
    );
  }
  const establishment = state.target.targetEstablishment;
  if (establishment !== void 0 && establishment.causalSendActionId === witness.actionId) {
    if (establishment.targetBindingDigest !== witness.targetBindingDigest || establishment.userTurnEvidenceDigest !== witness.operationUserEvidenceDigest || establishment.postSendDeltaDigest === void 0 || establishment.postSendDeltaDigest !== witness.postSendDeltaDigest || witness.userTurnId !== void 0 && establishment.userTurnId !== witness.userTurnId) {
      throw new OperationStateError("submission_witness_establishment_mismatch", "Submission witness conflicts with durable target establishment.");
    }
  }
}
function requireUnreceiptedCause(cause, kind) {
  requireCause(cause, kind, void 0);
  if (cause.outcome !== void 0) {
    throw new OperationStateError("transition_cause_already_settled", `Transition requires an unreceipted ${kind} intent.`);
  }
}
function withRevision(state, revision, updatedAt) {
  return { ...state, revision, updatedAt };
}
function requireCause(cause, kind, outcome) {
  if (cause?.kind !== kind || outcome !== void 0 && cause.outcome !== outcome) {
    throw new OperationStateError("invalid_transition_cause", `Transition requires ${kind}${outcome === void 0 ? "" : ` with ${outcome} receipt`}.`);
  }
}
function requireSatisfiedCause(cause, evidenceDigest) {
  if (cause.outcome !== "satisfied") {
    throw new OperationStateError("transition_cause_unproven", `Action ${cause.actionId} has not been satisfied.`);
  }
  requireEvidence(evidenceDigest ?? cause.evidenceDigest);
}
function requireBoundary(actual, required) {
  if (BOUNDARY_RANK[actual] < BOUNDARY_RANK[required]) {
    throw new OperationStateError("mutation_boundary_missing", `Transition requires boundary ${required}.`);
  }
}
function requireEvidence(value) {
  if (value === void 0 || value.length === 0) {
    throw new OperationStateError("transition_evidence_missing", "Transition requires causal evidenceDigest.");
  }
}
function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new OperationStateError("invalid_digest", `${label} must be a canonical lowercase hmac-sha256 digest.`);
  }
}
function assertTimestamp(value, label) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new OperationStateError("invalid_timestamp", `${label} must be a canonical UTC ISO-8601 timestamp.`);
  }
}
function assertTimestampNotBefore(earlier, later, label) {
  if (later < earlier) {
    throw new OperationStateError("timestamp_regression", `${label} cannot precede the prior durable event.`);
  }
}
function assertStableIdentifier(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new OperationStateError("invalid_target_binding", `${label} must be a bounded stable identifier.`);
  }
}
function assertCanonicalThreadUrl(value) {
  if (typeof value !== "string" || value.length > 4096) {
    throw new OperationStateError("invalid_target_url", "canonicalThreadUrl must be a bounded absolute HTTP(S) URL.");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new OperationStateError("invalid_target_url", "canonicalThreadUrl must be a bounded absolute HTTP(S) URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "" || parsed.toString() !== value) {
    throw new OperationStateError("invalid_target_url", "canonicalThreadUrl must be a canonical HTTPS URL without credentials, query, or fragment.");
  }
}
function isSafeRelativeOutputKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}
function assertTargetShape(value) {
  assertExactRecord(
    value,
    "operation target",
    [
      "providerId",
      "browserId",
      "tabId",
      "coordinationScope",
      "tabClaimEvidenceDigest",
      "canonicalThreadUrl",
      "conversationId",
      "userTurnBaselineDigest",
      "assistantTurnBaselineDigest",
      "configurationReceiptDigest",
      "evidenceProfile",
      "targetLifecycle",
      "newTargetAnchorDigest",
      "blankTaskEvidenceDigest",
      "targetEstablishment"
    ],
    ["providerId", "browserId", "tabId", "coordinationScope", "evidenceProfile"]
  );
  const target = value;
  assertExactRecord(
    target.evidenceProfile,
    "operation target evidence profile",
    ["providerIdentity", "stableTabId", "stableConversationId", "stableUserTurnId", "authoritativeTabClaim", "replacementTabRecovery"],
    ["providerIdentity", "stableTabId", "stableConversationId", "stableUserTurnId", "authoritativeTabClaim", "replacementTabRecovery"]
  );
  if (target.targetEstablishment !== void 0) assertTargetEstablishmentShape(target.targetEstablishment);
}
function assertTargetEstablishmentShape(value) {
  assertExactRecord(
    value,
    "operation target establishment",
    [
      "targetBindingDigest",
      "anchorDigest",
      "causalSendActionId",
      "conversationId",
      "canonicalThreadUrl",
      "userTurnId",
      "userTurnEvidenceDigest",
      "postSendDeltaDigest",
      "evidenceDigest",
      "observedAt"
    ],
    [
      "targetBindingDigest",
      "anchorDigest",
      "causalSendActionId",
      "conversationId",
      "canonicalThreadUrl",
      "userTurnId",
      "userTurnEvidenceDigest",
      "evidenceDigest",
      "observedAt"
    ]
  );
}
function assertOwnershipBaselineShape(value) {
  assertExactRecord(
    value,
    "operation ownership baseline",
    ["schemaVersion", "operationId", "requestDigest", "targetBindingDigest", "actionId", "baseline", "observedAt"],
    ["schemaVersion", "operationId", "requestDigest", "targetBindingDigest", "actionId", "baseline", "observedAt"]
  );
  if (value.schemaVersion !== OPERATION_OWNERSHIP_BASELINE_SCHEMA_VERSION) {
    throw new OperationStateError("unsupported_ownership_baseline", "Ownership baseline schemaVersion is unsupported.");
  }
  assertOperationId(value.operationId, "ownershipBaseline.operationId");
  assertDigest(value.requestDigest, "ownershipBaseline.requestDigest");
  assertDigest(value.targetBindingDigest, "ownershipBaseline.targetBindingDigest");
  assertOperationId(value.actionId, "ownershipBaseline.actionId");
  assertTimestamp(value.observedAt, "ownershipBaseline.observedAt");
  assertOwnershipBaselineSnapshotShape(value.baseline);
}
function assertOwnershipBaselineSnapshotShape(value) {
  assertExactRecord(
    value,
    "ownership baseline snapshot",
    ["schemaVersion", "snapshotDigest", "target", "userTurns", "assistantTurns", "completeness"],
    ["schemaVersion", "snapshotDigest", "target", "userTurns", "assistantTurns", "completeness"]
  );
  if (value.schemaVersion !== "chatgpt.browser_control.turn_ownership.v1" || value.completeness !== "complete") {
    throw new OperationStateError("invalid_ownership_baseline", "Ownership baseline must be a complete normalized snapshot.");
  }
  assertDigest(value.snapshotDigest, "ownershipBaseline.baseline.snapshotDigest");
  assertOwnershipTargetEvidenceShape(value.target, "ownershipBaseline.baseline.target");
  assertOwnershipTurnsShape(value.userTurns, "user", "ownershipBaseline.baseline.userTurns");
  assertOwnershipTurnsShape(value.assistantTurns, "assistant", "ownershipBaseline.baseline.assistantTurns");
}
function assertOwnershipTargetEvidenceShape(value, label) {
  assertExactRecord(
    value,
    label,
    ["provider", "browser", "tab", "thread", "conversation", "canonicalThreadUrl", "authoritativeTabClaim", "coordinationScope"],
    ["provider", "browser", "tab", "thread", "conversation", "canonicalThreadUrl", "authoritativeTabClaim", "coordinationScope"]
  );
  for (const key of ["provider", "browser", "tab", "thread", "conversation", "authoritativeTabClaim"]) {
    assertOwnershipIdentityEvidenceShape(value[key], `${label}.${key}`);
  }
  assertOwnershipIdentityEvidenceShape(value.canonicalThreadUrl, `${label}.canonicalThreadUrl`, true);
  if (value.coordinationScope !== "process" && value.coordinationScope !== "provider") {
    throw new OperationStateError("invalid_ownership_baseline", `${label}.coordinationScope is invalid.`);
  }
  if (value.coordinationScope === "provider" && value.authoritativeTabClaim.status !== "available") {
    throw new OperationStateError("invalid_ownership_baseline", `${label} requires provider claim evidence.`);
  }
}
function assertOwnershipIdentityEvidenceShape(value, label, allowUrl = false) {
  if (!isPlainRecord(value) || value.status !== "available" && value.status !== "unavailable") {
    throw new OperationStateError("invalid_ownership_baseline", `${label} availability is invalid.`);
  }
  if (value.status === "available") {
    assertExactRecord(value, label, ["status", "value"], ["status", "value"]);
    if (typeof value.value !== "string" || value.value.length < 1 || value.value.length > (allowUrl ? 4096 : 512) || /[\u0000-\u001f\u007f]/u.test(value.value)) {
      throw new OperationStateError("invalid_ownership_baseline", `${label}.value is not bounded evidence.`);
    }
    if (allowUrl) {
      let parsed;
      try {
        parsed = new URL(value.value);
      } catch {
        throw new OperationStateError("invalid_ownership_baseline", `${label}.value is not a URL.`);
      }
      if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
        throw new OperationStateError("invalid_ownership_baseline", `${label}.value is not a canonical HTTPS URL.`);
      }
    }
  } else {
    assertExactRecord(value, label, ["status", "reason"], ["status", "reason"]);
    if (value.reason !== "not_exposed" && value.reason !== "not_observed" && value.reason !== "redacted") {
      throw new OperationStateError("invalid_ownership_baseline", `${label}.reason is invalid.`);
    }
  }
}
function assertOwnershipTurnsShape(value, kind, label) {
  if (!Array.isArray(value) || value.length > MAX_BASELINE_TURNS) {
    throw new OperationStateError("invalid_ownership_baseline", `${label} exceeds the bounded turn limit.`);
  }
  const stableIds = /* @__PURE__ */ new Set();
  const evidence = /* @__PURE__ */ new Set();
  value.forEach((turnValue, index) => {
    assertExactRecord(
      turnValue,
      `${label}[${index}]`,
      ["stableId", "evidenceDigest", "structureDigest", "ordinal", "parentStableId", "branchStableId", "state", "artifactEvidenceDigests"],
      ["evidenceDigest", "structureDigest", "ordinal"]
    );
    if (turnValue.ordinal !== index) throw new OperationStateError("invalid_ownership_baseline", `${label} ordinals must be contiguous.`);
    assertDigest(turnValue.evidenceDigest, `${label}[${index}].evidenceDigest`);
    assertDigest(turnValue.structureDigest, `${label}[${index}].structureDigest`);
    if (turnValue.stableId !== void 0) {
      assertStableIdentifier(turnValue.stableId, `${label}[${index}].stableId`);
      if (stableIds.has(turnValue.stableId)) throw new OperationStateError("invalid_ownership_baseline", `${label} contains duplicate stable IDs.`);
      stableIds.add(turnValue.stableId);
    }
    if (kind === "user" && (turnValue.state !== void 0 || turnValue.parentStableId !== void 0 || turnValue.branchStableId !== void 0)) {
      throw new OperationStateError("invalid_ownership_baseline", "User baseline turns cannot carry assistant lineage.");
    }
    if (kind === "assistant" && turnValue.state !== "generating" && turnValue.state !== "terminal") {
      throw new OperationStateError("invalid_ownership_baseline", "Assistant baseline turns require a bounded state.");
    }
    if (turnValue.parentStableId !== void 0) assertStableIdentifier(turnValue.parentStableId, `${label}[${index}].parentStableId`);
    if (turnValue.branchStableId !== void 0) assertStableIdentifier(turnValue.branchStableId, `${label}[${index}].branchStableId`);
    const artifacts = turnValue.artifactEvidenceDigests ?? [];
    if (!Array.isArray(artifacts) || artifacts.length > MAX_BASELINE_ARTIFACTS_PER_TURN) {
      throw new OperationStateError("invalid_ownership_baseline", `${label}[${index}] artifacts exceed the bounded limit.`);
    }
    const artifactSet = /* @__PURE__ */ new Set();
    for (const artifact of artifacts) {
      assertDigest(artifact, `${label}[${index}].artifactEvidenceDigests[]`);
      if (artifactSet.has(artifact)) throw new OperationStateError("invalid_ownership_baseline", `${label}[${index}] has duplicate artifact evidence.`);
      artifactSet.add(artifact);
    }
    if (turnValue.stableId === void 0) {
      const turnEvidenceDigest = turnValue.evidenceDigest;
      if (evidence.has(turnEvidenceDigest)) throw new OperationStateError("invalid_ownership_baseline", `${label} has duplicate id-less evidence.`);
      evidence.add(turnEvidenceDigest);
    }
  });
}
function validateOwnershipBaselineValues(baseline, state) {
  if (baseline.operationId !== state.operationId || baseline.requestDigest !== state.requestDigest) throw new OperationStateError("ownership_baseline_identity_mismatch", "Ownership baseline operation identity does not match state.");
  const action = state.actions[baseline.actionId];
  if (action === void 0 || action.kind !== "send" && action.kind !== "work_steer") {
    throw new OperationStateError("ownership_baseline_action_missing", "Ownership baseline requires a durable Send or steer action intent.");
  }
  if (action.targetDigest !== baseline.targetBindingDigest) {
    throw new OperationStateError("ownership_baseline_target_mismatch", "Ownership baseline target does not match its causal action.");
  }
  const target = state.target;
  if (target === void 0) throw new OperationStateError("target_not_bound", "Ownership baseline requires a durable target binding.");
  const identity = (value) => value.status === "available" ? value.value : void 0;
  const fixedTarget = (target.targetLifecycle ?? "fixed") === "fixed";
  const baselineCanonicalThreadUrl = baseline.baseline.target.canonicalThreadUrl;
  const redactedWorkSteerUrl = action.kind === "work_steer" && baselineCanonicalThreadUrl.status === "unavailable" && baselineCanonicalThreadUrl.reason === "redacted";
  const canonicalThreadUrlMatches = !fixedTarget ? true : redactedWorkSteerUrl ? true : target.canonicalThreadUrl !== void 0 ? baselineCanonicalThreadUrl.status === "available" && baselineCanonicalThreadUrl.value === target.canonicalThreadUrl : action.kind !== "work_steer";
  if (identity(baseline.baseline.target.provider) !== target.providerId || identity(baseline.baseline.target.browser) !== target.browserId || identity(baseline.baseline.target.tab) !== target.tabId || baseline.baseline.target.coordinationScope !== target.coordinationScope || fixedTarget && target.conversationId !== void 0 && identity(baseline.baseline.target.conversation) !== target.conversationId || !canonicalThreadUrlMatches) {
    throw new OperationStateError("ownership_baseline_target_mismatch", "Ownership baseline target evidence disagrees with the durable target binding.");
  }
  const rejectedWorkSteer = action.kind === "work_steer" && action.outcome === "not_satisfied";
  if (action.outcome !== void 0 && action.outcome !== "satisfied" && !rejectedWorkSteer) {
    throw new OperationStateError("ownership_baseline_action_unproven", "Ownership baseline cannot follow an uncertain or rejected action.");
  }
  if (baseline.observedAt < action.intentAt) {
    throw new OperationStateError("ownership_baseline_before_action", "Ownership baseline cannot precede its causal action intent.");
  }
}
function assertActionIntentShape(value) {
  assertExactRecord(
    value,
    "operation action intent",
    ["actionId", "kind", "repeatPolicy", "requestDigest", "parentActionId", "targetDigest"],
    ["actionId", "kind", "repeatPolicy", "requestDigest"]
  );
}
function assertActionRecordShape(value) {
  assertExactRecord(
    value,
    "operation action record",
    [
      "actionId",
      "kind",
      "repeatPolicy",
      "requestDigest",
      "parentActionId",
      "targetDigest",
      "intentRevision",
      "intentAt",
      "outcome",
      "receiptRevision",
      "receiptAt",
      "evidenceDigest",
      "blockerCode"
    ],
    ["actionId", "kind", "repeatPolicy", "requestDigest", "intentRevision", "intentAt"]
  );
}
function assertBlockerObservationShape(value) {
  assertExactRecord(
    value,
    "operation blocker observation",
    ["code", "messageDigest", "recoverable", "observedAt"],
    ["code", "messageDigest", "recoverable", "observedAt"]
  );
}
function assertReceiptShape(value) {
  assertExactRecord(
    value,
    "operation receipt",
    [
      "schemaVersion",
      "operationId",
      "requestDigest",
      "targetBindingDigest",
      "userTurnId",
      "userTurnEvidenceDigest",
      "assistantTurnId",
      "ownershipEvidenceDigest",
      "responseDigest",
      "responseBytes",
      "responseFormat",
      "finishReason",
      "contentAvailable",
      "artifacts",
      "completedAt"
    ],
    [
      "schemaVersion",
      "operationId",
      "requestDigest",
      "targetBindingDigest",
      "userTurnId",
      "userTurnEvidenceDigest",
      "assistantTurnId",
      "ownershipEvidenceDigest",
      "finishReason",
      "contentAvailable",
      "artifacts",
      "completedAt"
    ]
  );
  const receipt = value;
  if (receipt.responseFormat !== void 0 && receipt.responseFormat !== "markdown" && receipt.responseFormat !== "text") {
    throw new OperationStateError("invalid_response_format", "Operation receipt responseFormat must be markdown or text.");
  }
  if (!Array.isArray(receipt.artifacts)) {
    throw new OperationStateError("invalid_operation_receipt", "Operation receipt artifacts must be an array.");
  }
  for (const artifact of receipt.artifacts) assertArtifactShape(artifact);
}
function assertArtifactShape(value) {
  assertExactRecord(
    value,
    "operation artifact receipt",
    [
      "schemaVersion",
      "operationId",
      "artifactKey",
      "assistantTurnId",
      "sourceIdentityDigest",
      "kind",
      "ordinal",
      "outputKey",
      "mimeType",
      "bytes",
      "sha256",
      "status",
      "blockerCode"
    ],
    ["schemaVersion", "operationId", "artifactKey", "assistantTurnId", "sourceIdentityDigest", "kind", "ordinal", "status"]
  );
}
function assertDurableCapturePolicyShape(value) {
  assertExactRecord(
    value,
    "operation durable capture policy",
    ["responseContent", "responseFormat", "artifacts"],
    ["responseContent", "responseFormat", "artifacts"]
  );
  const policy = value;
  for (const key of ["responseContent", "responseFormat", "artifacts"]) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(policy, key);
    } catch {
      throw new OperationStateError("invalid_operation_shape", "Operation durable capture policy could not be read safely.");
    }
    if (descriptor === void 0 || !("value" in descriptor) || descriptor.get !== void 0 || descriptor.set !== void 0) {
      throw new OperationStateError("invalid_operation_shape", "Operation durable capture policy contains an unsafe property.");
    }
  }
  if (policy.responseContent !== "include" && policy.responseContent !== "metadata") {
    throw new OperationStateError("invalid_capture_policy", "Operation durable capture responseContent is invalid.");
  }
  if (policy.responseFormat !== "markdown" && policy.responseFormat !== "text") {
    throw new OperationStateError("invalid_capture_policy", "Operation durable capture responseFormat is invalid.");
  }
  if (policy.artifacts !== "receipt_only" && policy.artifacts !== "transfer") {
    throw new OperationStateError("invalid_capture_policy", "Operation durable capture artifacts policy is invalid.");
  }
}
function assertExactRecord(value, label, allowed, required, allowUnknownUntilTypeDispatch = false) {
  if (!isPlainRecord(value)) {
    throw new OperationStateError("invalid_operation_shape", `${label} must be a plain object.`);
  }
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new OperationStateError("invalid_operation_shape", `${label} contains an unreadable property.`);
    }
    if (descriptor === void 0 || !Object.hasOwn(descriptor, "value") || descriptor.get !== void 0 || descriptor.set !== void 0) {
      throw new OperationStateError("invalid_operation_shape", `${label} contains an unsafe property (accessor).`);
    }
  }
  if (!allowUnknownUntilTypeDispatch) {
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) {
        throw new OperationStateError("unknown_operation_field", `${label} contains unsupported field ${key}.`);
      }
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new OperationStateError("missing_operation_field", `${label} is missing required field ${key}.`);
    }
  }
}
function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// src/operations/handle.ts
import { basename } from "node:path";
var DIGEST_PATTERN2 = /^hmac-sha256:[0-9a-f]{64}$/;
var SHA256_PATTERN2 = /^[0-9a-f]{64}$/;
var MAX_INPUT_FILES = 256;
var MAX_TOOLS = 256;
var MAX_PROMPT_BYTES = 8 * 1024 * 1024;
var MAX_JSON_DEPTH = 16;
var MAX_JSON_NODES = 1e4;
var MAX_JSON_KEYS = 1e4;
var MAX_JSON_STRING_BYTES = 8 * 1024 * 1024;
var MAX_JSON_KEY_BYTES = 4096;
var RESERVED_CANONICAL_KEYS2 = /* @__PURE__ */ new Set(["$undefined", "$date", "$bytes"]);
var activeSnapshots;
function withSnapshotContext(callback) {
  const previous = activeSnapshots;
  activeSnapshots = /* @__PURE__ */ new WeakMap();
  try {
    return callback();
  } finally {
    activeSnapshots = previous;
  }
}
var OperationHandleError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "OperationHandleError";
  }
  code;
};
function operationSubmitRequestDigest(key, request, files) {
  return withSnapshotContext(() => operationSubmitRequestDigestImpl(key, request, files));
}
function operationSubmitRequestDigestImpl(key, request, files) {
  if (!request || typeof request !== "object") {
    throw new OperationHandleError("invalid_operation_request", "Operation request must be an object.");
  }
  assertExactKeys(request, "operation request", [
    "schemaVersion",
    "operationId",
    "surface",
    "prompt",
    "target",
    "configuration",
    "files",
    "capture",
    "timeoutMs"
  ]);
  const operationId = readData(request, "operationId");
  const schemaVersion = readData(request, "schemaVersion");
  const surface = readData(request, "surface");
  const prompt = readData(request, "prompt");
  const target = readData(request, "target");
  const configuration = readData(request, "configuration");
  const capture = readData(request, "capture");
  const timeoutMs = readData(request, "timeoutMs");
  const requestedFilesValue = readData(request, "files");
  assertId(operationId, "operationId");
  if (schemaVersion !== OPERATION_REQUEST_SCHEMA_VERSION) {
    throw new OperationHandleError("unsupported_operation_request", "Operation request schemaVersion is unsupported.");
  }
  if (surface !== "chat" && surface !== "work") {
    throw new OperationHandleError("invalid_operation_surface", "Operation surface must be chat or work.");
  }
  if (typeof prompt !== "string") {
    throw new OperationHandleError("invalid_operation_prompt", "Operation prompt must be a string.");
  }
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new OperationHandleError("invalid_operation_prompt", "Operation prompt exceeds the bounded request limit.");
  }
  validateTargetRequest(target);
  validateConfigurationRequest(configuration);
  validateCapturePolicy(capture);
  validateTimeout(timeoutMs, "timeoutMs");
  const manifestEntries = readArrayEntries(files, "invalid_operation_file_manifest", "Operation file manifest", MAX_INPUT_FILES);
  if (manifestEntries.length > MAX_INPUT_FILES) {
    throw new OperationHandleError("invalid_operation_file_manifest", "Operation file manifest exceeds the bounded input-file limit.");
  }
  const requestedFiles = requestedFilesValue === void 0 ? [] : readArrayEntries(requestedFilesValue, "operation_file_manifest_mismatch", "Operation file request list", MAX_INPUT_FILES);
  if (requestedFiles.length > MAX_INPUT_FILES || requestedFiles.length !== manifestEntries.length) {
    throw new OperationHandleError("operation_file_manifest_mismatch", "Operation file manifest must match the request file list exactly.");
  }
  for (const [index, file] of manifestEntries.entries()) {
    assertExactKeys(file, "operation file manifest entry", ["displayName", "bytes", "contentSha256"], "invalid_operation_file_manifest");
    const displayName = readData(file, "displayName");
    const byteCount = readData(file, "bytes");
    const contentSha256 = readData(file, "contentSha256");
    if (typeof displayName !== "string" || displayName.length === 0 || displayName.length > 512 || /[\\/\u0000-\u001f\u007f]/u.test(displayName) || !Number.isSafeInteger(byteCount) || byteCount < 0 || typeof contentSha256 !== "string" || !SHA256_PATTERN2.test(contentSha256)) {
      throw new OperationHandleError("invalid_operation_file_manifest", "Operation file manifest contains invalid size or SHA-256 data.");
    }
    const requested = requestedFiles[index];
    assertExactKeys(requested, "operation file request", ["path", "displayName"], "invalid_operation_file_request");
    const requestedPath = readData(requested, "path");
    const requestedDisplayName = readData(requested, "displayName");
    if (typeof requestedPath !== "string" || requestedPath.length === 0 || requestedPath.length > 4096 || /[\u0000-\u001f\u007f]/u.test(requestedPath)) {
      throw new OperationHandleError("invalid_operation_file_request", "Operation file request requires a non-empty local path.");
    }
    if (requestedDisplayName !== void 0) validateBoundedString(requestedDisplayName, "files[].displayName");
    const expectedDisplayName = (requestedDisplayName ?? basename(requestedPath)).normalize("NFC");
    if (displayName !== expectedDisplayName) {
      throw new OperationHandleError("operation_file_manifest_mismatch", "Operation file manifest order or display name does not match the request.");
    }
  }
  return operationRequestDigest(key, {
    operationId,
    surface,
    target,
    prompt,
    configuration,
    tools: configuration === void 0 ? void 0 : readData(configuration, "tools"),
    files: manifestEntries,
    capturePolicy: capture,
    behavior: {
      // Timeout is deliberately absent: changing a local wait budget must not
      // turn the same user intent into a different durable operation.
      operationRequestSchemaVersion: schemaVersion
    }
  });
}
function operationControlRequestDigest(key, request) {
  return withSnapshotContext(() => operationControlRequestDigestImpl(key, request));
}
function operationControlRequestDigestImpl(key, request) {
  if (!request || typeof request !== "object") {
    throw new OperationHandleError("invalid_operation_control_request", "Operation control request must be an object.");
  }
  assertExactKeys(request, "operation control request", [
    "schemaVersion",
    "controlActionId",
    "parent",
    "action",
    "expectedAssistantTurnId",
    "steerPrompt",
    "timeoutMs"
  ]);
  const controlActionId = readData(request, "controlActionId");
  const schemaVersion = readData(request, "schemaVersion");
  const parent = readData(request, "parent");
  const action = readData(request, "action");
  const expectedAssistantTurnId = readData(request, "expectedAssistantTurnId");
  const steerPromptValue = readData(request, "steerPrompt");
  const timeoutMs = readData(request, "timeoutMs");
  assertId(controlActionId, "controlActionId");
  if (schemaVersion !== OPERATION_CONTROL_REQUEST_SCHEMA_VERSION) {
    throw new OperationHandleError("unsupported_operation_control_request", "Operation control schemaVersion is unsupported.");
  }
  validateHandleShape(parent);
  const parentRecord = parent;
  const parentPhase = readData(parentRecord, "phase");
  const parentTargetBindingDigest = readData(parentRecord, "targetBindingDigest");
  if (parentPhase !== "generating" || parentTargetBindingDigest === void 0) {
    throw new OperationHandleError(
      "invalid_operation_control_target",
      "Operation control requires a generating parent handle with an exact target binding."
    );
  }
  if (typeof expectedAssistantTurnId !== "string" || expectedAssistantTurnId.trim().length === 0 || expectedAssistantTurnId.length > 512) {
    throw new OperationHandleError("invalid_operation_control_target", "Operation control requires an exact assistant turn ID.");
  }
  if (action !== "stop" && action !== "steer") {
    throw new OperationHandleError("invalid_operation_control_request", "Operation control action must be stop or steer.");
  }
  if (action === "steer" && (typeof steerPromptValue !== "string" || steerPromptValue.length === 0)) {
    throw new OperationHandleError("invalid_operation_control_request", "A steer control requires steerPrompt.");
  }
  if (steerPromptValue !== void 0 && (typeof steerPromptValue !== "string" || Buffer.byteLength(steerPromptValue, "utf8") > MAX_PROMPT_BYTES)) {
    throw new OperationHandleError("invalid_operation_control_request", "steerPrompt exceeds the bounded request limit.");
  }
  if (action === "stop" && steerPromptValue !== void 0) {
    throw new OperationHandleError("invalid_operation_control_request", "A stop control must not include steerPrompt.");
  }
  validateTimeout(timeoutMs, "timeoutMs");
  const steerPrompt = steerPromptValue === void 0 ? void 0 : {
    digest: hmacDigest(key, "codex-chatgpt-control/control-steer-prompt/v1", steerPromptValue),
    bytes: Buffer.byteLength(steerPromptValue, "utf8")
  };
  const parentOperationId = readData(parentRecord, "operationId");
  const parentRequestDigest = readData(parentRecord, "requestDigest");
  return hmacDigest(key, "codex-chatgpt-control/operation-control-request/v1", {
    schemaVersion: OPERATION_CONTROL_REQUEST_SCHEMA_VERSION,
    controlActionId,
    parentOperationId,
    parentRequestDigest,
    parentTargetBindingDigest,
    expectedAssistantTurnId,
    action,
    steerPrompt
  });
}
function operationHandleFromState(key, state) {
  return withSnapshotContext(() => operationHandleFromStateImpl(key, state));
}
function operationHandleFromStateImpl(key, state) {
  const stateRecord = state;
  snapshotRecord(stateRecord, "operation state", "invalid_operation_handle");
  const operationId = readData(stateRecord, "operationId");
  const requestDigest = readData(stateRecord, "requestDigest");
  const surface = readData(stateRecord, "surface");
  const revision = readData(stateRecord, "revision");
  const phase = readData(stateRecord, "phase");
  const mutationBoundary = readData(stateRecord, "mutationBoundary");
  const target = readData(stateRecord, "target");
  const handle = {
    schemaVersion: OPERATION_HANDLE_SCHEMA_VERSION,
    operationId,
    requestDigest,
    surface,
    revision,
    phase,
    mutationBoundary
  };
  if (target !== void 0) {
    handle.targetBindingDigest = hmacDigest(
      key,
      "codex-chatgpt-control/operation-target-binding/v1",
      operationTargetBindingProjectionImpl(target)
    );
  }
  return handle;
}
function operationTargetBindingProjectionImpl(target) {
  const targetRecord = target;
  const values = snapshotRecord(targetRecord, "operation target", "invalid_operation_handle");
  const lifecycle = values.get("targetLifecycle") ?? "fixed";
  if (lifecycle !== "new_pending" && lifecycle !== "new_established") return target;
  const immutableAnchor = /* @__PURE__ */ Object.create(null);
  for (const [key, value] of values) {
    if (key === "targetLifecycle" || key === "canonicalThreadUrl" || key === "conversationId" || key === "targetEstablishment") continue;
    Object.defineProperty(immutableAnchor, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  const evidenceProfile = values.get("evidenceProfile");
  const evidenceValues = snapshotRecord(evidenceProfile, "operation target evidence profile", "invalid_operation_handle");
  const evidence = /* @__PURE__ */ Object.create(null);
  for (const [key, value] of evidenceValues) {
    Object.defineProperty(evidence, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return {
    targetLifecycle: "new",
    ...immutableAnchor,
    evidenceProfile: {
      ...evidence,
      // Provider conversation/user-turn availability is established after
      // Send and therefore is not part of the pre-Send action anchor.
      stableConversationId: "unavailable",
      stableUserTurnId: "unavailable"
    }
  };
}
function validateOperationHandle(key, handle, state) {
  return withSnapshotContext(() => validateOperationHandleImpl(key, handle, state));
}
function validateOperationHandleImpl(key, handle, state) {
  const stateRecord = state;
  snapshotRecord(stateRecord, "operation state", "invalid_operation_handle");
  const stateOperationId = readData(stateRecord, "operationId");
  const stateRequestDigest = readData(stateRecord, "requestDigest");
  const stateSurface = readData(stateRecord, "surface");
  const stateRevision = readData(stateRecord, "revision");
  const statePhase = readData(stateRecord, "phase");
  const stateMutationBoundary = readData(stateRecord, "mutationBoundary");
  validateHandleShape(handle);
  const handleOperationId = readData(handle, "operationId");
  const handleRequestDigest = readData(handle, "requestDigest");
  const handleSurface = readData(handle, "surface");
  const handleRevision = readData(handle, "revision");
  const handleBoundary = readData(handle, "mutationBoundary");
  const handlePhase = readData(handle, "phase");
  const handleTargetBindingDigest = readData(handle, "targetBindingDigest");
  if (handleOperationId !== stateOperationId || handleRequestDigest !== stateRequestDigest || handleSurface !== stateSurface) {
    throw new OperationHandleError("operation_handle_mismatch", "Operation handle does not match the durable operation binding.");
  }
  if (!Number.isSafeInteger(handleRevision) || handleRevision < 1) {
    throw new OperationHandleError("invalid_operation_handle", "Operation handle revision must be a positive safe integer.");
  }
  if (handleRevision > stateRevision) {
    throw new OperationHandleError("operation_handle_ahead", "Operation handle claims a revision newer than durable state.");
  }
  if (BOUNDARY_RANK2[handleBoundary] > BOUNDARY_RANK2[stateMutationBoundary]) {
    throw new OperationHandleError("operation_handle_state_mismatch", "Operation handle claims a mutation boundary ahead of durable state.");
  }
  if (handleRevision < stateRevision && !phaseCanReach(handlePhase, statePhase)) {
    throw new OperationHandleError("operation_handle_state_mismatch", "Operation handle phase cannot precede the current durable phase.");
  }
  const current = operationHandleFromStateImpl(key, state);
  if (handleTargetBindingDigest !== current.targetBindingDigest && !(handleTargetBindingDigest === void 0 && handleRevision < stateRevision)) {
    throw new OperationHandleError("operation_handle_target_mismatch", "Operation handle target binding does not match durable state.");
  }
  if (handleRevision === stateRevision && (handlePhase !== statePhase || handleBoundary !== stateMutationBoundary)) {
    throw new OperationHandleError("operation_handle_state_mismatch", "Operation handle state fields disagree at the same revision.");
  }
  return { stale: handleRevision < stateRevision, current };
}
var OPERATION_PHASES = /* @__PURE__ */ new Set([
  "prepared",
  "handoff_pending",
  "ready",
  "send_pending",
  "submitted",
  "generating",
  "capturing",
  "completed",
  "uncertain"
]);
var BOUNDARY_RANK2 = {
  none: 0,
  handoff_may_have_occurred: 1,
  send_may_have_occurred: 2,
  control_may_have_occurred: 3
};
var PHASE_EDGES = {
  prepared: ["handoff_pending", "ready", "uncertain"],
  handoff_pending: ["ready", "uncertain"],
  ready: ["send_pending", "uncertain"],
  send_pending: ["submitted", "uncertain"],
  submitted: ["generating", "capturing", "uncertain"],
  generating: ["capturing", "uncertain"],
  capturing: ["completed", "uncertain"],
  completed: [],
  uncertain: ["ready", "submitted", "generating", "capturing", "completed"]
};
function validateHandleShape(handle) {
  if (!handle || typeof handle !== "object") {
    throw new OperationHandleError("invalid_operation_handle", "Operation handle must be an object.");
  }
  assertExactKeys(handle, "operation handle", [
    "schemaVersion",
    "operationId",
    "requestDigest",
    "surface",
    "revision",
    "phase",
    "mutationBoundary",
    "targetBindingDigest"
  ]);
  const schemaVersion = readData(handle, "schemaVersion");
  const operationId = readData(handle, "operationId");
  const requestDigest = readData(handle, "requestDigest");
  const surface = readData(handle, "surface");
  const revision = readData(handle, "revision");
  const phase = readData(handle, "phase");
  const mutationBoundary = readData(handle, "mutationBoundary");
  const targetBindingDigest = readData(handle, "targetBindingDigest");
  if (schemaVersion !== OPERATION_HANDLE_SCHEMA_VERSION) {
    throw new OperationHandleError("unsupported_operation_handle", "Operation handle schemaVersion is unsupported.");
  }
  assertId(operationId, "operationId");
  if (typeof requestDigest !== "string" || !DIGEST_PATTERN2.test(requestDigest)) {
    throw new OperationHandleError("invalid_operation_handle", "Operation handle requestDigest is invalid.");
  }
  if (surface !== "chat" && surface !== "work") {
    throw new OperationHandleError("invalid_operation_handle", "Operation handle surface is invalid.");
  }
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new OperationHandleError("invalid_operation_handle", "Operation handle revision must be a positive safe integer.");
  }
  if (typeof phase !== "string" || !OPERATION_PHASES.has(phase) || typeof mutationBoundary !== "string" || !(mutationBoundary in BOUNDARY_RANK2)) {
    throw new OperationHandleError("invalid_operation_handle", "Operation handle progress fields are invalid.");
  }
  if (targetBindingDigest !== void 0 && (typeof targetBindingDigest !== "string" || !DIGEST_PATTERN2.test(targetBindingDigest))) {
    throw new OperationHandleError("invalid_operation_handle", "Operation handle targetBindingDigest is invalid.");
  }
}
function phaseCanReach(from, to) {
  if (from === to) return true;
  const seen = /* @__PURE__ */ new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of PHASE_EDGES[current]) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}
function validateTargetRequest(target) {
  snapshotRecord(target, "operation target", "invalid_operation_target");
  const type = readData(target, "type");
  if (typeof type !== "string") {
    throw new OperationHandleError("invalid_operation_target", "Operation target is invalid.");
  }
  if (type === "new" || type === "selected_tab") {
    assertExactKeys(target, "operation target", ["type"]);
    return;
  }
  if (type === "tab_id") {
    assertExactKeys(target, "operation target", ["type", "tabId"]);
    return validateBoundedString(readData(target, "tabId"), "target.tabId");
  }
  if (type === "conversation_id") {
    assertExactKeys(target, "operation target", ["type", "conversationId"]);
    return validateBoundedString(readData(target, "conversationId"), "target.conversationId");
  }
  if (type === "url") {
    assertExactKeys(target, "operation target", ["type", "url"]);
    const url = readData(target, "url");
    validateBoundedString(url, "target.url", 4096);
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new OperationHandleError("invalid_operation_target", "Operation URL target must be an absolute HTTP(S) URL.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:" || parsed.username !== "" || parsed.password !== "") {
      throw new OperationHandleError("invalid_operation_target", "Operation URL target must be HTTP(S) and contain no credentials.");
    }
    return;
  }
  throw new OperationHandleError(
    "invalid_operation_target",
    "Unsupported operation target type."
  );
}
function validateConfigurationRequest(configuration) {
  if (configuration === void 0) return;
  assertExactKeys(
    configuration,
    "operation configuration",
    ["experience", "model", "modelVersion", "reasoning", "mode", "tools", "additional"],
    "invalid_operation_configuration"
  );
  const experience = readData(configuration, "experience");
  const model = readData(configuration, "model");
  const modelVersion = readData(configuration, "modelVersion");
  const reasoning = readData(configuration, "reasoning");
  const mode = readData(configuration, "mode");
  const tools = readData(configuration, "tools");
  const additional = readData(configuration, "additional");
  if (experience !== void 0 && experience !== "chat" && experience !== "work") {
    throw new OperationHandleError("invalid_operation_configuration", "Configuration experience must be chat or work.");
  }
  for (const [label, value] of [
    ["model", model],
    ["modelVersion", modelVersion],
    ["reasoning", reasoning],
    ["mode", mode]
  ]) {
    if (value !== void 0) validateBoundedString(value, `configuration.${label}`);
  }
  if (tools !== void 0) {
    const entries = readArrayEntries(tools, "invalid_operation_configuration", "Configuration tools", MAX_TOOLS);
    if (entries.length > MAX_TOOLS) {
      throw new OperationHandleError("invalid_operation_configuration", "Configuration tools must be an array.");
    }
    for (const tool of entries) validateBoundedString(tool, "configuration.tools[]");
  }
  if (additional !== void 0) {
    validateJsonValue(additional, "configuration.additional");
  }
}
function validateCapturePolicy(capture) {
  if (capture === void 0) return;
  assertExactKeys(
    capture,
    "operation capture policy",
    ["responseContent", "responseFormat", "artifacts", "outputDirectory"],
    "invalid_operation_capture"
  );
  const responseContent = readData(capture, "responseContent");
  const responseFormat = readData(capture, "responseFormat");
  const artifacts = readData(capture, "artifacts");
  const outputDirectory = readData(capture, "outputDirectory");
  if (responseContent !== "include" && responseContent !== "metadata") {
    throw new OperationHandleError("invalid_operation_capture", "Capture responseContent is invalid.");
  }
  if (responseFormat !== void 0 && responseFormat !== "markdown" && responseFormat !== "text") {
    throw new OperationHandleError("invalid_operation_capture", "Capture responseFormat is invalid.");
  }
  if (artifacts !== "receipt_only" && artifacts !== "transfer") {
    throw new OperationHandleError("invalid_operation_capture", "Capture artifacts policy is invalid.");
  }
  if (outputDirectory !== void 0 && (typeof outputDirectory !== "string" || outputDirectory.length === 0 || outputDirectory.length > 4096 || /[\u0000-\u001f\u007f]/u.test(outputDirectory))) {
    throw new OperationHandleError("invalid_operation_capture", "Capture outputDirectory must be a non-empty path.");
  }
  if (artifacts === "transfer" && outputDirectory === void 0) {
    throw new OperationHandleError("invalid_operation_capture", "Artifact transfer requires outputDirectory.");
  }
  if (artifacts === "receipt_only" && outputDirectory !== void 0) {
    throw new OperationHandleError("invalid_operation_capture", "outputDirectory is only valid when artifacts are transferred.");
  }
}
function validateTimeout(value, label) {
  if (value !== void 0 && (!Number.isSafeInteger(value) || value < 0)) {
    throw new OperationHandleError("invalid_operation_timeout", `${label} must be a non-negative safe integer.`);
  }
}
function validateBoundedString(value, label, maxLength = 512) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new OperationHandleError("invalid_operation_request", `${label} must be a bounded non-empty string.`);
  }
}
function assertId(value, label) {
  if (typeof value !== "string") {
    throw new OperationHandleError("invalid_operation_id", `${label} is invalid.`);
  }
  try {
    assertOperationId(value, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${label} is invalid.`;
    throw new OperationHandleError("invalid_operation_id", message);
  }
}
function assertExactKeys(value, label, allowed, code = "invalid_operation_request") {
  const values = snapshotRecord(value, label, code);
  const allowedSet = new Set(allowed);
  for (const key of values.keys()) {
    if (!allowedSet.has(key)) {
      throw new OperationHandleError("invalid_operation_request", `${label} contains an unsupported field.`);
    }
  }
}
function validateJsonValue(value, label) {
  const budget = { nodes: 0, bytes: 0 };
  const active = /* @__PURE__ */ new WeakSet();
  const visit = (candidate, depth) => {
    budget.nodes += 1;
    if (budget.nodes > MAX_JSON_NODES) throw new OperationHandleError("invalid_operation_configuration", `${label} exceeds the bounded node limit.`);
    if (depth > MAX_JSON_DEPTH) throw new OperationHandleError("invalid_operation_configuration", `${label} exceeds the bounded nesting limit.`);
    if (candidate === null || typeof candidate === "boolean") return;
    if (typeof candidate === "string") {
      budget.bytes += Buffer.byteLength(candidate, "utf8");
      if (budget.bytes > MAX_JSON_STRING_BYTES) throw new OperationHandleError("invalid_operation_configuration", `${label} exceeds the bounded byte limit.`);
      return;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new OperationHandleError("invalid_operation_configuration", `${label} contains a non-finite number.`);
      return;
    }
    if (candidate === void 0 || typeof candidate !== "object") {
      throw new OperationHandleError("invalid_operation_configuration", `${label} contains an unsupported value.`);
    }
    let isArray = false;
    try {
      isArray = Array.isArray(candidate);
    } catch {
      throw new OperationHandleError("invalid_operation_configuration", `${label} contains an inaccessible value.`);
    }
    const object = candidate;
    if (active.has(object)) throw new OperationHandleError("invalid_operation_configuration", `${label} contains a cyclic value.`);
    active.add(object);
    try {
      if (isArray) {
        const entries = readArrayEntries(candidate, "invalid_operation_configuration", label, MAX_JSON_NODES);
        for (const entry of entries) visit(entry, depth + 1);
        return;
      }
      try {
        const values = snapshotRecord(candidate, label, "invalid_operation_configuration");
        for (const [key, entry] of values) {
          if (key.length > 256 || Buffer.byteLength(key, "utf8") > MAX_JSON_KEY_BYTES || /[\u0000-\u001f\u007f]/u.test(key) || RESERVED_CANONICAL_KEYS2.has(key)) {
            throw new OperationHandleError("invalid_operation_configuration", `${label} contains an invalid object key.`);
          }
          budget.bytes += Buffer.byteLength(key, "utf8");
          if (budget.bytes > MAX_JSON_STRING_BYTES) throw new OperationHandleError("invalid_operation_configuration", `${label} exceeds the bounded byte limit.`);
          visit(entry, depth + 1);
        }
        return;
      } catch (error) {
        if (error instanceof OperationHandleError && error.code === "invalid_operation_configuration") throw error;
        throw new OperationHandleError("invalid_operation_configuration", `${label} contains an unsupported value.`);
      }
    } finally {
      active.delete(object);
    }
  };
  visit(value, 0);
}
function snapshotRecord(value, label, code = "invalid_operation_request") {
  if (value === null || typeof value !== "object") {
    throw new OperationHandleError(code, `${label} must be a plain object.`);
  }
  const store = activeSnapshots;
  if (store === void 0) throw new OperationHandleError(code, "Operation data context is unavailable.");
  const cached = store.get(value);
  if (cached !== void 0) return cached;
  let prototype;
  let descriptors;
  let keys;
  try {
    if (Array.isArray(value)) throw new Error("array");
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    keys = Reflect.ownKeys(descriptors);
  } catch {
    throw new OperationHandleError(code, `${label} could not be inspected safely.`);
  }
  if (keys.length > MAX_JSON_KEYS) throw new OperationHandleError(code, `${label} exceeds the bounded key limit.`);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new OperationHandleError(code, `${label} must be a plain object.`);
  }
  const values = /* @__PURE__ */ new Map();
  for (const key of keys) {
    if (typeof key !== "string") {
      throw new OperationHandleError(code, `${label} contains an unsupported symbol field.`);
    }
    const descriptor = descriptorFromMap(descriptors, key, label, code);
    if (descriptor.get !== void 0 || descriptor.set !== void 0 || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new OperationHandleError(code, `${label} contains an unsafe property.`);
    }
    values.set(key, descriptor.value);
  }
  store.set(value, values);
  return values;
}
function readData(value, key) {
  const store = activeSnapshots;
  if (store === void 0) throw new OperationHandleError("invalid_operation_request", "Operation data context is unavailable.");
  const snapshot = store.get(value);
  if (snapshot !== void 0) return snapshot.get(key);
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    throw new OperationHandleError("invalid_operation_request", "Operation data could not be read safely.");
  }
  if (descriptor === void 0) return void 0;
  if (!("value" in descriptor) || descriptor.get !== void 0 || descriptor.set !== void 0) {
    throw new OperationHandleError("invalid_operation_request", "Operation data contains an unsafe property.");
  }
  return descriptor.value;
}
function readArrayEntries(value, code, label, maxLength) {
  if (value === null || typeof value !== "object") {
    throw new OperationHandleError(code, `${label} must be an array.`);
  }
  let isArray = false;
  let prototype;
  let descriptors;
  let keys;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    keys = Reflect.ownKeys(descriptors);
  } catch {
    throw new OperationHandleError(code, `${label} could not be inspected safely.`);
  }
  if (!isArray || prototype !== Array.prototype) throw new OperationHandleError(code, `${label} must be a standard array.`);
  const lengthDescriptor = descriptorFromMap(descriptors, "length", label, code);
  if (!("value" in lengthDescriptor) || lengthDescriptor.get !== void 0 || lengthDescriptor.set !== void 0 || typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > maxLength || lengthDescriptor.enumerable !== false || lengthDescriptor.configurable !== false) {
    throw new OperationHandleError(code, `${label} contains an invalid length.`);
  }
  const length = lengthDescriptor.value;
  if (keys.length !== length + 1) throw new OperationHandleError(code, `${label} must not be sparse or custom.`);
  for (const key of keys) {
    if (typeof key !== "string" || key !== "length" && parseArrayIndex2(key) === void 0) {
      throw new OperationHandleError(code, `${label} must not contain custom fields.`);
    }
  }
  const entries = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptorFromMap(descriptors, String(index), label, code);
    if (!("value" in descriptor) || descriptor.get !== void 0 || descriptor.set !== void 0 || descriptor.enumerable !== true) {
      throw new OperationHandleError(code, `${label} contains an unsafe entry.`);
    }
    entries.push(descriptor.value);
  }
  return entries;
}
function descriptorFromMap(descriptors, key, label, code = "invalid_operation_request") {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(descriptors, key);
  } catch {
    throw new OperationHandleError(code, `${label} could not be inspected safely.`);
  }
  if (descriptor === void 0 || !("value" in descriptor)) {
    throw new OperationHandleError(code, `${label} contains an invalid property.`);
  }
  return descriptor.value;
}
function parseArrayIndex2(key) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) return void 0;
  const index = Number(key);
  if (!Number.isSafeInteger(index) || index < 0 || index > 4294967294 || String(index) !== key) return void 0;
  return index;
}

// src/operations/journal.ts
var KEY_BYTES = 32;
var KEY_FILE = "journal.key";
var LOG_DIRECTORY = "logs";
var LOCK_DIRECTORY = "locks";
var TERMINAL_DIRECTORY = "terminals";
var SNAPSHOT_DIRECTORY = "snapshots";
var TOMBSTONE_DIRECTORY = "tombstones";
var TRACKED_STATE_DIRECTORIES = [
  LOG_DIRECTORY,
  TERMINAL_DIRECTORY,
  SNAPSHOT_DIRECTORY,
  TOMBSTONE_DIRECTORY
];
var QUOTA_LOCK_FILE = "quota-admission.lock";
var QUOTA_COUNTER_FILE = "quota-state.json";
var LOCK_RECOVERY_SUFFIX = ".reclaim";
var TERMINAL_SCHEMA_VERSION = "chatgpt.browser_control.operation_terminal.v1";
var TOMBSTONE_SCHEMA_VERSION = "chatgpt.browser_control.operation_tombstone.v1";
var QUOTA_COUNTER_SCHEMA_VERSION = "chatgpt.browser_control.operation_quota_state.v1";
var GENESIS_EVENT_DIGEST = `hmac-sha256:${"0".repeat(64)}`;
var DEFAULT_MAX_STATE_BYTES = 64 * 1024 * 1024;
var MAX_SINGLE_RECORD_FILE_BYTES = 64 * 1024 * 1024;
var MAX_LOCK_RECORD_BYTES = 8 * 1024;
var DEFAULT_LOCK_TIMEOUT_MS = 1e4;
var MAX_QUOTA_SCAN_ENTRIES = 65536;
var MAX_QUOTA_SCAN_BYTES = 256 * 1024 * 1024;
var LOCK_RETRY_MS = 10;
var POSIX_DIRECTORY_MODE = 448;
var POSIX_FILE_MODE = 384;
var EVIDENCE_DOMAIN_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
var MAX_EVIDENCE_MATERIAL_BYTES = 8 * 1024 * 1024;
var UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
var MAX_TIMESTAMP_MS = 864e13;
var inProcessQueues = /* @__PURE__ */ new Map();
var OperationJournalError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "OperationJournalError";
  }
  code;
};
var OperationJournal = class _OperationJournal {
  constructor(stateRoot, key, clock, entropy, options) {
    this.key = key;
    this.clock = clock;
    this.entropy = entropy;
    this.stateRoot = stateRoot;
    this.maxStateBytes = options.maxStateBytes ?? DEFAULT_MAX_STATE_BYTES;
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    this.faultInjector = options.faultInjector;
  }
  key;
  clock;
  entropy;
  stateRoot;
  maxStateBytes;
  lockTimeoutMs;
  faultInjector;
  /** Compute immutable request identity inside the journal key domain. */
  submitRequestDigest(request, files) {
    return operationSubmitRequestDigest(this.key, request, files);
  }
  /** Compute child control identity inside the same stable key domain. */
  controlRequestDigest(request) {
    return operationControlRequestDigest(this.key, request);
  }
  /**
   * Derive privacy-preserving evidence in the stable journal key domain.
   * Callers receive only the HMAC, never the state-root key.  The bounded,
   * explicit domain keeps unrelated evidence classes cryptographically
   * separated while allowing browser adapters to avoid bare hashes of user
   * content.
   */
  evidenceDigest(domain, material) {
    if (!EVIDENCE_DOMAIN_PATTERN.test(domain)) {
      throw new OperationJournalError("invalid_evidence_domain", "Evidence domain must be a bounded canonical label.");
    }
    let encoded;
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
  handleFromState(state) {
    return operationHandleFromState(this.key, state);
  }
  /** Reconcile a caller locator with freshly loaded durable state. */
  validateHandle(handle, state) {
    return validateOperationHandle(this.key, handle, state);
  }
  static async open(options = {}) {
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
    const journal = new _OperationJournal(canonicalRoot, key, clock, entropy, options);
    await journal.ensureQuotaCounter();
    return journal;
  }
  async create(event) {
    try {
      return await this.append(event.operationId, 0, event);
    } catch (error) {
      if (error instanceof OperationJournalError && error.code === "revision_conflict") {
        return await this.load(event.operationId, event.requestDigest);
      }
      throw error;
    }
  }
  async append(operationId, expectedRevision, event) {
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
        const priorEvents = parsed.envelopes.map((envelope2) => envelope2.event);
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
        const envelope = {
          schemaVersion: OPERATION_EVENT_SCHEMA_VERSION,
          revision,
          previousEventDigest,
          eventDigest,
          event: storedEvent
        };
        const encoded = Buffer.from(`${canonicalJson(envelope)}
`, "utf8");
        const persist = () => appendRecord({
          logPath,
          encoded,
          committedBytes: parsed.committedBytes,
          partialTailBytes: parsed.partialTailBytes,
          createExclusive: !parsed.exists,
          syncParent: expectedRevision === 0,
          inject: (point) => this.inject(point)
        });
        const byteDelta = encoded.byteLength - parsed.partialTailBytes;
        await this.mutateQuotaTrackedState(
          async () => {
            await persist();
            return {
              value: void 0,
              byteDelta,
              entryDelta: parsed.exists ? 0 : 1
            };
          },
          expectedRevision === 0 ? (counter) => this.assertQuotaForNewOperation(counter, Math.max(0, byteDelta)) : void 0
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
  async load(operationId, expectedRequestDigest) {
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
    result.catch(() => void 0);
    return result;
  }
  /**
   * Rebuilds the materialized snapshot cache from authoritative journal state.
   * A snapshot is never used as a substitute for the authenticated log or
   * terminal record, so a damaged cache can always be safely overwritten.
   */
  async refreshSnapshot(operationId) {
    assertOperationId(operationId);
    const lockPath = this.operationLockPath(operationId);
    return serializeInProcess(lockPath, async () => {
      const lock = await acquireLock(lockPath, this.lockTimeoutMs, this.clock, this.entropy);
      try {
        const loaded = await this.loadLocked(operationId);
        const lastEventDigest = loaded.lastEventDigest ?? loaded.envelopes.at(-1)?.eventDigest;
        if (lastEventDigest === void 0) {
          throw corrupt("Authoritative operation state has no final event digest.");
        }
        const snapshot = {
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
            (point) => this.inject(point),
            true
          );
          const afterBytes = await fileSize(snapshotPath);
          return {
            value: void 0,
            byteDelta: afterBytes - (beforeBytes ?? 0),
            entryDelta: beforeBytes === void 0 ? 1 : 0
          };
        });
        return snapshot;
      } finally {
        await releaseLock(lock);
      }
    });
  }
  /** Reads and authenticates a snapshot cache without treating it as authority. */
  async readSnapshot(operationId) {
    assertOperationId(operationId);
    const snapshotPath = this.snapshotPath(operationId);
    const snapshot = await readAuthenticatedFile(
      snapshotPath,
      this.key,
      "codex-chatgpt-control/operation-snapshot/v1",
      "snapshotDigest",
      "journal_snapshot_corrupt"
    );
    if (!hasExactKeys(snapshot, ["schemaVersion", "lastEventDigest", "state", "snapshotDigest"]) || snapshot.schemaVersion !== OPERATION_SCHEMA_VERSION || !isDigest(snapshot.lastEventDigest) || !isRecord(snapshot.state) || snapshot.state.operationId !== operationId || !Number.isSafeInteger(snapshot.state.revision)) {
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
  async compactCompleted(operationId) {
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
  async pruneReceipt(operationId) {
    assertOperationId(operationId);
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
          const tombstone2 = await readTombstone(tombstonePath, this.key);
          let deletedTerminalBytes = 0;
          if (await pathExists(terminalPath)) {
            const terminal2 = await readTerminal(terminalPath, this.key);
            assertSameIdentity(tombstone2.operationId, tombstone2.requestDigest, terminal2.operationId, terminal2.requestDigest);
            deletedTerminalBytes = await this.removeQuotaTrackedFile(terminalPath);
          }
          const snapshotPath2 = this.snapshotPath(operationId);
          const deletedSnapshotBytes = await this.removeQuotaTrackedFile(snapshotPath2);
          return {
            status: "already_pruned",
            operationId: tombstone2.operationId,
            requestDigest: tombstone2.requestDigest,
            deletedTerminalBytes,
            deletedSnapshotBytes
          };
        }
        const terminal = await readTerminal(terminalPath, this.key);
        const tombstone = {
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
            (point) => this.inject(point),
            false
          );
          const afterBytes = await fileSize(tombstonePath);
          return {
            value: void 0,
            byteDelta: afterBytes - (beforeBytes ?? 0),
            entryDelta: beforeBytes === void 0 ? 1 : 0
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
  async purgeTombstone(operationId, options) {
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
          const state = reduceSafely(parsed.envelopes.map((envelope) => envelope.event));
          assertCompletedState(state, operationId);
          if (state.requestDigest !== tombstone.requestDigest) throw corrupt("Tombstone and log identity do not match.");
        }
        const paths = [
          ["tombstone", tombstonePath],
          ["terminal", terminalPath],
          ["snapshot", this.snapshotPath(operationId)],
          ["log", logPath]
        ];
        const deleted = [];
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
  operationLogPath(operationId) {
    const stem = this.operationStem(operationId);
    return childPath(this.stateRoot, LOG_DIRECTORY, `${stem}.jsonl`);
  }
  operationLockPath(operationId) {
    const stem = this.operationStem(operationId);
    return childPath(this.stateRoot, LOCK_DIRECTORY, `${stem}.lock`);
  }
  quotaLockPath() {
    return childPath(this.stateRoot, LOCK_DIRECTORY, QUOTA_LOCK_FILE);
  }
  quotaCounterPath() {
    return childPath(this.stateRoot, QUOTA_COUNTER_FILE);
  }
  terminalPath(operationId) {
    const stem = this.operationStem(operationId);
    return childPath(this.stateRoot, TERMINAL_DIRECTORY, `${stem}.terminal.json`);
  }
  snapshotPath(operationId) {
    const stem = this.operationStem(operationId);
    return childPath(this.stateRoot, SNAPSHOT_DIRECTORY, `${stem}.snapshot.json`);
  }
  tombstonePath(operationId) {
    const stem = this.operationStem(operationId);
    return childPath(this.stateRoot, TOMBSTONE_DIRECTORY, `${stem}.tombstone.json`);
  }
  operationStem(operationId) {
    return hmacDigest(this.key, "codex-chatgpt-control/operation-path/v1", operationId).slice("hmac-sha256:".length);
  }
  async loadLocked(operationId, expectedRequestDigest) {
    const tombstonePath = this.tombstonePath(operationId);
    if (await pathExists(tombstonePath)) {
      const tombstone = await readTombstone(tombstonePath, this.key);
      if (expectedRequestDigest !== void 0 && tombstone.requestDigest !== expectedRequestDigest) {
        throw new OperationJournalError(
          "operation_request_mismatch",
          "The operation ID already exists with a different immutable request digest."
        );
      }
      const terminalPath2 = this.terminalPath(operationId);
      if (await pathExists(terminalPath2)) {
        const terminal = await readTerminal(terminalPath2, this.key);
        assertSameIdentity(tombstone.operationId, tombstone.requestDigest, terminal.operationId, terminal.requestDigest);
      }
      const logPath = this.operationLogPath(operationId);
      if (await pathExists(logPath)) {
        const parsed2 = await readLog(logPath, this.key, false);
        const state2 = reduceSafely(parsed2.envelopes.map((envelope) => envelope.event));
        assertCompletedState(state2, operationId);
        if (state2.requestDigest !== tombstone.requestDigest) throw corrupt("Tombstone and log identity do not match.");
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
      if (expectedRequestDigest !== void 0 && terminal.requestDigest !== expectedRequestDigest) {
        throw new OperationJournalError(
          "operation_request_mismatch",
          "The operation ID already exists with a different immutable request digest."
        );
      }
      const logPath = this.operationLogPath(operationId);
      if (await pathExists(logPath)) {
        const parsed2 = await readLog(logPath, this.key, false);
        reconcileTerminalWithLog(terminal, parsed2, operationId);
        return { ...parsed2, state: terminal.state, lastEventDigest: terminal.lastEventDigest };
      }
      return terminalLoaded(terminal);
    }
    const parsed = await readLog(this.operationLogPath(operationId), this.key, false);
    if (parsed.envelopes.length === 0) {
      throw new OperationJournalError("operation_not_found", "No durable operation exists for this operation ID.");
    }
    const state = reduceSafely(parsed.envelopes.map((envelope) => envelope.event));
    if (state.operationId !== operationId) {
      throw new OperationJournalError("operation_binding_mismatch", "The operation log is bound to a different operation ID.");
    }
    if (expectedRequestDigest !== void 0 && state.requestDigest !== expectedRequestDigest) {
      throw new OperationJournalError(
        "operation_request_mismatch",
        "The operation ID already exists with a different immutable request digest."
      );
    }
    const lastEventDigest = parsed.envelopes.at(-1)?.eventDigest;
    if (lastEventDigest === void 0) throw corrupt("Operation log has no final event digest.");
    return { ...parsed, state, lastEventDigest };
  }
  async assertNoTerminalOrTombstoneForAppend(operationId, expectedRevision) {
    const tombstonePath = this.tombstonePath(operationId);
    if (await pathExists(tombstonePath)) {
      throw new OperationJournalError(
        "operation_receipt_expired",
        "The operation receipt was explicitly pruned; its durable tombstone remains."
      );
    }
    const terminalPath = this.terminalPath(operationId);
    if (!await pathExists(terminalPath)) return;
    const terminal = await readTerminal(terminalPath, this.key);
    if (expectedRevision === 0) {
      throw new OperationJournalError("revision_conflict", "The operation already has a durable terminal record.");
    }
    throw new OperationJournalError(
      "operation_compacted",
      `The completed operation is compacted at revision ${terminal.revision}; its terminal receipt is immutable.`
    );
  }
  async compactCompletedLocked(operationId) {
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
      const terminal2 = await readTerminal(terminalPath, this.key);
      if (await pathExists(logPath)) {
        const parsed2 = await readLog(logPath, this.key, false);
        reconcileTerminalWithLog(terminal2, parsed2, operationId);
        const deletedLogBytes2 = await this.removeQuotaTrackedFile(
          logPath,
          () => this.inject("after_log_deleted")
        );
        return {
          status: "already_compacted",
          operationId: terminal2.operationId,
          requestDigest: terminal2.requestDigest,
          revision: terminal2.revision,
          lastEventDigest: terminal2.lastEventDigest,
          deletedLogBytes: deletedLogBytes2
        };
      }
      assertCompletedState(terminal2.state, operationId);
      return {
        status: "already_compacted",
        operationId: terminal2.operationId,
        requestDigest: terminal2.requestDigest,
        revision: terminal2.revision,
        lastEventDigest: terminal2.lastEventDigest,
        deletedLogBytes: 0
      };
    }
    const parsed = await readLog(logPath, this.key, false);
    if (parsed.envelopes.length === 0) throw new OperationJournalError("operation_not_found", "No durable operation exists for this operation ID.");
    const state = reduceSafely(parsed.envelopes.map((envelope) => envelope.event));
    assertCompletedState(state, operationId);
    const lastEventDigest = parsed.envelopes.at(-1)?.eventDigest;
    if (lastEventDigest === void 0) throw corrupt("Completed operation has no final event digest.");
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
        (point) => this.inject(point),
        false
      );
      const afterBytes = await fileSize(terminalPath);
      return {
        value: void 0,
        byteDelta: afterBytes - (beforeBytes ?? 0),
        entryDelta: beforeBytes === void 0 ? 1 : 0
      };
    });
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
  async ensureQuotaCounter() {
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
  async mutateQuotaTrackedState(mutation2, preflight) {
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
          const result = await mutation2();
          assertQuotaDelta(result.byteDelta, "byteDelta");
          assertQuotaDelta(result.entryDelta, "entryDelta");
          const totalBytes = dirty.totalBytes + result.byteDelta;
          const entryCount = dirty.entryCount + result.entryDelta;
          if (!Number.isSafeInteger(totalBytes) || totalBytes < 0 || !Number.isSafeInteger(entryCount) || entryCount < 0) {
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
          try {
            await this.rebuildQuotaCounter(nextQuotaRevision(dirty.revision));
          } catch {
          }
          throw error;
        }
      } finally {
        await releaseLock(quotaLock);
      }
    });
  }
  async removeQuotaTrackedFile(path, afterDelete) {
    return await this.mutateQuotaTrackedState(async () => {
      const beforeBytes = await optionalFileSize(path);
      if (beforeBytes === void 0) {
        return { value: 0, byteDelta: 0, entryDelta: 0 };
      }
      await unlink(path);
      await syncDirectory(dirname(path));
      await afterDelete?.();
      return { value: beforeBytes, byteDelta: -beforeBytes, entryDelta: -1 };
    });
  }
  async loadCurrentQuotaCounter() {
    const path = this.quotaCounterPath();
    if (!await pathExists(path)) return await this.rebuildQuotaCounter(1);
    const counter = await readQuotaCounter(path, this.key);
    if (counter.dirty) return await this.rebuildQuotaCounter(nextQuotaRevision(counter.revision));
    const currentDirectories = await readQuotaDirectoryFingerprints(this.stateRoot);
    if (!sameQuotaDirectoryFingerprints(counter.directories, currentDirectories)) {
      return await this.rebuildQuotaCounter(nextQuotaRevision(counter.revision));
    }
    return counter;
  }
  async rebuildQuotaCounter(revision) {
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
  assertQuotaForNewOperation(counter, additionalBytes) {
    const total = counter.totalBytes;
    if (counter.entryCount > MAX_QUOTA_SCAN_ENTRIES || total > MAX_QUOTA_SCAN_BYTES || !Number.isSafeInteger(additionalBytes) || additionalBytes < 0 || additionalBytes > MAX_QUOTA_SCAN_BYTES - total) {
      throw new OperationJournalError("journal_scan_limit", "Operation journal quota scan exceeded its hard byte limit.");
    }
    if (total + additionalBytes > this.maxStateBytes) {
      throw new OperationJournalError(
        "journal_quota_exceeded",
        "Operation journal quota is exhausted; existing safety evidence was preserved."
      );
    }
  }
  async inject(point) {
    await this.faultInjector?.(point);
  }
};
var JOURNAL_RUNTIME_UNAVAILABLE_MESSAGE = "Transactional operations require a Node host with process identity, file ownership, and process liveness APIs. This host cannot safely open the operation journal.";
function requireJournalRuntime(probeLiveness = false) {
  try {
    if (typeof process === "undefined" || !Number.isSafeInteger(process.pid) || process.pid <= 0 || typeof process.kill !== "function" || typeof process.env !== "object" || process.env === null) {
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
function defaultOperationStateRoot() {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "codex-chatgpt-control", "operations-v1");
  }
  if (platform() === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData !== void 0 && isAbsolute(localAppData)) {
      return join(localAppData, "codex-chatgpt-control", "operations-v1");
    }
    return join(homedir(), "AppData", "Local", "codex-chatgpt-control", "operations-v1");
  }
  const xdgState = process.env.XDG_STATE_HOME;
  if (xdgState !== void 0 && isAbsolute(xdgState)) {
    return join(xdgState, "codex-chatgpt-control", "operations-v1");
  }
  return join(homedir(), ".local", "state", "codex-chatgpt-control", "operations-v1");
}
function journalEventDigest(key, revision, previousEventDigest, event) {
  return hmacDigest(key, "codex-chatgpt-control/operation-event/v1", {
    schemaVersion: OPERATION_EVENT_SCHEMA_VERSION,
    revision,
    previousEventDigest,
    event
  });
}
function makeTerminalRecord(key, state, lastEventDigest) {
  assertCompletedState(state, state.operationId);
  const receipt = state.receipt;
  if (receipt === void 0) throw corrupt("Completed operation has no terminal receipt.");
  const copiedReceipt = jsonRoundTrip(receipt);
  const ownershipEvidenceDigests = terminalOwnershipEvidenceDigests(state);
  const terminal = {
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
function assertCompletedState(state, operationId) {
  if (state.operationId !== operationId) throw corrupt("Terminal state operation identity does not match its path.");
  if (state.phase !== "completed" || state.receipt === void 0) {
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
function assertSameIdentity(leftOperationId, leftRequestDigest, rightOperationId, rightRequestDigest) {
  if (leftOperationId !== rightOperationId || leftRequestDigest !== rightRequestDigest) {
    throw corrupt("Durable operation records disagree about immutable identity.");
  }
}
function terminalLoaded(terminal) {
  return {
    state: jsonRoundTrip(terminal.state),
    envelopes: [],
    committedBytes: 0,
    partialTailBytes: 0,
    lastEventDigest: terminal.lastEventDigest
  };
}
function reconcileTerminalWithLog(terminal, parsed, operationId) {
  if (parsed.envelopes.length === 0) throw corrupt("Terminal record has an empty authoritative log beside it.");
  const state = reduceSafely(parsed.envelopes.map((envelope) => envelope.event));
  assertCompletedState(state, operationId);
  const lastEventDigest = parsed.envelopes.at(-1)?.eventDigest;
  if (terminal.operationId !== state.operationId || terminal.requestDigest !== state.requestDigest || terminal.revision !== state.revision || terminal.lastEventDigest !== lastEventDigest || canonicalJson(terminal.state) !== canonicalJson(state)) {
    throw corrupt("Durable terminal record and operation log disagree.");
  }
}
async function readTerminal(path, key) {
  const value = await readAuthenticatedFile(
    path,
    key,
    "codex-chatgpt-control/operation-terminal/v1",
    "terminalDigest",
    "journal_terminal_corrupt"
  );
  if (!hasExactKeys(value, [
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
  ]) || value.schemaVersion !== TERMINAL_SCHEMA_VERSION || typeof value.operationId !== "string" || typeof value.requestDigest !== "string" || !Number.isSafeInteger(value.revision) || value.revision <= 0 || !isDigest(value.lastEventDigest) || !isRecord(value.state) || !isRecord(value.receipt) || !Array.isArray(value.artifactManifest) || !Array.isArray(value.ownershipEvidenceDigests)) {
    throw corrupt("Authenticated terminal record has an invalid shape.");
  }
  assertOperationId(value.operationId);
  if (!isDigest(value.requestDigest)) throw corrupt("Authenticated terminal request digest is invalid.");
  const state = value.state;
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
  if (state.receipt === void 0 || canonicalJson(state.receipt.artifacts) !== canonicalJson(value.artifactManifest)) {
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
function terminalOwnershipEvidenceDigests(state) {
  const receipt = state.receipt;
  if (receipt === void 0) throw corrupt("Completed operation has no terminal receipt.");
  const witnesses = [
    ...Object.values(state.submissionWitnesses ?? {}),
    ...state.submissionWitness === void 0 ? [] : [state.submissionWitness]
  ];
  const baselines = [
    ...Object.values(state.ownershipBaselines ?? {}),
    ...state.ownershipBaseline === void 0 ? [] : [state.ownershipBaseline]
  ];
  return Array.from(/* @__PURE__ */ new Set([
    receipt.userTurnEvidenceDigest,
    receipt.ownershipEvidenceDigest,
    ...witnesses.flatMap((witness) => [
      witness.baselineSnapshotDigest,
      witness.postSendDeltaDigest,
      witness.operationUserEvidenceDigest
    ]),
    ...baselines.flatMap((baseline) => [
      baseline.targetBindingDigest,
      baseline.baseline.snapshotDigest
    ]),
    ...Object.values(state.actions).map((action) => action.evidenceDigest).filter((digest) => digest !== void 0)
  ])).sort();
}
async function readTombstone(path, key) {
  const value = await readAuthenticatedFile(
    path,
    key,
    "codex-chatgpt-control/operation-tombstone/v1",
    "tombstoneDigest",
    "journal_tombstone_corrupt"
  );
  if (!hasExactKeys(value, ["schemaVersion", "operationId", "requestDigest", "tombstoneDigest"]) || value.schemaVersion !== TOMBSTONE_SCHEMA_VERSION || typeof value.operationId !== "string" || !isDigest(value.requestDigest)) {
    throw corrupt("Authenticated tombstone has an invalid shape.");
  }
  assertOperationId(value.operationId);
  return value;
}
async function writeAuthenticatedAtomic(path, value, key, domain, digestField, entropy, inject, replaceExisting) {
  const withDigest = {
    ...value,
    [digestField]: hmacDigest(key, domain, withoutField(value, digestField))
  };
  await writeAtomicJson(path, withDigest, entropy, inject, replaceExisting);
}
async function readAuthenticatedFile(path, key, domain, digestField, errorCode) {
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
  let raw;
  try {
    const metadata = await assertSecureFileHandle(handle, path);
    if (!Number.isSafeInteger(metadata.size) || metadata.size > MAX_SINGLE_RECORD_FILE_BYTES) {
      throw new OperationJournalError(errorCode, "Authenticated operation record exceeds its hard safety limit.");
    }
    raw = await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
  let value;
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
  return value;
}
async function readQuotaCounter(path, key) {
  const value = await readAuthenticatedFile(
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
  ]) || value.schemaVersion !== QUOTA_COUNTER_SCHEMA_VERSION || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 0 || !Number.isSafeInteger(value.entryCount) || value.entryCount < 0 || typeof value.dirty !== "boolean" || !isDigest(value.counterDigest) || !isQuotaDirectoryFingerprintRecord(value.directories)) {
    throw new OperationJournalError(
      "journal_quota_counter_corrupt",
      "Authenticated operation quota state has an invalid shape."
    );
  }
  return value;
}
async function writeQuotaCounter(path, material, key, entropy) {
  const withoutDigest = withoutField(material, "counterDigest");
  const value = {
    ...withoutDigest,
    counterDigest: hmacDigest(
      key,
      "codex-chatgpt-control/operation-quota-state/v1",
      withoutDigest
    )
  };
  await writeAtomicJson(path, value, entropy, async () => void 0, true);
  return value;
}
async function readQuotaDirectoryFingerprints(stateRoot) {
  const entries = await Promise.all(TRACKED_STATE_DIRECTORIES.map(async (directoryName) => {
    const path = childPath(stateRoot, directoryName);
    const metadata = await lstat(path, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new OperationJournalError("unsafe_state_root", "Operation state path is not a secure directory.");
    }
    assertOwnerAndMode(metadata, path, POSIX_DIRECTORY_MODE);
    const fingerprint = {
      device: String(metadata.dev),
      inode: String(metadata.ino),
      modifiedNs: String(metadata.mtimeNs),
      changedNs: String(metadata.ctimeNs)
    };
    return [directoryName, fingerprint];
  }));
  return Object.fromEntries(entries);
}
function sameQuotaDirectoryFingerprints(left, right) {
  return TRACKED_STATE_DIRECTORIES.every((directoryName) => {
    const a = left[directoryName];
    const b = right[directoryName];
    return a.device === b.device && a.inode === b.inode && a.modifiedNs === b.modifiedNs && a.changedNs === b.changedNs;
  });
}
function isQuotaDirectoryFingerprintRecord(value) {
  if (!isRecord(value) || !hasExactKeys(value, [...TRACKED_STATE_DIRECTORIES])) return false;
  return TRACKED_STATE_DIRECTORIES.every((directoryName) => {
    const fingerprint = value[directoryName];
    return isRecord(fingerprint) && hasExactKeys(fingerprint, ["device", "inode", "modifiedNs", "changedNs"]) && [fingerprint.device, fingerprint.inode, fingerprint.modifiedNs, fingerprint.changedNs].every((item) => typeof item === "string" && /^\d+$/u.test(item));
  });
}
function nextQuotaRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new OperationJournalError("journal_quota_counter_corrupt", "Operation quota revision is invalid.");
  }
  return revision + 1;
}
function assertQuotaDelta(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new OperationJournalError("journal_quota_counter_corrupt", `Operation quota ${label} is invalid.`);
  }
}
function withoutField(value, field) {
  const copy = { ...value };
  delete copy[field];
  return copy;
}
async function writeAtomicJson(path, value, entropy, inject, replaceExisting) {
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
    await handle.writeFile(`${canonicalJson(value)}
`, "utf8");
    await handle.sync();
    await handle.close();
    handle = void 0;
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
      await unlink(temporaryPath).catch((error) => {
        if (!isNodeError(error, "ENOENT")) throw error;
      });
    }
  }
}
function injectPointForPath(path) {
  if (path.includes(`${SNAPSHOT_DIRECTORY}${sep}`)) return "after_snapshot_synced";
  if (path.includes(`${TERMINAL_DIRECTORY}${sep}`)) return "after_terminal_synced";
  return "after_tombstone_synced";
}
async function assertReplaceableRegularFile(path) {
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
async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}
async function fileSize(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new OperationJournalError("unsafe_journal_entry", "Expected a regular operation state file.");
  }
  return metadata.size;
}
async function optionalFileSize(path) {
  try {
    return await fileSize(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return void 0;
    throw error;
  }
}
async function hasDurableState(stateRoot) {
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
async function scanStateUsage(stateRoot) {
  let total = 0;
  let entryCount = 0;
  let scannedEntries = 0;
  const directories = [
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
function assertQuotaScanEntryLimit(scannedEntries) {
  if (scannedEntries > MAX_QUOTA_SCAN_ENTRIES) {
    throw new OperationJournalError("journal_scan_limit", "Operation journal quota scan exceeded its hard entry limit.");
  }
}
async function closeDirectory(handle) {
  try {
    await handle.close();
  } catch (error) {
    if (isNodeError(error, "ERR_DIR_CLOSED")) return;
    throw error;
  }
}
async function appendRecord(args) {
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
async function writeBufferAt(handle, bytes, position) {
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
async function readLog(logPath, key, allowMissing) {
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
  let bytes;
  try {
    const metadata = await assertSecureFileHandle(handle, logPath);
    if (!Number.isSafeInteger(metadata.size) || metadata.size > MAX_SINGLE_RECORD_FILE_BYTES) {
      throw new OperationJournalError("journal_log_too_large", "The operation log exceeds its hard safety limit.");
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  const lastNewline = bytes.lastIndexOf(10);
  const committedBytes = lastNewline < 0 ? 0 : lastNewline + 1;
  const partialTailBytes = bytes.byteLength - committedBytes;
  const committedText = bytes.subarray(0, committedBytes).toString("utf8");
  const lines = committedText.length === 0 ? [] : committedText.slice(0, -1).split("\n");
  const envelopes = [];
  let expectedPrevious = GENESIS_EVENT_DIGEST;
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) throw corrupt(`Empty committed record at revision ${index + 1}.`);
    let value;
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
  if (envelopes.length > 0) reduceSafely(envelopes.map((envelope) => envelope.event));
  await ensureLogDurable(logPath);
  return { exists: true, envelopes, committedBytes, partialTailBytes };
}
async function ensureLogDurable(logPath) {
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
function assertEnvelope(value, expectedRevision) {
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
  return value;
}
async function loadOrCreateKey(stateRoot, entropy) {
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
    await unlink(temporaryKeyPath).catch((error) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    });
  }
  await syncDirectory(stateRoot);
  return readKey(keyPath);
}
async function readKey(keyPath) {
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
    if (key.every((byte) => byte === 0)) {
      throw new OperationJournalError("invalid_journal_key", "Operation journal key is invalid.");
    }
    return key;
  } finally {
    await handle.close();
  }
}
async function ensureSecureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: POSIX_DIRECTORY_MODE });
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new OperationJournalError("unsafe_state_root", "Operation state path is not a secure directory.");
  }
  assertOwnerAndMode(metadata, directory, POSIX_DIRECTORY_MODE);
}
async function assertSecureFileHandle(handle, path) {
  const metadata = await handle.stat();
  if (!metadata.isFile()) throw new OperationJournalError("unsafe_journal_entry", "Expected a regular operation state file.");
  assertOwnerAndMode(metadata, path, POSIX_FILE_MODE);
  return metadata;
}
function assertOwnerAndMode(metadata, path, expectedMode) {
  if (platform() === "win32") return;
  const runtime = requireJournalRuntime();
  if (Number(metadata.uid) !== runtime.getuid()) {
    throw new OperationJournalError("unsafe_state_owner", "Operation state path is not owned by the current user.");
  }
  if ((Number(metadata.mode) & 63) !== 0) {
    throw new OperationJournalError(
      "unsafe_state_permissions",
      `Operation state path permissions must be ${expectedMode.toString(8)} or stricter.`
    );
  }
}
async function acquireLock(lockPath, timeoutMs, clock, entropy) {
  const token = entropyUuid(entropy);
  const record = {
    schemaVersion: "chatgpt.browser_control.operation_lock.v1",
    token,
    pid: process.pid,
    hostname: hostname(),
    createdAt: clockTimestamp(clock)
  };
  const deadline = safeDeadline(clockNow(clock), timeoutMs);
  let remainingWaitBudgetMs = timeoutMs;
  while (true) {
    let handle;
    let createdIdentity;
    try {
      handle = await open(
        lockPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
        POSIX_FILE_MODE
      );
      const metadata = await handle.stat();
      createdIdentity = { dev: metadata.dev, ino: metadata.ino };
      await handle.writeFile(`${canonicalJson(record)}
`, "utf8");
      await handle.sync();
      await handle.close();
      return { path: lockPath, token };
    } catch (error) {
      await handle?.close();
      if (createdIdentity !== void 0) {
        await removeFailedExclusiveLock(lockPath, createdIdentity);
      }
      if (!isNodeError(error, "EEXIST")) throw error;
      let owner;
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
          const remaining2 = Math.min(deadline - clockNow(clock), remainingWaitBudgetMs);
          if (remaining2 <= 0) {
            throw new OperationJournalError(
              "journal_lock_timeout",
              "Timed out while another process was recovering an abandoned operation journal lock."
            );
          }
          const waitMs2 = Math.min(LOCK_RETRY_MS, remaining2);
          remainingWaitBudgetMs -= waitMs2;
          await clockSleep(clock, waitMs2);
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
async function readLock(lockPath) {
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
  let raw;
  try {
    const metadata = await assertSecureFileHandle(handle, lockPath);
    if (!Number.isSafeInteger(metadata.size) || metadata.size > MAX_LOCK_RECORD_BYTES) {
      throw new OperationJournalError("journal_lock_corrupt", "Operation journal lock record is too large.");
    }
    raw = await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new OperationJournalError("journal_lock_corrupt", "Operation journal lock record is corrupt.");
  }
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "token", "pid", "hostname", "createdAt"]) || value.schemaVersion !== "chatgpt.browser_control.operation_lock.v1" || typeof value.token !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.token) || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.hostname !== "string" || value.hostname.length === 0 || value.hostname.length > 255 || typeof value.createdAt !== "string" || !isIsoTimestamp(value.createdAt)) {
    throw new OperationJournalError("journal_lock_corrupt", "Operation journal lock record has an invalid shape.");
  }
  return value;
}
async function quarantineAbandonedLock(lockPath, expectedToken, clock, entropy) {
  const guard = await tryAcquireRecoveryGuard(lockPath, clock, entropy);
  if (guard === void 0) return false;
  const quarantinePath = `${lockPath}.abandoned-${entropyUuid(entropy)}`;
  try {
    let current;
    try {
      current = await readLock(lockPath);
    } catch (error) {
      if (error instanceof OperationJournalError && error.code === "journal_lock_changed") return false;
      throw error;
    }
    if (current.token !== expectedToken || current.hostname !== hostname() || processExists(current.pid)) {
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
      throw new OperationJournalError("journal_lock_changed", "Operation journal lock ownership changed during recovery.");
    }
    await unlink(quarantinePath);
    return true;
  } finally {
    await releaseLock(guard);
  }
}
async function tryAcquireRecoveryGuard(lockPath, clock, entropy) {
  const guardPath = `${lockPath}${LOCK_RECOVERY_SUFFIX}`;
  const token = entropyUuid(entropy);
  const record = {
    schemaVersion: "chatgpt.browser_control.operation_lock.v1",
    token,
    pid: process.pid,
    hostname: hostname(),
    createdAt: clockTimestamp(clock)
  };
  let handle;
  let createdIdentity;
  try {
    handle = await open(
      guardPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      POSIX_FILE_MODE
    );
    const metadata = await handle.stat();
    createdIdentity = { dev: metadata.dev, ino: metadata.ino };
    await handle.writeFile(`${canonicalJson(record)}
`, "utf8");
    await handle.sync();
    return { path: guardPath, token };
  } catch (error) {
    if (createdIdentity !== void 0) {
      await handle?.close();
      handle = void 0;
      await removeFailedExclusiveLock(guardPath, createdIdentity);
    }
    if (!isNodeError(error, "EEXIST")) throw error;
    let owner;
    try {
      owner = await readLock(guardPath);
    } catch (readError) {
      if (readError instanceof OperationJournalError && readError.code === "journal_lock_changed") return void 0;
      throw readError;
    }
    if (owner.hostname === hostname() && !processExists(owner.pid)) {
      throw new OperationJournalError(
        "journal_lock_recovery_abandoned",
        "An abandoned journal lock-recovery guard requires manual diagnosis; it will not be reclaimed automatically."
      );
    }
    return void 0;
  } finally {
    await handle?.close();
  }
}
async function removeFailedExclusiveLock(path, created) {
  let current;
  try {
    current = await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
  if (current.isSymbolicLink() || !current.isFile() || current.dev !== created.dev || current.ino !== created.ino) {
    throw new OperationJournalError(
      "journal_lock_cleanup_failed",
      "A failed exclusive lock creation no longer names the file that this process created."
    );
  }
  await unlink(path);
}
async function releaseLock(lock) {
  let owner;
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
function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, "ESRCH");
  }
}
async function serializeInProcess(key, action) {
  const prior = inProcessQueues.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolveGate) => {
    release = resolveGate;
  });
  const tail = prior.catch(() => void 0).then(() => gate);
  inProcessQueues.set(key, tail);
  await prior.catch(() => void 0);
  try {
    const result = action();
    result.catch(() => void 0);
    return await result;
  } finally {
    release();
    if (inProcessQueues.get(key) === tail) inProcessQueues.delete(key);
  }
}
async function syncDirectory(directory) {
  if (platform() === "win32") return;
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
function childPath(root, ...parts) {
  const candidate = resolve(root, ...parts);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(prefix)) {
    throw new OperationJournalError("state_path_escape", "Resolved operation state path escaped the configured root.");
  }
  return candidate;
}
function reduceSafely(events) {
  try {
    return reduceOperationEvents(events);
  } catch (error) {
    if (error instanceof OperationJournalError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw corrupt(`Operation state reduction failed: ${message}`);
  }
}
function jsonRoundTrip(value) {
  const encoded = JSON.stringify(value);
  if (encoded === void 0) throw new OperationJournalError("event_not_serializable", "Operation value is not JSON serializable.");
  return JSON.parse(encoded);
}
function corrupt(message) {
  return new OperationJournalError("journal_corrupt", message);
}
function isDigest(value) {
  return typeof value === "string" && /^hmac-sha256:[0-9a-f]{64}$/.test(value);
}
function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function isIsoTimestamp(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNodeError(error, code) {
  return nodeErrorCode(error) === code;
}
function validatePositiveInteger(value, label) {
  if (value !== void 0 && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new OperationJournalError("invalid_journal_option", `${label} must be a positive safe integer.`);
  }
}
function resolveClock(value) {
  if (value === void 0) {
    return {
      now: () => Date.now(),
      sleep: (milliseconds) => delay(milliseconds)
    };
  }
  try {
    if (value === null || typeof value !== "object" || typeof value.now !== "function" || typeof value.sleep !== "function") {
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
function resolveEntropy(value) {
  if (value === void 0) {
    return {
      randomBytes: (size) => randomBytes(size),
      randomUUID: () => randomUUID()
    };
  }
  try {
    if (value === null || typeof value !== "object" || typeof value.randomBytes !== "function" || typeof value.randomUUID !== "function") {
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
function entropyUuid(entropy) {
  let value;
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
function entropyBytes(entropy, size) {
  let value;
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
  if (key.every((byte) => byte === 0)) {
    throw new OperationJournalError("invalid_journal_entropy", "Operation journal entropy returned an invalid key.");
  }
  return key;
}
function clockNow(clock) {
  let value;
  try {
    value = clock.now();
  } catch {
    throw new OperationJournalError("invalid_journal_clock", "Operation journal clock failed to provide time.");
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < -MAX_TIMESTAMP_MS || value > MAX_TIMESTAMP_MS) {
    throw new OperationJournalError("invalid_journal_clock", "Operation journal clock returned an invalid timestamp.");
  }
  return value;
}
function clockTimestamp(clock) {
  return new Date(clockNow(clock)).toISOString();
}
async function clockSleep(clock, milliseconds) {
  try {
    await clock.sleep(milliseconds);
  } catch {
    throw new OperationJournalError("invalid_journal_clock", "Operation journal clock wait failed.");
  }
}
function safeDeadline(now, timeoutMs) {
  const deadline = now + timeoutMs;
  return Number.isSafeInteger(deadline) ? deadline : Number.MAX_SAFE_INTEGER;
}
function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

// src/operations/journal-rpc-protocol.ts
import { createCipheriv, createDecipheriv, createHmac as createHmac2, randomBytes as randomBytes2 } from "node:crypto";
import { constants } from "node:fs";
import { lstat as lstat2, open as open2, realpath as realpath2, link as link2, unlink as unlink2 } from "node:fs/promises";
import { isAbsolute as isAbsolute2, join as join2, resolve as resolve2 } from "node:path";
import { platform as platform2, userInfo } from "node:os";
var JOURNAL_RPC_DESCRIPTOR_VERSION = "chatgpt.journal_rpc.descriptor.v1";
var JOURNAL_RPC_VERSION = "chatgpt.journal_rpc.v1";
var JOURNAL_RPC_MAX_WIRE_BYTES = 24 * 1024 * 1024;
var JOURNAL_RPC_MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
var JOURNAL_RPC_MAX_TIMEOUT_MS = 3e4;
var JOURNAL_RPC_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
var JOURNAL_RPC_DIGEST = /^hmac-sha256:[0-9a-f]{64}$/u;
var WIRE_KEYS = ["version", "instanceId", "requestId", "direction", "nonce", "body", "tag"];
var JOURNAL_RPC_METHODS = /* @__PURE__ */ new Set([
  "create",
  "append",
  "load",
  "submitRequestDigest",
  "controlRequestDigest",
  "evidenceDigest",
  "handleFromState",
  "validateHandle"
]);
function rpcError(code) {
  return new OperationJournalError(code, `Journal authority request failed (${code}).`);
}
function assertJournalRpcPlatform() {
  if (platform2() === "win32") throw rpcError("journal_rpc_unsupported_platform");
}
function exactRecord(value, keys) {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw rpcError("journal_rpc_protocol_error");
  }
}
function rpcTimeout(value) {
  const timeout = value ?? JOURNAL_RPC_MAX_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > JOURNAL_RPC_MAX_TIMEOUT_MS) {
    throw rpcError("journal_rpc_limit_exceeded");
  }
  return timeout;
}
function sealRpcValue(descriptor, requestId2, direction, value) {
  const plaintext = canonicalJson(value);
  if (Buffer.byteLength(plaintext) > JOURNAL_RPC_MAX_PLAINTEXT_BYTES) throw rpcError("journal_rpc_limit_exceeded");
  const nonce = randomBytes2(12);
  const cipher = createCipheriv("aes-256-gcm", directionKey(descriptor.token, direction), nonce);
  cipher.setAAD(aad(descriptor.instanceId, requestId2, direction));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const wire = JSON.stringify({
    version: JOURNAL_RPC_VERSION,
    instanceId: descriptor.instanceId,
    requestId: requestId2,
    direction,
    nonce: nonce.toString("base64"),
    body: body.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  });
  if (Buffer.byteLength(wire) > JOURNAL_RPC_MAX_WIRE_BYTES) throw rpcError("journal_rpc_limit_exceeded");
  return wire;
}
function openRpcValue(descriptor, requestId2, direction, wire) {
  try {
    if (Buffer.byteLength(wire) > JOURNAL_RPC_MAX_WIRE_BYTES) throw new Error();
    const envelope = JSON.parse(wire);
    exactRecord(envelope, WIRE_KEYS);
    if (envelope.version !== JOURNAL_RPC_VERSION || envelope.instanceId !== descriptor.instanceId || envelope.requestId !== requestId2 || envelope.direction !== direction) throw new Error();
    const nonce = base64(envelope.nonce, 12);
    const tag = base64(envelope.tag, 16);
    const body = base64(envelope.body);
    const decipher = createDecipheriv("aes-256-gcm", directionKey(descriptor.token, direction), nonce);
    decipher.setAAD(aad(descriptor.instanceId, requestId2, direction));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
    if (plaintext.length > JOURNAL_RPC_MAX_PLAINTEXT_BYTES) throw new Error();
    const text = plaintext.toString("utf8");
    const value = decodeCanonical(JSON.parse(text));
    if (canonicalJson(value) !== text) throw new Error();
    return value;
  } catch {
    throw rpcError("journal_rpc_authentication_failed");
  }
}
function directionKey(token, direction) {
  return createHmac2("sha256", Buffer.from(token, "base64url")).update(`chatgpt/journal-rpc/${direction}/v1`).digest();
}
function aad(instanceId, requestId2, direction) {
  return Buffer.from(`${JOURNAL_RPC_VERSION}\0${instanceId}\0${requestId2}\0${direction}`);
}
function base64(value, length) {
  if (typeof value !== "string" || value.length > JOURNAL_RPC_MAX_WIRE_BYTES) throw new Error();
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || length !== void 0 && bytes.length !== length) throw new Error();
  return bytes;
}
function decodeCanonical(value, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (depth > 32 || budget.nodes > 1e5) throw new Error();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    if (value.length > 32768) throw new Error();
    return value.map((item) => decodeCanonical(item, depth + 1, budget));
  }
  const record = value;
  const keys = Object.keys(record);
  if (keys.length > 32768) throw new Error();
  if (keys.length === 1 && record.$undefined === true) return void 0;
  if (keys.length === 1 && typeof record.$date === "string") {
    const date = new Date(record.$date);
    if (date.toISOString() !== record.$date) throw new Error();
    return date;
  }
  if (keys.length === 1 && typeof record.$bytes === "string") return new Uint8Array(base64(record.$bytes));
  const decoded = /* @__PURE__ */ Object.create(null);
  for (const key of keys) {
    if (["$undefined", "$date", "$bytes"].includes(key)) throw new Error();
    decoded[key] = decodeCanonical(record[key], depth + 1, budget);
  }
  return decoded;
}
async function assertPrivateDirectory(directory) {
  assertJournalRpcPlatform();
  const info = await lstat2(directory);
  const uid = userInfo().uid;
  if (!isAbsolute2(directory) || resolve2(directory) !== directory || await realpath2(directory) !== directory || !info.isDirectory() || info.isSymbolicLink() || uid < 0 || info.uid !== uid || (info.mode & 63) !== 0) {
    throw rpcError("journal_rpc_unavailable");
  }
}
async function readPrivateFile(path, maxBytes = JOURNAL_RPC_MAX_WIRE_BYTES) {
  assertJournalRpcPlatform();
  const file = await open2(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (info.nlink === 2) throw rpcError("journal_rpc_file_pending");
    if (!info.isFile() || info.nlink !== 1 || info.uid !== userInfo().uid || (info.mode & 63) !== 0 || info.size < 0 || info.size > maxBytes) throw rpcError("journal_rpc_limit_exceeded");
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await file.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    const after = await file.stat();
    if (offset !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs || after.nlink !== 1) throw rpcError("journal_rpc_protocol_error");
    return bytes.subarray(0, offset).toString("utf8");
  } finally {
    await file.close();
  }
}
async function publishPrivateFile(directory, name, body) {
  assertJournalRpcPlatform();
  if (!/^[a-zA-Z0-9.-]+$/u.test(name)) throw rpcError("journal_rpc_protocol_error");
  await assertPrivateDirectory(directory);
  const finalPath = join2(directory, name);
  const temporary = join2(directory, `.pending-${randomBytes2(16).toString("hex")}`);
  const file = await open2(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
  try {
    try {
      await file.writeFile(body, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await link2(temporary, finalPath);
  } finally {
    await unlink2(temporary).catch(() => void 0);
  }
}
function isMissing(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
var rpcSleep = (milliseconds) => new Promise((resolve4) => setTimeout(resolve4, milliseconds));

// src/operations/journal-rpc-server.ts
var SAFE_JOURNAL_CODES = /* @__PURE__ */ new Set([
  "operation_receipt_expired",
  "operation_compacted",
  "creation_event_required",
  "duplicate_operation_created",
  "journal_corrupt",
  "revision_conflict",
  "operation_not_found",
  "operation_binding_mismatch",
  "operation_request_mismatch",
  "operation_tombstoned",
  "journal_quota_exceeded",
  "journal_lock_timeout",
  "lock_timeout",
  "journal_snapshot_corrupt",
  "journal_record_corrupt",
  "journal_state_corrupt",
  "journal_quota_counter_corrupt",
  "journal_scan_limit",
  "operation_handle_mismatch",
  "operation_handle_ahead",
  "operation_handle_state_mismatch",
  "operation_handle_target_mismatch",
  "invalid_operation_handle",
  "invalid_operation_request",
  "invalid_expected_revision",
  "invalid_operation_event",
  "invalid_evidence_domain",
  "invalid_evidence_material",
  "evidence_material_too_large"
]);
var PREWRITE_REJECTION_CODES = /* @__PURE__ */ new Set([
  "revision_conflict",
  "operation_request_mismatch",
  "operation_binding_mismatch",
  "invalid_expected_revision",
  "invalid_operation_event",
  "creation_event_required",
  "duplicate_operation_created",
  "operation_receipt_expired",
  "operation_compacted",
  "journal_quota_exceeded",
  "journal_lock_timeout",
  "journal_rpc_protocol_error"
]);
var LIVE_ID_TTL_MS = 6e4;
var MAX_RECENT_IDS = 4096;
async function startJournalRpcServer(options) {
  assertJournalRpcPlatform();
  const directory = options.directory;
  if (!isAbsolute3(directory) || resolve3(directory) !== directory || !isAbsolute3(options.stateRoot)) {
    throw rpcError("journal_rpc_protocol_error");
  }
  const pollMs = boundedInteger(options.pollIntervalMs ?? 10, 1, 1e3);
  const maxConcurrent = boundedInteger(options.maxConcurrent ?? 4, 1, 8);
  const maxEntries = boundedInteger(options.maxPendingEntries ?? 128, 1, 128);
  const callTimeoutMs = rpcTimeout(options.callTimeoutMs);
  const maxRecentRequests = boundedInteger(options.maxRecentRequests ?? MAX_RECENT_IDS, 1, MAX_RECENT_IDS);
  const journal = await OperationJournal.open({ stateRoot: options.stateRoot });
  await mkdir2(directory, { mode: 448 });
  await assertPrivateDirectory(directory);
  const requestDirectory = join3(directory, "requests");
  const responseDirectory = join3(directory, "responses");
  await mkdir2(requestDirectory, { mode: 448 });
  await mkdir2(responseDirectory, { mode: 448 });
  const descriptor = {
    schemaVersion: JOURNAL_RPC_DESCRIPTOR_VERSION,
    transport: "file",
    directory,
    instanceId: randomUUID2(),
    token: randomBytes3(32).toString("base64url")
  };
  const descriptorPath = join3(directory, "connection.json");
  await publishPrivateFile(directory, "connection.json", JSON.stringify(descriptor));
  const inFlight = /* @__PURE__ */ new Set();
  const recent = /* @__PURE__ */ new Map();
  let closing = false;
  let closePromise;
  const loop = (async () => {
    while (!closing) {
      try {
        await assertPrivateDirectory(directory);
        await assertPrivateDirectory(requestDirectory);
        await assertPrivateDirectory(responseDirectory);
        const now = Date.now();
        for (const [id, expires] of recent) {
          if (expires > now) break;
          recent.delete(id);
          await unlink3(join3(responseDirectory, `${id}.response.json`)).catch(() => void 0);
          await unlink3(join3(requestDirectory, `${id}.request.json`)).catch(() => void 0);
        }
        if (inFlight.size < maxConcurrent) {
          const names = await boundedEntries(requestDirectory, maxEntries);
          for (const name of names) {
            if (closing || inFlight.size >= maxConcurrent) break;
            const id = requestId(name);
            if (id === void 0 || recent.has(id)) continue;
            let payload;
            try {
              payload = openRpcValue(descriptor, id, "request", await readPrivateFile(join3(requestDirectory, name)));
            } catch (error) {
              if (!isMissing(error)) {
              }
              continue;
            }
            if (recent.size >= maxRecentRequests) break;
            try {
              exactRecord(payload, ["method", "args", "issuedAt", "expiresAt"]);
              const issued = payload.issuedAt;
              const expires = payload.expiresAt;
              if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) || issued > Date.now() + 1e3 || expires <= Date.now() || expires <= issued || expires - issued > 3e4 || !JOURNAL_RPC_METHODS.has(payload.method) || !Array.isArray(payload.args)) {
                throw rpcError("journal_rpc_protocol_error");
              }
              recent.set(id, Date.now() + LIVE_ID_TTL_MS);
              await unlink3(join3(requestDirectory, name));
              const method = payload.method;
              const args = payload.args;
              const deadline = Math.min(expires, Date.now() + callTimeoutMs);
              let task;
              task = execute(method, args, id, deadline).finally(() => {
                inFlight.delete(task);
              });
              inFlight.add(task);
            } catch {
              recent.set(id, Date.now() + LIVE_ID_TTL_MS);
              await unlink3(join3(requestDirectory, name)).catch(() => void 0);
              await respond(id, { ok: false, error: { code: "journal_rpc_protocol_error" } });
            }
          }
        }
      } catch {
      }
      if (!closing) await rpcSleep(pollMs);
    }
  })();
  async function respond(id, value) {
    try {
      await publishPrivateFile(responseDirectory, `${id}.response.json`, sealRpcValue(descriptor, id, "response", value));
    } catch {
    }
  }
  async function execute(method, args, id, deadline) {
    if (Date.now() >= deadline) {
      await respond(id, { ok: false, error: { code: "journal_rpc_unavailable" } });
      return;
    }
    let responded = false;
    const timer = setTimeout(() => {
      if (responded) return;
      responded = true;
      void respond(id, { ok: false, error: { code: mutation(method) ? "journal_rpc_outcome_indeterminate" : "journal_rpc_unavailable" } });
    }, Math.max(1, deadline - Date.now()));
    try {
      const result = await invokeJournal(journal, method, args);
      if (!responded) {
        responded = true;
        await respond(id, { ok: true, result });
      }
    } catch (error) {
      if (!responded) {
        responded = true;
        const observed = safeJournalCode(error);
        const code = mutation(method) && !PREWRITE_REJECTION_CODES.has(observed) ? "journal_rpc_outcome_indeterminate" : observed;
        await respond(id, { ok: false, error: { code } });
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    descriptorPath,
    close: () => closePromise ??= (async () => {
      closing = true;
      await unlink3(descriptorPath).catch(() => void 0);
      await loop;
      let timer;
      try {
        const settled = await Promise.race([
          Promise.allSettled([...inFlight]).then(() => true),
          new Promise((resolve4) => {
            timer = setTimeout(() => resolve4(false), callTimeoutMs);
          })
        ]);
        if (!settled) throw rpcError("journal_rpc_outcome_indeterminate");
      } finally {
        if (timer !== void 0) clearTimeout(timer);
      }
    })()
  };
}
async function invokeJournal(journal, method, args) {
  switch (method) {
    case "create":
      requireCount(args, 1);
      assertOperationEventShape(args[0]);
      if (args[0].type !== "operation_created") throw rpcError("journal_rpc_protocol_error");
      return publicLoaded(await journal.create(args[0]));
    case "append":
      requireCount(args, 3);
      assertOperationId(args[0]);
      assertOperationEventShape(args[2]);
      if (!Number.isSafeInteger(args[1]) || args[1] < 0) throw rpcError("journal_rpc_protocol_error");
      return publicLoaded(await journal.append(args[0], args[1], args[2]));
    case "load":
      if (args.length !== 1 && args.length !== 2) throw rpcError("journal_rpc_protocol_error");
      assertOperationId(args[0]);
      if (args[1] !== void 0 && (typeof args[1] !== "string" || !JOURNAL_RPC_DIGEST.test(args[1]))) throw rpcError("journal_rpc_protocol_error");
      return publicLoaded(await journal.load(args[0], args[1]));
    case "handleFromState":
      requireCount(args, 1);
      assertOperationStateShape(args[0]);
      return journal.handleFromState(args[0]);
    case "validateHandle":
      requireCount(args, 2);
      assertOperationStateShape(args[1]);
      return journal.validateHandle(args[0], args[1]);
    case "submitRequestDigest":
      requireCount(args, 2);
      return journal.submitRequestDigest(...args);
    case "controlRequestDigest":
      requireCount(args, 1);
      return journal.controlRequestDigest(...args);
    case "evidenceDigest":
      requireCount(args, 2);
      if (typeof args[0] !== "string") throw rpcError("journal_rpc_protocol_error");
      return journal.evidenceDigest(args[0], args[1]);
  }
}
function requireCount(args, count) {
  if (args.length !== count) throw rpcError("journal_rpc_protocol_error");
}
function safeJournalCode(error) {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && (SAFE_JOURNAL_CODES.has(error.code) || error.code === "journal_rpc_protocol_error")) return error.code;
  return "journal_rpc_request_rejected";
}
function mutation(method) {
  return method === "create" || method === "append";
}
function boundedInteger(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw rpcError("journal_rpc_limit_exceeded");
  return value;
}
function requestId(name) {
  const id = name.replace(/\.request\.json$/u, "");
  return `${id}.request.json` === name && JOURNAL_RPC_UUID.test(id) ? id : void 0;
}
async function boundedEntries(directory, max) {
  const names = [];
  const entries = await opendir2(directory);
  let count = 0;
  for await (const entry of entries) {
    count += 1;
    if (count > max) throw rpcError("journal_rpc_limit_exceeded");
    if (!entry.isFile() || entry.name.startsWith(".pending-")) continue;
    names.push(entry.name);
  }
  return names;
}
function publicLoaded(value) {
  return {
    state: value.state,
    envelopes: value.envelopes,
    committedBytes: value.committedBytes,
    partialTailBytes: value.partialTailBytes,
    ...value.lastEventDigest === void 0 ? {} : { lastEventDigest: value.lastEventDigest }
  };
}

// src/scripts/journal-server.ts
async function main() {
  const args = process.argv.slice(2);
  let stateRoot;
  let directory;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === void 0 || option !== "--state-root" && option !== "--directory") throw new Error();
    if (option === "--state-root") {
      if (stateRoot !== void 0) throw new Error();
      stateRoot = value;
    } else {
      if (directory !== void 0) throw new Error();
      directory = value;
    }
  }
  if (stateRoot === void 0 || directory === void 0) throw new Error();
  const server = await startJournalRpcServer({ stateRoot, directory });
  process.stdout.write(`${JSON.stringify({ status: "ready", transport: "file" })}
`);
  const stop = () => {
    void server.close().then(() => {
      process.exitCode = 0;
    }, () => {
      process.exitCode = 2;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
void main().catch(() => {
  process.stderr.write("Journal authority startup failed. Supply absolute --state-root and a new private --directory.\n");
  process.exitCode = 2;
});
