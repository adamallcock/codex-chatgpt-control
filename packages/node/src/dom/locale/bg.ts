import type { LocaleContribution } from "./types.js";

/**
 * Bulgarian (bg-BG). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=bg-BG, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const bg = {
  configurationAxes: {
    power: ["Мощност"],
    model: ["Модел", "Изберете модел"],
    effort: ["Усилие", "Мощност"],
    speed: ["Скорост"],
    advanced: ["Разширени"],
  },
  configurationOptions: {
    instant: ["Мигновен"],
    light: ["Кратко"],
    medium: ["Средно"],
    high: ["Високо"],
    extraHigh: ["Много високо"],
    max: ["Максимално"],
    ultra: ["Ултра"],
    standard: ["Стандартно"],
    fast: ["Бърза"],
  },
  composerTextbox: ["Чат с ChatGPT"],
  sendButton: ["Изпращане на подкана"],
  searchChatsButton: ["Търсене на чатове"],
  searchChatsPlaceholder: ["Търсене в чатове..."],
  newChat: ["Нов чат"],
  addFilesButton: ["Добавяне на файлове и др."],
  addFilesOpenerCandidates: ["Добавяне на файлове и др."],
  addPhotosFilesMenuItem: ["Добавяне на снимки и файлове"],
  copyResponse: ["Копирайте отговора"],
  modeLabels: ["Мигновен", "Среден", "Висок", "Много високо", "Про", "Средно", "Високо"],
  modeOptions: {
    instant: ["Мигновен"],
    medium: ["Среден", "Средно"],
    high: ["Висок", "Високо"],
    extraHigh: ["Много високо"],
    pro: ["Про"],
  },
  modeOpenerExtra: ["Конфигурирайте"],
  tools: {
    web_search: ["Търсене в интернет"],
    deep_research: ["Подробно проучване"],
    create_image: ["Създаване на изображение"],
  },
  signedInMarkers: ["Нов чат", "Търсене на чатове", "Скорошни чатове", "Каталог", "Проекти", "Чат с ChatGPT"],
  responseActions: ["Копирайте отговора"],
  stopControl: ["Спри отговора"],
} satisfies LocaleContribution;
