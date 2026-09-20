import type { LocaleContribution } from "./types.js";

/**
 * Arabic (ar). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ar, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ar = {
  configurationAxes: {
    power: ["القدرة"],
    model: ["النموذج", "اختر النموذج"],
    effort: ["الجهد", "القدرة"],
    speed: ["السرعة"],
    advanced: ["متقدم"],
  },
  configurationOptions: {
    instant: ["فوري"],
    light: ["خفيف"],
    medium: ["متوسط"],
    high: ["عالٍ"],
    extraHigh: ["عالٍ جدًا"],
    standard: ["قياسي", "قياسية"],
    fast: ["سريع"],
  },
  composerTextbox: ["الدردشة مع ChatGPT"],
  sendButton: ["إرسال السؤال"],
  searchChatsButton: ["البحث في الدردشات"],
  searchChatsPlaceholder: ["البحث في الدردشات..."],
  newChat: ["دردشة جديدة"],
  addFilesButton: ["إضافة الملفات والمزيد"],
  addFilesOpenerCandidates: ["إضافة الملفات والمزيد"],
  addPhotosFilesMenuItem: ["إضافة صور وملفات"],
  copyResponse: ["نسخ إجابة"],
  modeLabels: ["فوري", "متوسط", "عالي", "مكثف جدًا", "احترافي", "عالٍ", "عالٍ جدًا"],
  modeOptions: {
    instant: ["فوري"],
    medium: ["متوسط"],
    high: ["عالي", "عالٍ"],
    extraHigh: ["مكثف جدًا", "عالٍ جدًا"],
    pro: ["احترافي"],
  },
  modeOpenerExtra: ["تكوين"],
  experienceOptions: {
    chat: ["الدردشة"],
    work: ["العمل"],
  },
  tools: {
    web_search: ["البحث في الويب"],
    deep_research: ["البحث التفصيلي"],
    create_image: ["إنشاء صورة"],
  },
  signedInMarkers: ["دردشة جديدة", "البحث في الدردشات", "المحادثات الأخيرة", "المكتبة", "المشروعات", "الدردشة مع ChatGPT"],
  responseActions: ["نسخ إجابة"],
  stopControl: ["إيقاف الرد"],
} satisfies LocaleContribution;
