import type { LocaleContribution } from "./types.js";

/**
 * Chinese — Traditional, Hong Kong (zh-HK). Captured 2026-06-09 against a live chatgpt.com
 * session (html lang=zh-HK, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["即時", "均衡", "高", "極高", "專業", "中等"],
  modeOptions: {
    instant: ["即時"],
    medium: ["均衡", "中等"],
    high: ["高"],
    extraHigh: ["極高"],
    pro: ["專業"],
  },
  modeOpenerExtra: ["設定"],
  tools: {
    web_search: ["網絡搜尋"],
    deep_research: ["深度研究"],
    create_image: ["創作圖像"],
  },
  signedInMarkers: ["新對話", "搜尋對話", "最近對話", "圖庫", "項目", "與 ChatGPT 對話"],
  responseActions: ["複製回覆"],
  stopControl: ["停止回應"],
} satisfies LocaleContribution;
