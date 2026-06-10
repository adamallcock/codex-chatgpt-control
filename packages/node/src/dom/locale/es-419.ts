import type { LocaleContribution } from "./types.js";

/**
 * Spanish Latin America (es-419). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=es-419, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Ampliado" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const es419 = {
  composerTextbox: ["Chatear con ChatGPT"],
  sendButton: ["Enviar mensaje"],
  searchChatsButton: ["Buscar chats"],
  searchChatsPlaceholder: ["Buscar chats…"],
  newChat: ["Nuevo chat"],
  addFilesButton: ["Agregar archivos y más"],
  addFilesOpenerCandidates: ["Agregar archivos y más"],
  addPhotosFilesMenuItem: ["Agregar fotos y archivos"],
  copyResponse: ["Copiar respuesta"],
  modeOpenerExtra: ["Configurar..."],
  tools: {
    web_search: ["Busca en la web"],
    deep_research: ["Investigar a fondo"],
    create_image: ["Crea una imagen"],
  },
  signedInMarkers: ["Nuevo chat", "Buscar chats", "Recientes", "Historial del chat", "Proyectos", "Chatear con ChatGPT"],
  responseActions: ["Copiar respuesta"],
} satisfies LocaleContribution;
