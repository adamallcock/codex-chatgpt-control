import type { LocaleContribution } from "./types.js";

/**
 * Slovak (sk-SK). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=sk-SK, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
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
  modeOpenerExtra: ["Konfigurovať..."],
  tools: {
    web_search: ["Prehľadávaj web"],
    deep_research: ["Podrobné vyhľadávanie"],
    create_image: ["Vytvor obrázok"],
  },
  signedInMarkers: ["Nový čet", "Hľadať v četoch", "Nedávne", "História četov", "Projekty", "Spýtaj sa hocičo…"],
  responseActions: ["Kopírovať odpoveď"],
} satisfies LocaleContribution;
