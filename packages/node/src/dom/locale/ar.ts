import type { LocaleContribution } from "./types.js";

/**
 * Arabic (ar). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ar, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 from a visible ChatGPT Pro session.
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
  modeLabels: ["فوري", "متوسط", "عالي", "مكثف جدًا", "احترافي"],
  modeOpenerExtra: ["تكوين"],
  tools: {
    web_search: ["البحث في الويب"],
    deep_research: ["البحث التفصيلي"],
    create_image: ["إنشاء صورة"],
  },
  signedInMarkers: ["دردشة جديدة", "البحث في الدردشات", "المحادثات الأخيرة", "المكتبة", "المشروعات", "الدردشة مع ChatGPT"],
  responseActions: ["نسخ إجابة"],
} satisfies LocaleContribution;
