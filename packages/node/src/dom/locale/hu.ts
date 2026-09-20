import type { LocaleContribution } from "./types.js";

/**
 * Hungarian (hu-HU). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hu-HU, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const hu = {
  configurationAxes: {
    power: ["Teljesítmény"],
    model: ["Modell", "Modell kiválasztása"],
    effort: ["Ráfordítás", "Erőfeszítés", "Teljesítmény"],
    speed: ["Sebesség"],
    advanced: ["Speciális"],
  },
  configurationOptions: {
    instant: ["Azonnali"],
    light: ["Egyszerű"],
    medium: ["Közepes"],
    high: ["Erős"],
    extraHigh: ["Extra erős"],
    standard: ["Normál"],
    fast: ["Gyors"],
  },
  composerTextbox: ["Csevegés a ChatGPT-vel"],
  sendButton: ["Utasítás küldése"],
  searchChatsButton: ["Beszélgetések keresése"],
  searchChatsPlaceholder: ["Csevegések keresése…"],
  newChat: ["Új csevegés"],
  addFilesButton: ["Fájlok és egyebek hozzáadása"],
  addFilesOpenerCandidates: ["Fájlok és egyebek hozzáadása"],
  addPhotosFilesMenuItem: ["Fotók és fájlok hozzáadása"],
  copyResponse: ["Válasz másolása"],
  modeLabels: ["Azonnali", "Közepes", "Magas", "Kiemelkedően magas", "Erős", "Extra erős"],
  modeOptions: {
    instant: ["Azonnali"],
    medium: ["Közepes"],
    high: ["Magas", "Erős"],
    extraHigh: ["Kiemelkedően magas", "Extra erős"],
  },
  modeOpenerExtra: ["Konfigurálás..."],
  tools: {
    web_search: ["Internetes keresés"],
    deep_research: ["Mély kutatás"],
    create_image: ["Kép létrehozása"],
  },
  signedInMarkers: ["Új csevegés", "Beszélgetések keresése", "Legutóbbiak", "Csevegési előzmények", "Projektek", "Csevegés a ChatGPT-vel"],
  responseActions: ["Válasz másolása"],
  stopControl: ["Válasz leállítása"],
} satisfies LocaleContribution;
