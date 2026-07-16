import type { LocaleContribution } from "./types.js";

/**
 * Swahili (sw-TZ). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sw-TZ, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["Papo hapo", "Wastani", "Juu", "Juu Zaidi"],
  modeOptions: {
    instant: ["Papo hapo"],
    medium: ["Wastani"],
    high: ["Juu"],
    extraHigh: ["Juu Zaidi"],
  },
  modeOpenerExtra: ["Sanidi..."],
  tools: {
    web_search: ["Utafutaji wa wavuti"],
    deep_research: ["Utafiti wa kina"],
    create_image: ["Unda picha"],
  },
  signedInMarkers: ["Chati mpya", "Tafuta mazungumzo", "Hivi karibuni", "Historia ya chati", "Miradi", "Uliza chochote"],
  responseActions: ["Nakili jibu"],
  stopControl: ["Sitisha kujibu"],
} satisfies LocaleContribution;
