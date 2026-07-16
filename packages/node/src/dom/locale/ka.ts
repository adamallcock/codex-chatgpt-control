import type { LocaleContribution } from "./types.js";

/**
 * Georgian (ka-GE). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ka-GE, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
 */
export const ka = {
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
  tools: {
    web_search: ["ვებში ძიება"],
    deep_research: ["სიღრმისეული კვლევა"],
    create_image: ["შექმენი სურათი"],
  },
  signedInMarkers: ["ახალი ჩატი", "ჩატების ძიება", "ბოლოდროინდელი", "ჩატის ისტორია", "პროექტები", "საუბარი ChatGPT-სთან"],
  responseActions: ["პასუხის კოპირება"],
  stopControl: ["პასუხის შეწყვეტა"],
} satisfies LocaleContribution;
