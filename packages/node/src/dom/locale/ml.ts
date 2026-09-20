import type { LocaleContribution } from "./types.js";

/**
 * Malayalam (ml). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ml, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ml = {
  configurationAxes: {
    power: ["പവർ"],
    model: ["മോഡൽ", "മോഡൽ തിരഞ്ഞെടുക്കുക"],
    effort: ["ശ്രമം", "പവർ"],
    speed: ["വേഗത"],
    advanced: ["വിപുലമായത്"],
  },
  configurationOptions: {
    instant: ["തൽക്ഷണം", "ഇൻസ്റ്റൻ്റ്"],
    light: ["ലളിതം"],
    medium: ["ഇടത്തരം"],
    high: ["ഉയർന്നത്"],
    extraHigh: ["അത്യധികം ഉയർന്നത്"],
    max: ["പരമാവധി"],
    ultra: ["അൾട്രാ"],
    standard: ["അടിസ്ഥാനം"],
    fast: ["വേഗം"],
  },
  composerTextbox: ["എന്തും ചോദിക്കുക"],
  sendButton: ["പ്രോംപ്റ്റ് അയയ്ക്കുക"],
  searchChatsButton: ["ചാറ്റുകൾ തിരയുക"],
  searchChatsPlaceholder: ["ചാറ്റുകൾ തിരയുക…"],
  newChat: ["പുതിയ ചാറ്റ്"],
  addFilesButton: ["ഫയലുകളും മറ്റും ചേർക്കുക"],
  addFilesOpenerCandidates: ["ഫയലുകളും മറ്റും ചേർക്കുക"],
  addPhotosFilesMenuItem: ["ഫോട്ടോകളും ഫയലുകളും അപ്‌ലോഡ് ചെയ്യുക"],
  copyResponse: ["മറുപടി കോപ്പി ചെയ്യുക"],
  modeLabels: ["തൽക്ഷണം", "ഇടത്തരം", "ഉയർന്നത്", "വളരെ ഉയർന്ന", "പ്രോ", "അത്യധികം ഉയർന്നത്", "ഇൻസ്റ്റൻ്റ്"],
  modeOptions: {
    instant: ["തൽക്ഷണം", "ഇൻസ്റ്റൻ്റ്"],
    medium: ["ഇടത്തരം"],
    high: ["ഉയർന്നത്"],
    extraHigh: ["വളരെ ഉയർന്ന", "അത്യധികം ഉയർന്നത്"],
    pro: ["പ്രോ"],
  },
  modeOpenerExtra: ["കോൺഫിഗർ ചെയ്യുക…"],
  experienceOptions: {
    chat: ["ചാറ്റ്"],
    work: ["ജോലി"],
  },
  tools: {
    web_search: ["വെബ് തിരയൽ"],
    deep_research: ["ഡീപ്പ് റിസേർച്ച്"],
    create_image: ["ചിത്രം സൃഷ്ടിക്കുക"],
  },
  signedInMarkers: ["പുതിയ ചാറ്റ്", "ചാറ്റുകൾ തിരയുക", "സമീപകാലത്തുള്ള", "ചാറ്റ് ചരിത്രം", "പ്രോജക്റ്റുകൾ", "എന്തും ചോദിക്കുക"],
  responseActions: ["മറുപടി കോപ്പി ചെയ്യുക"],
  stopControl: ["മറുപടി നിർത്തുക"],
} satisfies LocaleContribution;
