import type { LocaleContribution } from "./types.js";

/**
 * Italian (it-IT). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=it-IT, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Esteso" suffix is a descriptor) and `tools.deep_research` ("Deep Research").
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const it = {
  composerTextbox: ["Chatta con ChatGPT"],
  sendButton: ["Invia prompt"],
  searchChatsButton: ["Cerca chat"],
  searchChatsPlaceholder: ["Cerca chat…"],
  newChat: ["Nuova chat"],
  addFilesButton: ["Aggiungi file e altro"],
  addFilesOpenerCandidates: ["Aggiungi file e altro"],
  addPhotosFilesMenuItem: ["Aggiungi foto e file"],
  copyResponse: ["Copia risposta"],
  modeOpenerExtra: ["Configura"],
  tools: {
    web_search: ["Ricerca sul web"],
    create_image: ["Crea immagine"],
  },
  signedInMarkers: ["Nuova chat", "Cerca chat", "Chat recenti", "Libreria", "Progetti", "Chatta con ChatGPT"],
  responseActions: ["Copia risposta"],
} satisfies LocaleContribution;
