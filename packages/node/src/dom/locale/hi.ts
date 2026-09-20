import type { LocaleContribution } from "./types.js";

/**
 * Hindi (hi-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=hi-IN, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const hi = {
  configurationAxes: {
    power: ["पावर"],
    model: ["मॉडल", "मॉडल चुनें"],
    effort: ["प्रयास", "सोचने का स्तर", "पावर"],
    speed: ["गति"],
    advanced: ["एडवांस्ड"],
  },
  configurationOptions: {
    instant: ["तुरंत", "इंस्टेंट"],
    light: ["लाइट"],
    medium: ["मध्यम"],
    high: ["उच्च", "हाई"],
    extraHigh: ["एक्स्ट्रा हाई"],
    max: ["अधिकतम"],
    ultra: ["अल्ट्रा"],
    standard: ["स्टैंडर्ड"],
    fast: ["तेज़"],
  },
  composerTextbox: ["ChatGPT के साथ चैट करें"],
  sendButton: ["प्रॉम्प् भेजें"],
  searchChatsButton: ["चैट खोजें"],
  searchChatsPlaceholder: ["चैट्स खोजें..."],
  newChat: ["नई चैट"],
  addFilesButton: ["फ़ाइलों को जोड़ें और भी बहुत कुछ करें"],
  addFilesOpenerCandidates: ["फ़ाइलों को जोड़ें और भी बहुत कुछ करें"],
  addPhotosFilesMenuItem: ["फ़ोटो और फ़ाइलें जोड़ें"],
  copyResponse: ["जवाब को कॉपी करें"],
  modeLabels: ["तुरंत", "मध्यम", "उच्च", "बहुत उच्च", "एक्स्ट्रा हाई", "इंस्टेंट", "हाई"],
  modeOptions: {
    instant: ["तुरंत", "इंस्टेंट"],
    medium: ["मध्यम"],
    high: ["उच्च", "हाई"],
    extraHigh: ["बहुत उच्च", "एक्स्ट्रा हाई"],
  },
  modeOpenerExtra: ["कॉन्फ़िगर करें..."],
  experienceOptions: {
    chat: ["चैट"],
    work: ["वर्क"],
  },
  tools: {
    web_search: ["वेब सर्च"],
    deep_research: ["डीप रिसर्च"],
    create_image: ["इमेज बनाएँ"],
  },
  signedInMarkers: ["नई चैट", "चैट खोजें", "हालिया", "चैट हिस्टरी", "प्रोजेक्ट्स", "ChatGPT के साथ चैट करें"],
  responseActions: ["जवाब को कॉपी करें"],
  stopControl: ["उत्तर रोकें"],
} satisfies LocaleContribution;
