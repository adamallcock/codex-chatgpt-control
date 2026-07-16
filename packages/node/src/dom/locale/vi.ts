import type { LocaleContribution } from "./types.js";

/**
 * Vietnamese (vi-VN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=vi-VN, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const vi = {
  composerTextbox: ["Trò chuyện với ChatGPT"],
  sendButton: ["Gửi lời nhắc"],
  searchChatsButton: ["Tìm kiếm đoạn chat"],
  searchChatsPlaceholder: ["Tìm kiếm đoạn chat..."],
  newChat: ["Đoạn chat mới"],
  addFilesButton: ["Thêm tệp và nhiều tính năng khác"],
  addFilesOpenerCandidates: ["Thêm tệp và nhiều tính năng khác"],
  addPhotosFilesMenuItem: ["Thêm ảnh và tệp"],
  copyResponse: ["Sao chép phản hồi"],
  modeLabels: ["Tức thì", "Trung bình", "Cao", "Rất cao"],
  modeOptions: {
    instant: ["Tức thì"],
    medium: ["Trung bình"],
    high: ["Cao"],
    extraHigh: ["Rất cao"],
  },
  modeOpenerExtra: ["Định cấu hình"],
  tools: {
    web_search: ["Tìm kiếm trên mạng"],
    deep_research: ["Nghiên cứu chuyên sâu"],
    create_image: ["Tạo hình ảnh"],
  },
  signedInMarkers: ["Đoạn chat mới", "Tìm kiếm đoạn chat", "Gần đây", "Thư viện", "Dự án", "Trò chuyện với ChatGPT"],
  responseActions: ["Sao chép phản hồi"],
  stopControl: ["Dừng trả lời"],
} satisfies LocaleContribution;
