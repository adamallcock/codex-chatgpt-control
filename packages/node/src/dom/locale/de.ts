import type { LocaleContribution } from "./types.js";

/**
 * German (de-DE). Captured 2026-06-09 against a live chatgpt.com session (html lang=de-DE).
 *
 * Only keys whose text differs from English are listed. Omitted because they match English
 * case-insensitively: `modeLabels` (Instant / Thinking / Pro), `tools.deep_research`
 * ("Deep Research"). Not yet captured — fall back to English + `selector_drift`:
 * `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`, `stopControl`,
 * and the login/captcha/rate-limit blocker copy.
 */
export const de = {
  composerTextbox: ["Mit ChatGPT chatten"],
  sendButton: ["Aufforderung senden"],
  searchChatsButton: ["Chats durchsuchen"],
  searchChatsPlaceholder: ["Chats suchen…"],
  newChat: ["Neuer Chat"],
  addFilesButton: ["Dateien und mehr hinzufügen"],
  addFilesOpenerCandidates: ["Dateien und mehr hinzufügen"],
  addPhotosFilesMenuItem: ["Fotos und Dateien hinzufügen"],
  copyResponse: ["Antwort kopieren"],
  modeOpenerExtra: ["Konfigurieren"],
  tools: {
    web_search: ["Websuche"],
    create_image: ["Bild erstellen"],
  },
  signedInMarkers: ["Neuer Chat", "Chats durchsuchen", "Letzte", "Bibliothek", "Projekte", "Mit ChatGPT chatten"],
  responseActions: ["Antwort kopieren"],
} satisfies LocaleContribution;
