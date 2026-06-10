import type { LocaleContribution } from "./types.js";

/**
 * Finnish (fi-FI). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=fi-FI, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Laajennettu" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const fi = {
  composerTextbox: ["Keskustele ChatGPT:n kanssa"],
  sendButton: ["Lähetä kehote"],
  searchChatsButton: ["Hae keskusteluista"],
  searchChatsPlaceholder: ["Hae keskusteluista..."],
  newChat: ["Uusi keskustelu"],
  addFilesButton: ["Lisää tiedostoja ynnä muuta"],
  addFilesOpenerCandidates: ["Lisää tiedostoja ynnä muuta"],
  addPhotosFilesMenuItem: ["Lisää valokuvia & tiedostoja"],
  copyResponse: ["Kopioi vastaus"],
  modeOpenerExtra: ["Määritä..."],
  tools: {
    web_search: ["Verkkohaku"],
    deep_research: ["Syvätutkimus"],
    create_image: ["Luo kuva"],
  },
  signedInMarkers: ["Uusi keskustelu", "Hae keskusteluista", "Äskettäiset", "Keskusteluhistoria", "Projektit", "Keskustele ChatGPT:n kanssa"],
  responseActions: ["Kopioi vastaus"],
} satisfies LocaleContribution;
