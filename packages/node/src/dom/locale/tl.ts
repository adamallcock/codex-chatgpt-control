import type { LocaleContribution } from "./types.js";

/**
 * Tagalog / Filipino (tl). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=tl, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const tl = {
  configurationAxes: {
    effort: ["Pagsisikap"],
    speed: ["Bilis"],
  },
  configurationOptions: {
    fast: ["Mabilis"],
  },
  composerTextbox: ["Mag-chat sa ChatGPT"],
  sendButton: ["Magpadala ng prompt"],
  searchChatsButton: ["Maghanap sa mga chat"],
  searchChatsPlaceholder: ["Maghanap sa mga chat..."],
  newChat: ["Bagong chat"],
  addFilesButton: ["Magdagdag ng mga file at higit pa"],
  addFilesOpenerCandidates: ["Magdagdag ng mga file at higit pa"],
  addPhotosFilesMenuItem: ["Mag-upload ng mga litrato at file"],
  copyResponse: ["Kopyahin ang sagot"],
  modeOpenerExtra: ["I-configure..."],
  tools: {
    web_search: ["Paghahanap sa web"],
    create_image: ["Gumawa ng larawan"],
  },
  signedInMarkers: ["Bagong chat", "Maghanap sa mga chat", "Mga kamakailan", "History ng chat", "Mga proyekto", "Mag-chat sa ChatGPT"],
  responseActions: ["Kopyahin ang sagot"],
  stopControl: ["Itigil ang pagsagot"],
} satisfies LocaleContribution;
