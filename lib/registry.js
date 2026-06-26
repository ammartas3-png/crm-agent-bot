import { getAuthorityConfig } from "../config/sheetsConfig.js";
import { parseMonth } from "./calculations.js";
import { readSheetValues } from "./googleSheets.js";

export function officeSlug(office) {
  return String(office || "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// "January 26" / "Jan 2026" / "March 26" -> { period: "2026-01", month, year }.
export function parseMonthLabel(label) {
  const text = String(label || "").trim();
  if (!text) {
    return null;
  }
  const month = parseMonth(text);
  if (month === null) {
    return null;
  }
  let year = null;
  const fourDigit = text.match(/\b(\d{4})\b/);
  if (fourDigit) {
    year = Number(fourDigit[1]);
  } else {
    const twoDigit = text.match(/\b(\d{2})\b/);
    if (twoDigit) {
      year = 2000 + Number(twoDigit[1]);
    }
  }
  if (!year) {
    return null;
  }
  return {
    period: `${year}-${String(month + 1).padStart(2, "0")}`,
    month,
    year,
  };
}

// Accepts a full Google Sheets URL or a bare spreadsheet ID.
export function parseSpreadsheetId(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }
  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) {
    return text;
  }
  return null;
}

// Parses the Offices tab grid:
//   row 0  -> [ "Office", "January 26", "February 26", "March 26", ... ]
//   row N  -> [ "Turkiye Office", "<spreadsheetId>", "", "<spreadsheetId>", ... ]
// Every non-empty cell under a parseable month column becomes one source.
export function parseOfficeSourcesFromValues(values = [], options = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  const header = values[0] || [];
  const dataRows = values.slice(1);
  const periods = header.map((label, index) => (index === 0 ? null : parseMonthLabel(label)));
  const category = options.category || "leads";

  const sources = [];
  for (const row of dataRows) {
    const office = String(row[0] || "").trim();
    if (!office) {
      continue;
    }
    for (let col = 1; col < header.length; col += 1) {
      const period = periods[col];
      if (!period) {
        continue;
      }
      const spreadsheetId = parseSpreadsheetId(row[col]);
      if (!spreadsheetId) {
        continue;
      }
      sources.push({
        office,
        period: period.period,
        monthLabel: String(header[col] || "").trim(),
        spreadsheetId,
        sheetName: options.dataTab || null,
        range: options.dataRange || null,
        category,
        sourceKey: `${officeSlug(office)}:${period.period}:${category}`,
      });
    }
  }
  return sources;
}

// Parses the users tab into principals (numeric IDs or @usernames). The first
// row is skipped when it looks like a header.
export function parseUsersFromValues(values = []) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  const [firstRow = [], ...rest] = values;
  const firstIsHeader = firstRow.some((cell) =>
    /\b(user|username|name|id|telegram)\b/i.test(String(cell || "")),
  );
  const rows = firstIsHeader ? rest : values;

  const principals = new Set();
  for (const row of rows) {
    for (const cell of row) {
      const value = String(cell ?? "").trim();
      if (value) {
        principals.add(value);
      }
    }
  }
  return [...principals];
}

export async function readOfficeSources(options = {}) {
  const cfg = options.authorityConfig || getAuthorityConfig();
  const values = await readSheetValues(cfg.spreadsheetId, cfg.officesRange, options);
  return parseOfficeSourcesFromValues(values, {
    dataTab: cfg.dataTab,
    dataRange: cfg.dataRange,
    category: options.category || "leads",
  });
}

export async function readAuthorizedUsers(options = {}) {
  const cfg = options.authorityConfig || getAuthorityConfig();
  const values = await readSheetValues(cfg.spreadsheetId, cfg.usersRange, options);
  return parseUsersFromValues(values);
}
