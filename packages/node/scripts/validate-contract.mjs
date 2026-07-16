import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "contracts", "v1");
const manifest = readJson(join(root, "manifest.json"));
const manifestSchema = readJson(join(root, "schemas", "manifest.schema.json"));
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const SECRET_PATTERN = /\b(?:bearer\s+[a-z0-9._~+/-]{12,}|sk-[a-z0-9_-]{12,}|(?:session|auth|access)[_-]?token\s*[:=])/i;

const ajv = new Ajv2020({ allErrors: true, strict: true });

validateOrThrow(ajv.compile(manifestSchema), manifest, "manifest.json");

const schemas = Object.fromEntries(
  Object.entries(manifest.schemas).map(([name, path]) => [name, readJson(join(root, path))])
);

for (const [name, schema] of Object.entries(schemas)) {
  ajv.compile(schema);
  if (typeof schema.$id !== "string" || schema.$id.length === 0) {
    throw new Error(`Schema "${name}" must have a non-empty $id.`);
  }
}

const fixtureNames = readdirSync(join(root, "fixtures"))
  .filter(name => name.endsWith(".json") || name.endsWith(".ndjson"))
  .sort();
const manifestNames = manifest.fixtures.map(fixture => fixture.file).sort();

if (JSON.stringify(fixtureNames) !== JSON.stringify(manifestNames)) {
  throw new Error(`Manifest fixture list does not match directory. manifest=${manifestNames.join(",")} actual=${fixtureNames.join(",")}`);
}

for (const fixture of manifest.fixtures) {
  const schema = schemas[fixture.schema];
  if (schema === undefined) {
    throw new Error(`Unknown fixture schema "${fixture.schema}" for ${fixture.file}.`);
  }
  const validate = ajv.compile(schema);
  const path = join(root, "fixtures", fixture.file);

  if (fixture.file.endsWith(".ndjson")) {
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      throw new Error(`${fixture.file} must contain at least one event.`);
    }
    for (const [index, line] of lines.entries()) {
      validateOrThrow(validate, JSON.parse(line), `${fixture.file}:${index + 1}`);
    }
    continue;
  }

  const payload = readJson(path);
  if (fixture.schema === "surfaceProfile") {
    validateSurfaceProfileSafety(payload, fixture.file);
  }
  const value = fixture.schema === "runResult"
    ? payload.result
    : fixture.schema === "response"
      ? payload.response
      : fixture.schema === "commandResult"
        ? payload.result
      : payload;
  validateOrThrow(validate, value, fixture.file);
}

console.log(`Validated ${manifest.fixtures.length} contract fixtures.`);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateOrThrow(validate, value, label) {
  if (validate(value)) return;
  throw new Error(`${label} failed schema validation: ${ajv.errorsText(validate.errors, { separator: "\n" })}`);
}

function validateSurfaceProfileSafety(profile, label) {
  const normalizedScopePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
  for (const field of ["region", "accountScope", "planScope", "workspaceScope"]) {
    const value = profile[field];
    if (typeof value !== "string" || !normalizedScopePattern.test(value)) {
      throw new Error(`${label} field ${field} must be a normalized non-identifying slug.`);
    }
  }

  const url = new URL(profile.snapshot.url);
  if (
    url.protocol !== "https:"
    || !["chatgpt.com", "www.chatgpt.com"].includes(url.hostname)
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error(`${label} snapshot.url must be a sanitized query-free chatgpt.com URL.`);
  }
  const conversationMatch = url.pathname.match(/^\/c\/([^/]+)/);
  if (conversationMatch !== null && !["sanitized", "<conversation-id>"].includes(conversationMatch[1])) {
    throw new Error(`${label} snapshot.url contains a non-sanitized conversation identifier.`);
  }

  for (const [path, value] of collectStrings(profile)) {
    if (EMAIL_PATTERN.test(value)) {
      throw new Error(`${label} contains an email-like value at ${path}.`);
    }
    if (SECRET_PATTERN.test(value)) {
      throw new Error(`${label} contains a credential-like value at ${path}.`);
    }
  }
}

function collectStrings(value, path = "$") {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => collectStrings(child, `${path}[${index}]`));
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => collectStrings(child, `${path}.${key}`));
}
