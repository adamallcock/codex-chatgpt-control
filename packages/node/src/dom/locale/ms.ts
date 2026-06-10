import type { LocaleContribution } from "./types.js";

/**
 * Malay (ms-MY). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ms-MY, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
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
  modeOpenerExtra: ["Konfigurasikan…"],
  tools: {
    web_search: ["Carian web"],
    deep_research: ["Kajian mendalam"],
    create_image: ["Cipta imej"],
  },
  signedInMarkers: ["Sembang baharu", "Cari sembang", "Terbaharu", "Sejarah sembang", "Projek", "Tanya apa-apa sahaja..."],
  responseActions: ["Salin tindak balas"],
} satisfies LocaleContribution;
