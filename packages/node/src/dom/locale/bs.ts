import type { LocaleContribution } from "./types.js";

/**
 * Bosnian (bs-BA). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=bs-BA, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const bs = {
  configurationAxes: {
    power: ["Snaga"],
    model: ["Odaberi model"],
    effort: ["Napor", "Snaga"],
    speed: ["Brzina"],
    advanced: ["Napredno"],
  },
  configurationOptions: {
    instant: ["Brzo"],
    light: ["Lagano"],
    medium: ["Srednja", "Srednji"],
    high: ["Visoka", "Visoki"],
    extraHigh: ["Veoma visoka", "Veoma visoki"],
    max: ["Maks."],
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
  modeLabels: ["Brzo", "Srednji", "Visoko", "Vrlo visoko", "Srednja", "Visoka", "Veoma visoka", "Visoki", "Veoma visoki"],
  modeOptions: {
    instant: ["Brzo"],
    medium: ["Srednji", "Srednja"],
    high: ["Visoko", "Visoka", "Visoki"],
    extraHigh: ["Vrlo visoko", "Veoma visoka", "Veoma visoki"],
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
