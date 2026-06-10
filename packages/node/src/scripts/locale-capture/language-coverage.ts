import { readFile } from "node:fs/promises";

export type CoverageLanguage = {
  language: string;
  nativeName: string;
  bcp47: string;
  speakers: string;
  status: string;
};

const TABLE_ROW_PATTERNS = [
  /^\|\s*[^|]+?\s*\|\s*(?<language>[^|]+?)\s*\|\s*(?<native>[^|]+?)\s*\|\s*`(?<bcp47>[^`]+)`\s*\|\s*(?<speakers>[^|]+?)\s*\|\s*(?<status>[^|]+?)\s*\|/,
  /^\|\s*(?<language>[^|]+?)\s*\|\s*(?<native>[^|]+?)\s*\|\s*`(?<bcp47>[^`]+)`\s*\|\s*(?<speakers>[^|]+?)\s*\|\s*(?<status>[^|]+?)\s*\|/,
];

export function parseLanguageCoverageMarkdown(markdown: string): CoverageLanguage[] {
  const seen = new Set<string>();
  const languages: CoverageLanguage[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const match = TABLE_ROW_PATTERNS.map(pattern => pattern.exec(line)).find(Boolean);
    const groups = match?.groups;
    if (groups === undefined) continue;

    const bcp47 = groups.bcp47?.trim();
    if (bcp47 === undefined || bcp47.length === 0 || seen.has(bcp47)) continue;

    const language = groups.language?.trim();
    const nativeName = groups.native?.trim();
    const speakers = groups.speakers?.trim();
    const status = groups.status?.trim();
    if (
      language === undefined
      || nativeName === undefined
      || speakers === undefined
      || status === undefined
      || language.length === 0
      || nativeName.length === 0
    ) {
      continue;
    }

    seen.add(bcp47);
    languages.push({ language, nativeName, bcp47, speakers, status });
  }

  return languages;
}

export async function readLanguageCoverage(path: string): Promise<CoverageLanguage[]> {
  return parseLanguageCoverageMarkdown(await readFile(path, "utf8"));
}

export function nonEnglishLanguages(languages: readonly CoverageLanguage[]): CoverageLanguage[] {
  return languages.filter(language => !/^en(?:-|$)/i.test(language.bcp47));
}
