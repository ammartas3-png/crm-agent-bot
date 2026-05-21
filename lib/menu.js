import { getTabConfig } from "../config/sheetsConfig.js";
import {
  calculateSummary,
  groupPerformance,
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
  targetAggregationForScope,
  targetReachPercent,
} from "./targets.js";

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
  if (isSettingsAdminTelegramUser(telegramUser)) {
    rows.push([{ text: SETTINGS_MENU_TEXT, callbackData: "settings:open" }]);
  }
  return inlineKeyboard(rows);
}

export function mainMenuKeyboard(telegramUser) {
  const rows = [
    [{ text: "Office", callbackData: "report:office" }],
    [{ text: "Team Leader", callbackData: "report:teamLeader" }],
    [{ text: "Agent", callbackData: "report:agent" }],
    [{ text: "Country", callbackData: "report:country" }],
    [{ text: "Campaign", callbackData: "report:campaign" }],
    [{ text: "Specific Reports", callbackData: "special:open" }],
    [{ text: "Change Month", callbackData: "menu:main" }],
  ];
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

function reportFilterTitle(month, dateConfig) {
  return [`Month: ${month.month_label}`, `Date: ${dateConfig.label}`, MAIN_MENU_TEXT].join("\n");
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
  const ranked = groupPerformance(rows, tabConfig, filters, fieldKey, Number.POSITIVE_INFINITY, "totalFtd", now);
  if (!ranked.length) {
    return [`${title}: no data`];
  }
  const lines = [title];
  for (let index = 0; index < ranked.length; index += 1) {
    const item = ranked[index];
    const line = `${index + 1}. ${item.label} | Lead ${item.summary.totalLeads.toLocaleString(
      "en-US",
    )} | FTD ${item.summary.totalFtd.toLocaleString("en-US")} | CR ${formatPercent(item.summary.cr)}`;
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

async function readReportData(readRows, tabConfig, infoAgentsTabConfig, spreadsheetId) {
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
) {
  const targetAggregation = targetAggregationForScope({
    rows: summary.contextRows || [],
    tabConfig,
    infoContext,
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

function formatMetricLine(label, metrics) {
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

function formatMetricBlock(title, metrics) {
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
  return [...groups.entries()]
    .map(([key, groupRows]) => {
      const label = displayByKey.get(key) || key;
      const summary = calculateSummary(groupRows, tabConfig, dateFilters, now);
      const scopeFilters = applyFieldFilter(baseFilters, groupField, label);
      return {
        label,
        summary,
        metrics: metricPayload(
          summary,
          groupField,
          label,
          scopeFilters,
          tabConfig,
          targetsMap,
          infoContext,
          now,
        ),
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

  rows.push([{ text: "Back to Report Filters", callbackData: "menu:filters" }]);
  rows.push([{ text: "Change Month", callbackData: "menu:main" }]);
  return inlineKeyboard(rows);
}

function buildDetailKeyboard(view, rootType) {
  const rows = [];
  if (view.backStack?.length) {
    rows.push([{ text: "Back to previous level", callbackData: "drill:back" }]);
  }
  if (rootType === "agent") {
    rows.push([
      { text: "Back to Team Leader filter", callbackData: "report:teamLeader" },
      { text: "Back to Office filter", callbackData: "report:office" },
    ]);
  }
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
  );
  const { page, totalPages, start, chunk } = paginateItems(items, view.page || 0, 8);

  if (!items.length) {
    return {
      text: `${view.title}\nNo data found.`,
      replyMarkup: buildListKeyboard({ ...view, backStack: view.backStack || [] }, [], 0, 0, 1),
      nextView: { ...view, page: 0 },
    };
  }

  const totalSummary = calculateSummary(rows, tabConfig, view.baseFilters, now);
  const totalMetrics = metricPayload(
    totalSummary,
    view.groupField,
    metricLabelForField(view.groupField),
    view.baseFilters,
    tabConfig,
    targetsMap,
    infoContext,
    now,
  );

  const lines = [
    view.title,
    `Page ${page + 1}/${totalPages}`,
    "",
    formatMetricLine("Summary (all records)", totalMetrics),
    "",
    ...chunk.map((item, index) => formatMetricLine(`${start + index + 1}. ${item.label}`, item.metrics)),
  ];

  let text = lines.join("\n");
  if (text.length > TELEGRAM_TEXT_LIMIT) {
    // Keep response concise and page further if labels are long.
    const compactChunk = chunk.slice(0, Math.max(1, Math.floor(chunk.length / 2)));
    const compactLines = [
      view.title,
      `Page ${page + 1}/${totalPages}`,
      "",
      formatMetricLine("Summary (all records)", totalMetrics),
      "",
      ...compactChunk.map((item, index) => formatMetricLine(`${start + index + 1}. ${item.label}`, item.metrics)),
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
  const metrics = metricPayload(
    summary,
    view.groupField,
    view.selectedLabel,
    view.filters,
    tabConfig,
    targetsMap,
    infoContext,
    now,
  );
  return {
    text: formatMetricBlock(view.title, metrics),
    replyMarkup: buildDetailKeyboard(view, view.rootType),
    nextView: view,
  };
}

function createRootView(reportType, monthLabel, dateConfig) {
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

function openReportFiltersResponse(month, dateConfig, telegramUser) {
  return {
    text: reportFilterTitle(month, dateConfig),
    replyMarkup: mainMenuKeyboard(telegramUser),
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
    const dateConfig = selectedDateConfig(session, month, now);
    setSession(userId, {
      ...monthToSession(month, now),
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
    const month = getMonthFile(value, { includeInactive: false });
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    setSession(userId, {
      ...monthToSession(month, now),
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
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return {
        text: "No month files configured. Ask @antoniotsd to add one in Settings.",
        replyMarkup: monthKeyboard(telegramUser),
      };
    }

    const { rows, targetsMap, infoContext } = await readReportData(
      readRows,
      tabConfig,
      infoAgentsTabConfig,
      month.sheet_id,
    );
    const dateConfig = selectedDateConfig(session, month, now);
    const view = createRootView(value, month.month_label, dateConfig);
    const rendered = renderListView(view, rows, tabConfig, targetsMap, infoContext, now);
    setSession(userId, {
      ...monthToSession(month, now),
      dateFilter: dateConfig.filter,
      dateFilterLabel: dateConfig.label,
      dateFilterKey: dateConfig.key,
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
      });
      return {
        text: `Month: ${month.month_label}\nDate: ${dateConfig.label}\n${SPECIFIC_MENU_TEXT}`,
        replyMarkup: specificReportsKeyboard(),
      };
    }

    const { rows } = await readReportData(readRows, tabConfig, infoAgentsTabConfig, month.sheet_id);
    const dateFilters = withDateFilter({}, dateConfig);

    if (value === "hourly") {
      const distribution = hourlyDistribution(rows, tabConfig, dateFilters, "created", "totalLeads", now);
      setSession(userId, {
        ...commonSession,
        step: "special_reports_menu",
        specialSelection: null,
      });
      return {
        text: formatHourlyReport(
          `Hourly Leads (All) — ${month.month_label} (${dateConfig.label})`,
          distribution,
        ),
        replyMarkup: inlineKeyboard([
          [{ text: "By Country", callbackData: "special:hourlyScope:country" }],
          [{ text: "By Agent", callbackData: "special:hourlyScope:agentNames" }],
          [{ text: "By Team Leader", callbackData: "special:hourlyScope:teamLeader" }],
          [{ text: "By Office", callbackData: "special:hourlyScope:office" }],
          [{ text: "Back to Specific Reports", callbackData: "special:open" }],
          [{ text: "Back to Report Filters", callbackData: "menu:filters" }],
          [{ text: "Change Month", callbackData: "menu:main" }],
        ]),
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
        text: `Select ${metricLabelForField(fieldKey)} for hourly lead report:`,
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
      return {
        text: formatHourlyReport(
          `Hourly Leads — ${metricLabelForField(selection.fieldKey)}: ${pickedValue} (${dateConfig.label})`,
          distribution,
        ),
        replyMarkup: inlineKeyboard([
          [
            {
              text: `Change ${metricLabelForField(selection.fieldKey)}`,
              callbackData: `special:hourlyScope:${selection.fieldKey}`,
            },
          ],
          [{ text: "Back to Hourly Leads", callbackData: "special:hourly" }],
          [{ text: "Back to Specific Reports", callbackData: "special:open" }],
          [{ text: "Back to Report Filters", callbackData: "menu:filters" }],
          [{ text: "Change Month", callbackData: "menu:main" }],
        ]),
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
    );
    let view = session.view;
    if (!view) {
      const dateConfig = selectedDateConfig(session, month, now);
      return {
        text: reportFilterTitle(month, dateConfig),
        replyMarkup: mainMenuKeyboard(telegramUser),
      };
    }

    if (value === "page") {
      view = { ...view, page: Number(extra) || 0 };
      const rendered = renderListView(view, rows, tabConfig, targetsMap, infoContext, now);
      setSession(userId, { view: rendered.nextView });
      return { text: rendered.text, replyMarkup: rendered.replyMarkup };
    }

    if (value === "back") {
      if (!view.backStack?.length) {
        const dateConfig = selectedDateConfig(session, month, now);
        return {
          text: reportFilterTitle(month, dateConfig),
          replyMarkup: mainMenuKeyboard(telegramUser),
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
        return { text: "Unknown dimension.", replyMarkup: mainMenuKeyboard(telegramUser) };
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
