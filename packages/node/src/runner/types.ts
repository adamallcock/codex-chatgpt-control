import type {
  AttachedFile,
  CommandResult,
  CommandStatus,
  CopyResponseArgs,
  DownloadLatestArgs,
  BootstrapArgs,
  ReadLatestArgs,
  ResponseCaptureFidelity,
  ResponseCaptureSource,
  ResponseFormat,
  SequencePlan,
  SelectToolArgs,
  SetModeArgs,
  ThreadTarget,
  WaitArgs
} from "../types.js";
import type { RunReportOptions } from "../commands/reports.js";
import type { UntrustedOutputReturnEnvelope } from "../safety/untrusted-output.js";
import type { ChatGPTRunStream } from "./stream.js";

export type ChatGPTThreadSelector =
  | { type: "new" }
  | { type: "current" }
  | { type: "url"; url: string }
  | { type: "conversationId"; conversationId: string }
  | { type: "conversation_id"; conversationId: string }
  | { type: "search"; query: string; select?: "first" | { index: number } | { title: string }; limit?: number }
  | { type: "title"; title: string };

export type ChatGPTAttachmentInput = {
  path: string;
  description?: string;
  sensitivity?: "normal" | "sensitive" | "highly_sensitive";
};

export type ChatGPTResponseReadOptions = ReadLatestArgs;

export type ChatGPTVisibleModePreference = SetModeArgs & {
  required?: boolean;
  ifUnavailable?: "continue" | "block" | "skip";
};

export type ChatGPTVisibleToolPreference = SelectToolArgs & {
  required?: boolean;
  ifUnavailable?: "continue" | "block" | "skip";
};

export type ChatGPTRunDefaults = {
  thread?: ChatGPTThreadSelector | ThreadTarget;
  existingTab?: BootstrapArgs["existingTab"];
  preferExistingTab?: boolean;
  mode?: ChatGPTVisibleModePreference;
  wait?: boolean | WaitArgs;
  read?: boolean | ReadLatestArgs;
  report?: boolean | RunReportOptions;
};

export type ChatGPTOutputSpec<TOutput = string> = {
  parse?: "text" | "json";
  onParseError?: "return_text" | "unsupported" | "error";
  sample?: TOutput;
};

export type ChatGPTBrowserTool = {
  name: string;
  command: string;
  risk?: "low" | "medium" | "high";
};

export type ChatGPTGuardrail = {
  name: string;
  scope: "input" | "plan" | "step" | "output" | "report";
};

export type ChatGPTAgentConfig<TOutput = string> = {
  name: string;
  instructions?: string;
  instructionsMode?: "visible_prefix" | "visible_setup_message" | "metadata_only";
  defaults?: Partial<ChatGPTRunDefaults>;
  tools?: ChatGPTBrowserTool[];
  guardrails?: ChatGPTGuardrail[];
  output?: ChatGPTOutputSpec<TOutput>;
  metadata?: Record<string, unknown>;
};

export type ChatGPTAgent<TOutput = string> = {
  readonly kind: "chatgpt_browser_agent";
  readonly name: string;
  readonly instructions?: string;
  readonly instructionsMode: "visible_prefix" | "visible_setup_message" | "metadata_only";
  readonly defaults: Partial<ChatGPTRunDefaults>;
  readonly tools: ChatGPTBrowserTool[];
  readonly guardrails: ChatGPTGuardrail[];
  readonly output?: ChatGPTOutputSpec<TOutput>;
  readonly metadata?: Record<string, unknown>;
};

export type ChatGPTInputItem =
  | { type: "input_text"; text: string; role?: "user" }
  | { type: "input_file"; path: string; description?: string }
  | { type: "visible_instruction"; text: string };

export type ChatGPTRunInput =
  | string
  | {
      input: string | ChatGPTInputItem[];
      thread?: ChatGPTThreadSelector;
      existingTab?: BootstrapArgs["existingTab"];
      preferExistingTab?: boolean;
      attachments?: ChatGPTAttachmentInput[];
      mode?: ChatGPTVisibleModePreference;
      tools?: ChatGPTVisibleToolPreference[];
      response?: ChatGPTResponseReadOptions;
      download?: DownloadLatestArgs | false;
      copy?: CopyResponseArgs | false;
      report?: boolean | RunReportOptions;
      metadata?: Record<string, unknown>;
    };

export type ChatGPTThreadRef = {
  url?: string;
  conversationId?: string;
  title?: string;
};

export type AttachedFileSummary = Pick<AttachedFile, "path" | "name" | "bytes">;

export type DownloadedFileSummary = {
  path: string;
  suggestedFilename?: string;
  bytes: number;
};

export type ChatGPTRunItem =
  | { type: "thread.opened"; thread: ChatGPTThreadRef }
  | { type: "mode.selected"; requested?: string; selected?: string; candidates?: string[] }
  | { type: "tool.selected"; requested: string; selected?: string; candidates?: string[] }
  | { type: "file.attached"; file: AttachedFileSummary }
  | { type: "message.submitted"; role: "user"; preview: string; redacted: boolean }
  | { type: "message.completed"; role: "assistant"; output_text?: string; format: ResponseFormat; source?: ResponseCaptureSource; fidelity?: ResponseCaptureFidelity }
  | { type: "file.downloaded"; file: DownloadedFileSummary }
  | { type: "approval.required"; interruption: ChatGPTInterruption }
  | { type: "run.blocked"; blocker: ChatGPTCommandBlocker };

export type RemediationStep = {
  label: string;
  instruction: string;
  userActionRequired: boolean;
};

export type VisibleCandidate = {
  label: string;
  role?: string;
};

export type ChatGPTCommandBlocker = NonNullable<CommandResult["blocker"]> & {
  code?: string;
  fieldPath?: string;
  remediation?: RemediationStep[];
  candidates?: VisibleCandidate[];
  resumable?: boolean;
};

export type ChatGPTInterruption = {
  id: string;
  type:
    | "approval_required"
    | "permission_required"
    | "login_required"
    | "selector_drift"
    | "rate_limit"
    | "captcha"
    | "unsupported"
    | "timeout";
  status: CommandStatus;
  blocker?: ChatGPTCommandBlocker;
  command?: string;
  fieldPath?: string;
  message: string;
  fix?: { summary: string; steps: string[] };
  resume: { supported: boolean; stateId?: string; reason?: string };
};

export type ChatGPTInterruptionDecision =
  | { id: string; decision: "approve"; confirm: ChatGPTConfirmation }
  | { id: string; decision: "reject"; message?: string };

export type ChatGPTConfirmation = {
  targetKind:
    | "file_upload"
    | "download"
    | "thread"
    | "shared_link"
    | "third_party_app"
    | "account_setting"
    | "workspace_setting"
    | "external_action"
    | "quota_consuming_tool";
  targetDisplayName: string;
  action: string;
  risks?: string[];
  understood: true;
};

export type ChatGPTRunState = {
  id: string;
  resumable: boolean;
  thread?: ChatGPTThreadRef;
  nextStepId?: string;
};

export type ChatGPTRunData<TOutput = string> = {
  finalOutput?: TOutput;
  outputText: string;
  untrustedOutput?: UntrustedOutputReturnEnvelope;
  thread?: ChatGPTThreadRef;
  downloads?: DownloadedFileSummary[];
  reportPath?: string;
};

export type ChatGPTRunResult<TOutput = string> = CommandResult<ChatGPTRunData<TOutput>> & {
  finalOutput?: TOutput;
  output_text: string;
  output: ChatGPTRunItem[];
  newItems: ChatGPTRunItem[];
  interruptions: ChatGPTInterruption[];
  state: ChatGPTRunState;
  activeAgentName: string;
  lastAgentName: string;
};

export type ChatGPTRunner = {
  run<TOutput = string>(
    agent: ChatGPTAgent<TOutput>,
    input: ChatGPTRunInput,
    options: { stream: true }
  ): ChatGPTRunStream<TOutput>;
  run<TOutput = string>(
    agent: ChatGPTAgent<TOutput>,
    input: ChatGPTRunInput,
    options?: { stream?: false }
  ): Promise<ChatGPTRunResult<TOutput>>;
  plan<TOutput = string>(agent: ChatGPTAgent<TOutput>, input: ChatGPTRunInput): SequencePlan;
};

export type ChatGPTResponse = {
  id: string;
  object: "chatgpt.browser.response";
  created_at: number;
  status: CommandStatus;
  output_text: string;
  output: ChatGPTRunItem[];
  browser_control: {
    visibleUi: true;
    resultStatus: CommandStatus;
    thread?: ChatGPTThreadRef;
    reportPath?: string;
    untrustedOutput?: UntrustedOutputReturnEnvelope;
    unsupported?: UnsupportedField[];
  };
};

export type UnsupportedField = {
  path: string;
  reason: string;
  alternative?: string;
};
