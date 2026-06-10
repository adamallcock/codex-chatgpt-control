export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function normalizePromptForHash(text: string): string {
  return normalizeLineBreaks(text)
    .split("\n")
    .map(line => line.replace(/[ \t]+$/g, ""))
    .filter(line => line.trim().length > 0)
    .join("\n");
}

export function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

export function stripTags(html: string): string {
  return normalizeWhitespace(
    decodeBasicEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<button[\s\S]*?<\/button>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

export function normalizeLabel(text: string): string {
  return normalizeWhitespace(text).toLowerCase();
}
