import type { LocaleContribution } from "./types.js";

/**
 * French Canada (fr-CA). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=fr-CA, Google Translate confirmed off).
 *
 * Uses distinctly Québécois vocabulary: "clavardage" for chat, "requête" for prompt.
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const frCA = {
  configurationAxes: {
    power: ["Puissance"],
    model: ["Modèle", "Sélectionner un modèle"],
    effort: ["Puissance"],
    speed: ["Vitesse"],
    advanced: ["Avancé"],
  },
  configurationOptions: {
    instant: ["Instantané"],
    light: ["Léger"],
    medium: ["Moyen"],
    high: ["Élevé"],
    extraHigh: ["Très élevé"],
    fast: ["Rapide"],
  },
  composerTextbox: ["Converser avec ChatGPT"],
  sendButton: ["Envoyer la requête"],
  searchChatsButton: ["Rechercher les clavardages"],
  searchChatsPlaceholder: ["Rechercher les clavardages…"],
  newChat: ["Nouvelle session de clavardage"],
  addFilesButton: ["Ajouter des fichiers et plus encore"],
  addFilesOpenerCandidates: ["Ajouter des fichiers et plus encore"],
  addPhotosFilesMenuItem: ["Ajouter des photos et des fichiers"],
  copyResponse: ["Copier la réponse"],
  modeLabels: ["Instantané", "Moyen", "Élevé", "Très élevé"],
  modeOptions: {
    instant: ["Instantané"],
    medium: ["Moyen"],
    high: ["Élevé"],
    extraHigh: ["Très élevé"],
  },
  modeOpenerExtra: ["Configurer..."],
  experienceOptions: {
    chat: ["Clavardage"],
  },
  tools: {
    web_search: ["Recherche sur Internet"],
    deep_research: ["Recherche approfondie"],
    create_image: ["Créer une image"],
  },
  signedInMarkers: ["Nouvelle session de clavardage", "Rechercher les clavardages", "Récentes", "Historique des clavardages", "Projets", "Converser avec ChatGPT"],
  responseActions: ["Copier la réponse"],
  stopControl: ["Arrêter de répondre"],
} satisfies LocaleContribution;
