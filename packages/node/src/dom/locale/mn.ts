import type { LocaleContribution } from "./types.js";

/**
 * Mongolian (mn). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=mn, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["Шуурхай", "Дунд", "Өндөр", "Маш өндөр", "Про"],
  modeOptions: {
    instant: ["Шуурхай"],
    medium: ["Дунд"],
    high: ["Өндөр"],
    extraHigh: ["Маш өндөр"],
    pro: ["Про"],
  },
  modeOpenerExtra: ["Тохируулах..."],
  tools: {
    web_search: ["Веб хайлт"],
    deep_research: ["Гүн судалгаа"],
    create_image: ["Зураг үүсгэх"],
  },
  signedInMarkers: ["Шинэ чат", "Чат хайх", "Саяхны зүйлс", "Чатын түүх", "Төслүүд", "Дурын зүйл асуугаарай..."],
  responseActions: ["Хариулт хуулах"],
  stopControl: ["Хариултыг зогсоох"],
} satisfies LocaleContribution;
