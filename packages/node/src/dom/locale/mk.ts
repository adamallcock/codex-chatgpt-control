import type { LocaleContribution } from "./types.js";

/**
 * Macedonian (mk-MK). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=mk-MK, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["Средно", "Високо", "Многу високо"],
  modeOptions: {
    medium: ["Средно"],
    high: ["Високо"],
    extraHigh: ["Многу високо"],
  },
  modeOpenerExtra: ["Конфигурирај..."],
  tools: {
    web_search: ["Пребарување на интернет"],
    deep_research: ["Длабоко истражување"],
    create_image: ["Креирај слика"],
  },
  signedInMarkers: ["Нов разговор", "Пребарај разговори", "Неодамнешни", "Историја на разговори", "Проекти", "Прашај што било"],
  responseActions: ["Копирај одговор"],
  stopControl: ["Сопри одговарање"],
} satisfies LocaleContribution;
