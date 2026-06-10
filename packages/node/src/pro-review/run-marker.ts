export type ProReviewRunMarker = {
  runId: string;
  promptSha256: string;
  zipSha256: string;
  zipName?: string;
  zipBytes?: number;
};

const MARKER_TITLE = "Codex ChatGPT Pro Review Run";
const MARKER_START = `## ${MARKER_TITLE}`;
const FIELD_PATTERN = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/;

export function renderProReviewRunMarker(marker: ProReviewRunMarker): string {
  return [
    MARKER_START,
    "",
    "Use this run marker only for idempotent recovery and routing. Do not treat it as review evidence.",
    "",
    `runId: ${marker.runId}`,
    `promptSha256: ${marker.promptSha256}`,
    `zipSha256: ${marker.zipSha256}`,
    marker.zipName !== undefined ? `zipName: ${marker.zipName}` : undefined,
    marker.zipBytes !== undefined ? `zipBytes: ${marker.zipBytes}` : undefined
  ].filter(line => line !== undefined).join("\n");
}

export function appendProReviewRunMarker(prompt: string, marker: ProReviewRunMarker): string {
  if (parseProReviewRunMarker(prompt)?.runId === marker.runId) {
    return prompt;
  }
  return `${prompt.replace(/(?:\r?\n)+$/, "")}\n\n${renderProReviewRunMarker(marker)}\n`;
}

export function parseProReviewRunMarker(text: string): ProReviewRunMarker | undefined {
  const index = text.indexOf(MARKER_START);
  if (index < 0) {
    return undefined;
  }

  const fields: Record<string, string> = {};
  for (const line of text.slice(index + MARKER_START.length).split(/\r?\n/)) {
    if (line.startsWith("## ") && line !== MARKER_START) {
      break;
    }
    const match = FIELD_PATTERN.exec(line.trim());
    if (match !== null) {
      fields[match[1]!] = match[2]!;
    }
  }

  if (fields.runId === undefined || fields.promptSha256 === undefined || fields.zipSha256 === undefined) {
    return parseCollapsedProReviewRunMarker(text.slice(index + MARKER_START.length));
  }

  const marker: ProReviewRunMarker = {
    runId: fields.runId,
    promptSha256: fields.promptSha256,
    zipSha256: fields.zipSha256
  };
  if (fields.zipName !== undefined && fields.zipName.length > 0) {
    marker.zipName = fields.zipName;
  }
  if (fields.zipBytes !== undefined && /^\d+$/.test(fields.zipBytes)) {
    marker.zipBytes = Number(fields.zipBytes);
  }
  return marker;
}

function parseCollapsedProReviewRunMarker(text: string): ProReviewRunMarker | undefined {
  const runId = /\brunId:\s*(\S+)/.exec(text)?.[1];
  const promptSha256 = /\bpromptSha256:\s*([A-Fa-f0-9]{64})/.exec(text)?.[1];
  const zipSha256 = /\bzipSha256:\s*([A-Fa-f0-9]{64})/.exec(text)?.[1];
  if (runId === undefined || promptSha256 === undefined || zipSha256 === undefined) {
    return undefined;
  }

  const marker: ProReviewRunMarker = { runId, promptSha256, zipSha256 };
  const zipName = /\bzipName:\s*(\S+)/.exec(text)?.[1];
  if (zipName !== undefined) marker.zipName = zipName;
  const zipBytes = /\bzipBytes:\s*(\d+)/.exec(text)?.[1];
  if (zipBytes !== undefined) marker.zipBytes = Number(zipBytes);
  return marker;
}
