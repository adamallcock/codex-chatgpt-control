import type { LocaleContribution } from "./types.js";

/**
 * Amharic (am). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=am, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["ፈጣን", "መካከለኛ", "ከፍተኛ", "እጅግ ከፍተኛ"],
  modeOptions: {
    instant: ["ፈጣን"],
    medium: ["መካከለኛ"],
    high: ["ከፍተኛ"],
    extraHigh: ["እጅግ ከፍተኛ"],
  },
  modeOpenerExtra: ["ያዋቅሩ"],
  tools: {
    web_search: ["የድር ፍለጋ"],
    deep_research: ["ጥልቅ ምርምር"],
    create_image: ["ምስል ፍጠር"],
  },
  signedInMarkers: ["አዲስ ውይይት", "ውይይቶችን ፈልግ", "የቅርብ ጊዜዎች", "ላይብረሪ", "ፕሮጀክቶች", "ከChatGPT ጋር ይወያዩ"],
  responseActions: ["ምላሹን ይቅዱ"],
  stopControl: ["መልስ መስጠት አቁም"],
} satisfies LocaleContribution;
