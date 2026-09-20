import type { LocaleContribution } from "./types.js";

/**
 * Russian (ru-RU). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ru-RU, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ru = {
  configurationAxes: {
    model: ["Модель", "Выбрать модель"],
    effort: ["Уровень", "Уровень проработки", "Power"],
    speed: ["Скорость"],
    advanced: ["Расширенные"],
  },
  configurationOptions: {
    light: ["Низкий"],
    medium: ["Средний"],
    high: ["Высокий"],
    extraHigh: ["Очень высокий"],
    max: ["Максимальный"],
    ultra: ["Ультра"],
    standard: ["Стандартный"],
    fast: ["Быстро"],
  },
  composerTextbox: ["Спросите ChatGPT"],
  sendButton: ["Отправить подсказку"],
  searchChatsButton: ["Искать чаты"],
  searchChatsPlaceholder: ["Поиск в чатах…"],
  newChat: ["Новый чат"],
  addFilesButton: ["Добавляйте файлы и многое другое"],
  addFilesOpenerCandidates: ["Добавляйте файлы и многое другое"],
  addPhotosFilesMenuItem: ["Загрузить фотографии и файлы"],
  copyResponse: ["Копировать ответ"],
  modeLabels: ["Очень высокий", "Средний", "Высокий"],
  modeOptions: {
    medium: ["Средний"],
    high: ["Высокий"],
    extraHigh: ["Очень высокий"],
  },
  modeOpenerExtra: ["Конфигурация..."],
  experienceOptions: {
    chat: ["Чат"],
    work: ["Работа"],
  },
  tools: {
    web_search: ["Поиск в сети"],
    deep_research: ["Глубокое исследование"],
    create_image: ["Создать изображение"],
  },
  signedInMarkers: ["Новый чат", "Искать чаты", "Недавнее", "История чата", "Проекты", "Спросите ChatGPT"],
  responseActions: ["Копировать ответ"],
  stopControl: ["Остановить ответ"],
} satisfies LocaleContribution;
