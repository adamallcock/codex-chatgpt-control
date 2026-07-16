import type { LocaleContribution } from "./types.js";

/**
 * Tamil (ta-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ta-IN, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["உடனடி", "நடுத்தர", "உயர்", "மிக உயர்வு", "ப்ரோ"],
  modeOptions: {
    instant: ["உடனடி"],
    medium: ["நடுத்தர"],
    high: ["உயர்"],
    extraHigh: ["மிக உயர்வு"],
    pro: ["ப்ரோ"],
  },
  modeOpenerExtra: ["கட்டமைக்கவும்..."],
  tools: {
    web_search: ["இணைய தேடல்"],
    deep_research: ["ஆழ்ந்த ஆய்வு"],
    create_image: ["படத்தை உருவாக்கவும்"],
  },
  signedInMarkers: ["புதிய அரட்டை", "அரட்டைகளைத் தேடு", "சமீபத்தியது", "அரட்டை வரலாறு", "திட்டங்கள்", "எதையும் கேளுங்கள்"],
  responseActions: ["பதிலை நகலெடுக்கலாம்"],
  stopControl: ["பதிலளிப்பதை நிறுத்து"],
} satisfies LocaleContribution;
