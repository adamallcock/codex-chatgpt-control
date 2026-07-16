import type { LocaleContribution } from "./types.js";

/**
 * Finnish (fi-FI). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=fi-FI, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["Välitön", "Keskitaso", "Korkea", "Erittäin korkea"],
  modeOptions: {
    instant: ["Välitön"],
    medium: ["Keskitaso"],
    high: ["Korkea"],
    extraHigh: ["Erittäin korkea"],
  },
  modeOpenerExtra: ["Määritä..."],
  tools: {
    web_search: ["Verkkohaku"],
    deep_research: ["Syvätutkimus"],
    create_image: ["Luo kuva"],
  },
  signedInMarkers: ["Uusi keskustelu", "Hae keskusteluista", "Äskettäiset", "Keskusteluhistoria", "Projektit", "Keskustele ChatGPT:n kanssa"],
  responseActions: ["Kopioi vastaus"],
  stopControl: ["Lopeta vastaaminen"],
} satisfies LocaleContribution;
