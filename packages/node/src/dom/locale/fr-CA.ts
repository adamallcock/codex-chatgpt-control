import type { LocaleContribution } from "./types.js";

/**
 * French Canada (fr-CA). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=fr-CA, Google Translate confirmed off).
 *
 * Uses distinctly Québécois vocabulary: "clavardage" for chat, "requête" for prompt.
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Prolongée" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const frCA = {
  composerTextbox: ["Converser avec ChatGPT"],
  sendButton: ["Envoyer la requête"],
  searchChatsButton: ["Rechercher les clavardages"],
  searchChatsPlaceholder: ["Rechercher les clavardages…"],
  newChat: ["Nouvelle session de clavardage"],
  addFilesButton: ["Ajouter des fichiers et plus encore"],
  addFilesOpenerCandidates: ["Ajouter des fichiers et plus encore"],
  addPhotosFilesMenuItem: ["Ajouter des photos et des fichiers"],
  copyResponse: ["Copier la réponse"],
  modeOpenerExtra: ["Configurer..."],
  tools: {
    web_search: ["Recherche sur Internet"],
    deep_research: ["Recherche approfondie"],
    create_image: ["Créer une image"],
  },
  signedInMarkers: ["Nouvelle session de clavardage", "Rechercher les clavardages", "Récentes", "Historique des clavardages", "Projets", "Converser avec ChatGPT"],
  responseActions: ["Copier la réponse"],
} satisfies LocaleContribution;
