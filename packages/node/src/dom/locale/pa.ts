import type { LocaleContribution } from "./types.js";

/**
 * Punjabi (pa). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pa, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const pa = {
  composerTextbox: ["ਕੁਝ ਵੀ ਪੁੱਛੋ"],
  sendButton: ["ਪ੍ਰੋਂਪਟ ਭੇਜੋ"],
  searchChatsButton: ["ਚੈਟਾਂ ਖੋਜੋ"],
  searchChatsPlaceholder: ["ਚੈਟਾਂ ਦੀ ਖੋਜ ਕਰੋ..."],
  newChat: ["ਨਵੀਂ ਚੈਟ"],
  addFilesButton: ["ਫਾਈਲਾਂ ਅਤੇ ਹੋਰ ਬਹੁਤ ਕੁਝ ਸ਼ਾਮਲ ਕਰੋ"],
  addFilesOpenerCandidates: ["ਫਾਈਲਾਂ ਅਤੇ ਹੋਰ ਬਹੁਤ ਕੁਝ ਸ਼ਾਮਲ ਕਰੋ"],
  addPhotosFilesMenuItem: ["ਫ਼ੋਟੋਆਂ ਅਤੇ ਫ਼ਾਈਲਾਂ ਅੱਪਲੋਡ ਕਰੋ"],
  copyResponse: ["ਜਵਾਬ ਕਾਪੀ ਕਰੋ"],
  modeOpenerExtra: ["ਕੌਨਫਿਗਰ..."],
  tools: {
    web_search: ["ਵੈੱਬ ਖੋਜ"],
    deep_research: ["ਡੂੰਘੀ ਖੋਜ"],
    create_image: ["ਤਸਵੀਰ ਬਣਾਉ"],
  },
  signedInMarkers: ["ਨਵੀਂ ਚੈਟ", "ਚੈਟਾਂ ਖੋਜੋ", "ਹਾਲੀਆ", "ਚੈਟ ਹਿਸਟਰੀ", "ਪ੍ਰੋਜੈਕਟ", "ਕੁਝ ਵੀ ਪੁੱਛੋ"],
  responseActions: ["ਜਵਾਬ ਕਾਪੀ ਕਰੋ"],
} satisfies LocaleContribution;
