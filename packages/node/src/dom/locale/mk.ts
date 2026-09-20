import type { LocaleContribution } from "./types.js";

/**
 * Macedonian (mk-MK). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=mk-MK, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const mk = {
  configurationAxes: {
    power: ["Моќност"],
    model: ["Модел", "Избери модел"],
    effort: ["Напор", "Моќност"],
    speed: ["Брзина"],
    advanced: ["Напредно"],
  },
  configurationOptions: {
    light: ["Лесно"],
    medium: ["Средна"],
    high: ["Висока"],
    extraHigh: ["Екстра висока", "Многу висока"],
    max: ["Макс"],
    ultra: ["Ултра"],
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
  experienceOptions: {
    chat: ["Разговор"],
    work: ["Работа"],
  },
  tools: {
    web_search: ["Пребарување на интернет"],
    deep_research: ["Длабоко истражување"],
    create_image: ["Креирај слика"],
  },
  signedInMarkers: ["Нов разговор", "Пребарај разговори", "Неодамнешни", "Историја на разговори", "Проекти", "Прашај што било"],
  responseActions: ["Копирај одговор"],
  stopControl: ["Сопри одговарање"],
} satisfies LocaleContribution;
