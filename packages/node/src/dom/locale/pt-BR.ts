import type { LocaleContribution } from "./types.js";

/**
 * Portuguese (Brazil) (pt-BR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pt-BR, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
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
  modeOpenerExtra: ["Configurar…"],
  tools: {
    web_search: ["Busca na web"],
    deep_research: ["Pesquisa aprofundada"],
    create_image: ["Criar imagem"],
  },
  signedInMarkers: ["Novo chat", "Buscar chats", "Recentes", "Histórico de chats", "Projetos", "Pergunte alguma coisa"],
  responseActions: ["Copiar resposta"],
} satisfies LocaleContribution;
