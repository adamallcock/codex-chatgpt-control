import type { LocaleContribution } from "./types.js";

/**
 * Icelandic (is-IS). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=is-IS, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["Strax", "Miðlungs", "Hátt", "Mjög hátt"],
  modeOptions: {
    instant: ["Strax"],
    medium: ["Miðlungs"],
    high: ["Hátt"],
    extraHigh: ["Mjög hátt"],
  },
  modeOpenerExtra: ["Stillir…"],
  tools: {
    web_search: ["Vefleit"],
    deep_research: ["Ítarleg rannsókn"],
    create_image: ["Búa til mynd"],
  },
  signedInMarkers: ["Nýtt spjall", "Leita í spjöllum", "Nýlegt", "Spjallferill", "Verkefni", "Spjallaðu við ChatGPT"],
  responseActions: ["Afrita svar"],
  stopControl: ["Hætta að svara"],
} satisfies LocaleContribution;
