import type { LocaleContribution } from "./types.js";

/**
 * Spanish Latin America (es-419). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=es-419, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const es419 = {
  configurationAxes: {
    power: ["Potencia"],
    model: ["Modelo", "Seleccionar modelo"],
    effort: ["Esfuerzo", "Potencia"],
    speed: ["Velocidad"],
    advanced: ["Avanzado"],
  },
  configurationOptions: {
    instant: ["Instantánea"],
    light: ["Mínimo"],
    medium: ["Media"],
    high: ["Alta"],
    extraHigh: ["Muy alta"],
    max: ["Máx."],
    standard: ["Estándar"],
    fast: ["Rápido"],
  },
  composerTextbox: ["Chatear con ChatGPT"],
  sendButton: ["Enviar mensaje"],
  searchChatsButton: ["Buscar chats"],
  searchChatsPlaceholder: ["Buscar chats…"],
  newChat: ["Nuevo chat"],
  addFilesButton: ["Agregar archivos y más"],
  addFilesOpenerCandidates: ["Agregar archivos y más"],
  addPhotosFilesMenuItem: ["Agregar fotos y archivos"],
  copyResponse: ["Copiar respuesta"],
  modeLabels: ["Instantánea", "Media", "Alta", "Muy alta"],
  modeOptions: {
    instant: ["Instantánea"],
    medium: ["Media"],
    high: ["Alta"],
    extraHigh: ["Muy alta"],
  },
  modeOpenerExtra: ["Configurar..."],
  tools: {
    web_search: ["Busca en la web"],
    deep_research: ["Investigar a fondo"],
    create_image: ["Crea una imagen"],
  },
  signedInMarkers: ["Nuevo chat", "Buscar chats", "Recientes", "Historial del chat", "Proyectos", "Chatear con ChatGPT"],
  responseActions: ["Copiar respuesta"],
  stopControl: ["Detener respuesta"],
} satisfies LocaleContribution;
