import type { LocaleContribution } from "./types.js";

/**
 * Ukrainian (uk-UA). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=uk-UA, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
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
  modeOpenerExtra: ["Налаштувати…"],
  tools: {
    web_search: ["Пошук в Інтернеті"],
    deep_research: ["Глибоко дослідити"],
    create_image: ["Створити зображення"],
  },
  signedInMarkers: ["Новий чат", "Пошук чатів", "Нещодавні", "Історія чатів", "Проєкти", "Запитайте будь-що"],
  responseActions: ["Копіювати відповідь"],
} satisfies LocaleContribution;
