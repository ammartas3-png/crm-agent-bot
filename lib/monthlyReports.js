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

const BUILTIN_MONTH_MAPPINGS_2026 = [
  { month: "January 2026", sheet_id: "1Gf6f2xs8jRL6MMNwLMM4is-mdMBMCR_k4EW0LcvnD01k" },
  { month: "February 2026", sheet_id: "1R303xCVpamBTSkbH2QyT0JHCBPctayeYV9rERML6R5s" },
  { month: "March 2026", sheet_id: "1z-O1vy_vaFjU5Ys-P2VW4AMAXOEQ0nSzEjjOakDegsA" },
  { month: "April 2026", sheet_id: "1tbdyjZ-lJLZby9azuDysIw2ewnhP7wSMuX2mzD_bfME" },
];

const monthFiles = new Map();

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(year, month) {
  return `${MONTH_NAMES[month]} ${year}`;
}

function nowIso() {
  return new Date().toISOString();
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
    month_label: formatMonthLabel(year, month),
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
    month_label: formatMonthLabel(year, month),
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
        sheet_id: spreadsheetId,
      }));
    }
  } catch {
    return [];
  }
  return [];
}

function withCompatFields(record) {
  return {
    ...record,
    label: record.month_label,
    spreadsheetId: record.sheet_id,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function normalizeRecordShape(record = {}, parsedMonth = null) {
  const month = parsedMonth?.month ?? record.month;
  const year = parsedMonth?.year ?? record.year;
  const key = parsedMonth?.key || record.key;
  const monthLabel = parsedMonth?.month_label || record.month_label || record.label || formatMonthLabel(year, month);
  const sheetId = normalizeSpreadsheetId(record.sheet_id || record.spreadsheetId || "");
  const active = typeof record.active === "boolean" ? record.active : true;
  const createdAt = String(record.created_at || record.createdAt || nowIso());
  const updatedAt = String(record.updated_at || record.updatedAt || nowIso());
  return withCompatFields({
    key,
    month,
    year,
    month_label: monthLabel,
    sheet_id: sheetId,
    active,
    created_at: createdAt,
    updated_at: updatedAt,
  });
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
  monthFiles.set(
    key,
    normalizeRecordShape({
      key,
      month: parsed.month,
      year: parsed.year,
      month_label: parsed.month_label,
      sheet_id: spreadsheetId,
      active: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    }),
  );
}

function seedMappings() {
  const envMappings = parseSeedMappings(process.env.MONTHLY_REPORT_FILES);
  const mappings = [...BUILTIN_MONTH_MAPPINGS_2026, ...envMappings];
  for (const item of mappings) {
    const parsed = parseMonthLabel(item?.month || item?.month_label || item?.label || "");
    if (!parsed) {
      continue;
    }
    const normalized = normalizeRecordShape(
      {
        key: parsed.key,
        month: parsed.month,
        year: parsed.year,
        month_label: parsed.month_label,
        sheet_id: item?.sheet_id || item?.spreadsheetId || item?.sheetId || item?.id || "",
        active: typeof item?.active === "boolean" ? item.active : true,
        created_at: item?.created_at || item?.createdAt,
        updated_at: item?.updated_at || item?.updatedAt,
      },
      parsed,
    );
    if (!normalized.sheet_id) {
      continue;
    }
    monthFiles.set(parsed.key, normalized);
  }
  ensureCurrentMonthSeed();
}

seedMappings();

export function listMonthFiles(options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  return [...monthFiles.values()]
    .filter((record) => (includeInactive ? true : record.active))
    .sort((left, right) => right.key.localeCompare(left.key));
}

export function getMonthFile(key, options = {}) {
  const includeInactive =
    options.includeInactive === undefined ? true : Boolean(options.includeInactive);
  const record = monthFiles.get(String(key || "").trim()) || null;
  if (!record) {
    return null;
  }
  if (!includeInactive && !record.active) {
    return null;
  }
  return record;
}

export function getSpreadsheetIdForMonth(key) {
  return getMonthFile(key, { includeInactive: false })?.sheet_id || "";
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
  const existing = monthFiles.get(parsedMonth.key);
  const createdAt = existing?.created_at || nowIso();
  const record = normalizeRecordShape(
    {
      key: parsedMonth.key,
      month: parsedMonth.month,
      year: parsedMonth.year,
      month_label: parsedMonth.month_label,
      sheet_id: spreadsheetId,
      active: existing?.active ?? true,
      created_at: createdAt,
      updated_at: nowIso(),
    },
    parsedMonth,
  );
  monthFiles.set(parsedMonth.key, record);
  return record;
}

export function removeMonthFile(key) {
  return monthFiles.delete(String(key || "").trim());
}

export function setMonthFileActive(key, active) {
  const current = getMonthFile(key, { includeInactive: true });
  if (!current) {
    return null;
  }
  const updated = normalizeRecordShape({
    ...current,
    active: Boolean(active),
    updated_at: nowIso(),
  });
  monthFiles.set(updated.key, updated);
  return updated;
}
