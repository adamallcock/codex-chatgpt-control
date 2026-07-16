/**
 * Canonical shape for a complete locale contribution.
 *
 * Each value is either a single string (one candidate) or a readonly array of strings
 * (multiple candidates for the same semantic slot). The combiner in `index.ts` flattens
 * every contribution into a deduped `string[]` per key, English-first.
 *
 * `tools` is keyed by logical tool id (stable API keys — callers pass `tool: "web_search"`).
 * A locale only needs to list the tools whose display text differs from English.
 */
export type ModeOptionId =
  | "latest"
  | "instant"
  | "thinking"
  | "extended"
  | "medium"
  | "high"
  | "extraHigh"
  | "pro";

export type ModeOptionLabels = Record<ModeOptionId, string | readonly string[]>;
export type ModeOptionContribution = Partial<ModeOptionLabels>;

export type ExperienceOptionId = "chat" | "work";
export type ExperienceOptionLabels = Record<ExperienceOptionId, string | readonly string[]>;
export type ExperienceOptionContribution = Partial<ExperienceOptionLabels>;

export type ConfigurationAxisLabelId = "model" | "intelligence" | "effort" | "speed" | "advanced";
export type ConfigurationAxisLabels = Record<ConfigurationAxisLabelId, string | readonly string[]>;
export type ConfigurationAxisContribution = Partial<ConfigurationAxisLabels>;

export type ConfigurationOptionId =
  | "instant"
  | "light"
  | "medium"
  | "high"
  | "extraHigh"
  | "max"
  | "ultra"
  | "pro"
  | "standard"
  | "fast";
export type ConfigurationOptionLabels = Record<ConfigurationOptionId, string | readonly string[]>;
export type ConfigurationOptionContribution = Partial<ConfigurationOptionLabels>;

export type LocaleStrings = {
  // --- Primary interaction path (accessible names) ---
  composerTextbox: string | readonly string[];
  workComposerTextbox: string | readonly string[];
  newWork: string | readonly string[];
  sendButton: string | readonly string[];
  searchChatsButton: string | readonly string[];
  searchChatsPlaceholder: string | readonly string[];
  newChat: string | readonly string[];
  addFilesButton: string | readonly string[];
  addFilesOpenerCandidates: string | readonly string[];
  addPhotosFilesMenuItem: string | readonly string[];
  projectSourcesTab: string | readonly string[];
  projectSourcesAddSource: string | readonly string[];
  projectSourcesUploadFiles: string | readonly string[];
  copyResponse: string | readonly string[];

  // --- Download affordances ---
  download: string | readonly string[];
  downloadImage: string | readonly string[];
  imageContainerHint: string | readonly string[];

  // --- Mode switcher ---
  modeLabels: string | readonly string[];
  modeOptions: ModeOptionLabels;
  modeOpenerExtra: string | readonly string[];

  // --- Chat / Work surfaces and capability-driven configuration ---
  experienceOptions: ExperienceOptionLabels;
  configurationAxes: ConfigurationAxisLabels;
  configurationOptions: ConfigurationOptionLabels;

  // --- Thread/action menu rejection (wrong-menu veto for mode selection) ---
  threadActionMenuItems: string | readonly string[];
  threadActionPrefixes: string | readonly string[];

  // --- Tool menu items, keyed by logical tool id ---
  tools: Record<"web_search" | "deep_research" | "create_image", string | readonly string[]>;

  // --- Detection heuristics ---
  signedInMarkers: string | readonly string[];
  transientAssistant: string | readonly string[];
  stopControl: string | readonly string[];
  stoppedAssistant: string | readonly string[];
  responseActions: string | readonly string[];

  // --- Blocker classification ---
  loginBlocker: string | readonly string[];
  captchaBlocker: string | readonly string[];
  rateLimitBlocker: string | readonly string[];
};

/**
 * The type for non-English locale files. Every key is optional so a contributor only
 * needs to supply the strings that differ from English. `tools` is also partial.
 */
export type LocaleContribution = Partial<Omit<
  LocaleStrings,
  "tools" | "modeOptions" | "experienceOptions" | "configurationAxes" | "configurationOptions"
>> & {
  modeOptions?: ModeOptionContribution;
  experienceOptions?: ExperienceOptionContribution;
  configurationAxes?: ConfigurationAxisContribution;
  configurationOptions?: ConfigurationOptionContribution;
  tools?: Partial<Record<"web_search" | "deep_research" | "create_image", string | readonly string[]>>;
};
