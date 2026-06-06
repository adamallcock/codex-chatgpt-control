import { describe, expect, it } from "vitest";
import { validateParitySuite } from "../../src/testing/parity-suite.js";

const packageRoot = new URL("../../", import.meta.url);

describe("polyglot parity coverage suite", () => {
  it("keeps fixtures, backend commands, docs, tests, and gates tied to one matrix", () => {
    const report = validateParitySuite(packageRoot);

    expect(report.surfaceCount).toBeGreaterThanOrEqual(6);
    expect(report.fixtureCount).toBeGreaterThanOrEqual(30);
    expect(report.commandCount).toBeGreaterThanOrEqual(35);
    expect(report.gateCount).toBeGreaterThanOrEqual(10);
    expect(report.coveredFixtures).toEqual(report.manifestFixtures);
    expect(report.coveredCommands).toEqual(report.sourceCommands);
  });
});
