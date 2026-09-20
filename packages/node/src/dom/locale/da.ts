import type { LocaleContribution } from "./types.js";

/**
 * Danish (da-DK). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=da-DK, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const da = {
  configurationAxes: {
    power: ["Styrke"],
    model: ["Vælg model"],
    effort: ["Indsats", "Tænkeindsats", "Styrke"],
    speed: ["Hastighed"],
    advanced: ["Avanceret"],
  },
  configurationOptions: {
    instant: ["Øjeblikkeligt", "Øjeblikkelig"],
    light: ["Let"],
    medium: ["Mellem"],
    high: ["Høj"],
    extraHigh: ["Ekstra høj"],
    max: ["Maks."],
    fast: ["Hurtig"],
  },
  composerTextbox: ["Chat med ChatGPT"],
  sendButton: ["Send forespørgsel"],
  searchChatsButton: ["Søg i chats"],
  searchChatsPlaceholder: ["Søg i chats..."],
  newChat: ["Ny chat"],
  addFilesButton: ["Tilføj filer og mere"],
  addFilesOpenerCandidates: ["Tilføj filer og mere"],
  addPhotosFilesMenuItem: ["Tilføj billeder og filer"],
  copyResponse: ["Kopiér svar"],
  modeLabels: ["Øjeblikkeligt", "Høj", "Ekstra høj", "Mellem", "Øjeblikkelig"],
  modeOptions: {
    instant: ["Øjeblikkeligt", "Øjeblikkelig"],
    medium: ["Mellem"],
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
