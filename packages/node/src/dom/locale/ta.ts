import type { LocaleContribution } from "./types.js";

/**
 * Tamil (ta-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ta-IN, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ta = {
  configurationAxes: {
    power: ["திறன்"],
    model: ["மாதிரி", "மாடல்", "மாடலைத் தேர்வுசெய்"],
    effort: ["முயற்சி", "சிந்தனை அளவு", "திறன்"],
    speed: ["வேகம்"],
    advanced: ["மேம்பட்ட"],
  },
  configurationOptions: {
    instant: ["உடனடி"],
    light: ["குறைவு"],
    medium: ["மிதமான"],
    high: ["அதிகமான", "அதிகம்"],
    extraHigh: ["மிக அதிகமான", "மிக அதிகம்"],
    max: ["அதிகபட்சம்"],
    ultra: ["அல்ட்ரா"],
    standard: ["வழக்கமான"],
    fast: ["விரைவு"],
  },
  composerTextbox: ["எதையும் கேளுங்கள்"],
  sendButton: ["தூண்டியை அனுப்பு"],
  searchChatsButton: ["அரட்டைகளைத் தேடு"],
  searchChatsPlaceholder: ["அரட்டைகளைத் தேடு..."],
  newChat: ["புதிய அரட்டை"],
  addFilesButton: ["கோப்புகளையும் மேலும் பலவற்றையும் சேர்"],
  addFilesOpenerCandidates: ["கோப்புகளையும் மேலும் பலவற்றையும் சேர்"],
  addPhotosFilesMenuItem: ["படங்கள் மற்றும் ஃபைல்களைப் பதிவேற்று"],
  copyResponse: ["பதிலை நகலெடுக்கலாம்"],
  modeLabels: ["உடனடி", "நடுத்தர", "உயர்", "மிக உயர்வு", "ப்ரோ", "மிதமான", "அதிகமான", "மிக அதிகமான", "அதிகம்"],
  modeOptions: {
    instant: ["உடனடி"],
    medium: ["நடுத்தர", "மிதமான"],
    high: ["உயர்", "அதிகமான", "அதிகம்"],
    extraHigh: ["மிக உயர்வு", "மிக அதிகமான"],
    pro: ["ப்ரோ"],
  },
  modeOpenerExtra: ["கட்டமைக்கவும்..."],
  experienceOptions: {
    chat: ["அரட்டை"],
    work: ["வேலை"],
  },
  tools: {
    web_search: ["இணைய தேடல்"],
    deep_research: ["ஆழ்ந்த ஆய்வு"],
    create_image: ["படத்தை உருவாக்கவும்"],
  },
  signedInMarkers: ["புதிய அரட்டை", "அரட்டைகளைத் தேடு", "சமீபத்தியது", "அரட்டை வரலாறு", "திட்டங்கள்", "எதையும் கேளுங்கள்"],
  responseActions: ["பதிலை நகலெடுக்கலாம்"],
  stopControl: ["பதிலளிப்பதை நிறுத்து"],
} satisfies LocaleContribution;
