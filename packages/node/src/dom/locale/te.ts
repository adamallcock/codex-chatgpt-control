import type { LocaleContribution } from "./types.js";

/**
 * Telugu (te-IN). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=te-IN, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const te = {
  composerTextbox: ["ఏదైనా అడగండి"],
  sendButton: ["ప్రాంప్ట్‌ను పంపించండి"],
  searchChatsButton: ["చాట్‌లను శోధించండి"],
  searchChatsPlaceholder: ["చాట్‌లను వెతకండి..."],
  newChat: ["కొత్త చాట్"],
  addFilesButton: ["ఫైల్‌లను మరియు మరిన్ని జోడించండి"],
  addFilesOpenerCandidates: ["ఫైల్‌లను మరియు మరిన్ని జోడించండి"],
  addPhotosFilesMenuItem: ["ఫోటోలు & ఫైల్‌లను అప్‌లోడ్ చేయండి"],
  copyResponse: ["ప్రతిస్పందనను కాపీ చేయండి"],
  modeOpenerExtra: ["కాన్ఫిగర్ చేయండి"],
  tools: {
    web_search: ["వెబ్‌లో వెతకడం"],
    deep_research: ["సంపూర్ణ పరిశోధన"],
    create_image: ["చిత్రాన్ని సృష్టించు"],
  },
  signedInMarkers: ["కొత్త చాట్", "చాట్‌లను శోధించండి", "ఇటీవలివి", "చాట్ చరిత్ర", "ప్రాజెక్ట్‌లు", "ఏదైనా అడగండి"],
  responseActions: ["ప్రతిస్పందనను కాపీ చేయండి"],
} satisfies LocaleContribution;
