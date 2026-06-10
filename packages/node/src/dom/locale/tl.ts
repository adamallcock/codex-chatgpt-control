import type { LocaleContribution } from "./types.js";

/**
 * Tagalog / Filipino (tl). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=tl, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro),
 * `deep_research` tool label ("Deep research").
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const tl = {
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
} satisfies LocaleContribution;
