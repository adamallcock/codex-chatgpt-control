import type { LocaleContribution } from "./types.js";

/**
 * Gujarati (gu-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=gu-IN, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const gu = {
  configurationAxes: {
    model: ["મોડેલ"],
    effort: ["પ્રયાસ"],
    speed: ["ઝડપ"],
  },
  configurationOptions: {
    light: ["લાઇટ"],
    medium: ["મીડિયમ"],
    high: ["હાઇ"],
    extraHigh: ["એક્સ્ટ્રા હાઇ"],
    standard: ["સ્ટાન્ડર્ડ"],
    fast: ["ઝડપી"],
  },
  composerTextbox: ["ChatGPT સાથે ચૅટ"],
  sendButton: ["પ્રોમ્પ્ટ મોકલો"],
  searchChatsButton: ["ચેટ શોધો"],
  searchChatsPlaceholder: ["શોધ ચેટ્સ"],
  newChat: ["નવી ચેટ"],
  addFilesButton: ["ફાઇલો અને વધુ ઉમેરો"],
  addFilesOpenerCandidates: ["ફાઇલો અને વધુ ઉમેરો"],
  addPhotosFilesMenuItem: ["ફોટા અને ફાઇલો ઉમેરો"],
  copyResponse: ["પ્રતિભાવ કૉપિ કરો"],
  modeLabels: ["તરત", "મધ્યમ", "ઉચ્ચ", "અતિ ઉચ્ચ", "મીડિયમ", "હાઇ", "એક્સ્ટ્રા હાઇ"],
  modeOptions: {
    instant: ["તરત"],
    medium: ["મધ્યમ", "મીડિયમ"],
    high: ["ઉચ્ચ", "હાઇ"],
    extraHigh: ["અતિ ઉચ્ચ", "એક્સ્ટ્રા હાઇ"],
  },
  modeOpenerExtra: ["કન્ફિગર કરો..."],
  tools: {
    web_search: ["વેબ શોધ"],
    deep_research: ["ડીપ રિસર્ચ"],
    create_image: ["છબી બનાવો"],
  },
  signedInMarkers: ["નવી ચેટ", "ચેટ શોધો", "તાજેતર", "ચેટ ઇતિહાસ", "પ્રોજેક્ટ", "ChatGPT સાથે ચૅટ"],
  responseActions: ["પ્રતિભાવ કૉપિ કરો"],
  stopControl: ["જવાબ આપવાનું બંધ કરો"],
} satisfies LocaleContribution;
