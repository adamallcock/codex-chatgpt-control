import { describe, expect, it } from "vitest";
import { childTimeoutMs, createDeadline, remainingMs } from "../../src/commands/deadline.js";
import { createSingleFlightProbe } from "../../src/commands/probes.js";

describe("deadline helpers", () => {
  it("clamps remaining time and child probe timeouts to the parent deadline", () => {
    const deadline = createDeadline(1000, 10_000);

    expect(remainingMs(deadline, 10_250)).toBe(750);
    expect(remainingMs(deadline, 11_500)).toBe(0);
    expect(childTimeoutMs(deadline, 500, 10_250)).toBe(500);
    expect(childTimeoutMs(deadline, 900, 10_250)).toBe(750);
  });
});

describe("single-flight DOM probes", () => {
  it("reports that timeout only stops waiting and does not cancel browser work", async () => {
    const probe = createSingleFlightProbe("assistant progress", async () => new Promise<string>(() => {}));

    const result = await probe(undefined, createDeadline(50), { timeoutMs: 1 });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.timedOut).toBe(true);
    expect(result.warnings.join(" ")).toContain("did not cancel browser-side work");
  });

  it("does not start a second probe while timed-out browser work is still in flight", async () => {
    let starts = 0;
    let resolveProbe: ((value: string) => void) | undefined;
    const probe = createSingleFlightProbe("generation state", async () => {
      starts += 1;
      return new Promise<string>(resolve => {
        resolveProbe = resolve;
      });
    });

    const first = await probe(undefined, createDeadline(50), { timeoutMs: 1 });
    const second = await probe(undefined, createDeadline(50), { timeoutMs: 1 });

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.skipped).toBe(true);
    expect(starts).toBe(1);

    resolveProbe?.("settled");
  });
});
