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
});
