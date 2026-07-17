import type { LocaleContribution } from "./types.js";

/**
 * Italian (it-IT). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=it-IT, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const it = {
  configurationAxes: {
    model: ["Modello"],
    effort: ["Sforzo"],
    speed: ["Velocità"],
  },
  configurationOptions: {
    medium: ["Medio"],
    high: ["Alto"],
    extraHigh: ["Molto alto"],
    fast: ["Veloce"],
  },
  composerTextbox: ["Chatta con ChatGPT"],
  sendButton: ["Invia prompt"],
  searchChatsButton: ["Cerca chat"],
  searchChatsPlaceholder: ["Cerca chat…"],
  newChat: ["Nuova chat"],
  addFilesButton: ["Aggiungi file e altro"],
  addFilesOpenerCandidates: ["Aggiungi file e altro"],
  addPhotosFilesMenuItem: ["Aggiungi foto e file"],
  copyResponse: ["Copia risposta"],
  modeLabels: ["Istantanea", "Media", "Alta", "Extra elevata", "Medio", "Alto", "Molto alto"],
  modeOptions: {
    instant: ["Istantanea"],
    medium: ["Media", "Medio"],
    high: ["Alta", "Alto"],
    extraHigh: ["Extra elevata", "Molto alto"],
  },
  modeOpenerExtra: ["Configura"],
  tools: {
    web_search: ["Ricerca sul web"],
    create_image: ["Crea immagine"],
  },
  signedInMarkers: ["Nuova chat", "Cerca chat", "Chat recenti", "Libreria", "Progetti", "Chatta con ChatGPT"],
  responseActions: ["Copia risposta"],
  stopControl: ["Interrompi risposta"],
} satisfies LocaleContribution;
