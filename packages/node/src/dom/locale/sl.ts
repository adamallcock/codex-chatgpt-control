import type { LocaleContribution } from "./types.js";

/**
 * Slovenian (sl-SI). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sl-SI, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const sl = {
  configurationAxes: {
    effort: ["Napor"],
    speed: ["Hitrost"],
  },
  configurationOptions: {
    light: ["Osnovno"],
    medium: ["Srednje"],
    high: ["Visoko"],
    extraHigh: ["Zelo visoko"],
    standard: ["Standardno"],
    fast: ["Hitro"],
  },
  composerTextbox: ["Vprašajte kar koli"],
  sendButton: ["Pošlji poziv"],
  searchChatsButton: ["Išči po klepetih"],
  searchChatsPlaceholder: ["Išči po klepetih …"],
  newChat: ["Nov klepet"],
  addFilesButton: ["Dodaj datoteke in še več"],
  addFilesOpenerCandidates: ["Dodaj datoteke in še več"],
  addPhotosFilesMenuItem: ["Naloži fotografije in datoteke"],
  copyResponse: ["Kopiraj odgovor"],
  modeLabels: ["Takoj", "Srednja", "Visoka", "Zelo visoko", "Srednje", "Visoko"],
  modeOptions: {
    instant: ["Takoj"],
    medium: ["Srednja", "Srednje"],
    high: ["Visoka", "Visoko"],
    extraHigh: ["Zelo visoko"],
  },
  modeOpenerExtra: ["Konfiguracija …"],
  tools: {
    web_search: ["Iskanje po spletu"],
    deep_research: ["Poglobljeno raziskovanje"],
    create_image: ["Ustvari sliko"],
  },
  signedInMarkers: ["Nov klepet", "Išči po klepetih", "Nedavno", "Zgodovina klepetov", "Projekti", "Vprašajte kar koli"],
  responseActions: ["Kopiraj odgovor"],
  stopControl: ["Ustavi odgovarjanje"],
} satisfies LocaleContribution;
