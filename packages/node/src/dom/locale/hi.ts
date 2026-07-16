import type { LocaleContribution } from "./types.js";

/**
 * Hindi (hi-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hi-IN, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const hi = {
  composerTextbox: ["ChatGPT के साथ चैट करें"],
  sendButton: ["प्रॉम्प् भेजें"],
  searchChatsButton: ["चैट खोजें"],
  searchChatsPlaceholder: ["चैट्स खोजें..."],
  newChat: ["नई चैट"],
  addFilesButton: ["फ़ाइलों को जोड़ें और भी बहुत कुछ करें"],
  addFilesOpenerCandidates: ["फ़ाइलों को जोड़ें और भी बहुत कुछ करें"],
  addPhotosFilesMenuItem: ["फ़ोटो और फ़ाइलें जोड़ें"],
  copyResponse: ["जवाब को कॉपी करें"],
  modeLabels: ["तुरंत", "मध्यम", "उच्च", "बहुत उच्च"],
  modeOptions: {
    instant: ["तुरंत"],
    medium: ["मध्यम"],
    high: ["उच्च"],
    extraHigh: ["बहुत उच्च"],
  },
  modeOpenerExtra: ["कॉन्फ़िगर करें..."],
  tools: {
    web_search: ["वेब सर्च"],
    deep_research: ["डीप रिसर्च"],
    create_image: ["इमेज बनाएँ"],
  },
  signedInMarkers: ["नई चैट", "चैट खोजें", "हालिया", "चैट हिस्टरी", "प्रोजेक्ट्स", "ChatGPT के साथ चैट करें"],
  responseActions: ["जवाब को कॉपी करें"],
  stopControl: ["उत्तर रोकें"],
} satisfies LocaleContribution;
