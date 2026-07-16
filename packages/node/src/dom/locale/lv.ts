import type { LocaleContribution } from "./types.js";

/**
 * Latvian (lv-LV). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=lv-LV, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const lv = {
  composerTextbox: ["Jautā jebko"],
  sendButton: ["Sūtīt uzvedni"],
  searchChatsButton: ["Meklēt tērzēšanas"],
  searchChatsPlaceholder: ["Meklēt tērzētavās..."],
  newChat: ["Jauna tērzētava"],
  addFilesButton: ["Failu pievienošana un citas funkcijas"],
  addFilesOpenerCandidates: ["Failu pievienošana un citas funkcijas"],
  addPhotosFilesMenuItem: ["Augšupielādēt foto un failus"],
  copyResponse: ["Kopēt atbildi"],
  modeLabels: ["Tūlītējs", "Vidējs", "Augsts", "Ļoti augsts"],
  modeOptions: {
    instant: ["Tūlītējs"],
    medium: ["Vidējs"],
    high: ["Augsts"],
    extraHigh: ["Ļoti augsts"],
  },
  modeOpenerExtra: ["Konfigurēt..."],
  tools: {
    web_search: ["Meklēšana tīmeklī"],
    deep_research: ["Padziļināta izpēte"],
    create_image: ["Izveido attēlu"],
  },
  signedInMarkers: ["Jauna tērzētava", "Meklēt tērzēšanas", "Nesenās sarunas", "Tērzēšanas vēsture", "Projekti", "Jautā jebko"],
  responseActions: ["Kopēt atbildi"],
  stopControl: ["Pārtraukt atbildi"],
} satisfies LocaleContribution;
