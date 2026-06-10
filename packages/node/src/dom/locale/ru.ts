import type { LocaleContribution } from "./types.js";

/**
 * Russian (ru-RU). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ru-RU, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 from a visible ChatGPT Pro session.
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
  modeLabels: ["Очень высокий"],
  modeOpenerExtra: ["Конфигурация..."],
  tools: {
    web_search: ["Поиск в сети"],
    deep_research: ["Глубокое исследование"],
    create_image: ["Создать изображение"],
  },
  signedInMarkers: ["Новый чат", "Искать чаты", "Недавнее", "История чата", "Проекты", "Спросите ChatGPT"],
  responseActions: ["Копировать ответ"],
} satisfies LocaleContribution;
