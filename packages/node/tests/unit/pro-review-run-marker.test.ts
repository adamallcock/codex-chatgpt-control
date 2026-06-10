import { describe, expect, it } from "vitest";
import {
  appendProReviewRunMarker,
  parseProReviewRunMarker,
  renderProReviewRunMarker
} from "../../src/pro-review/run-marker.js";

describe("Pro review run marker", () => {
  it("renders and parses run identity hashes", () => {
    const marker = {
      runId: "run-123",
      promptSha256: "p".repeat(64),
      zipSha256: "z".repeat(64),
      zipName: "review.zip",
      zipBytes: 123
    };

    expect(parseProReviewRunMarker(renderProReviewRunMarker(marker))).toEqual(marker);
  });

  it("appends the marker once for the same run id", () => {
    const marker = {
      runId: "run-123",
      promptSha256: "p".repeat(64),
      zipSha256: "z".repeat(64)
    };

    const once = appendProReviewRunMarker("Review this.", marker);
    const twice = appendProReviewRunMarker(once, marker);

    expect(twice).toBe(once);
    expect(once).toContain("## Codex ChatGPT Pro Review Run");
    expect(once).toContain("runId: run-123");
  });
});
