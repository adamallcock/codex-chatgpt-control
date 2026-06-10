import type { LocaleContribution } from "./types.js";

/**
 * Russian (ru-RU). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ru-RU, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const ru = {
  composerTextbox: ["Спросите ChatGPT"],
  sendButton: ["Отправить подсказку"],
  searchChatsButton: ["Искать чаты"],
  searchChatsPlaceholder: ["Поиск в чатах…"],
  newChat: ["Новый чат"],
  addFilesButton: ["Добавляйте файлы и многое другое"],
  addFilesOpenerCandidates: ["Добавляйте файлы и многое другое"],
  addPhotosFilesMenuItem: ["Загрузить фотографии и файлы"],
  copyResponse: ["Копировать ответ"],
  modeOpenerExtra: ["Конфигурация..."],
  tools: {
    web_search: ["Поиск в сети"],
    deep_research: ["Глубокое исследование"],
    create_image: ["Создать изображение"],
  },
  signedInMarkers: ["Новый чат", "Искать чаты", "Недавнее", "История чата", "Проекты", "Спросите ChatGPT"],
  responseActions: ["Копировать ответ"],
} satisfies LocaleContribution;
