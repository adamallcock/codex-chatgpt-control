export type CommandStatus =
  | "ok"
  | "partial"
  | "timeout"
  | "blocked"
  | "needs_confirmation"
  | "not_found"
  | "unsupported"
  | "error";

export type SubmissionState =
  | "not_submitted"
  | "submitted"
  | "submitted_unconfirmed"
  | "submitted_generating";

export type CompletionState =
  | "complete"
  | "generating"
  | "stopped"
  | "partial"
  | "unknown";

export type BlockerKind =
  | "browser_bridge_unavailable"
  | "login_required"
  | "captcha"
  | "rate_limit"
  | "modal"
  | "permission"
  | "confirmation"
  | "selector_drift"
  | "artifact_unavailable"
  | "artifact_selector_drift"
  | "artifact_download_unavailable"
  | "download_unavailable"
  | "upload_failed"
  | "not_found"
  | "unknown";

export type CommandContext = {
  url?: string;
  conversationId?: string;
  title?: string;
  turnCount?: number;
  assistantTurnCount?: number;
  experience?: ChatGPTExperience;
  selectorProfile?: SurfaceSelectorProfile;
  browserName?: string;
  tabId?: string;
  timestamp: string;
};

export type ExistingTabMismatchReason =
  | "no_candidate"
  | "multiple_candidates"
  | "non_chatgpt_tab"
  | "conversation_id_mismatch"
  | "url_mismatch"
  | "title_mismatch"
  | "selected_tab_unavailable"
  | "explicit_tab_id_not_open"
  | "user_open_tabs_unavailable";

export type ExistingTabDiagnosticTarget = {
  type: string;
  host?: string;
  tabId?: string;
  conversationId?: string;
  url?: string;
  title?: string;
  exact?: boolean;
};

export type ExistingTabDiagnosticCandidate = {
  id: string;
  url?: string;
  title?: string;
  conversationId?: string;
  lastOpened?: string;
  tabGroup?: string;
};

export type ExistingTabDiagnostics = {
  requestedTarget: ExistingTabDiagnosticTarget;
  userOpenTabsAvailable: boolean;
  chatgptTabCount: number;
  mismatchReason: ExistingTabMismatchReason;
  candidateTabs: ExistingTabDiagnosticCandidate[];
  omittedCandidateCount?: number;
};

export type CommandResult<T = unknown> = {
  ok: boolean;
  status: CommandStatus;
  data?: T;
  output_text?: string;
  warnings: string[];
  reportPath?: string;
  error?: {
    name: string;
    message: string;
    recoverable: boolean;
  };
  blocker?: {
    kind: BlockerKind;
    message: string;
    visibleText?: string;
    code?: string;
    fieldPath?: string;
    remediation?: Array<{
      label: string;
      instruction: string;
      userActionRequired: boolean;
    }>;
    candidates?: Array<{
      label: string;
      role?: string;
    }>;
    diagnostics?: {
      existingTab?: ExistingTabDiagnostics;
    };
    resumable?: boolean;
  };
  context: CommandContext;
  steps?: SequenceStepResult[];
};

export type SequencePolicy = {
  stopOnError: boolean;
  returnPartial: boolean;
  defaultTimeoutMs: number;
  screenshotOnBlocker: boolean;
  allowPromptResubmit: "never" | "only_if_no_matching_user_turn";
};

export type ThreadTarget = {
  query?: string;
  title?: string;
  conversationId?: string;
  url?: string;
};

export type ExistingTabTarget =
  | { type: "selected"; host?: "chatgpt" }
  | { type: "tabId"; tabId: string }
  | { type: "conversationId"; conversationId: string }
  | { type: "conversation_id"; conversationId: string }
  | { type: "url"; url: string }
  | { type: "title"; title: string; exact?: boolean };

export type ExistingTabPolicy = {
  target?: ExistingTabTarget;
  ifMissing?: "block" | "create" | "open";
  ifMultiple?: "block" | "first";
  requireChatGPT?: boolean;
};

export type BootstrapArgs = {
  existingTab?: boolean | ExistingTabPolicy;
  preferExistingTab?: boolean;
  url?: string;
  timeoutMs?: number;
};

export type BootstrapData = {
  browserName: string;
  tabId: string;
  url: string;
  loggedIn: boolean;
};

export type NewThreadArgs = {
  timeoutMs?: number;
};

export type SearchThreadsArgs = {
  query: string;
  limit?: number;
  timeoutMs?: number;
};

export type ThreadSearchResult = {
  title: string;
  snippet?: string;
  href: string;
  conversationId?: string;
};

export type SearchThreadsData = {
  query: string;
  results: ThreadSearchResult[];
};

export type OpenThreadArgs = {
  conversationId?: string;
  url?: string;
  title?: string;
  fromStep?: string;
  select?: "first" | { index: number } | { title: string };
  timeoutMs?: number;
};

export type OpenThreadData = {
  conversationId?: string;
  url: string;
  title?: string;
};

export type ComposeArgs = {
  text: string;
  mode?: "replace" | "append";
  timeoutMs?: number;
};

export type ComposeData = {
  text: string;
};

export type SubmitArgs = {
  text?: string;
  previousTurnCount?: number;
  timeoutMs?: number;
};

export type SubmitData = {
  submitted: boolean;
  userTurnText?: string;
  turnCount?: number;
  submissionState?: SubmissionState;
  completionState?: CompletionState;
  generationActive?: boolean;
  generationSignals?: string[];
};

export type WaitArgs = {
  afterTurnCount?: number;
  afterAssistantTurnCount?: number;
  afterStep?: string;
  timeoutMs?: number;
  stableMs?: number;
  pollMs?: number;
  mode?: "normal" | "deep_research";
  responseContent?: "include" | "metadata";
};

export type WaitData = {
  complete: boolean;
  responseText?: string;
  responseChars?: number;
  responseSha256?: string;
  responseContent?: "include" | "metadata";
  assistantTurnCount: number;
  elapsedMs: number;
  completionState?: CompletionState;
  generationActive?: boolean;
  generationSignals?: string[];
};

export type ResponseFormat =
  | "markdown"
  | "text"
  | "normalized_text"
  | "visible_text"
  | "html"
  | "blocks"
  | "all";

export type ResponseCitation = {
  text: string;
  href: string;
};

export type ResponseCodeBlock = {
  language?: string;
  text: string;
};

export type ResponseTable = {
  headers: string[];
  rows: string[][];
};

export type ResponseCaptureSource = "semantic_dom" | "clipboard";

export type ResponseCaptureFidelity =
  | "clipboard_markdown"
  | "semantic_markdown"
  | "visible_text"
  | "normalized_text"
  | "html"
  | "blocks"
  | "all";

export type ResponseCaptureLimit = {
  maxChars: number;
  originalChars: number;
  clipped: boolean;
};

export type ResponseBranchState = {
  current?: number;
  total?: number;
  label?: string;
  canGoPrevious?: boolean;
  canGoNext?: boolean;
};

export type ResponseActionType =
  | "previous_response"
  | "next_response"
  | "copy_response"
  | "sources"
  | "good_response"
  | "bad_response"
  | "more_actions"
  | "unknown";

export type ResponseAction = {
  type: ResponseActionType;
  label: string;
  ariaLabel?: string;
  text?: string;
  testId?: string;
  disabled?: boolean;
};

export type ResponseBlock =
  | { type: "heading"; depth: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | ({ type: "code" } & ResponseCodeBlock)
  | ({ type: "table" } & ResponseTable)
  | { type: "quote"; text: string }
  | { type: "unknown"; text: string };

export type ReadLatestArgs = {
  role?: "assistant" | "user";
  format?: ResponseFormat;
  maxChars?: number;
};

export type ReadLatestData = {
  role: "assistant" | "user";
  text: string;
  format: Exclude<ResponseFormat, "text">;
  source?: ResponseCaptureSource;
  fidelity?: ResponseCaptureFidelity;
  captureLimit?: ResponseCaptureLimit;
  warnings?: string[];
  markdown?: string;
  visibleText?: string;
  normalizedText?: string;
  html?: string;
  blocks?: ResponseBlock[];
  citations?: ResponseCitation[];
  codeBlocks?: ResponseCodeBlock[];
  tables?: ResponseTable[];
  branch?: ResponseBranchState;
  actions?: ResponseAction[];
  thoughtDurationText?: string;
  sourcesAvailable?: boolean;
  completionState?: CompletionState;
  generationActive?: boolean;
  generationSignals?: string[];
};

export type WaitAndReadArgs = WaitArgs & ReadLatestArgs;

export type AskArgs = {
  text?: string;
  prompt?: string;
  wait?: boolean | WaitArgs;
  read?: boolean | ReadLatestArgs;
  timeoutMs?: number;
};

export type AskReadData = {
  prompt: string;
  responseText?: string;
  complete?: boolean;
  conversationId?: string;
  title?: string;
  submissionState?: SubmissionState;
  completionState?: CompletionState;
  generationActive?: boolean;
  generationSignals?: string[];
};

export type MessageStatusArgs = {
  maxPreviewChars?: number;
};

export type MessageStatusData = {
  turnCount?: number;
  assistantTurnCount: number;
  latestAssistantTurnIndex?: number;
  latestAssistantText?: string;
  latestAssistantPreview?: string;
  latestAssistantTextLength?: number;
  completionState: CompletionState;
  generationActive: boolean;
  generationSignals: string[];
};

export type AttachFilesArgs = {
  paths: string[];
  timeoutMs?: number;
  includeDiagnostics?: boolean;
  includeHashes?: boolean;
};

export type AttachedFile = {
  path: string;
  name: string;
  bytes: number;
};

export type FileCategory =
  | "text"
  | "document"
  | "spreadsheet"
  | "data"
  | "image"
  | "audio"
  | "video"
  | "archive"
  | "unknown";

export type FilePreflightArgs = {
  paths: string[];
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
  includeHashes?: boolean;
};

export type FilePreflightFile = AttachedFile & {
  extension: string;
  mimeType: string;
  category: FileCategory;
  sha256?: string;
};

export type FilePreflightData = {
  files: FilePreflightFile[];
  totalBytes: number;
};

export type AttachFilesData = {
  files: AttachedFile[];
  diagnostics?: FileUploadDiagnostics;
};

export type BrowserInputFileDiagnostic = {
  name: string;
  size: number;
  type?: string;
  lastModified?: number;
};

export type BrowserInputDiagnostic = {
  files: BrowserInputFileDiagnostic[];
};

export type FileUploadDiagnostics = {
  preflight: FilePreflightData;
  browserInput?: BrowserInputDiagnostic;
};

export type ProjectSourceStatus =
  | "ready"
  | "processing"
  | "failed"
  | "unknown";

export type ProjectSource = {
  name: string;
  status: ProjectSourceStatus;
};

export type ProjectSourcesUrl = {
  projectId: string;
  projectSlug?: string;
  url: string;
};

export type ProjectSourcesListArgs = {
  projectUrl: string;
  existingTab?: boolean | ExistingTabPolicy;
  preferExistingTab?: boolean;
  timeoutMs?: number;
};

export type ProjectSourcesListData = ProjectSourcesUrl & {
  sources: ProjectSource[];
};

export type ProjectSourcePlanFile = FilePreflightFile & {
  displayPath: string;
};

export type ProjectSourceUploadBatch = {
  index: number;
  files: ProjectSourcePlanFile[];
  totalBytes: number;
};

export type ProjectSourcesPlanAddArgs = {
  projectUrl: string;
  files: string[];
  batchSize?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
};

export type ProjectSourcesAddPlanData = ProjectSourcesUrl & {
  projectUrl: string;
  operation: "append_add";
  dryRun: true;
  files: ProjectSourcePlanFile[];
  batches: ProjectSourceUploadBatch[];
  totalBytes: number;
};

export type ProjectSourcesAddArgs = ProjectSourcesPlanAddArgs & {
  confirmMutation?: boolean;
  existingTab?: boolean | ExistingTabPolicy;
  preferExistingTab?: boolean;
  timeoutMs?: number;
};

export type ProjectSourcesAddData = Omit<ProjectSourcesAddPlanData, "dryRun"> & {
  dryRun: false;
  before: ProjectSource[];
  after: ProjectSource[];
  added: ProjectSource[];
};

export type DownloadLatestArgs = {
  destDir: string;
  filenamePattern?: string;
  from?: "latest_assistant" | "visible_conversation" | { assistantIndex: number };
  timeoutMs?: number;
};

export type DownloadedFile = {
  path: string;
  suggestedFilename?: string;
  bytes: number;
};

export type ArtifactKind = "image";

export type GeneratedArtifact = {
  kind: ArtifactKind;
  index: number;
  visible: boolean;
  width?: number;
  height?: number;
  alt?: string;
  ariaLabel?: string;
  src?: string;
  turnId?: string;
  downloadAvailable: boolean;
  selectorProvenance: string;
};

export type ListArtifactsArgs = {
  kind?: ArtifactKind;
  max?: number;
  timeoutMs?: number;
};

export type ArtifactListData = {
  count: number;
  artifacts: GeneratedArtifact[];
  latest?: GeneratedArtifact;
};

export type ArtifactWaitArgs = ListArtifactsArgs & {
  afterArtifactCount?: number;
  requireDownload?: boolean;
  timeoutMs?: number;
  stableMs?: number;
  pollMs?: number;
};

export type ArtifactWaitData = {
  complete: boolean;
  count: number;
  latest?: GeneratedArtifact;
  elapsedMs: number;
};

export type ArtifactDownloadArgs = DownloadLatestArgs & {
  kind?: ArtifactKind;
  prefer?: "download_control" | "visible_image_source";
};

export type CopyResponseArgs = {
  which?: "latest" | { assistantIndex: number };
  prefer?: "clipboard" | "dom";
  format?: ResponseFormat;
  timeoutMs?: number;
};

export type CopiedResponse = {
  text: string;
  source: "clipboard" | "dom";
  format: Exclude<ResponseFormat, "text">;
  fidelity?: ResponseCaptureFidelity;
  captureLimit?: ResponseCaptureLimit;
  warnings?: string[];
  markdown?: string;
  visibleText?: string;
  normalizedText?: string;
  html?: string;
  blocks?: ResponseBlock[];
  citations?: ResponseCitation[];
  codeBlocks?: ResponseCodeBlock[];
  tables?: ResponseTable[];
  branch?: ResponseBranchState;
  actions?: ResponseAction[];
  thoughtDurationText?: string;
  sourcesAvailable?: boolean;
  fallbackReason?: string;
};

export type SetModeArgs = {
  model?: string;
  effort?: string;
  intelligence?: string;
  modelVersion?: string;
  version?: string;
  timeoutMs?: number;
};

export type GetModeArgs = {
  timeoutMs?: number;
};

export type GetModeData = {
  modes: string[];
};

export type ChatGPTExperience = "chat" | "work" | "unknown";

export type SurfaceSelectorProfile =
  | "chat_legacy_v1"
  | "chat_simplified_v1"
  | "work_basic_v1"
  | "work_advanced_v1"
  | "unknown";

export type SurfaceProfileSupportState =
  | "current"
  | "compatibility"
  | "unverified"
  | "retired";

export type SurfaceProfileObservation = {
  observedAt: string;
  provenance: string;
  locale: string;
  region: string;
  accountScope: string;
  planScope: string;
  workspaceScope: string;
  supportState: SurfaceProfileSupportState;
};

export type ExperienceConfidence = "high" | "medium" | "low";

export type ExperienceEvidence = {
  source: "url" | "composer" | "control" | "menu" | "heading";
  label: string;
};

export type DetectExperienceArgs = {
  timeoutMs?: number;
};

export type DetectExperienceData = {
  experience: ChatGPTExperience;
  selectorProfile: SurfaceSelectorProfile;
  confidence: ExperienceConfidence;
  evidence: ExperienceEvidence[];
};

export type OpenExperienceArgs = {
  experience: Exclude<ChatGPTExperience, "unknown">;
  timeoutMs?: number;
};

export type OpenExperienceData = {
  experience: Exclude<ChatGPTExperience, "unknown">;
  previousExperience: ChatGPTExperience;
  changed: boolean;
  selectorProfile: SurfaceSelectorProfile;
};

export type ConfigurationAxis =
  | "model"
  | "intelligence"
  | "effort"
  | "speed"
  | "modelVersion";

export type SurfaceProfileFixture = SurfaceProfileObservation & {
  schemaVersion: "chatgpt.browser_control.surface_profile.v1";
  id: string;
  snapshot: {
    url: string;
    composerLabels: string[];
    mainControls: string[];
    mainText: string;
  };
  panel: {
    openerLabel?: string;
    axisRows: Array<{
      axis: ConfigurationAxis;
      label: string;
      value?: string;
    }>;
    advancedVisible: boolean;
  };
  menuItems: Array<{
    label: string;
    normalized: string;
    role?: string;
    checked?: boolean;
    expanded?: boolean;
    hasPopup?: boolean;
    testId?: string;
    ariaLabel?: string;
  }>;
  expected: {
    experience: ChatGPTExperience;
    selectorProfile: SurfaceSelectorProfile;
    availableAxes: ConfigurationAxis[];
    active: Partial<Record<ConfigurationAxis, string>>;
  };
};

export type ConfigurationOption = {
  id: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  description?: string;
  hasSubmenu?: boolean;
};

export type ConfigurationSelection = {
  model?: string;
  intelligence?: string;
  effort?: string;
  speed?: string;
  modelVersion?: string;
  /** Backward-compatible alias for modelVersion. */
  version?: string;
};

export type InspectConfigurationArgs = {
  experience?: Exclude<ChatGPTExperience, "unknown">;
  includeOptions?: boolean;
  timeoutMs?: number;
};

export type ConfigurationInspectionData = {
  experience: ChatGPTExperience;
  selectorProfile: SurfaceSelectorProfile;
  availableAxes: ConfigurationAxis[];
  active: Partial<Record<ConfigurationAxis, string>>;
  options: Partial<Record<ConfigurationAxis, ConfigurationOption[]>>;
  verified: boolean;
  evidence: ExperienceEvidence[];
};

export type ApplyConfigurationArgs = {
  experience?: Exclude<ChatGPTExperience, "unknown">;
  desired: ConfigurationSelection;
  strict?: boolean;
  timeoutMs?: number;
};

export type AppliedConfigurationSelection = {
  axis: ConfigurationAxis;
  requested: string;
  selected: string;
};

export type ApplyConfigurationData = {
  requested: ConfigurationSelection;
  selected: AppliedConfigurationSelection[];
  before: ConfigurationInspectionData;
  after: ConfigurationInspectionData;
  verified: boolean;
};

export type WorkTaskRef = {
  url?: string;
  conversationId?: string;
  title?: string;
  baselineTurnCount?: number;
  baselineAssistantTurnCount?: number;
};

export type StartWorkArgs = {
  prompt: string;
  /** Start from a blank Work task when possible. Defaults to true. */
  newTask?: boolean;
  files?: string[];
  configuration?: ConfigurationSelection;
  wait?: boolean | WaitArgs;
  read?: boolean | ReadLatestArgs;
  timeoutMs?: number;
};

export type StartWorkData = {
  task: WorkTaskRef;
  submitted: SubmitData;
  configuration?: ApplyConfigurationData;
  wait?: WaitData;
  response?: ReadLatestData;
};

export type WorkStatusArgs = MessageStatusArgs & {
  includeArtifacts?: boolean;
};

export type WorkStatusData = {
  experience: "work";
  task: WorkTaskRef;
  message: MessageStatusData;
  artifacts?: ArtifactListData;
};

export type WorkWaitArgs = WaitArgs;
export type WorkWaitData = WaitData;

export type SteerWorkArgs = {
  prompt: string;
  wait?: boolean | WaitArgs;
  read?: boolean | ReadLatestArgs;
  timeoutMs?: number;
};

export type SteerWorkData = AskReadData;

export type ReadWorkLatestArgs = ReadLatestArgs;
export type ReadWorkLatestData = ReadLatestData;

export type SelectToolArgs = {
  tool: "web_search" | "deep_research" | "create_image" | string;
  timeoutMs?: number;
};

export type SequenceStep =
  | { id: string; command: "session.bootstrap"; args?: BootstrapArgs }
  | { id: string; command: "experience.detect"; args?: DetectExperienceArgs }
  | { id: string; command: "experience.open"; args: OpenExperienceArgs }
  | { id: string; command: "configuration.inspect"; args?: InspectConfigurationArgs }
  | { id: string; command: "configuration.apply"; args: ApplyConfigurationArgs }
  | { id: string; command: "work.start"; args: StartWorkArgs }
  | { id: string; command: "work.status"; args?: WorkStatusArgs }
  | { id: string; command: "work.wait"; args?: WorkWaitArgs }
  | { id: string; command: "work.steer"; args: SteerWorkArgs }
  | { id: string; command: "work.readLatest"; args?: ReadWorkLatestArgs }
  | { id: string; command: "threads.search"; args: SearchThreadsArgs }
  | { id: string; command: "threads.open"; args: OpenThreadArgs }
  | { id: string; command: "threads.new"; args?: NewThreadArgs }
  | { id: string; command: "messages.compose"; args: ComposeArgs }
  | { id: string; command: "messages.submit"; args?: SubmitArgs }
  | { id: string; command: "messages.ask"; args: AskArgs }
  | { id: string; command: "messages.wait"; args: WaitArgs }
  | { id: string; command: "messages.readLatest"; args?: ReadLatestArgs }
  | { id: string; command: "messages.status"; args?: MessageStatusArgs }
  | { id: string; command: "messages.waitAndRead"; args: WaitAndReadArgs }
  | { id: string; command: "artifacts.listLatest"; args?: ListArtifactsArgs }
  | { id: string; command: "artifacts.wait"; args?: ArtifactWaitArgs }
  | { id: string; command: "artifacts.downloadLatest"; args: ArtifactDownloadArgs }
  | { id: string; command: "files.attach"; args: AttachFilesArgs }
  | { id: string; command: "files.downloadLatest"; args: DownloadLatestArgs }
  | { id: string; command: "projects.sources.list"; args: ProjectSourcesListArgs }
  | { id: string; command: "projects.sources.planAdd"; args: ProjectSourcesPlanAddArgs }
  | { id: string; command: "projects.sources.add"; args: ProjectSourcesAddArgs }
  | { id: string; command: "response.copy"; args?: CopyResponseArgs }
  | { id: string; command: "modes.set"; args: SetModeArgs }
  | { id: string; command: "tools.select"; args: SelectToolArgs };

export type SequencePlan = {
  name: string;
  input?: Record<string, unknown>;
  policy?: Partial<SequencePolicy>;
  steps: SequenceStep[];
};

export type SequenceStepResult = {
  id: string;
  command: SequenceStep["command"];
  status: CommandStatus;
  ok: boolean;
  startedAt: string;
  endedAt: string;
  dataPreview?: unknown;
  warnings: string[];
};

export type RuntimeEnv = {
  agent?: unknown;
  browser?: BrowserLike;
  page?: PageLike;
  clipboard?: ClipboardLike;
  now?: () => Date;
  expectedTabId?: string;
};

export type ClipboardLike = {
  read: () => Promise<string>;
  waitForChange: (before: string | undefined, timeoutMs: number) => Promise<string | undefined>;
};

export type BrowserLike = {
  name?: string;
  user?: {
    openTabs?: () => Promise<BrowserUserTabInfo[]> | BrowserUserTabInfo[];
    claimTab?: (tab: string | BrowserUserTabInfo) => Promise<PageLike> | PageLike;
  };
  tabs?: {
    create?: (url: string) => Promise<PageLike> | PageLike;
    new?: (url?: string) => Promise<PageLike> | PageLike;
    selected?: () => Promise<PageLike | undefined> | PageLike | undefined;
    list?: () => Promise<PageLike[]> | PageLike[];
    get?: (id: string) => Promise<PageLike> | PageLike;
    finalize?: (options: { keep?: unknown[] }) => Promise<void>;
  };
  newPage?: () => Promise<PageLike> | PageLike;
};

export type BrowserUserTabInfo = {
  id: string;
  lastOpened?: string;
  tabGroup?: string;
  title?: string;
  url?: string;
};

export type LocatorLike = {
  click?: (options?: unknown) => Promise<void>;
  fill?: (value: string, options?: unknown) => Promise<void>;
  textContent?: (options?: unknown) => Promise<string | null>;
  innerText?: (options?: unknown) => Promise<string>;
  innerHTML?: (options?: unknown) => Promise<string>;
  count?: () => Promise<number>;
  nth?: (index: number) => LocatorLike;
  first?: () => LocatorLike;
  last?: () => LocatorLike;
  isVisible?: (options?: unknown) => Promise<boolean>;
  evaluate?: <T>(fn: (element: Element) => T) => Promise<T>;
  locator?: (selector: string) => LocatorLike;
  filter?: (options: Record<string, unknown>) => LocatorLike;
  getByRole?: (role: string, options?: Record<string, unknown>) => LocatorLike;
  getByText?: (text: string | RegExp, options?: Record<string, unknown>) => LocatorLike;
  setInputFiles?: (paths: string[]) => Promise<void>;
};

export type FileChooserLike = {
  isMultiple?: () => boolean | Promise<boolean>;
  setFiles: (paths: string[]) => Promise<void>;
};

export type WaitForEventOptions = {
  timeout?: number;
  timeoutMs?: number;
};

export type PageLike = {
  id?: string;
  tabId?: string;
  url?: () => string | Promise<string>;
  goto?: (url: string, options?: unknown) => Promise<unknown>;
  title?: () => Promise<string>;
  locator?: (selector: string) => LocatorLike;
  getByRole?: (role: string, options?: Record<string, unknown>) => LocatorLike;
  getByPlaceholder?: (text: string | RegExp, options?: Record<string, unknown>) => LocatorLike;
  getByText?: (text: string | RegExp, options?: Record<string, unknown>) => LocatorLike;
  keyboard?: {
    press?: (key: string) => Promise<void>;
  };
  mouse?: {
    move?: (x: number, y: number) => Promise<void> | void;
    click?: (x: number, y: number) => Promise<void> | void;
  };
  cua?: {
    move?: (options: { x: number; y: number }) => Promise<void> | void;
    click?: (options: { x: number; y: number; button?: number }) => Promise<void> | void;
  };
  waitForTimeout?: (ms: number) => Promise<void>;
  waitForEvent?: (event: string, optionsOrCallback?: WaitForEventOptions | unknown) => Promise<unknown>;
  evaluate?: <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => Promise<T>;
  content?: () => Promise<string>;
  close?: () => Promise<void>;
  capabilities?: {
    get?: (id: string) => Promise<unknown> | unknown;
  };
  playwright?: {
    waitForTimeout?: (ms: number) => Promise<void>;
    [key: string]: unknown;
  };
};

export type AskHelperArgs = Omit<AskArgs, "text" | "prompt"> & {
  text: string;
  thread?: ThreadTarget;
};

export type AskInThreadArgs = AskHelperArgs & {
  thread: ThreadTarget;
};

export type SendAndWaitArgs = {
  text: string;
  wait?: WaitArgs;
};

export type PrecannedResponseArgs = AskInThreadArgs & {
  label?: string;
};

export type AttachAskReadArgs = AskInThreadArgs & {
  files: string[];
};

export type SearchOpenCopyArgs = {
  thread: ThreadTarget;
};

export type TwoTurnExchangeArgs = AskInThreadArgs & {
  followupText: string;
};

export type TwoTurnData = {
  first?: AskReadData;
  second?: AskReadData;
};
