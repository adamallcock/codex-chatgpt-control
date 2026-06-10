import type { LocaleContribution } from "./types.js";

/**
 * Hungarian (hu-HU). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hu-HU, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Kibővített" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
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
  modeOpenerExtra: ["Konfigurálás..."],
  tools: {
    web_search: ["Internetes keresés"],
    deep_research: ["Mély kutatás"],
    create_image: ["Kép létrehozása"],
  },
  signedInMarkers: ["Új csevegés", "Beszélgetések keresése", "Legutóbbiak", "Csevegési előzmények", "Projektek", "Csevegés a ChatGPT-vel"],
  responseActions: ["Válasz másolása"],
} satisfies LocaleContribution;
