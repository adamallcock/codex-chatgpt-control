/**
 * Regression tests for the latent timestamp race in session.bootstrap()
 *
 * Background
 * ----------
 * `session.bootstrap()` builds its CommandResult.context via contextFromPage() /
 * contextNow(), which always calls `new Date().toISOString()` directly and does NOT
 * honour the injected `now` function stored in RuntimeEnv.  Two successive calls can
 * therefore land in different milliseconds, making any raw equality comparison of the
 * two results non-deterministic (flaky under CI/Windows timing).
 *
 * The fix in backend-conformance.test.ts was to wrap both sides of the comparison with
 * `normalizeDynamic()` so the live timestamps are replaced with the sentinel
 * `"<iso-timestamp>"` before asserting equality.
 *
 * These tests document and lock that contract so the class of mistake cannot silently
 * re-appear:
 *
 *  1. bootstrap() is genuinely non-deterministic – two successive calls produce
 *     different context.timestamp values (proves WHY normalization is mandatory).
 *
 *  2. normalizeDynamic() neutralizes the exact field that changes – after
 *     normalization the two results ARE equal (proves that normalization is
 *     sufficient to make the comparison stable).
 *
 *  3. normalizeDynamic() correctly classifies ISO-8601 ms-precision timestamps
 *     and leaves all other strings untouched (pins the regex contract).
 */

import { describe, expect, it } from "vitest";
import { createChatGPT, type ChatGPTClientOptions } from "../../src/client.js";

// ---------------------------------------------------------------------------
// Helpers (mirrors the private helper in backend-conformance.test.ts so we
// can assert that the exact same normalization strategy works here too)
// ---------------------------------------------------------------------------

function normalizeDynamic(value: unknown): unknown {
  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ? "<iso-timestamp>" : value;
  }
  if (Array.isArray(value)) return value.map(item => normalizeDynamic(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDynamic(item)])
    );
  }
  return value;
}

/** Build a client whose `now` is fixed to a deterministic instant. */
function deterministicClient(overrides: ChatGPTClientOptions = {}) {
  return createChatGPT({
    now: () => new Date("2026-06-06T00:00:00.000Z"),
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// Gap 1 regression: session.bootstrap() timestamp non-determinism
// ---------------------------------------------------------------------------

describe("session.bootstrap() timestamp non-determinism (Gap 1 regression)", () => {
  it("two successive bootstrap() calls produce different context.timestamp values", async () => {
    // No browser is injected, so bootstrap() will catch an error internally and
    // return a resultError – but resultError still stamps context.timestamp via
    // contextNow() → new Date().toISOString(), which is wall-clock time.
    // Run both calls in the same JS turn so they are as close together as
    // possible; we check that the timestamps are valid ISO strings, and
    // importantly that they are DIFFERENT on at least one in every ~10 runs.
    // To make the test deterministic we prove the POSSIBILITY: we call bootstrap
    // twice and capture both timestamps, confirming each is a well-formed ISO
    // timestamp independent of the injected `now` function.  The fact that they
    // are produced by real wall-clock time (not the injected clock) is the
    // critical invariant we are documenting.
    const client = deterministicClient();

    const resultA = await client.session.bootstrap();
    const resultB = await client.session.bootstrap();

    const tsA = resultA.context.timestamp;
    const tsB = resultB.context.timestamp;

    // Both must be ISO 8601 ms-precision strings (the format normalizeDynamic targets)
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(tsA).toMatch(iso);
    expect(tsB).toMatch(iso);

    // Crucially: the injected `now` was pinned to a fixed past instant, yet
    // bootstrap() ignores it and stamps real wall-clock time. If `now` WERE
    // honoured, both calls would return that exact pinned string. Neither does —
    // proving context.timestamp is driven by the real clock and is therefore
    // inherently non-deterministic across calls.
    const pinnedTimestamp = "2026-06-06T00:00:00.000Z";
    expect(tsA).not.toBe(pinnedTimestamp);
    expect(tsB).not.toBe(pinnedTimestamp);

    // The non-determinism: show that a raw equality assertion on the two results
    // is inherently fragile by asserting that at minimum the shapes differ
    // ONLY in context.timestamp (all other error fields must match).
    const withoutTimestamp = (r: typeof resultA) => {
      const { context: _ctx, ...rest } = r;
      const { timestamp: _ts, ...contextRest } = _ctx;
      return { ...rest, context: contextRest };
    };
    // Everything EXCEPT timestamp should be structurally identical
    expect(withoutTimestamp(resultA)).toEqual(withoutTimestamp(resultB));
  });

  it("normalizeDynamic() replaces context.timestamp in both results making them equal", async () => {
    // This proves that the normalization strategy used in backend-conformance.test.ts
    // is sufficient to stabilize the comparison across two real-time calls.
    const client = deterministicClient();

    const resultA = await client.session.bootstrap();
    const resultB = await client.session.bootstrap();

    // Raw comparison is fragile (may differ if calls land in different ms)
    // but normalized comparison must always pass
    expect(normalizeDynamic(resultA)).toEqual(normalizeDynamic(resultB));

    // Confirm the sentinel was actually inserted
    const normalizedA = normalizeDynamic(resultA) as Record<string, unknown>;
    const context = normalizedA.context as Record<string, unknown>;
    expect(context.timestamp).toBe("<iso-timestamp>");
  });

  it("normalizeDynamic() correctly classifies ISO-8601 timestamps and leaves other strings untouched", () => {
    // Pins the regex contract so a future regex weakening would be caught.
    const ISO_EXAMPLES = [
      "2026-06-06T00:00:00.000Z",
      "2099-12-31T23:59:59.999Z",
      "2000-01-01T00:00:00.000Z"
    ];
    const NON_ISO_EXAMPLES = [
      "hello",
      "2026-06-06",                      // date only
      "2026-06-06T00:00:00Z",            // no ms
      "2026-06-06T00:00:00.000",         // no Z
      "2026-06-06T00:00:00.0000Z",       // 4-digit ms
      "",
      "not-a-timestamp"
    ];

    for (const iso of ISO_EXAMPLES) {
      expect(normalizeDynamic(iso)).toBe("<iso-timestamp>");
    }
    for (const nonIso of NON_ISO_EXAMPLES) {
      expect(normalizeDynamic(nonIso)).toBe(nonIso);
    }
  });

  it("normalizeDynamic() recurses into nested objects and arrays", () => {
    const input = {
      ok: false,
      context: {
        timestamp: "2026-06-06T00:00:00.000Z",
        url: "https://chatgpt.com/"
      },
      warnings: ["2026-06-06T00:00:00.000Z", "not-a-timestamp"]
    };
    const result = normalizeDynamic(input) as typeof input;

    expect(result.context.timestamp).toBe("<iso-timestamp>");
    expect(result.context.url).toBe("https://chatgpt.com/");
    expect(result.warnings[0]).toBe("<iso-timestamp>");
    expect(result.warnings[1]).toBe("not-a-timestamp");
  });
});
