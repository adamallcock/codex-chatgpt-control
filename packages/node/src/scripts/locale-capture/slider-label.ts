export function cleanCapturedSliderLabel(value: string | undefined): string {
  const label = (value ?? "").replace(/\s+/g, " ").trim();
  if (label.length === 0) return "";

  // Slider descriptions append an ordinal after locale-specific punctuation,
  // for example `Medium, 2 of 5`, `即时，第 2 项，共 5 项`, or
  // `ቅጽበታዊ፣ ከ 5 2ኛ`. The captured option is the text before that
  // separator. This also repairs older records where an ASCII-only ordinal
  // matcher removed the digits but left punctuation and lead-in text.
  const separator = label.search(/[，,،、፣]/u);
  if (separator > 0) return label.slice(0, separator).trim();

  return label.replace(/\s+\p{Nd}.*$/u, "").trim();
}
