import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TIMEOUT_MS,
  observeRegistryVersions,
  parseArgs
} from "../verify-release-install.mjs";

const versions = {
  nodeVersion: "0.5.1-alpha.4",
  pythonVersion: "0.5.1a4"
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

test("uses a fifteen-minute default registry propagation window", () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 900_000);
  assert.deepEqual(parseArgs(["--registry"]), {
    mode: "registry",
    timeoutMs: 900_000
  });
});

test("records PyPI observations when npm has not propagated", async () => {
  const requestedUrls = [];
  const observation = await observeRegistryVersions(versions, {
    npmLookup() {
      throw new Error("npm registry E404");
    },
    async fetchImpl(url) {
      requestedUrls.push(url);
      if (url.includes("/pypi/")) {
        return jsonResponse(200, { info: { version: versions.pythonVersion } });
      }
      return jsonResponse(200, {
        files: [{
          filename: "codex_chatgpt_control-" + versions.pythonVersion + "-py3-none-any.whl"
        }]
      });
    }
  });

  assert.equal(observation.ready, false);
  assert.match(observation.status, /npm=unavailable/);
  assert.match(observation.status, /npmError="npm registry E404"/);
  assert.match(observation.status, /pypi=0\.5\.1a4/);
  assert.match(observation.status, /pypiJsonStatus=200/);
  assert.match(observation.status, /pypiSimple=true/);
  assert.match(observation.status, /pypiSimpleStatus=200/);
  assert.deepEqual(requestedUrls, [
    "https://pypi.org/pypi/codex-chatgpt-control/0.5.1a4/json",
    "https://pypi.org/simple/codex-chatgpt-control/"
  ]);
});

test("requires matching npm and both PyPI registry views", async () => {
  const observation = await observeRegistryVersions(versions, {
    npmLookup: () => versions.nodeVersion,
    async fetchImpl(url) {
      if (url.includes("/pypi/")) {
        return jsonResponse(200, { info: { version: versions.pythonVersion } });
      }
      return jsonResponse(200, {
        files: [{
          filename: "codex_chatgpt_control-" + versions.pythonVersion + "-py3-none-any.whl"
        }]
      });
    }
  });

  assert.equal(observation.ready, true);
  assert.doesNotMatch(observation.status, /Error=/);
});
