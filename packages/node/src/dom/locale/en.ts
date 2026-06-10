import type { LocaleStrings } from "./types.js";

/**
 * English (canonical) locale strings.
 *
 * This must be COMPLETE — every key in `LocaleStrings` must be present. The `satisfies`
 * check enforces this at compile time. English is always first in the `locales` list and
 * defines the canonical public API keys (e.g. `effort: "Thinking"`, `tool: "web_search"`).
 */
export const en = {
  // --- Primary interaction path (accessible names) ---
  composerTextbox: ["Chat with ChatGPT"],
  sendButton: ["Send prompt"],
  searchChatsButton: ["Search chats"],
  searchChatsPlaceholder: ["Search chats..."],
  newChat: ["New chat"],
  addFilesButton: ["Add files and more"],
  /** Fallback opener labels tried in order when the primary add-files control is absent. */
  addFilesOpenerCandidates: ["Add files and more", "Add files", "Add photos"],
  addPhotosFilesMenuItem: ["Add photos & files"],
  copyResponse: ["Copy response"],

  // --- Download affordances (matched as `aria-label` substrings) ---
  download: ["Download"],
  downloadImage: ["Download image"],
  /** Container hint used to scope generated-image download controls. */
  imageContainerHint: ["image"],

  // --- Mode switcher (also the canonical public API keys) ---
  modeLabels: ["Latest", "Instant", "Thinking", "Extended", "Pro"],
  /** Extra openers that surface the mode menu but are not selectable modes themselves. */
  modeOpenerExtra: ["Configure"],

  // --- Tool menu items, keyed by logical tool id ---
  tools: {
    web_search: ["Web search"],
    deep_research: ["Deep research"],
    create_image: ["Create image"],
  },

  // --- Detection heuristics (Node-side, matched against extracted visible text) ---
  /** Sidebar/shell markers that indicate a signed-in ChatGPT surface. */
  signedInMarkers: ["New chat", "Search chats", "Chat with ChatGPT", "Recents", "Projects"],
  /** Exact-match transient assistant placeholders filtered out of captured responses. */
  transientAssistant: ["thinking", "reasoning", "searching", "searching the web"],
  /** Streaming "stop" control text, matched as whole words while a response generates. */
  stopControl: ["stop generating", "stop streaming", "cancel"],
  /** Response-action affordance text (fallback to the structural copy-button locator). */
  responseActions: ["Copy response", "More actions"],

  // --- Blocker classification (ChatGPT-localized visible text only) ---
  /** Sign-in wall copy. Matched as whole words. */
  loginBlocker: ["log in", "login", "sign in", "signin", "welcome back"],
  /** Captcha / suspicious-activity challenge copy. */
  captchaBlocker: ["captcha", "verify you are human", "verify that you are human", "suspicious activity"],
  /** Usage/rate-limit copy. */
  rateLimitBlocker: ["usage limit", "rate limit", "try again later", "too many requests"],
} as const satisfies LocaleStrings;
