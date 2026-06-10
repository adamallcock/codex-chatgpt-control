import type { LocaleContribution } from "./types.js";

/**
 * Albanian (sq-AL). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sq-AL, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const sq = {
  composerTextbox: ["Pyet për çdo gjë"],
  sendButton: ["Dërgo kërkesën"],
  searchChatsButton: ["Kërko bisedat"],
  searchChatsPlaceholder: ["Kërko bisedat..."],
  newChat: ["Bisedë e re"],
  addFilesButton: ["Shto skedarë e më shumë"],
  addFilesOpenerCandidates: ["Shto skedarë e më shumë"],
  addPhotosFilesMenuItem: ["Ngarko foto dhe skedarë"],
  copyResponse: ["Kopjo përgjigjen"],
  modeOpenerExtra: ["Konfiguro..."],
  tools: {
    web_search: ["Kërkim në ueb"],
    deep_research: ["Kërkim i thellë"],
    create_image: ["Krijo një imazh"],
  },
  signedInMarkers: ["Bisedë e re", "Kërko bisedat", "Më të fundit", "Historia e bisedës", "Projektet", "Pyet për çdo gjë"],
  responseActions: ["Kopjo përgjigjen"],
} satisfies LocaleContribution;
