import { uniqueValues } from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import {
  isDatasetActive,
  listSources,
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

// Dashboard helper: read from Redis when synced, otherwise live Google Sheets.
export async function readDashboardSheetRows(tabKey, options = {}) {
  if (await shouldUseIngestForDashboard()) {
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

// Latest ingest sync time (ms epoch) across all ingested sources, i.e. when
// n8n last refreshed the Redis dataset. Returns null when the dashboard is not
// reading from the ingest (live Sheets mode) or nothing has been synced.
export async function lastIngestSyncAt() {
  if (!(await shouldUseIngestForDashboard())) {
    return null;
  }
  try {
    const sources = await listSources();
    let latest = 0;
    for (const meta of sources || []) {
      const ts = Number(meta?.updatedAt || 0);
      if (Number.isFinite(ts) && ts > latest) {
        latest = ts;
      }
    }
    return latest > 0 ? latest : null;
  } catch {
    return null;
  }
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
