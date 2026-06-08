#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  const args = { root: undefined, skipBuild: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      args.root = path.resolve(argv[++i]);
    } else if (arg === "--skip-build") {
      args.skipBuild = true;
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
  console.log(`Usage: node scripts/build-plugin-runtime.mjs [--root <repo-root>] [--skip-build]

Builds the Node SDK bundles and copies them into plugins/codex-chatgpt-control/runtime/node.
`);
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

async function copySanitizedRuntime(src, dest) {
  const text = await readFile(src, "utf8");
  await writeFile(dest, sanitizeRuntime(text), "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = detectRoot(args.root);
  const packageDir = nodePackageDir(root);
  const runtimeDir = path.join(root, "plugins/codex-chatgpt-control/runtime/node");

  if (!args.skipBuild) {
    for (const script of ["build", "bundle", "bundle:backend", "bundle:live-smoke"]) {
      execFileSync("npm", ["run", script], { cwd: packageDir, stdio: "inherit" });
    }
  }

  await mkdir(runtimeDir, { recursive: true });
  const distDir = path.join(packageDir, "dist");
  const copies = [
    [
      sourceBundle(distDir, `${PRIVATE_BUNDLE_PREFIX}.bundle.mjs`, "codex-chatgpt-control.bundle.mjs"),
      "codex-chatgpt-control.bundle.mjs"
    ],
    [
      sourceBundle(distDir, `${PRIVATE_BUNDLE_PREFIX}-backend.mjs`, "codex-chatgpt-control-backend.mjs"),
      "codex-chatgpt-control-backend.mjs"
    ],
    [
      sourceBundle(distDir, `${PRIVATE_BUNDLE_PREFIX}-live-smoke.bundle.mjs`, "codex-chatgpt-control-live-smoke.bundle.mjs"),
      "codex-chatgpt-control-live-smoke.bundle.mjs"
    ]
  ];

  for (const [src, destName] of copies) {
    await copySanitizedRuntime(src, path.join(runtimeDir, destName));
  }

  await writeFile(
    path.join(root, "plugins/codex-chatgpt-control/runtime/import-chatgpt-control.mjs"),
    `import { pathToFileURL } from "node:url";

export async function importChatGPTControl({ cacheBust = true } = {}) {
  const runtimeUrl = new URL("./node/codex-chatgpt-control.bundle.mjs", import.meta.url);
  const href = cacheBust
    ? \`\${runtimeUrl.href}?t=\${Date.now()}\`
    : runtimeUrl.href;
  return import(href);
}

export function backendBundleUrl() {
  return pathToFileURL(new URL("./node/codex-chatgpt-control-backend.mjs", import.meta.url).pathname).href;
}
`,
    "utf8"
  );

  console.log(`Plugin runtime updated at ${runtimeDir}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
