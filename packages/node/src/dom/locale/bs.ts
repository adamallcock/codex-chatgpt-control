import type { LocaleContribution } from "./types.js";

/**
 * Bosnian (bs-BA). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=bs-BA, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const bs = {
  composerTextbox: ["Razgovarajte pomoću ChatGPT-a"],
  sendButton: ["Pošalji upit"],
  searchChatsButton: ["Pretraži razgovore"],
  searchChatsPlaceholder: ["Pretražuj razgovore..."],
  newChat: ["Novi razgovor"],
  addFilesButton: ["Otpremite datoteke i još mnogo toga"],
  addFilesOpenerCandidates: ["Otpremite datoteke i još mnogo toga"],
  addPhotosFilesMenuItem: ["Dodaj slike i datoteke"],
  copyResponse: ["Kopiraj odgovor"],
  modeLabels: ["Brzo", "Srednji", "Visoko", "Vrlo visoko"],
  modeOptions: {
    instant: ["Brzo"],
    medium: ["Srednji"],
    high: ["Visoko"],
    extraHigh: ["Vrlo visoko"],
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
