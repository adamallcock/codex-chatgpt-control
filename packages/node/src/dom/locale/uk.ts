import type { LocaleContribution } from "./types.js";

/**
 * Ukrainian (uk-UA). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=uk-UA, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const uk = {
  composerTextbox: ["Запитайте будь-що"],
  sendButton: ["Надіслати запит"],
  searchChatsButton: ["Пошук чатів"],
  searchChatsPlaceholder: ["Пошук у чатах…"],
  newChat: ["Новий чат"],
  addFilesButton: ["Додавайте файли й виконуйте інші дії"],
  addFilesOpenerCandidates: ["Додавайте файли й виконуйте інші дії"],
  addPhotosFilesMenuItem: ["Додати світлини та файли"],
  copyResponse: ["Копіювати відповідь"],
  modeLabels: ["Миттєвий", "Середній", "Високий", "Дуже високий"],
  modeOptions: {
    instant: ["Миттєвий"],
    medium: ["Середній"],
    high: ["Високий"],
    extraHigh: ["Дуже високий"],
  },
  modeOpenerExtra: ["Налаштувати…"],
  tools: {
    web_search: ["Пошук в Інтернеті"],
    deep_research: ["Глибоко дослідити"],
    create_image: ["Створити зображення"],
  },
  signedInMarkers: ["Новий чат", "Пошук чатів", "Нещодавні", "Історія чатів", "Проєкти", "Запитайте будь-що"],
  responseActions: ["Копіювати відповідь"],
  stopControl: ["Зупинити відповідь"],
} satisfies LocaleContribution;
