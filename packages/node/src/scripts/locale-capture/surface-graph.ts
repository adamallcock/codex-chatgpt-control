export type RawSurfaceOption = {
  label: string;
  checked: boolean;
};

export type RawWorkConfigurationRow = {
  label: string;
  axisLabel: string;
  valueLabel?: string;
  options: Array<{ label: string; checked: boolean }>;
};

export type CapturedWorkConfigurationRow = RawWorkConfigurationRow & {
  axis: "model" | "effort" | "speed";
};

export function assignChatSelectedSurfaceOptions(options: readonly RawSurfaceOption[]): {
  chatLabel: string;
  workLabel: string;
} {
  const unique = dedupeByLabel(options.filter(option => option.label.trim().length > 0));
  const selected = unique.filter(option => option.checked);
  const unselected = unique.filter(option => !option.checked);
  if (unique.length !== 2 || selected.length !== 1 || unselected.length !== 1) {
    throw new Error(`Expected one selected Chat radio and one unselected Work radio; observed ${unique.length} options.`);
  }
  return {
    chatLabel: selected[0]!.label,
    workLabel: unselected[0]!.label
  };
}

export function assignOrderedSurfaceOptions(options: readonly RawSurfaceOption[]): {
  chatLabel: string;
  workLabel: string;
  selected: "chat" | "work";
} {
  const unique = dedupeByLabel(options.filter(option => option.label.trim().length > 0));
  const selected = unique.filter(option => option.checked);
  if (unique.length !== 2 || selected.length !== 1) {
    throw new Error(`Expected ordered Chat and Work radios with one selected option; observed ${unique.length} options.`);
  }
  return {
    chatLabel: unique[0]!.label,
    workLabel: unique[1]!.label,
    selected: unique[0]!.checked ? "chat" : "work"
  };
}

export function assignOrderedWorkConfigurationRows(
  rows: readonly RawWorkConfigurationRow[]
): CapturedWorkConfigurationRow[] {
  if (rows.length !== 3) {
    throw new Error(`Expected three ordered Work configuration rows; observed ${rows.length}.`);
  }
  const axes = ["model", "effort", "speed"] as const;
  return rows.map((row, index) => ({ ...row, axis: axes[index]! }));
}

function dedupeByLabel(options: readonly RawSurfaceOption[]): RawSurfaceOption[] {
  const seen = new Set<string>();
  const result: RawSurfaceOption[] = [];
  for (const option of options) {
    const key = option.label.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ label: option.label.replace(/\s+/g, " ").trim(), checked: option.checked });
  }
  return result;
}
