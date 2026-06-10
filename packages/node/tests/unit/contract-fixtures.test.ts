import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const contractRoot = new URL("../../contracts/v1/", import.meta.url);

describe("contract fixtures", () => {
  it("has a manifest that names every fixture", () => {
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", contractRoot), "utf8"));
    const fixtureDir = new URL("fixtures/", contractRoot);
    const actual = readdirSync(fixtureDir)
      .filter(name => name.endsWith(".json") || name.endsWith(".ndjson"))
      .sort();

    expect(manifest.fixtures.map((fixture: { file: string }) => fixture.file).sort()).toEqual(actual);
  });

  it("covers the parity suite fixture matrix", () => {
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", contractRoot), "utf8"));
    const matrix = JSON.parse(readFileSync(new URL("parity-suite.json", contractRoot), "utf8"));
    const fixtureCases = manifest.fixtures.map((fixture: { case: string }) => fixture.case);
    const cases = new Set(fixtureCases);
    const listed = manifest.fixtures.map((fixture: { file: string }) => fixture.file).sort();
    const required = [
      ...matrix.surfaces.flatMap((surface: { fixtures?: string[] }) => surface.fixtures ?? []),
      ...Object.values(matrix.backendCommands).flatMap((coverage: unknown) => (
        (coverage as { fixtures?: string[] }).fixtures ?? []
      ))
    ].sort();

    expect(fixtureCases.sort()).toEqual([...cases].sort());
    expect([...new Set(required)].sort()).toEqual(listed);
  });

  it("keeps success fixtures semantically successful and host-independent", () => {
    const filesPreflight = readFixture("files-preflight-success.json");
    const projectSources = readFixture("project-sources-plan-add.json");
    const doctor = readFixture("doctor-scenario-preflight.json");
    const reports = readFixture("reports-create-redacted.json");

    expect(filesPreflight.result).toMatchObject({
      ok: true,
      status: "ok",
      data: { totalBytes: 16 }
    });
    expect(filesPreflight.result.data.files.map((file: { name: string }) => file.name)).toEqual(["spec.md", "context.json"]);

    expect(projectSources.result).toMatchObject({
      ok: true,
      status: "ok",
      data: {
        operation: "append_add",
        projectId: "g-p-example",
        totalBytes: 16
      }
    });
    expect(projectSources.result.data.batches).toHaveLength(2);

    expect(doctor.result.data.checks.file_preflight).toMatchObject({
      status: "ok",
      details: { totalBytes: 16 }
    });

    const serializedReports = JSON.stringify(reports);
    expect(serializedReports).toContain("/tmp/codex-chatgpt-control/reports/contract-fixtures/");
    expect(serializedReports).not.toMatch(/[A-Za-z]:[\\/]/);
  });
});

function readFixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}`, contractRoot), "utf8"));
}
