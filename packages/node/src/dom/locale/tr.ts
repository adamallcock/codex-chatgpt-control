import type { LocaleContribution } from "./types.js";

/**
 * Turkish (tr-TR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=tr-TR, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const tr = {
  composerTextbox: ["Herhangi bir şey sor"],
  sendButton: ["Prompt gönder"],
  searchChatsButton: ["Sohbetlerde ara"],
  searchChatsPlaceholder: ["Sohbetlerde ara..."],
  newChat: ["Yeni sohbet"],
  addFilesButton: ["Dosyaları ve çok daha fazlasını ekle"],
  addFilesOpenerCandidates: ["Dosyaları ve çok daha fazlasını ekle"],
  addPhotosFilesMenuItem: ["Fotoğraf ve dosya yükle"],
  copyResponse: ["Yanıtı kopyala"],
  modeOpenerExtra: ["Yapılandır..."],
  tools: {
    web_search: ["Web araması"],
    deep_research: ["Derin araştırma"],
    create_image: ["Görsel oluştur"],
  },
  signedInMarkers: ["Yeni sohbet", "Sohbetlerde ara", "Yakın zamandakiler", "Sohbet geçmişi", "Projeler", "Herhangi bir şey sor"],
  responseActions: ["Yanıtı kopyala"],
} satisfies LocaleContribution;
