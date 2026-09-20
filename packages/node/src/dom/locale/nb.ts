import type { LocaleContribution } from "./types.js";

/**
 * Norwegian Bokmål (nb-NO). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=nb-NO, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const nb = {
  configurationAxes: {
    power: ["Styrke"],
    model: ["Modell", "Velg modell"],
    effort: ["Innsats", "Resonneringsnivå", "Styrke"],
    speed: ["Hastighet"],
    advanced: ["Avansert"],
  },
  configurationOptions: {
    instant: ["Øyeblikkelig"],
    light: ["Lett"],
    medium: ["Middels"],
    high: ["Høy"],
    extraHigh: ["Ekstra høy"],
    max: ["Maks"],
    fast: ["Rask"],
  },
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
  modeOptions: {
    instant: ["Øyeblikkelig"],
    medium: ["Middels"],
    high: ["Høy"],
    extraHigh: ["Ekstra høy"],
  },
  modeOpenerExtra: ["Konfigurer …"],
  tools: {
    web_search: ["Nettsøk"],
    deep_research: ["Dyp forskning"],
    create_image: ["Lag et bilde"],
  },
  signedInMarkers: ["Ny chat", "Søk i samtaler", "Nylige", "Chattehistorikk", "Prosjekter", "Spør om hva som helst"],
  responseActions: ["Kopier svar"],
  stopControl: ["Avbryt svar"],
} satisfies LocaleContribution;
