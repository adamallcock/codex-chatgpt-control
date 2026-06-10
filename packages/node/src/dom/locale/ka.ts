import type { LocaleContribution } from "./types.js";

/**
 * Georgian (ka-GE). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ka-GE, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• გაფართოებული" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
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
  modeOpenerExtra: ["კონფიგურირება…"],
  tools: {
    web_search: ["ვებში ძიება"],
    deep_research: ["სიღრმისეული კვლევა"],
    create_image: ["შექმენი სურათი"],
  },
  signedInMarkers: ["ახალი ჩატი", "ჩატების ძიება", "ბოლოდროინდელი", "ჩატის ისტორია", "პროექტები", "საუბარი ChatGPT-სთან"],
  responseActions: ["პასუხის კოპირება"],
} satisfies LocaleContribution;
