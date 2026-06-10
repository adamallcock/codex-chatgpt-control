import type { LocaleContribution } from "./types.js";

/**
 * Chinese — Traditional, Hong Kong (zh-HK). Captured 2026-06-09 against a live chatgpt.com
 * session (html lang=zh-HK, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• 延伸" suffix is a descriptor, not a standalone mode). Not yet captured —
 * fall back to English + `selector_drift`: `download`, `downloadImage`, `imageContainerHint`,
 * `transientAssistant`, `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const zhHK = {
  composerTextbox: ["與 ChatGPT 對話"],
  sendButton: ["傳送提示"],
  searchChatsButton: ["搜尋對話"],
  searchChatsPlaceholder: ["搜尋對話…"],
  newChat: ["新對話"],
  addFilesButton: ["上載檔案和其他内容"],
  addFilesOpenerCandidates: ["上載檔案和其他内容"],
  addPhotosFilesMenuItem: ["加入相片和檔案"],
  copyResponse: ["複製回覆"],
  modeOpenerExtra: ["設定"],
  tools: {
    web_search: ["網絡搜尋"],
    deep_research: ["深度研究"],
    create_image: ["創作圖像"],
  },
  signedInMarkers: ["新對話", "搜尋對話", "最近對話", "圖庫", "項目", "與 ChatGPT 對話"],
  responseActions: ["複製回覆"],
} satisfies LocaleContribution;
