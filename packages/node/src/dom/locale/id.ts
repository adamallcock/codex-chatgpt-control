import type { LocaleContribution } from "./types.js";

/**
 * Indonesian (id-ID). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=id-ID, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Matang" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const id = {
  composerTextbox: ["Obrolan dengan ChatGPT"],
  sendButton: ["Kirim perintah"],
  searchChatsButton: ["Cari obrolan"],
  searchChatsPlaceholder: ["Cari obrolan..."],
  newChat: ["Obrolan baru"],
  addFilesButton: ["Tambahkan file dan lainnya"],
  addFilesOpenerCandidates: ["Tambahkan file dan lainnya"],
  addPhotosFilesMenuItem: ["Tambah foto & file"],
  copyResponse: ["Salin respons"],
  modeOpenerExtra: ["Konfigurasi..."],
  tools: {
    web_search: ["Pencarian web"],
    deep_research: ["Riset dalam"],
    create_image: ["Buat gambar"],
  },
  signedInMarkers: ["Obrolan baru", "Cari obrolan", "Terkini", "Riwayat obrolan", "Proyek", "Obrolan dengan ChatGPT"],
  responseActions: ["Salin respons"],
} satisfies LocaleContribution;
