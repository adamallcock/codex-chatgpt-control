import type { LocaleContribution } from "./types.js";

/**
 * Amharic (am). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=am, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• የተራዘመ" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const am = {
  composerTextbox: ["ከChatGPT ጋር ይወያዩ"],
  sendButton: ["ጥያቄ ላክ"],
  searchChatsButton: ["ውይይቶችን ፈልግ"],
  searchChatsPlaceholder: ["ውይይቶችን ፈልግ..."],
  newChat: ["አዲስ ውይይት"],
  addFilesButton: ["ፋይሎችን ያክሉ እና ሌሎችም"],
  addFilesOpenerCandidates: ["ፋይሎችን ያክሉ እና ሌሎችም"],
  addPhotosFilesMenuItem: ["ፎቶዎችን እና ፋይሎችን ያክሉ"],
  copyResponse: ["ምላሹን ይቅዱ"],
  modeOpenerExtra: ["ያዋቅሩ"],
  tools: {
    web_search: ["የድር ፍለጋ"],
    deep_research: ["ጥልቅ ምርምር"],
    create_image: ["ምስል ፍጠር"],
  },
  signedInMarkers: ["አዲስ ውይይት", "ውይይቶችን ፈልግ", "የቅርብ ጊዜዎች", "ላይብረሪ", "ፕሮጀክቶች", "ከChatGPT ጋር ይወያዩ"],
  responseActions: ["ምላሹን ይቅዱ"],
} satisfies LocaleContribution;
