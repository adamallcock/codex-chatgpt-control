import type { LocaleContribution } from "./types.js";

/**
 * Bosnian (bs-BA). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=bs-BA, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Produženo" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
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
  modeOpenerExtra: ["Podesi"],
  tools: {
    web_search: ["Internet pretraga"],
    deep_research: ["Detaljno istraživanje"],
    create_image: ["Kreirajte sliku"],
  },
  signedInMarkers: ["Novi razgovor", "Pretraži razgovore", "Nedavno", "Biblioteka", "Projekti", "Razgovarajte pomoću ChatGPT-a"],
  responseActions: ["Kopiraj odgovor"],
} satisfies LocaleContribution;
