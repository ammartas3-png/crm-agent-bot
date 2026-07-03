// Reads the separate "Old Data for AE / AR" spreadsheet that holds the first
// three months (Jan/Feb/Mar 2026) for the Argentina and Dubai offices, which
// are missing from the main system. The data is per-agent, per-month aggregates
// (FTD TARGET, FTD, CR) — NOT raw leads.
//
// IMPORTANT: this data is used ONLY by the Benchmark and Last-4-Months reports.
// It must never leak into other reports or the raw-lead pipeline. Callers gate
// usage by report mode/preset and office; this module just reads and shapes it.

import { toPercentNumber } from "./calculations.js";
import { readSheetValues } from "./googleSheets.js";

export const LEGACY_OFFICE_DATA_SPREADSHEET_ID =
  process.env.LEGACY_OFFICE_DATA_SPREADSHEET_ID ||
  "1GAQqBg_uQFDtACQazy6_fE3-ZlaNFG8d8Q4PkhkvDFg";

// Maps the system office name (normalized) to its tab in the legacy workbook.
const LEGACY_OFFICE_TABS = [
  { office: "Argentina Office", tab: "AR OFFICE", patterns: ["argentina"] },
  { office: "Dubai Office", tab: "AE OFFICE", patterns: ["dubai", "uae", "united arab emirates", "emirates"] },
];

// Column layout (0-based) per the sheet headers:
// 0 Agent Names | 1 Jan TARGET | 2 Jan FTD | 3 Jan CR | 4 Feb TARGET | 5 Feb FTD
// | 6 Feb CR | 7 Mar TARGET | 8 Mar FTD | 9 Mar CR
const LEGACY_MONTHS = [
  { key: "2026-01", label: "January 2026", month: 0, year: 2026, target: 1, ftd: 2, cr: 3 },
  { key: "2026-02", label: "February 2026", month: 1, year: 2026, target: 4, ftd: 5, cr: 6 },
  { key: "2026-03", label: "March 2026", month: 2, year: 2026, target: 7, ftd: 8, cr: 9 },
];

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null; // { timestamp, byOffice: Map<normalizedOffice, officeData> }

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US");
}

export function legacyOfficeNameFor(office = "") {
  const normalized = normalize(office);
  const match = LEGACY_OFFICE_TABS.find(
    (entry) => normalize(entry.office) === normalized || entry.patterns.some((p) => normalized.includes(p)),
  );
  return match ? match.office : "";
}

export function isLegacyOffice(office = "") {
  return Boolean(legacyOfficeNameFor(office));
}

export function legacyMonthKeys() {
  return LEGACY_MONTHS.map((month) => month.key);
}

// Synthetic month records (no sheet_id) so the Last-4 / Benchmark month windows
// can include these months. `legacy: true` flags them for the synthetic loader.
export function legacyMonthRecordsForOffice(office = "") {
  const officeName = legacyOfficeNameFor(office);
  if (!officeName) {
    return [];
  }
  return LEGACY_MONTHS.map((month) => ({
    key: month.key,
    month: month.month,
    year: month.year,
    month_label: month.label,
    office_name: officeName,
    active: true,
    legacy: true,
    sheet_id: "",
  }));
}

function uniqueSortedMonthKeys(keys = []) {
  return [...new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))].sort((left, right) =>
    right.localeCompare(left),
  );
}

// Combines live office months with legacy Jan–Mar for AR/AE and returns the four
// most recent keys (e.g. Dubai with Apr–Jun live -> Mar–Jun).
export function resolveLast4MonthKeysForOffice(office = "", liveMonthKeys = []) {
  const legacyKeys = isLegacyOffice(office) ? legacyMonthKeys() : [];
  return uniqueSortedMonthKeys([...(liveMonthKeys || []), ...legacyKeys]).slice(0, 4);
}

// Month picker / scoped records: live office months plus synthetic legacy months.
export function officeMonthRecordsWithLegacy(office = "", liveRecords = []) {
  const officeName = legacyOfficeNameFor(office) || String(office || "").trim();
  const byKey = new Map();
  for (const record of liveRecords || []) {
    const key = String(record?.key || "").trim();
    if (!key) {
      continue;
    }
    byKey.set(key, {
      ...record,
      office_name: String(record?.office_name || officeName || "").trim(),
    });
  }
  if (isLegacyOffice(office)) {
    for (const record of legacyMonthRecordsForOffice(office)) {
      if (!byKey.has(record.key)) {
        byKey.set(record.key, record);
      }
    }
  }
  return [...byKey.values()].sort((left, right) => String(right.key || "").localeCompare(String(left.key || "")));
}

export function legacyMonthKeysInWindow(last4MonthKeys = []) {
  const legacyKeySet = new Set(legacyMonthKeys());
  return (last4MonthKeys || []).filter((key) => legacyKeySet.has(String(key || "").trim()));
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const cleaned = String(value).replace(/[^0-9.,-]/g, "").replace(",", ".").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCr(value) {
  const parsed = toPercentNumber(value);
  return parsed === null ? 0 : parsed;
}

async function readOfficeTab(entry) {
  const range = `'${entry.tab.replace(/'/g, "''")}'!A:J`;
  let values = [];
  try {
    values = await readSheetValues(LEGACY_OFFICE_DATA_SPREADSHEET_ID, range);
  } catch {
    return { office: entry.office, monthsByKey: new Map() };
  }
  const dataRows = Array.isArray(values) ? values.slice(1) : [];
  const monthsByKey = new Map();
  for (const month of LEGACY_MONTHS) {
    monthsByKey.set(month.key, { key: month.key, label: month.label, agents: new Map() });
  }
  for (const row of dataRows) {
    const agent = String(row?.[0] || "").trim();
    if (!agent || normalize(agent) === "agent names") {
      continue;
    }
    for (const month of LEGACY_MONTHS) {
      const ftdTarget = parseNumber(row?.[month.target]);
      const ftd = parseNumber(row?.[month.ftd]);
      const cr = parseCr(row?.[month.cr]);
      if (ftdTarget === 0 && ftd === 0 && cr === 0) {
        continue; // no data for this agent/month
      }
      monthsByKey.get(month.key).agents.set(normalize(agent), {
        agent,
        ftdTarget,
        ftd,
        cr,
      });
    }
  }
  return { office: entry.office, monthsByKey };
}

export async function loadLegacyOfficeData(options = {}) {
  const now = Date.now();
  if (!options.forceRefresh && cache && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.byOffice;
  }
  const byOffice = new Map();
  await Promise.all(
    LEGACY_OFFICE_TABS.map(async (entry) => {
      const officeData = await readOfficeTab(entry);
      byOffice.set(normalize(entry.office), officeData);
    }),
  );
  cache = { timestamp: now, byOffice };
  return byOffice;
}

// Returns per-agent aggregates for one office + month, or null when absent.
export async function legacyAgentsForOfficeMonth(office = "", monthKey = "") {
  const officeName = legacyOfficeNameFor(office);
  if (!officeName) {
    return null;
  }
  const byOffice = await loadLegacyOfficeData();
  const officeData = byOffice.get(normalize(officeName));
  if (!officeData) {
    return null;
  }
  const month = officeData.monthsByKey.get(String(monthKey || "").trim());
  if (!month || month.agents.size === 0) {
    return null;
  }
  return { office: officeName, monthKey, agents: [...month.agents.values()] };
}

export function clearLegacyOfficeDataCache() {
  cache = null;
}
