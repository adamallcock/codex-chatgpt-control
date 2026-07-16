import { describe, expect, it } from "vitest";
import { detectExperienceFromSnapshot } from "../../src/commands/experience.js";
import {
  buildSurfaceProfileDraft,
  parseArgs
} from "../../src/scripts/capture-surface-profile.js";
import type { ConfigurationInspectionData } from "../../src/types.js";

describe("surface profile capture drafts", () => {
  it("defaults contribution metadata to unverified non-identifying values", () => {
    const options = parseArgs(["--id", "work-basic-en"]);

    expect(options).toMatchObject({
      id: "work-basic-en",
      region: "not-recorded",
      accountScope: "not-recorded",
      planScope: "not-recorded",
      workspaceScope: "not-recorded",
      supportState: "unverified",
      ifMissing: "block"
    });
    expect(options.out.replaceAll("\\", "/")).toContain("outputs/surface-profiles/");
  });

  it("rejects account and rollout metadata that is not a normalized slug", () => {
    expect(() => parseArgs([
      "--id",
      "work-basic-en",
      "--account-scope",
      "Personal Account Name"
    ])).toThrow("normalized lowercase slug");
  });

  it("sanitizes conversation identity and excludes page conversation text", () => {
    const snapshot = {
      url: "https://chatgpt.com/c/private-conversation-id?temporary=1",
      composerLabels: ["Work on anything", "PRIVATE DRAFT PROMPT"],
      mainControls: ["5.6 Sol Light", "private-attachment-name.pdf"],
      mainText: "Work on something else PRIVATE RESPONSE CONTENT"
    };
    const detected = detectExperienceFromSnapshot(snapshot);
    const inspection: ConfigurationInspectionData = {
      experience: "work",
      selectorProfile: "work_basic_v1",
      availableAxes: ["model", "effort", "speed"],
      active: {
        model: "GPT-5.6 Sol",
        effort: "Light",
        speed: "Standard"
      },
      options: {},
      verified: true,
      evidence: detected.evidence
    };

    const profile = buildSurfaceProfileDraft({
      id: "work-basic-en",
      region: "not-recorded",
      accountScope: "not-recorded",
      planScope: "not-recorded",
      workspaceScope: "not-recorded",
      supportState: "unverified",
      provenance: "Sanitized test capture."
    }, "en-US", snapshot, detected, inspection, "2026-07-16");

    expect(profile.snapshot.url).toBe("https://chatgpt.com/c/sanitized");
    expect(profile.snapshot.composerLabels).toEqual(["work on anything"]);
    expect(profile.snapshot.composerLabels).not.toContain("PRIVATE DRAFT PROMPT");
    expect(profile.snapshot.mainControls).not.toContain("private-attachment-name.pdf");
    expect(profile.snapshot.mainText).not.toContain("PRIVATE RESPONSE CONTENT");
    expect(detectExperienceFromSnapshot(profile.snapshot).experience).toBe("work");
    expect(profile.expected).toMatchObject({
      experience: "work",
      selectorProfile: "work_basic_v1",
      availableAxes: ["model", "effort", "speed"]
    });
    expect(profile.schemaVersion).toBe("chatgpt.browser_control.surface_profile.v1");
    expect(profile.panel.axisRows).toHaveLength(3);
  });
});
