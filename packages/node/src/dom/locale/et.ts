import type { LocaleContribution } from "./types.js";

/**
 * Estonian (et-EE). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=et-EE, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const et = {
  configurationAxes: {
    power: ["Võimsus"],
    model: ["Mudel", "Vali mudel"],
    effort: ["Pingutus", "Põhjalikkus", "Võimsus"],
    speed: ["Kiirus"],
    advanced: ["Täpsemad seaded"],
  },
  configurationOptions: {
    instant: ["Kohene", "Kiire"],
    light: ["Kerge"],
    medium: ["Keskmine"],
    high: ["Kõrge"],
    extraHigh: ["Väga kõrge"],
    fast: ["Kiire"],
  },
  composerTextbox: ["Vestle ChatGPT-ga"],
  sendButton: ["Saada viip"],
  searchChatsButton: ["Otsi vestlusi"],
  searchChatsPlaceholder: ["Otsi vestlusi…"],
  newChat: ["Uus vestlus"],
  addFilesButton: ["Failide lisamine ja muud"],
  addFilesOpenerCandidates: ["Failide lisamine ja muud"],
  addPhotosFilesMenuItem: ["Lisa fotosid ja faile"],
  copyResponse: ["Kopeeri vastus"],
  modeLabels: ["Kohene", "Keskmine", "Kõrge", "Väga kõrge", "Kiire"],
  modeOptions: {
    instant: ["Kohene", "Kiire"],
    medium: ["Keskmine"],
    high: ["Kõrge"],
    extraHigh: ["Väga kõrge"],
  },
  modeOpenerExtra: ["Konfigureeri..."],
  tools: {
    web_search: ["Veebiotsing"],
    deep_research: ["Süvauuring"],
    create_image: ["Loo pilt"],
  },
  signedInMarkers: ["Uus vestlus", "Otsi vestlusi", "Hiljutised", "Vestlusajalugu", "Projektid", "Vestle ChatGPT-ga"],
  responseActions: ["Kopeeri vastus"],
  stopControl: ["Peata vastamine"],
} satisfies LocaleContribution;
