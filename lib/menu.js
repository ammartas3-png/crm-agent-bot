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
import { isAdminTelegramUser, isSettingsAdminTelegramUser } from "./permissions.js";
import { getOfficeMonthMap, officeCountryFromName } from "./officeMappings.js";
import { clearSession, getSession, setSession } from "./session.js";
import {
  buildInfoAgentsContext,
  canonicalAgentName,
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
const OFFICE_SCOPE_TEXT = "Select office country:";
const DATE_MENU_TEXT = "Select date filter:";
const SETTINGS_MENU_TEXT = "Settings";
const SPECIFIC_MENU_TEXT = "Specific Reports";
const TELEGRAM_TEXT_LIMIT = 4000;
const DAY_MS = 24 * 60 * 60 * 1000;
const LAST4_JOB_ENTRY_SPREADSHEET_ID_FALLBACK = "1vzfRxAIK_KGWFdXjbY1Lig3Daq0Jmej3LPEpYq5TSfY";
const LAST4_JOB_ENTRY_TAB_KEY = "turkeyNo1OfficeOnboarding";
const LAST4_JOB_ENTRY_NAME_COLUMN = "Person";
const LAST4_JOB_ENTRY_VALUE_COLUMN = "Job Entry";
const LAST4_JOB_ENTRY_COLUMNS = Array.from({ length: 38 }, (_, index) => {
  if (index === 0) {
    return LAST4_JOB_ENTRY_NAME_COLUMN;
  }
  if (index === 37) {
    return LAST4_JOB_ENTRY_VALUE_COLUMN;
  }
  return `Col${index + 1}`;
});
const LAST4_JOB_ENTRY_SHEET_NAMES = ["TURKEY No1 OFFICE  table", "TURKEY No1 OFFICE table"];

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
  agent: { mode: "list", fieldKey: "country", label: "Countries" },
  country: { mode: "list", fieldKey: "campaign", label: "Campaigns" },
  campaign: { mode: "list", fieldKey: "placement", label: "Placements" },
};

const DIMENSION_OPTIONS = [
  { label: "By Office", fieldKey: "office" },
  { label: "By Team Leader", fieldKey: "teamLeader" },
  { label: "By Agent", fieldKey: "agentNames" },
];

const DETAIL_NEXT_FIELDS = {
  office: ["teamLeader"],
  teamLeader: ["agentNames"],
  agentNames: ["country"],
  country: ["campaign"],
  campaign: ["placement"],
  placement: ["subCampaign"],
};

const DETAIL_NEXT_BUTTON_LABEL = {
  teamLeader: "View Team Leaders",
  agentNames: "View Agents",
  country: "View Countries",
  campaign: "View Campaigns",
  placement: "View Placements",
  subCampaign: "View Sub-Campaigns",
};
const MULTI_SELECT_GROUP_FIELDS = new Set([
  "office",
  "teamLeader",
  "agentNames",
  "country",
  "campaign",
  "placement",
  "subCampaign",
]);
const COUNT_SORT_GROUP_FIELDS = new Set(["country", "campaign", "placement", "subCampaign"]);
const EXPORT_HIERARCHY_ORDER = ["office", "teamLeader", "agent", "country", "campaign", "placement", "subCampaign"];

const LAST4_ALL_METRIC_COLUMNS = [
  { key: "target", label: "TARGET", type: "number", width: 11 },
  { key: "ftd", label: "FTD", type: "number", width: 10 },
  { key: "cr", label: "CR%", type: "percent", width: 10 },
  { key: "crTarget", label: "CR TARGET", type: "percent", width: 12 },
  { key: "crTargetReach", label: "CR TARGET REACH", type: "reach_percent", width: 16 },
  { key: "ftdTargetReach", label: "FTD TARGET REACH", type: "reach_percent", width: 16 },
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

function sessionMonthRecords(session = {}, options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const officeMonths = Array.isArray(session.officeMonthFiles) ? session.officeMonthFiles : [];
  if (officeMonths.length) {
    return officeMonths
      .filter((record) => (includeInactive ? true : record.active !== false))
      .sort((left, right) => String(right.key || "").localeCompare(String(left.key || "")));
  }
  return listMonthFiles({ includeInactive });
}

function sessionMonthRecordByKey(session = {}, key, options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const normalizedKey = String(key || "").trim();
  const officeMonths = Array.isArray(session.officeMonthFiles) ? session.officeMonthFiles : [];
  if (officeMonths.length) {
    const found = officeMonths.find((record) => String(record.key || "") === normalizedKey) || null;
    if (!found) {
      return null;
    }
    if (!includeInactive && found.active === false) {
      return null;
    }
    return found;
  }
  return getMonthFile(normalizedKey, { includeInactive });
}

function sessionMonthRecordsByKey(session = {}) {
  const records = sessionMonthRecords(session, { includeInactive: true });
  const byKey = {};
  for (const record of records) {
    byKey[record.key] = record;
  }
  return byKey;
}

function monthKeyboard(telegramUser, session = {}) {
  const monthButtons = sessionMonthRecords(session).map((month) => ({
    text: month.month_label,
    callbackData: `month:${month.key}`,
  }));
  const rows = chunkButtons(monthButtons, 2);
  rows.push([{ text: "Select Multiple Months", callbackData: "month:multi" }]);
  rows.push([{ text: "Last 4 Months", callbackData: "month:last4" }]);
  if (isSettingsAdminTelegramUser(telegramUser)) {
    rows.push([{ text: SETTINGS_MENU_TEXT, callbackData: "settings:open" }]);
  }
  return inlineKeyboard(rows);
}

function monthMultiKeyboard(selectedKeys = [], session = {}) {
  const selected = new Set(selectedKeys);
  const rows = sessionMonthRecords(session).map((month) => [
    {
      text: `${selected.has(month.key) ? "✅" : "⬜"} ${month.month_label}`,
      callbackData: `monthMulti:toggle:${month.key}`,
    },
  ]);
  rows.push([
    { text: "All", callbackData: "monthMulti:all" },
    { text: "Clear", callbackData: "monthMulti:clear" },
  ]);
  rows.push([{ text: "Done", callbackData: "monthMulti:done" }]);
  rows.push([{ text: "Back to Month Selection", callbackData: "menu:main" }]);
  return inlineKeyboard(rows);
}

function monthMultiPrompt(selectedKeys = [], session = {}) {
  const selectedMonths = selectedKeys
    .map((key) => sessionMonthRecordByKey(session, key, { includeInactive: false }))
    .filter(Boolean)
    .map((month) => month.month_label);
  return [
    "Select one or more months:",
    `Selected: ${selectedMonths.length ? selectedMonths.join(", ") : "none"}`,
    "Press Done to continue.",
  ].join("\n");
}

function monthMultiLabel(monthRecords = []) {
  const labels = monthRecords.map((month) => month.month_label).filter(Boolean);
  if (!labels.length) {
    return "Selected Months";
  }
  return `Selected Months (${labels.join(", ")})`;
}

function officeScopeKeyboard(countries = []) {
  const buttons = countries.map((country) => ({
    text: country,
    callbackData: `officeScope:${encodeURIComponent(country)}`,
  }));
  const rows = chunkButtons(buttons, 2);
  rows.push([{ text: "Back to Sections", callbackData: "root:start" }]);
  return inlineKeyboard(rows);
}

function countriesFromAuthorityScope(scopeFilters = {}) {
  const officeValues = Array.isArray(scopeFilters.office) ? scopeFilters.office : [];
  const countries = officeValues.map((office) => officeCountryFromName(office)).filter(Boolean);
  return [...new Set(countries)].sort((left, right) => left.localeCompare(right));
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
    [{ text: "Best Performers", callbackData: "special:bestOpen" }],
    [{ text: "Back to Report Filters", callbackData: "menu:filters" }],
    [{ text: "Change Month", callbackData: "menu:main" }],
  ]);
}

function bestPerformersKeyboard() {
  return inlineKeyboard([
    [{ text: "Best Agents", callbackData: "special:bestAgents" }],
    [{ text: "Best Countries", callbackData: "special:bestCountries" }],
    [{ text: "Back to Specific Reports", callbackData: "special:open" }],
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

function authorityScopeFilters(authorityScope = {}) {
  const filters = authorityScope?.filters || {};
  return Object.keys(filters).length ? { ...filters } : {};
}

function hasScopeFilters(scopeFilters = {}) {
  return Object.keys(scopeFilters).length > 0;
}

function scopedRowsByFilters(rows, tabConfig, scopeFilters = {}, now = new Date()) {
  if (!hasScopeFilters(scopeFilters)) {
    return rows;
  }
  return filteredRows(rows, tabConfig, scopeFilters, now);
}

function filterInfoAgentRowsByScope(infoRows = [], infoAgentsTabConfig, scopeFilters = {}, options = {}) {
  const hasOffice = Array.isArray(scopeFilters.office) ? scopeFilters.office.length > 0 : Boolean(scopeFilters.office);
  const hasTeamLeader = Array.isArray(scopeFilters.teamLeader)
    ? scopeFilters.teamLeader.length > 0
    : Boolean(scopeFilters.teamLeader);
  const hasAgent = Array.isArray(scopeFilters.agent) ? scopeFilters.agent.length > 0 : Boolean(scopeFilters.agent);
  const allowedAgents = options.allowedAgents || new Set();
  const enforceAllowedAgentSet = Boolean(options.enforceAllowedAgentSet);
  if (!hasOffice && !hasTeamLeader && !hasAgent && !enforceAllowedAgentSet) {
    return infoRows;
  }
  const officeField = getFieldName(infoAgentsTabConfig, "office");
  const teamLeaderField = getFieldName(infoAgentsTabConfig, "teamLeader");
  const agentField = getFieldName(infoAgentsTabConfig, "agentName");
  const normalizedOfficeSet = new Set(
    (Array.isArray(scopeFilters.office) ? scopeFilters.office : [scopeFilters.office]).map(normalizeText).filter(Boolean),
  );
  const normalizedTeamSet = new Set(
    (Array.isArray(scopeFilters.teamLeader) ? scopeFilters.teamLeader : [scopeFilters.teamLeader])
      .map(normalizeText)
      .filter(Boolean),
  );
  const normalizedAgentSet = new Set(
    (Array.isArray(scopeFilters.agent) ? scopeFilters.agent : [scopeFilters.agent])
      .map((value) => normalizeAgentName(canonicalAgentName(value)))
      .filter(Boolean),
  );

  return infoRows.filter((row) => {
    const office = normalizeText(getRowValue(row, officeField));
    const teamLeader = normalizeText(getRowValue(row, teamLeaderField));
    const agent = normalizeAgentName(canonicalAgentName(getRowValue(row, agentField)));
    if (normalizedOfficeSet.size > 0 && !normalizedOfficeSet.has(office)) {
      return false;
    }
    if (normalizedTeamSet.size > 0 && !normalizedTeamSet.has(teamLeader)) {
      return false;
    }
    if (normalizedAgentSet.size > 0 && !normalizedAgentSet.has(agent)) {
      return false;
    }
    if (enforceAllowedAgentSet && allowedAgents.size > 0 && !allowedAgents.has(agent)) {
      return false;
    }
    return true;
  });
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
  const ranked = rankedPerformanceItems(rows, tabConfig, filters, fieldKey, now);
  if (!ranked.length) {
    return [`${title}: no data`];
  }
  const lines = [title];
  for (let index = 0; index < ranked.length; index += 1) {
    const item = ranked[index];
    const line = bestRankingLine(index, item);
    if ([...lines, line].join("\n").length > TELEGRAM_TEXT_LIMIT) {
      lines.push("...more rows available");
      break;
    }
    lines.push(line);
  }
  return lines;
}

function rankedPerformanceItems(rows, tabConfig, filters, fieldKey, now = new Date()) {
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
  return [...groups.entries()]
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
        right.summary.totalLeads - left.summary.totalLeads ||
        String(left.label || "").localeCompare(String(right.label || "")),
    );
}

function bestRankingLine(index, item) {
  const reachDisplay =
    item.summary.crTarget > 0 ? formatOptionalPercent(item.summary.crTargetReach) : "-";
  return `${index + 1}. ${item.label} | Lead ${item.summary.totalLeads.toLocaleString(
    "en-US",
  )} | FTD ${item.summary.totalFtd.toLocaleString("en-US")} | CR ${formatPercent(
    item.summary.cr,
  )} | CR Target Reach ${reachDisplay}`;
}

function bestRankingLines(title, rankedItems, limit = 8) {
  if (!rankedItems.length) {
    return [`${title}: no data`];
  }
  const lines = [title];
  const visible = rankedItems.slice(0, limit);
  for (let index = 0; index < visible.length; index += 1) {
    lines.push(bestRankingLine(index, visible[index]));
  }
  if (rankedItems.length > limit) {
    lines.push(`...+${rankedItems.length - limit} more`);
  }
  return lines;
}

function bestScopeSummaryLine(summary) {
  const reachDisplay =
    summary.crTarget > 0 ? formatOptionalPercent(summary.crTargetReach) : "-";
  return `Lead ${summary.totalLeads.toLocaleString("en-US")} | FTD ${summary.totalFtd.toLocaleString(
    "en-US",
  )} | CR ${formatPercent(summary.cr)} | CR Target Reach ${reachDisplay}`;
}

function bestSelectionValues(rows, tabConfig, filters, fieldKey, now = new Date()) {
  return rankedPerformanceItems(rows, tabConfig, filters, fieldKey, now).map((item) => item.label);
}

function bestContextNavigationRows() {
  return [
    [{ text: "Back to Best Performers", callbackData: "special:bestOpen" }],
    [{ text: "Back to Specific Reports", callbackData: "special:open" }],
    [{ text: "Back to Report Filters", callbackData: "menu:filters" }],
    [{ text: "Change Month", callbackData: "menu:main" }],
  ];
}

function bestDetailKeyboard(rows = []) {
  return inlineKeyboard([...rows, ...bestContextNavigationRows()]);
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
  const saved = session.monthKey ? sessionMonthRecordByKey(session, session.monthKey, { includeInactive: false }) : null;
  if (saved) {
    return saved;
  }
  return (
    sessionMonthRecordByKey(session, currentMonthKey(now), { includeInactive: false }) ||
    sessionMonthRecords(session)[0] ||
    null
  );
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

function getLastFourMonthRecords(now = new Date(), session = {}) {
  const activeMonths = sessionMonthRecords(session)
    .filter((month) => month.active !== false)
    .sort((left, right) => right.key.localeCompare(left.key));
  const preferred = activeMonths.filter((month) => month.key <= currentMonthKey(now));
  const source = preferred.length ? preferred : activeMonths;
  return source.slice(0, 4);
}

function normalizeJobEntryName(value) {
  return normalizeAgentName(canonicalAgentName(value));
}

function formatJobEntryValue(value) {
  const date = parseDateValue(value);
  if (date) {
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const year = String(date.getUTCFullYear());
    return `${day}/${month}/${year}`;
  }
  return String(value ?? "").trim();
}

function buildLast4JobEntryMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const rawName = getRowValue(row, LAST4_JOB_ENTRY_NAME_COLUMN);
    const normalizedName = normalizeJobEntryName(rawName);
    if (!normalizedName || map.has(normalizedName)) {
      continue;
    }
    const rawEntry = getRowValue(row, LAST4_JOB_ENTRY_VALUE_COLUMN);
    const formattedEntry = formatJobEntryValue(rawEntry);
    if (!formattedEntry) {
      continue;
    }
    map.set(normalizedName, formattedEntry);
  }
  return map;
}

async function readLast4JobEntryMap(readRows) {
  const spreadsheetId = process.env.LAST4_JOB_ENTRY_SPREADSHEET_ID || LAST4_JOB_ENTRY_SPREADSHEET_ID_FALLBACK;
  if (!spreadsheetId) {
    return new Map();
  }
  for (const sheetName of LAST4_JOB_ENTRY_SHEET_NAMES) {
    const tabConfig = {
      name: sheetName,
      range: `'${sheetName.replace(/'/g, "''")}'!E:AP`,
      columns: LAST4_JOB_ENTRY_COLUMNS,
    };
    try {
      const rows = await readRows(LAST4_JOB_ENTRY_TAB_KEY, { tabConfig, spreadsheetId });
      return buildLast4JobEntryMap(rows);
    } catch {
      // Try next possible sheet name variant.
    }
  }
  return new Map();
}

function currentInfoMonthRecord(last4Records = [], now = new Date(), session = {}) {
  const current = sessionMonthRecordByKey(session, currentMonthKey(now), { includeInactive: false });
  if (current) {
    return current;
  }
  return last4Records[0] || null;
}

function normalizeAgentId(value) {
  return String(value || "").trim().toLocaleUpperCase("en-US");
}

function buildAgentDirectoryMap(agentDirectoryRows = [], agentDirectoryTabConfig) {
  const agentIdField = getFieldName(agentDirectoryTabConfig, "agentId");
  const agentNameField = getFieldName(agentDirectoryTabConfig, "agentName");
  const map = new Map();
  for (const row of agentDirectoryRows) {
    const agentId = normalizeAgentId(getRowValue(row, agentIdField) || getRowValue(row, "Agent ID"));
    const agentName = canonicalAgentName(
      String(getRowValue(row, agentNameField) || getRowValue(row, "Agent Name") || "").trim(),
    );
    if (!agentId || !agentName) {
      continue;
    }
    map.set(agentId, agentName);
  }
  return map;
}

function agentNameFromPreviousMonthsById(agentId, rowMonthKey, monthOrderKeys = [], monthAgentDirectoryByKey = {}) {
  if (!agentId || !rowMonthKey) {
    return "";
  }
  const rowMonthIndex = monthOrderKeys.indexOf(rowMonthKey);
  if (rowMonthIndex < 0) {
    return "";
  }
  const sameMonthMap = monthAgentDirectoryByKey?.[rowMonthKey];
  const sameMonthMatch = sameMonthMap?.get(agentId);
  if (sameMonthMatch) {
    return sameMonthMatch;
  }
  // Search nearest newer month first (e.g. April row checks May first), stop on first match.
  for (let index = rowMonthIndex - 1; index >= 0; index -= 1) {
    const monthKey = monthOrderKeys[index];
    const monthMap = monthAgentDirectoryByKey?.[monthKey];
    const match = monthMap?.get(agentId);
    if (match) {
      return match;
    }
  }
  return "";
}

function remapRowsToCurrentInfo(rows = [], tabConfig, infoContext, options = {}) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const agentIdField = getFieldName(tabConfig, "agentId");
  const officeField = getFieldName(tabConfig, "office");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  const currentAgentNameById = options.currentAgentNameById || new Map();
  const monthOrderKeys = options.monthOrderKeys || [];
  const monthAgentDirectoryByKey = options.monthAgentDirectoryByKey || {};
  return rows.map((row) => {
    const rawAgentName = canonicalAgentName(String(getRowValue(row, agentField) || "").trim());
    const normalizedAgentId = normalizeAgentId(
      getRowValue(row, agentIdField) || getRowValue(row, "Agent ID"),
    );
    const nameFromCurrentById = normalizedAgentId ? canonicalAgentName(currentAgentNameById.get(normalizedAgentId)) : "";
    const nameFromPreviousMonths = normalizedAgentId
      ? canonicalAgentName(agentNameFromPreviousMonthsById(
          normalizedAgentId,
          row.__reportMonthKey,
          monthOrderKeys,
          monthAgentDirectoryByKey,
        ))
      : "";
    const resolvedAgentName = nameFromCurrentById || nameFromPreviousMonths || rawAgentName;
    const normalizedAgent = normalizeAgentName(resolvedAgentName);
    const currentRecord = normalizedAgent ? infoContext?.byAgent?.get(normalizedAgent) : null;
    if (!currentRecord) {
      if (resolvedAgentName && resolvedAgentName !== rawAgentName) {
        return {
          ...row,
          [agentField]: resolvedAgentName,
        };
      }
      return row;
    }
    return {
      ...row,
      [agentField]: currentRecord.agent_name || resolvedAgentName || rawAgentName,
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

function applyAgentNameAliases(rows = [], tabConfig) {
  const agentField = getFieldName(tabConfig, "agentNames");
  return rows.map((row) => {
    const rawAgentName = String(getRowValue(row, agentField) || "").trim();
    const canonicalName = canonicalAgentName(rawAgentName);
    if (!canonicalName || canonicalName === rawAgentName) {
      return row;
    }
    return {
      ...row,
      [agentField]: canonicalName,
    };
  });
}

async function readReportData(readRows, tabConfig, infoAgentsTabConfig, spreadsheetId, options = {}) {
  const scopeFilters = options.scopeFilters || {};
  const scopeNow = options.now || new Date();
  if (options.last3Mode) {
    const agentDirectoryTabConfig = options.agentDirectoryTabConfig || getTabConfig("agentDirectory");
    const sessionMonthByKey = options.monthRecordsByKey || {};
    const monthCandidates = options.last3MonthKeys?.length
      ? options.last3MonthKeys
          .map((key) => sessionMonthByKey[key] || getMonthFile(key, { includeInactive: false }))
          .filter(Boolean)
      : getLastFourMonthRecords(options.now || new Date(), options.session || {});
    const months = [...monthCandidates].sort((left, right) => right.key.localeCompare(left.key));
    const mergedRows = [];
    const monthInfoContextByKey = {};
    const monthAgentDirectoryByKey = {};
    for (const month of months) {
      const monthRows = scopedRowsByFilters(
        await readRows("leads", { tabConfig, spreadsheetId: month.sheet_id }),
        tabConfig,
        scopeFilters,
        scopeNow,
      );
      let monthInfoRows = [];
      try {
        monthInfoRows = await readRows("infoAgents", {
          tabConfig: infoAgentsTabConfig,
          spreadsheetId: month.sheet_id,
        });
      } catch {
        monthInfoRows = [];
      }
      const agentField = getFieldName(tabConfig, "agentNames");
      const allowedAgents = new Set(
        monthRows
          .map((row) => normalizeAgentName(canonicalAgentName(getRowValue(row, agentField))))
          .filter(Boolean),
      );
      monthInfoRows =
        scopeFilters.department && allowedAgents.size === 0
          ? []
          : filterInfoAgentRowsByScope(monthInfoRows, infoAgentsTabConfig, scopeFilters, {
              allowedAgents,
              enforceAllowedAgentSet: Boolean(scopeFilters.department),
            });
      let monthAgentDirectoryRows = [];
      try {
        monthAgentDirectoryRows = await readRows("agentDirectory", {
          tabConfig: agentDirectoryTabConfig,
          spreadsheetId: month.sheet_id,
        });
      } catch {
        monthAgentDirectoryRows = [];
      }
      monthInfoContextByKey[month.key] = buildInfoAgentsContext(monthInfoRows);
      monthAgentDirectoryByKey[month.key] = buildAgentDirectoryMap(monthAgentDirectoryRows, agentDirectoryTabConfig);
      mergedRows.push(
        ...monthRows.map((row) => ({
          ...row,
          __reportMonthKey: month.key,
          __reportMonthLabel: month.month_label,
        })),
      );
    }
    const infoMonth = currentInfoMonthRecord(months, options.now || new Date(), options.session || {});
    const infoContext = (infoMonth && monthInfoContextByKey[infoMonth.key]) || buildInfoAgentsContext([]);
    const aliasedRows = applyAgentNameAliases(mergedRows, tabConfig);
    const remappedRows = remapRowsToCurrentInfo(aliasedRows, tabConfig, infoContext, {
      currentAgentNameById: (infoMonth && monthAgentDirectoryByKey[infoMonth.key]) || new Map(),
      monthOrderKeys: months.map((item) => item.key),
      monthAgentDirectoryByKey,
    });
    const agentField = getFieldName(tabConfig, "agentNames");
    const workingAgents = new Set(infoContext.agents || []);
    const filteredRows = remappedRows.filter((row) => {
      const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
      return normalizedAgent && workingAgents.has(normalizedAgent);
    });
    return {
      rows: filteredRows,
      targetsMap: infoContext.targetsByAgent,
      infoContext,
      monthInfoContextByKey,
      months,
    };
  }

  const rows = applyAgentNameAliases(
    scopedRowsByFilters(await readRows("leads", { tabConfig, spreadsheetId }), tabConfig, scopeFilters, scopeNow),
    tabConfig,
  );
  let infoAgentRows = [];
  try {
    infoAgentRows = await readRows("infoAgents", { tabConfig: infoAgentsTabConfig, spreadsheetId });
  } catch {
    infoAgentRows = [];
  }
  const scopedAgentField = getFieldName(tabConfig, "agentNames");
  const scopedAgents = new Set(
    rows
      .map((row) => normalizeAgentName(canonicalAgentName(getRowValue(row, scopedAgentField))))
      .filter(Boolean),
  );
  infoAgentRows =
    scopeFilters.department && scopedAgents.size === 0
      ? []
      : filterInfoAgentRowsByScope(infoAgentRows, infoAgentsTabConfig, scopeFilters, {
          allowedAgents: scopedAgents,
          enforceAllowedAgentSet: Boolean(scopeFilters.department),
        });
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
      subCampaign: "Sub-Campaign",
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

function hierarchyFromScope({ groupField, label = "", filters = {}, infoContext } = {}) {
  const singleFilterValue = (value) => {
    if (Array.isArray(value)) {
      const normalizedValues = value.map((item) => String(item || "").trim()).filter(Boolean);
      return normalizedValues.length === 1 ? normalizedValues[0] : "";
    }
    return String(value || "").trim();
  };
  let office = singleFilterValue(filters.office);
  let teamLeader = singleFilterValue(filters.teamLeader);
  let agent = singleFilterValue(filters.agent);
  let country = singleFilterValue(filters.country);
  let campaign = singleFilterValue(filters.campaign);
  let placement = singleFilterValue(filters.placement);
  let subCampaign = singleFilterValue(filters.subCampaign);

  if (groupField === "office" && label) {
    office = label;
  }
  if (groupField === "teamLeader" && label) {
    teamLeader = label;
    if (!office) {
      office = officeForTeamLeaderLabel(infoContext, label);
    }
  }
  if (groupField === "agentNames" && label) {
    agent = label;
    const assignment = assignmentForAgentLabel(infoContext, label);
    if (!teamLeader) {
      teamLeader = assignment.teamLeader;
    }
    if (!office) {
      office = assignment.office;
    }
  }
  if (groupField === "country" && label) {
    country = label;
  }
  if (groupField === "campaign" && label) {
    campaign = label;
  }
  if (groupField === "placement" && label) {
    placement = label;
  }
  if (groupField === "subCampaign" && label) {
    subCampaign = label;
  }

  if (agent && (!teamLeader || !office)) {
    const assignment = assignmentForAgentLabel(infoContext, agent);
    if (!teamLeader) {
      teamLeader = assignment.teamLeader;
    }
    if (!office) {
      office = assignment.office;
    }
  }
  if (teamLeader && !office) {
    office = officeForTeamLeaderLabel(infoContext, teamLeader);
  }

  const item =
    label ||
    subCampaign ||
    placement ||
    campaign ||
    country ||
    agent ||
    teamLeader ||
    office ||
    "";

  return { office, teamLeader, agent, country, campaign, placement, subCampaign, item };
}

function selectedFilterDisplay(filters = {}, key) {
  const values = selectedFilterValues(filters, key);
  if (!values.length) {
    return "";
  }
  if (values.length === 1) {
    return values[0];
  }
  return values.join(", ");
}

function mergeHierarchyWithSelectedFilters(hierarchy = {}, filters = {}) {
  const keys = ["office", "teamLeader", "agent", "country", "campaign", "placement", "subCampaign"];
  const next = { ...hierarchy };
  for (const key of keys) {
    if (!String(next[key] || "").trim()) {
      next[key] = selectedFilterDisplay(filters, key);
    }
  }
  return next;
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
      subCampaign: "subCampaign",
    }[fieldKey] || fieldKey
  );
}

function normalizeFilterSelection(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  }
  const normalized = String(value || "").trim();
  return normalized ? normalized : "";
}

function applyFieldFilter(filters, fieldKey, value) {
  const next = { ...filters };
  const filterKey = fieldToFilterKey(fieldKey);
  next[filterKey] = normalizeFilterSelection(value);
  if (fieldKey === "agentNames") {
    next.agentField = "agentNames";
  }
  return next;
}

function currentFilterSetForView(view = {}) {
  return view.filters || view.baseFilters || {};
}

function exportGroupKey(groupField = "") {
  if (groupField === "agentNames") {
    return "agent";
  }
  return groupField;
}

function exportParentFieldsForView(view = {}) {
  const groupKey = exportGroupKey(view.groupField || "");
  const groupIndex = EXPORT_HIERARCHY_ORDER.indexOf(groupKey);
  if (groupIndex <= 0) {
    return [];
  }
  const filters = currentFilterSetForView(view);
  return EXPORT_HIERARCHY_ORDER.slice(0, groupIndex).filter((key) => {
    return selectedFilterValues(filters, key).length > 0;
  });
}

function filterKeyToFieldKey(filterKey = "") {
  return (
    {
      agent: "agentNames",
    }[filterKey] || filterKey
  );
}

function shouldBuildPivotLikeListRows(view = {}) {
  if (view.metricsMode !== "full") {
    return false;
  }
  const groupKey = exportGroupKey(view.groupField || "");
  return ["country", "campaign", "placement", "subCampaign"].includes(groupKey);
}

function buildPivotLikeRowsForListView(view, rows, tabConfig, targetsMap, infoContext, now = new Date()) {
  const filters = view.baseFilters || {};
  const groupKey = exportGroupKey(view.groupField || "");
  const groupIndex = EXPORT_HIERARCHY_ORDER.indexOf(groupKey);
  if (groupIndex < 0) {
    return [];
  }
  const parentKeys = EXPORT_HIERARCHY_ORDER.slice(0, groupIndex).filter(
    (key) => selectedFilterValues(filters, key).length > 0,
  );
  const hierarchyKeys = [...parentKeys, groupKey];
  const rowsWithoutDate = filteredRows(rows, tabConfig, withoutDateFilters(filters), now);
  const grouped = new Map();
  for (const row of rowsWithoutDate) {
    const values = {};
    for (const key of hierarchyKeys) {
      const fieldKey = filterKeyToFieldKey(key);
      values[key] = String(getRowValue(row, getFieldName(tabConfig, fieldKey)) || "").trim();
    }
    const compoundKey = hierarchyKeys.map((key) => normalizeText(values[key])).join("::");
    if (!compoundKey || !compoundKey.replace(/:/g, "")) {
      continue;
    }
    if (!grouped.has(compoundKey)) {
      grouped.set(compoundKey, { values, rows: [] });
    }
    grouped.get(compoundKey).rows.push(row);
  }
  const dateFilters = onlyDateFilters(filters);
  return [...grouped.values()]
    .map((group) => {
      const groupFilters = { ...filters };
      for (const key of hierarchyKeys) {
        groupFilters[key] = group.values[key];
      }
      if (groupFilters.agent) {
        groupFilters.agentField = "agentNames";
      }
      const summary = calculateSummary(group.rows, tabConfig, dateFilters, now);
      const metrics = metricPayload(
        summary,
        view.groupField,
        group.values[groupKey] || "",
        groupFilters,
        tabConfig,
        targetsMap,
        infoContext,
        now,
      );
      const hierarchy = mergeHierarchyWithSelectedFilters(
        hierarchyFromScope({
          groupField: view.groupField,
          label: group.values[groupKey] || "",
          filters: groupFilters,
          infoContext,
        }),
        groupFilters,
      );
      return {
        kind: "group",
        level: metricLabelForField(view.groupField),
        office: hierarchy.office,
        teamLeader: hierarchy.teamLeader,
        agent: hierarchy.agent,
        country: hierarchy.country,
        campaign: hierarchy.campaign,
        placement: hierarchy.placement,
        subCampaign: hierarchy.subCampaign,
        item: group.values[groupKey] || "",
        name: group.values[groupKey] || "",
        month: "",
        metrics,
      };
    })
    .sort(
      (left, right) =>
        right.metrics.lead - left.metrics.lead ||
        right.metrics.ftd - left.metrics.ftd ||
        right.metrics.cr - left.metrics.cr ||
        String(left.item || "").localeCompare(String(right.item || "")),
    );
}

function compareItemsForGroup(groupField, left, right) {
  if (COUNT_SORT_GROUP_FIELDS.has(groupField)) {
    return (
      right.summary.totalLeads - left.summary.totalLeads ||
      right.summary.totalFtd - left.summary.totalFtd ||
      right.summary.cr - left.summary.cr ||
      String(left.label || "").localeCompare(String(right.label || ""))
    );
  }
  return String(left.label || "").localeCompare(String(right.label || ""));
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
      (left, right) => compareItemsForGroup(groupField, left, right),
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

function formatSelectedLabels(labels = [], limit = 6) {
  if (!labels.length) {
    return "none";
  }
  if (labels.length <= limit) {
    return labels.join(", ");
  }
  return `${labels.slice(0, limit).join(", ")} +${labels.length - limit} more`;
}

function selectedFilterValues(filters = {}, key) {
  const rawValue = filters[key];
  if (Array.isArray(rawValue)) {
    return rawValue.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const single = String(rawValue || "").trim();
  return single ? [single] : [];
}

function shouldAutoMultiSelect(view = {}) {
  return (
    view.mode === "list" &&
    view.metricsMode !== "last4" &&
    MULTI_SELECT_GROUP_FIELDS.has(view.groupField) &&
    !view.disableAutoMulti
  );
}

function enableMultiSelectView(view = {}, items = []) {
  const values = items.map((item) => item.label).filter(Boolean);
  const filterKey = fieldToFilterKey(view.groupField);
  const preselected = selectedFilterValues(currentFilterSetForView(view), filterKey).filter((label) =>
    values.includes(label),
  );
  return {
    ...view,
    multiSelect: {
      values,
      selected: preselected,
      page: 0,
    },
  };
}

function buildMultiSelectKeyboard(view) {
  const selection = view.multiSelect || {};
  const values = selection.values || [];
  const selected = new Set(selection.selected || []);
  const { chunk, start, totalPages, page } = paginateItems(values, selection.page || 0, 10);
  const rows = chunkButtons(
    chunk.map((label, index) => ({
      text: `${selected.has(label) ? "✅" : "⬜"} ${label}`,
      callbackData: `drill:multiToggle:${start + index}`,
    })),
    1,
  );
  if (totalPages > 1) {
    rows.push([
      { text: "Previous Page", callbackData: `drill:multiPage:${Math.max(page - 1, 0)}` },
      { text: "Next Page", callbackData: `drill:multiPage:${Math.min(page + 1, totalPages - 1)}` },
    ]);
  }
  rows.push([
    { text: "All", callbackData: "drill:multiAll" },
    { text: "Clear", callbackData: "drill:multiClear" },
  ]);
  rows.push([{ text: "Done", callbackData: "drill:multiDone" }]);
  rows.push([{ text: "Back to list", callbackData: "drill:multiCancel" }]);
  rows.push([{ text: "Back to Report Filters", callbackData: "menu:filters" }]);
  rows.push([{ text: "Change Month", callbackData: "menu:main" }]);
  return inlineKeyboard(rows);
}

function multiSelectPrompt(view) {
  const selection = view.multiSelect || {};
  const selected = selection.selected || [];
  return [
    `Multi-select ${metricLabelForField(view.groupField)}`,
    `Selected ${selected.length}/${(selection.values || []).length}`,
    `Values: ${formatSelectedLabels(selected)}`,
  ].join("\n");
}

function compactFilterSummary(filters = {}) {
  const labels = {
    office: "Office",
    teamLeader: "Team Leader",
    agent: "Agent",
    country: "Country",
    campaign: "Campaign",
    placement: "Placement",
    subCampaign: "Sub-Campaign",
  };
  const chunks = [];
  for (const [key, label] of Object.entries(labels)) {
    const values = selectedFilterValues(filters, key);
    if (!values.length) {
      continue;
    }
    const shown = values.slice(0, 3);
    const extraCount = Math.max(values.length - shown.length, 0);
    const summary = extraCount > 0 ? `${shown.join(", ")} +${extraCount} more` : shown.join(", ");
    chunks.push(`${label}: ${summary}`);
  }
  return chunks.join(" | ");
}

function safeFileChunk(value = "") {
  return String(value || "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function exportFileNameForView(view, session, now = new Date()) {
  const label = safeFileChunk(metricLabelForField(view.groupField));
  const month = safeFileChunk(session?.monthLabel || "month");
  const filters = currentFilterSetForView(view);
  const filterParts = ["office", "teamLeader", "agent", "country", "campaign", "placement", "subCampaign"]
    .flatMap((key) => selectedFilterValues(filters, key))
    .slice(0, 3)
    .map((value) => safeFileChunk(value))
    .filter(Boolean);
  const timestamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
    now.getUTCDate(),
  ).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(
    2,
    "0",
  )}${String(now.getUTCSeconds()).padStart(2, "0")}`;
  const parts = [label, month, ...filterParts, timestamp].filter(Boolean);
  return `${parts.join("-")}.xlsx`;
}

function exportCaptionForView(view, session) {
  const title = `${metricLabelForField(view.groupField)} Report`;
  const month = session?.monthLabel ? `Month: ${session.monthLabel}` : "";
  const filters = compactFilterSummary(currentFilterSetForView(view));
  return [title, month, filters].filter(Boolean).join(" | ");
}

function buildListKeyboard(view, pageChunk, start, page, totalPages) {
  const rows = [];

  const selectedCurrentLevel = selectedFilterValues(
    currentFilterSetForView(view),
    fieldToFilterKey(view.groupField),
  );
  if (view.mode === "list" && selectedCurrentLevel.length > 0) {
    const nextFields = DETAIL_NEXT_FIELDS[view.groupField] || [];
    for (const nextField of nextFields) {
      rows.push([
        {
          text: `Drill by ${metricLabelForField(nextField)}`,
          callbackData: `drill:listNext:${nextField}`,
        },
      ]);
    }
  }
  rows.push(
    ...chunkButtons(
      pageChunk.map((item, index) => ({
        text: item.label,
        callbackData: `drill:pick:${start + index}`,
      })),
      2,
    ),
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

  if (
    view.mode === "list" &&
    MULTI_SELECT_GROUP_FIELDS.has(view.groupField) &&
    !view.multiSelect &&
    pageChunk.length > 0
  ) {
    rows.push([{ text: "Change Selection", callbackData: "drill:multiStart" }]);
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
  const nextFields = DETAIL_NEXT_FIELDS[view.groupField] || [];
  for (const nextField of nextFields) {
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

  const itemLineGroups =
    view.metricsMode === "last4"
      ? chunk.map((item, index) => {
          const lines = [formatMetricLine(`${start + index + 1}. ${item.label}`, item.metrics, view.metricsMode)];
          for (const monthMetric of item.monthlyMetrics || []) {
            lines.push(`   | ${monthMetric.monthLabel} | ${formatLast4MetricValues(monthMetric.metrics)}`);
          }
          return lines;
        })
      : chunk.map((item, index) => [formatMetricLine(`${start + index + 1}. ${item.label}`, item.metrics, view.metricsMode)]);

  const lines = [
    view.title,
    `Page ${page + 1}/${totalPages}`,
    "",
    formatMetricLine("Summary (all records)", totalMetrics, view.metricsMode),
    "",
    ...itemLineGroups.flat(),
  ];

  let text = lines.join("\n");
  if (text.length > TELEGRAM_TEXT_LIMIT) {
    const baseLines = [
      view.title,
      `Page ${page + 1}/${totalPages}`,
      "",
      formatMetricLine("Summary (all records)", totalMetrics, view.metricsMode),
      "",
    ];
    const selectedGroups = [];
    let candidateText = baseLines.join("\n");
    for (const groupLines of itemLineGroups) {
      const nextLines = [...baseLines, ...selectedGroups.flat(), ...groupLines];
      const nextText = nextLines.join("\n");
      if (nextText.length > TELEGRAM_TEXT_LIMIT && selectedGroups.length > 0) {
        break;
      }
      selectedGroups.push(groupLines);
      candidateText = nextText;
      if (nextText.length >= TELEGRAM_TEXT_LIMIT) {
        break;
      }
    }
    text = candidateText;
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

function renderedListResponseWithAutoMulti(rendered) {
  if (!rendered?.nextView || !shouldAutoMultiSelect(rendered.nextView)) {
    return null;
  }
  const nextView = enableMultiSelectView(rendered.nextView, rendered.items || []);
  if (!(nextView.multiSelect?.values || []).length) {
    return null;
  }
  return {
    text: multiSelectPrompt(nextView),
    replyMarkup: buildMultiSelectKeyboard(nextView),
    nextView,
    editCurrentMessage: true,
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
  const summaryHierarchy = hierarchyFromScope({
    groupField: view.groupField,
    label: "",
    filters: view.baseFilters || {},
    infoContext,
  });
  const resolvedSummaryHierarchy = mergeHierarchyWithSelectedFilters(summaryHierarchy, view.baseFilters || {});
  const outputRows = shouldBuildPivotLikeListRows(view)
    ? buildPivotLikeRowsForListView(view, rows, tabConfig, targetsMap, infoContext, now)
    : [];
  if (!outputRows.length) {
    for (const item of items) {
      const itemHierarchy = hierarchyFromScope({
        groupField: view.groupField,
        label: item.label,
        filters: view.baseFilters || {},
        infoContext,
      });
      const resolvedItemHierarchy = mergeHierarchyWithSelectedFilters(itemHierarchy, view.baseFilters || {});
      outputRows.push({
        kind: "group",
        level: metricLabelForField(view.groupField),
        office: resolvedItemHierarchy.office,
        teamLeader: resolvedItemHierarchy.teamLeader,
        agent: resolvedItemHierarchy.agent,
        country: resolvedItemHierarchy.country,
        campaign: resolvedItemHierarchy.campaign,
        placement: resolvedItemHierarchy.placement,
        subCampaign: resolvedItemHierarchy.subCampaign,
        item: item.label,
        name: item.label,
        month: "",
        metrics: item.metrics,
      });
      for (const monthMetric of item.monthlyMetrics || []) {
        outputRows.push({
          kind: "month",
          level: metricLabelForField(view.groupField),
          office: resolvedItemHierarchy.office,
          teamLeader: resolvedItemHierarchy.teamLeader,
          agent: resolvedItemHierarchy.agent,
          country: resolvedItemHierarchy.country,
          campaign: resolvedItemHierarchy.campaign,
          placement: resolvedItemHierarchy.placement,
          subCampaign: resolvedItemHierarchy.subCampaign,
          item: item.label,
          name: item.label,
          month: monthMetric.monthLabel,
          metrics: monthMetric.metrics,
        });
      }
    }
  }
  outputRows.push({
    kind: "total",
    level: "Total",
    office: resolvedSummaryHierarchy.office,
    teamLeader: resolvedSummaryHierarchy.teamLeader,
    agent: resolvedSummaryHierarchy.agent,
    country: resolvedSummaryHierarchy.country,
    campaign: resolvedSummaryHierarchy.campaign,
    placement: resolvedSummaryHierarchy.placement,
    subCampaign: resolvedSummaryHierarchy.subCampaign,
    item: "Total",
    name: "Total",
    month: "",
    metrics: totalMetrics,
  });
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
  const detailHierarchy = hierarchyFromScope({
    groupField: view.groupField,
    label: view.selectedLabel || "",
    filters: view.filters || {},
    infoContext,
  });
  const resolvedDetailHierarchy = mergeHierarchyWithSelectedFilters(detailHierarchy, view.filters || {});
  return [
    {
      kind: "group",
      level: metricLabelForField(view.groupField),
      office: resolvedDetailHierarchy.office,
      teamLeader: resolvedDetailHierarchy.teamLeader,
      agent: resolvedDetailHierarchy.agent,
      country: resolvedDetailHierarchy.country,
      campaign: resolvedDetailHierarchy.campaign,
      placement: resolvedDetailHierarchy.placement,
      subCampaign: resolvedDetailHierarchy.subCampaign,
      item: view.selectedLabel || metricLabelForField(view.groupField),
      name: view.selectedLabel || metricLabelForField(view.groupField),
      month: "",
      metrics,
    },
    ...monthlyMetrics.map((monthMetric) => ({
      kind: "month",
      level: metricLabelForField(view.groupField),
      office: resolvedDetailHierarchy.office,
      teamLeader: resolvedDetailHierarchy.teamLeader,
      agent: resolvedDetailHierarchy.agent,
      country: resolvedDetailHierarchy.country,
      campaign: resolvedDetailHierarchy.campaign,
      placement: resolvedDetailHierarchy.placement,
      subCampaign: resolvedDetailHierarchy.subCampaign,
      item: view.selectedLabel || metricLabelForField(view.groupField),
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
  jobEntryByAgent = new Map(),
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
    const jobEntry = jobEntryByAgent.get(normalizeJobEntryName(item.label)) || "";
    return {
      level: "Agent",
      office: assignment.office,
      teamLeader: assignment.teamLeader,
      agent: item.label,
      jobEntry,
      monthMetrics: monthMetricsByKey(item.monthlyMetrics || []),
    };
  });
}

function buildLast4AllCombinedRows(_officeRows = [], _teamLeaderRows = [], agentRows = []) {
  const seen = new Set();
  const filteredRows = [];
  for (const agentRow of agentRows) {
    const agent = String(agentRow.agent || "").trim();
    if (!agent) {
      continue;
    }
    const officeKey = normalizeText(agentRow.office || "");
    const teamLeaderKey = normalizeText(agentRow.teamLeader || "");
    const agentKey = normalizeAgentName(agent);
    const uniq = `${officeKey}::${teamLeaderKey}::${agentKey}`;
    if (seen.has(uniq)) {
      continue;
    }
    seen.add(uniq);
    const sameAsTeamLeader = teamLeaderKey && agentKey && normalizeAgentName(agentRow.teamLeader) === agentKey;
    filteredRows.push({
      ...agentRow,
      level: sameAsTeamLeader ? "Team Leader" : "Agent",
    });
  }

  const scoreRow = (row) =>
    Object.values(row.monthMetrics || {}).reduce(
      (sum, metrics) => sum + Number(metrics?.ftd || 0),
      0,
    );

  const groupMap = new Map();
  for (const row of filteredRows) {
    const officeKey = normalizeText(row.office || "");
    const teamLeaderKey = normalizeText(row.teamLeader || "");
    const groupKey = `${officeKey}::${teamLeaderKey}`;
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        office: row.office || "",
        teamLeader: row.teamLeader || "",
        rows: [],
      });
    }
    groupMap.get(groupKey).rows.push(row);
  }

  const grouped = [...groupMap.values()].sort(
    (left, right) =>
      String(left.office || "").localeCompare(String(right.office || "")) ||
      String(left.teamLeader || "").localeCompare(String(right.teamLeader || "")),
  );

  const output = [];
  grouped.forEach((group, groupIndex) => {
    const teamLeaderRows = group.rows
      .filter((row) => row.level === "Team Leader")
      .sort((left, right) => scoreRow(right) - scoreRow(left) || String(left.agent || "").localeCompare(String(right.agent || "")));
    const agentRowsInGroup = group.rows
      .filter((row) => row.level !== "Team Leader")
      .sort((left, right) => scoreRow(right) - scoreRow(left) || String(left.agent || "").localeCompare(String(right.agent || "")));

    output.push(...teamLeaderRows, ...agentRowsInGroup);
    if (groupIndex < grouped.length - 1) {
      output.push({ __separator: true });
    }
  });
  return output;
}

function last4ExportActionsKeyboard(hasOfficeValues = true) {
  const rows = [];
  if (hasOfficeValues) {
    rows.push([{ text: "Specific Office Excel", callbackData: "last4:officeList:0" }]);
  }
  rows.push([{ text: "Send ALL Excel Again", callbackData: "export:last4all" }]);
  rows.push([{ text: "Change Month", callbackData: "menu:main" }]);
  return inlineKeyboard(rows);
}

function last4OfficeSelectionKeyboard(officeValues = [], page = 0) {
  const { chunk, start, totalPages, page: safePage } = paginateItems(officeValues, page, 12);
  const rows = chunkButtons(
    chunk.map((office, index) => ({
      text: office,
      callbackData: `last4:officePick:${start + index}`,
    })),
    2,
  );
  if (totalPages > 1) {
    rows.push([
      { text: "Previous Page", callbackData: `last4:officeList:${Math.max(safePage - 1, 0)}` },
      { text: "Next Page", callbackData: `last4:officeList:${Math.min(safePage + 1, totalPages - 1)}` },
    ]);
  }
  rows.push([{ text: "Back to Last 4 Export", callbackData: "last4:menu" }]);
  rows.push([{ text: "Change Month", callbackData: "menu:main" }]);
  return inlineKeyboard(rows);
}

async function buildLast4AllExportPayload({
  session,
  readRows,
  tabConfig,
  infoAgentsTabConfig,
  now = new Date(),
  officeFilter = "",
  scopeFilters = {},
}) {
  const month = selectedMonthRecord(session, now);
  if (!month) {
    return null;
  }
  const { rows, targetsMap, infoContext, monthInfoContextByKey = {}, months = [] } = await readReportData(
    readRows,
    tabConfig,
    infoAgentsTabConfig,
    month.sheet_id,
    {
      last3Mode: true,
      last3MonthKeys: session.last3MonthKeys || [],
      monthRecordsByKey: sessionMonthRecordsByKey(session),
      session,
      now,
      scopeFilters,
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
  const jobEntryByAgent = await readLast4JobEntryMap(readRows);
  const agentRows = buildLast4AllSheetRows({
    groupField: "agentNames",
    rows,
    tabConfig,
    targetsMap,
    infoContext,
    monthBreakdownMonths,
    monthContextByKey: monthInfoContextByKey,
    jobEntryByAgent,
    now,
  });
  const officeValues = [...new Set(agentRows.map((row) => String(row.office || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  const normalizedOfficeFilter = normalizeText(officeFilter);
  const filteredAgentRows = normalizedOfficeFilter
    ? agentRows.filter((row) => normalizeText(row.office) === normalizedOfficeFilter)
    : agentRows;
  const allRows = buildLast4AllCombinedRows([], [], filteredAgentRows);
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
        tailColumns: [{ key: "jobEntry", label: "İşe Giriş", width: 16 }],
        metricColumns: LAST4_ALL_METRIC_COLUMNS,
        rows: allRows,
      },
    ],
  });

  return {
    workbookBuffer,
    monthLabel: session.monthLabel || "Last 4 Months",
    officeValues,
    rowCount: allRows.filter((row) => !row.__separator).length,
  };
}

function createRootView(reportType, monthLabel, dateConfig, options = {}) {
  const root = REPORT_TYPES[reportType];
  const next = HIERARCHY_NEXT[reportType];
  const scopeFilters = options.scopeFilters || {};
  return {
    mode: "list",
    rootType: reportType,
    title: `${root.label} Results — ${monthLabel} (${dateConfig?.label || "Total Month"})`,
    groupField: root.fieldKey,
    baseFilters: withDateFilter(scopeFilters, dateConfig),
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

async function resolveOfficeScopeForStart(options = {}) {
  const authorityScope = options.authorityScope || {};
  const scopeFilters = authorityScope.filters || {};
  const authorityCountries = countriesFromAuthorityScope(scopeFilters);
  const isAllScope = Boolean(authorityScope.unrestricted) || isAdminTelegramUser(options.telegramUser);
  const officeMap = await getOfficeMonthMap();
  const mapCountries = Array.isArray(officeMap.countries) ? officeMap.countries : [];
  const byCountry = officeMap.byCountry || {};
  let countries = [];
  if (isAllScope) {
    countries = mapCountries.length ? mapCountries : authorityCountries;
  } else if (authorityCountries.length) {
    countries = authorityCountries;
  }
  const normalized = [...new Set(countries.map((country) => String(country || "").trim()).filter(Boolean))];
  return {
    isAllScope,
    countries: normalized,
    byCountry,
  };
}

export async function startMenu(userId, options = {}) {
  clearSession(userId);
  const officeScope = await resolveOfficeScopeForStart(options).catch(() => ({
    isAllScope: false,
    countries: [],
    byCountry: {},
  }));
  if (officeScope.countries.length > 1 || (officeScope.isAllScope && officeScope.countries.length >= 1)) {
    setSession(userId, {
      step: "select_office_scope",
      availableOfficeCountries: officeScope.countries,
      selectedOfficeCountry: "",
      officeMonthFiles: [],
    });
    return {
      text: OFFICE_SCOPE_TEXT,
      replyMarkup: officeScopeKeyboard(officeScope.countries),
    };
  }
  const selectedOfficeCountry = officeScope.countries[0] || "";
  const officeMonthFiles = selectedOfficeCountry ? officeScope.byCountry[selectedOfficeCountry] || [] : [];
  setSession(userId, {
    step: "select_month",
    selectedOfficeCountry,
    officeMonthFiles,
  });
  return {
    text: selectedOfficeCountry ? `Office country: ${selectedOfficeCountry}\n${MONTH_MENU_TEXT}` : MONTH_MENU_TEXT,
    replyMarkup: monthKeyboard(options.telegramUser, getSession(userId)),
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
  const counts = new Map();
  for (const row of filteredRows(rows, tabConfig, filters, now)) {
    const label = String(getRowValue(row, fieldName) || "").trim();
    if (label) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  const values = [...counts.keys()];
  if (COUNT_SORT_GROUP_FIELDS.has(fieldKey)) {
    return values.sort(
      (left, right) => (counts.get(right) || 0) - (counts.get(left) || 0) || left.localeCompare(right),
    );
  }
  return values.sort((left, right) => left.localeCompare(right));
}

export async function handleMenuCallback(userId, callbackData, options = {}) {
  const tabConfig = options.tabConfig || getTabConfig("leads");
  const infoAgentsTabConfig = options.infoAgentsTabConfig || getTabConfig("infoAgents");
  const readRows = options.readRows || readSheetRows;
  const now = options.now || new Date();
  const telegramUser = options.telegramUser;
  const scopedAuthorityFilters = authorityScopeFilters(options.authorityScope);

  if (callbackData === "menu:main") {
    return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
  }

  if (callbackData === "menu:filters") {
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
    }
    if (session.last3Mode) {
      const modeLabel = session.monthLabel || "Selected Months";
      const nextSession = {
        ...monthToSession(month, now),
        last3Mode: true,
        monthLabel: modeLabel,
        last3MonthKeys: session.last3MonthKeys || getLastFourMonthRecords(now, session).map((item) => item.key),
        dateFilter: null,
        dateFilterLabel: modeLabel,
        dateFilterKey: "last4",
        step: "select_report_type",
        view: null,
      };
      setSession(userId, nextSession);
      return openReportFiltersResponse(month, { label: modeLabel, filter: null }, telegramUser, nextSession);
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

  if (action === "officeScope") {
    const session = getSession(userId);
    const country = decodeURIComponent(String(value || ""));
    const available = Array.isArray(session.availableOfficeCountries) ? session.availableOfficeCountries : [];
    if (!country || !available.includes(country)) {
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
    }
    const officeMap = await getOfficeMonthMap();
    const officeMonthFiles = officeMap.byCountry?.[country] || [];
    setSession(userId, {
      step: "select_month",
      selectedOfficeCountry: country,
      officeMonthFiles,
      availableOfficeCountries: available,
    });
    return {
      text: `Office country: ${country}\n${MONTH_MENU_TEXT}`,
      replyMarkup: monthKeyboard(telegramUser, getSession(userId)),
    };
  }

  if (action === "month") {
    const session = getSession(userId);
    if (value === "multi") {
      setSession(userId, {
        step: "select_month_multi",
        monthMultiSelected: [],
      });
      return {
        text: monthMultiPrompt([], session),
        replyMarkup: monthMultiKeyboard([], session),
        editCurrentMessage: true,
      };
    }
    if (value === "last4") {
      const months = getLastFourMonthRecords(now, session);
      if (months.length === 0) {
        return {
          text: "No month files configured for last 3 months.",
          replyMarkup: monthKeyboard(telegramUser, session),
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
        step: "last4_export_ready",
        view: null,
      };
      setSession(userId, nextSession);
      const exportPayload = await buildLast4AllExportPayload({
        session: getSession(userId),
        readRows,
        tabConfig,
        infoAgentsTabConfig,
        now,
        scopeFilters: scopedAuthorityFilters,
      });
      if (!exportPayload) {
        return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
      }
      setSession(userId, {
        last4OfficeValues: exportPayload.officeValues,
        last4OfficePage: 0,
      });
      return {
        text: `Period: ${label}\nALL Excel sent.\nNeed a specific office export?`,
        replyMarkup: last4ExportActionsKeyboard(exportPayload.officeValues.length > 0),
        documentBuffer: exportPayload.workbookBuffer,
        documentFilename: `last4-all-${Date.now()}.xlsx`,
        documentCaption: `Last 4 Months ALL Export | ${label}`,
      };
    }

    const month = sessionMonthRecordByKey(session, value, { includeInactive: false });
    if (!month) {
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
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

  if (action === "monthMulti") {
    const session = getSession(userId);
    const currentSelection = Array.isArray(session.monthMultiSelected)
      ? [...new Set(session.monthMultiSelected)]
      : [];
    if (value === "toggle") {
      const key = extra;
      const month = sessionMonthRecordByKey(session, key, { includeInactive: false });
      if (!month) {
        return {
          text: "Month not found. Please select again.",
          replyMarkup: monthMultiKeyboard(currentSelection, session),
        };
      }
      const next = new Set(currentSelection);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      const nextSelection = [...next].sort((left, right) => right.localeCompare(left));
      setSession(userId, { monthMultiSelected: nextSelection, step: "select_month_multi" });
      return {
        text: monthMultiPrompt(nextSelection, session),
        replyMarkup: monthMultiKeyboard(nextSelection, session),
        editCurrentMessage: true,
      };
    }
    if (value === "all") {
      const all = sessionMonthRecords(session)
        .map((item) => item.key)
        .sort((left, right) => right.localeCompare(left));
      setSession(userId, { monthMultiSelected: all, step: "select_month_multi" });
      return {
        text: monthMultiPrompt(all, session),
        replyMarkup: monthMultiKeyboard(all, session),
        editCurrentMessage: true,
      };
    }
    if (value === "clear") {
      setSession(userId, { monthMultiSelected: [], step: "select_month_multi" });
      return {
        text: monthMultiPrompt([], session),
        replyMarkup: monthMultiKeyboard([], session),
        editCurrentMessage: true,
      };
    }
    if (value === "done") {
      if (!currentSelection.length) {
        return {
          text: "Please select at least one month.",
          replyMarkup: monthMultiKeyboard(currentSelection, session),
        };
      }
      const months = currentSelection
        .map((key) => sessionMonthRecordByKey(session, key, { includeInactive: false }))
        .filter(Boolean)
        .sort((left, right) => right.key.localeCompare(left.key));
      if (!months.length) {
        return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
      }
      const latest = months[0];
      const label = monthMultiLabel(months);
      const nextSession = {
        ...monthToSession(latest, now),
        last3Mode: true,
        monthLabel: label,
        last3MonthKeys: months.map((item) => item.key),
        dateFilter: null,
        dateFilterLabel: label,
        dateFilterKey: "multi",
        step: "select_report_type",
        view: null,
        monthMultiSelected: [],
      };
      setSession(userId, nextSession);
      const response = openReportFiltersResponse(latest, { label, filter: null }, telegramUser, nextSession);
      return {
        ...response,
        editCurrentMessage: true,
      };
    }
  }

  if (action === "date") {
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
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

  if (action === "last4") {
    const session = getSession(userId);
    if (!session.last3Mode) {
      return {
        text: "This action is available only in Last 4 Months mode.",
        replyMarkup: monthKeyboard(telegramUser, getSession(userId)),
      };
    }
    if (value === "menu") {
      const officeValues = session.last4OfficeValues || [];
      return {
        text: `Period: ${session.monthLabel || "Last 4 Months"}\nChoose export option:`,
        replyMarkup: last4ExportActionsKeyboard(officeValues.length > 0),
      };
    }
    if (value === "officeList") {
      const page = Number(extra) || 0;
      const officeValues = session.last4OfficeValues || [];
      if (!officeValues.length) {
        return {
          text: "No office data found for Last 4 Months export.",
          replyMarkup: last4ExportActionsKeyboard(false),
        };
      }
      setSession(userId, { last4OfficePage: page });
      return {
        text: "Select office for Last 4 Months Excel:",
        replyMarkup: last4OfficeSelectionKeyboard(officeValues, page),
        editCurrentMessage: true,
      };
    }
    if (value === "officePick") {
      const officeValues = session.last4OfficeValues || [];
      const pickedIndex = Number(extra);
      if (!Number.isFinite(pickedIndex) || !officeValues[pickedIndex]) {
        return {
          text: "Office selection expired. Please pick again.",
          replyMarkup: last4OfficeSelectionKeyboard(officeValues, session.last4OfficePage || 0),
        };
      }
      const office = officeValues[pickedIndex];
      const exportPayload = await buildLast4AllExportPayload({
        session,
        readRows,
        tabConfig,
        infoAgentsTabConfig,
        now,
        officeFilter: office,
        scopeFilters: scopedAuthorityFilters,
      });
      if (!exportPayload) {
        return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
      }
      const safeOffice = office.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      return {
        text: `Period: ${exportPayload.monthLabel}\nOffice: ${office}\nOffice Excel sent.`,
        replyMarkup: last4ExportActionsKeyboard(exportPayload.officeValues.length > 0),
        documentBuffer: exportPayload.workbookBuffer,
        documentFilename: `last4-${safeOffice || "office"}-${Date.now()}.xlsx`,
        documentCaption: `Last 4 Months Office Export | Office: ${office} | ${exportPayload.monthLabel}`,
      };
    }
  }

  if (action === "settings") {
    if (!isSettingsAdminTelegramUser(telegramUser)) {
      return {
        text: "Only @antoniotsd can access Settings.",
        replyMarkup: monthKeyboard(telegramUser, getSession(userId)),
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
        replyMarkup: monthKeyboard(telegramUser, getSession(userId)),
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
        replyMarkup: monthKeyboard(telegramUser, getSession(userId)),
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
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
    }
    const session = getSession(userId);
    if (session.last3Mode && !LAST4_REPORT_TYPES.has(value)) {
      const month = selectedMonthRecord(session, now);
      if (!month) {
        return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
      }
      return {
        text: `${session.monthLabel || "Selected Months"} mode supports only Office, Team Leader and Agent reports.`,
        replyMarkup: mainMenuKeyboard(telegramUser, { onlyCore: true }),
      };
    }
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return {
        text: "No month files configured. Ask @antoniotsd to add one in Settings.",
        replyMarkup: monthKeyboard(telegramUser, session),
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
        monthRecordsByKey: sessionMonthRecordsByKey(session),
        session,
        now,
        scopeFilters: scopedAuthorityFilters,
      },
    );
    const dateConfig = selectedDateConfig(session, month, now);
    const effectiveDateConfig = session.last3Mode
      ? { label: session.monthLabel || "Selected Months", filter: null, key: "last4" }
      : dateConfig;
    const displayMonthLabel = session.last3Mode ? session.monthLabel : month.month_label;
    const view = createRootView(value, displayMonthLabel, effectiveDateConfig, {
      metricsMode: session.last3Mode ? "last4" : "full",
      scopeFilters: scopedAuthorityFilters,
      monthBreakdownMonths: months.map((month) => ({
        key: month.key,
        month_label: month.month_label,
        shortLabel: String(month.month_label || "").split(" ")[0] || month.month_label,
      })),
      monthContextByKey: monthInfoContextByKey,
    });
    const rendered = renderListView(view, rows, tabConfig, targetsMap, infoContext, now);
    const autoMulti = renderedListResponseWithAutoMulti(rendered);
    const sessionView = autoMulti?.nextView || rendered.nextView;
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
      view: sessionView,
    });
    if (autoMulti) {
      return {
        text: autoMulti.text,
        replyMarkup: autoMulti.replyMarkup,
        editCurrentMessage: true,
      };
    }
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
        return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
      }
      return {
        text: `Specific Reports are disabled in ${session.monthLabel || "Selected Months"} mode. Use Office, Team Leader or Agent.`,
        replyMarkup: mainMenuKeyboard(telegramUser, { onlyCore: true }),
      };
    }
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
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
        specialBestAgent: null,
        specialBestCountry: null,
        specialBestCampaign: null,
        specialBestPlacement: null,
        hourlyScope: session.hourlyScope || null,
      });
      return {
        text: `Month: ${month.month_label}\nDate: ${dateConfig.label}\n${SPECIFIC_MENU_TEXT}`,
        replyMarkup: specificReportsKeyboard(),
      };
    }

    if (value === "bestOpen") {
      setSession(userId, {
        ...commonSession,
        step: "special_reports_menu",
        specialSelection: null,
      });
      return {
        text: `Best Performers — ${month.month_label} (${dateConfig.label})\nChoose drill entry point:`,
        replyMarkup: bestPerformersKeyboard(),
      };
    }

    const { rows } = await readReportData(readRows, tabConfig, infoAgentsTabConfig, month.sheet_id, {
      scopeFilters: scopedAuthorityFilters,
      now,
    });
    const dateFilters = withDateFilter(scopedAuthorityFilters, dateConfig);

    if (value === "bestAgents") {
      const values = bestSelectionValues(rows, tabConfig, dateFilters, "agentNames", now);
      setSession(userId, {
        ...commonSession,
        step: "special_reports_menu",
        specialSelection: {
          mode: "bestAgent",
          fieldKey: "agentNames",
          values,
          page: 0,
          backCallback: "special:bestOpen",
        },
      });
      return {
        text: "Select best agent to continue drill:",
        replyMarkup: listSelectionKeyboard({
          values,
          page: 0,
          pickPrefix: "specialPick",
          backCallback: "special:bestOpen",
        }),
      };
    }

    if (value === "bestCountries") {
      const values = bestSelectionValues(rows, tabConfig, dateFilters, "country", now);
      setSession(userId, {
        ...commonSession,
        step: "special_reports_menu",
        specialSelection: {
          mode: "bestCountry",
          fieldKey: "country",
          values,
          page: 0,
          backCallback: "special:bestOpen",
        },
      });
      return {
        text: "Select country to start best-performer drill:",
        replyMarkup: listSelectionKeyboard({
          values,
          page: 0,
          pickPrefix: "specialPick",
          backCallback: "special:bestOpen",
        }),
      };
    }

    if (value === "bestAgentCountryList") {
      const selectedAgent = session.specialBestAgent;
      if (!selectedAgent) {
        return {
          text: "Select an agent first from Best Agents.",
          replyMarkup: bestPerformersKeyboard(),
        };
      }
      const values = bestSelectionValues(
        rows,
        tabConfig,
        applyFieldFilter(dateFilters, "agentNames", selectedAgent),
        "country",
        now,
      );
      setSession(userId, {
        ...commonSession,
        specialSelection: {
          mode: "bestAgentCountry",
          fieldKey: "country",
          values,
          page: 0,
          backCallback: "special:bestAgents",
        },
      });
      return {
        text: `Select country where ${selectedAgent} performs best:`,
        replyMarkup: listSelectionKeyboard({
          values,
          page: 0,
          pickPrefix: "specialPick",
          backCallback: "special:bestAgents",
        }),
      };
    }

    if (value === "bestAgentCampaignList") {
      const selectedAgent = session.specialBestAgent;
      if (!selectedAgent) {
        return {
          text: "Select an agent first from Best Agents.",
          replyMarkup: bestPerformersKeyboard(),
        };
      }
      let filters = applyFieldFilter(dateFilters, "agentNames", selectedAgent);
      if (session.specialBestCountry) {
        filters = applyFieldFilter(filters, "country", session.specialBestCountry);
      }
      const values = bestSelectionValues(rows, tabConfig, filters, "campaign", now);
      setSession(userId, {
        ...commonSession,
        specialSelection: {
          mode: "bestAgentCampaign",
          fieldKey: "campaign",
          values,
          page: 0,
          backCallback: "special:bestAgentCountryList",
        },
      });
      return {
        text: `Select campaign for ${selectedAgent}${session.specialBestCountry ? ` in ${session.specialBestCountry}` : ""}:`,
        replyMarkup: listSelectionKeyboard({
          values,
          page: 0,
          pickPrefix: "specialPick",
          backCallback: "special:bestAgentCountryList",
        }),
      };
    }

    if (value === "bestAgentPlacementList") {
      const selectedAgent = session.specialBestAgent;
      if (!selectedAgent) {
        return {
          text: "Select an agent first from Best Agents.",
          replyMarkup: bestPerformersKeyboard(),
        };
      }
      let filters = applyFieldFilter(dateFilters, "agentNames", selectedAgent);
      if (session.specialBestCountry) {
        filters = applyFieldFilter(filters, "country", session.specialBestCountry);
      }
      if (session.specialBestCampaign) {
        filters = applyFieldFilter(filters, "campaign", session.specialBestCampaign);
      }
      const values = bestSelectionValues(rows, tabConfig, filters, "placement", now);
      setSession(userId, {
        ...commonSession,
        specialSelection: {
          mode: "bestAgentPlacement",
          fieldKey: "placement",
          values,
          page: 0,
          backCallback: "special:bestAgentCampaignList",
        },
      });
      return {
        text: `Select AFF (Placement) for ${selectedAgent}:`,
        replyMarkup: listSelectionKeyboard({
          values,
          page: 0,
          pickPrefix: "specialPick",
          backCallback: "special:bestAgentCampaignList",
        }),
      };
    }

    if (value === "bestCountryAgentList") {
      const selectedCountry = session.specialBestCountry;
      if (!selectedCountry) {
        return {
          text: "Select a country first from Best Countries.",
          replyMarkup: bestPerformersKeyboard(),
        };
      }
      const values = bestSelectionValues(
        rows,
        tabConfig,
        applyFieldFilter(dateFilters, "country", selectedCountry),
        "agentNames",
        now,
      );
      setSession(userId, {
        ...commonSession,
        specialSelection: {
          mode: "bestCountryAgent",
          fieldKey: "agentNames",
          values,
          page: 0,
          backCallback: "special:bestCountries",
        },
      });
      return {
        text: `Select best agent in ${selectedCountry}:`,
        replyMarkup: listSelectionKeyboard({
          values,
          page: 0,
          pickPrefix: "specialPick",
          backCallback: "special:bestCountries",
        }),
      };
    }

    if (value === "bestCountryCampaignList") {
      const selectedCountry = session.specialBestCountry;
      if (!selectedCountry) {
        return {
          text: "Select a country first from Best Countries.",
          replyMarkup: bestPerformersKeyboard(),
        };
      }
      const values = bestSelectionValues(
        rows,
        tabConfig,
        applyFieldFilter(dateFilters, "country", selectedCountry),
        "campaign",
        now,
      );
      setSession(userId, {
        ...commonSession,
        specialSelection: {
          mode: "bestCountryCampaign",
          fieldKey: "campaign",
          values,
          page: 0,
          backCallback: "special:bestCountries",
        },
      });
      return {
        text: `Select campaign in ${selectedCountry}:`,
        replyMarkup: listSelectionKeyboard({
          values,
          page: 0,
          pickPrefix: "specialPick",
          backCallback: "special:bestCountries",
        }),
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
      editCurrentMessage: true,
    };
  }

  if (action === "specialPick") {
    const index = Number(value);
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
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
    const { rows } = await readReportData(readRows, tabConfig, infoAgentsTabConfig, month.sheet_id, {
      scopeFilters: scopedAuthorityFilters,
      now,
    });
    const dateFilters = withDateFilter(scopedAuthorityFilters, dateConfig);

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

    if (selection.mode === "bestAgent") {
      const filters = applyFieldFilter(dateFilters, "agentNames", pickedValue);
      const summary = calculateSummary(rows, tabConfig, filters, now);
      const topCountries = rankedPerformanceItems(rows, tabConfig, filters, "country", now);
      const topCampaigns = rankedPerformanceItems(rows, tabConfig, filters, "campaign", now);
      setSession(userId, {
        specialBestAgent: pickedValue,
        specialBestCountry: null,
        specialBestCampaign: null,
        specialBestPlacement: null,
      });
      return {
        text: [
          `Best Agent Explorer — ${pickedValue} (${dateConfig.label})`,
          bestScopeSummaryLine(summary),
          "",
          ...bestRankingLines(`Top Countries for ${pickedValue}`, topCountries),
          "",
          ...bestRankingLines(`Top Campaigns for ${pickedValue}`, topCampaigns),
        ].join("\n"),
        replyMarkup: bestDetailKeyboard([
          [{ text: `Select Country for ${pickedValue}`, callbackData: "special:bestAgentCountryList" }],
          [{ text: `Select Campaign for ${pickedValue}`, callbackData: "special:bestAgentCampaignList" }],
          [{ text: "Back to Best Agents", callbackData: "special:bestAgents" }],
        ]),
      };
    }

    if (selection.mode === "bestCountry") {
      const filters = applyFieldFilter(dateFilters, "country", pickedValue);
      const summary = calculateSummary(rows, tabConfig, filters, now);
      const topAgents = rankedPerformanceItems(rows, tabConfig, filters, "agentNames", now);
      const topCampaigns = rankedPerformanceItems(rows, tabConfig, filters, "campaign", now);
      setSession(userId, {
        specialBestCountry: pickedValue,
        specialBestAgent: null,
        specialBestCampaign: null,
        specialBestPlacement: null,
      });
      return {
        text: [
          `Best Country Explorer — ${pickedValue} (${dateConfig.label})`,
          bestScopeSummaryLine(summary),
          "",
          ...bestRankingLines(`Top Agents in ${pickedValue}`, topAgents),
          "",
          ...bestRankingLines(`Top Campaigns in ${pickedValue}`, topCampaigns),
        ].join("\n"),
        replyMarkup: bestDetailKeyboard([
          [{ text: `Select Agent in ${pickedValue}`, callbackData: "special:bestCountryAgentList" }],
          [{ text: `Select Campaign in ${pickedValue}`, callbackData: "special:bestCountryCampaignList" }],
          [{ text: "Choose Another Country", callbackData: "special:bestCountries" }],
        ]),
      };
    }

    if (selection.mode === "bestAgentCountry") {
      let filters = applyFieldFilter(dateFilters, "agentNames", session.specialBestAgent || "");
      filters = applyFieldFilter(filters, "country", pickedValue);
      const summary = calculateSummary(rows, tabConfig, filters, now);
      const topCampaigns = rankedPerformanceItems(rows, tabConfig, filters, "campaign", now);
      const topPlacements = rankedPerformanceItems(rows, tabConfig, filters, "placement", now);
      setSession(userId, {
        specialBestCountry: pickedValue,
        specialBestCampaign: null,
        specialBestPlacement: null,
      });
      return {
        text: [
          `Agent Drill — ${session.specialBestAgent} / ${pickedValue} (${dateConfig.label})`,
          bestScopeSummaryLine(summary),
          "",
          ...bestRankingLines("Top Campaigns", topCampaigns),
          "",
          ...bestRankingLines("Top AFF (Placement)", topPlacements),
        ].join("\n"),
        replyMarkup: bestDetailKeyboard([
          [{ text: "Select Campaign", callbackData: "special:bestAgentCampaignList" }],
          [{ text: "Select AFF (Placement)", callbackData: "special:bestAgentPlacementList" }],
          [{ text: "Choose Another Country", callbackData: "special:bestAgentCountryList" }],
        ]),
      };
    }

    if (selection.mode === "bestAgentCampaign") {
      let filters = applyFieldFilter(dateFilters, "agentNames", session.specialBestAgent || "");
      if (session.specialBestCountry) {
        filters = applyFieldFilter(filters, "country", session.specialBestCountry);
      }
      filters = applyFieldFilter(filters, "campaign", pickedValue);
      const summary = calculateSummary(rows, tabConfig, filters, now);
      const topPlacements = rankedPerformanceItems(rows, tabConfig, filters, "placement", now);
      setSession(userId, {
        specialBestCampaign: pickedValue,
        specialBestPlacement: null,
      });
      const scopeLabel = [
        session.specialBestAgent || "",
        session.specialBestCountry || "",
        pickedValue,
      ]
        .filter(Boolean)
        .join(" / ");
      return {
        text: [
          `Campaign Drill — ${scopeLabel} (${dateConfig.label})`,
          bestScopeSummaryLine(summary),
          "",
          ...bestRankingLines("Top AFF (Placement)", topPlacements),
        ].join("\n"),
        replyMarkup: bestDetailKeyboard([
          [{ text: "Select AFF (Placement)", callbackData: "special:bestAgentPlacementList" }],
          [{ text: "Choose Another Campaign", callbackData: "special:bestAgentCampaignList" }],
        ]),
      };
    }

    if (selection.mode === "bestAgentPlacement") {
      let filters = applyFieldFilter(dateFilters, "agentNames", session.specialBestAgent || "");
      if (session.specialBestCountry) {
        filters = applyFieldFilter(filters, "country", session.specialBestCountry);
      }
      if (session.specialBestCampaign) {
        filters = applyFieldFilter(filters, "campaign", session.specialBestCampaign);
      }
      filters = applyFieldFilter(filters, "placement", pickedValue);
      const summary = calculateSummary(rows, tabConfig, filters, now);
      const topSubCampaigns = rankedPerformanceItems(rows, tabConfig, filters, "subCampaign", now);
      setSession(userId, {
        specialBestPlacement: pickedValue,
      });
      const scopeLabel = [
        session.specialBestAgent || "",
        session.specialBestCountry || "",
        session.specialBestCampaign || "",
        pickedValue,
      ]
        .filter(Boolean)
        .join(" / ");
      return {
        text: [
          `AFF Drill — ${scopeLabel} (${dateConfig.label})`,
          bestScopeSummaryLine(summary),
          "",
          ...bestRankingLines("Top Sub-Campaigns", topSubCampaigns),
        ].join("\n"),
        replyMarkup: bestDetailKeyboard([
          [{ text: "Choose Another AFF (Placement)", callbackData: "special:bestAgentPlacementList" }],
          [{ text: "Back to Campaign Selection", callbackData: "special:bestAgentCampaignList" }],
        ]),
      };
    }

    if (selection.mode === "bestCountryAgent") {
      let filters = applyFieldFilter(dateFilters, "country", session.specialBestCountry || "");
      filters = applyFieldFilter(filters, "agentNames", pickedValue);
      const summary = calculateSummary(rows, tabConfig, filters, now);
      const topCampaigns = rankedPerformanceItems(rows, tabConfig, filters, "campaign", now);
      const topPlacements = rankedPerformanceItems(rows, tabConfig, filters, "placement", now);
      setSession(userId, {
        specialBestAgent: pickedValue,
        specialBestCampaign: null,
        specialBestPlacement: null,
      });
      return {
        text: [
          `Country > Agent Drill — ${session.specialBestCountry} / ${pickedValue} (${dateConfig.label})`,
          bestScopeSummaryLine(summary),
          "",
          ...bestRankingLines("Top Campaigns", topCampaigns),
          "",
          ...bestRankingLines("Top AFF (Placement)", topPlacements),
        ].join("\n"),
        replyMarkup: bestDetailKeyboard([
          [{ text: "Select Campaign for Agent", callbackData: "special:bestAgentCampaignList" }],
          [{ text: "Choose Another Agent", callbackData: "special:bestCountryAgentList" }],
          [{ text: "Back to Country List", callbackData: "special:bestCountries" }],
        ]),
      };
    }

    if (selection.mode === "bestCountryCampaign") {
      let filters = applyFieldFilter(dateFilters, "country", session.specialBestCountry || "");
      filters = applyFieldFilter(filters, "campaign", pickedValue);
      const summary = calculateSummary(rows, tabConfig, filters, now);
      const topAgents = rankedPerformanceItems(rows, tabConfig, filters, "agentNames", now);
      const topPlacements = rankedPerformanceItems(rows, tabConfig, filters, "placement", now);
      setSession(userId, {
        specialBestCampaign: pickedValue,
      });
      return {
        text: [
          `Country > Campaign Drill — ${session.specialBestCountry} / ${pickedValue} (${dateConfig.label})`,
          bestScopeSummaryLine(summary),
          "",
          ...bestRankingLines("Top Agents in Campaign", topAgents),
          "",
          ...bestRankingLines("Top AFF (Placement)", topPlacements),
        ].join("\n"),
        replyMarkup: bestDetailKeyboard([
          [{ text: "Choose Another Campaign", callbackData: "special:bestCountryCampaignList" }],
          [{ text: "Select Agent in Country", callbackData: "special:bestCountryAgentList" }],
          [{ text: "Back to Country List", callbackData: "special:bestCountries" }],
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
    const exportPayload = await buildLast4AllExportPayload({
      session,
      readRows,
      tabConfig,
      infoAgentsTabConfig,
      now,
      scopeFilters: scopedAuthorityFilters,
    });
    if (!exportPayload) {
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
    }
    setSession(userId, {
      last4OfficeValues: exportPayload.officeValues,
      last4OfficePage: 0,
    });
    return {
      text: `Period: ${exportPayload.monthLabel}\nAll Excel export sent.\nNeed a specific office export?`,
      replyMarkup: last4ExportActionsKeyboard(exportPayload.officeValues.length > 0),
      documentBuffer: exportPayload.workbookBuffer,
      documentFilename: `last4-all-${Date.now()}.xlsx`,
      documentCaption: `Last 4 Months ALL Export | ${exportPayload.monthLabel}`,
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
        monthRecordsByKey: sessionMonthRecordsByKey(session),
        session,
        now,
        scopeFilters: scopedAuthorityFilters,
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
      context: {
        groupField: session.view.groupField,
        filters: currentFilterSetForView(session.view),
        parentFields: exportParentFieldsForView(session.view),
      },
    });
    setSession(userId, { view: rendered.nextView });
    return {
      text: "Excel export sent.",
      suppressTextResponse: true,
      replyMarkup: rendered.replyMarkup,
      documentBuffer: workbookBuffer,
      documentFilename: exportFileNameForView(session.view, session, now),
      documentCaption: exportCaptionForView(session.view, session),
    };
  }

  if (action === "drill") {
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
    }
    const { rows, targetsMap, infoContext } = await readReportData(
      readRows,
      tabConfig,
      infoAgentsTabConfig,
      month.sheet_id,
      {
        last3Mode: Boolean(session.last3Mode),
        last3MonthKeys: session.last3MonthKeys || [],
        monthRecordsByKey: sessionMonthRecordsByKey(session),
        session,
        now,
        scopeFilters: scopedAuthorityFilters,
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

    if (value === "multiStart" && view.mode === "list" && MULTI_SELECT_GROUP_FIELDS.has(view.groupField)) {
      const rendered = renderListView(view, rows, tabConfig, targetsMap, infoContext, now);
      const nextView = enableMultiSelectView(rendered.nextView, rendered.items || []);
      if (!(nextView.multiSelect?.values || []).length) {
        setSession(userId, { view: rendered.nextView });
        return { text: rendered.text, replyMarkup: rendered.replyMarkup };
      }
      setSession(userId, { view: nextView });
      return {
        text: multiSelectPrompt(nextView),
        replyMarkup: buildMultiSelectKeyboard(nextView),
        editCurrentMessage: true,
      };
    }

    if (value === "multiPage" && view.multiSelect) {
      const nextView = {
        ...view,
        multiSelect: {
          ...view.multiSelect,
          page: Number(extra) || 0,
        },
      };
      setSession(userId, { view: nextView });
      return {
        text: multiSelectPrompt(nextView),
        replyMarkup: buildMultiSelectKeyboard(nextView),
        editCurrentMessage: true,
      };
    }

    if (value === "multiToggle" && view.multiSelect) {
      const values = view.multiSelect.values || [];
      const index = Number(extra);
      if (!Number.isFinite(index) || !values[index]) {
        return { text: multiSelectPrompt(view), replyMarkup: buildMultiSelectKeyboard(view) };
      }
      const selected = new Set(view.multiSelect.selected || []);
      const label = values[index];
      if (selected.has(label)) {
        selected.delete(label);
      } else {
        selected.add(label);
      }
      const nextView = {
        ...view,
        multiSelect: {
          ...view.multiSelect,
          selected: [...selected],
        },
      };
      setSession(userId, { view: nextView });
      return {
        text: multiSelectPrompt(nextView),
        replyMarkup: buildMultiSelectKeyboard(nextView),
        editCurrentMessage: true,
      };
    }

    if (value === "multiAll" && view.multiSelect) {
      const nextView = {
        ...view,
        multiSelect: {
          ...view.multiSelect,
          selected: [...(view.multiSelect.values || [])],
          page: 0,
        },
      };
      setSession(userId, { view: nextView });
      return {
        text: multiSelectPrompt(nextView),
        replyMarkup: buildMultiSelectKeyboard(nextView),
        editCurrentMessage: true,
      };
    }

    if (value === "multiClear" && view.multiSelect) {
      const nextView = {
        ...view,
        multiSelect: {
          ...view.multiSelect,
          selected: [],
        },
      };
      setSession(userId, { view: nextView });
      return {
        text: multiSelectPrompt(nextView),
        replyMarkup: buildMultiSelectKeyboard(nextView),
        editCurrentMessage: true,
      };
    }

    if (value === "multiCancel" && view.multiSelect) {
      const nextView = { ...view };
      delete nextView.multiSelect;
      const rendered = renderListView(nextView, rows, tabConfig, targetsMap, infoContext, now);
      setSession(userId, { view: rendered.nextView });
      return { text: rendered.text, replyMarkup: rendered.replyMarkup, editCurrentMessage: true };
    }

    if (value === "multiDone" && view.multiSelect) {
      const selected = [...new Set((view.multiSelect.selected || []).filter(Boolean))];
      if (!selected.length) {
        return { text: "Please select at least one item.", replyMarkup: buildMultiSelectKeyboard(view) };
      }
      const nextFilters = applyFieldFilter(view.baseFilters, view.groupField, selected);
      if (view.groupField === "office" && view.nextMode?.mode === "list" && view.nextMode.fieldKey === "teamLeader") {
        const previousView = { ...view };
        delete previousView.multiSelect;
        const nextView = createListView({
          rootType: view.rootType,
          title: `Team Leaders in selected Offices (${selected.length})`,
          groupField: view.nextMode.fieldKey,
          baseFilters: nextFilters,
          backStack: [...(view.backStack || []), previousView],
          nextMode: { mode: "detail", fieldKey: "teamLeader", label: "Team Leader" },
          metricsMode: view.metricsMode,
          monthBreakdownMonths: view.monthBreakdownMonths || [],
          monthContextByKey: view.monthContextByKey || {},
        });
        const rendered = renderListView(nextView, rows, tabConfig, targetsMap, infoContext, now);
        const autoMulti = renderedListResponseWithAutoMulti(rendered);
        setSession(userId, { view: autoMulti?.nextView || rendered.nextView });
        if (autoMulti) {
          return {
            text: autoMulti.text,
            replyMarkup: autoMulti.replyMarkup,
            editCurrentMessage: true,
          };
        }
        return { text: rendered.text, replyMarkup: rendered.replyMarkup, editCurrentMessage: true };
      }
      const filteredView = {
        ...view,
        baseFilters: nextFilters,
        page: 0,
        disableAutoMulti: true,
      };
      delete filteredView.multiSelect;
      const rendered = renderListView(filteredView, rows, tabConfig, targetsMap, infoContext, now);
      setSession(userId, { view: rendered.nextView });
      return { text: rendered.text, replyMarkup: rendered.replyMarkup, editCurrentMessage: true };
    }

    if (value === "page") {
      view = { ...view, page: Number(extra) || 0 };
      const rendered = renderListView(view, rows, tabConfig, targetsMap, infoContext, now);
      const autoMulti = renderedListResponseWithAutoMulti(rendered);
      setSession(userId, { view: autoMulti?.nextView || rendered.nextView });
      if (autoMulti) {
        return {
          text: autoMulti.text,
          replyMarkup: autoMulti.replyMarkup,
          editCurrentMessage: true,
        };
      }
      return { text: rendered.text, replyMarkup: rendered.replyMarkup, editCurrentMessage: true };
    }

    if (value === "next" && view.mode === "detail") {
      const fieldKey = extra;
      const allowedNext = DETAIL_NEXT_FIELDS[view.groupField] || [];
      if (!fieldKey || !allowedNext.includes(fieldKey)) {
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
      const autoMulti = renderedListResponseWithAutoMulti(rendered);
      setSession(userId, { view: autoMulti?.nextView || rendered.nextView });
      if (autoMulti) {
        return {
          text: autoMulti.text,
          replyMarkup: autoMulti.replyMarkup,
          editCurrentMessage: true,
        };
      }
      return { text: rendered.text, replyMarkup: rendered.replyMarkup };
    }

    if (value === "listNext" && view.mode === "list") {
      const fieldKey = extra;
      const allowedNext = DETAIL_NEXT_FIELDS[view.groupField] || [];
      if (!fieldKey || !allowedNext.includes(fieldKey)) {
        return { text: "No deeper breakdown available.", replyMarkup: buildListKeyboard(view, [], 0, view.page || 0, 1) };
      }
      const renderedCurrent = renderListView(view, rows, tabConfig, targetsMap, infoContext, now);
      const selectedCurrentLevel = selectedFilterValues(
        currentFilterSetForView(view),
        fieldToFilterKey(view.groupField),
      );
      const selectedSuffix =
        selectedCurrentLevel.length > 1
          ? `selected ${metricLabelForField(view.groupField)}s (${selectedCurrentLevel.length})`
          : metricLabelForField(view.groupField);
      const nextView = createListView({
        rootType: view.rootType,
        title: `${metricLabelForField(fieldKey)} in ${selectedSuffix}`,
        groupField: fieldKey,
        baseFilters: view.baseFilters,
        backStack: [...(view.backStack || []), renderedCurrent.nextView],
        nextMode: { mode: "detail", fieldKey, label: metricLabelForField(fieldKey) },
        metricsMode: view.metricsMode,
        monthBreakdownMonths: view.monthBreakdownMonths || [],
        monthContextByKey: view.monthContextByKey || {},
      });
      const rendered = renderListView(nextView, rows, tabConfig, targetsMap, infoContext, now);
      const autoMulti = renderedListResponseWithAutoMulti(rendered);
      setSession(userId, { view: autoMulti?.nextView || rendered.nextView });
      if (autoMulti) {
        return {
          text: autoMulti.text,
          replyMarkup: autoMulti.replyMarkup,
          editCurrentMessage: true,
        };
      }
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
        const autoMulti = renderedListResponseWithAutoMulti(list);
        setSession(userId, { view: autoMulti?.nextView || list.nextView });
        if (autoMulti) {
          return {
            text: autoMulti.text,
            replyMarkup: autoMulti.replyMarkup,
            editCurrentMessage: true,
          };
        }
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
        const autoMulti = renderedListResponseWithAutoMulti(list);
        setSession(userId, { view: autoMulti?.nextView || list.nextView });
        if (autoMulti) {
          return {
            text: autoMulti.text,
            replyMarkup: autoMulti.replyMarkup,
            editCurrentMessage: true,
          };
        }
        return { text: list.text, replyMarkup: list.replyMarkup };
      }
    }
  }

  return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
}

export async function handleMenuText(userId, text, options = {}) {
  const session = getSession(userId);
  const telegramUser = options.telegramUser;
  if (session.step === "settings_wait_month_file") {
    if (!isSettingsAdminTelegramUser(telegramUser)) {
      return {
        text: "Only @antoniotsd can update month mappings.",
        replyMarkup: monthKeyboard(telegramUser, session),
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
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
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
    return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
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
