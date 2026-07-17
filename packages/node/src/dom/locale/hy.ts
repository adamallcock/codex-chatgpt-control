import type { LocaleContribution } from "./types.js";

/**
 * Armenian (hy-AM). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hy-AM, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const hy = {
  configurationAxes: {
    model: ["Մոդել"],
    effort: ["Ջանք"],
    speed: ["Արագություն"],
  },
  configurationOptions: {
    light: ["Թեթև"],
    medium: ["Միջին"],
    high: ["Հզոր"],
    extraHigh: ["Ավելի հզոր"],
    standard: ["Ստանդարտ"],
    fast: ["Արագ"],
  },
  composerTextbox: ["Զրույց ChatGPT-ի հետ"],
  sendButton: ["Ուղարկել հուշանիշ"],
  searchChatsButton: ["Որոնել զրույցները"],
  searchChatsPlaceholder: ["Որոնել զրույցներում․․․"],
  newChat: ["Նոր զրույց"],
  addFilesButton: ["Ավելացրեք ֆայլեր և ավելին"],
  addFilesOpenerCandidates: ["Ավելացրեք ֆայլեր և ավելին"],
  addPhotosFilesMenuItem: ["Ավելացնել լուսանկարներ և ֆայլեր"],
  copyResponse: ["Պատճենել պատասխանը"],
  modeLabels: ["Ակնթարթային", "Միջին", "Բարձր", "Շատ բարձր", "Պրո", "Հզոր", "Ավելի հզոր"],
  modeOptions: {
    instant: ["Ակնթարթային"],
    medium: ["Միջին"],
    high: ["Բարձր", "Հզոր"],
    extraHigh: ["Շատ բարձր", "Ավելի հզոր"],
    pro: ["Պրո"],
  },
  modeOpenerExtra: ["Կազմաձևել․․․"],
  tools: {
    web_search: ["Վեբ որոնում"],
    deep_research: ["Խորը ուսումնասիրություն"],
    create_image: ["Ստեղծել պատկեր"],
  },
  signedInMarkers: ["Նոր զրույց", "Որոնել զրույցները", "Թարմ", "Զրույցների պատմություն", "Նախագծեր", "Զրույց ChatGPT-ի հետ"],
  responseActions: ["Պատճենել պատասխանը"],
  stopControl: ["Դադարեցնել պատասխանելը"],
} satisfies LocaleContribution;
