import type { LocaleContribution } from "./types.js";

/**
 * Turkish (tr-TR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=tr-TR, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const tr = {
  configurationAxes: {
    power: ["Güç"],
    model: ["Model seç"],
    effort: ["Düzey", "Çaba", "Güç"],
    speed: ["Hız"],
    advanced: ["Gelişmiş"],
  },
  configurationOptions: {
    instant: ["Hızlı"],
    light: ["Sınırlı"],
    medium: ["Orta"],
    high: ["Yüksek"],
    extraHigh: ["Çok Yüksek"],
    max: ["Maks"],
    standard: ["Standart"],
    fast: ["Hızlı"],
  },
  composerTextbox: ["Herhangi bir şey sor"],
  sendButton: ["Prompt gönder"],
  searchChatsButton: ["Sohbetlerde ara"],
  searchChatsPlaceholder: ["Sohbetlerde ara..."],
  newChat: ["Yeni sohbet"],
  addFilesButton: ["Dosyaları ve çok daha fazlasını ekle"],
  addFilesOpenerCandidates: ["Dosyaları ve çok daha fazlasını ekle"],
  addPhotosFilesMenuItem: ["Fotoğraf ve dosya yükle"],
  copyResponse: ["Yanıtı kopyala"],
  modeLabels: ["Anında", "Orta", "Yüksek", "Çok Yüksek", "Hızlı"],
  modeOptions: {
    instant: ["Anında", "Hızlı"],
    medium: ["Orta"],
    high: ["Yüksek"],
    extraHigh: ["Çok Yüksek"],
  },
  modeOpenerExtra: ["Yapılandır..."],
  experienceOptions: {
    chat: ["Sohbet"],
    work: ["Çalışma"],
  },
  tools: {
    web_search: ["Web araması"],
    deep_research: ["Derin araştırma"],
    create_image: ["Görsel oluştur"],
  },
  signedInMarkers: ["Yeni sohbet", "Sohbetlerde ara", "Yakın zamandakiler", "Sohbet geçmişi", "Projeler", "Herhangi bir şey sor"],
  responseActions: ["Yanıtı kopyala"],
  stopControl: ["Yanıtlamayı durdur"],
} satisfies LocaleContribution;
