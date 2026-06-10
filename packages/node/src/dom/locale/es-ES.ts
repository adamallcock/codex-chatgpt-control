import type { LocaleContribution } from "./types.js";

/**
 * Spanish — Spain (es-ES). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=es-ES, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Ampliado" suffix is a descriptor, not a standalone mode). Not yet captured
 * — fall back to English + `selector_drift`: `download`, `downloadImage`, `imageContainerHint`,
 * `transientAssistant`, `stopControl`, and the login/captcha/rate-limit blocker copy.
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
  modeOpenerExtra: ["Configurar"],
  tools: {
    web_search: ["Búsqueda en Internet"],
    deep_research: ["Investigación avanzada"],
    create_image: ["Crea una imagen"],
  },
  signedInMarkers: ["Nuevo chat", "Buscar chats", "Recientes", "Biblioteca", "Proyectos", "Chatear con ChatGPT"],
  responseActions: ["Copiar respuesta"],
} satisfies LocaleContribution;
