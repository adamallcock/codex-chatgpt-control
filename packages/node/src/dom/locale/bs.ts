import type { LocaleContribution } from "./types.js";

/**
 * Bosnian (bs-BA). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=bs-BA, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const bs = {
  configurationAxes: {
    effort: ["Napor"],
    speed: ["Brzina"],
  },
  configurationOptions: {
    light: ["Lagano"],
    medium: ["Srednja"],
    high: ["Visoka"],
    extraHigh: ["Veoma visoka"],
    standard: ["Standardno"],
    fast: ["Brzo"],
  },
  composerTextbox: ["Razgovarajte pomoću ChatGPT-a"],
  sendButton: ["Pošalji upit"],
  searchChatsButton: ["Pretraži razgovore"],
  searchChatsPlaceholder: ["Pretražuj razgovore..."],
  newChat: ["Novi razgovor"],
  addFilesButton: ["Otpremite datoteke i još mnogo toga"],
  addFilesOpenerCandidates: ["Otpremite datoteke i još mnogo toga"],
  addPhotosFilesMenuItem: ["Dodaj slike i datoteke"],
  copyResponse: ["Kopiraj odgovor"],
  modeLabels: ["Brzo", "Srednji", "Visoko", "Vrlo visoko", "Srednja", "Visoka", "Veoma visoka"],
  modeOptions: {
    instant: ["Brzo"],
    medium: ["Srednji", "Srednja"],
    high: ["Visoko", "Visoka"],
    extraHigh: ["Vrlo visoko", "Veoma visoka"],
  },
  modeOpenerExtra: ["Podesi"],
  tools: {
    web_search: ["Internet pretraga"],
    deep_research: ["Detaljno istraživanje"],
    create_image: ["Kreirajte sliku"],
  },
  signedInMarkers: ["Novi razgovor", "Pretraži razgovore", "Nedavno", "Biblioteka", "Projekti", "Razgovarajte pomoću ChatGPT-a"],
  responseActions: ["Kopiraj odgovor"],
  stopControl: ["Zaustavi odgovaranje"],
} satisfies LocaleContribution;
