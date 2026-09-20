import type { LocaleContribution } from "./types.js";

/**
 * Lithuanian (lt). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=lt, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const lt = {
  configurationAxes: {
    power: ["Pajėgumas"],
    model: ["Modelis", "Pasirinkti modelį"],
    effort: ["Pastangos", "Mąstymo lygis", "Pajėgumas"],
    speed: ["Greitis"],
    advanced: ["Išplėstiniai"],
  },
  configurationOptions: {
    instant: ["Momentinis"],
    light: ["Lengvas"],
    medium: ["Vidutinis"],
    high: ["Aukštas"],
    extraHigh: ["Labai aukštas", "Ypač didelės"],
    max: ["Maks."],
    standard: ["Standartinis"],
    fast: ["Greitas"],
  },
  composerTextbox: ['Pokalbis su „ChatGPT“'],
  sendButton: ["Siųsti raginimą"],
  searchChatsButton: ["Ieškoti pokalbiuose"],
  searchChatsPlaceholder: ["Ieškokite pokalbiuose..."],
  newChat: ["Naujas pokalbis"],
  addFilesButton: ["Įtraukti failus ir daugiau"],
  addFilesOpenerCandidates: ["Įtraukti failus ir daugiau"],
  addPhotosFilesMenuItem: ["Pridėti nuotraukų ir failų"],
  copyResponse: ["Kopijuoti atsakymą"],
  modeLabels: ["Momentinis", "Vidutinis", "Aukštas", "Ypač didelis", "Profesionalus", "Labai aukštas"],
  modeOptions: {
    instant: ["Momentinis"],
    medium: ["Vidutinis"],
    high: ["Aukštas"],
    extraHigh: ["Ypač didelis", "Labai aukštas"],
    pro: ["Profesionalus"],
  },
  modeOpenerExtra: ["Konfigūruoti..."],
  tools: {
    web_search: ["Žiniatinklio paieška"],
    deep_research: ["Gilus tyrinėjimas"],
    create_image: ["Sukurti vaizdą"],
  },
  signedInMarkers: ["Naujas pokalbis", "Ieškoti pokalbiuose", "Vėliausieji", "Pokalbių istorija", "Projektai", 'Pokalbis su „ChatGPT"'],
  responseActions: ["Kopijuoti atsakymą"],
  stopControl: ["Stabdyti atsakymą"],
} satisfies LocaleContribution;
