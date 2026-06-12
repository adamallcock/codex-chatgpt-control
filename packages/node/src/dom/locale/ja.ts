import type { LocaleContribution } from "./types.js";

/**
 * Japanese (ja-JP). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ja-JP, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 from a visible ChatGPT Pro session.
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
  modeLabels: ["最速", "標準", "高", "最高"],
  modeOptions: {
    instant: ["最速"],
    medium: ["標準"],
    high: ["高"],
    extraHigh: ["最高"],
  },
  modeOpenerExtra: ["設定する"],
  tools: {
    web_search: ["ウェブ検索"],
    create_image: ["画像を作成する"],
  },
  signedInMarkers: ["新しいチャット", "チャットを検索", "最近のチャット", "ライブラリ", "プロジェクト", "ChatGPT とチャットする"],
  responseActions: ["回答をコピーする"],
} satisfies LocaleContribution;
