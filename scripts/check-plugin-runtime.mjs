#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_PACKAGE_REL = path.join("work", "chatgpt-" + "browser-control");
const PRIVATE_BUNDLE_PREFIX = "chatgpt-" + "browser-control";
const PRIVATE_PY_PACKAGE = "chatgpt_" + "browser_control";
const PUBLIC_PY_PACKAGE = "codex_" + "chatgpt_control";
const PRIVATE_DASH_PACKAGE = "chatgpt-" + "browser-control";
const PUBLIC_DASH_PACKAGE = "codex-" + "chatgpt-control";
const PRIVATE_TITLE = "ChatGPT " + "Browser Control";
const PUBLIC_TITLE = "Codex " + "ChatGPT Control";

function parseArgs(argv) {
  const args = { root: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      args.root = path.resolve(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-plugin-runtime.mjs [--root <repo-root>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function detectRoot(explicitRoot) {
  const candidates = [
    explicitRoot,
    path.resolve(SCRIPT_DIR, ".."),
    path.resolve(SCRIPT_DIR, "../../../..")
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, PRIVATE_PACKAGE_REL, "package.json")) ||
      existsSync(path.join(candidate, "packages/node/package.json"))
    ) {
      return candidate;
    }
  }
  throw new Error("Could not find repo root with a private work package or packages/node");
}

function nodePackageDir(root) {
  const privateDir = path.join(root, PRIVATE_PACKAGE_REL);
  if (existsSync(path.join(privateDir, "package.json"))) return privateDir;
  return path.join(root, "packages/node");
}

function sourceBundle(distDir, privateName, publicName) {
  const publicPath = path.join(distDir, publicName);
  if (existsSync(publicPath)) return publicPath;
  const privatePath = path.join(distDir, privateName);
  if (existsSync(privatePath)) return privatePath;
  throw new Error(`Missing built bundle: ${publicName} or ${privateName}`);
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function sanitizeRuntime(text) {
  return text
    .replaceAll(PRIVATE_PY_PACKAGE, PUBLIC_PY_PACKAGE)
    .replaceAll(PRIVATE_DASH_PACKAGE, PUBLIC_DASH_PACKAGE)
    .replaceAll(PRIVATE_TITLE, PUBLIC_TITLE)
    .replace(
      /var PATH_RE = \/\\\/Users\\\/\[\^\\s"'<>\]\+\/g;/,
      'var PATH_RE = /(?:\\/Users\\/|\\/home\\/|\\/example\\/user\\/)[^\\s"\'<>]+/g;'
    )
    .replace(
      /\n\/\/ src\/backend\/protocol\.ts\nvar backendCommands = \[[\s\S]*?\];\nvar commandSet = new Set\(backendCommands\);\n/g,
      ""
    )
    .replace(/\/Users\/[^/\s"'<>]+/g, "/example/user");
}

async function sanitizedSha256(file) {
  return createHash("sha256")
    .update(sanitizeRuntime(await readFile(file, "utf8")))
    .digest("hex");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = detectRoot(args.root);
  const distDir = path.join(nodePackageDir(root), "dist");
  const runtimeDir = path.join(root, "plugins/codex-chatgpt-control/runtime/node");
  const pairs = [
    [
      sourceBundle(distDir, `${PRIVATE_BUNDLE_PREFIX}.bundle.mjs`, "codex-chatgpt-control.bundle.mjs"),
      path.join(runtimeDir, "codex-chatgpt-control.bundle.mjs")
    ],
    [
      sourceBundle(distDir, `${PRIVATE_BUNDLE_PREFIX}-backend.mjs`, "codex-chatgpt-control-backend.mjs"),
      path.join(runtimeDir, "codex-chatgpt-control-backend.mjs")
    ],
    [
      sourceBundle(distDir, `${PRIVATE_BUNDLE_PREFIX}-live-smoke.bundle.mjs`, "codex-chatgpt-control-live-smoke.bundle.mjs"),
      path.join(runtimeDir, "codex-chatgpt-control-live-smoke.bundle.mjs")
    ],
    [
      sourceBundle(distDir, `${PRIVATE_BUNDLE_PREFIX}-release-canary.bundle.mjs`, "codex-chatgpt-control-release-canary.bundle.mjs"),
      path.join(runtimeDir, "codex-chatgpt-control-release-canary.bundle.mjs")
    ]
  ];

  for (const [source, runtime] of pairs) {
    if (!existsSync(runtime)) throw new Error(`Missing plugin runtime bundle: ${runtime}`);
    const [sourceHash, runtimeHash] = await Promise.all([sanitizedSha256(source), sha256(runtime)]);
    if (sourceHash !== runtimeHash) {
      throw new Error(`Plugin runtime bundle is stale: ${path.basename(runtime)}`);
    }
  }

  const loaderPath = path.join(root, "plugins/codex-chatgpt-control/runtime/import-chatgpt-control.mjs");
  const loader = await readFile(loaderPath, "utf8");
  if (!loader.includes("./node/codex-chatgpt-control.bundle.mjs")) {
    throw new Error("Plugin runtime loader does not import the bundled runtime");
  }

  console.log("Plugin runtime bundles match package dist output");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
