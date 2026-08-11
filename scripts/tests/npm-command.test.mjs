import assert from "node:assert/strict";
import test from "node:test";

import { npmInvocation } from "../lib/npm-command.mjs";

test("uses npm_execpath through the active Node executable", () => {
  const invocation = npmInvocation(["pack", "--json"], {
    platform: "win32",
    env: { npm_execpath: "C:\\npm\\npm-cli.js" },
    execPath: "C:\\node\\node.exe",
    existsSync: candidate => candidate === "C:\\npm\\npm-cli.js"
  });

  assert.deepEqual(invocation, {
    program: "C:\\node\\node.exe",
    args: ["C:\\npm\\npm-cli.js", "pack", "--json"]
  });
});

test("finds npm beside Node when npm_execpath is absent", () => {
  const expectedCli = "C:\\node\\node_modules\\npm\\bin\\npm-cli.js";
  const invocation = npmInvocation(["run", "build"], {
    platform: "win32",
    env: {},
    execPath: "C:\\node\\node.exe",
    existsSync: candidate => candidate === expectedCli
  });

  assert.deepEqual(invocation, {
    program: "C:\\node\\node.exe",
    args: [expectedCli, "run", "build"]
  });
});

test("falls back to PATH npm on non-Windows platforms", () => {
  assert.deepEqual(npmInvocation(["view", "example"], {
    platform: "linux",
    env: {},
    execPath: "/usr/bin/node",
    existsSync: () => false
  }), {
    program: "npm",
    args: ["view", "example"]
  });
});

test("fails clearly when Windows npm cannot be resolved safely", () => {
  assert.throws(
    () => npmInvocation([], {
      platform: "win32",
      env: {},
      execPath: "C:\\node\\node.exe",
      existsSync: () => false
    }),
    /Unable to locate npm-cli\.js/
  );
});
