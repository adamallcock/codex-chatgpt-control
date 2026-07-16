import type { LocaleContribution } from "./types.js";

/**
 * Bengali (bn-BD). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=bn-BD, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const bn = {
  composerTextbox: ["যে কোন কিছু জিজ্ঞেস করুন…"],
  sendButton: ["প্রম্পট পাঠান"],
  searchChatsButton: ["চ্যাট খুঁজুন"],
  searchChatsPlaceholder: ["চ্যাট সন্ধান করুন..."],
  newChat: ["নতুন চ্যাট"],
  addFilesButton: ["ফাইল এবং আরও অনেক কিছু যোগ করুন"],
  addFilesOpenerCandidates: ["ফাইল এবং আরও অনেক কিছু যোগ করুন"],
  addPhotosFilesMenuItem: ["ফটো এবং ফাইল আপলোড করুন"],
  copyResponse: ["উত্তর কপি করুন"],
  modeLabels: ["তাৎক্ষণিক", "মাঝারি", "উচ্চ", "অতি উচ্চ", "প্রো"],
  modeOptions: {
    instant: ["তাৎক্ষণিক"],
    medium: ["মাঝারি"],
    high: ["উচ্চ"],
    extraHigh: ["অতি উচ্চ"],
    pro: ["প্রো"],
  },
  modeOpenerExtra: ["কনফিগার করুন..."],
  tools: {
    web_search: ["ওয়েব সন্ধান"],
    deep_research: ["গভীর অনুসন্ধান"],
    create_image: ["ছবি তৈরি করুন"],
  },
  signedInMarkers: ["নতুন চ্যাট", "চ্যাট খুঁজুন", "সাম্প্রতিক", "চ্যাটের ইতিহাস", "প্রোজেক্ট", "যে কোন কিছু জিজ্ঞেস করুন…"],
  responseActions: ["উত্তর কপি করুন"],
  stopControl: ["উত্তর থামান"],
} satisfies LocaleContribution;
