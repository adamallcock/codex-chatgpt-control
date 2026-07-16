import type { LocaleContribution } from "./types.js";

/**
 * Hungarian (hu-HU). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hu-HU, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const hu = {
  composerTextbox: ["Csevegés a ChatGPT-vel"],
  sendButton: ["Utasítás küldése"],
  searchChatsButton: ["Beszélgetések keresése"],
  searchChatsPlaceholder: ["Csevegések keresése…"],
  newChat: ["Új csevegés"],
  addFilesButton: ["Fájlok és egyebek hozzáadása"],
  addFilesOpenerCandidates: ["Fájlok és egyebek hozzáadása"],
  addPhotosFilesMenuItem: ["Fotók és fájlok hozzáadása"],
  copyResponse: ["Válasz másolása"],
  modeLabels: ["Azonnali", "Közepes", "Magas", "Kiemelkedően magas"],
  modeOptions: {
    instant: ["Azonnali"],
    medium: ["Közepes"],
    high: ["Magas"],
    extraHigh: ["Kiemelkedően magas"],
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
