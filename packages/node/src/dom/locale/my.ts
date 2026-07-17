import type { LocaleContribution } from "./types.js";

/**
 * Burmese (my-MM). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=my-MM, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const my = {
  configurationAxes: {
    model: ["မော်ဒယ်"],
    effort: ["အားထုတ်မှု"],
    speed: ["အမြန်နှုန်း"],
  },
  configurationOptions: {
    light: ["ပေါ့ပါး"],
    medium: ["အလယ်အလတ်"],
    high: ["အမြင့်"],
    extraHigh: ["အလွန်မြင့်"],
    standard: ["ပုံမှန်"],
    fast: ["အမြန်"],
  },
  composerTextbox: ["တစ်ခုခု မေးပါ…"],
  sendButton: ["တုံ့ပြန်ညွှန်ကြားချက် ပို့မည်"],
  searchChatsButton: ["ချတ်များ ရှာရန်"],
  searchChatsPlaceholder: ["ချတ်များ ရှာဖွေရန်..."],
  newChat: ["ချတ်အသစ်"],
  addFilesButton: ["ဖိုင်များနှင့် အခြားအရာများကို ထည့်ရန်"],
  addFilesOpenerCandidates: ["ဖိုင်များနှင့် အခြားအရာများကို ထည့်ရန်"],
  addPhotosFilesMenuItem: ["ဓာတ်ပုံများနှင့် ဖိုင်များကို တင်ပါ"],
  copyResponse: ["တုံ့ပြန်မှု ကူးယူရန်"],
  modeLabels: ["ချက်ချင်း", "အလယ်အလတ်", "မြင့်", "အလွန်မြင့်", "အမြင့်"],
  modeOptions: {
    instant: ["ချက်ချင်း"],
    medium: ["အလယ်အလတ်"],
    high: ["မြင့်", "အမြင့်"],
    extraHigh: ["အလွန်မြင့်"],
  },
  modeOpenerExtra: ["ပြုပြင်မွမ်းမံရန်"],
  tools: {
    web_search: ["ဝဘ်ရှာဖွေရန်"],
    deep_research: ["နက်နဲသော သုတေသန"],
    create_image: ["ရုပ်ပုံဖန်တီးပါ"],
  },
  signedInMarkers: ["ချတ်အသစ်", "ချတ်များ ရှာရန်", "လတ်တလော", "ချတ် မှတ်တမ်း", "စီမံကိန်းများ", "တစ်ခုခု မေးပါ…"],
  responseActions: ["တုံ့ပြန်မှု ကူးယူရန်"],
  stopControl: ["ဖြေဆိုခြင်း ရပ်ရန်"],
} satisfies LocaleContribution;
