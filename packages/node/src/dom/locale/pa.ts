import type { LocaleContribution } from "./types.js";

/**
 * Punjabi (pa). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pa, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const pa = {
  configurationAxes: {
    power: ["ਪਾਵਰ"],
    model: ["ਮਾਡਲ", "ਮਾਡਲ ਚੁਣੋ"],
    effort: ["ਕੋਸ਼ਿਸ਼", "ਪਾਵਰ"],
    speed: ["ਗਤੀ"],
    advanced: ["ਉੱਨਤ"],
  },
  configurationOptions: {
    instant: ["ਤੁਰੰਤ"],
    light: ["ਹਲਕਾ"],
    medium: ["ਮੀਡੀਅਮ"],
    high: ["ਹਾਈ"],
    extraHigh: ["ਐਕਸਟ੍ਰਾ ਹਾਈ"],
    max: ["ਅਧਿਕਤਮ"],
    ultra: ["ਅਲਟਰਾ"],
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
  experienceOptions: {
    chat: ["ਚੈਟ"],
    work: ["ਵਰਕ"],
  },
  tools: {
    web_search: ["ਵੈੱਬ ਖੋਜ"],
    deep_research: ["ਡੂੰਘੀ ਖੋਜ"],
    create_image: ["ਤਸਵੀਰ ਬਣਾਉ"],
  },
  signedInMarkers: ["ਨਵੀਂ ਚੈਟ", "ਚੈਟਾਂ ਖੋਜੋ", "ਹਾਲੀਆ", "ਚੈਟ ਹਿਸਟਰੀ", "ਪ੍ਰੋਜੈਕਟ", "ਕੁਝ ਵੀ ਪੁੱਛੋ"],
  responseActions: ["ਜਵਾਬ ਕਾਪੀ ਕਰੋ"],
  stopControl: ["ਜਵਾਬ ਦੇਣਾ ਬੰਦ ਕਰੋ"],
} satisfies LocaleContribution;
