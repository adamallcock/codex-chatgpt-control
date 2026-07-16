import type { LocaleContribution } from "./types.js";

/**
 * Turkish (tr-TR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=tr-TR, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["Anında", "Orta", "Yüksek", "Çok Yüksek"],
  modeOptions: {
    instant: ["Anında"],
    medium: ["Orta"],
    high: ["Yüksek"],
    extraHigh: ["Çok Yüksek"],
  },
  modeOpenerExtra: ["Yapılandır..."],
  tools: {
    web_search: ["Web araması"],
    deep_research: ["Derin araştırma"],
    create_image: ["Görsel oluştur"],
  },
  signedInMarkers: ["Yeni sohbet", "Sohbetlerde ara", "Yakın zamandakiler", "Sohbet geçmişi", "Projeler", "Herhangi bir şey sor"],
  responseActions: ["Yanıtı kopyala"],
  stopControl: ["Yanıtlamayı durdur"],
} satisfies LocaleContribution;
