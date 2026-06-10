import type { LocaleContribution } from "./types.js";

/**
 * Hindi (hi-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hi-IN, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• एक्सटेंडेड" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
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
  modeOpenerExtra: ["कॉन्फ़िगर करें..."],
  tools: {
    web_search: ["वेब सर्च"],
    deep_research: ["डीप रिसर्च"],
    create_image: ["इमेज बनाएँ"],
  },
  signedInMarkers: ["नई चैट", "चैट खोजें", "हालिया", "चैट हिस्टरी", "प्रोजेक्ट्स", "ChatGPT के साथ चैट करें"],
  responseActions: ["जवाब को कॉपी करें"],
} satisfies LocaleContribution;
