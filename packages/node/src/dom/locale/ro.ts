import type { LocaleContribution } from "./types.js";

/**
 * Romanian (ro-RO). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ro-RO, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const ro = {
  composerTextbox: ["Întreabă orice"],
  sendButton: ["Trimite solicitarea"],
  searchChatsButton: ["Caută discuții"],
  searchChatsPlaceholder: ["Caută discuții..."],
  newChat: ["Discuție nouă"],
  addFilesButton: ["Adaugă fișiere și multe altele"],
  addFilesOpenerCandidates: ["Adaugă fișiere și multe altele"],
  addPhotosFilesMenuItem: ["Încarcă fotografii și fișiere"],
  copyResponse: ["Copiază răspunsul"],
  modeOpenerExtra: ["Configurează..."],
  tools: {
    web_search: ["Căutare pe internet"],
    deep_research: ["Cercetare aprofundată"],
    create_image: ["Creează o imagine"],
  },
  signedInMarkers: ["Discuție nouă", "Caută discuții", "Recente", "Istoricul discuțiilor", "Proiecte", "Întreabă orice"],
  responseActions: ["Copiază răspunsul"],
} satisfies LocaleContribution;
