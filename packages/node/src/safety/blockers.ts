import type { BlockerKind } from "../types.js";
import { compactVisibleText } from "./redaction.js";

export type ClassifiedBlocker = {
  kind: BlockerKind;
  message: string;
  visibleText?: string;
};

type BlockerRule = {
  kind: BlockerKind;
  message: string;
  patterns: RegExp[];
};

const RULES: BlockerRule[] = [
  {
    kind: "login_required",
    message: "ChatGPT requires the user to sign in before continuing.",
    patterns: [/\blog\s?in\b/i, /\bsign\s?in\b/i, /\bwelcome back\b/i]
  },
  {
    kind: "captcha",
    message: "ChatGPT is showing a captcha or suspicious-activity challenge.",
    patterns: [/\bcaptcha\b/i, /verify (?:you are|that you are) human/i, /suspicious activity/i]
  },
  {
    kind: "rate_limit",
    message: "ChatGPT is rate limited or out of usage for this account.",
    patterns: [/usage limit/i, /rate limit/i, /try again later/i, /too many requests/i]
  },
  {
    kind: "permission",
    message: "File upload permission is required. Ask the user to enable both: Codex Settings > Computer Use > Chrome > Permissions > Uploads, and Chrome chrome://extensions > Codex extension > Details > Allow access to file URLs.",
    patterns: [/allow access to file urls/i, /file upload permission/i, /fileChooser\.setFiles/i]
  },
  {
    kind: "permission",
    message: "A browser or ChatGPT permission is required before continuing.",
    patterns: [/permission denied/i, /browser blocked/i]
  },
  {
    kind: "upload_failed",
    message: "ChatGPT reported a file upload failure.",
    patterns: [/upload failed/i, /could(?: not|n't) upload/i, /unsupported file/i, /file is too large/i]
  },
  {
    kind: "download_unavailable",
    message: "No downloadable file or download control is visible.",
    patterns: [/download unavailable/i, /no download/i]
  },
  {
    kind: "not_found",
    message: "The requested ChatGPT conversation or page was not found.",
    patterns: [/conversation not found/i, /404/i, /page not found/i]
  }
];

export function classifyVisibleText(text: string): ClassifiedBlocker | undefined {
  const visibleText = compactVisibleText(text);
  const lowerable = visibleText.length > 0 ? visibleText : text;

  for (const rule of RULES) {
    // The Work effort picker describes higher effort with this informational
    // copy. It is not an exhausted quota, even on an otherwise empty page.
    // Inspect the full rate-limit text so stripping this copy cannot hide a
    // real notice later in the same surface behind the display-text truncation.
    const candidate = rule.kind === "rate_limit"
      ? text.replace(/\bConsumes\s+usage\s+limits\s+faster\b/gi, "")
      : lowerable;
    if (rule.patterns.some(pattern => pattern.test(candidate))) {
      return { kind: rule.kind, message: rule.message, visibleText };
    }
  }

  if (/\b(confirm|continue|cancel|dismiss)\b/i.test(lowerable) && /\bdialog\b|\bmodal\b/i.test(lowerable)) {
    return {
      kind: "modal",
      message: "ChatGPT is showing a modal dialog that may require user action.",
      visibleText
    };
  }

  return undefined;
}
