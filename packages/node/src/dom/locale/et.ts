import type { LocaleContribution } from "./types.js";

/**
 * Estonian (et-EE). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=et-EE, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Laiendatud" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const et = {
  composerTextbox: ["Vestle ChatGPT-ga"],
  sendButton: ["Saada viip"],
  searchChatsButton: ["Otsi vestlusi"],
  searchChatsPlaceholder: ["Otsi vestlusi…"],
  newChat: ["Uus vestlus"],
  addFilesButton: ["Failide lisamine ja muud"],
  addFilesOpenerCandidates: ["Failide lisamine ja muud"],
  addPhotosFilesMenuItem: ["Lisa fotosid ja faile"],
  copyResponse: ["Kopeeri vastus"],
  modeOpenerExtra: ["Konfigureeri..."],
  tools: {
    web_search: ["Veebiotsing"],
    deep_research: ["Süvauuring"],
    create_image: ["Loo pilt"],
  },
  signedInMarkers: ["Uus vestlus", "Otsi vestlusi", "Hiljutised", "Vestlusajalugu", "Projektid", "Vestle ChatGPT-ga"],
  responseActions: ["Kopeeri vastus"],
} satisfies LocaleContribution;
