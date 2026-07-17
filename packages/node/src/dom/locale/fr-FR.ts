import type { LocaleContribution } from "./types.js";

/**
 * French — France (fr-FR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=fr-FR, Google Translate confirmed off).
 *
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, and the login/captcha/rate-limit blocker copy.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const frFR = {
  configurationAxes: {
    model: ["Modèle"],
    effort: ["Niveau"],
    speed: ["Vitesse"],
  },
  configurationOptions: {
    light: ["Minimal"],
    medium: ["Moyenne"],
    high: ["Élevée"],
    extraHigh: ["Très élevée"],
    fast: ["Rapide"],
  },
  composerTextbox: ["Discuter avec ChatGPT"],
  sendButton: ["Envoyer le prompt"],
  searchChatsButton: ["Rechercher dans les chats"],
  searchChatsPlaceholder: ["Rechercher des chats..."],
  newChat: ["Nouveau chat"],
  addFilesButton: ["Ajouter des fichiers et plus encore"],
  addFilesOpenerCandidates: ["Ajouter des fichiers et plus encore"],
  addPhotosFilesMenuItem: ["Ajouter des photos et fichiers"],
  copyResponse: ["Copier la réponse"],
  modeLabels: ["Moyen", "Avancé", "Très élevé", "Instantanée", "Moyenne", "Élevée", "Très élevée"],
  modeOptions: {
    instant: ["Instantanée"],
    medium: ["Moyen", "Moyenne"],
    high: ["Avancé", "Élevée"],
    extraHigh: ["Très élevé", "Très élevée"],
  },
  modeOpenerExtra: ["Configurer"],
  tools: {
    web_search: ["Recherche sur le Web"],
    deep_research: ["Recherche approfondie"],
    create_image: ["Créer une image"],
  },
  signedInMarkers: ["Nouveau chat", "Rechercher dans les chats", "Récents", "Bibliothèque", "Projets", "Discuter avec ChatGPT"],
  responseActions: ["Copier la réponse"],
  stopControl: ["Interrompre la réponse"],
} satisfies LocaleContribution;
