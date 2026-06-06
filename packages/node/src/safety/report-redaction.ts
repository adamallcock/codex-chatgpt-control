import { compactVisibleText, redactSensitiveText } from "./redaction.js";

export type ReportRedactionOptions = {
  includeContent?: boolean;
  maxPreviewChars?: number;
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectEntries?: number;
};

const DEFAULT_MAX_PREVIEW_CHARS = 240;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ARRAY_ITEMS = 40;
const DEFAULT_MAX_OBJECT_ENTRIES = 80;

export function redactReportValue(value: unknown, options: ReportRedactionOptions = {}): unknown {
  return redactValue(value, normalizeOptions(options), 0, new WeakSet<object>(), undefined);
}

function redactValue(
  value: unknown,
  options: Required<ReportRedactionOptions>,
  depth: number,
  seen: WeakSet<object>,
  key: string | undefined
): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") {
    if (!options.includeContent && key !== undefined && isSafeControlStringKey(key)) {
      return value;
    }
    if (!options.includeContent) return `[redacted:${value.length} chars]`;
    return compactVisibleText(redactSensitiveText(value), options.maxPreviewChars);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return redactSensitiveText(String(value));

  if (seen.has(value)) return "[redacted:cycle]";
  if (depth >= options.maxDepth) return "[redacted:max-depth]";
  if (!options.includeContent && key !== undefined && isHeavyContentKey(key)) {
    return summarizeHeavyValue(value);
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, options.maxArrayItems)
        .map(item => redactValue(item, options, depth + 1, seen, key));
      if (value.length > options.maxArrayItems) {
        items.push(`[redacted:${value.length - options.maxArrayItems} more items]`);
      }
      return items;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const kept = entries.slice(0, options.maxObjectEntries).map(([childKey, child]) => [
      childKey,
      redactValue(child, options, depth + 1, seen, childKey)
    ]);
    if (entries.length > options.maxObjectEntries) {
      kept.push(["__redactedMoreEntries", entries.length - options.maxObjectEntries]);
    }
    return Object.fromEntries(kept);
  } finally {
    seen.delete(value);
  }
}

function normalizeOptions(options: ReportRedactionOptions): Required<ReportRedactionOptions> {
  return {
    includeContent: options.includeContent === true,
    maxPreviewChars: options.maxPreviewChars ?? DEFAULT_MAX_PREVIEW_CHARS,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxArrayItems: options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS,
    maxObjectEntries: options.maxObjectEntries ?? DEFAULT_MAX_OBJECT_ENTRIES
  };
}

function isHeavyContentKey(key: string): boolean {
  return /^(text|markdown|html|visibleText|normalizedText|responseText|output_text|outputText|finalOutput|prompt|blocks|tables|codeBlocks|dataPreview)$/i.test(key);
}

function summarizeHeavyValue(value: object): string {
  if (Array.isArray(value)) return `[redacted-array:${value.length} items]`;
  return "[redacted-object]";
}

function isSafeControlStringKey(key: string): boolean {
  return /^(schemaVersion|status|startedAt|endedAt|createdAt|timestamp|requiredFailures)$/i.test(key);
}
