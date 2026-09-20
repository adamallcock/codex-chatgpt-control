import type { LocaleContribution } from "./types.js";

/**
 * Ukrainian (uk-UA). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=uk-UA, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const uk = {
  configurationAxes: {
    power: ["Потужність"],
    model: ["Модель", "Вибрати модель"],
    effort: ["Зусилля", "Міркування", "Потужність"],
    speed: ["Швидкість"],
    advanced: ["Додатково"],
  },
  configurationOptions: {
    instant: ["Миттєвий", "Миттєве"],
    light: ["Низький"],
    medium: ["Середній"],
    high: ["Високий"],
    extraHigh: ["Найвищий"],
    max: ["Макс."],
    ultra: ["Ультра"],
    standard: ["Стандартний"],
    fast: ["Швидка"],
  },
  composerTextbox: ["Запитайте будь-що"],
  sendButton: ["Надіслати запит"],
  searchChatsButton: ["Пошук чатів"],
  searchChatsPlaceholder: ["Пошук у чатах…"],
  newChat: ["Новий чат"],
  addFilesButton: ["Додавайте файли й виконуйте інші дії"],
  addFilesOpenerCandidates: ["Додавайте файли й виконуйте інші дії"],
  addPhotosFilesMenuItem: ["Додати світлини та файли"],
  copyResponse: ["Копіювати відповідь"],
  modeLabels: ["Миттєвий", "Середній", "Високий", "Дуже високий", "Найвищий", "Миттєве"],
  modeOptions: {
    instant: ["Миттєвий", "Миттєве"],
    medium: ["Середній"],
    high: ["Високий"],
    extraHigh: ["Дуже високий", "Найвищий"],
  },
  modeOpenerExtra: ["Налаштувати…"],
  experienceOptions: {
    chat: ["Чат"],
    work: ["Робота"],
  },
  tools: {
    web_search: ["Пошук в Інтернеті"],
    deep_research: ["Глибоко дослідити"],
    create_image: ["Створити зображення"],
  },
  signedInMarkers: ["Новий чат", "Пошук чатів", "Нещодавні", "Історія чатів", "Проєкти", "Запитайте будь-що"],
  responseActions: ["Копіювати відповідь"],
  stopControl: ["Зупинити відповідь"],
} satisfies LocaleContribution;
