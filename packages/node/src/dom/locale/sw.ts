import type { LocaleContribution } from "./types.js";

/**
 * Swahili (sw-TZ). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sw-TZ, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const sw = {
  composerTextbox: ["Uliza chochote"],
  sendButton: ["Tuma makumbusho"],
  searchChatsButton: ["Tafuta mazungumzo"],
  searchChatsPlaceholder: ["Inatafuta chati..."],
  newChat: ["Chati mpya"],
  addFilesButton: ["Ongeza faili na mengine zaidi"],
  addFilesOpenerCandidates: ["Ongeza faili na mengine zaidi"],
  addPhotosFilesMenuItem: ["Pakia picha na mafaili"],
  copyResponse: ["Nakili jibu"],
  modeOpenerExtra: ["Sanidi..."],
  tools: {
    web_search: ["Utafutaji wa wavuti"],
    deep_research: ["Utafiti wa kina"],
    create_image: ["Unda picha"],
  },
  signedInMarkers: ["Chati mpya", "Tafuta mazungumzo", "Hivi karibuni", "Historia ya chati", "Miradi", "Uliza chochote"],
  responseActions: ["Nakili jibu"],
} satisfies LocaleContribution;
