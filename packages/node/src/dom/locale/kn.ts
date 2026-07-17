import type { LocaleContribution } from "./types.js";

/**
 * Kannada (kn-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=kn-IN, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, and Chat/Work surface labels updated 2026-07-17 from visible ChatGPT sessions.
 */
export const kn = {
  configurationAxes: {
    model: ["ಮಾಡೆಲ್"],
    effort: ["ಎಫರ್ಟ್"],
    speed: ["ವೇಗ"],
  },
  configurationOptions: {
    light: ["ಲೈಟ್"],
    medium: ["ಮೀಡಿಯಂ"],
    high: ["ಹೈ"],
    extraHigh: ["ಎಕ್ಸ್‌ಟ್ರಾ ಹೈ"],
    standard: ["ಸ್ಟ್ಯಾಂಡರ್ಡ್"],
    fast: ["ತ್ವರಿತ"],
  },
  composerTextbox: ["ChatGPT ಜೊತೆಗೆ ಚಾಟ್ ಮಾಡಿ"],
  sendButton: ["ಪ್ರಾಂಪ್ಟ್ಅನ್ನು ಕಳುಹಿಸಿ"],
  searchChatsButton: ["ಚಾಟ್‌ಗಳನ್ನು ಹುಡುಕಿ"],
  searchChatsPlaceholder: ["ಚಾಟ್‌ಗಳನ್ನು ಸರ್ಚ್ ಮಾಡಿ..."],
  newChat: ["ಹೊಸ ಚಾಟ್"],
  addFilesButton: ["ಫೈಲ್‌ಗಳು ಮತ್ತು ಹೆಚ್ಚಿನವುಗಳನ್ನು ಸೇರಿಸಿ"],
  addFilesOpenerCandidates: ["ಫೈಲ್‌ಗಳು ಮತ್ತು ಹೆಚ್ಚಿನವುಗಳನ್ನು ಸೇರಿಸಿ"],
  addPhotosFilesMenuItem: ["ಫೋಟೊ ಮತ್ತು ಫೈಲ್‌ಗಳನ್ನು ಸೇರಿಸಿ"],
  copyResponse: ["ಪ್ರತಿಕ್ರಿಯೆಯನ್ನು ನಕಲಿಸಿ"],
  modeLabels: ["ತಕ್ಷಣ", "ಮಧ್ಯಮ", "ಉನ್ನತ", "ಅತಿ ಹೆಚ್ಚು", "ಪ್ರೊ", "ಮೀಡಿಯಂ", "ಹೈ", "ಎಕ್ಸ್‌ಟ್ರಾ ಹೈ"],
  modeOptions: {
    instant: ["ತಕ್ಷಣ"],
    medium: ["ಮಧ್ಯಮ", "ಮೀಡಿಯಂ"],
    high: ["ಉನ್ನತ", "ಹೈ"],
    extraHigh: ["ಅತಿ ಹೆಚ್ಚು", "ಎಕ್ಸ್‌ಟ್ರಾ ಹೈ"],
    pro: ["ಪ್ರೊ"],
  },
  modeOpenerExtra: ["ಕಾನ್ಫಿಗರ್ ಮಾಡಿ..."],
  tools: {
    web_search: ["ವೆಬ್ ಸರ್ಚ್"],
    deep_research: ["ಡೀಪ್ ರಿಸರ್ಚ್"],
    create_image: ["ಇಮೇಜ್ ರಚಿಸಿ"],
  },
  signedInMarkers: ["ಹೊಸ ಚಾಟ್", "ಚಾಟ್‌ಗಳನ್ನು ಹುಡುಕಿ", "ಇತ್ತೀಚಿನದು", "ಚಾಟ್ ಇತಿಹಾಸ", "ಪ್ರಾಜೆಕ್ಟ್‌ಗಳು", "ChatGPT ಜೊತೆಗೆ ಚಾಟ್ ಮಾಡಿ"],
  responseActions: ["ಪ್ರತಿಕ್ರಿಯೆಯನ್ನು ನಕಲಿಸಿ"],
  stopControl: ["ಉತ್ತರಿಸುವುದನ್ನು ನಿಲ್ಲಿಸಿ"],
} satisfies LocaleContribution;
