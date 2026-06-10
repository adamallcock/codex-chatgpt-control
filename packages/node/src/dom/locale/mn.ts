import type { LocaleContribution } from "./types.js";

/**
 * Mongolian (mn). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=mn, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const mn = {
  composerTextbox: ["Дурын зүйл асуугаарай..."],
  sendButton: ["Сануулга илгээх"],
  searchChatsButton: ["Чат хайх"],
  searchChatsPlaceholder: ["Чат хайх..."],
  newChat: ["Шинэ чат"],
  addFilesButton: ["Файл болон бусад зүйлс нэмэх"],
  addFilesOpenerCandidates: ["Файл болон бусад зүйлс нэмэх"],
  addPhotosFilesMenuItem: ["Зураг ба файл байршуулах"],
  copyResponse: ["Хариулт хуулах"],
  modeOpenerExtra: ["Тохируулах..."],
  tools: {
    web_search: ["Веб хайлт"],
    deep_research: ["Гүн судалгаа"],
    create_image: ["Зураг үүсгэх"],
  },
  signedInMarkers: ["Шинэ чат", "Чат хайх", "Саяхны зүйлс", "Чатын түүх", "Төслүүд", "Дурын зүйл асуугаарай..."],
  responseActions: ["Хариулт хуулах"],
} satisfies LocaleContribution;
