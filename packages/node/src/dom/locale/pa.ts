import type { LocaleContribution } from "./types.js";

/**
 * Punjabi (pa). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pa, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["ਤੁਰੰਤ", "ਮੱਧਮ", "ਉੱਚ", "ਅਤਿ ਉੱਚ", "ਪ੍ਰੋ"],
  modeOptions: {
    instant: ["ਤੁਰੰਤ"],
    medium: ["ਮੱਧਮ"],
    high: ["ਉੱਚ"],
    extraHigh: ["ਅਤਿ ਉੱਚ"],
    pro: ["ਪ੍ਰੋ"],
  },
  modeOpenerExtra: ["ਕੌਨਫਿਗਰ..."],
  tools: {
    web_search: ["ਵੈੱਬ ਖੋਜ"],
    deep_research: ["ਡੂੰਘੀ ਖੋਜ"],
    create_image: ["ਤਸਵੀਰ ਬਣਾਉ"],
  },
  signedInMarkers: ["ਨਵੀਂ ਚੈਟ", "ਚੈਟਾਂ ਖੋਜੋ", "ਹਾਲੀਆ", "ਚੈਟ ਹਿਸਟਰੀ", "ਪ੍ਰੋਜੈਕਟ", "ਕੁਝ ਵੀ ਪੁੱਛੋ"],
  responseActions: ["ਜਵਾਬ ਕਾਪੀ ਕਰੋ"],
  stopControl: ["ਜਵਾਬ ਦੇਣਾ ਬੰਦ ਕਰੋ"],
} satisfies LocaleContribution;
