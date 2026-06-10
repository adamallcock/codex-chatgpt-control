import type { LocaleContribution } from "./types.js";

/**
 * Bengali (bn-BD). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=bn-BD, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
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
  modeOpenerExtra: ["কনফিগার করুন..."],
  tools: {
    web_search: ["ওয়েব সন্ধান"],
    deep_research: ["গভীর অনুসন্ধান"],
    create_image: ["ছবি তৈরি করুন"],
  },
  signedInMarkers: ["নতুন চ্যাট", "চ্যাট খুঁজুন", "সাম্প্রতিক", "চ্যাটের ইতিহাস", "প্রোজেক্ট", "যে কোন কিছু জিজ্ঞেস করুন…"],
  responseActions: ["উত্তর কপি করুন"],
} satisfies LocaleContribution;
