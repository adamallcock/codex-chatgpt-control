import type { LocaleContribution } from "./types.js";

/**
 * Japanese (ja-JP). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ja-JP, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ja = {
  configurationAxes: {
    power: ["パワー"],
    model: ["モデル", "モデルを選択"],
    effort: ["思考レベル", "推論レベル", "パワー"],
    speed: ["速度"],
    advanced: ["詳細設定"],
  },
  configurationOptions: {
    instant: ["最速"],
    light: ["軽"],
    medium: ["中程度"],
    high: ["高い", "高"],
    extraHigh: ["非常に高い", "極高"],
    max: ["最大"],
    ultra: ["ウルトラ"],
    standard: ["標準"],
    fast: ["高速"],
  },
  composerTextbox: ["ChatGPT とチャットする"],
  sendButton: ["プロンプトを送信する"],
  searchChatsButton: ["チャットを検索"],
  searchChatsPlaceholder: ["チャットを検索..."],
  newChat: ["新しいチャット"],
  addFilesButton: ["ファイルの追加など"],
  addFilesOpenerCandidates: ["ファイルの追加など"],
  addPhotosFilesMenuItem: ["写真とファイルを追加"],
  copyResponse: ["回答をコピーする"],
  modeLabels: ["最速", "標準", "高", "最高", "中程度", "高い", "非常に高い", "極高"],
  modeOptions: {
    instant: ["最速"],
    medium: ["標準", "中程度"],
    high: ["高", "高い"],
    extraHigh: ["最高", "非常に高い", "極高"],
  },
  modeOpenerExtra: ["設定する"],
  tools: {
    web_search: ["ウェブ検索"],
    create_image: ["画像を作成する"],
  },
  signedInMarkers: ["新しいチャット", "チャットを検索", "最近のチャット", "ライブラリ", "プロジェクト", "ChatGPT とチャットする"],
  responseActions: ["回答をコピーする"],
  stopControl: ["回答を停止"],
} satisfies LocaleContribution;
