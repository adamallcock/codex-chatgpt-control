import type { LocaleContribution } from "./types.js";

/**
 * Catalan (ca-ES). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ca-ES, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Esforç" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const ca = {
  composerTextbox: ["Xateja amb el ChatGPT"],
  sendButton: ["Envia la indicació"],
  searchChatsButton: ["Cerca xats"],
  searchChatsPlaceholder: ["Cerca als xats..."],
  newChat: ["Xat nou"],
  addFilesButton: ["Afegeix fitxers i més"],
  addFilesOpenerCandidates: ["Afegeix fitxers i més"],
  addPhotosFilesMenuItem: ["Afegeix fotos i fitxers"],
  copyResponse: ["Copia la resposta"],
  modeOpenerExtra: ["Configura…"],
  tools: {
    web_search: ["Cerca a la xarxa"],
    deep_research: ["Recerca profunda"],
    create_image: ["Crea una imatge"],
  },
  signedInMarkers: ["Xat nou", "Cerca xats", "Recents", "Història de xats", "Projectes", "Xateja amb el ChatGPT"],
  responseActions: ["Copia la resposta"],
} satisfies LocaleContribution;
