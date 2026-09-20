import type { LocaleContribution } from "./types.js";

/**
 * Marathi (mr-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=mr-IN, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const mr = {
  configurationAxes: {
    power: ["पॉवर"],
    model: ["मॉडेल", "मॉडेल निवडा"],
    effort: ["प्रयत्न", "पॉवर"],
    speed: ["वेग"],
    advanced: ["प्रगत"],
  },
  configurationOptions: {
    instant: ["झटपट", "इन्स्टंट"],
    light: ["हलका"],
    medium: ["मध्यम"],
    high: ["उच्च"],
    extraHigh: ["अत्युच्च"],
    max: ["कमाल"],
    ultra: ["अल्ट्रा"],
    standard: ["स्टँडर्ड"],
    fast: ["जलद"],
  },
  composerTextbox: ["काहीही विचारा"],
  sendButton: ["प्रॉम्प्ट पाठवा"],
  searchChatsButton: ["चॅट्स शोधा"],
  searchChatsPlaceholder: ["चॅट्समध्ये शोधा…"],
  newChat: ["नवीन चॅट"],
  addFilesButton: ["फाइल्स जोडा आणि इतर अनेक गोष्टी करा"],
  addFilesOpenerCandidates: ["फाइल्स जोडा आणि इतर अनेक गोष्टी करा"],
  addPhotosFilesMenuItem: ["फोटो आणि फाइल्स अपलोड करा"],
  copyResponse: ["प्रतिसाद कॉपी करा"],
  modeLabels: ["झटपट", "मध्यम", "उच्च", "अतिउच्च", "प्रो", "अत्युच्च", "इन्स्टंट"],
  modeOptions: {
    instant: ["झटपट", "इन्स्टंट"],
    medium: ["मध्यम"],
    high: ["उच्च"],
    extraHigh: ["अतिउच्च", "अत्युच्च"],
    pro: ["प्रो"],
  },
  modeOpenerExtra: ["कॉन्फिगर करा..."],
  experienceOptions: {
    chat: ["चॅट"],
    work: ["काम"],
  },
  tools: {
    web_search: ["वेबवर शोध"],
    deep_research: ["सखोल संशोधन"],
    create_image: ["प्रतिमा तयार करा"],
  },
  signedInMarkers: ["नवीन चॅट", "चॅट्स शोधा", "अलीकडील", "चॅट इतिहास", "प्रोजेक्ट्स", "काहीही विचारा"],
  responseActions: ["प्रतिसाद कॉपी करा"],
  stopControl: ["उत्तर थांबवा"],
} satisfies LocaleContribution;
