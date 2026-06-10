#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";

const REQUIRED_FILES = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "dist/src/index.js",
  "dist/src/index.d.ts",
  "dist/codex-chatgpt-control.bundle.mjs",
  "dist/codex-chatgpt-control-backend.mjs",
  "contracts/v1/manifest.json"
];

const FORBIDDEN_PATTERNS = [
  /^node_modules\//,
  /^reports\//,
  /^tests\//,
  /^src\/.*\.ts$/,
  /\.map$/,
  /\.env(?:\.|$)/,
  /live-smoke\/.*\.json$/,
  /__pycache__/
];

function main() {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: new URL("../packages/node", import.meta.url),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const packs = JSON.parse(output);
  const pack = packs[0];
  if (!pack) throw new Error("npm pack did not return a package summary");

  const files = pack.files.map(file => file.path).sort();
  const missing = REQUIRED_FILES.filter(file => !files.includes(file));
  const forbidden = files.filter(file => FORBIDDEN_PATTERNS.some(pattern => pattern.test(file)));

  const summary = {
    name: pack.name,
    version: pack.version,
    filename: pack.filename,
    files: files.length,
    unpackedSize: pack.unpackedSize,
    missing,
    forbidden
  };
  console.log(JSON.stringify(summary, null, 2));

  if (missing.length > 0 || forbidden.length > 0) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
