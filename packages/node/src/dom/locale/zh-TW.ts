import type { LocaleContribution } from "./types.js";

/**
 * Chinese — Traditional, Taiwan (zh-TW). Captured 2026-06-09 against a live chatgpt.com
 * session (html lang=zh-TW, Google Translate confirmed off). Distinct from zh-HK
 * (e.g. 傳送提示詞 vs 傳送提示, 網頁搜尋 vs 網絡搜尋, 複製回應 vs 複製回覆).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const zhTW = {
  configurationAxes: {
    power: ["能力"],
    model: ["模型", "選取模型"],
    effort: ["推理強度", "能力"],
    speed: ["速度"],
    advanced: ["進階"],
  },
  configurationOptions: {
    instant: ["即時"],
    light: ["快思"],
    medium: ["中"],
    high: ["高"],
    extraHigh: ["極高", "超高"],
    max: ["最高"],
    ultra: ["極致"],
    standard: ["標準"],
    fast: ["快速"],
  },
  composerTextbox: ["與 ChatGPT 對話"],
  sendButton: ["傳送提示詞"],
  searchChatsButton: ["搜尋對話"],
  searchChatsPlaceholder: ["搜尋聊天..."],
  newChat: ["新對話"],
  addFilesButton: ["新增檔案等更多功能"],
  addFilesOpenerCandidates: ["新增檔案等更多功能"],
  addPhotosFilesMenuItem: ["新增照片和檔案"],
  copyResponse: ["複製回應"],
  modeLabels: ["即時", "中等", "高", "超高", "專業", "中", "極高"],
  modeOptions: {
    instant: ["即時"],
    medium: ["中等", "中"],
    high: ["高"],
    extraHigh: ["超高", "極高"],
    pro: ["專業"],
  },
  modeOpenerExtra: ["設定"],
  experienceOptions: {
    chat: ["對話"],
    work: ["工作"],
  },
  tools: {
    web_search: ["網頁搜尋"],
    deep_research: ["深入研究"],
    create_image: ["創作圖像"],
  },
  signedInMarkers: ["新對話", "搜尋對話", "最近的對話", "圖庫", "專案", "與 ChatGPT 對話"],
  responseActions: ["複製回應"],
  stopControl: ["停止回應"],
} satisfies LocaleContribution;
