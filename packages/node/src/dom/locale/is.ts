import type { LocaleContribution } from "./types.js";

/**
 * Icelandic (is-IS). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=is-IS, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Lengri" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const is = {
  composerTextbox: ["Spjallaðu við ChatGPT"],
  sendButton: ["Senda kvaðningu"],
  searchChatsButton: ["Leita í spjöllum"],
  searchChatsPlaceholder: ["Leita í spjalli..."],
  newChat: ["Nýtt spjall"],
  addFilesButton: ["Bæta við skrám og fleira"],
  addFilesOpenerCandidates: ["Bæta við skrám og fleira"],
  addPhotosFilesMenuItem: ["Bæta myndum og skrám við"],
  copyResponse: ["Afrita svar"],
  modeOpenerExtra: ["Stillir…"],
  tools: {
    web_search: ["Vefleit"],
    deep_research: ["Ítarleg rannsókn"],
    create_image: ["Búa til mynd"],
  },
  signedInMarkers: ["Nýtt spjall", "Leita í spjöllum", "Nýlegt", "Spjallferill", "Verkefni", "Spjallaðu við ChatGPT"],
  responseActions: ["Afrita svar"],
} satisfies LocaleContribution;
