import type { LocaleContribution } from "./types.js";

/**
 * Greek (el-GR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=el-GR, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• Εκτεταμένος" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const el = {
  composerTextbox: ["Συνομιλία με το ChatGPT"],
  sendButton: ["Αποστολή προτροπής"],
  searchChatsButton: ["Αναζήτηση συνομιλιών"],
  searchChatsPlaceholder: ["Αναζήτηση συνομιλιών…"],
  newChat: ["Νέα συνομιλία"],
  addFilesButton: ["Προσθήκη αρχείων και άλλα"],
  addFilesOpenerCandidates: ["Προσθήκη αρχείων και άλλα"],
  addPhotosFilesMenuItem: ["Προσθήκη φωτογραφιών & αρχείων"],
  copyResponse: ["Αντιγραφή απάντησης"],
  modeOpenerExtra: ["Διαμόρφωση…"],
  tools: {
    web_search: ["Αναζήτηση στον ιστό"],
    deep_research: ["Έρευνα σε βάθος"],
    create_image: ["Δημιουργία εικόνας"],
  },
  signedInMarkers: ["Νέα συνομιλία", "Αναζήτηση συνομιλιών", "Πρόσφατες", "Ιστορικό συνομιλιών", "Έργα", "Συνομιλία με το ChatGPT"],
  responseActions: ["Αντιγραφή απάντησης"],
} satisfies LocaleContribution;
