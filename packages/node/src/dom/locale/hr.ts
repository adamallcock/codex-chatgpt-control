import type { LocaleContribution } from "./types.js";

/**
 * Croatian (hr-HR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hr-HR, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const hr = {
  configurationAxes: {
    power: ["Snaga"],
    model: ["Odaberite model"],
    effort: ["Razina napora", "Snaga"],
    speed: ["Brzina"],
    advanced: ["Napredno"],
  },
  configurationOptions: {
    light: ["Lagano"],
    medium: ["Srednja"],
    high: ["Visoka"],
    extraHigh: ["Vrlo visoka"],
    max: ["Maks."],
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
