import type { LocaleContribution } from "./types.js";

/**
 * Slovenian (sl-SI). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sl-SI, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
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
  modeOpenerExtra: ["Konfiguracija …"],
  tools: {
    web_search: ["Iskanje po spletu"],
    deep_research: ["Poglobljeno raziskovanje"],
    create_image: ["Ustvari sliko"],
  },
  signedInMarkers: ["Nov klepet", "Išči po klepetih", "Nedavno", "Zgodovina klepetov", "Projekti", "Vprašajte kar koli"],
  responseActions: ["Kopiraj odgovor"],
} satisfies LocaleContribution;
