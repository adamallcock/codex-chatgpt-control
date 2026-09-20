import type { LocaleContribution } from "./types.js";

/**
 * Armenian (hy-AM). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hy-AM, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const hy = {
  configurationAxes: {
    power: ["Հզորություն"],
    model: ["Մոդել", "Ընտրել մոդելը"],
    effort: ["Ջանք", "Մտածողության մակարդակ", "Հզորություն"],
    speed: ["Արագություն"],
    advanced: ["Ընդլայնված"],
  },
  configurationOptions: {
    instant: ["Ակնթարթային"],
    light: ["Թեթև"],
    medium: ["Միջին"],
    high: ["Հզոր"],
    extraHigh: ["Ավելի հզոր"],
    max: ["Առավելագույն"],
    ultra: ["Ուլտրա"],
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
  experienceOptions: {
    chat: ["Զրույց"],
    work: ["Աշխատանք"],
  },
  tools: {
    web_search: ["Վեբ որոնում"],
    deep_research: ["Խորը ուսումնասիրություն"],
    create_image: ["Ստեղծել պատկեր"],
  },
  signedInMarkers: ["Նոր զրույց", "Որոնել զրույցները", "Թարմ", "Զրույցների պատմություն", "Նախագծեր", "Զրույց ChatGPT-ի հետ"],
  responseActions: ["Պատճենել պատասխանը"],
  stopControl: ["Դադարեցնել պատասխանելը"],
} satisfies LocaleContribution;
