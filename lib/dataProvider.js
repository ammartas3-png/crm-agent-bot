import { uniqueValues } from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import { isDatasetActive, loadAllRows, loadRowsForSourceMeta } from "./leadsStore.js";

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

// Dashboard helper: read from Redis when synced, otherwise live Google Sheets.
export async function readDashboardSheetRows(tabKey, options = {}) {
  if (await shouldUseIngestForDashboard()) {
    const ingested = await loadIngestedSheetRows({
      tabKey,
      spreadsheetId: options.spreadsheetId,
      office: options.office,
      period: options.period,
    });
    if (ingested !== null) {
      return ingested;
    }
  }
  return readSheetRows(tabKey, options);
}

export async function loadUniqueValues(tabKey, tabConfig, fieldKey, limit = 96, options = {}) {
  const rows = options.rows || (await loadLeadRows(tabKey, { tabConfig }));
  return uniqueValues(rows, tabConfig, fieldKey, limit);
}
