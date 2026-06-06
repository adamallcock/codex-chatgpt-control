export type CommandStatus =
  | "ok"
  | "partial"
  | "timeout"
  | "blocked"
  | "needs_confirmation"
  | "not_found"
  | "unsupported"
  | "error";

export type BlockerKind =
  | "browser_bridge_unavailable"
  | "login_required"
  | "captcha"
  | "rate_limit"
  | "modal"
  | "permission"
  | "confirmation"
  | "selector_drift"
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
  browserName?: string;
  tabId?: string;
  timestamp: string;
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
};

export type WaitArgs = {
  afterTurnCount?: number;
  afterAssistantTurnCount?: number;
  afterStep?: string;
  timeoutMs?: number;
  stableMs?: number;
  pollMs?: number;
  mode?: "normal" | "deep_research";
};

export type WaitData = {
  complete: boolean;
  responseText?: string;
  assistantTurnCount: number;
  elapsedMs: number;
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
};

export type WaitAndReadArgs = WaitArgs & ReadLatestArgs;

export type AskArgs = {
  text: string;
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
};

export type AttachFilesArgs = {
  paths: string[];
  timeoutMs?: number;
};

export type AttachedFile = {
  path: string;
  name: string;
  bytes: number;
};

export type AttachFilesData = {
  files: AttachedFile[];
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
  timeoutMs?: number;
};

export type SelectToolArgs = {
  tool: "web_search" | "deep_research" | "create_image" | string;
  timeoutMs?: number;
};

export type SequenceStep =
  | { id: string; command: "session.bootstrap"; args?: BootstrapArgs }
  | { id: string; command: "threads.search"; args: SearchThreadsArgs }
  | { id: string; command: "threads.open"; args: OpenThreadArgs }
  | { id: string; command: "threads.new"; args?: NewThreadArgs }
  | { id: string; command: "messages.compose"; args: ComposeArgs }
  | { id: string; command: "messages.submit"; args?: SubmitArgs }
  | { id: string; command: "messages.ask"; args: AskArgs }
  | { id: string; command: "messages.wait"; args: WaitArgs }
  | { id: string; command: "messages.readLatest"; args?: ReadLatestArgs }
  | { id: string; command: "messages.waitAndRead"; args: WaitAndReadArgs }
  | { id: string; command: "files.attach"; args: AttachFilesArgs }
  | { id: string; command: "files.downloadLatest"; args: DownloadLatestArgs }
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
    new?: (url: string) => Promise<PageLike> | PageLike;
    selected?: () => Promise<PageLike | undefined> | PageLike | undefined;
    list?: () => Promise<PageLike[]> | PageLike[];
    get?: (id: string) => Promise<PageLike> | PageLike;
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
  waitForTimeout?: (ms: number) => Promise<void>;
  waitForEvent?: (event: string, optionsOrCallback?: WaitForEventOptions | unknown) => Promise<unknown>;
  evaluate?: <T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A) => Promise<T>;
  content?: () => Promise<string>;
};

export type AskHelperArgs = AskArgs & {
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
