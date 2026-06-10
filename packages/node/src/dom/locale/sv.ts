import type { LocaleContribution } from "./types.js";

/**
 * Swedish (sv-SE). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sv-SE, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
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
  modeOpenerExtra: ["Konfigurera …"],
  tools: {
    web_search: ["Webbsökning"],
    deep_research: ["Djup research"],
    create_image: ["Skapa en bild"],
  },
  signedInMarkers: ["Ny chatt", "Sök i chattar", "Senaste", "Chatthistorik", "Projekt", "Fråga vad som helst"],
  responseActions: ["Kopiera svar"],
} satisfies LocaleContribution;
