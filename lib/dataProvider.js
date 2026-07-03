import { getTabConfig } from "../config/sheetsConfig.js";
import { uniqueValues } from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import { resolveDataTabs } from "./tabResolver.js";
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

function looksLikeMissingTabError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("unable to parse range") ||
    message.includes("requested entity was not found") ||
    error?.code === 400 ||
    error?.status === 400
  );
}

// Office monthly files often name their data tab differently than the default
// ("Leads"). During sync this is handled by tabResolver; for live dashboard
// reads we do the same auto-detection so a differently-named tab still loads.
async function readSheetRowsWithTabDetection(tabKey, options = {}) {
  const tabConfig = options.tabConfig || getTabConfig(tabKey);
  const spreadsheetId = String(options.spreadsheetId || "").trim();
  let primaryRows = [];
  let primaryError = null;
  try {
    primaryRows = await readSheetRows(tabKey, options);
    if (Array.isArray(primaryRows) && primaryRows.length > 0) {
      return primaryRows;
    }
  } catch (error) {
    if (!looksLikeMissingTabError(error)) {
      throw error;
    }
    primaryError = error;
  }
  // Configured tab was empty or missing — try to detect the real data tab.
  if (!spreadsheetId) {
    if (primaryError) {
      throw primaryError;
    }
    return primaryRows;
  }
  try {
    const columnsSpec = String(tabConfig.range || "").match(/!(.+)$/)?.[1] || "A:Y";
    // Do not prefer the configured tab here: we only reach this point because the
    // configured tab was empty or missing, so pick the best header-matching tab.
    const resolved = await resolveDataTabs(spreadsheetId, tabConfig, {
      columnsSpec,
    });
    const resolvedRange = resolved?.[0]?.range;
    if (resolvedRange && resolvedRange !== tabConfig.range) {
      const rows = await readSheetRows(tabKey, {
        ...options,
        tabConfig: { ...tabConfig, range: resolvedRange },
      });
      if (Array.isArray(rows) && rows.length > 0) {
        return rows;
      }
    }
  } catch {
    // Fall through to the primary result/error below.
  }
  if (primaryError) {
    throw primaryError;
  }
  return primaryRows;
}

// Dashboard helper: read from Redis when synced, otherwise live Google Sheets.
export async function readDashboardSheetRows(tabKey, options = {}) {
  const scopedOffice = String(options.office || "").trim();
  const scopedPeriod = String(options.period || "").trim();
  const scopedSpreadsheetId = String(options.spreadsheetId || "").trim();
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
  // When the request is scoped to office+period (typical per-office monthly
  // files) but ingest missed, do not fall back to the global default sheet —
  // that would show the wrong office's data or an empty/wrong month.
  if (!scopedSpreadsheetId && scopedOffice && scopedPeriod) {
    return [];
  }
  // For leads/info reads against a specific office spreadsheet, auto-detect the
  // data tab so files whose tab is not named "Leads" still load correctly.
  if (scopedSpreadsheetId && (tabKey === "leads" || tabKey === "infoAgents")) {
    return readSheetRowsWithTabDetection(tabKey, options);
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
