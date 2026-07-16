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
  composerTextbox: ["Chat with ChatGPT", "Ask ChatGPT"],
  workComposerTextbox: ["Work on anything", "Work on something"],
  newWork: ["Work on something else", "New work", "New task"],
  sendButton: ["Send prompt"],
  searchChatsButton: ["Search chats"],
  searchChatsPlaceholder: ["Search chats..."],
  newChat: ["New chat"],
  addFilesButton: ["Add files and more"],
  /** Fallback opener labels tried in order when the primary add-files control is absent. */
  addFilesOpenerCandidates: ["Add files and more", "Add files", "Add photos"],
  addPhotosFilesMenuItem: ["Add photos & files"],
  projectSourcesTab: ["Sources"],
  projectSourcesAddSource: ["Add source", "Add sources"],
  projectSourcesUploadFiles: ["Upload files", "Upload file", "Upload", "Add files"],
  copyResponse: ["Copy response"],

  // --- Download affordances (matched as `aria-label` substrings) ---
  download: ["Download"],
  downloadImage: ["Download image"],
  /** Container hint used to scope generated-image download controls. */
  imageContainerHint: ["image"],

  // --- Mode switcher (also the canonical public API keys) ---
  modeLabels: ["Latest", "Instant", "Thinking", "Extended", "Medium", "High", "Extra High", "Pro"],
  modeOptions: {
    latest: ["Latest"],
    instant: ["Instant"],
    thinking: ["Thinking"],
    extended: ["Extended"],
    medium: ["Medium"],
    high: ["High"],
    extraHigh: ["Extra High"],
    pro: ["Pro", "Pro Extended", "Pro • Extended", "Extended Pro"],
  },
  /** Extra openers that surface the mode menu but are not selectable modes themselves. */
  modeOpenerExtra: ["Configure"],

  // --- Chat / Work surfaces and capability-driven configuration ---
  experienceOptions: {
    chat: ["Chat", "Quick chat"],
    work: ["Work"],
  },
  configurationAxes: {
    model: ["Model"],
    intelligence: ["Intelligence"],
    effort: ["Effort"],
    speed: ["Speed"],
    advanced: ["Advanced"],
  },
  configurationOptions: {
    instant: ["Instant"],
    light: ["Light"],
    medium: ["Medium"],
    high: ["High"],
    extraHigh: ["Extra High"],
    max: ["Max"],
    ultra: ["Ultra"],
    pro: ["Pro"],
    standard: ["Standard"],
    fast: ["Fast"],
  },

  // --- Thread/action menu rejection (wrong-menu veto for mode selection) ---
  /** Exact thread/conversation action menu items; a menu containing these is not the mode menu. */
  threadActionMenuItems: ["Archive", "Copy link", "Delete", "Move to project", "Rename", "Share"],
  /** Action verbs that prefix a thread title in sidebar menus, e.g. "Pin <thread title>". */
  threadActionPrefixes: ["Pin", "Unpin"],

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
  /** Streaming "stop" control text, matched while a response generates. */
  stopControl: ["stop generating", "stop streaming", "stop answering", "cancel"],
  /** Interrupted generation markers shown after the assistant stops before completion. */
  stoppedAssistant: ["stopped thinking", "stopped answering", "generation stopped"],
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
