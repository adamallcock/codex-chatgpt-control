import type { LocaleContribution } from "./types.js";

/**
 * Croatian (hr-HR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hr-HR, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const hr = {
  composerTextbox: ["Razgovor s ChatGPT-om"],
  sendButton: ["Pošalji odzivnik"],
  searchChatsButton: ["Pretraži razgovore"],
  searchChatsPlaceholder: ["Pretraži čavrljanja..."],
  newChat: ["Novi razgovor"],
  addFilesButton: ["Dodavanje datoteka i ostalo"],
  addFilesOpenerCandidates: ["Dodavanje datoteka i ostalo"],
  addPhotosFilesMenuItem: ["Dodaj fotografije i datoteke"],
  copyResponse: ["Kopiraj odgovor"],
  modeLabels: ["Srednje", "Visoko", "Vrlo visoka"],
  modeOptions: {
    medium: ["Srednje"],
    high: ["Visoko"],
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
