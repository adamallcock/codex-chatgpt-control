import type { LocaleContribution } from "./types.js";

/**
 * Latvian (lv-LV). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=lv-LV, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const lv = {
  configurationAxes: {
    power: ["Jauda"],
    model: ["Modelis", "Izvēlēties modeli"],
    effort: ["Pūles", "Jauda"],
    speed: ["Ātrums"],
    advanced: ["Papildu"],
  },
  configurationOptions: {
    instant: ["Tūlītējs"],
    light: ["Viegls"],
    medium: ["Vidējs"],
    high: ["Augsts"],
    extraHigh: ["Ļoti augsts"],
    max: ["Maks."],
    standard: ["Standarta"],
    fast: ["Ātrs"],
  },
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
