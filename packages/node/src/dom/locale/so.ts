import type { LocaleContribution } from "./types.js";

/**
 * Somali (so-SO). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=so-SO, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 from a visible ChatGPT Pro session.
 */
export const so = {
  composerTextbox: ["Waydii waxkasta"],
  sendButton: ["Dir qoraal"],
  searchChatsButton: ["Raadi wada-sheekaysiyada"],
  searchChatsPlaceholder: ["Raadi wada sheekaysiga..."],
  newChat: ["Wada Sheekeysi cusub"],
  addFilesButton: ["Ku dar faylashada iyo wax badan"],
  addFilesOpenerCandidates: ["Ku dar faylashada iyo wax badan"],
  addPhotosFilesMenuItem: ["Soo geli sawirada & faylasha"],
  copyResponse: ["Koobiyee jawaabta"],
  modeLabels: ["Degdeg", "Dhexdhexaad", "Sare", "Aad u sarreeya"],
  modeOpenerExtra: ["Ku xidh..."],
  tools: {
    web_search: ["Raadi shakabada"],
    deep_research: ["Cilmi baadhid qoto dheer"],
    create_image: ["Abuur sawir"],
  },
  signedInMarkers: ["Wada Sheekeysi cusub", "Raadi wada-sheekaysiyada", "Waxyaabihii dhawaa", "Taariikhda sheekeysiga", "Mashruucyada", "Waydii waxkasta"],
  responseActions: ["Koobiyee jawaabta"],
} satisfies LocaleContribution;
