import type { LocaleContribution } from "./types.js";

/**
 * Gujarati (gu-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=gu-IN, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• વિસ્તૃત" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const gu = {
  composerTextbox: ["ChatGPT સાથે ચૅટ"],
  sendButton: ["પ્રોમ્પ્ટ મોકલો"],
  searchChatsButton: ["ચેટ શોધો"],
  searchChatsPlaceholder: ["શોધ ચેટ્સ"],
  newChat: ["નવી ચેટ"],
  addFilesButton: ["ફાઇલો અને વધુ ઉમેરો"],
  addFilesOpenerCandidates: ["ફાઇલો અને વધુ ઉમેરો"],
  addPhotosFilesMenuItem: ["ફોટા અને ફાઇલો ઉમેરો"],
  copyResponse: ["પ્રતિભાવ કૉપિ કરો"],
  modeOpenerExtra: ["કન્ફિગર કરો..."],
  tools: {
    web_search: ["વેબ શોધ"],
    deep_research: ["ડીપ રિસર્ચ"],
    create_image: ["છબી બનાવો"],
  },
  signedInMarkers: ["નવી ચેટ", "ચેટ શોધો", "તાજેતર", "ચેટ ઇતિહાસ", "પ્રોજેક્ટ", "ChatGPT સાથે ચૅટ"],
  responseActions: ["પ્રતિભાવ કૉપિ કરો"],
} satisfies LocaleContribution;
