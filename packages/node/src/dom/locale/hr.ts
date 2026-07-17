import type { LocaleContribution } from "./types.js";

/**
 * Croatian (hr-HR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hr-HR, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const hr = {
  configurationAxes: {
    effort: ["Razina napora"],
    speed: ["Brzina"],
  },
  configurationOptions: {
    light: ["Lagano"],
    medium: ["Srednja"],
    high: ["Visoka"],
    extraHigh: ["Vrlo visoka"],
    standard: ["Standardno"],
    fast: ["Brzo"],
  },
  composerTextbox: ["Razgovor s ChatGPT-om"],
  sendButton: ["Pošalji odzivnik"],
  searchChatsButton: ["Pretraži razgovore"],
  searchChatsPlaceholder: ["Pretraži čavrljanja..."],
  newChat: ["Novi razgovor"],
  addFilesButton: ["Dodavanje datoteka i ostalo"],
  addFilesOpenerCandidates: ["Dodavanje datoteka i ostalo"],
  addPhotosFilesMenuItem: ["Dodaj fotografije i datoteke"],
  copyResponse: ["Kopiraj odgovor"],
  modeLabels: ["Srednje", "Visoko", "Vrlo visoka", "Srednja", "Visoka"],
  modeOptions: {
    medium: ["Srednje", "Srednja"],
    high: ["Visoko", "Visoka"],
    extraHigh: ["Vrlo visoka"],
  },
  modeOpenerExtra: ["Konfiguriraj…"],
  tools: {
    web_search: ["Mrežno pretraživanje"],
    deep_research: ["Dubinski istraži"],
    create_image: ["Stvaranje slike"],
  },
  signedInMarkers: ["Novi razgovor", "Pretraži razgovore", "Nedavni sadržaj", "Povijest razgovora", "Projekti", "Razgovor s ChatGPT-om"],
  responseActions: ["Kopiraj odgovor"],
  stopControl: ["Zaustavi odgovaranje"],
} satisfies LocaleContribution;
