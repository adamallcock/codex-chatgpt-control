import type { LocaleContribution } from "./types.js";

/**
 * Latvian (lv-LV). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=lv-LV, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const lv = {
  composerTextbox: ["Jautā jebko"],
  sendButton: ["Sūtīt uzvedni"],
  searchChatsButton: ["Meklēt tērzēšanas"],
  searchChatsPlaceholder: ["Meklēt tērzētavās..."],
  newChat: ["Jauna tērzētava"],
  addFilesButton: ["Failu pievienošana un citas funkcijas"],
  addFilesOpenerCandidates: ["Failu pievienošana un citas funkcijas"],
  addPhotosFilesMenuItem: ["Augšupielādēt foto un failus"],
  copyResponse: ["Kopēt atbildi"],
  modeOpenerExtra: ["Konfigurēt..."],
  tools: {
    web_search: ["Meklēšana tīmeklī"],
    deep_research: ["Padziļināta izpēte"],
    create_image: ["Izveido attēlu"],
  },
  signedInMarkers: ["Jauna tērzētava", "Meklēt tērzēšanas", "Nesenās sarunas", "Tērzēšanas vēsture", "Projekti", "Jautā jebko"],
  responseActions: ["Kopēt atbildi"],
} satisfies LocaleContribution;
