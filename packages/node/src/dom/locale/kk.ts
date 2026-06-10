import type { LocaleContribution } from "./types.js";

/**
 * Kazakh (kk). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=kk, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Кеңейтілген" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const kk = {
  composerTextbox: ["ChatGPT-мен чат"],
  sendButton: ["Көмексөз жіберу"],
  searchChatsButton: ["Чаттарды іздеу"],
  searchChatsPlaceholder: ["Чаттарды іздеу..."],
  newChat: ["Жаңа чат"],
  addFilesButton: ["Файлдарды және басқа деректерді қосу"],
  addFilesOpenerCandidates: ["Файлдарды және басқа деректерді қосу"],
  addPhotosFilesMenuItem: ["Фотосуреттер мен файлдар қосу"],
  copyResponse: ["Жауапты көшіру"],
  modeOpenerExtra: ["Кофигурациялау..."],
  tools: {
    web_search: ["Іздеу"],
    deep_research: ["Терең зерттеу"],
    create_image: ["Сурет жаса"],
  },
  signedInMarkers: ["Жаңа чат", "Чаттарды іздеу", "Соңғылары", "Чат тарихы", "Жобалар", "ChatGPT-мен чат"],
  responseActions: ["Жауапты көшіру"],
} satisfies LocaleContribution;
