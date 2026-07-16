import type { LocaleContribution } from "./types.js";

/**
 * Marathi (mr-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=mr-IN, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const mr = {
  composerTextbox: ["काहीही विचारा"],
  sendButton: ["प्रॉम्प्ट पाठवा"],
  searchChatsButton: ["चॅट्स शोधा"],
  searchChatsPlaceholder: ["चॅट्समध्ये शोधा…"],
  newChat: ["नवीन चॅट"],
  addFilesButton: ["फाइल्स जोडा आणि इतर अनेक गोष्टी करा"],
  addFilesOpenerCandidates: ["फाइल्स जोडा आणि इतर अनेक गोष्टी करा"],
  addPhotosFilesMenuItem: ["फोटो आणि फाइल्स अपलोड करा"],
  copyResponse: ["प्रतिसाद कॉपी करा"],
  modeLabels: ["झटपट", "मध्यम", "उच्च", "अतिउच्च", "प्रो"],
  modeOptions: {
    instant: ["झटपट"],
    medium: ["मध्यम"],
    high: ["उच्च"],
    extraHigh: ["अतिउच्च"],
    pro: ["प्रो"],
  },
  modeOpenerExtra: ["कॉन्फिगर करा..."],
  tools: {
    web_search: ["वेबवर शोध"],
    deep_research: ["सखोल संशोधन"],
    create_image: ["प्रतिमा तयार करा"],
  },
  signedInMarkers: ["नवीन चॅट", "चॅट्स शोधा", "अलीकडील", "चॅट इतिहास", "प्रोजेक्ट्स", "काहीही विचारा"],
  responseActions: ["प्रतिसाद कॉपी करा"],
  stopControl: ["उत्तर थांबवा"],
} satisfies LocaleContribution;
