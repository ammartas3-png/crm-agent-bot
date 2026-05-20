import { sheetsConfig } from "../config/sheetsConfig.js";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const monthFiles = new Map();

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(year, month) {
  return `${MONTH_NAMES[month]} ${year}`;
}

export function parseMonthLabel(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  const match = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) {
    return null;
  }
  const month = MONTH_NAMES.findIndex((name) => name.toLocaleLowerCase("en-US") === match[1].toLocaleLowerCase("en-US"));
  if (month < 0) {
    return null;
  }
  const year = Number(match[2]);
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    return null;
  }
  return {
    key: monthKey(year, month),
    month,
    year,
    label: formatMonthLabel(year, month),
  };
}

export function parseMonthKey(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
    return null;
  }
  return {
    key: monthKey(year, month),
    year,
    month,
    label: formatMonthLabel(year, month),
  };
}

export function currentMonthKey(now = new Date()) {
  return monthKey(now.getUTCFullYear(), now.getUTCMonth());
}

export function monthFilterFromKey(key) {
  const parsed = parseMonthKey(key);
  if (!parsed) {
    return null;
  }
  return { type: "month", month: parsed.month, year: parsed.year };
}

export function isPastMonthKey(key, now = new Date()) {
  const parsed = parseMonthKey(key);
  if (!parsed) {
    return false;
  }
  const current = currentMonthKey(now);
  return parsed.key < current;
}

function normalizeSpreadsheetId(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }
  return text;
}

function parseSeedMappings(raw) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (typeof parsed === "object" && parsed !== null) {
      return Object.entries(parsed).map(([monthLabel, spreadsheetId]) => ({
        month: monthLabel,
        spreadsheetId,
      }));
    }
  } catch {
    return [];
  }
  return [];
}

function ensureCurrentMonthSeed() {
  const key = currentMonthKey();
  if (monthFiles.has(key)) {
    return;
  }
  const spreadsheetId = normalizeSpreadsheetId(process.env.GOOGLE_SPREADSHEET_ID || sheetsConfig.spreadsheetId);
  if (!spreadsheetId) {
    return;
  }
  const parsed = parseMonthKey(key);
  monthFiles.set(key, {
    key,
    month: parsed.month,
    year: parsed.year,
    label: parsed.label,
    spreadsheetId,
    updatedAt: Date.now(),
  });
}

function seedMappings() {
  const mappings = parseSeedMappings(process.env.MONTHLY_REPORT_FILES);
  for (const item of mappings) {
    const parsed = parseMonthLabel(item?.month || item?.label || "");
    const spreadsheetId = normalizeSpreadsheetId(item?.spreadsheetId || item?.sheetId || item?.id || "");
    if (!parsed || !spreadsheetId) {
      continue;
    }
    monthFiles.set(parsed.key, {
      ...parsed,
      spreadsheetId,
      updatedAt: Date.now(),
    });
  }
  ensureCurrentMonthSeed();
}

seedMappings();

export function listMonthFiles() {
  return [...monthFiles.values()].sort((left, right) => right.key.localeCompare(left.key));
}

export function getMonthFile(key) {
  return monthFiles.get(String(key || "").trim()) || null;
}

export function getSpreadsheetIdForMonth(key) {
  return getMonthFile(key)?.spreadsheetId || "";
}

export function upsertMonthFile(monthInput, spreadsheetIdInput) {
  const parsedMonth = parseMonthLabel(monthInput);
  const spreadsheetId = normalizeSpreadsheetId(spreadsheetIdInput);
  if (!parsedMonth) {
    throw new Error("Invalid month format. Use: May 2026");
  }
  if (!spreadsheetId) {
    throw new Error("Invalid Google Sheet ID.");
  }
  const record = {
    ...parsedMonth,
    spreadsheetId,
    updatedAt: Date.now(),
  };
  monthFiles.set(parsedMonth.key, record);
  return record;
}
