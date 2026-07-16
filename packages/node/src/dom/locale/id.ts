import type { LocaleContribution } from "./types.js";

/**
 * Indonesian (id-ID). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=id-ID, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["Instan", "Sedang", "Tinggi", "Sangat Tinggi"],
  modeOptions: {
    instant: ["Instan"],
    medium: ["Sedang"],
    high: ["Tinggi"],
    extraHigh: ["Sangat Tinggi"],
  },
  modeOpenerExtra: ["Konfigurasi..."],
  tools: {
    web_search: ["Pencarian web"],
    deep_research: ["Riset dalam"],
    create_image: ["Buat gambar"],
  },
  signedInMarkers: ["Obrolan baru", "Cari obrolan", "Terkini", "Riwayat obrolan", "Proyek", "Obrolan dengan ChatGPT"],
  responseActions: ["Salin respons"],
  stopControl: ["Hentikan jawaban"],
} satisfies LocaleContribution;
