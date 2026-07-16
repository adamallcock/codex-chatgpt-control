import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "contracts", "v1");
const manifest = readJson(join(root, "manifest.json"));

const snakeCaseFields = [
  "active_agent_name",
  "final_output",
  "last_agent_name",
  "new_items",
  "next_step_id",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readNdjson(path) {
  const content = readFileSync(path, "utf8").trim();
  if (content.length === 0) return [];
  return content.split("\n").map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1} is not valid JSON: ${error.message}`);
    }
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoPythonSnakeCase(value, fixtureFile) {
  const serialized = JSON.stringify(value);
  for (const field of snakeCaseFields) {
    assert(!serialized.includes(`"${field}"`), `${fixtureFile} contains Python-only field ${field}.`);
  }
}

function assertRunResult(result, fixtureFile) {
  assertCommandResult(result, fixtureFile);
  assert(result && typeof result === "object", `${fixtureFile} missing result object.`);
  assert(typeof result.status === "string", `${fixtureFile} missing result.status.`);
  assert(typeof result.output_text === "string", `${fixtureFile} missing result.output_text.`);
  if (result.status === "ok") {
    assert(Object.hasOwn(result, "finalOutput"), `${fixtureFile} missing result.finalOutput.`);
  }
  assert(Array.isArray(result.newItems), `${fixtureFile} missing result.newItems.`);
  assert(Array.isArray(result.interruptions), `${fixtureFile} missing result.interruptions.`);
  assert(result.state && typeof result.state.id === "string", `${fixtureFile} missing result.state.id.`);
  assertNoPythonSnakeCase(result, fixtureFile);
}

function assertCommandResult(result, fixtureFile) {
  assert(result && typeof result === "object", `${fixtureFile} missing CommandResult object.`);
  assert(typeof result.ok === "boolean", `${fixtureFile} missing result.ok.`);
  assert(typeof result.status === "string", `${fixtureFile} missing result.status.`);
  assert(Array.isArray(result.warnings), `${fixtureFile} missing result.warnings.`);
  assert(result.context && typeof result.context.timestamp === "string", `${fixtureFile} missing result.context.timestamp.`);
  const outputText = commandOutputText(result.data);
  if (outputText !== undefined) {
    assert(result.output_text === outputText, `${fixtureFile} must expose result.output_text for assistant text.`);
  }
  assertNoPythonSnakeCase(result, fixtureFile);
}

function commandOutputText(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  if (typeof data.responseText === "string") return data.responseText;
  if (typeof data.text === "string" && data.role !== "user") return data.text;
  if (typeof data.markdown === "string") return data.markdown;
  for (const [key, value] of Object.entries(data)) {
    if (key === "prompt" || key === "input") continue;
    const nested = commandOutputText(value);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function assertResponse(response, fixtureFile) {
  assert(response && typeof response === "object", `${fixtureFile} missing response object.`);
  assert(response.object === "chatgpt.browser.response", `${fixtureFile} must use response object.`);
  assert(typeof response.status === "string", `${fixtureFile} missing response.status.`);
  assert(typeof response.output_text === "string", `${fixtureFile} missing response.output_text.`);
  assert(response.browser_control && typeof response.browser_control === "object", `${fixtureFile} missing browser_control.`);
  assertNoPythonSnakeCase(response, fixtureFile);
}

function assertCommandDescriptor(descriptor, fixtureFile) {
  assert(descriptor && typeof descriptor === "object", `${fixtureFile} missing command descriptor.`);
  assert(typeof descriptor.name === "string", `${fixtureFile} missing descriptor.name.`);
  assert(typeof descriptor.layer === "string", `${fixtureFile} missing descriptor.layer.`);
  assert(typeof descriptor.summary === "string", `${fixtureFile} missing descriptor.summary.`);
  assert(["low", "medium", "high"].includes(descriptor.risk), `${fixtureFile} has invalid descriptor.risk.`);
  assert(descriptor.args && typeof descriptor.args === "object", `${fixtureFile} missing descriptor.args.`);
  assert(descriptor.defaults && typeof descriptor.defaults === "object", `${fixtureFile} missing descriptor.defaults.`);
  assert(Array.isArray(descriptor.blockers), `${fixtureFile} missing descriptor.blockers.`);
  assert(Array.isArray(descriptor.examples), `${fixtureFile} missing descriptor.examples.`);
  assertNoPythonSnakeCase(descriptor, fixtureFile);
}

function assertSequencePlan(plan, fixtureFile) {
  assert(plan && typeof plan === "object", `${fixtureFile} missing sequence plan.`);
  assert(typeof plan.name === "string", `${fixtureFile} missing plan.name.`);
  assert(Array.isArray(plan.steps) && plan.steps.length > 0, `${fixtureFile} missing plan.steps.`);
  for (const [index, step] of plan.steps.entries()) {
    assert(typeof step.id === "string", `${fixtureFile} step ${index} missing id.`);
    assert(typeof step.command === "string", `${fixtureFile} step ${index} missing command.`);
  }
  assertNoPythonSnakeCase(plan, fixtureFile);
}

function assertAgent(agent, fixtureFile) {
  assert(agent && typeof agent === "object", `${fixtureFile} missing agent.`);
  assert(agent.kind === "chatgpt_browser_agent", `${fixtureFile} must use chatgpt_browser_agent kind.`);
  assert(typeof agent.name === "string", `${fixtureFile} missing agent.name.`);
  assert(["visible_prefix", "visible_setup_message", "metadata_only"].includes(agent.instructionsMode), `${fixtureFile} invalid instructionsMode.`);
  assert(agent.defaults && typeof agent.defaults === "object", `${fixtureFile} missing agent.defaults.`);
  assert(Array.isArray(agent.tools), `${fixtureFile} missing agent.tools.`);
  assert(Array.isArray(agent.guardrails), `${fixtureFile} missing agent.guardrails.`);
  assertNoPythonSnakeCase(agent, fixtureFile);
}

function assertCapabilities(capabilities, fixtureFile) {
  assert(capabilities && typeof capabilities === "object", `${fixtureFile} missing capabilities.`);
  assert(capabilities.protocolVersion === "chatgpt.browser_control.backend_request.v1", `${fixtureFile} invalid protocolVersion.`);
  assert(Array.isArray(capabilities.commands) && capabilities.commands.length > 0, `${fixtureFile} missing commands.`);
  assert(Array.isArray(capabilities.transports) && capabilities.transports.includes("stdio"), `${fixtureFile} missing stdio transport.`);
  assert(capabilities.streaming?.tokenDeltas === false, `${fixtureFile} must not claim token deltas.`);
  assertNoPythonSnakeCase(capabilities, fixtureFile);
}

function assertSurfaceProfile(profile, fixtureFile) {
  assert(profile && typeof profile === "object", `${fixtureFile} missing surface profile.`);
  assert(profile.schemaVersion === "chatgpt.browser_control.surface_profile.v1", `${fixtureFile} invalid surface profile schemaVersion.`);
  assert(typeof profile.id === "string", `${fixtureFile} missing profile id.`);
  assert(profile.snapshot && Array.isArray(profile.snapshot.composerLabels), `${fixtureFile} missing snapshot composer labels.`);
  assert(profile.panel && Array.isArray(profile.panel.axisRows), `${fixtureFile} missing panel axis rows.`);
  assert(profile.expected && typeof profile.expected.experience === "string", `${fixtureFile} missing expected experience.`);
  assertNoPythonSnakeCase(profile, fixtureFile);
}

function assertBackendResponse(response, fixtureFile) {
  assert(response && typeof response === "object", `${fixtureFile} missing backend response.`);
  assert(response.schemaVersion === "chatgpt.browser_control.backend_response.v1", `${fixtureFile} invalid backend response schemaVersion.`);
  assert(typeof response.ok === "boolean", `${fixtureFile} missing backend response ok.`);
  if (response.ok) {
    assert(Object.hasOwn(response, "result"), `${fixtureFile} missing backend response result.`);
    assertNoPythonSnakeCase(response.result, fixtureFile);
  } else {
    assert(response.error && typeof response.error.message === "string", `${fixtureFile} missing backend error.`);
  }
}

function assertStream(events, fixtureFile) {
  assert(events.length > 0, `${fixtureFile} has no stream events.`);
  const finalEvent = events.at(-1);
  assert(["completed", "error"].includes(finalEvent.type), `${fixtureFile} must end with completed or error.`);
  if (finalEvent.type === "completed") {
    assertRunResult(finalEvent.result, `${fixtureFile} final event`);
  }
}

function assertBackendEvents(events, fixtureFile) {
  assert(events.length > 0, `${fixtureFile} has no backend events.`);
  for (const [index, event] of events.entries()) {
    assert(event.schemaVersion === "chatgpt.browser_control.backend_event.v1", `${fixtureFile}:${index + 1} invalid backend event schemaVersion.`);
    assert(typeof event.type === "string", `${fixtureFile}:${index + 1} missing backend event type.`);
  }
  const finalEvent = events.at(-1);
  assert(["completed", "error"].includes(finalEvent.type), `${fixtureFile} must end with completed or error.`);
  if (finalEvent.type === "completed" && looksLikeRunResult(finalEvent.result)) {
    assertRunResult(finalEvent.result, `${fixtureFile} final event`);
  }
}

function looksLikeRunResult(value) {
  return value
    && typeof value === "object"
    && typeof value.status === "string"
    && typeof value.output_text === "string"
    && Array.isArray(value.newItems)
    && Array.isArray(value.interruptions);
}

for (const fixture of manifest.fixtures) {
  const path = join(root, "fixtures", fixture.file);

  if (fixture.file.endsWith(".ndjson")) {
    if (fixture.schema === "streamEvent") {
      assertStream(readNdjson(path), fixture.file);
    } else if (fixture.schema === "backendEvent") {
      assertBackendEvents(readNdjson(path), fixture.file);
    } else {
      throw new Error(`${fixture.file} must be declared as streamEvent or backendEvent.`);
    }
    continue;
  }

  const payload = readJson(path);
  if (fixture.schema === "runResult") {
    assertRunResult(payload.result, fixture.file);
  } else if (fixture.schema === "commandResult") {
    assertCommandResult(payload.result, fixture.file);
  } else if (fixture.schema === "response") {
    assertResponse(payload.response, fixture.file);
  } else if (fixture.schema === "commandDescriptor") {
    assertCommandDescriptor(payload, fixture.file);
  } else if (fixture.schema === "sequencePlan") {
    assertSequencePlan(payload, fixture.file);
  } else if (fixture.schema === "agent") {
    assertAgent(payload, fixture.file);
  } else if (fixture.schema === "capabilities") {
    assertCapabilities(payload, fixture.file);
  } else if (fixture.schema === "surfaceProfile") {
    assertSurfaceProfile(payload, fixture.file);
  } else if (fixture.schema === "backendResponse") {
    assertBackendResponse(payload, fixture.file);
  } else if (fixture.schema === "backendRequest") {
    assert(payload.schemaVersion === "chatgpt.browser_control.backend_request.v1", `${fixture.file} invalid backend request schemaVersion.`);
  } else if (fixture.schema === "backendEvent") {
    assertBackendEvents([payload], fixture.file);
  } else {
    throw new Error(`${fixture.file} uses unsupported fixture schema ${fixture.schema}.`);
  }
}

console.log(`Checked parity shape for ${manifest.fixtures.length} fixtures.`);
