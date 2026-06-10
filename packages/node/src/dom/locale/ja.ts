import type { LocaleContribution } from "./types.js";

/**
 * Japanese (ja-JP). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ja-JP, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• 拡張" suffix is a descriptor) and `tools.deep_research` ("Deep research").
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const ja = {
  composerTextbox: ["ChatGPT とチャットする"],
  sendButton: ["プロンプトを送信する"],
  searchChatsButton: ["チャットを検索"],
  searchChatsPlaceholder: ["チャットを検索..."],
  newChat: ["新しいチャット"],
  addFilesButton: ["ファイルの追加など"],
  addFilesOpenerCandidates: ["ファイルの追加など"],
  addPhotosFilesMenuItem: ["写真とファイルを追加"],
  copyResponse: ["回答をコピーする"],
  modeOpenerExtra: ["設定する"],
  tools: {
    web_search: ["ウェブ検索"],
    create_image: ["画像を作成する"],
  },
  signedInMarkers: ["新しいチャット", "チャットを検索", "最近のチャット", "ライブラリ", "プロジェクト", "ChatGPT とチャットする"],
  responseActions: ["回答をコピーする"],
} satisfies LocaleContribution;
