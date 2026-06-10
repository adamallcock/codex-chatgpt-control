import type { LocaleContribution } from "./types.js";

/**
 * Danish (da-DK). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=da-DK, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Udvidet" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const da = {
  composerTextbox: ["Chat med ChatGPT"],
  sendButton: ["Send forespørgsel"],
  searchChatsButton: ["Søg i chats"],
  searchChatsPlaceholder: ["Søg i chats..."],
  newChat: ["Ny chat"],
  addFilesButton: ["Tilføj filer og mere"],
  addFilesOpenerCandidates: ["Tilføj filer og mere"],
  addPhotosFilesMenuItem: ["Tilføj billeder og filer"],
  copyResponse: ["Kopiér svar"],
  modeOpenerExtra: ["Konfigurer ..."],
  tools: {
    web_search: ["Internetsøgning"],
    deep_research: ["Grundig research"],
    create_image: ["Lav et billede"],
  },
  signedInMarkers: ["Ny chat", "Søg i chats", "Seneste", "Chathistorik", "Projekter", "Chat med ChatGPT"],
  responseActions: ["Kopiér svar"],
} satisfies LocaleContribution;
