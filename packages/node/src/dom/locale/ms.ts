import type { LocaleContribution } from "./types.js";

/**
 * Malay (ms-MY). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ms-MY, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 from a visible ChatGPT Pro session.
 */
export const ms = {
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
  tools: {
    web_search: ["Carian web"],
    deep_research: ["Kajian mendalam"],
    create_image: ["Cipta imej"],
  },
  signedInMarkers: ["Sembang baharu", "Cari sembang", "Terbaharu", "Sejarah sembang", "Projek", "Tanya apa-apa sahaja..."],
  responseActions: ["Salin tindak balas"],
} satisfies LocaleContribution;
