import type { LocaleContribution } from "./types.js";

/**
 * Slovenian (sl-SI). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sl-SI, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const sl = {
  composerTextbox: ["Vprašajte kar koli"],
  sendButton: ["Pošlji poziv"],
  searchChatsButton: ["Išči po klepetih"],
  searchChatsPlaceholder: ["Išči po klepetih …"],
  newChat: ["Nov klepet"],
  addFilesButton: ["Dodaj datoteke in še več"],
  addFilesOpenerCandidates: ["Dodaj datoteke in še več"],
  addPhotosFilesMenuItem: ["Naloži fotografije in datoteke"],
  copyResponse: ["Kopiraj odgovor"],
  modeLabels: ["Takoj", "Srednja", "Visoka", "Zelo visoko"],
  modeOptions: {
    instant: ["Takoj"],
    medium: ["Srednja"],
    high: ["Visoka"],
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
