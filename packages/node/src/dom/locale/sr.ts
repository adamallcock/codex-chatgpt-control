import type { LocaleContribution } from "./types.js";

/**
 * Serbian (sr-RS). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sr-RS, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const sr = {
  configurationAxes: {
    model: ["Модел"],
    effort: ["Ниво"],
    speed: ["Брзина"],
  },
  configurationOptions: {
    light: ["Лагано"],
    medium: ["Средње"],
    high: ["Високо"],
    extraHigh: ["Веома високо"],
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
  tools: {
    web_search: ["Претрага веба"],
    deep_research: ["Дубинско истраживање"],
    create_image: ["Направи слику"],
  },
  signedInMarkers: ["Ново ћаскање", "Претражи ћаскања", "Скорашњи", "Историја ћаскања", "Пројекти", "Питај било шта"],
  responseActions: ["Копирај одговор"],
  stopControl: ["Заустави одговарање"],
} satisfies LocaleContribution;
