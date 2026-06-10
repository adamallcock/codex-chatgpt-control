import { describe, expect, it } from "vitest";
import {
  collectSurfaceDriftModel,
  validateSurfaceDrift,
  validateSurfaceDriftModel,
  type SurfaceDriftModel
} from "../../src/testing/surface-drift.js";

describe("surface drift gate", () => {
  it("passes for the checked-in registry, protocol, fixtures, docs, and Python facade", () => {
    const report = validateSurfaceDrift();

    expect(report.commandCount).toBeGreaterThanOrEqual(45);
    expect(report.blockerKindCount).toBeGreaterThanOrEqual(15);
    expect(report.pythonCommandCount).toBeGreaterThanOrEqual(40);
    expect(report.generatedDocsChecked).toBeGreaterThanOrEqual(2);
    expect(report.docAnchorsChecked).toBeGreaterThanOrEqual(8);
  });

  it("fails when a backend command is missing from command descriptors without an exemption", () => {
    const model = currentModel();
    model.commandDescriptors = model.commandDescriptors.filter(descriptor => descriptor.name !== "files.preflight");
    model.commandDescriptorFixtureNames = model.commandDescriptorFixtureNames.filter(name => name !== "files.preflight");

    expect(expectErrors(model)).toContain("backend command files.preflight is missing from command descriptors and has no exemption");
  });

  it("fails when a command descriptor references an unknown blocker kind", () => {
    const model = currentModel();
    model.commandDescriptors = model.commandDescriptors.map(descriptor => descriptor.name === "messages.ask"
      ? { ...descriptor, blockers: [...descriptor.blockers, "surprise_blocker"] }
      : descriptor);

    expect(expectErrors(model)).toContain("command descriptor messages.ask references unknown blocker surprise_blocker");
  });

  it("fails when generated blocker docs are stale", () => {
    const model = currentModel();
    const troubleshooting = model.docs["references/troubleshooting.md"];
    expect(troubleshooting).toBeTypeOf("string");
    if (troubleshooting === undefined) throw new Error("Expected troubleshooting docs in surface model.");
    model.docs["references/troubleshooting.md"] = troubleshooting.replace("- `upload_failed`", "- `upload_failed_stale`");

    expect(expectErrors(model)).toContain("generated blocker coverage section is stale in references/troubleshooting.md");
  });

  it("accepts generated blocker docs with CRLF checkout line endings", () => {
    const model = currentModel();
    for (const docPath of model.policy.generatedBlockerDocs) {
      const text = model.docs[docPath];
      if (text !== undefined) {
        model.docs[docPath] = toCrlfLineEndings(text);
      }
    }

    const result = validateSurfaceDriftModel(model);

    expect(result.ok).toBe(true);
  });

  it("fails when a non-exempt backend command is missing from the Python facade", () => {
    const model = currentModel();
    model.pythonCommands = model.pythonCommands.filter(command => command !== "projects.sources.add");

    expect(expectErrors(model)).toContain("backend command projects.sources.add is missing from Python facade coverage and has no exemption");
  });
});

function currentModel(): SurfaceDriftModel {
  return collectSurfaceDriftModel();
}

function expectErrors(model: SurfaceDriftModel): string[] {
  const result = validateSurfaceDriftModel(model);
  expect(result.ok).toBe(false);
  return result.errors;
}

function toCrlfLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
}
