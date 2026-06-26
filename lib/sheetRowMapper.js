import { getFieldName, getRowValue, isPresent, parseDateValue } from "./calculations.js";

function toIso(value) {
  const date = parseDateValue(value);
  return date ? date.toISOString() : null;
}

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

// Converts a header-keyed sheet row into a persistable record. The original row
// is preserved verbatim in `data` so the KPI calculations operate on exactly the
// same shape they get from Google Sheets; only the index/filter columns are
// extracted here.
export function mapSheetRowToRecord(row, tabConfig, meta = {}) {
  const fields = tabConfig.fields || {};
  const leadId = getRowValue(row, getFieldName(tabConfig, "id"));
  const country = String(getRowValue(row, fields.country) || "").trim() || null;
  const sheetOffice = String(getRowValue(row, fields.office) || "").trim();
  const office = String(meta.office || sheetOffice || "").trim() || null;
  const leadDateIso = toIso(getRowValue(row, fields.leadDate));
  const ftdDateIso = toIso(getRowValue(row, fields.ftdDate));
  const createdIso = toIso(getRowValue(row, fields.created));
  const period =
    String(meta.period || "").trim() ||
    derivePeriod(
      getRowValue(row, fields.leadDate),
      getRowValue(row, fields.created),
      getRowValue(row, fields.ftdDate),
    );

  return {
    sourceKey: meta.sourceKey || null,
    office,
    period: period || null,
    leadId: isPresent(leadId) ? String(leadId).trim() : null,
    country,
    leadDate: leadDateIso,
    ftdDate: ftdDateIso,
    created: createdIso,
    data: row,
  };
}

// Maps and filters a batch of sheet rows. Rows without an ID are dropped because
// the calculations ignore them anyway, keeping the table clean.
export function mapSheetRowsToRecords(rows = [], tabConfig, meta = {}) {
  const records = [];
  for (const row of rows) {
    const record = mapSheetRowToRecord(row, tabConfig, meta);
    if (record.leadId) {
      records.push(record);
    }
  }
  return records;
}
