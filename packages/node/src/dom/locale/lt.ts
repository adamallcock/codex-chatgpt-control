import type { LocaleContribution } from "./types.js";

/**
 * Lithuanian (lt). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=lt, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const lt = {
  configurationAxes: {
    model: ["Modelis"],
    effort: ["Pastangos"],
    speed: ["Greitis"],
  },
  configurationOptions: {
    light: ["Lengvas"],
    medium: ["Vidutinis"],
    high: ["Aukštas"],
    extraHigh: ["Labai aukštas"],
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
