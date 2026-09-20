import type { LocaleContribution } from "./types.js";

/**
 * Serbian (sr-RS). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sr-RS, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const sr = {
  configurationAxes: {
    power: ["Снага"],
    model: ["Модел", "Изабери модел"],
    effort: ["Ниво", "Напор", "Снага"],
    speed: ["Брзина"],
    advanced: ["Напредно"],
  },
  configurationOptions: {
    light: ["Лагано"],
    medium: ["Средње"],
    high: ["Високо"],
    extraHigh: ["Веома високо"],
    max: ["Макс"],
    ultra: ["Ултра"],
    standard: ["Стандардно"],
    fast: ["Брзо"],
  },
  composerTextbox: ["Питај било шта"],
  sendButton: ["Пошаљи промпт"],
  searchChatsButton: ["Претражи ћаскања"],
  searchChatsPlaceholder: ["Претрага ћаскања..."],
  newChat: ["Ново ћаскање"],
  addFilesButton: ["Додај датотеке и друго"],
  addFilesOpenerCandidates: ["Додај датотеке и друго"],
  addPhotosFilesMenuItem: ["Отпреми фотографије и датотеке"],
  copyResponse: ["Копирај одговор"],
  modeLabels: ["Веома високо", "Средње", "Високо"],
  modeOptions: {
    medium: ["Средње"],
    high: ["Високо"],
    extraHigh: ["Веома високо"],
  },
  modeOpenerExtra: ["Конфигуриши..."],
  experienceOptions: {
    chat: ["Ћаскање"],
    work: ["Посао"],
  },
  tools: {
    web_search: ["Претрага веба"],
    deep_research: ["Дубинско истраживање"],
    create_image: ["Направи слику"],
  },
  signedInMarkers: ["Ново ћаскање", "Претражи ћаскања", "Скорашњи", "Историја ћаскања", "Пројекти", "Питај било шта"],
  responseActions: ["Копирај одговор"],
  stopControl: ["Заустави одговарање"],
} satisfies LocaleContribution;
