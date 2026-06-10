import type { LocaleContribution } from "./types.js";

/**
 * Tamil (ta-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ta-IN, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const ta = {
  composerTextbox: ["எதையும் கேளுங்கள்"],
  sendButton: ["தூண்டியை அனுப்பு"],
  searchChatsButton: ["அரட்டைகளைத் தேடு"],
  searchChatsPlaceholder: ["அரட்டைகளைத் தேடு..."],
  newChat: ["புதிய அரட்டை"],
  addFilesButton: ["கோப்புகளையும் மேலும் பலவற்றையும் சேர்"],
  addFilesOpenerCandidates: ["கோப்புகளையும் மேலும் பலவற்றையும் சேர்"],
  addPhotosFilesMenuItem: ["படங்கள் மற்றும் ஃபைல்களைப் பதிவேற்று"],
  copyResponse: ["பதிலை நகலெடுக்கலாம்"],
  modeOpenerExtra: ["கட்டமைக்கவும்..."],
  tools: {
    web_search: ["இணைய தேடல்"],
    deep_research: ["ஆழ்ந்த ஆய்வு"],
    create_image: ["படத்தை உருவாக்கவும்"],
  },
  signedInMarkers: ["புதிய அரட்டை", "அரட்டைகளைத் தேடு", "சமீபத்தியது", "அரட்டை வரலாறு", "திட்டங்கள்", "எதையும் கேளுங்கள்"],
  responseActions: ["பதிலை நகலெடுக்கலாம்"],
} satisfies LocaleContribution;
