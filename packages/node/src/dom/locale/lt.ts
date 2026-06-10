import type { LocaleContribution } from "./types.js";

/**
 * Lithuanian (lt). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=lt, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Išplėstinis" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const lt = {
  composerTextbox: ['Pokalbis su „ChatGPT“'],
  sendButton: ["Siųsti raginimą"],
  searchChatsButton: ["Ieškoti pokalbiuose"],
  searchChatsPlaceholder: ["Ieškokite pokalbiuose..."],
  newChat: ["Naujas pokalbis"],
  addFilesButton: ["Įtraukti failus ir daugiau"],
  addFilesOpenerCandidates: ["Įtraukti failus ir daugiau"],
  addPhotosFilesMenuItem: ["Pridėti nuotraukų ir failų"],
  copyResponse: ["Kopijuoti atsakymą"],
  modeOpenerExtra: ["Konfigūruoti..."],
  tools: {
    web_search: ["Žiniatinklio paieška"],
    deep_research: ["Gilus tyrinėjimas"],
    create_image: ["Sukurti vaizdą"],
  },
  signedInMarkers: ["Naujas pokalbis", "Ieškoti pokalbiuose", "Vėliausieji", "Pokalbių istorija", "Projektai", 'Pokalbis su „ChatGPT"'],
  responseActions: ["Kopijuoti atsakymą"],
} satisfies LocaleContribution;
