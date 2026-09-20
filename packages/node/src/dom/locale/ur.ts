import type { LocaleContribution } from "./types.js";

/**
 * Urdu (ur). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ur, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ur = {
  configurationAxes: {
    model: ["ماڈل", "ماڈل منتخب کریں"],
    effort: ["کوشش", "Power"],
    speed: ["رفتار"],
    advanced: ["ایڈوانسڈ"],
  },
  configurationOptions: {
    instant: ["فوری"],
    light: ["لائٹ"],
    medium: ["اوسط"],
    high: ["ہائی"],
    extraHigh: ["ایکسٹرا ہائی"],
    max: ["زیادہ سے زیادہ"],
    ultra: ["الٹرا"],
    standard: ["اسٹینڈرڈ"],
    fast: ["تیز"],
  },
  composerTextbox: ["کوئی بھی چیز پوچھیں۔۔۔"],
  sendButton: ["پرامپٹ بھیجیں"],
  searchChatsButton: ["چیٹس تلاش کریں"],
  searchChatsPlaceholder: ["چیٹس تلاش کریں..."],
  newChat: ["نئی چیٹ"],
  addFilesButton: ["فائلیں وغیرہ اپ لوڈ کریں"],
  addFilesOpenerCandidates: ["فائلیں وغیرہ اپ لوڈ کریں"],
  addPhotosFilesMenuItem: ["تصویریں اور فائلیں شامل کریں"],
  copyResponse: ["جواب کاپی کریں"],
  modeLabels: ["فوری", "اوسط", "اعلیٰ", "انتہائی اعلیٰ", "ہائی", "ایکسٹرا ہائی"],
  modeOptions: {
    instant: ["فوری"],
    medium: ["اوسط"],
    high: ["اعلیٰ", "ہائی"],
    extraHigh: ["انتہائی اعلیٰ", "ایکسٹرا ہائی"],
  },
  modeOpenerExtra: ["کنفیگر کریں..."],
  experienceOptions: {
    chat: ["چَیٹ"],
    work: ["کام"],
  },
  tools: {
    web_search: ["ویب پر تلاش"],
    deep_research: ["ڈیپ ریسرچ"],
    create_image: ["تصویر بنائیں"],
  },
  signedInMarkers: ["نئی چیٹ", "چیٹس تلاش کریں", "حالیہ", "چیٹ ہسٹری", "پراجیکٹس", "کوئی بھی چیز پوچھیں۔۔۔"],
  responseActions: ["جواب کاپی کریں"],
  stopControl: ["جواب روکیں"],
} satisfies LocaleContribution;
