import type { LocaleContribution } from "./types.js";

/**
 * Kazakh (kk). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=kk, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const kk = {
  configurationAxes: {
    model: ["Модель"],
    effort: ["Күш-жігер"],
    speed: ["Жылдамдық"],
  },
  configurationOptions: {
    light: ["Жеңіл"],
    medium: ["Орташа"],
    high: ["Жоғары"],
    extraHigh: ["Өте жоғары"],
    standard: ["Стандартты"],
    fast: ["Жылдам"],
  },
  composerTextbox: ["ChatGPT-мен чат"],
  sendButton: ["Көмексөз жіберу"],
  searchChatsButton: ["Чаттарды іздеу"],
  searchChatsPlaceholder: ["Чаттарды іздеу..."],
  newChat: ["Жаңа чат"],
  addFilesButton: ["Файлдарды және басқа деректерді қосу"],
  addFilesOpenerCandidates: ["Файлдарды және басқа деректерді қосу"],
  addPhotosFilesMenuItem: ["Фотосуреттер мен файлдар қосу"],
  copyResponse: ["Жауапты көшіру"],
  modeLabels: ["Жедел", "Орташа", "Жоғары", "Аса жоғары", "Өте жоғары"],
  modeOptions: {
    instant: ["Жедел"],
    medium: ["Орташа"],
    high: ["Жоғары"],
    extraHigh: ["Аса жоғары", "Өте жоғары"],
  },
  modeOpenerExtra: ["Кофигурациялау..."],
  tools: {
    web_search: ["Іздеу"],
    deep_research: ["Терең зерттеу"],
    create_image: ["Сурет жаса"],
  },
  signedInMarkers: ["Жаңа чат", "Чаттарды іздеу", "Соңғылары", "Чат тарихы", "Жобалар", "ChatGPT-мен чат"],
  responseActions: ["Жауапты көшіру"],
  stopControl: ["Жауап беруді тоқтату"],
} satisfies LocaleContribution;
