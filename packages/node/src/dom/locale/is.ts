import type { LocaleContribution } from "./types.js";

/**
 * Icelandic (is-IS). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=is-IS, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const is = {
  configurationAxes: {
    power: ["Afl"],
    model: ["Líkan", "Velja líkan"],
    effort: ["Áreynsla", "Vinnsla", "Afl"],
    speed: ["Hraði"],
    advanced: ["Ítarlegt"],
  },
  configurationOptions: {
    instant: ["Strax"],
    light: ["Létt"],
    medium: ["Miðlungs"],
    high: ["Hátt"],
    extraHigh: ["Mjög hátt"],
    max: ["Hámark"],
    fast: ["Hratt"],
  },
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
  experienceOptions: {
    chat: ["Spjall"],
    work: ["Vinna"],
  },
  tools: {
    web_search: ["Vefleit"],
    deep_research: ["Ítarleg rannsókn"],
    create_image: ["Búa til mynd"],
  },
  signedInMarkers: ["Nýtt spjall", "Leita í spjöllum", "Nýlegt", "Spjallferill", "Verkefni", "Spjallaðu við ChatGPT"],
  responseActions: ["Afrita svar"],
  stopControl: ["Hætta að svara"],
} satisfies LocaleContribution;
