import type { LocaleContribution } from "./types.js";

/**
 * Portuguese (Portugal) (pt-PT). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pt-PT, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const ptPT = {
  configurationAxes: {
    model: ["Modelo"],
    effort: ["Esforço"],
    speed: ["Velocidade"],
  },
  configurationOptions: {
    light: ["Leve"],
    medium: ["Médio"],
    high: ["Elevado"],
    extraHigh: ["Muito elevado"],
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
  modeLabels: ["Instantâneo", "Média", "Alta", "Máximo", "Médio", "Elevado", "Muito elevado"],
  modeOptions: {
    instant: ["Instantâneo"],
    medium: ["Média", "Médio"],
    high: ["Alta", "Elevado"],
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
