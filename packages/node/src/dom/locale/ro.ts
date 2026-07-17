import type { LocaleContribution } from "./types.js";

/**
 * Romanian (ro-RO). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ro-RO, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const ro = {
  configurationAxes: {
    effort: ["Efort"],
    speed: ["Viteză"],
  },
  configurationOptions: {
    light: ["Ușor"],
    medium: ["Medie"],
    high: ["Ridicată"],
    extraHigh: ["Foarte ridicată"],
    fast: ["Rapid"],
  },
  composerTextbox: ["Întreabă orice"],
  sendButton: ["Trimite solicitarea"],
  searchChatsButton: ["Caută discuții"],
  searchChatsPlaceholder: ["Caută discuții..."],
  newChat: ["Discuție nouă"],
  addFilesButton: ["Adaugă fișiere și multe altele"],
  addFilesOpenerCandidates: ["Adaugă fișiere și multe altele"],
  addPhotosFilesMenuItem: ["Încarcă fotografii și fișiere"],
  copyResponse: ["Copiază răspunsul"],
  modeLabels: ["Mediu", "Ridicat", "Foarte ridicată", "Medie", "Ridicată"],
  modeOptions: {
    medium: ["Mediu", "Medie"],
    high: ["Ridicat", "Ridicată"],
    extraHigh: ["Foarte ridicată"],
  },
  modeOpenerExtra: ["Configurează..."],
  tools: {
    web_search: ["Căutare pe internet"],
    deep_research: ["Cercetare aprofundată"],
    create_image: ["Creează o imagine"],
  },
  signedInMarkers: ["Discuție nouă", "Caută discuții", "Recente", "Istoricul discuțiilor", "Proiecte", "Întreabă orice"],
  responseActions: ["Copiază răspunsul"],
  stopControl: ["Oprește răspunsul"],
} satisfies LocaleContribution;
