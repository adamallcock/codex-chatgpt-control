import type { LocaleContribution } from "./types.js";

/**
 * Malayalam (ml). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ml, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const ml = {
  composerTextbox: ["എന്തും ചോദിക്കുക"],
  sendButton: ["പ്രോംപ്റ്റ് അയയ്ക്കുക"],
  searchChatsButton: ["ചാറ്റുകൾ തിരയുക"],
  searchChatsPlaceholder: ["ചാറ്റുകൾ തിരയുക…"],
  newChat: ["പുതിയ ചാറ്റ്"],
  addFilesButton: ["ഫയലുകളും മറ്റും ചേർക്കുക"],
  addFilesOpenerCandidates: ["ഫയലുകളും മറ്റും ചേർക്കുക"],
  addPhotosFilesMenuItem: ["ഫോട്ടോകളും ഫയലുകളും അപ്‌ലോഡ് ചെയ്യുക"],
  copyResponse: ["മറുപടി കോപ്പി ചെയ്യുക"],
  modeLabels: ["തൽക്ഷണം", "ഇടത്തരം", "ഉയർന്നത്", "വളരെ ഉയർന്ന", "പ്രോ"],
  modeOptions: {
    instant: ["തൽക്ഷണം"],
    medium: ["ഇടത്തരം"],
    high: ["ഉയർന്നത്"],
    extraHigh: ["വളരെ ഉയർന്ന"],
    pro: ["പ്രോ"],
  },
  modeOpenerExtra: ["കോൺഫിഗർ ചെയ്യുക…"],
  tools: {
    web_search: ["വെബ് തിരയൽ"],
    deep_research: ["ഡീപ്പ് റിസേർച്ച്"],
    create_image: ["ചിത്രം സൃഷ്ടിക്കുക"],
  },
  signedInMarkers: ["പുതിയ ചാറ്റ്", "ചാറ്റുകൾ തിരയുക", "സമീപകാലത്തുള്ള", "ചാറ്റ് ചരിത്രം", "പ്രോജക്റ്റുകൾ", "എന്തും ചോദിക്കുക"],
  responseActions: ["മറുപടി കോപ്പി ചെയ്യുക"],
  stopControl: ["മറുപടി നിർത്തുക"],
} satisfies LocaleContribution;
