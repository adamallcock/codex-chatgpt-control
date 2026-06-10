import type { LocaleContribution } from "./types.js";

/**
 * Croatian (hr-HR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hr-HR, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Produljeno" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
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
  modeOpenerExtra: ["Konfiguriraj…"],
  tools: {
    web_search: ["Mrežno pretraživanje"],
    deep_research: ["Dubinski istraži"],
    create_image: ["Stvaranje slike"],
  },
  signedInMarkers: ["Novi razgovor", "Pretraži razgovore", "Nedavni sadržaj", "Povijest razgovora", "Projekti", "Razgovor s ChatGPT-om"],
  responseActions: ["Kopiraj odgovor"],
} satisfies LocaleContribution;
