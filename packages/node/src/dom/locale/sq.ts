import type { LocaleContribution } from "./types.js";

/**
 * Albanian (sq-AL). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sq-AL, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const sq = {
  composerTextbox: ["Pyet për çdo gjë"],
  sendButton: ["Dërgo kërkesën"],
  searchChatsButton: ["Kërko bisedat"],
  searchChatsPlaceholder: ["Kërko bisedat..."],
  newChat: ["Bisedë e re"],
  addFilesButton: ["Shto skedarë e më shumë"],
  addFilesOpenerCandidates: ["Shto skedarë e më shumë"],
  addPhotosFilesMenuItem: ["Ngarko foto dhe skedarë"],
  copyResponse: ["Kopjo përgjigjen"],
  modeLabels: ["I menjëhershëm", "Mesatar", "Lartë", "Shumë i lartë"],
  modeOptions: {
    instant: ["I menjëhershëm"],
    medium: ["Mesatar"],
    high: ["Lartë"],
    extraHigh: ["Shumë i lartë"],
  },
  modeOpenerExtra: ["Konfiguro..."],
  tools: {
    web_search: ["Kërkim në ueb"],
    deep_research: ["Kërkim i thellë"],
    create_image: ["Krijo një imazh"],
  },
  signedInMarkers: ["Bisedë e re", "Kërko bisedat", "Më të fundit", "Historia e bisedës", "Projektet", "Pyet për çdo gjë"],
  responseActions: ["Kopjo përgjigjen"],
  stopControl: ["Ndalo përgjigjen"],
} satisfies LocaleContribution;
