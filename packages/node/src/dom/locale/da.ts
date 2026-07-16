import type { LocaleContribution } from "./types.js";

/**
 * Danish (da-DK). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=da-DK, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["Øjeblikkeligt", "Høj", "Ekstra høj"],
  modeOptions: {
    instant: ["Øjeblikkeligt"],
    high: ["Høj"],
    extraHigh: ["Ekstra høj"],
  },
  modeOpenerExtra: ["Konfigurer ..."],
  tools: {
    web_search: ["Internetsøgning"],
    deep_research: ["Grundig research"],
    create_image: ["Lav et billede"],
  },
  signedInMarkers: ["Ny chat", "Søg i chats", "Seneste", "Chathistorik", "Projekter", "Chat med ChatGPT"],
  responseActions: ["Kopiér svar"],
  stopControl: ["Afbryd svar"],
} satisfies LocaleContribution;
