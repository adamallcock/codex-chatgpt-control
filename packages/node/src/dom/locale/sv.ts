import type { LocaleContribution } from "./types.js";

/**
 * Swedish (sv-SE). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sv-SE, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const sv = {
  composerTextbox: ["Fråga vad som helst"],
  sendButton: ["Skicka prompt"],
  searchChatsButton: ["Sök i chattar"],
  searchChatsPlaceholder: ["Sök i chattar …"],
  newChat: ["Ny chatt"],
  addFilesButton: ["Lägg till filer med mera"],
  addFilesOpenerCandidates: ["Lägg till filer med mera"],
  addPhotosFilesMenuItem: ["Ladda upp foton och filer"],
  copyResponse: ["Kopiera svar"],
  modeLabels: ["Direkt", "Balanserad", "Hög", "Extra hög"],
  modeOptions: {
    instant: ["Direkt"],
    medium: ["Balanserad"],
    high: ["Hög"],
    extraHigh: ["Extra hög"],
  },
  modeOpenerExtra: ["Konfigurera …"],
  tools: {
    web_search: ["Webbsökning"],
    deep_research: ["Djup research"],
    create_image: ["Skapa en bild"],
  },
  signedInMarkers: ["Ny chatt", "Sök i chattar", "Senaste", "Chatthistorik", "Projekt", "Fråga vad som helst"],
  responseActions: ["Kopiera svar"],
  stopControl: ["Sluta svara"],
} satisfies LocaleContribution;
