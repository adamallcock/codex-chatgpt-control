import { describe, expect, it } from "vitest";
import {
  assignOrderedChatConfigurationRows,
  assignChatSelectedSurfaceOptions,
  assignOrderedSurfaceOptions,
  assignOrderedWorkConfigurationRows
} from "../../src/scripts/locale-capture/surface-graph.js";
import {
  parseArgs,
  simplifiedSliderStepKey,
  simplifiedSliderValue,
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

  it("assigns Chat model and effort axes by stable menu order", () => {
    const rows = ["Modell", "Aufwand"].map(axisLabel => ({
      label: axisLabel,
      axisLabel,
      options: []
    }));
    expect(assignOrderedChatConfigurationRows(rows).map(row => row.axis)).toEqual([
      "model",
      "effort"
    ]);
  });

  it("fails closed on ambiguous radios or configuration rows", () => {
    expect(() => assignOrderedSurfaceOptions([{ label: "Chat", checked: true }])).toThrow("Expected ordered Chat and Work radios");
    expect(() => assignOrderedChatConfigurationRows([])).toThrow("Expected two ordered Chat configuration rows");
    expect(() => assignOrderedWorkConfigurationRows([])).toThrow("Expected three ordered Work configuration rows");
  });

  it("keeps an unrendered simplified Work speed row structurally ordered", () => {
    const rows = [
      { label: "Modell auswählen", axisLabel: "Modell auswählen", options: [] },
      { label: "Leistung", axisLabel: "Leistung", options: [] },
      { label: "", axisLabel: "", options: [] }
    ];
    expect(assignOrderedWorkConfigurationRows(rows)).toEqual([
      { ...rows[0], axis: "model" },
      { ...rows[1], axis: "effort" },
      { ...rows[2], axis: "speed" }
    ]);
  });

  it("reads localized Power values from aria text or an ordinal description", () => {
    expect(simplifiedSliderValue("Medium", ["ignored, 2 of 5."])).toBe("Medium");
    expect(simplifiedSliderValue(undefined, ["متوسط، 2 من 5."])).toBe("متوسط");
    expect(simplifiedSliderValue("", ["मध्यम, 2/5"])).toBe("मध्यम");
    expect(simplifiedSliderValue("", ["即时，第 2 项，共 5 项"])).toBe("即时");
    expect(simplifiedSliderValue("", ["متوسط، ٢ من ٥."])).toBe("متوسط");
    expect(simplifiedSliderValue("", ["中程度、2/5"])).toBe("中程度");
    expect(simplifiedSliderValue("", ["ቅጽበታዊ፣ ከ 5 2ኛ"])).toBe("ቅጽበታዊ");
    expect(simplifiedSliderValue("", ["Шуурхай, нийт 5-аас 2"])).toBe("Шуурхай");
  });

  it("moves the Power slider in its rendered text direction", () => {
    expect(simplifiedSliderStepKey("ltr", true)).toBe("ArrowRight");
    expect(simplifiedSliderStepKey("ltr", false)).toBe("ArrowLeft");
    expect(simplifiedSliderStepKey("rtl", true)).toBe("ArrowLeft");
    expect(simplifiedSliderStepKey("rtl", false)).toBe("ArrowRight");
  });
});
