import { normalizeText } from "./calculations.js";
import { getSheetTitles, readSheetValues } from "./googleSheets.js";
import { quoteSheetName } from "../config/sheetsConfig.js";

const DEFAULT_MATCH_THRESHOLD = 3;

// How many of the expected CRM columns appear in a tab's header row.
export function scoreHeaderMatch(headerRow = [], expectedColumns = []) {
  const expected = new Set(
    expectedColumns.filter(Boolean).map((column) => normalizeText(column)),
  );
  let score = 0;
  const seen = new Set();
  for (const cell of headerRow) {
    const key = normalizeText(cell);
    if (key && expected.has(key) && !seen.has(key)) {
      seen.add(key);
      score += 1;
    }
  }
  return score;
}

// Chooses which tabs hold CRM data. Returns every tab whose header matches well
// enough (so a file can hold more than one data tab); otherwise falls back to a
// configured tab name or the first tab.
export function pickDataTabs(scored = [], options = {}) {
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const matching = scored
    .filter((entry) => entry.score >= threshold)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.title);
  if (matching.length > 0) {
    return matching;
  }
  if (options.fallbackTab) {
    const fallback = scored.find(
      (entry) => normalizeText(entry.title) === normalizeText(options.fallbackTab),
    );
    if (fallback) {
      return [fallback.title];
    }
  }
  return scored.length > 0 ? [scored[0].title] : [];
}

// Resolves the data tab(s) inside a spreadsheet by scoring each tab's header row
// against the expected CRM columns. Returns [{ title, range }].
export async function resolveDataTabs(spreadsheetId, tabConfig, options = {}) {
  const titles = await getSheetTitles(spreadsheetId, options);
  const scored = [];
  for (const title of titles) {
    let header = [];
    try {
      const values = await readSheetValues(
        spreadsheetId,
        `${quoteSheetName(title)}!A1:AZ1`,
        options,
      );
      header = values[0] || [];
    } catch {
      header = [];
    }
    scored.push({ title, score: scoreHeaderMatch(header, tabConfig.columns) });
  }

  const columnsSpec = options.columnsSpec || "A:Y";
  return pickDataTabs(scored, {
    threshold: options.threshold,
    fallbackTab: options.fallbackTab,
  }).map((title) => ({
    title,
    range: `${quoteSheetName(title)}!${columnsSpec}`,
  }));
}
