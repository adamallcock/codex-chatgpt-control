import type { LocaleContribution } from "./types.js";

/**
 * Norwegian Bokmål (nb-NO). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=nb-NO, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 from a visible ChatGPT Pro session.
 */
export const nb = {
  composerTextbox: ["Spør om hva som helst"],
  sendButton: ["Send melding"],
  searchChatsButton: ["Søk i samtaler"],
  searchChatsPlaceholder: ["Søk i chatter ..."],
  newChat: ["Ny chat"],
  addFilesButton: ["Legg til filer med mer"],
  addFilesOpenerCandidates: ["Legg til filer med mer"],
  addPhotosFilesMenuItem: ["Last opp bilder og filer"],
  copyResponse: ["Kopier svar"],
  modeLabels: ["Øyeblikkelig", "Middels", "Høy", "Ekstra høy"],
  modeOpenerExtra: ["Konfigurer …"],
  tools: {
    web_search: ["Nettsøk"],
    deep_research: ["Dyp forskning"],
    create_image: ["Lag et bilde"],
  },
  signedInMarkers: ["Ny chat", "Søk i samtaler", "Nylige", "Chattehistorikk", "Prosjekter", "Spør om hva som helst"],
  responseActions: ["Kopier svar"],
} satisfies LocaleContribution;
