import { getFieldName, getRowValue, isPresent, parseDateValue } from "./calculations.js";

export function derivePeriod(...values) {
  for (const value of values) {
    const date = parseDateValue(value);
    if (date) {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      return `${year}-${month}`;
    }
  }
  return null;
}

// Prepares a sheet row for storage. The row is kept header-keyed (exactly what
// the KPI calculations expect from Google Sheets). The only normalization is:
//   * backfill the Office column from the source meta when the sheet omits it,
//     so per-office reports work even if a sheet does not repeat the office.
function prepareRow(row, tabConfig, meta) {
  const officeField = getFieldName(tabConfig, "office");
  if (meta.office && officeField && !isPresent(getRowValue(row, officeField))) {
    return { ...row, [officeField]: meta.office };
  }
  return row;
}

// Maps a batch of sheet rows for storage, dropping rows without an ID (the
// calculations ignore them anyway).
export function prepareRowsForStore(rows = [], tabConfig, meta = {}) {
  const idField = getFieldName(tabConfig, "id");
  const prepared = [];
  for (const row of rows) {
    if (!isPresent(getRowValue(row, idField))) {
      continue;
    }
    prepared.push(prepareRow(row, tabConfig, meta));
  }
  return prepared;
}
