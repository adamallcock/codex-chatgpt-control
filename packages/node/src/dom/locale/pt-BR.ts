import type { LocaleContribution } from "./types.js";

/**
 * Portuguese (Brazil) (pt-BR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=pt-BR, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ptBR = {
  configurationAxes: {
    power: ["Potência"],
    model: ["Modelo", "Selecionar modelo"],
    effort: ["Esforço", "Nível de raciocínio", "Potência"],
    speed: ["Velocidade"],
    advanced: ["Avançado"],
  },
  configurationOptions: {
    instant: ["Instantâneo", "Instantânea"],
    light: ["Leve"],
    medium: ["Médio", "Média"],
    high: ["Alto", "Alta"],
    extraHigh: ["Extra alto"],
    max: ["Máximo"],
    standard: ["Padrão"],
    fast: ["Rápido"],
  },
  composerTextbox: ["Pergunte alguma coisa"],
  sendButton: ["Enviar prompt"],
  searchChatsButton: ["Buscar chats"],
  searchChatsPlaceholder: ["Buscar em chats…"],
  newChat: ["Novo chat"],
  addFilesButton: ["Adicionar arquivos e mais"],
  addFilesOpenerCandidates: ["Adicionar arquivos e mais"],
  addPhotosFilesMenuItem: ["Carregar fotos e arquivos"],
  copyResponse: ["Copiar resposta"],
  modeLabels: ["Instantâneo", "Médio", "Alto", "Muito alta", "Extra alto", "Instantânea", "Média", "Alta"],
  modeOptions: {
    instant: ["Instantâneo", "Instantânea"],
    medium: ["Médio", "Média"],
    high: ["Alto", "Alta"],
    extraHigh: ["Muito alta", "Extra alto"],
  },
  modeOpenerExtra: ["Configurar…"],
  tools: {
    web_search: ["Busca na web"],
    deep_research: ["Pesquisa aprofundada"],
    create_image: ["Criar imagem"],
  },
  signedInMarkers: ["Novo chat", "Buscar chats", "Recentes", "Histórico de chats", "Projetos", "Pergunte alguma coisa"],
  responseActions: ["Copiar resposta"],
  stopControl: ["Parar de responder"],
} satisfies LocaleContribution;
