import type { LocaleContribution } from "./types.js";

/**
 * Marathi (mr-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=mr-IN, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
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
  modeOpenerExtra: ["कॉन्फिगर करा..."],
  tools: {
    web_search: ["वेबवर शोध"],
    deep_research: ["सखोल संशोधन"],
    create_image: ["प्रतिमा तयार करा"],
  },
  signedInMarkers: ["नवीन चॅट", "चॅट्स शोधा", "अलीकडील", "चॅट इतिहास", "प्रोजेक्ट्स", "काहीही विचारा"],
  responseActions: ["प्रतिसाद कॉपी करा"],
} satisfies LocaleContribution;
