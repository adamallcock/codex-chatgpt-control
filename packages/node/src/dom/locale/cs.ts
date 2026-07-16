import type { LocaleContribution } from "./types.js";

/**
 * Czech (cs-CZ). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=cs-CZ, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const cs = {
  composerTextbox: ["Chatovat s ChatGPT"],
  sendButton: ["Odeslat výzvu"],
  searchChatsButton: ["Hledat chaty"],
  searchChatsPlaceholder: ["Hledat chaty…"],
  newChat: ["Nový chat"],
  addFilesButton: ["Přidávání souborů a další"],
  addFilesOpenerCandidates: ["Přidávání souborů a další"],
  addPhotosFilesMenuItem: ["Přidat fotografie a soubory"],
  copyResponse: ["Zkopírovat odpověď"],
  modeLabels: ["Okamžitá", "Střední", "Vysoká", "Velmi vysoká"],
  modeOptions: {
    instant: ["Okamžitá"],
    medium: ["Střední"],
    high: ["Vysoká"],
    extraHigh: ["Velmi vysoká"],
  },
  modeOpenerExtra: ["Konfigurovat…"],
  tools: {
    web_search: ["Vyhledávání na webu"],
    deep_research: ["Hloubkový výzkum"],
    create_image: ["Vytvoř obrázek"],
  },
  signedInMarkers: ["Nový chat", "Hledat chaty", "Nedávné", "Historie chatu", "Projekty", "Chatovat s ChatGPT"],
  responseActions: ["Zkopírovat odpověď"],
  stopControl: ["Zastavit odpovídání"],
} satisfies LocaleContribution;
