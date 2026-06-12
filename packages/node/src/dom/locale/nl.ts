import type { LocaleContribution } from "./types.js";

/**
 * Dutch (nl-NL). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=nl-NL, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 from a visible ChatGPT Pro session.
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
  modeLabels: ["Direct", "Gemiddeld", "Hoog", "Extra hoog"],
  modeOptions: {
    instant: ["Direct"],
    medium: ["Gemiddeld"],
    high: ["Hoog"],
    extraHigh: ["Extra hoog"],
  },
  modeOpenerExtra: ["Configureren..."],
  tools: {
    web_search: ["Zoeken op internet"],
    deep_research: ["Diepgaand onderzoek"],
    create_image: ["Maak een afbeelding"],
  },
  signedInMarkers: ["Nieuwe chat", "Chats doorzoeken", "Recente items", "Chatgeschiedenis", "Projecten", "Stel een vraag"],
  responseActions: ["Reactie kopiëren"],
} satisfies LocaleContribution;
