import { getAuthorityConfig } from "../config/sheetsConfig.js";
import { appendSheetValues, readSheetValues, updateSheetValues } from "./googleSheets.js";

const WORKED_HEADERS = [
  "Timestamp",
  "Channel",
  "Telegram ID",
  "Username",
  "Display Name",
  "Action",
  "Quick Report / Page",
  "Office",
  "Month",
  "Metrics",
  "Details",
];

export const QUICK_REPORT_LABELS = {
  monthly: "Monthly Quick",
  last4: "Last 4 Months Quick",
  traffic: "Traffic Reports",
  "country-daily": "Country Daily Watch",
  benchmark: "Benchmark Report",
  "desk-country-cr": "Desk Country Daily CR Watch",
  "country-campaign-hourly-cr": "Country Campaign Hourly CR Watch",
  "status-watch": "Status Performance Watch",
  "comparison-report": "Comparison Report",
  "agent-productivity-plan": "Agent Productivity vs Plan Report",
};

let headerReady = false;
let headerReadyPromise = null;

function isActivityLoggingEnabled(env = process.env) {
  const flag = String(env.ACTIVITY_LOG_ENABLED ?? "1").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(flag);
}

export function formatTelegramDisplayName(telegramUser = {}) {
  const first = String(telegramUser.first_name || "").trim();
  const last = String(telegramUser.last_name || "").trim();
  return [first, last].filter(Boolean).join(" ").trim();
}

export function quickReportLabel(presetKey = "") {
  const key = String(presetKey || "").trim();
  if (!key) {
    return "";
  }
  return QUICK_REPORT_LABELS[key] || key;
}

function formatTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function compactDetails(details = {}) {
  if (!details || typeof details !== "object") {
    return "";
  }
  const entries = Object.entries(details)
    .map(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return null;
      }
      if (Array.isArray(value)) {
        const normalized = value.map((item) => String(item || "").trim()).filter(Boolean);
        return normalized.length ? [key, normalized.join(", ")] : null;
      }
      return [key, String(value).trim()];
    })
    .filter(Boolean);
  if (!entries.length) {
    return "";
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(" | ");
}

function buildWorkedRow(entry = {}) {
  const telegramUser = entry.telegramUser || {};
  const timestamp = formatTimestamp(entry.timestamp || new Date());
  const channel = String(entry.channel || "").trim();
  const action = String(entry.action || "").trim();
  const quickReport = String(entry.quickReport || entry.page || "").trim();
  const office = String(entry.office || "").trim();
  const month = String(entry.month || "").trim();
  const metrics = Array.isArray(entry.metrics)
    ? entry.metrics.map((item) => String(item || "").trim()).filter(Boolean).join(", ")
    : String(entry.metrics || "").trim();
  const details = compactDetails(entry.details);
  const telegramId = Number(telegramUser.id) || String(telegramUser.id || "").trim();
  const username = String(telegramUser.username || "").trim();
  const displayName = formatTelegramDisplayName(telegramUser);

  return [
    timestamp,
    channel,
    telegramId ? String(telegramId) : "",
    username,
    displayName,
    action,
    quickReport,
    office,
    month,
    metrics,
    details,
  ];
}

async function ensureWorkedHeader(options = {}) {
  if (headerReady) {
    return;
  }
  if (headerReadyPromise) {
    await headerReadyPromise;
    return;
  }
  const authorityConfig = options.authorityConfig || getAuthorityConfig();
  const spreadsheetId = options.spreadsheetId || authorityConfig.spreadsheetId;
  const range = options.range || authorityConfig.workedRange;
  const sheetsClient = options.sheetsClient;
  headerReadyPromise = (async () => {
    const existing = await readSheetValues(spreadsheetId, range, { sheetsClient });
    const firstCell = String(existing?.[0]?.[0] || "").trim();
    if (!firstCell) {
      await updateSheetValues({
        spreadsheetId,
        range,
        values: [WORKED_HEADERS],
        sheetsClient,
        valueInputOption: "USER_ENTERED",
      });
    }
    headerReady = true;
  })();
  try {
    await headerReadyPromise;
  } finally {
    headerReadyPromise = null;
  }
}

export async function appendActivityLog(entry = {}, options = {}) {
  if (!isActivityLoggingEnabled(options.env)) {
    return { skipped: true, reason: "disabled" };
  }
  const authorityConfig = options.authorityConfig || getAuthorityConfig();
  const spreadsheetId = options.spreadsheetId || authorityConfig.spreadsheetId;
  const range = options.range || authorityConfig.workedRange;
  const sheetsClient = options.sheetsClient;
  await ensureWorkedHeader({ authorityConfig, spreadsheetId, range, sheetsClient });
  const row = buildWorkedRow(entry);
  return appendSheetValues({
    spreadsheetId,
    range,
    values: [row],
    sheetsClient,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
  });
}

export function logActivity(entry = {}, options = {}) {
  if (!isActivityLoggingEnabled(options.env)) {
    return;
  }
  void appendActivityLog(entry, options).catch((error) => {
    console.error("[activity-log] append failed", error?.message || error);
  });
}

export function logBotActivity(telegramUser, action, details = {}, options = {}) {
  logActivity(
    {
      channel: "bot",
      telegramUser,
      action,
      quickReport: quickReportLabel(details.presetKey || details.quickReport || ""),
      office: details.office || "",
      month: details.month || details.monthKey || "",
      metrics: details.metrics || "",
      details,
      timestamp: details.timestamp,
    },
    options,
  );
}

export function logDashboardActivity(telegramUser, action, details = {}, options = {}) {
  const presetKey = details.presetKey || details.activityQuickPreset || details.quickReport || "";
  logActivity(
    {
      channel: "dashboard",
      telegramUser,
      action,
      quickReport: quickReportLabel(presetKey) || details.page || "",
      office: details.office || details.officeScope || "",
      month: details.month || details.monthKey || "",
      metrics: details.metrics || details.metricFields || "",
      details,
      timestamp: details.timestamp,
    },
    options,
  );
}

export function resetActivityLogStateForTests() {
  headerReady = false;
  headerReadyPromise = null;
}
