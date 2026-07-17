import { describe, expect, it } from "vitest";
import { runReleaseCanary } from "../../src/scripts/release-canary-module.js";

describe("release canary", () => {
  it("requires a bridge-hosted runtime before touching ChatGPT", async () => {
    await expect(runReleaseCanary({}, { tabId: "dedicated-tab" })).rejects.toThrow("bridge-hosted");
  });

  it("requires exact dedicated-tab affinity", async () => {
    await expect(runReleaseCanary({ agent: {} }, { tabId: "  " })).rejects.toThrow("exact dedicated ChatGPT tab id");
  });
});
