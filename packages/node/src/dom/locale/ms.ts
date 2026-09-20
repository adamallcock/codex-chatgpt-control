import type { LocaleContribution } from "./types.js";

/**
 * Malay (ms-MY). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ms-MY, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ms = {
  configurationAxes: {
    power: ["Kuasa"],
    model: ["Pilih model"],
    effort: ["Usaha", "Kuasa"],
    speed: ["Kelajuan"],
    advanced: ["Lanjutan"],
  },
  configurationOptions: {
    instant: ["Segera"],
    light: ["Ringan"],
    medium: ["Sederhana"],
    high: ["Tinggi"],
    extraHigh: ["Sangat Tinggi"],
    max: ["Sangat Tinggi"],
    fast: ["Pantas"],
  },
  composerTextbox: ["Tanya apa-apa sahaja..."],
  sendButton: ["Hantar gesaan"],
  searchChatsButton: ["Cari sembang"],
  searchChatsPlaceholder: ["Cari sembang..."],
  newChat: ["Sembang baharu"],
  addFilesButton: ["Tambah fail dan banyak lagi"],
  addFilesOpenerCandidates: ["Tambah fail dan banyak lagi"],
  addPhotosFilesMenuItem: ["Muat naik foto & fail"],
  copyResponse: ["Salin tindak balas"],
  modeLabels: ["Segera", "Sederhana", "Tinggi", "Sangat Tinggi"],
  modeOptions: {
    instant: ["Segera"],
    medium: ["Sederhana"],
    high: ["Tinggi"],
    extraHigh: ["Sangat Tinggi"],
  },
  modeOpenerExtra: ["Konfigurasikan…"],
  experienceOptions: {
    chat: ["Sembang"],
    work: ["Kerja"],
  },
  tools: {
    web_search: ["Carian web"],
    deep_research: ["Kajian mendalam"],
    create_image: ["Cipta imej"],
  },
  signedInMarkers: ["Sembang baharu", "Cari sembang", "Terbaharu", "Sejarah sembang", "Projek", "Tanya apa-apa sahaja..."],
  responseActions: ["Salin tindak balas"],
  stopControl: ["Hentikan jawapan"],
} satisfies LocaleContribution;
