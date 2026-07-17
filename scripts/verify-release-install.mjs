#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE_ROOT = join(REPO_ROOT, "packages", "node");
const PYTHON_ROOT = join(REPO_ROOT, "packages", "python");
const NPM_PACKAGE = "codex-chatgpt-control";
const PYPI_PACKAGE = "codex-chatgpt-control";
const PYTHON_IMPORT = "codex_chatgpt_control";
const REQUEST_SCHEMA = "chatgpt.browser_control.backend_request.v1";
const RESPONSE_SCHEMA = "chatgpt.browser_control.backend_response.v1";
const DEFAULT_TIMEOUT_MS = 180_000;

function parseArgs(argv) {
  const options = { mode: undefined, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") options.mode = "source";
    else if (arg === "--registry") options.mode = "registry";
    else if (arg === "--timeout-ms") {
      const value = Number.parseInt(argv[++index] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--timeout-ms must be a positive integer");
      options.timeoutMs = value;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/verify-release-install.mjs (--source|--registry) [--timeout-ms <ms>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.mode === undefined) throw new Error("Choose exactly one mode: --source or --registry");
  return options;
}

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env: process.env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false
  });
  if (result.error) {
    throw new Error(`${program} ${args.join(" ")} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(`${program} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

async function metadata() {
  const node = JSON.parse(await readFile(join(NODE_ROOT, "package.json"), "utf8"));
  const pythonText = await readFile(join(PYTHON_ROOT, "pyproject.toml"), "utf8");
  const pythonName = /^name\s*=\s*"([^"]+)"/m.exec(pythonText)?.[1];
  const pythonVersion = /^version\s*=\s*"([^"]+)"/m.exec(pythonText)?.[1];
  if (node.name !== NPM_PACKAGE || pythonName !== PYPI_PACKAGE || !node.version || !pythonVersion) {
    throw new Error("Release package names or versions are inconsistent");
  }
  return { nodeVersion: node.version, pythonVersion };
}

async function waitForRegistryVersions(versions, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "registry metadata not checked";
  while (Date.now() <= deadline) {
    try {
      const npmVersion = JSON.parse(run(command("npm"), [
        "view",
        `${NPM_PACKAGE}@${versions.nodeVersion}`,
        "version",
        "--json"
      ], { capture: true }));
      const response = await fetch(`https://pypi.org/pypi/${PYPI_PACKAGE}/${versions.pythonVersion}/json`, {
        headers: { "User-Agent": "codex-chatgpt-control-release-verifier" }
      });
      const pypi = response.ok ? await response.json() : undefined;
      const pypiVersion = pypi?.info?.version;
      if (npmVersion === versions.nodeVersion && pypiVersion === versions.pythonVersion) return;
      last = `npm=${String(npmVersion)} pypi=${String(pypiVersion)} status=${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 5_000));
  }
  throw new Error(`Timed out waiting for published registry versions: ${last}`);
}

async function sourceSpecs(root) {
  const nodeDist = join(root, "node-dist");
  const pythonDist = join(root, "python-dist");
  await Promise.all([mkdir(nodeDist, { recursive: true }), mkdir(pythonDist, { recursive: true })]);
  const packed = JSON.parse(run(command("npm"), ["pack", "--json", "--pack-destination", nodeDist], {
    cwd: NODE_ROOT,
    capture: true
  }));
  const filename = packed[0]?.filename;
  if (typeof filename !== "string") throw new Error("npm pack did not return a tarball filename");
  const python = process.env.PYTHON ?? (process.platform === "win32" ? "python.exe" : "python3");
  run(python, ["-m", "build", "--sdist", "--wheel", "--outdir", pythonDist, PYTHON_ROOT]);
  const wheel = (await readdir(pythonDist)).find(file => file.endsWith(".whl"));
  if (wheel === undefined) throw new Error("Python build did not produce a wheel");
  return { nodeSpec: join(nodeDist, basename(filename)), pythonSpec: join(pythonDist, wheel) };
}

async function registrySpecs(versions, timeoutMs) {
  await waitForRegistryVersions(versions, timeoutMs);
  return {
    nodeSpec: `${NPM_PACKAGE}@${versions.nodeVersion}`,
    pythonSpec: `${PYPI_PACKAGE}==${versions.pythonVersion}`
  };
}

async function installAndVerify(root, specs, versions) {
  const nodeEnv = join(root, "node-env");
  const pythonEnv = join(root, "python-env");
  await mkdir(nodeEnv, { recursive: true });
  await writeFile(join(nodeEnv, "package.json"), '{"private":true,"type":"module"}\n', "utf8");
  run(command("npm"), ["install", "--ignore-scripts", "--no-audit", "--no-fund", specs.nodeSpec], { cwd: nodeEnv });

  const installedNodeRoot = join(nodeEnv, "node_modules", NPM_PACKAGE);
  const installedNode = JSON.parse(await readFile(join(installedNodeRoot, "package.json"), "utf8"));
  if (installedNode.version !== versions.nodeVersion) {
    throw new Error(`Installed npm version ${installedNode.version} did not match ${versions.nodeVersion}`);
  }
  const sdk = await import(`${pathToFileURL(join(installedNodeRoot, "dist", "src", "index.js")).href}?t=${Date.now()}`);
  if (typeof sdk.createChatGPT !== "function") throw new Error("Installed npm package does not export createChatGPT");

  const backendPath = join(installedNodeRoot, "dist", "src", "scripts", "backend-server.js");
  const health = await backendRequest(backendPath, "backend.health");
  if (health?.ok !== true || health?.status !== "ok") {
    throw new Error("Installed backend health check did not report ok");
  }
  const capabilities = await backendRequest(backendPath, "backend.capabilities");
  if (capabilities?.protocolVersion !== REQUEST_SCHEMA) {
    throw new Error("Installed backend capabilities returned an unexpected protocol version");
  }

  const python = process.env.PYTHON ?? (process.platform === "win32" ? "python.exe" : "python3");
  run(python, ["-m", "venv", pythonEnv]);
  const venvPython = process.platform === "win32"
    ? join(pythonEnv, "Scripts", "python.exe")
    : join(pythonEnv, "bin", "python");
  const venvCli = process.platform === "win32"
    ? join(pythonEnv, "Scripts", "chatgpt-thread.exe")
    : join(pythonEnv, "bin", "chatgpt-thread");
  run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", specs.pythonSpec]);
  const backendLiteral = backendPath.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const pythonCheck = [
    "from importlib.metadata import version",
    `import ${PYTHON_IMPORT}`,
    `assert version('${PYPI_PACKAGE}') == '${versions.pythonVersion}'`,
    `from ${PYTHON_IMPORT} import BackendClient, ChatGPT, StdioBackendTransport`,
    `transport = StdioBackendTransport(command=['node', r'${backendLiteral}'], timeout_seconds=30)`,
    "client = BackendClient(transport)",
    "health = client.health()",
    "assert health['ok'] is True and health['status'] == 'ok'",
    "capabilities = client.capabilities()",
    `assert capabilities['protocolVersion'] == '${REQUEST_SCHEMA}'`,
    "assert isinstance(client.request('commands'), list)",
    "client.close()"
  ].join("; ");
  run(venvPython, ["-c", pythonCheck]);
  run(venvCli, ["--help"]);
  return {
    nodeVersion: installedNode.version,
    pythonVersion: versions.pythonVersion,
    backendProtocol: capabilities.protocolVersion
  };
}

function backendRequest(backendPath, commandName) {
  return new Promise((resolveRequest, rejectRequest) => {
    const child = spawn("node", [backendPath], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      callback(value);
    };
    const timer = setTimeout(
      () => finish(rejectRequest, new Error(`Installed backend ${commandName} request timed out`)),
      30_000
    );
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdout.on("data", chunk => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(stdout.slice(0, newline));
        if (response.schemaVersion !== RESPONSE_SCHEMA || response.ok !== true) {
          throw new Error(`Unexpected backend response: ${stdout.slice(0, newline)}`);
        }
        finish(resolveRequest, response.result);
      } catch (error) {
        finish(rejectRequest, error);
      }
    });
    child.on("error", error => finish(rejectRequest, error));
    child.on("exit", code => {
      if (!settled) {
        finish(rejectRequest, new Error(`Installed backend exited ${String(code)}: ${stderr.trim()}`));
      }
    });
    child.stdin.write(`${JSON.stringify({
      schemaVersion: REQUEST_SCHEMA,
      command: commandName,
      payload: {},
      requestId: `registry_install_smoke_${commandName.replaceAll(".", "_")}`
    })}\n`);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const versions = await metadata();
  const root = await mkdtemp(join(tmpdir(), "codex-chatgpt-control-release-smoke-"));
  try {
    const specs = options.mode === "source"
      ? await sourceSpecs(root)
      : await registrySpecs(versions, options.timeoutMs);
    const verified = await installAndVerify(root, specs, versions);
    console.log(JSON.stringify({ ok: true, mode: options.mode, ...verified }, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
