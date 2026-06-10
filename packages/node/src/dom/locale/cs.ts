import type { LocaleContribution } from "./types.js";

/**
 * Czech (cs-CZ). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=cs-CZ, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Rozšířené" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
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
  modeOpenerExtra: ["Konfigurovat…"],
  tools: {
    web_search: ["Vyhledávání na webu"],
    deep_research: ["Hloubkový výzkum"],
    create_image: ["Vytvoř obrázek"],
  },
  signedInMarkers: ["Nový chat", "Hledat chaty", "Nedávné", "Historie chatu", "Projekty", "Chatovat s ChatGPT"],
  responseActions: ["Zkopírovat odpověď"],
} satisfies LocaleContribution;
