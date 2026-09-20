import type { LocaleContribution } from "./types.js";

/**
 * Catalan (ca-ES). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ca-ES, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ca = {
  configurationAxes: {
    power: ["Potència"],
    model: ["Selecciona un model"],
    effort: ["Esforç", "Potència"],
    speed: ["Velocitat"],
    advanced: ["Avançades"],
  },
  configurationOptions: {
    instant: ["Instantània"],
    light: ["Lleuger"],
    medium: ["Mitjana"],
    high: ["Alta"],
    extraHigh: ["Molt alta"],
    max: ["Màxim"],
    standard: ["Estàndard"],
    fast: ["Ràpid"],
  },
  composerTextbox: ["Xateja amb el ChatGPT"],
  sendButton: ["Envia la indicació"],
  searchChatsButton: ["Cerca xats"],
  searchChatsPlaceholder: ["Cerca als xats..."],
  newChat: ["Xat nou"],
  addFilesButton: ["Afegeix fitxers i més"],
  addFilesOpenerCandidates: ["Afegeix fitxers i més"],
  addPhotosFilesMenuItem: ["Afegeix fotos i fitxers"],
  copyResponse: ["Copia la resposta"],
  modeLabels: ["Instantani", "Mitjà", "Alt", "Molt alt", "Instantània", "Mitjana", "Alta", "Molt alta"],
  modeOptions: {
    instant: ["Instantani", "Instantània"],
    medium: ["Mitjà", "Mitjana"],
    high: ["Alt", "Alta"],
    extraHigh: ["Molt alt", "Molt alta"],
  },
  modeOpenerExtra: ["Configura…"],
  experienceOptions: {
    chat: ["Conversa"],
  },
  tools: {
    web_search: ["Cerca a la xarxa"],
    deep_research: ["Recerca profunda"],
    create_image: ["Crea una imatge"],
  },
  signedInMarkers: ["Xat nou", "Cerca xats", "Recents", "Història de xats", "Projectes", "Xateja amb el ChatGPT"],
  responseActions: ["Copia la resposta"],
  stopControl: ["Atura la resposta"],
} satisfies LocaleContribution;
