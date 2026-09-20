import type { LocaleContribution } from "./types.js";

/**
 * Somali (so-SO). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=so-SO, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const so = {
  configurationAxes: {
    power: ["Awood"],
    model: ["Moodel", "Dooro moodelka"],
    effort: ["Dadaal", "Awood"],
    speed: ["Xawaare"],
    advanced: ["Horumarsan"],
  },
  configurationOptions: {
    instant: ["Degdeg"],
    light: ["Fudud"],
    medium: ["Dhexdhexaad"],
    high: ["Sare"],
    extraHigh: ["Aad U Sarreeya"],
    max: ["Ugu badan"],
    standard: ["Caadi"],
    fast: ["Degdeg"],
  },
  composerTextbox: ["Waydii waxkasta"],
  sendButton: ["Dir qoraal"],
  searchChatsButton: ["Raadi wada-sheekaysiyada"],
  searchChatsPlaceholder: ["Raadi wada sheekaysiga..."],
  newChat: ["Wada Sheekeysi cusub"],
  addFilesButton: ["Ku dar faylashada iyo wax badan"],
  addFilesOpenerCandidates: ["Ku dar faylashada iyo wax badan"],
  addPhotosFilesMenuItem: ["Soo geli sawirada & faylasha"],
  copyResponse: ["Koobiyee jawaabta"],
  modeLabels: ["Degdeg", "Dhexdhexaad", "Sare", "Aad u sarreeya", "Aad U Sarreeya"],
  modeOptions: {
    instant: ["Degdeg"],
    medium: ["Dhexdhexaad"],
    high: ["Sare"],
    extraHigh: ["Aad u sarreeya", "Aad U Sarreeya"],
  },
  modeOpenerExtra: ["Ku xidh..."],
  experienceOptions: {
    chat: ["Sheekaysi"],
    work: ["Shaqo"],
  },
  tools: {
    web_search: ["Raadi shakabada"],
    deep_research: ["Cilmi baadhid qoto dheer"],
    create_image: ["Abuur sawir"],
  },
  signedInMarkers: ["Wada Sheekeysi cusub", "Raadi wada-sheekaysiyada", "Waxyaabihii dhawaa", "Taariikhda sheekeysiga", "Mashruucyada", "Waydii waxkasta"],
  responseActions: ["Koobiyee jawaabta"],
  stopControl: ["Jooji jawaabista"],
} satisfies LocaleContribution;
