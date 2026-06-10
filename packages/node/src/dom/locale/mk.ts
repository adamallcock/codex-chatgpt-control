import type { LocaleContribution } from "./types.js";

/**
 * Macedonian (mk-MK). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=mk-MK, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const mk = {
  composerTextbox: ["Прашај што било"],
  sendButton: ["Испрати промпт"],
  searchChatsButton: ["Пребарај разговори"],
  searchChatsPlaceholder: ["Пребарувај разговори..."],
  newChat: ["Нов разговор"],
  addFilesButton: ["Додај датотеки и повеќе"],
  addFilesOpenerCandidates: ["Додај датотеки и повеќе"],
  addPhotosFilesMenuItem: ["Постави фотографии и датотеки"],
  copyResponse: ["Копирај одговор"],
  modeOpenerExtra: ["Конфигурирај..."],
  tools: {
    web_search: ["Пребарување на интернет"],
    deep_research: ["Длабоко истражување"],
    create_image: ["Креирај слика"],
  },
  signedInMarkers: ["Нов разговор", "Пребарај разговори", "Неодамнешни", "Историја на разговори", "Проекти", "Прашај што било"],
  responseActions: ["Копирај одговор"],
} satisfies LocaleContribution;
