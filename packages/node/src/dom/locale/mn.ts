import type { LocaleContribution } from "./types.js";

/**
 * Mongolian (mn). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=mn, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const mn = {
  configurationAxes: {
    power: ["Чадал"],
    model: ["Загвар", "Загвар сонгох"],
    effort: ["Хүчин чармайлт", "Тооцоолол", "Чадал"],
    speed: ["Хурд"],
    advanced: ["Дэвшилтэт"],
  },
  configurationOptions: {
    instant: ["Шуурхай"],
    light: ["Хөнгөн"],
    medium: ["Дунд"],
    high: ["Их", "Өндөр"],
    extraHigh: ["Маш их", "Маш өндөр"],
    max: ["Хамгийн их"],
    ultra: ["Ультра"],
    standard: ["Стандарт"],
    fast: ["Хурдан"],
  },
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
  experienceOptions: {
    chat: ["Чат"],
    work: ["Ажил"],
  },
  tools: {
    web_search: ["Веб хайлт"],
    deep_research: ["Гүн судалгаа"],
    create_image: ["Зураг үүсгэх"],
  },
  signedInMarkers: ["Шинэ чат", "Чат хайх", "Саяхны зүйлс", "Чатын түүх", "Төслүүд", "Дурын зүйл асуугаарай..."],
  responseActions: ["Хариулт хуулах"],
  stopControl: ["Хариултыг зогсоох"],
} satisfies LocaleContribution;
