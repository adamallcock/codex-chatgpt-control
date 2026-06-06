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
});
