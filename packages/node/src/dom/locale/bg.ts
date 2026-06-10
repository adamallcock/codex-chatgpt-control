import type { LocaleContribution } from "./types.js";

/**
 * Bulgarian (bg-BG). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=bg-BG, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Разширено" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const bg = {
  composerTextbox: ["Чат с ChatGPT"],
  sendButton: ["Изпращане на подкана"],
  searchChatsButton: ["Търсене на чатове"],
  searchChatsPlaceholder: ["Търсене в чатове..."],
  newChat: ["Нов чат"],
  addFilesButton: ["Добавяне на файлове и др."],
  addFilesOpenerCandidates: ["Добавяне на файлове и др."],
  addPhotosFilesMenuItem: ["Добавяне на снимки и файлове"],
  copyResponse: ["Копирайте отговора"],
  modeOpenerExtra: ["Конфигурирайте"],
  tools: {
    web_search: ["Търсене в интернет"],
    deep_research: ["Подробно проучване"],
    create_image: ["Създаване на изображение"],
  },
  signedInMarkers: ["Нов чат", "Търсене на чатове", "Скорошни чатове", "Каталог", "Проекти", "Чат с ChatGPT"],
  responseActions: ["Копирайте отговора"],
} satisfies LocaleContribution;
