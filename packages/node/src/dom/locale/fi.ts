import type { LocaleContribution } from "./types.js";

/**
 * Finnish (fi-FI). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=fi-FI, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const fi = {
  configurationAxes: {
    power: ["Teho"],
    model: ["Malli", "Valitse malli"],
    effort: ["Määrä", "Päättelytaso", "Teho"],
    speed: ["Nopeus"],
    advanced: ["Lisäasetukset"],
  },
  configurationOptions: {
    instant: ["Välitön"],
    light: ["Kevyt"],
    medium: ["Keskitaso"],
    high: ["Korkea"],
    extraHigh: ["Erittäin korkea"],
    max: ["Maksimi"],
    standard: ["Perustaso"],
    fast: ["Nopea"],
  },
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
