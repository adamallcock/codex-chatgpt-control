import type { LocaleContribution } from "./types.js";

/**
 * Arabic (ar). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ar, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• التفكير لفترة طويلة" suffix is a descriptor). Not yet captured — fall back to
 * English + `selector_drift`: `download`, `downloadImage`, `imageContainerHint`,
 * `transientAssistant`, `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const ar = {
  composerTextbox: ["الدردشة مع ChatGPT"],
  sendButton: ["إرسال السؤال"],
  searchChatsButton: ["البحث في الدردشات"],
  searchChatsPlaceholder: ["البحث في الدردشات..."],
  newChat: ["دردشة جديدة"],
  addFilesButton: ["إضافة الملفات والمزيد"],
  addFilesOpenerCandidates: ["إضافة الملفات والمزيد"],
  addPhotosFilesMenuItem: ["إضافة صور وملفات"],
  copyResponse: ["نسخ إجابة"],
  modeOpenerExtra: ["تكوين"],
  tools: {
    web_search: ["البحث في الويب"],
    deep_research: ["البحث التفصيلي"],
    create_image: ["إنشاء صورة"],
  },
  signedInMarkers: ["دردشة جديدة", "البحث في الدردشات", "المحادثات الأخيرة", "المكتبة", "المشروعات", "الدردشة مع ChatGPT"],
  responseActions: ["نسخ إجابة"],
} satisfies LocaleContribution;
