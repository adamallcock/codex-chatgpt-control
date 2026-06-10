import type { LocaleContribution } from "./types.js";

/**
 * Dutch (nl-NL). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=nl-NL, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const nl = {
  composerTextbox: ["Stel een vraag"],
  sendButton: ["Prompt versturen"],
  searchChatsButton: ["Chats doorzoeken"],
  searchChatsPlaceholder: ["Chats doorzoeken..."],
  newChat: ["Nieuwe chat"],
  addFilesButton: ["Bestanden en meer toevoegen"],
  addFilesOpenerCandidates: ["Bestanden en meer toevoegen"],
  addPhotosFilesMenuItem: ["Foto's en bestanden uploaden"],
  copyResponse: ["Reactie kopiëren"],
  modeOpenerExtra: ["Configureren..."],
  tools: {
    web_search: ["Zoeken op internet"],
    deep_research: ["Diepgaand onderzoek"],
    create_image: ["Maak een afbeelding"],
  },
  signedInMarkers: ["Nieuwe chat", "Chats doorzoeken", "Recente items", "Chatgeschiedenis", "Projecten", "Stel een vraag"],
  responseActions: ["Reactie kopiëren"],
} satisfies LocaleContribution;
