import type { LocaleContribution } from "./types.js";

/**
 * Persian (fa). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=fa, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const fa = {
  composerTextbox: ["گفتگو با ChatGPT"],
  sendButton: ["ارسال دستور"],
  searchChatsButton: ["جست‌وجوی چت‌ها"],
  searchChatsPlaceholder: ["جستجوی گفتگوها..."],
  newChat: ["گفتگوی جدید"],
  addFilesButton: ["افزودن فایل‌ها و موارد بیشتر"],
  addFilesOpenerCandidates: ["افزودن فایل‌ها و موارد بیشتر"],
  addPhotosFilesMenuItem: ["افزودن تصاویر و فایل‌ها"],
  copyResponse: ["کپی کردن پاسخ"],
  modeLabels: ["فوری", "متوسط", "بالا", "بسیار زیاد", "حرفه‌ای"],
  modeOptions: {
    instant: ["فوری"],
    medium: ["متوسط"],
    high: ["بالا"],
    extraHigh: ["بسیار زیاد"],
    pro: ["حرفه‌ای"],
  },
  modeOpenerExtra: ["پیکربندی..."],
  tools: {
    web_search: ["جستجوی وب"],
    deep_research: ["پژوهش عمیق"],
    create_image: ["ایجاد تصویر"],
  },
  signedInMarkers: ["گفتگوی جدید", "جست‌وجوی چت‌ها", "موارد اخیر", "تاریخچه گفتگو", "پروژه‌ها", "گفتگو با ChatGPT"],
  responseActions: ["کپی کردن پاسخ"],
  stopControl: ["توقف پاسخ گویی"],
} satisfies LocaleContribution;
