import type { LocaleContribution } from "./types.js";

/**
 * Portuguese (Brazil) (pt-BR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pt-BR, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 from a visible ChatGPT Pro session.
 */
export const ptBR = {
  composerTextbox: ["Pergunte alguma coisa"],
  sendButton: ["Enviar prompt"],
  searchChatsButton: ["Buscar chats"],
  searchChatsPlaceholder: ["Buscar em chats…"],
  newChat: ["Novo chat"],
  addFilesButton: ["Adicionar arquivos e mais"],
  addFilesOpenerCandidates: ["Adicionar arquivos e mais"],
  addPhotosFilesMenuItem: ["Carregar fotos e arquivos"],
  copyResponse: ["Copiar resposta"],
  modeLabels: ["Instantâneo", "Médio", "Alto", "Muito alta"],
  modeOptions: {
    instant: ["Instantâneo"],
    medium: ["Médio"],
    high: ["Alto"],
    extraHigh: ["Muito alta"],
  },
  modeOpenerExtra: ["Configurar…"],
  tools: {
    web_search: ["Busca na web"],
    deep_research: ["Pesquisa aprofundada"],
    create_image: ["Criar imagem"],
  },
  signedInMarkers: ["Novo chat", "Buscar chats", "Recentes", "Histórico de chats", "Projetos", "Pergunte alguma coisa"],
  responseActions: ["Copiar resposta"],
} satisfies LocaleContribution;
