import type { LocaleContribution } from "./types.js";

/**
 * Slovak (sk-SK). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sk-SK, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const sk = {
  composerTextbox: ["Spýtaj sa hocičo…"],
  sendButton: ["Odoslať príkaz"],
  searchChatsButton: ["Hľadať v četoch"],
  searchChatsPlaceholder: ["Prehľadávať čety..."],
  newChat: ["Nový čet"],
  addFilesButton: ["Pridať súbory a iné"],
  addFilesOpenerCandidates: ["Pridať súbory a iné"],
  addPhotosFilesMenuItem: ["Nahrať fotografie a súbory"],
  copyResponse: ["Kopírovať odpoveď"],
  modeLabels: ["Okamžitá", "Stredná", "Vysoká", "Extra vysoká"],
  modeOptions: {
    instant: ["Okamžitá"],
    medium: ["Stredná"],
    high: ["Vysoká"],
    extraHigh: ["Extra vysoká"],
  },
  modeOpenerExtra: ["Konfigurovať..."],
  tools: {
    web_search: ["Prehľadávaj web"],
    deep_research: ["Podrobné vyhľadávanie"],
    create_image: ["Vytvor obrázok"],
  },
  signedInMarkers: ["Nový čet", "Hľadať v četoch", "Nedávne", "História četov", "Projekty", "Spýtaj sa hocičo…"],
  responseActions: ["Kopírovať odpoveď"],
  stopControl: ["Zastaviť odpoveď"],
} satisfies LocaleContribution;
