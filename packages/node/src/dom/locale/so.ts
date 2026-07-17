import type { LocaleContribution } from "./types.js";

/**
 * Somali (so-SO). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=so-SO, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const so = {
  configurationAxes: {
    model: ["Moodel"],
    effort: ["Dadaal"],
    speed: ["Xawaare"],
  },
  configurationOptions: {
    light: ["Fudud"],
    medium: ["Dhexdhexaad"],
    high: ["Sare"],
    extraHigh: ["Aad U Sarreeya"],
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
  tools: {
    web_search: ["Raadi shakabada"],
    deep_research: ["Cilmi baadhid qoto dheer"],
    create_image: ["Abuur sawir"],
  },
  signedInMarkers: ["Wada Sheekeysi cusub", "Raadi wada-sheekaysiyada", "Waxyaabihii dhawaa", "Taariikhda sheekeysiga", "Mashruucyada", "Waydii waxkasta"],
  responseActions: ["Koobiyee jawaabta"],
  stopControl: ["Jooji jawaabista"],
} satisfies LocaleContribution;
