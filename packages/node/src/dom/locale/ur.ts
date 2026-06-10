import type { LocaleContribution } from "./types.js";

/**
 * Urdu (ur). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ur, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 from a visible ChatGPT Pro session.
 */
export const ur = {
  composerTextbox: ["کوئی بھی چیز پوچھیں۔۔۔"],
  sendButton: ["پرامپٹ بھیجیں"],
  searchChatsButton: ["چیٹس تلاش کریں"],
  searchChatsPlaceholder: ["چیٹس تلاش کریں..."],
  newChat: ["نئی چیٹ"],
  addFilesButton: ["فائلیں وغیرہ اپ لوڈ کریں"],
  addFilesOpenerCandidates: ["فائلیں وغیرہ اپ لوڈ کریں"],
  addPhotosFilesMenuItem: ["تصویریں اور فائلیں شامل کریں"],
  copyResponse: ["جواب کاپی کریں"],
  modeLabels: ["فوری", "اوسط", "اعلیٰ", "انتہائی اعلیٰ"],
  modeOpenerExtra: ["کنفیگر کریں..."],
  tools: {
    web_search: ["ویب پر تلاش"],
    deep_research: ["ڈیپ ریسرچ"],
    create_image: ["تصویر بنائیں"],
  },
  signedInMarkers: ["نئی چیٹ", "چیٹس تلاش کریں", "حالیہ", "چیٹ ہسٹری", "پراجیکٹس", "کوئی بھی چیز پوچھیں۔۔۔"],
  responseActions: ["جواب کاپی کریں"],
} satisfies LocaleContribution;
