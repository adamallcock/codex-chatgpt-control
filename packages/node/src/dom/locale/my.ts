import type { LocaleContribution } from "./types.js";

/**
 * Burmese (my-MM). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=my-MM, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const my = {
  composerTextbox: ["တစ်ခုခု မေးပါ…"],
  sendButton: ["တုံ့ပြန်ညွှန်ကြားချက် ပို့မည်"],
  searchChatsButton: ["ချတ်များ ရှာရန်"],
  searchChatsPlaceholder: ["ချတ်များ ရှာဖွေရန်..."],
  newChat: ["ချတ်အသစ်"],
  addFilesButton: ["ဖိုင်များနှင့် အခြားအရာများကို ထည့်ရန်"],
  addFilesOpenerCandidates: ["ဖိုင်များနှင့် အခြားအရာများကို ထည့်ရန်"],
  addPhotosFilesMenuItem: ["ဓာတ်ပုံများနှင့် ဖိုင်များကို တင်ပါ"],
  copyResponse: ["တုံ့ပြန်မှု ကူးယူရန်"],
  modeOpenerExtra: ["ပြုပြင်မွမ်းမံရန်"],
  tools: {
    web_search: ["ဝဘ်ရှာဖွေရန်"],
    deep_research: ["နက်နဲသော သုတေသန"],
    create_image: ["ရုပ်ပုံဖန်တီးပါ"],
  },
  signedInMarkers: ["ချတ်အသစ်", "ချတ်များ ရှာရန်", "လတ်တလော", "ချတ် မှတ်တမ်း", "စီမံကိန်းများ", "တစ်ခုခု မေးပါ…"],
  responseActions: ["တုံ့ပြန်မှု ကူးယူရန်"],
} satisfies LocaleContribution;
