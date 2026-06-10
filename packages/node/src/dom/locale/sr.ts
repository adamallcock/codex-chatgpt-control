import type { LocaleContribution } from "./types.js";

/**
 * Serbian (sr-RS). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sr-RS, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const sr = {
  composerTextbox: ["Питај било шта"],
  sendButton: ["Пошаљи промпт"],
  searchChatsButton: ["Претражи ћаскања"],
  searchChatsPlaceholder: ["Претрага ћаскања..."],
  newChat: ["Ново ћаскање"],
  addFilesButton: ["Додај датотеке и друго"],
  addFilesOpenerCandidates: ["Додај датотеке и друго"],
  addPhotosFilesMenuItem: ["Отпреми фотографије и датотеке"],
  copyResponse: ["Копирај одговор"],
  modeOpenerExtra: ["Конфигуриши..."],
  tools: {
    web_search: ["Претрага веба"],
    deep_research: ["Дубинско истраживање"],
    create_image: ["Направи слику"],
  },
  signedInMarkers: ["Ново ћаскање", "Претражи ћаскања", "Скорашњи", "Историја ћаскања", "Пројекти", "Питај било шта"],
  responseActions: ["Копирај одговор"],
} satisfies LocaleContribution;
