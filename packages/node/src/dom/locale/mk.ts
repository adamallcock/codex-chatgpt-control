import type { LocaleContribution } from "./types.js";

/**
 * Macedonian (mk-MK). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=mk-MK, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const mk = {
  configurationAxes: {
    model: ["Модел"],
    effort: ["Напор"],
    speed: ["Брзина"],
  },
  configurationOptions: {
    light: ["Лесно"],
    medium: ["Средна"],
    high: ["Висока"],
    extraHigh: ["Екстра висока"],
    standard: ["Стандарден"],
    fast: ["Брзо"],
  },
  composerTextbox: ["Прашај што било"],
  sendButton: ["Испрати промпт"],
  searchChatsButton: ["Пребарај разговори"],
  searchChatsPlaceholder: ["Пребарувај разговори..."],
  newChat: ["Нов разговор"],
  addFilesButton: ["Додај датотеки и повеќе"],
  addFilesOpenerCandidates: ["Додај датотеки и повеќе"],
  addPhotosFilesMenuItem: ["Постави фотографии и датотеки"],
  copyResponse: ["Копирај одговор"],
  modeLabels: ["Средно", "Високо", "Многу високо", "Средна", "Висока", "Многу висока"],
  modeOptions: {
    medium: ["Средно", "Средна"],
    high: ["Високо", "Висока"],
    extraHigh: ["Многу високо", "Многу висока"],
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
