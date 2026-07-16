import type { LocaleContribution } from "./types.js";

/**
 * Spanish — Spain (es-ES). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=es-ES, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const esES = {
  composerTextbox: ["Chatear con ChatGPT"],
  sendButton: ["Enviar indicación"],
  searchChatsButton: ["Buscar chats"],
  searchChatsPlaceholder: ["Buscar chats…"],
  newChat: ["Nuevo chat"],
  addFilesButton: ["Añadir archivos y más"],
  addFilesOpenerCandidates: ["Añadir archivos y más"],
  addPhotosFilesMenuItem: ["Añadir fotos y archivos"],
  copyResponse: ["Copiar respuesta"],
  modeLabels: ["Instantánea", "Media", "Alta", "Muy alta"],
  modeOptions: {
    instant: ["Instantánea"],
    medium: ["Media"],
    high: ["Alta"],
    extraHigh: ["Muy alta"],
  },
  modeOpenerExtra: ["Configurar"],
  tools: {
    web_search: ["Búsqueda en Internet"],
    deep_research: ["Investigación avanzada"],
    create_image: ["Crea una imagen"],
  },
  signedInMarkers: ["Nuevo chat", "Buscar chats", "Recientes", "Biblioteca", "Proyectos", "Chatear con ChatGPT"],
  responseActions: ["Copiar respuesta"],
  stopControl: ["Detener respuesta"],
} satisfies LocaleContribution;
