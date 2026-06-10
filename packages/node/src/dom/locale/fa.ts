import type { LocaleContribution } from "./types.js";

/**
 * Persian (fa). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=fa, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• گسترده" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
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
  modeOpenerExtra: ["پیکربندی..."],
  tools: {
    web_search: ["جستجوی وب"],
    deep_research: ["پژوهش عمیق"],
    create_image: ["ایجاد تصویر"],
  },
  signedInMarkers: ["گفتگوی جدید", "جست‌وجوی چت‌ها", "موارد اخیر", "تاریخچه گفتگو", "پروژه‌ها", "گفتگو با ChatGPT"],
  responseActions: ["کپی کردن پاسخ"],
} satisfies LocaleContribution;
