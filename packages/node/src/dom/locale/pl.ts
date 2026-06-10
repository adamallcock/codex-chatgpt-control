import type { LocaleContribution } from "./types.js";

/**
 * Polish (pl-PL). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pl-PL, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const pl = {
  composerTextbox: ["Zapytaj o cokolwiek"],
  sendButton: ["Wyślij polecenie"],
  searchChatsButton: ["Szukaj czatów"],
  searchChatsPlaceholder: ["Wyszukaj czaty…"],
  newChat: ["Nowy czat"],
  addFilesButton: ["Dodawaj pliki i nie tylko"],
  addFilesOpenerCandidates: ["Dodawaj pliki i nie tylko"],
  addPhotosFilesMenuItem: ["Prześlij zdjęcia i pliki"],
  copyResponse: ["Kopiuj odpowiedź"],
  modeOpenerExtra: ["Skonfiguruj..."],
  tools: {
    web_search: ["Wyszukiwanie w sieci"],
    deep_research: ["Głębokie badanie"],
    create_image: ["Stwórz obraz"],
  },
  signedInMarkers: ["Nowy czat", "Szukaj czatów", "Ostatnie", "Historia czatu", "Projekty", "Zapytaj o cokolwiek"],
  responseActions: ["Kopiuj odpowiedź"],
} satisfies LocaleContribution;
