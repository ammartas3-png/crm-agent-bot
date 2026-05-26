import { getTabConfig } from "../config/sheetsConfig.js";
import {
  calculateSummary,
  hourlyDistribution,
  filteredRows,
  formatPercent,
  getFieldName,
  getRowValue,
  normalizeText,
  onlyDateFilters,
  parseDateValue,
  uniqueValues,
  withoutDateFilters,
} from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import {
  currentMonthKey,
  getMonthFile,
  listMonthFiles,
  monthFilterFromKey,
  parseMonthKey,
  removeMonthFile,
  setMonthFileActive,
  upsertMonthFile,
} from "./monthlyReports.js";
import { isSettingsAdminTelegramUser } from "./permissions.js";
import { clearSession, getSession, setSession } from "./session.js";
import {
  buildInfoAgentsContext,
  formatOptionalPercent,
  formatTarget,
  infoAgentsLabelsForGroup,
  normalizeAgentName,
  targetAggregationForScope,
  targetReachPercent,
} from "./targets.js";
import { buildLast4AllWorkbookBuffer, buildReportWorkbookBuffer } from "./reportWorkbookExporter.js";

export const MAIN_MENU_TEXT = "Select report filter:";
const MONTH_MENU_TEXT = "Select report month:";
const DATE_MENU_TEXT = "Select date filter:";
const SETTINGS_MENU_TEXT = "Settings";
const SPECIFIC_MENU_TEXT = "Specific Reports";
const TELEGRAM_TEXT_LIMIT = 3600;
const DAY_MS = 24 * 60 * 60 * 1000;

const REPORT_TYPES = {
  office: { label: "Office", fieldKey: "office" },
  teamLeader: { label: "Team Leader", fieldKey: "teamLeader" },
  agent: { label: "Agent", fieldKey: "agentNames" },
  country: { label: "Country", fieldKey: "country" },
  campaign: { label: "Campaign", fieldKey: "campaign" },
};
const LAST4_REPORT_TYPES = new Set(["office", "teamLeader", "agent"]);

const HIERARCHY_NEXT = {
  office: { mode: "list", fieldKey: "teamLeader", label: "Team Leaders" },
  teamLeader: { mode: "list", fieldKey: "agentNames", label: "Agents" },
  agent: { mode: "detail", fieldKey: "agentNames", label: "Agent" },
  country: { mode: "dimension", label: "Country Breakdown" },
  campaign: { mode: "dimension", label: "Campaign Breakdown" },
};

const DIMENSION_OPTIONS = [
  { label: "By Office", fieldKey: "office" },
  { label: "By Team Leader", fieldKey: "teamLeader" },
  { label: "By Agent", fieldKey: "agentNames" },
];

const DETAIL_NEXT_FIELD = {
  office: "teamLeader",
  teamLeader: "agentNames",
  agentNames: "country",
  country: "campaign",
  campaign: "placement",
};

const DETAIL_NEXT_BUTTON_LABEL = {
  teamLeader: "View Team Leaders",
  agentNames: "View Agents",
  country: "View Countries",
  campaign: "View Campaigns",
  placement: "View Placements",
};

export function isGreeting(text) {
  return /^(\/?start|hello|hi|selam|merhaba)$/i.test(String(text || "").trim());
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
    text: month.month_label,
    callbackData: `month:${month.key}`,
  }));
  const rows = chunkButtons(monthButtons, 2);
  rows.push([{ text: "Last 4 Months", callbackData: "month:last4" }]);
  if (isSettingsAdminTelegramUser(telegramUser)) {
    rows.push([{ text: SETTINGS_MENU_TEXT, callbackData: "settings:open" }]);
  }
  return inlineKeyboard(rows);
}

export function mainMenuKeyboard(telegramUser, options = {}) {
  const onlyCore = Boolean(options.onlyCore);
  const last4Mode = Boolean(options.last4Mode);
  const rows = [
    [{ text: "Office", callbackData: "report:office" }],
    [{ text: "Team Leader", callbackData: "report:teamLeader" }],
    [{ text: "Agent", callbackData: "report:agent" }],
  ];
  if (!onlyCore) {
    rows.push([{ text: "Country", callbackData: "report:country" }]);
    rows.push([{ text: "Campaign", callbackData: "report:campaign" }]);
    rows.push([{ text: "Specific Reports", callbackData: "special:open" }]);
  }
  if (last4Mode) {
    rows.push([{ text: "All (Excel)", callbackData: "export:last4all" }]);
  }
  rows.push([{ text: "Change Month", callbackData: "menu:main" }]);
  if (isSettingsAdminTelegramUser(telegramUser)) {
    rows.push([{ text: SETTINGS_MENU_TEXT, callbackData: "settings:open" }]);
  }
  return inlineKeyboard(rows);
}

function dateFilterKeyboard() {
  return inlineKeyboard([
    [{ text: "Total Month", callbackData: "date:month" }],
    [{ text: "Yesterday", callbackData: "date:yesterday" }],
    [{ text: "This Week", callbackData: "date:thisWeek" }],
    [{ text: "Last Week", callbackData: "date:lastWeek" }],
    [{ text: "Custom Date Range", callbackData: "date:custom" }],
    [{ text: "Back to Month Selection", callbackData: "menu:main" }],
  ]);
}

function specificReportsKeyboard() {
  return inlineKeyboard([
    [{ text: "Hourly Leads", callbackData: "special:hourly" }],
    [{ text: "Country Comparison", callbackData: "special:compareCountry" }],
    [{ text: "Back to Report Filters", callbackData: "menu:filters" }],
    [{ text: "Change Month", callbackData: "menu:main" }],
  ]);
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

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function weekBounds(now = new Date(), offsetWeeks = 0) {
  const today = startOfUtcDay(now);
  const weekDay = (today.getUTCDay() + 6) % 7;
  const start = new Date(today.getTime() - weekDay * DAY_MS + offsetWeeks * 7 * DAY_MS);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return { start, end };
}

function dateSelectionForPreset(month, preset, now = new Date()) {
  const parsedMonth = parseMonthKey(month?.key);
  const monthFilter = parsedMonth ? monthFilterFromKey(parsedMonth.key) : null;
  if (preset === "month") {
    return {
      key: "month",
      label: "Total Month",
      filter: monthFilter,
    };
  }

  if (preset === "yesterday") {
    const yesterday = new Date(startOfUtcDay(now).getTime() - DAY_MS);
    return {
      key: preset,
      label: "Yesterday",
      filter: { type: "range", start: isoDate(yesterday), end: isoDate(yesterday) },
    };
  }

  if (preset === "thisWeek") {
    const bounds = weekBounds(now, 0);
    return {
      key: preset,
      label: "This Week",
      filter: { type: "range", start: isoDate(bounds.start), end: isoDate(bounds.end) },
    };
  }

  if (preset === "lastWeek") {
    const bounds = weekBounds(now, -1);
    return {
      key: preset,
      label: "Last Week",
      filter: { type: "range", start: isoDate(bounds.start), end: isoDate(bounds.end) },
    };
  }

  return {
    key: "month",
    label: "Total Month",
    filter: monthFilter,
  };
}

function selectedDateConfig(session, month, now = new Date()) {
  if (session.dateFilter && session.dateFilterLabel) {
    return {
      key: session.dateFilterKey || "custom",
      label: session.dateFilterLabel,
      filter: session.dateFilter,
    };
  }
  return dateSelectionForPreset(month, "month", now);
}

function reportFilterTitle(month, dateConfig, session = {}) {
  const monthLabel = session.last3Mode ? session.monthLabel || "Last 4 Months" : month.month_label;
  const headerLabel = session.last3Mode ? "Period" : "Month";
  const lines = [`${headerLabel}: ${monthLabel}`];
  if (!session.last3Mode) {
    lines.push(`Date: ${dateConfig.label}`);
  }
  lines.push(MAIN_MENU_TEXT);
  return lines.join("\n");
}

function withDateFilter(baseFilters = {}, dateConfig = null) {
  if (!dateConfig?.filter) {
    return { ...baseFilters };
  }
  return { ...baseFilters, date: dateConfig.filter };
}

function formatHourlyReport(title, distribution = []) {
  if (!distribution.length) {
    return `${title}\nNo data found.`;
  }
  const lines = [title];
  for (const item of distribution) {
    const line = `${item.label} | Lead ${item.value.toLocaleString("en-US")} | FTD ${item.ftd.toLocaleString(
      "en-US",
    )} | CR ${formatPercent(item.cr)}`;
    if ([...lines, line].join("\n").length > TELEGRAM_TEXT_LIMIT) {
      lines.push("...more rows available");
      break;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function hourlyReportKeyboard(options = {}) {
  const rows = [];
  if (options.changeScopeCallback) {
    rows.push([{ text: options.changeScopeLabel || "Change Scope", callbackData: options.changeScopeCallback }]);
  }
  rows.push([{ text: "By Country", callbackData: "special:hourlyScope:country" }]);
  rows.push([{ text: "By Agent", callbackData: "special:hourlyScope:agentNames" }]);
  rows.push([{ text: "By Team Leader", callbackData: "special:hourlyScope:teamLeader" }]);
  rows.push([{ text: "By Office", callbackData: "special:hourlyScope:office" }]);
  rows.push([{ text: "Hourly Date: Total Month", callbackData: "special:hourlyDate:month" }]);
  rows.push([{ text: "Hourly Date: Yesterday", callbackData: "special:hourlyDate:yesterday" }]);
  rows.push([{ text: "Hourly Date: This Week", callbackData: "special:hourlyDate:thisWeek" }]);
  rows.push([{ text: "Hourly Date: Last Week", callbackData: "special:hourlyDate:lastWeek" }]);
  rows.push([{ text: "Hourly Date: Custom Range", callbackData: "special:hourlyDate:custom" }]);
  rows.push([{ text: "Back to Specific Reports", callbackData: "special:open" }]);
  rows.push([{ text: "Back to Report Filters", callbackData: "menu:filters" }]);
  rows.push([{ text: "Change Month", callbackData: "menu:main" }]);
  return inlineKeyboard(rows);
}

function listSelectionKeyboard({ values = [], page = 0, pickPrefix, backCallback }) {
  const { chunk, start, totalPages, page: safePage } = paginateItems(values, page, 10);
  const rows = chunkButtons(
    chunk.map((label, index) => ({
      text: label,
      callbackData: `${pickPrefix}:${start + index}`,
    })),
    2,
  );
  if (totalPages > 1) {
    rows.push([
      { text: "Previous Page", callbackData: `specialPage:${Math.max(safePage - 1, 0)}` },
      { text: "Next Page", callbackData: `specialPage:${Math.min(safePage + 1, totalPages - 1)}` },
    ]);
  }
  rows.push([{ text: "Back", callbackData: backCallback }]);
  rows.push([{ text: "Back to Specific Reports", callbackData: "special:open" }]);
  rows.push([{ text: "Back to Report Filters", callbackData: "menu:filters" }]);
  rows.push([{ text: "Change Month", callbackData: "menu:main" }]);
  return inlineKeyboard(rows);
}

function rankingLines(title, rows, tabConfig, filters, fieldKey, now = new Date()) {
  const rowsWithoutDate = filteredRows(rows, tabConfig, withoutDateFilters(filters), now);
  const fieldName = getFieldName(tabConfig, fieldKey);
  const groups = new Map();
  for (const row of rowsWithoutDate) {
    const label = String(getRowValue(row, fieldName) || "").trim();
    if (!label) {
      continue;
    }
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(row);
  }
  const ranked = [...groups.entries()]
    .map(([label, groupRows]) => {
      const summary = calculateSummary(groupRows, tabConfig, onlyDateFilters(filters), now);
      return {
        label,
        summary,
        sortReach:
          summary.crTarget > 0 && Number.isFinite(summary.crTargetReach)
            ? summary.crTargetReach
            : Number.NEGATIVE_INFINITY,
      };
    })
    .sort(
      (left, right) =>
        right.sortReach - left.sortReach ||
        right.summary.totalFtd - left.summary.totalFtd ||
        right.summary.cr - left.summary.cr ||
        right.summary.totalLeads - left.summary.totalLeads,
    );
  if (!ranked.length) {
    return [`${title}: no data`];
  }
  const lines = [title];
  for (let index = 0; index < ranked.length; index += 1) {
    const item = ranked[index];
    const reachDisplay =
      item.summary.crTarget > 0 ? formatOptionalPercent(item.summary.crTargetReach) : "-";
    const line = `${index + 1}. ${item.label} | Lead ${item.summary.totalLeads.toLocaleString(
      "en-US",
    )} | FTD ${item.summary.totalFtd.toLocaleString("en-US")} | CR ${formatPercent(
      item.summary.cr,
    )} | CR Target Reach ${reachDisplay}`;
    if ([...lines, line].join("\n").length > TELEGRAM_TEXT_LIMIT) {
      lines.push("...more rows available");
      break;
    }
    lines.push(line);
  }
  return lines;
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

function selectedMonthRecord(session, now = new Date()) {
  const saved = session.monthKey ? getMonthFile(session.monthKey, { includeInactive: false }) : null;
  if (saved) {
    return saved;
  }
  return getMonthFile(currentMonthKey(now), { includeInactive: false }) || listMonthFiles()[0] || null;
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

function getLastFourMonthRecords(now = new Date()) {
  const activeMonths = listMonthFiles()
    .filter((month) => month.active !== false)
    .sort((left, right) => right.key.localeCompare(left.key));
  const preferred = activeMonths.filter((month) => month.key <= currentMonthKey(now));
  const source = preferred.length ? preferred : activeMonths;
  return source.slice(0, 4);
}

function currentInfoMonthRecord(last4Records = [], now = new Date()) {
  const current = getMonthFile(currentMonthKey(now), { includeInactive: false });
  if (current) {
    return current;
  }
  return last4Records[0] || null;
}

function remapRowsToCurrentInfo(rows = [], tabConfig, infoContext) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const officeField = getFieldName(tabConfig, "office");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  return rows.map((row) => {
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    const currentRecord = normalizedAgent ? infoContext?.byAgent?.get(normalizedAgent) : null;
    if (!currentRecord) {
      return row;
    }
    return {
      ...row,
      [agentField]: currentRecord.agent_name || getRowValue(row, agentField),
      [officeField]: currentRecord.office || getRowValue(row, officeField),
      [teamLeaderField]: currentRecord.team_leader || getRowValue(row, teamLeaderField),
    };
  });
}

function mergedMonthlyContext(monthContext, currentContext) {
  if (!monthContext) {
    return currentContext;
  }
  if (!currentContext) {
    return monthContext;
  }
  return {
    ...monthContext,
    officeAgentsAll: currentContext.officeAgentsAll,
    teamLeaderAgentsAll: currentContext.teamLeaderAgentsAll,
    teamLeadersByOfficeAll: currentContext.teamLeadersByOfficeAll,
    officeAgents: currentContext.officeAgents,
    teamLeaderAgents: currentContext.teamLeaderAgents,
    teamLeadersByOffice: currentContext.teamLeadersByOffice,
    offices: currentContext.offices,
    teamLeaders: currentContext.teamLeaders,
    agents: currentContext.agents,
    allAgents: currentContext.allAgents,
    canonicalOfficeByKey: currentContext.canonicalOfficeByKey,
    canonicalTeamLeaderByKey: currentContext.canonicalTeamLeaderByKey,
    canonicalAgentByKey: currentContext.canonicalAgentByKey,
  };
}

async function readReportData(readRows, tabConfig, infoAgentsTabConfig, spreadsheetId, options = {}) {
  if (options.last3Mode) {
    const months = options.last3MonthKeys?.length
      ? options.last3MonthKeys
          .map((key) => getMonthFile(key, { includeInactive: false }))
          .filter(Boolean)
      : getLastFourMonthRecords(options.now || new Date());
    const mergedRows = [];
    const monthInfoContextByKey = {};
    for (const month of months) {
      const monthRows = await readRows("leads", { tabConfig, spreadsheetId: month.sheet_id });
      let monthInfoRows = [];
      try {
        monthInfoRows = await readRows("infoAgents", {
          tabConfig: infoAgentsTabConfig,
          spreadsheetId: month.sheet_id,
        });
      } catch {
        monthInfoRows = [];
      }
      monthInfoContextByKey[month.key] = buildInfoAgentsContext(monthInfoRows);
      mergedRows.push(
        ...monthRows.map((row) => ({
          ...row,
          __reportMonthKey: month.key,
          __reportMonthLabel: month.month_label,
        })),
      );
    }
    const infoMonth = currentInfoMonthRecord(months, options.now || new Date());
    const infoContext = (infoMonth && monthInfoContextByKey[infoMonth.key]) || buildInfoAgentsContext([]);
    const remappedRows = remapRowsToCurrentInfo(mergedRows, tabConfig, infoContext);
    return {
      rows: remappedRows,
      targetsMap: infoContext.targetsByAgent,
      infoContext,
      monthInfoContextByKey,
      months,
    };
  }

  const rows = await readRows("leads", { tabConfig, spreadsheetId });
  let infoAgentRows = [];
  try {
    infoAgentRows = await readRows("infoAgents", { tabConfig: infoAgentsTabConfig, spreadsheetId });
  } catch {
    infoAgentRows = [];
  }
  const infoContext = buildInfoAgentsContext(infoAgentRows);
  return {
    rows,
    targetsMap: infoContext.targetsByAgent,
    infoContext,
  };
}

function metricLabelForField(fieldKey) {
  return (
    {
      office: "Office",
      teamLeader: "Team Leader",
      agentNames: "Agent",
      country: "Country",
      campaign: "Campaign",
      placement: "Placement",
    }[fieldKey] || "Result"
  );
}

function metricPayload(
  summary,
  groupField,
  selectedLabel,
  scopeFilters,
  tabConfig,
  targetsMap,
  infoContext,
  now = new Date(),
  options = {},
) {
  const effectiveInfoContext = options.infoContext || infoContext;
  const targetAggregation = targetAggregationForScope({
    rows: summary.contextRows || [],
    tabConfig,
    infoContext: effectiveInfoContext,
    filters: onlyDateFilters(scopeFilters),
    scope: {
      groupField,
      office: scopeFilters.office,
      teamLeader: scopeFilters.teamLeader,
      agent: scopeFilters.agent,
    },
    now,
  });
  const ftdTarget = targetAggregation.includedTarget;
  const ftdTargetReach = targetReachPercent(summary.totalFtd, ftdTarget);
  return {
    lead: summary.totalLeads,
    ftd: summary.totalFtd,
    cr: summary.cr,
    selfs: summary.selfs || 0,
    lateFtd: summary.lateFtd,
    crTarget: summary.crTarget,
    crTargetReach: summary.crTargetReach,
    ftdTarget,
    ftdTargetReach,
  };
}

function formatLast4MetricValues(metrics) {
  const crDisplay = metrics.lead > 0 ? formatPercent(metrics.cr) : "-";
  const crTargetReachDisplay =
    metrics.lead > 0 && metrics.crTarget > 0 ? formatPercent(metrics.crTargetReach) : "-";
  const ftdTargetReachDisplay =
    metrics.ftdTarget > 0 ? formatOptionalPercent(metrics.ftdTargetReach) : "-";
  return [
    `Target ${formatTarget(metrics.ftdTarget)}`,
    `FTD ${metrics.ftd.toLocaleString("en-US")}`,
    `CR ${crDisplay}`,
    `CR Target Reach ${crTargetReachDisplay}`,
    `FTD Target Reach ${ftdTargetReachDisplay}`,
  ].join(" | ");
}

function formatMetricLine(label, metrics, mode = "full") {
  if (mode === "last4") {
    return [`${label}`, formatLast4MetricValues(metrics)].join(" | ");
  }
  const crDisplay = metrics.lead > 0 ? formatPercent(metrics.cr) : "-";
  const crTargetDisplay = metrics.crTarget > 0 ? formatPercent(metrics.crTarget) : "-";
  const crTargetReachDisplay =
    metrics.lead > 0 && metrics.crTarget > 0 ? formatPercent(metrics.crTargetReach) : "-";
  const ftdTargetReachDisplay =
    metrics.ftdTarget > 0 ? formatOptionalPercent(metrics.ftdTargetReach) : "-";
  return [
    `${label}`,
    `Lead ${metrics.lead.toLocaleString("en-US")}`,
    `FTD ${metrics.ftd.toLocaleString("en-US")}`,
    `CR ${crDisplay}`,
    `Selfs ${metrics.selfs.toLocaleString("en-US")}`,
    `Late FTD ${metrics.lateFtd.toLocaleString("en-US")}`,
    `CR Target ${crTargetDisplay}`,
    `CR Target Reach ${crTargetReachDisplay}`,
    `FTD Target ${formatTarget(metrics.ftdTarget)}`,
    `FTD Target Reach ${ftdTargetReachDisplay}`,
  ].join(" | ");
}

function formatMetricBlock(title, metrics, mode = "full") {
  if (mode === "last4") {
    return [
      title,
      formatLast4MetricValues(metrics),
    ].join("\n");
  }
  const crDisplay = metrics.lead > 0 ? formatPercent(metrics.cr) : "-";
  const crTargetDisplay = metrics.crTarget > 0 ? formatPercent(metrics.crTarget) : "-";
  const crTargetReachDisplay =
    metrics.lead > 0 && metrics.crTarget > 0 ? formatPercent(metrics.crTargetReach) : "-";
  const ftdTargetReachDisplay =
    metrics.ftdTarget > 0 ? formatOptionalPercent(metrics.ftdTargetReach) : "-";
  return [
    title,
    `Lead: ${metrics.lead.toLocaleString("en-US")}`,
    `FTD: ${metrics.ftd.toLocaleString("en-US")}`,
    `CR: ${crDisplay}`,
    `Selfs: ${metrics.selfs.toLocaleString("en-US")}`,
    `Late FTD: ${metrics.lateFtd.toLocaleString("en-US")}`,
    `CR Target: ${crTargetDisplay}`,
    `CR Target Reach: ${crTargetReachDisplay}`,
    `FTD Target: ${formatTarget(metrics.ftdTarget)}`,
    `FTD Target Reach: ${ftdTargetReachDisplay}`,
  ].join("\n");
}

function fieldToFilterKey(fieldKey) {
  return (
    {
      office: "office",
      teamLeader: "teamLeader",
      agentNames: "agent",
      country: "country",
      campaign: "campaign",
      placement: "placement",
    }[fieldKey] || fieldKey
  );
}

function applyFieldFilter(filters, fieldKey, value) {
  const next = { ...filters };
  const filterKey = fieldToFilterKey(fieldKey);
  next[filterKey] = value;
  if (fieldKey === "agentNames") {
    next.agentField = "agentNames";
  }
  return next;
}

function buildGroupItems(
  rows,
  tabConfig,
  baseFilters,
  groupField,
  targetsMap,
  infoContext,
  now = new Date(),
  options = {},
) {
  const fieldName = getFieldName(tabConfig, groupField);
  const rowsWithoutDate = filteredRows(rows, tabConfig, withoutDateFilters(baseFilters), now);
  const groups = new Map();
  const displayByKey = new Map();
  for (const row of rowsWithoutDate) {
    const label = String(getRowValue(row, fieldName) || "").trim();
    if (!label) {
      continue;
    }
    const key = normalizeText(label);
    if (!key) {
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      displayByKey.set(key, label);
    }
    groups.get(key).push(row);
  }

  const rosterLabels = infoAgentsLabelsForGroup(infoContext, groupField, baseFilters);
  for (const label of rosterLabels) {
    const key = normalizeText(label);
    if (!key) {
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      displayByKey.set(key, label);
    }
  }

  const dateFilters = onlyDateFilters(baseFilters);
  const monthBreakdownMonths = options.monthBreakdownMonths || [];
  const monthContextByKey = options.monthContextByKey || {};
  const includeMonthBreakdown = options.metricsMode === "last4" && monthBreakdownMonths.length > 0;
  return [...groups.entries()]
    .map(([key, groupRows]) => {
      const label = displayByKey.get(key) || key;
      const summary = calculateSummary(groupRows, tabConfig, dateFilters, now);
      const scopeFilters = applyFieldFilter(baseFilters, groupField, label);
      const monthlyMetrics = includeMonthBreakdown
        ? monthBreakdownMonths.map((month) => {
            const monthRows = groupRows.filter((row) => row.__reportMonthKey === month.key);
            const monthSummary = calculateSummary(monthRows, tabConfig, dateFilters, now);
            return {
              monthKey: month.key,
              monthLabel: month.shortLabel || month.month_label,
              metrics: metricPayload(
                monthSummary,
                groupField,
                label,
                scopeFilters,
                tabConfig,
                targetsMap,
                infoContext,
                now,
                {
                  infoContext: mergedMonthlyContext(monthContextByKey[month.key], infoContext),
                },
              ),
            };
          })
        : [];
      const baseMetrics = metricPayload(
        summary,
        groupField,
        label,
        scopeFilters,
        tabConfig,
        targetsMap,
        infoContext,
        now,
      );
      const metrics = includeMonthBreakdown
        ? (() => {
            const totalTarget = monthlyMetrics.reduce((sum, monthItem) => sum + Number(monthItem.metrics.ftdTarget || 0), 0);
            return {
              ...baseMetrics,
              ftdTarget: totalTarget,
              ftdTargetReach: targetReachPercent(summary.totalFtd, totalTarget),
            };
          })()
        : baseMetrics;
      return {
        label,
        summary,
        metrics,
        monthlyMetrics,
      };
    })
    .sort(
      (left, right) =>
        right.summary.totalFtd - left.summary.totalFtd ||
        right.summary.cr - left.summary.cr ||
        right.summary.totalLeads - left.summary.totalLeads,
    );
}

function paginateItems(items, page, firstItemLimit = 10) {
  if (!items.length) {
    return { page: 0, totalPages: 1, start: 0, chunk: [] };
  }
  const totalPages = Math.max(1, Math.ceil(items.length / firstItemLimit));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * firstItemLimit;
  const chunk = items.slice(start, start + firstItemLimit);
  return { page: safePage, totalPages, start, chunk };
}

function buildListKeyboard(view, pageChunk, start, page, totalPages) {
  const rows = chunkButtons(
    pageChunk.map((item, index) => ({
      text: item.label,
      callbackData: `drill:pick:${start + index}`,
    })),
    2,
  );

  if (view.dimensionOptions?.length) {
    rows.push(
      view.dimensionOptions.map((option) => ({
        text: option.label,
        callbackData: `drill:dimension:${option.fieldKey}`,
      })),
    );
  }

  if (totalPages > 1) {
    rows.push([
      { text: "Previous Page", callbackData: `drill:page:${Math.max(page - 1, 0)}` },
      { text: "Next Page", callbackData: `drill:page:${Math.min(page + 1, totalPages - 1)}` },
    ]);
  }

  if (view.backStack?.length) {
    rows.push([{ text: "Back to previous level", callbackData: "drill:back" }]);
  }

  rows.push([{ text: "Export Excel", callbackData: "export:current" }]);
  rows.push([{ text: "Back to Report Filters", callbackData: "menu:filters" }]);
  rows.push([{ text: "Change Month", callbackData: "menu:main" }]);
  return inlineKeyboard(rows);
}

function buildDetailKeyboard(view, rootType) {
  const rows = [];
  if (view.backStack?.length) {
    rows.push([{ text: "Back to previous level", callbackData: "drill:back" }]);
  }
  const nextField = DETAIL_NEXT_FIELD[view.groupField];
  if (nextField) {
    rows.push([
      {
        text: DETAIL_NEXT_BUTTON_LABEL[nextField] || `View ${metricLabelForField(nextField)}`,
        callbackData: `drill:next:${nextField}`,
      },
    ]);
  }
  if (rootType === "agent") {
    rows.push([
      { text: "Back to Team Leader filter", callbackData: "report:teamLeader" },
      { text: "Back to Office filter", callbackData: "report:office" },
    ]);
  }
  rows.push([{ text: "Export Excel", callbackData: "export:current" }]);
  rows.push([{ text: "Back to Report Filters", callbackData: "menu:filters" }]);
  rows.push([{ text: "Change Month", callbackData: "menu:main" }]);
  return inlineKeyboard(rows);
}

function renderListView(view, rows, tabConfig, targetsMap, infoContext, now = new Date()) {
  const items = buildGroupItems(
    rows,
    tabConfig,
    view.baseFilters,
    view.groupField,
    targetsMap,
    infoContext,
    now,
    {
      metricsMode: view.metricsMode,
      monthBreakdownMonths: view.monthBreakdownMonths || [],
      monthContextByKey: view.monthContextByKey || {},
    },
  );
  const { page, totalPages, start, chunk } = paginateItems(items, view.page || 0, 8);

  if (!items.length) {
    return {
      text: `${view.title}\nNo data found.`,
      replyMarkup: buildListKeyboard({ ...view, backStack: view.backStack || [] }, [], 0, 0, 1),
      nextView: { ...view, page: 0 },
    };
  }

  const totalMetrics = totalMetricsForView(view, rows, tabConfig, targetsMap, infoContext, now);

  const chunkLines =
    view.metricsMode === "last4"
      ? chunk.flatMap((item, index) => {
          const lines = [formatMetricLine(`${start + index + 1}. ${item.label}`, item.metrics, view.metricsMode)];
          for (const monthMetric of item.monthlyMetrics || []) {
            lines.push(`   | ${monthMetric.monthLabel} | ${formatLast4MetricValues(monthMetric.metrics)}`);
          }
          return lines;
        })
      : chunk.map((item, index) => formatMetricLine(`${start + index + 1}. ${item.label}`, item.metrics, view.metricsMode));

  const lines = [
    view.title,
    `Page ${page + 1}/${totalPages}`,
    "",
    formatMetricLine("Summary (all records)", totalMetrics, view.metricsMode),
    "",
    ...chunkLines,
  ];

  let text = lines.join("\n");
  if (text.length > TELEGRAM_TEXT_LIMIT) {
    // Keep response concise and page further if labels are long.
    const compactChunk = chunk.slice(0, Math.max(1, Math.floor(chunk.length / 2)));
    const compactChunkLines =
      view.metricsMode === "last4"
        ? compactChunk.flatMap((item, index) => {
            const itemLines = [formatMetricLine(`${start + index + 1}. ${item.label}`, item.metrics, view.metricsMode)];
            for (const monthMetric of item.monthlyMetrics || []) {
              itemLines.push(`   | ${monthMetric.monthLabel} | ${formatLast4MetricValues(monthMetric.metrics)}`);
            }
            return itemLines;
          })
        : compactChunk.map((item, index) =>
            formatMetricLine(`${start + index + 1}. ${item.label}`, item.metrics, view.metricsMode),
          );
    const compactLines = [
      view.title,
      `Page ${page + 1}/${totalPages}`,
      "",
      formatMetricLine("Summary (all records)", totalMetrics, view.metricsMode),
      "",
      ...compactChunkLines,
    ];
    text = compactLines.join("\n");
  }

  return {
    text,
    replyMarkup: buildListKeyboard(view, chunk, start, page, totalPages),
    nextView: { ...view, page },
    items,
  };
}

function renderDetailView(view, rows, tabConfig, targetsMap, infoContext, now = new Date()) {
  const summary = calculateSummary(rows, tabConfig, view.filters, now);
  let metrics = metricPayload(
    summary,
    view.groupField,
    view.selectedLabel,
    view.filters,
    tabConfig,
    targetsMap,
    infoContext,
    now,
  );
  if (view.metricsMode === "last4" && view.monthlyMetrics?.length) {
    const totalTarget = view.monthlyMetrics.reduce(
      (sum, monthMetric) => sum + Number(monthMetric?.metrics?.ftdTarget || 0),
      0,
    );
    metrics = {
      ...metrics,
      ftdTarget: totalTarget,
      ftdTargetReach: targetReachPercent(summary.totalFtd, totalTarget),
    };
  }
  const baseText = formatMetricBlock(view.title, metrics, view.metricsMode);
  const text =
    view.metricsMode === "last4" && view.monthlyMetrics?.length
      ? [
          baseText,
          ...view.monthlyMetrics.map(
            (monthMetric) => `| ${monthMetric.monthLabel} | ${formatLast4MetricValues(monthMetric.metrics)}`,
          ),
        ].join("\n")
      : baseText;
  return {
    text,
    replyMarkup: buildDetailKeyboard(view, view.rootType),
    nextView: view,
  };
}

function totalMetricsForView(view, rows, tabConfig, targetsMap, infoContext, now = new Date()) {
  const totalSummary = calculateSummary(rows, tabConfig, view.baseFilters, now);
  let totalMetrics = metricPayload(
    totalSummary,
    view.groupField,
    metricLabelForField(view.groupField),
    view.baseFilters,
    tabConfig,
    targetsMap,
    infoContext,
    now,
  );
  if (view.metricsMode === "last4" && (view.monthBreakdownMonths || []).length) {
    const totalMonthlyMetrics = (view.monthBreakdownMonths || []).map((month) => {
      const monthRows = rows.filter((row) => row.__reportMonthKey === month.key);
      const monthSummary = calculateSummary(monthRows, tabConfig, view.baseFilters, now);
      return metricPayload(
        monthSummary,
        view.groupField,
        metricLabelForField(view.groupField),
        view.baseFilters,
        tabConfig,
        targetsMap,
        infoContext,
        now,
        {
          infoContext: mergedMonthlyContext(view.monthContextByKey?.[month.key], infoContext),
        },
      );
    });
    const totalTarget = totalMonthlyMetrics.reduce((sum, monthMetrics) => sum + Number(monthMetrics.ftdTarget || 0), 0);
    totalMetrics = {
      ...totalMetrics,
      ftdTarget: totalTarget,
      ftdTargetReach: targetReachPercent(totalSummary.totalFtd, totalTarget),
    };
  }
  return totalMetrics;
}

function workbookRowsForListView(view, rows, tabConfig, targetsMap, infoContext, now = new Date()) {
  const items = buildGroupItems(
    rows,
    tabConfig,
    view.baseFilters,
    view.groupField,
    targetsMap,
    infoContext,
    now,
    {
      metricsMode: view.metricsMode,
      monthBreakdownMonths: view.monthBreakdownMonths || [],
      monthContextByKey: view.monthContextByKey || {},
    },
  );
  const totalMetrics = totalMetricsForView(view, rows, tabConfig, targetsMap, infoContext, now);
  const outputRows = [
    {
      kind: "summary",
      name: "Summary (all records)",
      month: "",
      metrics: totalMetrics,
    },
  ];
  for (const item of items) {
    outputRows.push({
      kind: "group",
      name: item.label,
      month: "",
      metrics: item.metrics,
    });
    for (const monthMetric of item.monthlyMetrics || []) {
      outputRows.push({
        kind: "month",
        name: item.label,
        month: monthMetric.monthLabel,
        metrics: monthMetric.metrics,
      });
    }
  }
  return outputRows;
}

function workbookRowsForDetailView(view, rows, tabConfig, targetsMap, infoContext, now = new Date()) {
  const summary = calculateSummary(rows, tabConfig, view.filters, now);
  let metrics = metricPayload(
    summary,
    view.groupField,
    view.selectedLabel,
    view.filters,
    tabConfig,
    targetsMap,
    infoContext,
    now,
  );
  const monthlyMetrics = view.monthlyMetrics || [];
  if (view.metricsMode === "last4" && monthlyMetrics.length) {
    const totalTarget = monthlyMetrics.reduce((sum, monthMetric) => sum + Number(monthMetric?.metrics?.ftdTarget || 0), 0);
    metrics = {
      ...metrics,
      ftdTarget: totalTarget,
      ftdTargetReach: targetReachPercent(summary.totalFtd, totalTarget),
    };
  }
  return [
    {
      kind: "group",
      name: view.selectedLabel || metricLabelForField(view.groupField),
      month: "",
      metrics,
    },
    ...monthlyMetrics.map((monthMetric) => ({
      kind: "month",
      name: view.selectedLabel || metricLabelForField(view.groupField),
      month: monthMetric.monthLabel,
      metrics: monthMetric.metrics,
    })),
  ];
}

function sortedLast4Months(months = []) {
  return [...months].sort((left, right) => left.key.localeCompare(right.key));
}

function monthMetricsByKey(monthlyMetrics = []) {
  const monthMap = {};
  for (const monthMetric of monthlyMetrics) {
    monthMap[monthMetric.monthKey] = {
      target: Number.isFinite(monthMetric?.metrics?.ftdTarget) ? monthMetric.metrics.ftdTarget : 0,
      ftd: Number.isFinite(monthMetric?.metrics?.ftd) ? monthMetric.metrics.ftd : 0,
      cr: Number.isFinite(monthMetric?.metrics?.cr) ? monthMetric.metrics.cr : null,
      crTarget: Number.isFinite(monthMetric?.metrics?.crTarget) ? monthMetric.metrics.crTarget : null,
      crTargetReach: Number.isFinite(monthMetric?.metrics?.crTargetReach) ? monthMetric.metrics.crTargetReach : null,
      ftdTargetReach: Number.isFinite(monthMetric?.metrics?.ftdTargetReach) ? monthMetric.metrics.ftdTargetReach : null,
    };
  }
  return monthMap;
}

function officeForTeamLeaderLabel(infoContext, teamLeaderLabel) {
  const normalizedTeamLeader = normalizeText(teamLeaderLabel);
  const match = (infoContext?.records || []).find(
    (record) => record.normalized_team_leader === normalizedTeamLeader,
  );
  return match?.office || "";
}

function assignmentForAgentLabel(infoContext, agentLabel) {
  const normalizedAgent = normalizeAgentName(agentLabel);
  const record = infoContext?.byAgent?.get(normalizedAgent);
  return {
    office: record?.office || "",
    teamLeader: record?.team_leader || "",
  };
}

function buildLast4AllSheetRows({
  groupField,
  rows,
  tabConfig,
  targetsMap,
  infoContext,
  monthBreakdownMonths,
  monthContextByKey,
  now = new Date(),
}) {
  const items = buildGroupItems(
    rows,
    tabConfig,
    {},
    groupField,
    targetsMap,
    infoContext,
    now,
    {
      metricsMode: "last4",
      monthBreakdownMonths,
      monthContextByKey,
    },
  );

  return items.map((item) => {
    if (groupField === "office") {
      return {
        level: "Office",
        office: item.label,
        monthMetrics: monthMetricsByKey(item.monthlyMetrics || []),
      };
    }
    if (groupField === "teamLeader") {
      return {
        level: "Team Leader",
        office: officeForTeamLeaderLabel(infoContext, item.label),
        teamLeader: item.label,
        monthMetrics: monthMetricsByKey(item.monthlyMetrics || []),
      };
    }
    const assignment = assignmentForAgentLabel(infoContext, item.label);
    return {
      level: "Agent",
      office: assignment.office,
      teamLeader: assignment.teamLeader,
      agent: item.label,
      monthMetrics: monthMetricsByKey(item.monthlyMetrics || []),
    };
  });
}

function buildLast4AllCombinedRows(officeRows = [], teamLeaderRows = [], agentRows = []) {
  const normalizePair = (office, teamLeader) =>
    `${normalizeText(office || "")}::${normalizeText(teamLeader || "")}`;

  const teamLeadersByOffice = new Map();
  for (const row of teamLeaderRows) {
    const officeKey = normalizeText(row.office || "");
    if (!teamLeadersByOffice.has(officeKey)) {
      teamLeadersByOffice.set(officeKey, []);
    }
    teamLeadersByOffice.get(officeKey).push(row);
  }

  const agentsByOfficeTeamLeader = new Map();
  for (const row of agentRows) {
    const pairKey = normalizePair(row.office, row.teamLeader);
    if (!agentsByOfficeTeamLeader.has(pairKey)) {
      agentsByOfficeTeamLeader.set(pairKey, []);
    }
    agentsByOfficeTeamLeader.get(pairKey).push(row);
  }

  const usedTeamLeader = new Set();
  const usedAgent = new Set();
  const combined = [];

  for (const officeRow of officeRows) {
    combined.push(officeRow);
    const officeKey = normalizeText(officeRow.office || "");
    const teamLeaderList = teamLeadersByOffice.get(officeKey) || [];
    for (const teamLeaderRow of teamLeaderList) {
      combined.push(teamLeaderRow);
      const pairKey = normalizePair(teamLeaderRow.office, teamLeaderRow.teamLeader);
      usedTeamLeader.add(pairKey);
      const agents = agentsByOfficeTeamLeader.get(pairKey) || [];
      for (const agentRow of agents) {
        combined.push(agentRow);
        usedAgent.add(`${pairKey}::${normalizeAgentName(agentRow.agent || "")}`);
      }
    }
  }

  for (const teamLeaderRow of teamLeaderRows) {
    const pairKey = normalizePair(teamLeaderRow.office, teamLeaderRow.teamLeader);
    if (usedTeamLeader.has(pairKey)) {
      continue;
    }
    combined.push(teamLeaderRow);
    usedTeamLeader.add(pairKey);
    const agents = agentsByOfficeTeamLeader.get(pairKey) || [];
    for (const agentRow of agents) {
      const agentKey = `${pairKey}::${normalizeAgentName(agentRow.agent || "")}`;
      if (usedAgent.has(agentKey)) {
        continue;
      }
      combined.push(agentRow);
      usedAgent.add(agentKey);
    }
  }

  for (const agentRow of agentRows) {
    const pairKey = normalizePair(agentRow.office, agentRow.teamLeader);
    const agentKey = `${pairKey}::${normalizeAgentName(agentRow.agent || "")}`;
    if (usedAgent.has(agentKey)) {
      continue;
    }
    combined.push(agentRow);
    usedAgent.add(agentKey);
  }

  return combined;
}

function createRootView(reportType, monthLabel, dateConfig, options = {}) {
  const root = REPORT_TYPES[reportType];
  const next = HIERARCHY_NEXT[reportType];
  return {
    mode: "list",
    rootType: reportType,
    title: `${root.label} Results — ${monthLabel} (${dateConfig?.label || "Total Month"})`,
    groupField: root.fieldKey,
    baseFilters: withDateFilter({}, dateConfig),
    page: 0,
    nextMode: next,
    backStack: [],
    metricsMode: options.metricsMode || "full",
    monthBreakdownMonths: options.monthBreakdownMonths || [],
    monthContextByKey: options.monthContextByKey || {},
  };
}

function createListView({
  rootType,
  title,
  groupField,
  baseFilters,
  backStack,
  nextMode,
  dimensionOptions = null,
  parentField = null,
  parentLabel = null,
  metricsMode = "full",
  monthBreakdownMonths = [],
  monthContextByKey = {},
}) {
  return {
    mode: "list",
    rootType,
    title,
    groupField,
    baseFilters,
    page: 0,
    nextMode,
    backStack,
    dimensionOptions,
    parentField,
    parentLabel,
    metricsMode,
    monthBreakdownMonths,
    monthContextByKey,
  };
}

export async function startMenu(userId, options = {}) {
  clearSession(userId);
  setSession(userId, { step: "select_month" });
  return {
    text: MONTH_MENU_TEXT,
    replyMarkup: monthKeyboard(options.telegramUser),
  };
}

function renderHierarchy(session, rows, tabConfig, targetsMap, infoContext, now) {
  if (session.view?.mode === "detail") {
    return renderDetailView(session.view, rows, tabConfig, targetsMap, infoContext, now);
  }
  return renderListView(session.view, rows, tabConfig, targetsMap, infoContext, now);
}

function monthToSession(month, now = new Date()) {
  return {
    monthKey: month.key,
    monthLabel: month.month_label,
    spreadsheetId: month.sheet_id,
    isHistorical: month.key < currentMonthKey(now),
  };
}

function datePromptText(month) {
  return `Month: ${month.month_label}\n${DATE_MENU_TEXT}`;
}

function openReportFiltersResponse(month, dateConfig, telegramUser, session = {}) {
  return {
    text: reportFilterTitle(month, dateConfig, session),
    replyMarkup: mainMenuKeyboard(telegramUser, {
      onlyCore: Boolean(session.last3Mode),
      last4Mode: Boolean(session.last3Mode),
    }),
  };
}

function specialScopedValues(rows, tabConfig, fieldKey, filters, now = new Date()) {
  const fieldName = getFieldName(tabConfig, fieldKey);
  const values = new Set();
  for (const row of filteredRows(rows, tabConfig, filters, now)) {
    const label = String(getRowValue(row, fieldName) || "").trim();
    if (label) {
      values.add(label);
    }
  }
  return [...values].sort((left, right) => left.localeCompare(right));
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
    if (session.last3Mode) {
      const nextSession = {
        ...monthToSession(month, now),
        last3Mode: true,
        monthLabel: session.monthLabel || "Last 4 Months",
        last3MonthKeys: session.last3MonthKeys || getLastFourMonthRecords(now).map((item) => item.key),
        dateFilter: null,
        dateFilterLabel: "Last 4 Months",
        dateFilterKey: "last4",
        step: "select_report_type",
        view: null,
      };
      setSession(userId, nextSession);
      return openReportFiltersResponse(month, { label: "Last 4 Months", filter: null }, telegramUser, nextSession);
    }
    const dateConfig = selectedDateConfig(session, month, now);
    setSession(userId, {
      ...monthToSession(month, now),
      last3Mode: false,
      monthLabel: month.month_label,
      last3MonthKeys: null,
      dateFilter: dateConfig.filter,
      dateFilterLabel: dateConfig.label,
      dateFilterKey: dateConfig.key,
      step: "select_report_type",
      view: null,
    });
    return openReportFiltersResponse(month, dateConfig, telegramUser);
  }

  const [action, value, extra] = String(callbackData || "").split(":");

  if (action === "month") {
    if (value === "last4") {
      const months = getLastFourMonthRecords(now);
      if (months.length === 0) {
        return {
          text: "No month files configured for last 3 months.",
          replyMarkup: monthKeyboard(telegramUser),
        };
      }
      const latest = months[0];
      const oldest = months[months.length - 1];
      const label = `Last 4 Months (${oldest.month_label} - ${latest.month_label})`;
      const nextSession = {
        ...monthToSession(latest, now),
        last3Mode: true,
        monthLabel: label,
        last3MonthKeys: months.map((item) => item.key),
        dateFilter: null,
        dateFilterLabel: "Last 4 Months",
        dateFilterKey: "last4",
        step: "select_report_type",
        view: null,
      };
      setSession(userId, nextSession);
      return openReportFiltersResponse(latest, { label: "Last 4 Months", filter: null }, telegramUser, nextSession);
    }

    const month = getMonthFile(value, { includeInactive: false });
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    setSession(userId, {
      ...monthToSession(month, now),
      last3Mode: false,
      monthLabel: month.month_label,
      last3MonthKeys: null,
      dateFilter: null,
      dateFilterLabel: null,
      dateFilterKey: null,
      step: "select_date_filter",
      view: null,
    });
    return {
      text: datePromptText(month),
      replyMarkup: dateFilterKeyboard(),
    };
  }

  if (action === "date") {
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    if (value === "custom") {
      setSession(userId, {
        ...monthToSession(month, now),
        step: "select_date_custom",
      });
      return {
        text: "Send custom date range as:\nDD/MM/YYYY - DD/MM/YYYY",
        replyMarkup: inlineKeyboard([
          [{ text: "Back to Date Filter", callbackData: `month:${month.key}` }],
          [{ text: "Back to Month Selection", callbackData: "menu:main" }],
        ]),
      };
    }

    const dateConfig = dateSelectionForPreset(month, value, now);
    setSession(userId, {
      ...monthToSession(month, now),
      last3Mode: false,
      monthLabel: month.month_label,
      last3MonthKeys: null,
      dateFilter: dateConfig.filter,
      dateFilterLabel: dateConfig.label,
      dateFilterKey: dateConfig.key,
      step: "select_report_type",
      view: null,
    });
    return openReportFiltersResponse(month, dateConfig, telegramUser);
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
    if (session.last3Mode && !LAST4_REPORT_TYPES.has(value)) {
      const month = selectedMonthRecord(session, now);
      if (!month) {
        return startMenu(userId, { telegramUser });
      }
      return {
        text: "Last 4 Months mode supports only Office, Team Leader and Agent reports.",
        replyMarkup: mainMenuKeyboard(telegramUser, { onlyCore: true }),
      };
    }
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return {
        text: "No month files configured. Ask @antoniotsd to add one in Settings.",
        replyMarkup: monthKeyboard(telegramUser),
      };
    }

    const { rows, targetsMap, infoContext, monthInfoContextByKey = {}, months = [] } = await readReportData(
      readRows,
      tabConfig,
      infoAgentsTabConfig,
      month.sheet_id,
      {
        last3Mode: Boolean(session.last3Mode),
        last3MonthKeys: session.last3MonthKeys || [],
        now,
      },
    );
    const dateConfig = selectedDateConfig(session, month, now);
    const effectiveDateConfig = session.last3Mode
      ? { label: "Last 4 Months", filter: null, key: "last4" }
      : dateConfig;
    const displayMonthLabel = session.last3Mode ? session.monthLabel : month.month_label;
    const view = createRootView(value, displayMonthLabel, effectiveDateConfig, {
      metricsMode: session.last3Mode ? "last4" : "full",
      monthBreakdownMonths: months.map((month) => ({
        key: month.key,
        month_label: month.month_label,
        shortLabel: String(month.month_label || "").split(" ")[0] || month.month_label,
      })),
      monthContextByKey: monthInfoContextByKey,
    });
    const rendered = renderListView(view, rows, tabConfig, targetsMap, infoContext, now);
    setSession(userId, {
      ...monthToSession(month, now),
      last3Mode: Boolean(session.last3Mode),
      monthLabel: session.last3Mode ? session.monthLabel : month.month_label,
      last3MonthKeys: session.last3Mode ? session.last3MonthKeys : null,
      dateFilter: effectiveDateConfig.filter,
      dateFilterLabel: effectiveDateConfig.label,
      dateFilterKey: effectiveDateConfig.key,
      step: "report_ready",
      reportType: value,
      view: rendered.nextView,
    });
    return {
      text: rendered.text,
      replyMarkup: rendered.replyMarkup,
    };
  }

  if (action === "special") {
    const session = getSession(userId);
    if (session.last3Mode) {
      const month = selectedMonthRecord(session, now);
      if (!month) {
        return startMenu(userId, { telegramUser });
      }
      return {
        text: "Specific Reports are disabled in Last 4 Months mode. Use Office, Team Leader or Agent.",
        replyMarkup: mainMenuKeyboard(telegramUser, { onlyCore: true }),
      };
    }
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    const dateConfig = selectedDateConfig(session, month, now);
    const commonSession = {
      ...monthToSession(month, now),
      dateFilter: dateConfig.filter,
      dateFilterLabel: dateConfig.label,
      dateFilterKey: dateConfig.key,
    };

    if (value === "open") {
      setSession(userId, {
        ...commonSession,
        step: "special_reports_menu",
        specialSelection: null,
        specialCountry: null,
        hourlyScope: session.hourlyScope || null,
      });
      return {
        text: `Month: ${month.month_label}\nDate: ${dateConfig.label}\n${SPECIFIC_MENU_TEXT}`,
        replyMarkup: specificReportsKeyboard(),
      };
    }

    if (value === "hourlyDate") {
      if (extra === "custom") {
        setSession(userId, {
          ...commonSession,
          step: "select_hourly_date_custom",
        });
        return {
          text: "Send hourly report date range as:\nDD/MM/YYYY - DD/MM/YYYY",
          replyMarkup: inlineKeyboard([
            [{ text: "Back to Hourly Leads", callbackData: "special:hourly" }],
            [{ text: "Back to Specific Reports", callbackData: "special:open" }],
          ]),
        };
      }
      const nextDate = dateSelectionForPreset(month, extra, now);
      setSession(userId, {
        ...commonSession,
        dateFilter: nextDate.filter,
        dateFilterLabel: nextDate.label,
        dateFilterKey: nextDate.key,
      });
      return handleMenuCallback(userId, "special:hourly", options);
    }

    const { rows } = await readReportData(readRows, tabConfig, infoAgentsTabConfig, month.sheet_id);
    const dateFilters = withDateFilter({}, dateConfig);

    if (value === "hourly") {
      const currentScope = session.hourlyScope || null;
      const scopeFilters =
        currentScope?.fieldKey && currentScope?.value
          ? applyFieldFilter(dateFilters, currentScope.fieldKey, currentScope.value)
          : dateFilters;
      const distribution = hourlyDistribution(rows, tabConfig, scopeFilters, "created", "totalLeads", now);
      const scopeLabel = currentScope?.fieldKey
        ? `${metricLabelForField(currentScope.fieldKey)}: ${currentScope.value}`
        : "All";
      setSession(userId, {
        ...commonSession,
        step: "special_reports_menu",
        specialSelection: null,
        hourlyScope: currentScope,
      });
      return {
        text: formatHourlyReport(
          `Hourly Leads (${scopeLabel}) — ${month.month_label} (${dateConfig.label})`,
          distribution,
        ),
        replyMarkup: hourlyReportKeyboard({
          changeScopeCallback:
            currentScope?.fieldKey && currentScope?.value
              ? `special:hourlyScope:${currentScope.fieldKey}`
              : null,
          changeScopeLabel:
            currentScope?.fieldKey && currentScope?.value
              ? `Change ${metricLabelForField(currentScope.fieldKey)}`
              : null,
        }),
      };
    }

    if (value === "hourlyScope") {
      const fieldKey = extra;
      const values = specialScopedValues(rows, tabConfig, fieldKey, dateFilters, now);
      setSession(userId, {
        ...commonSession,
        step: "special_reports_menu",
        specialSelection: {
          mode: "hourly",
          fieldKey,
          values,
          page: 0,
          backCallback: "special:hourly",
        },
      });
      return {
        text: `Select ${metricLabelForField(fieldKey)} for hourly lead report (${dateConfig.label}):`,
        replyMarkup: listSelectionKeyboard({
          values,
          page: 0,
          pickPrefix: "specialPick",
          backCallback: "special:hourly",
        }),
      };
    }

    if (value === "compareCountry") {
      const values = specialScopedValues(rows, tabConfig, "country", dateFilters, now);
      setSession(userId, {
        ...commonSession,
        step: "special_reports_menu",
        specialSelection: {
          mode: "compareCountry",
          fieldKey: "country",
          values,
          page: 0,
          backCallback: "special:open",
        },
      });
      return {
        text: "Select country for comparison report:",
        replyMarkup: listSelectionKeyboard({
          values,
          page: 0,
          pickPrefix: "specialPick",
          backCallback: "special:open",
        }),
      };
    }

    if (value === "compareCampaignList") {
      const selectedCountry = session.specialCountry;
      if (!selectedCountry) {
        return {
          text: "Please select country first.",
          replyMarkup: specificReportsKeyboard(),
        };
      }
      const values = specialScopedValues(
        rows,
        tabConfig,
        "campaign",
        { ...dateFilters, country: selectedCountry },
        now,
      );
      setSession(userId, {
        ...commonSession,
        specialCountry: selectedCountry,
        specialSelection: {
          mode: "compareCampaign",
          fieldKey: "campaign",
          values,
          page: 0,
          backCallback: "special:compareCountry",
        },
      });
      return {
        text: `Select campaign in ${selectedCountry}:`,
        replyMarkup: listSelectionKeyboard({
          values,
          page: 0,
          pickPrefix: "specialPick",
          backCallback: "special:compareCountry",
        }),
      };
    }
  }

  if (action === "specialPage") {
    const session = getSession(userId);
    const selection = session.specialSelection;
    if (!selection?.values?.length) {
      return {
        text: "No selection context found.",
        replyMarkup: specificReportsKeyboard(),
      };
    }
    const page = Number(value) || 0;
    setSession(userId, {
      specialSelection: {
        ...selection,
        page,
      },
    });
    return {
      text: `Select ${metricLabelForField(selection.fieldKey)}:`,
      replyMarkup: listSelectionKeyboard({
        values: selection.values,
        page,
        pickPrefix: "specialPick",
        backCallback: selection.backCallback || "special:open",
      }),
    };
  }

  if (action === "specialPick") {
    const index = Number(value);
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    const selection = session.specialSelection;
    if (!selection?.values?.length || !Number.isFinite(index) || !selection.values[index]) {
      return {
        text: "Selection expired. Please open Specific Reports again.",
        replyMarkup: specificReportsKeyboard(),
      };
    }
    const pickedValue = selection.values[index];
    const dateConfig = selectedDateConfig(session, month, now);
    const { rows } = await readReportData(readRows, tabConfig, infoAgentsTabConfig, month.sheet_id);
    const dateFilters = withDateFilter({}, dateConfig);

    if (selection.mode === "hourly") {
      const scopeFilters = applyFieldFilter(dateFilters, selection.fieldKey, pickedValue);
      const distribution = hourlyDistribution(rows, tabConfig, scopeFilters, "created", "totalLeads", now);
      setSession(userId, {
        hourlyScope: { fieldKey: selection.fieldKey, value: pickedValue },
      });
      return {
        text: formatHourlyReport(
          `Hourly Leads — ${metricLabelForField(selection.fieldKey)}: ${pickedValue} (${dateConfig.label})`,
          distribution,
        ),
        replyMarkup: hourlyReportKeyboard({
          changeScopeCallback: `special:hourlyScope:${selection.fieldKey}`,
          changeScopeLabel: `Change ${metricLabelForField(selection.fieldKey)}`,
        }),
      };
    }

    if (selection.mode === "compareCountry") {
      const filters = { ...dateFilters, country: pickedValue };
      const lines = [
        `Country Comparison — ${pickedValue} (${dateConfig.label})`,
        "",
        ...rankingLines("Top Agents", rows, tabConfig, filters, "agentNames", now),
        "",
        ...rankingLines("Top Team Leaders", rows, tabConfig, filters, "teamLeader", now),
        "",
        ...rankingLines("Top Offices", rows, tabConfig, filters, "office", now),
      ];
      setSession(userId, {
        specialCountry: pickedValue,
      });
      return {
        text: lines.join("\n"),
        replyMarkup: inlineKeyboard([
          [{ text: `Select Campaign in ${pickedValue}`, callbackData: "special:compareCampaignList" }],
          [{ text: "Choose Another Country", callbackData: "special:compareCountry" }],
          [{ text: "Back to Specific Reports", callbackData: "special:open" }],
          [{ text: "Back to Report Filters", callbackData: "menu:filters" }],
          [{ text: "Change Month", callbackData: "menu:main" }],
        ]),
      };
    }

    if (selection.mode === "compareCampaign") {
      const country = session.specialCountry;
      const filters = {
        ...dateFilters,
        ...(country ? { country } : {}),
        campaign: pickedValue,
      };
      const title = country
        ? `Campaign Comparison — ${country} / ${pickedValue} (${dateConfig.label})`
        : `Campaign Comparison — ${pickedValue} (${dateConfig.label})`;
      return {
        text: [
          title,
          "",
          ...rankingLines("Top Agents", rows, tabConfig, filters, "agentNames", now),
          "",
          ...rankingLines("Top Team Leaders", rows, tabConfig, filters, "teamLeader", now),
          "",
          ...rankingLines("Top Offices", rows, tabConfig, filters, "office", now),
        ].join("\n"),
        replyMarkup: inlineKeyboard([
          [{ text: "Choose Another Campaign", callbackData: "special:compareCampaignList" }],
          [{ text: "Back to Country Comparison", callbackData: "special:compareCountry" }],
          [{ text: "Back to Specific Reports", callbackData: "special:open" }],
          [{ text: "Back to Report Filters", callbackData: "menu:filters" }],
          [{ text: "Change Month", callbackData: "menu:main" }],
        ]),
      };
    }
  }

  if (action === "export" && value === "last4all") {
    const session = getSession(userId);
    if (!session.last3Mode) {
      return {
        text: "All (Excel) is available only in Last 4 Months mode.",
        replyMarkup: mainMenuKeyboard(telegramUser, {
          onlyCore: Boolean(session.last3Mode),
          last4Mode: Boolean(session.last3Mode),
        }),
      };
    }
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    const { rows, targetsMap, infoContext, monthInfoContextByKey = {}, months = [] } = await readReportData(
      readRows,
      tabConfig,
      infoAgentsTabConfig,
      month.sheet_id,
      {
        last3Mode: true,
        last3MonthKeys: session.last3MonthKeys || [],
        now,
      },
    );
    const exportMonths = sortedLast4Months(months).map((monthRecord) => ({
      key: monthRecord.key,
      label: monthRecord.month_label,
    }));
    const monthBreakdownMonths = months.map((monthRecord) => ({
      key: monthRecord.key,
      month_label: monthRecord.month_label,
      shortLabel: String(monthRecord.month_label || "").split(" ")[0] || monthRecord.month_label,
    }));

    const officeRows = buildLast4AllSheetRows({
      groupField: "office",
      rows,
      tabConfig,
      targetsMap,
      infoContext,
      monthBreakdownMonths,
      monthContextByKey: monthInfoContextByKey,
      now,
    });
    const teamLeaderRows = buildLast4AllSheetRows({
      groupField: "teamLeader",
      rows,
      tabConfig,
      targetsMap,
      infoContext,
      monthBreakdownMonths,
      monthContextByKey: monthInfoContextByKey,
      now,
    });
    const agentRows = buildLast4AllSheetRows({
      groupField: "agentNames",
      rows,
      tabConfig,
      targetsMap,
      infoContext,
      monthBreakdownMonths,
      monthContextByKey: monthInfoContextByKey,
      now,
    });
    const allRows = buildLast4AllCombinedRows(officeRows, teamLeaderRows, agentRows);

    const workbookBuffer = await buildLast4AllWorkbookBuffer({
      title: session.monthLabel || "Last 4 Months",
      months: exportMonths,
      sheets: [
        {
          name: "ALL",
          infoColumns: [
            { key: "level", label: "Level", width: 14 },
            { key: "office", label: "Office", width: 20 },
            { key: "teamLeader", label: "Team Leader", width: 24 },
            { key: "agent", label: "Agent", width: 24 },
          ],
          metricColumns: [
            { key: "target", label: "TARGET", type: "number", width: 11 },
            { key: "ftd", label: "FTD", type: "number", width: 10 },
            { key: "cr", label: "CR%", type: "percent", width: 10 },
            { key: "crTarget", label: "CR TARGET", type: "percent", width: 12 },
            { key: "crTargetReach", label: "CR TARGET REACH", type: "reach_percent", width: 16 },
            { key: "ftdTargetReach", label: "FTD TARGET REACH", type: "reach_percent", width: 16 },
          ],
          rows: allRows,
        },
      ],
    });
    const monthLabel = session.monthLabel || "Last 4 Months";
    return {
      text: `Period: ${monthLabel}\nAll Excel export sent (Office + Team Leader + Agent).`,
      replyMarkup: mainMenuKeyboard(telegramUser, { onlyCore: true, last4Mode: true }),
      documentBuffer: workbookBuffer,
      documentFilename: `last4-all-${Date.now()}.xlsx`,
    };
  }

  if (action === "export" && value === "current") {
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month || !session.view) {
      return {
        text: "No active report view to export. Open a report first.",
        replyMarkup: mainMenuKeyboard(telegramUser, {
          onlyCore: Boolean(session.last3Mode),
          last4Mode: Boolean(session.last3Mode),
        }),
      };
    }
    const { rows, targetsMap, infoContext } = await readReportData(
      readRows,
      tabConfig,
      infoAgentsTabConfig,
      month.sheet_id,
      {
        last3Mode: Boolean(session.last3Mode),
        last3MonthKeys: session.last3MonthKeys || [],
        now,
      },
    );
    const rendered = renderHierarchy({ view: session.view }, rows, tabConfig, targetsMap, infoContext, now);
    const exportRows =
      session.view.mode === "list"
        ? workbookRowsForListView(session.view, rows, tabConfig, targetsMap, infoContext, now)
        : workbookRowsForDetailView(session.view, rows, tabConfig, targetsMap, infoContext, now);
    const workbookBuffer = await buildReportWorkbookBuffer({
      title: session.view.title,
      mode: session.view.metricsMode || "full",
      rows: exportRows,
    });
    setSession(userId, { view: rendered.nextView });
    return {
      text: `${rendered.text}\n\nExcel export sent.`,
      replyMarkup: rendered.replyMarkup,
      documentBuffer: workbookBuffer,
      documentFilename: `report-${Date.now()}.xlsx`,
    };
  }

  if (action === "drill") {
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    const { rows, targetsMap, infoContext } = await readReportData(
      readRows,
      tabConfig,
      infoAgentsTabConfig,
      month.sheet_id,
      {
        last3Mode: Boolean(session.last3Mode),
        last3MonthKeys: session.last3MonthKeys || [],
        now,
      },
    );
    let view = session.view;
    if (!view) {
      const dateConfig = selectedDateConfig(session, month, now);
      return {
        text: reportFilterTitle(month, dateConfig, session),
        replyMarkup: mainMenuKeyboard(telegramUser, {
          onlyCore: Boolean(session.last3Mode),
          last4Mode: Boolean(session.last3Mode),
        }),
      };
    }

    if (value === "page") {
      view = { ...view, page: Number(extra) || 0 };
      const rendered = renderListView(view, rows, tabConfig, targetsMap, infoContext, now);
      setSession(userId, { view: rendered.nextView });
      return { text: rendered.text, replyMarkup: rendered.replyMarkup };
    }

    if (value === "next" && view.mode === "detail") {
      const fieldKey = extra;
      const expectedNext = DETAIL_NEXT_FIELD[view.groupField];
      if (!fieldKey || expectedNext !== fieldKey) {
        return { text: "No deeper breakdown available.", replyMarkup: buildDetailKeyboard(view, view.rootType) };
      }
      const backStack = [...(view.backStack || []), view];
      const nextView = createListView({
        rootType: view.rootType,
        title: `${metricLabelForField(view.groupField)}: ${view.selectedLabel} — ${metricLabelForField(fieldKey)}s`,
        groupField: fieldKey,
        baseFilters: view.filters,
        backStack,
        nextMode: { mode: "detail", fieldKey, label: metricLabelForField(fieldKey) },
        metricsMode: view.metricsMode,
        monthBreakdownMonths: view.monthBreakdownMonths || [],
        monthContextByKey: view.monthContextByKey || {},
      });
      const rendered = renderListView(nextView, rows, tabConfig, targetsMap, infoContext, now);
      setSession(userId, { view: rendered.nextView });
      return { text: rendered.text, replyMarkup: rendered.replyMarkup };
    }

    if (value === "back") {
      if (!view.backStack?.length) {
        const dateConfig = selectedDateConfig(session, month, now);
        return {
          text: reportFilterTitle(month, dateConfig, session),
          replyMarkup: mainMenuKeyboard(telegramUser, {
            onlyCore: Boolean(session.last3Mode),
            last4Mode: Boolean(session.last3Mode),
          }),
        };
      }
      const previous = view.backStack[view.backStack.length - 1];
      const rendered = previous.mode === "detail"
        ? renderDetailView(previous, rows, tabConfig, targetsMap, infoContext, now)
        : renderListView(previous, rows, tabConfig, targetsMap, infoContext, now);
      setSession(userId, { view: rendered.nextView });
      return { text: rendered.text, replyMarkup: rendered.replyMarkup };
    }

    if (value === "dimension" && view.mode === "list" && view.dimensionOptions?.length) {
      const fieldKey = extra;
      if (!DIMENSION_OPTIONS.some((option) => option.fieldKey === fieldKey)) {
        return {
          text: "Unknown dimension.",
          replyMarkup: mainMenuKeyboard(telegramUser, {
            onlyCore: Boolean(session.last3Mode),
            last4Mode: Boolean(session.last3Mode),
          }),
        };
      }
      view = {
        ...view,
        groupField: fieldKey,
        page: 0,
        nextMode: { mode: "detail", fieldKey, label: metricLabelForField(fieldKey) },
      };
      const rendered = renderListView(view, rows, tabConfig, targetsMap, infoContext, now);
      setSession(userId, { view: rendered.nextView });
      return { text: rendered.text, replyMarkup: rendered.replyMarkup };
    }

    if (value === "pick" && view.mode === "list") {
      const pickedIndex = Number(extra);
      const rendered = renderListView(view, rows, tabConfig, targetsMap, infoContext, now);
      const items = rendered.items || [];
      const picked = items[pickedIndex];
      if (!picked) {
        return { text: rendered.text, replyMarkup: rendered.replyMarkup };
      }

      const nextMode = view.nextMode || { mode: "detail", fieldKey: view.groupField };
      const backStack = [...(view.backStack || []), rendered.nextView];
      if (nextMode.mode === "detail") {
        const filters = applyFieldFilter(view.baseFilters, view.groupField, picked.label);
        const detailView = {
          mode: "detail",
          rootType: view.rootType,
          title: `${metricLabelForField(view.groupField)}: ${picked.label}`,
          groupField: view.groupField,
          selectedLabel: picked.label,
          filters,
          backStack,
          metricsMode: view.metricsMode,
          monthBreakdownMonths: view.monthBreakdownMonths || [],
          monthContextByKey: view.monthContextByKey || {},
          monthlyMetrics: picked.monthlyMetrics || [],
        };
        const detail = renderDetailView(detailView, rows, tabConfig, targetsMap, infoContext, now);
        setSession(userId, { view: detail.nextView });
        return { text: detail.text, replyMarkup: detail.replyMarkup };
      }

      if (nextMode.mode === "dimension") {
        const parentFilters = applyFieldFilter(view.baseFilters, view.groupField, picked.label);
        const breakdownView = createListView({
          rootType: view.rootType,
          title: `${metricLabelForField(view.groupField)}: ${picked.label} — By Office`,
          groupField: "office",
          baseFilters: parentFilters,
          backStack,
          nextMode: { mode: "detail", fieldKey: "office", label: "Office" },
          dimensionOptions: DIMENSION_OPTIONS,
          parentField: view.groupField,
          parentLabel: picked.label,
          metricsMode: view.metricsMode,
          monthBreakdownMonths: view.monthBreakdownMonths || [],
          monthContextByKey: view.monthContextByKey || {},
        });
        const list = renderListView(breakdownView, rows, tabConfig, targetsMap, infoContext, now);
        setSession(userId, { view: list.nextView });
        return { text: list.text, replyMarkup: list.replyMarkup };
      }

      if (nextMode.mode === "list") {
        const nextFilters = applyFieldFilter(view.baseFilters, view.groupField, picked.label);
        const nextView = createListView({
          rootType: view.rootType,
          title: `${nextMode.label} in ${picked.label}`,
          groupField: nextMode.fieldKey,
          baseFilters: nextFilters,
          backStack,
          nextMode:
            nextMode.fieldKey === "agentNames"
              ? { mode: "detail", fieldKey: "agentNames", label: "Agent" }
              : { mode: "detail", fieldKey: nextMode.fieldKey, label: nextMode.label },
          metricsMode: view.metricsMode,
          monthBreakdownMonths: view.monthBreakdownMonths || [],
          monthContextByKey: view.monthContextByKey || {},
        });
        const list = renderListView(nextView, rows, tabConfig, targetsMap, infoContext, now);
        setSession(userId, { view: list.nextView });
        return { text: list.text, replyMarkup: list.replyMarkup };
      }
    }
  }

  return startMenu(userId, { telegramUser });
}

export async function handleMenuText(userId, text, options = {}) {
  const session = getSession(userId);
  const telegramUser = options.telegramUser;
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

  if (session.step === "select_hourly_date_custom") {
    const month = selectedMonthRecord(session, options.now || new Date());
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    const customRange = String(text || "").trim();
    const parts = customRange.split(/\s+(?:to|-|–|—)\s+/i).map((part) => part.trim());
    if (parts.length !== 2 || !parseDateValue(parts[0]) || !parseDateValue(parts[1])) {
      return {
        text: "Invalid range. Please send it as:\nDD/MM/YYYY - DD/MM/YYYY",
        replyMarkup: inlineKeyboard([
          [{ text: "Back to Hourly Leads", callbackData: "special:hourly" }],
          [{ text: "Back to Specific Reports", callbackData: "special:open" }],
        ]),
      };
    }
    const customDate = {
      key: "custom",
      label: `Custom (${parts[0]} - ${parts[1]})`,
      filter: { type: "range", start: parts[0], end: parts[1] },
    };
    setSession(userId, {
      ...monthToSession(month, options.now || new Date()),
      dateFilter: customDate.filter,
      dateFilterLabel: customDate.label,
      dateFilterKey: customDate.key,
      step: "special_reports_menu",
    });
    return handleMenuCallback(userId, "special:hourly", options);
  }

  if (session.step !== "select_date_custom") {
    return null;
  }

  const month = selectedMonthRecord(session, options.now || new Date());
  if (!month) {
    return startMenu(userId, { telegramUser });
  }

  const customRange = String(text || "").trim();
  const parts = customRange.split(/\s+(?:to|-|–|—)\s+/i).map((part) => part.trim());
  if (parts.length !== 2 || !parseDateValue(parts[0]) || !parseDateValue(parts[1])) {
    return {
      text: "Invalid range. Please send it as:\nDD/MM/YYYY - DD/MM/YYYY",
      replyMarkup: inlineKeyboard([[{ text: "Back to Date Filter", callbackData: `month:${month.key}` }]]),
    };
  }
  const customDate = {
    key: "custom",
    label: `Custom (${parts[0]} - ${parts[1]})`,
    filter: { type: "range", start: parts[0], end: parts[1] },
  };
  setSession(userId, {
    ...monthToSession(month, options.now || new Date()),
    last3Mode: false,
    monthLabel: month.month_label,
    last3MonthKeys: null,
    dateFilter: customDate.filter,
    dateFilterLabel: customDate.label,
    dateFilterKey: customDate.key,
    step: "select_report_type",
  });
  return {
    text: reportFilterTitle(month, customDate),
    replyMarkup: mainMenuKeyboard(telegramUser),
  };
}

export function formatTopPerformers() {
  return "Top performers are now available through full hierarchical report navigation.";
}

export function formatBreakdown() {
  return "Breakdown view moved to hierarchical drilldown navigation.";
}
