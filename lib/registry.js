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

// Keeps only the sources whose period is among the most recent N distinct
// months. Used to bound the synced dataset (and KV storage) so it does not grow
// with history: only the current window is cached, older months fall back to
// live Google Sheets reads on demand.
export function resolveRecentMonthsLimit(explicitValue, env = process.env) {
  const normalized = String(explicitValue ?? "").trim();
  if (normalized === "0") {
    return 0;
  }
  if (normalized) {
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const fromEnv = Number(env.REDIS_RECENT_MONTHS ?? env.RECENT_MONTHS ?? 2);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 2;
}

export function filterSourcesToRecentMonths(sources = [], recentMonths = 0) {
  const limit = Number(recentMonths);
  if (!Array.isArray(sources) || !Number.isFinite(limit) || limit <= 0) {
    return sources;
  }
  const periods = [...new Set(sources.map((source) => String(source.period || "")).filter(Boolean))]
    .sort()
    .reverse()
    .slice(0, limit);
  const keep = new Set(periods);
  return sources.filter((source) => keep.has(String(source.period || "")));
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
