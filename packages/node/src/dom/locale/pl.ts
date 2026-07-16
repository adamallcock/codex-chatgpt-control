import type { LocaleContribution } from "./types.js";

/**
 * Polish (pl-PL). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pl-PL, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["Błyskawiczny", "Średni", "Zaawansowana", "Bardzo wysoki"],
  modeOptions: {
    instant: ["Błyskawiczny"],
    medium: ["Średni"],
    high: ["Zaawansowana"],
    extraHigh: ["Bardzo wysoki"],
  },
  modeOpenerExtra: ["Skonfiguruj..."],
  tools: {
    web_search: ["Wyszukiwanie w sieci"],
    deep_research: ["Głębokie badanie"],
    create_image: ["Stwórz obraz"],
  },
  signedInMarkers: ["Nowy czat", "Szukaj czatów", "Ostatnie", "Historia czatu", "Projekty", "Zapytaj o cokolwiek"],
  responseActions: ["Kopiuj odpowiedź"],
  stopControl: ["Przerwij odpowiedź"],
} satisfies LocaleContribution;
