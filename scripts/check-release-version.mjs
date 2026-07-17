#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

const NODE_PACKAGE = "codex-chatgpt-control";
const PYTHON_PACKAGE = "codex-chatgpt-control";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tag") {
      const value = argv[i + 1];
      if (!value) throw new Error("--tag requires a value");
      args.tag = value;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/check-release-version.mjs [--tag v0.2.0-alpha.1]

Validates that the release tag, root package version, Node package version, and
Python package version describe the same release.
`);
}

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

async function readPythonMetadata() {
  const pyproject = await readFile(new URL("../packages/python/pyproject.toml", import.meta.url), "utf8");
  const name = pyproject.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  const version = pyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!name || !version) throw new Error("Unable to read Python package name/version from packages/python/pyproject.toml");
  return { name, version };
}

async function readPluginMetadata() {
  return readJson("../plugins/codex-chatgpt-control/.codex-plugin/plugin.json");
}

function tagFromEnvironment() {
  if (process.env.RELEASE_TAG) return process.env.RELEASE_TAG;
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  if (process.env.GITHUB_REF?.startsWith("refs/tags/")) return process.env.GITHUB_REF.slice("refs/tags/".length);
  return undefined;
}

function normalizeTag(tag) {
  return tag.replace(/^refs\/tags\//, "").replace(/^v/, "");
}

function expectedPythonVersion(nodeVersion) {
  const stable = nodeVersion.match(/^(\d+\.\d+\.\d+)$/);
  if (stable) return stable[1];

  const prerelease = nodeVersion.match(/^(\d+\.\d+\.\d+)-(alpha|beta|rc)\.(\d+)$/);
  if (!prerelease) {
    throw new Error(`Unsupported release version format: ${nodeVersion}`);
  }

  const [, base, channel, number] = prerelease;
  const pythonChannel = channel === "alpha" ? "a" : channel === "beta" ? "b" : "rc";
  return `${base}${pythonChannel}${number}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootPackage = await readJson("../package.json");
  const nodePackage = await readJson("../packages/node/package.json");
  const pythonPackage = await readPythonMetadata();
  const pluginPackage = await readPluginMetadata();

  const tag = args.tag ?? tagFromEnvironment();
  const normalizedTag = tag ? normalizeTag(tag) : undefined;
  const expectedPython = expectedPythonVersion(nodePackage.version);

  const errors = [];
  if (rootPackage.version !== nodePackage.version) {
    errors.push(`Root package version ${rootPackage.version} does not match Node package version ${nodePackage.version}`);
  }
  if (nodePackage.name !== NODE_PACKAGE) {
    errors.push(`Node package name ${nodePackage.name} does not match ${NODE_PACKAGE}`);
  }
  if (pythonPackage.name !== PYTHON_PACKAGE) {
    errors.push(`Python package name ${pythonPackage.name} does not match ${PYTHON_PACKAGE}`);
  }
  if (pythonPackage.version !== expectedPython) {
    errors.push(`Python package version ${pythonPackage.version} does not match expected ${expectedPython} for Node ${nodePackage.version}`);
  }
  const pluginBaseVersion = typeof pluginPackage.version === "string"
    ? pluginPackage.version.split("+", 1)[0]
    : undefined;
  if (pluginPackage.name !== NODE_PACKAGE) {
    errors.push(`Plugin name ${pluginPackage.name} does not match ${NODE_PACKAGE}`);
  }
  if (pluginBaseVersion !== nodePackage.version) {
    errors.push(`Plugin base version ${pluginBaseVersion ?? "missing"} does not match Node package version ${nodePackage.version}`);
  }
  if (typeof pluginPackage.version !== "string" || !/^\d+\.\d+\.\d+-(?:alpha|beta|rc)\.\d+\+codex\.[a-z0-9-]+$/.test(pluginPackage.version)) {
    errors.push(`Plugin version ${pluginPackage.version ?? "missing"} must include one +codex.<cachebuster> suffix`);
  }
  if (normalizedTag && normalizedTag !== nodePackage.version) {
    errors.push(`Release tag ${tag} resolves to ${normalizedTag}, but Node package version is ${nodePackage.version}`);
  }

  const summary = {
    tag: tag ?? null,
    normalizedTag: normalizedTag ?? null,
    rootVersion: rootPackage.version,
    node: {
      package: nodePackage.name,
      version: nodePackage.version
    },
    python: {
      package: pythonPackage.name,
      version: pythonPackage.version,
      expectedVersion: expectedPython
    },
    plugin: {
      package: pluginPackage.name,
      version: pluginPackage.version,
      baseVersion: pluginBaseVersion ?? null
    }
  };

  console.log(JSON.stringify(summary, null, 2));

  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
