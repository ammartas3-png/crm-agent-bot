// Report activity log.
//
// Appends one row per report load / export to the "LOGS" tab of the Bot
// Authority spreadsheet: who, when, which report, which metrics, and the
// filters they looked at. Keeps the last 30 days and prunes older rows.
//
// Writing is best-effort and fire-and-forget: a failure here must never break
// or slow a report. The service account needs Editor access to the Bot
// Authority spreadsheet (read-only is enough for everything else).

import { DEFAULT_AUTHORITY_SPREADSHEET_ID } from "../config/sheetsConfig.js";
import { appendSheetValues, readSheetValues, updateSheetValues } from "./googleSheets.js";

const LOG_TAB = "LOGS";
const LOG_COLUMNS = "A:K";
const RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = 15 * 60 * 1000;

const HEADERS = [
  "Timestamp (UTC)",
  "User",
  "Username",
  "Telegram ID",
  "Office",
  "Months",
  "Report",
  "Dimensions",
  "Metrics",
  "Filters",
  "Action",
];

// Per-instance guards. Serverless instances are ephemeral, so these are
// best-effort throttles, not strict global state.
let headerEnsured = false;
let lastPruneAt = 0;

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function get(searchParams, key) {
  if (!searchParams) {
    return "";
  }
  if (typeof searchParams.get === "function") {
    return String(searchParams.get(key) || "").trim();
  }
  return String(searchParams[key] || "").trim();
}

export function reportLabel(searchParams) {
  if (truthy(get(searchParams, "trafficPriority"))) return "Traffic Distribution";
  if (truthy(get(searchParams, "leadSplitter"))) return "LeadSplitter";
  if (truthy(get(searchParams, "comparisonMode"))) return "Comparison Report";
  if (truthy(get(searchParams, "agentProductivityPlanMode"))) return "Agent Productivity vs Plan";
  if (truthy(get(searchParams, "last4QuickMode"))) return "Last 4 Months";
  if (truthy(get(searchParams, "benchmarkMode"))) return "Benchmark";
  const columnDimension = get(searchParams, "columnDimension");
  if (get(searchParams, "reportMode").toLowerCase() === "specific" || get(searchParams, "rowDimensions")) {
    return columnDimension ? `Report Builder (${columnDimension} columns)` : "Report Builder";
  }
  return "Monthly";
}

function csvLabel(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

function filtersSummary(searchParams) {
  const keys = [
    ["date", "Date"],
    ["hour", "Hour"],
    ["desk", "Desk"],
    ["country", "Country"],
    ["brand", "Brand"],
    ["campaign", "Campaign"],
    ["subCampaign", "Sub-Campaign"],
    ["placement", "Placement"],
    ["status", "Status"],
    ["teamLeader", "Team Leader"],
    ["agent", "Agent"],
  ];
  const parts = [];
  for (const [key, label] of keys) {
    const value = get(searchParams, key);
    if (value) {
      parts.push(`${label}: ${value}`);
    }
  }
  return parts.join(" | ");
}

export function buildRow(telegramUser, searchParams, action) {
  const name =
    [telegramUser?.first_name, telegramUser?.last_name]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ") || "Unknown";
  const username = telegramUser?.username ? `@${String(telegramUser.username).trim()}` : "";
  const telegramId = telegramUser?.id ? String(telegramUser.id) : "";
  return [
    new Date().toISOString(),
    name,
    username,
    telegramId,
    get(searchParams, "officeScope"),
    get(searchParams, "monthKey"),
    reportLabel(searchParams),
    csvLabel(get(searchParams, "rowDimensions")),
    csvLabel(get(searchParams, "metricFields")),
    filtersSummary(searchParams),
    String(action || "view"),
  ];
}

async function ensureHeader() {
  if (headerEnsured) {
    return;
  }
  await updateSheetValues({
    spreadsheetId: DEFAULT_AUTHORITY_SPREADSHEET_ID,
    range: `${LOG_TAB}!A1:K1`,
    values: [HEADERS],
    valueInputOption: "RAW",
  });
  headerEnsured = true;
}

async function pruneOldLogs() {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) {
    return;
  }
  lastPruneAt = now;
  const values = await readSheetValues(DEFAULT_AUTHORITY_SPREADSHEET_ID, `${LOG_TAB}!${LOG_COLUMNS}`).catch(() => []);
  if (!Array.isArray(values) || values.length <= 1) {
    return;
  }
  const header = Array.isArray(values[0]) && values[0].length ? values[0] : HEADERS;
  const dataRows = values.slice(1);
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const kept = dataRows.filter((row) => {
    const parsed = Date.parse(String(row?.[0] || ""));
    // Keep rows whose timestamp cannot be parsed (avoid deleting unknown data).
    return Number.isFinite(parsed) ? parsed >= cutoff : true;
  });
  if (kept.length === dataRows.length) {
    return;
  }
  const out = [header, ...kept];
  // Overwrite the old tail so removed rows are cleared, not just shifted.
  const blank = new Array(HEADERS.length).fill("");
  while (out.length < values.length) {
    out.push(blank);
  }
  await updateSheetValues({
    spreadsheetId: DEFAULT_AUTHORITY_SPREADSHEET_ID,
    range: `${LOG_TAB}!A1:K${out.length}`,
    values: out,
    valueInputOption: "RAW",
  });
}

// Fire-and-forget: append one activity row (+ opportunistic prune). Never
// throws to the caller.
export async function logReportEvent({ telegramUser, searchParams, action = "view" } = {}) {
  try {
    await ensureHeader();
    await appendSheetValues({
      spreadsheetId: DEFAULT_AUTHORITY_SPREADSHEET_ID,
      range: `${LOG_TAB}!${LOG_COLUMNS}`,
      values: [buildRow(telegramUser, searchParams, action)],
      valueInputOption: "RAW",
    });
    pruneOldLogs().catch(() => {});
  } catch (error) {
    console.error("[report-log] failed to record activity", error?.message || error);
  }
}
