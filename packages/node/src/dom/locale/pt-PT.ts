import type { LocaleContribution } from "./types.js";

/**
 * Portuguese (Portugal) (pt-PT). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pt-PT, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ptPT = {
  configurationAxes: {
    power: ["Capacidade"],
    model: ["Modelo", "Selecionar modelo"],
    effort: ["Esforço", "Capacidade"],
    speed: ["Velocidade"],
    advanced: ["Avançado"],
  },
  configurationOptions: {
    instant: ["Instantâneo"],
    light: ["Leve"],
    medium: ["Médio"],
    high: ["Elevado", "Elevada"],
    extraHigh: ["Muito elevado"],
    max: ["Máx."],
    standard: ["Padrão"],
    fast: ["Rápido"],
  },
  composerTextbox: ["Pergunte qualquer coisa"],
  sendButton: ["Enviar prompt"],
  searchChatsButton: ["Pesquisar chats"],
  searchChatsPlaceholder: ["Procurar chats…"],
  newChat: ["Novo chat"],
  addFilesButton: ["Adicionar ficheiros e mais"],
  addFilesOpenerCandidates: ["Adicionar ficheiros e mais"],
  addPhotosFilesMenuItem: ["Carregar fotos e ficheiros"],
  copyResponse: ["Copiar resposta"],
  modeLabels: ["Instantâneo", "Média", "Alta", "Máximo", "Médio", "Elevado", "Muito elevado", "Elevada"],
  modeOptions: {
    instant: ["Instantâneo"],
    medium: ["Média", "Médio"],
    high: ["Alta", "Elevado", "Elevada"],
    extraHigh: ["Máximo", "Muito elevado"],
  },
  modeOpenerExtra: ["Configurar..."],
  tools: {
    web_search: ["Procurar na web"],
    deep_research: ["Investigar a fundo"],
    create_image: ["Criar imagem"],
  },
  signedInMarkers: ["Novo chat", "Pesquisar chats", "Recentes", "Histórico de chat", "Projetos", "Pergunte qualquer coisa"],
  responseActions: ["Copiar resposta"],
  stopControl: ["Parar resposta"],
} satisfies LocaleContribution;
