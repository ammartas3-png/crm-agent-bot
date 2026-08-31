import { uniqueValues } from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import {
  isDatasetActive,
  loadAllRows,
  loadAuxiliarySourceRows,
  loadRowsForSourceMeta,
} from "./leadsStore.js";

export function dashboardSourceMode(env = process.env) {
  const explicit = String(env.DASHBOARD_SOURCE || "").trim().toLowerCase();
  if (explicit === "ingest" || explicit === "sheets" || explicit === "auto") {
    return explicit;
  }
  return String(env.LEADS_SOURCE || "auto").trim().toLowerCase() === "sheets" ? "sheets" : "auto";
}

export async function shouldUseIngestForDashboard(env = process.env) {
  const mode = dashboardSourceMode(env);
  if (mode === "sheets") {
    return false;
  }
  if (mode === "ingest") {
    return true;
  }
  return isDatasetActive(env);
}

const TAB_CATEGORY = {
  leads: "leads",
  ftd: "ftd",
  infoAgents: "infoAgents",
  officeAgentRoster: "roster",
  officeDeskLanguage: "deskLanguage",
};

// Unified row loader. When ingested data is available (synced by n8n into the
// Redis/KV + in-memory dataset store) the bot reports from it; otherwise it
// falls back to reading Google Sheets directly. The signature mirrors
// readSheetRows so callers can swap it in transparently.
export async function loadLeadRows(tabKey = "leads", options = {}) {
  if (await isDatasetActive()) {
    const rows = await loadAllRows();
    if (rows.length > 0) {
      return rows;
    }
  }
  return readSheetRows(tabKey, options);
}

export async function loadIngestedSheetRows({
  tabKey = "leads",
  spreadsheetId = "",
  office = "",
  period = "",
} = {}) {
  const category = TAB_CATEGORY[tabKey] || "leads";
  return loadRowsForSourceMeta({
    spreadsheetId,
    office,
    period,
    category,
  });
}

// Tabs whose CURRENT month should be read live (they change every day). Older
// months are stable, so they keep using the fast Redis ingest.
const CURRENT_MONTH_LIVE_TABS = new Set(["leads", "ftd"]);

// True when `period` (a "YYYY-MM" month key) is the current calendar month.
export function isCurrentMonthPeriod(period = "", now = new Date()) {
  const matched = String(period || "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!matched) {
    return false;
  }
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return matched[1] === year && matched[2] === month;
}

// Dashboard helper: read from Redis when synced, otherwise live Google Sheets.
// The current month's leads/FTD are read live so newly added rows (deposits
// entered after the last n8n sync) show immediately and match the sheet; older
// months use the ingest for speed. Set DASHBOARD_INGEST_ALL_MONTHS=1 to force
// pure ingest everywhere (e.g. if live Sheets load ever needs to be reduced).
export async function readDashboardSheetRows(tabKey, options = {}) {
  const ingestAllMonths = /^(1|true|yes)$/i.test(String(process.env.DASHBOARD_INGEST_ALL_MONTHS || "").trim());
  const preferLiveCurrentMonth =
    !ingestAllMonths && CURRENT_MONTH_LIVE_TABS.has(tabKey) && isCurrentMonthPeriod(options.period);
  if (!preferLiveCurrentMonth && (await shouldUseIngestForDashboard())) {
    const ingested = await loadIngestedSheetRows({
      tabKey,
      spreadsheetId: options.spreadsheetId,
      office: options.office,
      period: options.period,
    });
    if (ingested !== null && (tabKey === "leads" || ingested.length > 0)) {
      return ingested;
    }
  }
  return readSheetRows(tabKey, options);
}

// Reads roster / desk-language rows from Redis when synced. Returns null when
// the auxiliary source is not present so the dashboard falls back to live
// Google Sheets reads.
export async function loadAuxiliaryRows({ category = "roster", rosterTab = "" } = {}) {
  return loadAuxiliarySourceRows({ category, rosterTab });
}

export async function loadUniqueValues(tabKey, tabConfig, fieldKey, limit = 96, options = {}) {
  const rows = options.rows || (await loadLeadRows(tabKey, { tabConfig }));
  return uniqueValues(rows, tabConfig, fieldKey, limit);
}
