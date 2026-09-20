import type { LocaleContribution } from "./types.js";

/**
 * Georgian (ka-GE). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ka-GE, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ka = {
  configurationAxes: {
    power: ["სიმძლავრე"],
    model: ["მოდელი", "მოდელის არჩევა"],
    effort: ["ძალისხმევა", "მსჯელობის დონე", "სიმძლავრე"],
    speed: ["სიჩქარე"],
    advanced: ["გაფართოებული"],
  },
  configurationOptions: {
    instant: ["მყისიერი"],
    light: ["მსუბუქი"],
    medium: ["საშუალო"],
    high: ["მაღალი"],
    extraHigh: ["ძალიან მაღალი"],
    max: ["მაქს."],
    ultra: ["ულტრა"],
    standard: ["სტანდარტული"],
    fast: ["სწრაფი"],
  },
  composerTextbox: ["საუბარი ChatGPT-სთან"],
  sendButton: ["მოთხოვნის გაგზავნა"],
  searchChatsButton: ["ჩატების ძიება"],
  searchChatsPlaceholder: ["მოძებნეთ ჩატებში…"],
  newChat: ["ახალი ჩატი"],
  addFilesButton: ["ფაილების დამატება და მეტი"],
  addFilesOpenerCandidates: ["ფაილების დამატება და მეტი"],
  addPhotosFilesMenuItem: ["ფოტოების და ფაილების დამატება"],
  copyResponse: ["პასუხის კოპირება"],
  modeLabels: ["მყისიერი", "საშუალო", "მაღალი", "ძალიან მაღალი"],
  modeOptions: {
    instant: ["მყისიერი"],
    medium: ["საშუალო"],
    high: ["მაღალი"],
    extraHigh: ["ძალიან მაღალი"],
  },
  modeOpenerExtra: ["კონფიგურირება…"],
  experienceOptions: {
    chat: ["ჩატი"],
    work: ["მუშაობა"],
  },
  tools: {
    web_search: ["ვებში ძიება"],
    deep_research: ["სიღრმისეული კვლევა"],
    create_image: ["შექმენი სურათი"],
  },
  signedInMarkers: ["ახალი ჩატი", "ჩატების ძიება", "ბოლოდროინდელი", "ჩატის ისტორია", "პროექტები", "საუბარი ChatGPT-სთან"],
  responseActions: ["პასუხის კოპირება"],
  stopControl: ["პასუხის შეწყვეტა"],
} satisfies LocaleContribution;
