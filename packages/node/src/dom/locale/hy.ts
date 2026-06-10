import type { LocaleContribution } from "./types.js";

/**
 * Armenian (hy-AM). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hy-AM, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Ընդլայնված" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const hy = {
  composerTextbox: ["Զրույց ChatGPT-ի հետ"],
  sendButton: ["Ուղարկել հուշանիշ"],
  searchChatsButton: ["Որոնել զրույցները"],
  searchChatsPlaceholder: ["Որոնել զրույցներում․․․"],
  newChat: ["Նոր զրույց"],
  addFilesButton: ["Ավելացրեք ֆայլեր և ավելին"],
  addFilesOpenerCandidates: ["Ավելացրեք ֆայլեր և ավելին"],
  addPhotosFilesMenuItem: ["Ավելացնել լուսանկարներ և ֆայլեր"],
  copyResponse: ["Պատճենել պատասխանը"],
  modeOpenerExtra: ["Կազմաձևել․․․"],
  tools: {
    web_search: ["Վեբ որոնում"],
    deep_research: ["Խորը ուսումնասիրություն"],
    create_image: ["Ստեղծել պատկեր"],
  },
  signedInMarkers: ["Նոր զրույց", "Որոնել զրույցները", "Թարմ", "Զրույցների պատմություն", "Նախագծեր", "Զրույց ChatGPT-ի հետ"],
  responseActions: ["Պատճենել պատասխանը"],
} satisfies LocaleContribution;
