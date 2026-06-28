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

// Chooses the single tab that holds the CRM data. The configured tab (e.g.
// "Leads") is preferred when it matches, so auxiliary tabs that happen to share
// some headers (e.g. "CR DATA", "TRANSACTION") are never mixed in. Otherwise the
// best-scoring tab is used, then a configured/first-tab fallback.
export function pickDataTabs(scored = [], options = {}) {
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const configured = options.fallbackTab
    ? scored.find((entry) => normalizeText(entry.title) === normalizeText(options.fallbackTab))
    : null;

  if (configured && configured.score >= threshold) {
    return [configured.title];
  }

  const best = scored
    .filter((entry) => entry.score >= threshold)
    .sort((left, right) => right.score - left.score)[0];
  if (best) {
    return [best.title];
  }

  if (configured) {
    return [configured.title];
  }
  return scored.length > 0 ? [scored[0].title] : [];
}

// Resolves the data tab inside a spreadsheet by scoring each tab's header row
// against the expected CRM columns (preferring the configured tab). Returns
// [{ title, range }] with a single entry.
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
