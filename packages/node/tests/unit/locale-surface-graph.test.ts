import { describe, expect, it } from "vitest";
import {
  assignChatSelectedSurfaceOptions,
  assignOrderedSurfaceOptions,
  assignOrderedWorkConfigurationRows
} from "../../src/scripts/locale-capture/surface-graph.js";
import {
  parseArgs,
  surfaceCaptureSucceeded
} from "../../src/scripts/capture-intelligence-locales.js";

describe("locale surface graph", () => {
  it("keeps the expanded surface sweep opt-in and restorable", () => {
    expect(parseArgs(["--auto-switch", "--all"]).captureSurfaces).toBe(false);
    expect(parseArgs(["--auto-switch", "--all", "--capture-surfaces"])).toMatchObject({
      captureSurfaces: true,
      restore: true,
      all: true
    });
  });

  it("preserves the legacy sweep and fails closed when requested surface restoration is incomplete", () => {
    expect(surfaceCaptureSucceeded(false, undefined)).toBe(true);
    expect(surfaceCaptureSucceeded(true, undefined)).toBe(false);
    expect(surfaceCaptureSucceeded(true, { status: "blocked", restoredChat: true })).toBe(false);
    expect(surfaceCaptureSucceeded(true, { status: "ok", restoredChat: false })).toBe(false);
    expect(surfaceCaptureSucceeded(true, { status: "ok", restoredChat: true })).toBe(true);
  });

  it("uses radio order to identify Chat and Work even when Work is selected", () => {
    expect(assignOrderedSurfaceOptions([
      { label: "Chatten", checked: false },
      { label: "Arbeiten", checked: true }
    ])).toEqual({ chatLabel: "Chatten", workLabel: "Arbeiten", selected: "work" });
  });

  it("maps a known selected Chat state without relying on English labels", () => {
    expect(assignChatSelectedSurfaceOptions([
      { label: "Chatten", checked: true },
      { label: "Arbeiten", checked: false }
    ])).toEqual({ chatLabel: "Chatten", workLabel: "Arbeiten" });
  });

  it("assigns the three configuration axes by stable menu order", () => {
    const rows = ["Modell", "Aufwand", "Geschwindigkeit"].map(axisLabel => ({
      label: axisLabel,
      axisLabel,
      options: []
    }));
    expect(assignOrderedWorkConfigurationRows(rows).map(row => row.axis)).toEqual([
      "model",
      "effort",
      "speed"
    ]);
  });

  it("fails closed on ambiguous radios or configuration rows", () => {
    expect(() => assignOrderedSurfaceOptions([{ label: "Chat", checked: true }])).toThrow("Expected ordered Chat and Work radios");
    expect(() => assignOrderedWorkConfigurationRows([])).toThrow("Expected three ordered Work configuration rows");
  });
});
