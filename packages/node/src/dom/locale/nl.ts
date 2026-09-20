import type { LocaleContribution } from "./types.js";

/**
 * Dutch (nl-NL). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=nl-NL, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, Chat/Work surface labels updated
 * 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible
 * ChatGPT sessions. The 2026-06-15 stop-control candidate matched the Send label
 * and is intentionally omitted until a new mid-generation capture verifies a
 * distinct Dutch stop label.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const nl = {
  configurationAxes: {
    power: ["Rekenkracht"],
    model: ["Model selecteren"],
    effort: ["Inspanning", "Rekenkracht"],
    speed: ["Snelheid"],
    advanced: ["Geavanceerd"],
  },
  configurationOptions: {
    instant: ["Direct"],
    light: ["Licht"],
    medium: ["Gemiddeld"],
    high: ["Hoog"],
    extraHigh: ["Zeer Hoog"],
    standard: ["Standaard"],
    fast: ["Snel"],
  },
  composerTextbox: ["Stel een vraag"],
  sendButton: ["Prompt versturen"],
  searchChatsButton: ["Chats doorzoeken"],
  searchChatsPlaceholder: ["Chats doorzoeken..."],
  newChat: ["Nieuwe chat"],
  addFilesButton: ["Bestanden en meer toevoegen"],
  addFilesOpenerCandidates: ["Bestanden en meer toevoegen"],
  addPhotosFilesMenuItem: ["Foto's en bestanden uploaden"],
  copyResponse: ["Reactie kopiëren"],
  modeLabels: ["Direct", "Gemiddeld", "Hoog", "Extra hoog", "Zeer Hoog"],
  modeOptions: {
    instant: ["Direct"],
    medium: ["Gemiddeld"],
    high: ["Hoog"],
    extraHigh: ["Extra hoog", "Zeer Hoog"],
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
