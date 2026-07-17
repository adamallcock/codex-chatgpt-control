import type { LocaleContribution } from "./types.js";

/**
 * Chinese Simplified (zh-Hans / zh-CN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=zh-CN, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const zhHans = {
  configurationAxes: {
    model: ["模型"],
    effort: ["推理强度"],
    speed: ["速度"],
  },
  configurationOptions: {
    light: ["轻度"],
    medium: ["中"],
    high: ["高"],
    extraHigh: ["极高"],
    standard: ["标准"],
    fast: ["快速"],
  },
  composerTextbox: ["有问题，尽管问"],
  sendButton: ["发送提示"],
  searchChatsButton: ["搜索聊天"],
  searchChatsPlaceholder: ["搜索聊天…"],
  newChat: ["新聊天"],
  addFilesButton: ["添加文件等"],
  addFilesOpenerCandidates: ["添加文件等"],
  addPhotosFilesMenuItem: ["添加照片和文件"],
  copyResponse: ["复制回复"],
  modeLabels: ["极速", "均衡", "高级", "超高", "专业", "中", "高", "极高"],
  modeOptions: {
    instant: ["极速"],
    medium: ["均衡", "中"],
    high: ["高级", "高"],
    extraHigh: ["超高", "极高"],
    pro: ["专业"],
  },
  modeOpenerExtra: ["配置…"],
  tools: {
    web_search: ["网页搜索"],
    deep_research: ["深度研究"],
    create_image: ["创建图片"],
  },
  signedInMarkers: ["新聊天", "搜索聊天", "最近", "历史聊天记录", "项目", "有问题，尽管问"],
  responseActions: ["复制回复"],
  stopControl: ["停止回答"],
} satisfies LocaleContribution;
