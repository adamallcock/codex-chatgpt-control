import type { LocaleContribution } from "./types.js";

/**
 * Greek (el-GR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=el-GR, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const el = {
  configurationAxes: {
    power: ["Ισχύς"],
    model: ["Μοντέλο", "Επιλογή μοντέλου"],
    effort: ["Προσπάθεια", "Επίπεδο συλλογισμού", "Ισχύς"],
    speed: ["Ταχύτητα"],
    advanced: ["Για προχωρημένους"],
  },
  configurationOptions: {
    instant: ["Άμεση", "Γρήγορο"],
    light: ["Ελαφριά"],
    medium: ["Μεσαίο"],
    high: ["Υψηλό"],
    extraHigh: ["Πολύ υψηλό"],
    max: ["Μέγιστη"],
    standard: ["Τυπικό"],
    fast: ["Γρήγορο"],
  },
  composerTextbox: ["Συνομιλία με το ChatGPT"],
  sendButton: ["Αποστολή προτροπής"],
  searchChatsButton: ["Αναζήτηση συνομιλιών"],
  searchChatsPlaceholder: ["Αναζήτηση συνομιλιών…"],
  newChat: ["Νέα συνομιλία"],
  addFilesButton: ["Προσθήκη αρχείων και άλλα"],
  addFilesOpenerCandidates: ["Προσθήκη αρχείων και άλλα"],
  addPhotosFilesMenuItem: ["Προσθήκη φωτογραφιών & αρχείων"],
  copyResponse: ["Αντιγραφή απάντησης"],
  modeLabels: ["Άμεση", "Μεσαία", "Υψηλή", "Πολύ υψηλό", "Μεσαίο", "Υψηλό", "Γρήγορο"],
  modeOptions: {
    instant: ["Άμεση", "Γρήγορο"],
    medium: ["Μεσαία", "Μεσαίο"],
    high: ["Υψηλή", "Υψηλό"],
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
