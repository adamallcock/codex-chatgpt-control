import type { LocaleContribution } from "./types.js";

/**
 * Portuguese (Portugal) (pt-PT). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pt-PT, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const ptPT = {
  composerTextbox: ["Pergunte qualquer coisa"],
  sendButton: ["Enviar prompt"],
  searchChatsButton: ["Pesquisar chats"],
  searchChatsPlaceholder: ["Procurar chats…"],
  newChat: ["Novo chat"],
  addFilesButton: ["Adicionar ficheiros e mais"],
  addFilesOpenerCandidates: ["Adicionar ficheiros e mais"],
  addPhotosFilesMenuItem: ["Carregar fotos e ficheiros"],
  copyResponse: ["Copiar resposta"],
  modeOpenerExtra: ["Configurar..."],
  tools: {
    web_search: ["Procurar na web"],
    deep_research: ["Investigar a fundo"],
    create_image: ["Criar imagem"],
  },
  signedInMarkers: ["Novo chat", "Pesquisar chats", "Recentes", "Histórico de chat", "Projetos", "Pergunte qualquer coisa"],
  responseActions: ["Copiar resposta"],
} satisfies LocaleContribution;
