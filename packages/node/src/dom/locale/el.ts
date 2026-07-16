import type { LocaleContribution } from "./types.js";

/**
 * Greek (el-GR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=el-GR, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["Άμεση", "Μεσαία", "Υψηλή", "Πολύ υψηλό"],
  modeOptions: {
    instant: ["Άμεση"],
    medium: ["Μεσαία"],
    high: ["Υψηλή"],
    extraHigh: ["Πολύ υψηλό"],
  },
  modeOpenerExtra: ["Διαμόρφωση…"],
  tools: {
    web_search: ["Αναζήτηση στον ιστό"],
    deep_research: ["Έρευνα σε βάθος"],
    create_image: ["Δημιουργία εικόνας"],
  },
  signedInMarkers: ["Νέα συνομιλία", "Αναζήτηση συνομιλιών", "Πρόσφατες", "Ιστορικό συνομιλιών", "Έργα", "Συνομιλία με το ChatGPT"],
  responseActions: ["Αντιγραφή απάντησης"],
  stopControl: ["Διακοπή απάντησης"],
} satisfies LocaleContribution;
