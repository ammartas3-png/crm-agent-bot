import { getTabConfig } from "../config/sheetsConfig.js";
import {
  calculateSummary,
  createDateRangeFilter,
  formatPercent,
  generateReport,
  getFieldName,
  getLeadRowsByDateRange,
  getRowValue,
  groupPerformance,
  hourlyDistribution,
  normalizeText,
  parseDateValue,
  statusDistribution,
  uniqueValues,
} from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import {
  currentMonthKey,
  getMonthFile,
  isPastMonthKey,
  listMonthFiles,
  monthFilterFromKey,
  removeMonthFile,
  setMonthFileActive,
  upsertMonthFile,
} from "./monthlyReports.js";
import { isSettingsAdminTelegramUser } from "./permissions.js";
import { clearSession, getSession, setSession } from "./session.js";
import {
  agentTarget,
  buildAgentTargetsMap,
  collectAgentNames,
  formatOptionalPercent,
  formatTarget,
  summarizeTarget,
  targetReachPercent,
} from "./targets.js";

export const MAIN_MENU_TEXT = "Select report filter:";
const MONTH_MENU_TEXT = "Select report month:";
const SETTINGS_MENU_TEXT = "Settings";

const REPORT_TYPES = {
  office: {
    label: "Office",
    title: "Office Report",
    fieldKey: "office",
    filterKey: "office",
    breakdowns: [
      ["Top Agents", "topAgents"],
      ["Country Breakdown", "countryBreakdown"],
      ["Top Team Leaders", "teamLeaderBreakdown"],
    ],
  },
  desk: {
    label: "Desk",
    title: "Desk Report",
    fieldKey: "department",
    filterKey: "department",
    breakdowns: [
      ["Top Agents", "topAgents"],
      ["Country Breakdown", "countryBreakdown"],
      ["Top Team Leaders", "teamLeaderBreakdown"],
    ],
  },
  teamLeader: {
    label: "Team Leader",
    title: "Team Leader Report",
    fieldKey: "teamLeader",
    filterKey: "teamLeader",
    breakdowns: [["Agents", "agentPerformance"]],
  },
  agent: {
    label: "Agent",
    title: "Agent Report",
    fieldKey: "agentNames",
    filterKey: "agent",
    filterExtra: { agentField: "agentNames" },
    breakdowns: [
      ["Status Distribution", "statusDistribution"],
      ["Country Breakdown", "countryBreakdown"],
      ["Campaign Breakdown", "campaignBreakdown"],
    ],
  },
  country: {
    label: "Country",
    title: "Country Report",
    fieldKey: "country",
    filterKey: "country",
    breakdowns: [
      ["Top Agents", "topAgents"],
      ["Campaign Breakdown", "campaignBreakdown"],
      ["Hourly Breakdown", "hourlyBreakdown"],
    ],
  },
  totalResults: {
    label: "Total Results",
    title: "Total Results",
    fieldKey: null,
    filterKey: null,
    breakdowns: [],
  },
};

export function isGreeting(text) {
  return /^(\/start|hello|hi|selam|merhaba)$/i.test(String(text || "").trim());
}

export function inlineKeyboard(buttonRows) {
  return {
    inline_keyboard: buttonRows.map((row) =>
      row.map((button) => ({
        text: button.text,
        callback_data: button.callbackData,
      })),
    ),
  };
}

function chunkButtons(buttons, perRow = 2) {
  const rows = [];
  for (let index = 0; index < buttons.length; index += perRow) {
    rows.push(buttons.slice(index, index + perRow));
  }
  return rows;
}

function monthKeyboard(telegramUser) {
  const monthButtons = listMonthFiles().map((month) => ({
    text: month.label,
    callbackData: `month:${month.key}`,
  }));
  const rows = chunkButtons(monthButtons, 2);
  if (isSettingsAdminTelegramUser(telegramUser)) {
    rows.push([{ text: SETTINGS_MENU_TEXT, callbackData: "settings:open" }]);
  }
  return inlineKeyboard(rows);
}

export function mainMenuKeyboard(telegramUser) {
  const rows = [
    [
      { text: "Office", callbackData: "report:office" },
      { text: "Desk", callbackData: "report:desk" },
    ],
    [
      { text: "Team Leader", callbackData: "report:teamLeader" },
      { text: "Agent", callbackData: "report:agent" },
    ],
    [
      { text: "Country", callbackData: "report:country" },
      { text: "Total Results", callbackData: "report:totalResults" },
    ],
    [{ text: "Change Month", callbackData: "menu:main" }],
  ];
  if (isSettingsAdminTelegramUser(telegramUser)) {
    rows.push([{ text: SETTINGS_MENU_TEXT, callbackData: "settings:open" }]);
  }
  return inlineKeyboard(rows);
}

export function valueKeyboard(values) {
  const buttons = values.map((value, index) => ({
    text: value,
    callbackData: `value:${index}`,
  }));
  buttons.push({ text: "Back to Report Filters", callbackData: "menu:filters" });
  return inlineKeyboard(chunkButtons(buttons, 2));
}

export function dateRangeKeyboard() {
  return inlineKeyboard([
    [
      { text: "Today", callbackData: "date:today" },
      { text: "Yesterday", callbackData: "date:yesterday" },
    ],
    [
      { text: "This Month", callbackData: "date:thisMonth" },
      { text: "Last Month", callbackData: "date:lastMonth" },
    ],
    [
      { text: "Custom Range", callbackData: "date:custom" },
      { text: "All Data", callbackData: "date:all" },
    ],
    [{ text: "Back to Report Filters", callbackData: "menu:filters" }],
  ]);
}

export function postReportKeyboard(reportType) {
  const buttons = (REPORT_TYPES[reportType]?.breakdowns || []).map(([label, key]) => ({
    text: label,
    callbackData: `breakdown:${key}`,
  }));
  buttons.push({ text: "Back to Report Filters", callbackData: "menu:filters" });
  return inlineKeyboard(chunkButtons(buttons, 2));
}

function settingsKeyboard() {
  return inlineKeyboard([
    [{ text: "Add / Update Month File", callbackData: "settings:add" }],
    [{ text: "List Month Files", callbackData: "settings:list" }],
    [{ text: "Remove Month File", callbackData: "settings:remove" }],
    [{ text: "Hide/Show Month File", callbackData: "settings:visibility" }],
    [{ text: "Back to Month Selection", callbackData: "menu:main" }],
  ]);
}

function dateRangeByKey(key, now) {
  if (key === "all") {
    return { key, label: "All Data", filter: null };
  }
  if (key === "custom") {
    return { key, label: "Custom Range", filter: null, unsupported: true };
  }
  const range = createDateRangeFilter(key, now);
  return range ? { key, ...range } : { key: "all", label: "All Data", filter: null };
}

function parseCustomDateRange(text) {
  const parts = String(text || "")
    .split(/\s+(?:to|-|–|—)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }
  const start = parseDateValue(parts[0]);
  const end = parseDateValue(parts[1]);
  if (!start || !end) {
    return null;
  }
  return {
    key: "custom",
    label: `${parts[0]} - ${parts[1]}`,
    filter: {
      type: "range",
      start: parts[0],
      end: parts[1],
    },
  };
}

function buildFilters(session) {
  const reportType = REPORT_TYPES[session.reportType];
  const filters = {};
  if (reportType?.filterKey && session.selectedValue) {
    filters[reportType.filterKey] = session.selectedValue;
  }
  if (reportType?.filterExtra) {
    Object.assign(filters, reportType.filterExtra);
  }
  if (session.dateRange?.filter) {
    filters.date = session.dateRange.filter;
  }
  return filters;
}

function reportTitle(session) {
  if (session.reportType === "totalResults") {
    return `${session.monthLabel || "Selected Month"} Total Results`;
  }
  const reportType = REPORT_TYPES[session.reportType];
  if (!reportType) {
    return "CRM Report";
  }
  return `${session.selectedValue} ${reportType.title}`;
}

function shouldShowReportDebug(options = {}) {
  return options.includeDebug || process.env.NODE_ENV === "development";
}

function targetSummaryLines(summary, options = {}) {
  const reportType = options.reportType;
  const tabConfig = options.tabConfig;
  const targetsMap = options.targetsMap || new Map();

  if (reportType === "agent") {
    const target = agentTarget(targetsMap, options.selectedValue);
    const reach = targetReachPercent(summary.totalFtd, target);
    return [
      `Target: ${formatTarget(target)}`,
      `FTD: ${summary.totalFtd.toLocaleString("en-US")}`,
      `Target Reach %: ${formatOptionalPercent(reach)}`,
    ];
  }

  if (reportType === "teamLeader" || reportType === "office") {
    const target = summarizeTarget(collectAgentNames(summary.contextRows || [], tabConfig), targetsMap);
    const reach = targetReachPercent(summary.totalFtd, target);
    const label = reportType === "teamLeader" ? "Team Leader Target" : "Office Target";
    return [`${label}: ${formatTarget(target)}`, `FTD Target Reach %: ${formatOptionalPercent(reach)}`];
  }

  return [];
}

function formatSummary(title, dateRangeLabel, summary, options = {}) {
  const lines = [
    title,
    `Date Range: ${dateRangeLabel}`,
    "",
    `Total Leads: ${summary.totalLeads.toLocaleString("en-US")}`,
    `Total FTD: ${summary.totalFtd.toLocaleString("en-US")}`,
    `Late FTD: ${summary.lateFtd.toLocaleString("en-US")}`,
    `CR: ${formatPercent(summary.cr)}`,
    `CR Target: ${formatPercent(summary.crTarget)}`,
    `CR Target Reach: ${formatPercent(summary.crTargetReach)}`,
    ...targetSummaryLines(summary, options),
  ];

  if (shouldShowReportDebug(options)) {
    lines.push(
      "",
      "Debug:",
      `leadRowsByLeadDate: ${summary.leadRowsByLeadDate.toLocaleString("en-US")}`,
      `ftdRowsByFtdDate: ${summary.ftdRowsByFtdDate.toLocaleString("en-US")}`,
      `totalLeads: ${summary.totalLeads.toLocaleString("en-US")}`,
      `totalFtd: ${summary.totalFtd.toLocaleString("en-US")}`,
      `cr: ${formatPercent(summary.cr)}`,
      `rawLeadCount: ${summary.rawLeadCount.toLocaleString("en-US")}`,
      `differentMonthCount: ${summary.differentMonthCount.toLocaleString("en-US")}`,
    );
  }

  return lines.join("\n");
}

function formatPerformanceList(title, items, suffix = "FTD") {
  if (!items.length) {
    return `${title}\nNo data found.`;
  }
  return [
    title,
    ...items.map(
      (item, index) =>
        `${index + 1}. ${item.label} — ${item.summary.totalFtd.toLocaleString("en-US")} ${suffix} / CR ${formatPercent(item.summary.cr)}`,
    ),
  ].join("\n");
}

function formatStatusDistribution(rows, tabConfig, filters, now) {
  const items = statusDistribution(rows, tabConfig, filters, now);
  if (!items.length) {
    return "Status Distribution\nNo data found.";
  }
  return [
    "Status Distribution",
    ...items.map(
      (item) =>
        `${item.label}: ${item.value.toLocaleString("en-US")} (${formatPercent(item.percentage)})`,
    ),
  ].join("\n");
}

function formatHourlyReport(rows, tabConfig, filters, now) {
  const items = hourlyDistribution(rows, tabConfig, filters, "created", "totalFtd", now);
  if (!items.length) {
    return "Hourly Report\nNo data found.";
  }
  return [
    "Hourly Report",
    ...items.map(
      (item) =>
        `${item.label} — Leads ${item.leads.toLocaleString("en-US")} / FTD ${item.ftd.toLocaleString("en-US")} / CR ${formatPercent(item.cr)}`,
    ),
  ].join("\n");
}

function fieldForBreakdown(key) {
  return {
    topAgents: "agentNames",
    agentPerformance: "agentNames",
    campaignBreakdown: "campaign",
    countryBreakdown: "country",
    teamLeaderBreakdown: "teamLeader",
    placementBreakdown: "placement",
  }[key];
}

export function formatBreakdown(key, session, rows, tabConfig, now = new Date()) {
  const filters = buildFilters(session);
  if (key === "statusDistribution") {
    return formatStatusDistribution(rows, tabConfig, filters, now);
  }
  if (key === "hourlyBreakdown" || key === "hourly") {
    return formatHourlyReport(rows, tabConfig, filters, now);
  }

  const fieldKey = fieldForBreakdown(key) || "agentNames";
  const title = {
    topAgents: "Top Agents by FTD",
    agentPerformance: "Agents by FTD and CR",
    campaignBreakdown: "Campaign Breakdown",
    countryBreakdown: "Country Breakdown",
    teamLeaderBreakdown: "Team Leader Breakdown",
    placementBreakdown: "Placement Breakdown",
  }[key] || "Breakdown";

  return formatPerformanceList(
    title,
    groupPerformance(rows, tabConfig, filters, fieldKey, 5, "totalFtd", now),
  );
}

export function formatTopPerformers(
  rows,
  tabConfig,
  now = new Date(),
  filters = {},
  dateRangeLabel = "All Data",
) {
  return [
    "Top Performers",
    `Date Range: ${dateRangeLabel}`,
    "",
    formatPerformanceList(
      "Top 10 Agents by FTD",
      groupPerformance(rows, tabConfig, filters, "agentNames", 10, "totalFtd", now),
    ),
    "",
    formatPerformanceList(
      "Top 10 Agents by CR (min 20 valid leads)",
      groupPerformance(rows, tabConfig, filters, "agentNames", 10, "cr", now, { minValidLeads: 20 }),
      "FTD",
    ),
  ].join("\n");
}

export function formatReport(session, rows, tabConfig, now = new Date(), options = {}) {
  const reportType = REPORT_TYPES[session.reportType];
  const report = generateReport({
    rows,
    tabConfig,
    groupField: reportType?.filterKey,
    selectedValue: session.selectedValue,
    dateRange: session.dateRange,
    now,
  });
  if (reportType?.filterExtra) {
    Object.assign(report.filters, reportType.filterExtra);
    report.summary = calculateSummary(rows, tabConfig, report.filters, now);
  }
  return formatSummary(reportTitle(session), report.dateRangeLabel, report.summary, {
    ...options,
    reportType: session.reportType,
    selectedValue: session.selectedValue,
    tabConfig,
  });
}

function selectedMonthRecord(session, now = new Date()) {
  const saved = session.monthKey ? getMonthFile(session.monthKey, { includeInactive: false }) : null;
  if (saved) {
    return saved;
  }
  return getMonthFile(currentMonthKey(now), { includeInactive: false }) || listMonthFiles()[0] || null;
}

function formatMonthFiles() {
  const records = listMonthFiles({ includeInactive: true });
  if (!records.length) {
    return "No month files configured yet.";
  }
  return [
    "Available month files:",
    ...records.map(
      (record) =>
        `- ${record.month_label}: ${record.sheet_id} [${record.active ? "Active" : "Inactive"}]`,
    ),
  ].join("\n");
}

function monthActionKeyboard(records, action) {
  const buttons = records.map((record) => {
    if (action === "toggle") {
      return {
        text: `${record.active ? "Hide" : "Show"} ${record.month_label}`,
        callbackData: `settingsToggle:${record.key}`,
      };
    }
    return {
      text: `Remove ${record.month_label}`,
      callbackData: `settingsRemove:${record.key}`,
    };
  });
  buttons.push({ text: "Back to Settings", callbackData: "settings:open" });
  return inlineKeyboard(chunkButtons(buttons, 1));
}

async function readReportData(readRows, tabConfig, infoAgentsTabConfig, spreadsheetId) {
  const rows = await readRows("leads", { tabConfig, spreadsheetId });
  let infoAgentRows = [];
  try {
    infoAgentRows = await readRows("infoAgents", { tabConfig: infoAgentsTabConfig, spreadsheetId });
  } catch {
    infoAgentRows = [];
  }
  return {
    rows,
    targetsMap: buildAgentTargetsMap(infoAgentRows),
  };
}

function parseMonthSheetInput(text) {
  const rawText = String(text || "").trim();
  if (!rawText) {
    return null;
  }
  const pipeParts = rawText.split("|").map((part) => part.trim()).filter(Boolean);
  if (pipeParts.length === 2) {
    return { month: pipeParts[0], spreadsheetId: pipeParts[1] };
  }
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return { month: lines[0], spreadsheetId: lines[1] };
  }
  return null;
}

function formatHistoricalGroupedReport(reportType, rows, tabConfig, monthRecord, targetsMap, now) {
  const monthFilter = monthFilterFromKey(monthRecord.key);
  const monthRows = getLeadRowsByDateRange(rows, tabConfig, { date: monthFilter }, now);
  const values = uniqueValues(monthRows, tabConfig, reportType.fieldKey, 200);
  const items = values
    .map((value) => {
      const summary = calculateSummary(
        rows,
        tabConfig,
        {
          ...(reportType.filterKey ? { [reportType.filterKey]: value } : {}),
          date: monthFilter,
        },
        now,
      );
      if (summary.totalLeads <= 0 && summary.totalFtd <= 0) {
        return null;
      }
      let target = 0;
      if (reportType.filterKey === "agent") {
        target = agentTarget(targetsMap, value);
      } else if (reportType.filterKey === "teamLeader" || reportType.filterKey === "office") {
        const groupFieldName = getFieldName(tabConfig, reportType.fieldKey);
        const scopedRows = monthRows.filter(
          (row) => normalizeText(getRowValue(row, groupFieldName)) === normalizeText(value),
        );
        target = summarizeTarget(collectAgentNames(scopedRows, tabConfig), targetsMap);
      }
      return {
        label: value,
        summary,
        target,
        reach: targetReachPercent(summary.totalFtd, target),
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.summary.totalFtd - left.summary.totalFtd || right.summary.totalLeads - left.summary.totalLeads,
    )
    .slice(0, 12);

  if (!items.length) {
    return `${reportType.label} Totals — ${monthRecord.label}\nNo data found.`;
  }

  return [
    `${reportType.label} Totals — ${monthRecord.label}`,
    ...items.map((item, index) => {
      if (
        reportType.filterKey === "agent" ||
        reportType.filterKey === "teamLeader" ||
        reportType.filterKey === "office"
      ) {
        return `${index + 1}. ${item.label} — FTD ${item.summary.totalFtd.toLocaleString("en-US")} / Target ${formatTarget(item.target)} / Reach ${formatOptionalPercent(item.reach)}`;
      }
      return `${index + 1}. ${item.label} — Leads ${item.summary.totalLeads.toLocaleString("en-US")} / FTD ${item.summary.totalFtd.toLocaleString("en-US")} / CR ${formatPercent(item.summary.cr)}`;
    }),
  ].join("\n");
}

function formatHistoricalTotalResults(rows, tabConfig, monthRecord, targetsMap, now) {
  const monthFilter = monthFilterFromKey(monthRecord.key);
  const summary = calculateSummary(rows, tabConfig, { date: monthFilter }, now);
  const monthRows = getLeadRowsByDateRange(rows, tabConfig, { date: monthFilter }, now);
  const totalTarget = summarizeTarget(collectAgentNames(monthRows, tabConfig), targetsMap);
  const reach = targetReachPercent(summary.totalFtd, totalTarget);
  return [
    `Total Results — ${monthRecord.label}`,
    `Total Leads: ${summary.totalLeads.toLocaleString("en-US")}`,
    `Total FTD: ${summary.totalFtd.toLocaleString("en-US")}`,
    `CR: ${formatPercent(summary.cr)}`,
    `Total Target: ${formatTarget(totalTarget)}`,
    `FTD Target Reach %: ${formatOptionalPercent(reach)}`,
  ].join("\n");
}

export async function startMenu(userId, options = {}) {
  clearSession(userId);
  setSession(userId, { step: "select_month" });
  return {
    text: MONTH_MENU_TEXT,
    replyMarkup: monthKeyboard(options.telegramUser),
  };
}

export async function handleMenuCallback(userId, callbackData, options = {}) {
  const tabConfig = options.tabConfig || getTabConfig("leads");
  const infoAgentsTabConfig = options.infoAgentsTabConfig || getTabConfig("infoAgents");
  const readRows = options.readRows || readSheetRows;
  const now = options.now || new Date();
  const telegramUser = options.telegramUser;

  if (callbackData === "menu:main") {
    return startMenu(userId, { telegramUser });
  }

  if (callbackData === "menu:filters") {
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    setSession(userId, {
      monthKey: month.key,
      monthLabel: month.label,
      spreadsheetId: month.spreadsheetId,
      isHistorical: isPastMonthKey(month.key, now),
      step: "select_report_type",
    });
    return {
      text: `Month: ${month.label}\n${MAIN_MENU_TEXT}`,
      replyMarkup: mainMenuKeyboard(telegramUser),
    };
  }

  const [action, value] = String(callbackData || "").split(":");

  if (action === "month") {
    const month = getMonthFile(value, { includeInactive: false });
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    setSession(userId, {
      monthKey: month.key,
      monthLabel: month.label,
      spreadsheetId: month.spreadsheetId,
      isHistorical: isPastMonthKey(month.key, now),
      reportType: null,
      selectedValue: null,
      dateRange: null,
      options: [],
      step: "select_report_type",
    });
    return {
      text: `Month: ${month.label}\n${MAIN_MENU_TEXT}`,
      replyMarkup: mainMenuKeyboard(telegramUser),
    };
  }

  if (action === "settings") {
    if (!isSettingsAdminTelegramUser(telegramUser)) {
      return {
        text: "Only @antoniotsd can access Settings.",
        replyMarkup: monthKeyboard(telegramUser),
      };
    }
    if (value === "open") {
      setSession(userId, { step: "settings_menu" });
      return { text: SETTINGS_MENU_TEXT, replyMarkup: settingsKeyboard() };
    }
    if (value === "list") {
      return { text: formatMonthFiles(), replyMarkup: settingsKeyboard() };
    }
    if (value === "remove") {
      const records = listMonthFiles({ includeInactive: true });
      if (!records.length) {
        return { text: "No month files to remove.", replyMarkup: settingsKeyboard() };
      }
      return {
        text: "Select month to remove:",
        replyMarkup: monthActionKeyboard(records, "remove"),
      };
    }
    if (value === "visibility") {
      const records = listMonthFiles({ includeInactive: true });
      if (!records.length) {
        return { text: "No month files to update.", replyMarkup: settingsKeyboard() };
      }
      return {
        text: "Select month to hide/show:",
        replyMarkup: monthActionKeyboard(records, "toggle"),
      };
    }
    if (value === "add") {
      setSession(userId, { step: "settings_wait_month_file" });
      return {
        text: "Send month mapping as:\nMay 2026 | GOOGLE_SHEET_ID_OR_URL",
        replyMarkup: settingsKeyboard(),
      };
    }
  }

  if (action === "settingsRemove") {
    if (!isSettingsAdminTelegramUser(telegramUser)) {
      return {
        text: "Only @antoniotsd can manage month mappings.",
        replyMarkup: monthKeyboard(telegramUser),
      };
    }
    const month = getMonthFile(value, { includeInactive: true });
    if (!month) {
      return { text: "Month mapping not found.", replyMarkup: settingsKeyboard() };
    }
    removeMonthFile(value);
    return {
      text: `Removed month file: ${month.month_label}`,
      replyMarkup: settingsKeyboard(),
    };
  }

  if (action === "settingsToggle") {
    if (!isSettingsAdminTelegramUser(telegramUser)) {
      return {
        text: "Only @antoniotsd can manage month mappings.",
        replyMarkup: monthKeyboard(telegramUser),
      };
    }
    const month = getMonthFile(value, { includeInactive: true });
    if (!month) {
      return { text: "Month mapping not found.", replyMarkup: settingsKeyboard() };
    }
    const updated = setMonthFileActive(value, !month.active);
    return {
      text: `${updated.month_label} is now ${updated.active ? "Active" : "Inactive"}.`,
      replyMarkup: settingsKeyboard(),
    };
  }

  if (action === "report") {
    const reportType = REPORT_TYPES[value];
    if (!reportType) {
      return startMenu(userId, { telegramUser });
    }
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return {
        text: "No month files configured. Ask @antoniotsd to add one in Settings.",
        replyMarkup: monthKeyboard(telegramUser),
      };
    }

    const isHistoricalMonth = isPastMonthKey(month.key, now);
    setSession(userId, {
      monthKey: month.key,
      monthLabel: month.label,
      spreadsheetId: month.spreadsheetId,
      isHistorical: isHistoricalMonth,
      reportType: value,
      selectedValue: null,
      dateRange: null,
      options: [],
    });

    if (isHistoricalMonth) {
      const { rows, targetsMap } = await readReportData(
        readRows,
        tabConfig,
        infoAgentsTabConfig,
        month.spreadsheetId,
      );
      return {
        text:
          value === "totalResults"
            ? formatHistoricalTotalResults(rows, tabConfig, month, targetsMap, now)
            : formatHistoricalGroupedReport(reportType, rows, tabConfig, month, targetsMap, now),
        replyMarkup: mainMenuKeyboard(telegramUser),
      };
    }

    if (value === "totalResults") {
      setSession(userId, {
        step: "select_date",
      });
      return {
        text: "Select date range:",
        replyMarkup: dateRangeKeyboard(),
      };
    }

    const rows = await readRows("leads", { tabConfig, spreadsheetId: month.spreadsheetId });
    const values = uniqueValues(rows, tabConfig, reportType.fieldKey);
    setSession(userId, {
      options: values,
      step: "select_value",
    });
    return {
      text: values.length
        ? `Select ${reportType.label.toLocaleLowerCase("en-US")}:\nMonth: ${month.label}`
        : `No ${reportType.label.toLocaleLowerCase("en-US")} values found in the sheet.`,
      replyMarkup: valueKeyboard(values),
    };
  }

  if (action === "value") {
    const session = getSession(userId);
    const selectedValue = session.options?.[Number(value)];
    if (!selectedValue) {
      return startMenu(userId, { telegramUser });
    }
    setSession(userId, {
      selectedValue,
      step: "select_date",
    });
    const reportType = REPORT_TYPES[session.reportType];
    return {
      text: `${reportType?.label || "Filter"}: ${selectedValue}\nSelect date range:`,
      replyMarkup: dateRangeKeyboard(),
    };
  }

  if (action === "date") {
    const session = getSession(userId);
    const dateRange = dateRangeByKey(value, now);
    if (dateRange.unsupported) {
      setSession(userId, {
        step: "custom_date_range",
      });
      return {
        text: "Send custom date range as:\nDD/MM/YYYY - DD/MM/YYYY",
        replyMarkup: inlineKeyboard([[{ text: "Back to Report Filters", callbackData: "menu:filters" }]]),
      };
    }
    const nextSession = setSession(userId, {
      dateRange,
      step: "report_ready",
    });
    const month = selectedMonthRecord(nextSession, now);
    const { rows, targetsMap } = await readReportData(
      readRows,
      tabConfig,
      infoAgentsTabConfig,
      month?.spreadsheetId,
    );
    return {
      text: formatReport(nextSession, rows, tabConfig, now, { targetsMap }),
      replyMarkup:
        nextSession.reportType === "totalResults"
          ? mainMenuKeyboard(telegramUser)
          : postReportKeyboard(nextSession.reportType),
    };
  }

  if (action === "breakdown") {
    const session = getSession(userId);
    if (session.isHistorical) {
      return {
        text: "Detailed breakdowns are disabled for past months.",
        replyMarkup: mainMenuKeyboard(telegramUser),
      };
    }
    const month = selectedMonthRecord(session, now);
    const rows = await readRows("leads", { tabConfig, spreadsheetId: month?.spreadsheetId });
    return {
      text: formatBreakdown(value, session, rows, tabConfig, now),
      replyMarkup: postReportKeyboard(session.reportType),
    };
  }

  return startMenu(userId, { telegramUser });
}

export async function handleMenuText(userId, text, options = {}) {
  const session = getSession(userId);
  const telegramUser = options.telegramUser;
  const now = options.now || new Date();

  if (session.step === "settings_wait_month_file") {
    if (!isSettingsAdminTelegramUser(telegramUser)) {
      return {
        text: "Only @antoniotsd can update month mappings.",
        replyMarkup: monthKeyboard(telegramUser),
      };
    }
    const parsed = parseMonthSheetInput(text);
    if (!parsed) {
      return {
        text: "Invalid format. Send as:\nMay 2026 | GOOGLE_SHEET_ID_OR_URL",
        replyMarkup: settingsKeyboard(),
      };
    }
    try {
      const record = upsertMonthFile(parsed.month, parsed.spreadsheetId);
      setSession(userId, { step: "settings_menu" });
      return {
        text: `Saved: ${record.month_label} -> ${record.sheet_id}`,
        replyMarkup: settingsKeyboard(),
      };
    } catch (error) {
      return {
        text: `Could not save mapping: ${error.message}`,
        replyMarkup: settingsKeyboard(),
      };
    }
  }

  if (session.step !== "custom_date_range") {
    return null;
  }

  const tabConfig = options.tabConfig || getTabConfig("leads");
  const infoAgentsTabConfig = options.infoAgentsTabConfig || getTabConfig("infoAgents");
  const readRows = options.readRows || readSheetRows;
  const dateRange = parseCustomDateRange(text);
  if (!dateRange) {
    return {
      text: "Invalid range. Please send it as:\nDD/MM/YYYY - DD/MM/YYYY",
      replyMarkup: inlineKeyboard([[{ text: "Back to Report Filters", callbackData: "menu:filters" }]]),
    };
  }

  const nextSession = setSession(userId, {
    dateRange,
    step: "report_ready",
  });
  const month = selectedMonthRecord(nextSession, now);
  const { rows, targetsMap } = await readReportData(
    readRows,
    tabConfig,
    infoAgentsTabConfig,
    month?.spreadsheetId,
  );
  return {
    text: formatReport(nextSession, rows, tabConfig, now, { targetsMap }),
    replyMarkup:
      nextSession.reportType === "totalResults"
        ? mainMenuKeyboard(telegramUser)
        : postReportKeyboard(nextSession.reportType),
  };
}
