#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pythonRoot = join(repoRoot, "packages", "python");
const nodeRoot = join(repoRoot, "packages", "node");
const venvDir = join(pythonRoot, ".venv");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const pythonCommand = process.env.PYTHON ?? (process.platform === "win32" ? "python.exe" : "python");
const venvPython = process.platform === "win32"
  ? join(venvDir, "Scripts", "python.exe")
  : join(venvDir, "bin", "python");

const gate = process.argv[2] ?? "test";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: "inherit",
    shell: false,
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureVenv() {
  run(pythonCommand, ["-m", "venv", venvDir], { cwd: pythonRoot });
  run(venvPython, ["-m", "pip", "install", "-e", ".[dev]"], { cwd: pythonRoot });
}

if (gate === "test") {
  run(npmCommand, ["--prefix", nodeRoot, "run", "bundle:backend"]);
  ensureVenv();
  run(venvPython, ["-m", "unittest", "discover", "-s", "tests"], { cwd: pythonRoot });
} else if (gate === "compile") {
  ensureVenv();
  run(venvPython, ["-m", "compileall", "-q", "src", "examples"], { cwd: pythonRoot });
} else if (gate === "pyright") {
  ensureVenv();
  run(venvPython, ["-m", "pyright", "src", "tests"], { cwd: pythonRoot });
} else if (gate === "ordinary-shell") {
  run(npmCommand, ["--prefix", nodeRoot, "run", "bundle:backend"]);
  ensureVenv();
  run(venvPython, ["scripts/live_smoke.py", "--mode", "ordinary-shell"], { cwd: pythonRoot });
} else {
  console.error(`Unknown Python gate: ${gate}`);
  process.exit(2);
}
