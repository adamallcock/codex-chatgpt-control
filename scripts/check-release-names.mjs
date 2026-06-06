#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import https from "node:https";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const npmPackage = "codex-chatgpt-control";
const pypiPackage = "codex-chatgpt-control";

async function readNodeVersion() {
  const pkg = JSON.parse(await readFile(new URL("../packages/node/package.json", import.meta.url), "utf8"));
  return String(pkg.version);
}

async function readPythonVersion() {
  const pyproject = await readFile(new URL("../packages/python/pyproject.toml", import.meta.url), "utf8");
  const match = pyproject.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("Unable to find Python version in packages/python/pyproject.toml");
  return match[1];
}

async function npmView(spec) {
  try {
    const { stdout } = await execFileAsync("npm", ["view", spec, "name", "version", "--json"], {
      maxBuffer: 1024 * 1024
    });
    return { exists: true, data: JSON.parse(stdout) };
  } catch (error) {
    const combined = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    if (combined.includes("E404")) return { exists: false };
    throw error;
  }
}

function pypiJson(name) {
  return new Promise((resolve, reject) => {
    const request = https.get(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
      headers: { "User-Agent": "codex-chatgpt-control-release-preflight" },
      timeout: 15_000
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode === 404) {
          resolve({ exists: false });
          return;
        }
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`PyPI returned HTTP ${response.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        resolve({ exists: true, data: JSON.parse(body) });
      });
    });
    request.on("timeout", () => request.destroy(new Error("PyPI request timed out")));
    request.on("error", reject);
  });
}

async function main() {
  const nodeVersion = await readNodeVersion();
  const pythonVersion = await readPythonVersion();

  const npmPackageState = await npmView(npmPackage);
  const npmVersionState = await npmView(`${npmPackage}@${nodeVersion}`);
  const pypiState = await pypiJson(pypiPackage);
  const pypiVersionExists = pypiState.exists
    && Object.prototype.hasOwnProperty.call(pypiState.data.releases ?? {}, pythonVersion)
    && (pypiState.data.releases[pythonVersion] ?? []).length > 0;

  const summary = {
    npm: {
      package: npmPackage,
      version: nodeVersion,
      packageExists: npmPackageState.exists,
      versionExists: npmVersionState.exists
    },
    pypi: {
      package: pypiPackage,
      version: pythonVersion,
      packageExists: pypiState.exists,
      versionExists: pypiVersionExists
    }
  };

  console.log(JSON.stringify(summary, null, 2));

  if (npmVersionState.exists || pypiVersionExists) {
    console.error("Refusing release: at least one target version is already published.");
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
