import type { LocaleContribution } from "./types.js";

/**
 * Amharic (am). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=am, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const am = {
  configurationAxes: {
    power: ["አቅም"],
    model: ["ሞዴል", "ሞዴል ይምረጡ"],
    effort: ["ጥረት", "አቅም"],
    speed: ["ፍጥነት"],
    advanced: ["የላቀ"],
  },
  configurationOptions: {
    instant: ["ፈጣን", "ቅጽበታዊ"],
    light: ["ቀላል"],
    medium: ["መካከለኛ"],
    high: ["ከፍተኛ"],
    extraHigh: ["እጅግ ከፍተኛ"],
    max: ["ከፍተኛው"],
    ultra: ["አልትራ"],
    standard: ["መደበኛ"],
    fast: ["ፈጣን"],
  },
  composerTextbox: ["ከChatGPT ጋር ይወያዩ"],
  sendButton: ["ጥያቄ ላክ"],
  searchChatsButton: ["ውይይቶችን ፈልግ"],
  searchChatsPlaceholder: ["ውይይቶችን ፈልግ..."],
  newChat: ["አዲስ ውይይት"],
  addFilesButton: ["ፋይሎችን ያክሉ እና ሌሎችም"],
  addFilesOpenerCandidates: ["ፋይሎችን ያክሉ እና ሌሎችም"],
  addPhotosFilesMenuItem: ["ፎቶዎችን እና ፋይሎችን ያክሉ"],
  copyResponse: ["ምላሹን ይቅዱ"],
  modeLabels: ["ፈጣን", "መካከለኛ", "ከፍተኛ", "እጅግ ከፍተኛ", "ቅጽበታዊ"],
  modeOptions: {
    instant: ["ፈጣን", "ቅጽበታዊ"],
    medium: ["መካከለኛ"],
    high: ["ከፍተኛ"],
    extraHigh: ["እጅግ ከፍተኛ"],
  },
  modeOpenerExtra: ["ያዋቅሩ"],
  experienceOptions: {
    chat: ["ውይይት"],
    work: ["ሥራ"],
  },
  tools: {
    web_search: ["የድር ፍለጋ"],
    deep_research: ["ጥልቅ ምርምር"],
    create_image: ["ምስል ፍጠር"],
  },
  signedInMarkers: ["አዲስ ውይይት", "ውይይቶችን ፈልግ", "የቅርብ ጊዜዎች", "ላይብረሪ", "ፕሮጀክቶች", "ከChatGPT ጋር ይወያዩ"],
  responseActions: ["ምላሹን ይቅዱ"],
  stopControl: ["መልስ መስጠት አቁም"],
} satisfies LocaleContribution;
