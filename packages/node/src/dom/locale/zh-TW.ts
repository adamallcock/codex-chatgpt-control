import type { LocaleContribution } from "./types.js";

/**
 * Chinese — Traditional, Taiwan (zh-TW). Captured 2026-06-09 against a live chatgpt.com
 * session (html lang=zh-TW, Google Translate confirmed off). Distinct from zh-HK
 * (e.g. 傳送提示詞 vs 傳送提示, 網頁搜尋 vs 網絡搜尋, 複製回應 vs 複製回覆).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const zhTW = {
  composerTextbox: ["與 ChatGPT 對話"],
  sendButton: ["傳送提示詞"],
  searchChatsButton: ["搜尋對話"],
  searchChatsPlaceholder: ["搜尋聊天..."],
  newChat: ["新對話"],
  addFilesButton: ["新增檔案等更多功能"],
  addFilesOpenerCandidates: ["新增檔案等更多功能"],
  addPhotosFilesMenuItem: ["新增照片和檔案"],
  copyResponse: ["複製回應"],
  modeLabels: ["即時", "中等", "高", "超高", "專業"],
  modeOptions: {
    instant: ["即時"],
    medium: ["中等"],
    high: ["高"],
    extraHigh: ["超高"],
    pro: ["專業"],
  },
  modeOpenerExtra: ["設定"],
  tools: {
    web_search: ["網頁搜尋"],
    deep_research: ["深入研究"],
    create_image: ["創作圖像"],
  },
  signedInMarkers: ["新對話", "搜尋對話", "最近的對話", "圖庫", "專案", "與 ChatGPT 對話"],
  responseActions: ["複製回應"],
  stopControl: ["停止回應"],
} satisfies LocaleContribution;
