import type { LocaleContribution } from "./types.js";

/**
 * Punjabi (pa). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pa, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const pa = {
  configurationAxes: {
    model: ["ਮਾਡਲ"],
    effort: ["ਕੋਸ਼ਿਸ਼"],
    speed: ["ਗਤੀ"],
  },
  configurationOptions: {
    light: ["ਹਲਕਾ"],
    medium: ["ਮੀਡੀਅਮ"],
    high: ["ਹਾਈ"],
    extraHigh: ["ਐਕਸਟ੍ਰਾ ਹਾਈ"],
    standard: ["ਮਿਆਰੀ"],
    fast: ["ਤੇਜ਼"],
  },
  composerTextbox: ["ਕੁਝ ਵੀ ਪੁੱਛੋ"],
  sendButton: ["ਪ੍ਰੋਂਪਟ ਭੇਜੋ"],
  searchChatsButton: ["ਚੈਟਾਂ ਖੋਜੋ"],
  searchChatsPlaceholder: ["ਚੈਟਾਂ ਦੀ ਖੋਜ ਕਰੋ..."],
  newChat: ["ਨਵੀਂ ਚੈਟ"],
  addFilesButton: ["ਫਾਈਲਾਂ ਅਤੇ ਹੋਰ ਬਹੁਤ ਕੁਝ ਸ਼ਾਮਲ ਕਰੋ"],
  addFilesOpenerCandidates: ["ਫਾਈਲਾਂ ਅਤੇ ਹੋਰ ਬਹੁਤ ਕੁਝ ਸ਼ਾਮਲ ਕਰੋ"],
  addPhotosFilesMenuItem: ["ਫ਼ੋਟੋਆਂ ਅਤੇ ਫ਼ਾਈਲਾਂ ਅੱਪਲੋਡ ਕਰੋ"],
  copyResponse: ["ਜਵਾਬ ਕਾਪੀ ਕਰੋ"],
  modeLabels: ["ਤੁਰੰਤ", "ਮੱਧਮ", "ਉੱਚ", "ਅਤਿ ਉੱਚ", "ਪ੍ਰੋ", "ਮੀਡੀਅਮ", "ਹਾਈ", "ਐਕਸਟ੍ਰਾ ਹਾਈ"],
  modeOptions: {
    instant: ["ਤੁਰੰਤ"],
    medium: ["ਮੱਧਮ", "ਮੀਡੀਅਮ"],
    high: ["ਉੱਚ", "ਹਾਈ"],
    extraHigh: ["ਅਤਿ ਉੱਚ", "ਐਕਸਟ੍ਰਾ ਹਾਈ"],
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
