import type { LocaleContribution } from "./types.js";

/**
 * Swedish (sv-SE). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sv-SE, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const sv = {
  configurationAxes: {
    power: ["Prestanda"],
    model: ["Modell", "Välj modell"],
    effort: ["Resonemangsnivå", "Prestanda"],
    speed: ["Hastighet"],
    advanced: ["Avancerat"],
  },
  configurationOptions: {
    instant: ["Direkt"],
    light: ["Låg"],
    medium: ["Balanserad"],
    high: ["Hög"],
    extraHigh: ["Extra hög"],
    fast: ["Snabb"],
  },
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
