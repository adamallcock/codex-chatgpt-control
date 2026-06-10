import type { LocaleContribution } from "./types.js";

/**
 * Kannada (kn-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=kn-IN, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• ಹೆಚ್ಚಿನ" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const kn = {
  composerTextbox: ["ChatGPT ಜೊತೆಗೆ ಚಾಟ್ ಮಾಡಿ"],
  sendButton: ["ಪ್ರಾಂಪ್ಟ್ಅನ್ನು ಕಳುಹಿಸಿ"],
  searchChatsButton: ["ಚಾಟ್‌ಗಳನ್ನು ಹುಡುಕಿ"],
  searchChatsPlaceholder: ["ಚಾಟ್‌ಗಳನ್ನು ಸರ್ಚ್ ಮಾಡಿ..."],
  newChat: ["ಹೊಸ ಚಾಟ್"],
  addFilesButton: ["ಫೈಲ್‌ಗಳು ಮತ್ತು ಹೆಚ್ಚಿನವುಗಳನ್ನು ಸೇರಿಸಿ"],
  addFilesOpenerCandidates: ["ಫೈಲ್‌ಗಳು ಮತ್ತು ಹೆಚ್ಚಿನವುಗಳನ್ನು ಸೇರಿಸಿ"],
  addPhotosFilesMenuItem: ["ಫೋಟೊ ಮತ್ತು ಫೈಲ್‌ಗಳನ್ನು ಸೇರಿಸಿ"],
  copyResponse: ["ಪ್ರತಿಕ್ರಿಯೆಯನ್ನು ನಕಲಿಸಿ"],
  modeOpenerExtra: ["ಕಾನ್ಫಿಗರ್ ಮಾಡಿ..."],
  tools: {
    web_search: ["ವೆಬ್ ಸರ್ಚ್"],
    deep_research: ["ಡೀಪ್ ರಿಸರ್ಚ್"],
    create_image: ["ಇಮೇಜ್ ರಚಿಸಿ"],
  },
  signedInMarkers: ["ಹೊಸ ಚಾಟ್", "ಚಾಟ್‌ಗಳನ್ನು ಹುಡುಕಿ", "ಇತ್ತೀಚಿನದು", "ಚಾಟ್ ಇತಿಹಾಸ", "ಪ್ರಾಜೆಕ್ಟ್‌ಗಳು", "ChatGPT ಜೊತೆಗೆ ಚಾಟ್ ಮಾಡಿ"],
  responseActions: ["ಪ್ರತಿಕ್ರಿಯೆಯನ್ನು ನಕಲಿಸಿ"],
} satisfies LocaleContribution;
