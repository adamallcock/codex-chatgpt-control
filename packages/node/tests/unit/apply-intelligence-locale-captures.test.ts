import { describe, expect, it } from "vitest";
import { mergeCapture } from "../../src/scripts/apply-intelligence-locale-captures.js";

describe("apply intelligence locale captures", () => {
  it("merges generation-state labels without dropping existing mode options", () => {
    const source = [
      "import type { LocaleContribution } from \"./types.js\";",
      "",
      "export const frFR = {",
      "  modeLabels: [\"Moyen\", \"Avancé\"],",
      "  modeOptions: {",
      "    high: [\"Avancé\"],",
      "  },",
      "  responseActions: [\"Copier la réponse\"],",
      "} satisfies LocaleContribution;",
      ""
    ].join("\n");

    const result = mergeCapture(
      source,
      ["Très élevé"],
      { pro: ["Professionnel"] },
      {
        stopControl: ["Arrêter la réponse"],
        stoppedAssistant: ["Réflexion arrêtée"]
      }
    );

    expect(result).toContain("modeLabels: [\"Moyen\", \"Avancé\", \"Très élevé\"],");
    expect(result).toContain("high: [\"Avancé\"],");
    expect(result).toContain("pro: [\"Professionnel\"],");
    expect(result).toContain("stopControl: [\"Arrêter la réponse\"],");
    expect(result).toContain("stoppedAssistant: [\"Réflexion arrêtée\"],");
  });

  it("dedupes generation-state labels from repeated captures", () => {
    const source = [
      "import type { LocaleContribution } from \"./types.js\";",
      "",
      "export const frFR = {",
      "  modeLabels: [\"Moyen\", \"Avancé\"],",
      "  stopControl: [\"Arrêter la réponse\"],",
      "  stoppedAssistant: [\"Réflexion arrêtée\"],",
      "} satisfies LocaleContribution;",
      ""
    ].join("\n");

    const result = mergeCapture(
      source,
      [],
      {},
      {
        stopControl: ["Arrêter la réponse", "Arrêter la réponse"],
        stoppedAssistant: ["Réflexion arrêtée", "Réflexion arrêtée"]
      }
    );

    expect(result.match(/Arrêter la réponse/g)).toHaveLength(1);
    expect(result.match(/Réflexion arrêtée/g)).toHaveLength(1);
  });

  it("merges localized Chat and Work surface labels without replacing legacy fields", () => {
    const source = [
      "import type { LocaleContribution } from \"./types.js\";",
      "",
      "/** Locale fixture. */",
      "export const de = {",
      "  composerTextbox: [\"Mit ChatGPT chatten\"],",
      "  modeLabels: [\"Sofort\"],",
      "  modeOpenerExtra: [\"Konfigurieren\"],",
      "} satisfies LocaleContribution;",
      ""
    ].join("\n");

    const result = mergeCapture(source, [], {}, {}, {
      workComposerTextbox: ["An etwas arbeiten"],
      experienceOptions: { chat: ["Chatten"], work: ["Arbeiten"] },
      configurationAxes: { model: ["Modell"], effort: ["Aufwand"], speed: ["Geschwindigkeit"] },
      configurationOptions: { light: ["Leicht"], standard: ["Standardmäßig"], fast: ["Schnell"] }
    });

    expect(result).toContain('composerTextbox: ["Mit ChatGPT chatten"],');
    expect(result).toContain('workComposerTextbox: ["An etwas arbeiten"],');
    expect(result).toContain('experienceOptions: {');
    expect(result).toContain('chat: ["Chatten"],');
    expect(result).toContain('work: ["Arbeiten"],');
    expect(result).toContain('model: ["Modell"],');
    expect(result).toContain('effort: ["Aufwand"],');
    expect(result).toContain('light: ["Leicht"],');
    expect(result).toContain('fast: ["Schnell"],');
  });
});
