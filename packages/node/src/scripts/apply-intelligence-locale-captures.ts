import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readLanguageCoverage } from "./locale-capture/language-coverage.js";

type CaptureRecord = {
  status: "ok" | "blocked";
  requestedLocale: string;
  intelligenceLabels?: string[];
};

type ApplyOptions = {
  input: string;
  reviewed: boolean;
  coveragePath: string;
};

type IntelligenceModeOptionId = "instant" | "medium" | "high" | "extraHigh" | "pro";

const ENGLISH_MODE_LABELS = new Set(["Latest", "Instant", "Thinking", "Extended", "Medium", "High", "Extra High", "Pro"]);
const INTELLIGENCE_MODE_OPTION_IDS: IntelligenceModeOptionId[] = ["instant", "medium", "high", "extraHigh", "pro"];
const ENGLISH_INTELLIGENCE_MODE_OPTIONS: Record<IntelligenceModeOptionId, string> = {
  instant: "Instant",
  medium: "Medium",
  high: "High",
  extraHigh: "Extra High",
  pro: "Pro",
};
const UPDATE_NOTE = " * Intelligence picker labels updated 2026-06-10 from a visible ChatGPT Pro session.";

class ApplyUsageError extends Error {
  constructor(message: string, readonly exitCode = 2) {
    super(message);
    this.name = "ApplyUsageError";
  }
}

const USAGE = [
  "Usage:",
  "  npm run apply:intelligence-locales -- --in ../../outputs/intelligence-locale-captures/2026-06-10-intelligence-picker.jsonl --reviewed",
  "",
  "Options:",
  "  --in             JSONL capture file to apply.",
  "  --reviewed       Required to write locale files.",
  "  --coverage-path  Path to language-coverage.md."
].join("\n");

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let options: ApplyOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof ApplyUsageError) {
      console.log(error.message);
      return error.exitCode;
    }
    throw error;
  }

  const root = packageRoot();
  const languages = await readLanguageCoverage(options.coveragePath);
  const captures = latestSuccessfulCaptures(await readFile(options.input, "utf8"));
  const planned: Array<{
    locale: string;
    file: string;
    labels: string[];
    modeOptions: Partial<Record<IntelligenceModeOptionId, string[]>>;
  }> = [];

  for (const language of languages) {
    if (/^en(?:-|$)/i.test(language.bcp47)) continue;
    const record = captures.get(language.bcp47);
    if (record === undefined) {
      throw new ApplyUsageError(`Missing successful capture for ${language.bcp47}.`, 1);
    }
    const labels = observedNonEnglishLabels(record);
    const modeOptions = observedNonEnglishModeOptions(record);
    if (labels.length === 0 && Object.keys(modeOptions).length === 0) continue;
    planned.push({
      locale: language.bcp47,
      file: resolve(root, "src/dom/locale", `${language.bcp47}.ts`),
      labels,
      modeOptions,
    });
  }

  if (!options.reviewed) {
    for (const change of planned) {
      console.log(`${change.locale.padEnd(8)} ${change.labels.join(" | ")}`);
    }
    console.log(`\nRefusing to write without --reviewed. Planned locale files: ${planned.length}.`);
    return 2;
  }

  for (const change of planned) {
    const before = await readFile(change.file, "utf8");
    const after = mergeModeCapture(before, change.labels, change.modeOptions);
    if (after !== before) {
      await writeFile(change.file, after, "utf8");
      console.log(`updated ${change.locale} labels=${change.labels.length} modeOptions=${Object.keys(change.modeOptions).length}`);
    }
  }

  return 0;
}

function latestSuccessfulCaptures(jsonl: string): Map<string, CaptureRecord> {
  const latest = new Map<string, CaptureRecord>();
  for (const line of jsonl.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const record = JSON.parse(line) as CaptureRecord;
    if (record.status === "ok" && Array.isArray(record.intelligenceLabels)) {
      latest.set(record.requestedLocale, record);
    }
  }
  return latest;
}

function observedNonEnglishLabels(record: CaptureRecord): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const label of record.intelligenceLabels ?? []) {
    if (ENGLISH_MODE_LABELS.has(label) || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function observedNonEnglishModeOptions(record: CaptureRecord): Partial<Record<IntelligenceModeOptionId, string[]>> {
  const labels = record.intelligenceLabels ?? [];
  if (labels.length !== INTELLIGENCE_MODE_OPTION_IDS.length) {
    throw new ApplyUsageError(`${record.requestedLocale} has ${labels.length} Intelligence labels; expected ${INTELLIGENCE_MODE_OPTION_IDS.length}.`, 1);
  }
  const modeOptions: Partial<Record<IntelligenceModeOptionId, string[]>> = {};
  for (let index = 0; index < INTELLIGENCE_MODE_OPTION_IDS.length; index += 1) {
    const id = INTELLIGENCE_MODE_OPTION_IDS[index]!;
    const label = labels[index]!;
    if (label !== ENGLISH_INTELLIGENCE_MODE_OPTIONS[id]) {
      modeOptions[id] = [label];
    }
  }
  return modeOptions;
}

function mergeModeCapture(
  source: string,
  labels: readonly string[],
  modeOptions: Partial<Record<IntelligenceModeOptionId, string[]>>
): string {
  let text = updateComment(source);
  if (labels.length > 0) {
    const existing = parseExistingModeLabels(text);
    const merged = dedupe([...existing, ...labels]);
    const line = `  modeLabels: [${merged.map(label => JSON.stringify(label)).join(", ")}],`;

    if (/^\s*modeLabels:\s*\[[^\]]*\],/m.test(text)) {
      text = text.replace(/^\s*modeLabels:\s*\[[^\]]*\],/m, line);
    } else if (/^\s*copyResponse:\s*.*,\n/m.test(text)) {
      text = text.replace(/^(\s*copyResponse:\s*.*,\n)/m, `$1${line}\n`);
    } else {
      text = text.replace(/^export const \w+ = \{\n/m, match => `${match}${line}\n`);
    }
  }

  return mergeModeOptions(text, modeOptions);
}

function parseExistingModeLabels(source: string): string[] {
  const match = /^\s*modeLabels:\s*\[(?<body>[^\]]*)\],/m.exec(source);
  const body = match?.groups?.body;
  if (body === undefined) return [];
  const labels: string[] = [];
  for (const stringMatch of body.matchAll(/"((?:\\"|[^"])*)"/g)) {
    labels.push(JSON.parse(`"${stringMatch[1]}"`) as string);
  }
  return labels;
}

function mergeModeOptions(
  source: string,
  modeOptions: Partial<Record<IntelligenceModeOptionId, string[]>>
): string {
  const existing = parseExistingModeOptions(source);
  const merged: Partial<Record<IntelligenceModeOptionId, string[]>> = {};
  for (const id of INTELLIGENCE_MODE_OPTION_IDS) {
    const values = dedupe([...(existing[id] ?? []), ...(modeOptions[id] ?? [])]);
    if (values.length > 0) {
      merged[id] = values;
    }
  }
  const block = formatModeOptions(merged);
  if (block === undefined) {
    return source;
  }
  if (/^\s*modeOptions:\s*\{[\s\S]*?^\s*\},\n/m.test(source)) {
    return source.replace(/^\s*modeOptions:\s*\{[\s\S]*?^\s*\},\n/m, `${block}\n`);
  }
  if (/^\s*modeLabels:\s*\[[^\]]*\],\n/m.test(source)) {
    return source.replace(/^(\s*modeLabels:\s*\[[^\]]*\],\n)/m, `$1${block}\n`);
  }
  return source.replace(/^export const \w+ = \{\n/m, match => `${match}${block}\n`);
}

function parseExistingModeOptions(source: string): Partial<Record<IntelligenceModeOptionId, string[]>> {
  const options: Partial<Record<IntelligenceModeOptionId, string[]>> = {};
  const blockMatch = /^\s*modeOptions:\s*\{(?<body>[\s\S]*?)^\s*\},/m.exec(source);
  const body = blockMatch?.groups?.body;
  if (body === undefined) return options;
  for (const id of INTELLIGENCE_MODE_OPTION_IDS) {
    const lineMatch = new RegExp(`^\\s*${id}:\\s*\\[(?<body>[^\\]]*)\\],`, "m").exec(body);
    const lineBody = lineMatch?.groups?.body;
    if (lineBody === undefined) continue;
    const values: string[] = [];
    for (const stringMatch of lineBody.matchAll(/"((?:\\"|[^"])*)"/g)) {
      values.push(JSON.parse(`"${stringMatch[1]}"`) as string);
    }
    if (values.length > 0) {
      options[id] = values;
    }
  }
  return options;
}

function formatModeOptions(modeOptions: Partial<Record<IntelligenceModeOptionId, string[]>>): string | undefined {
  const lines = INTELLIGENCE_MODE_OPTION_IDS
    .map(id => {
      const values = modeOptions[id];
      return values === undefined || values.length === 0
        ? undefined
        : `    ${id}: [${values.map(value => JSON.stringify(value)).join(", ")}],`;
    })
    .filter((line): line is string => line !== undefined);
  if (lines.length === 0) {
    return undefined;
  }
  return ["  modeOptions: {", ...lines, "  },"].join("\n");
}

function updateComment(source: string): string {
  let text = source.replace(
    /\n \* Omitted because they match English case-insensitively: `modeLabels`[\s\S]*?blocker copy\.\n/g,
    "\n * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.\n"
  );
  if (!text.includes(UPDATE_NOTE)) {
    text = text.replace(/\n \*\//, `\n *\n${UPDATE_NOTE}\n */`);
  }
  return text;
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parseArgs(argv: readonly string[]): ApplyOptions {
  let input: string | undefined;
  let reviewed = false;
  let coveragePath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--help":
      case "-h":
        throw new ApplyUsageError(USAGE, 0);
      case "--in":
        input = requiredValue(argv, ++index, arg);
        break;
      case "--reviewed":
        reviewed = true;
        break;
      case "--coverage-path":
        coveragePath = requiredValue(argv, ++index, arg);
        break;
      default:
        throw new ApplyUsageError(`Unknown option: ${arg}\n\n${USAGE}`);
    }
  }
  if (input === undefined) {
    throw new ApplyUsageError(`--in is required.\n\n${USAGE}`);
  }
  const root = packageRoot();
  return {
    input: resolve(root, input),
    reviewed,
    coveragePath: resolve(root, coveragePath ?? "references/language-coverage.md"),
  };
}

function requiredValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new ApplyUsageError(`${flag} requires a value.\n\n${USAGE}`);
  }
  return value;
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
