import { getTabConfig } from "../config/sheetsConfig.js";
import {
  calculateSummary,
  filterRowsByPermission,
  filteredRows,
  getFieldName,
  getRowValue,
  groupPerformance,
  hourlyDistribution,
  normalizeText,
  parseDateValue,
  uniqueValues,
} from "./calculations.js";
import { resolveAuthorityScopeForUser } from "./authorityScope.js";
import { readSheetRows } from "./googleSheets.js";
import { getOfficeMonthMap } from "./officeMappings.js";
import { currentMonthKey, getMonthFile, listMonthFiles, monthFilterFromKey } from "./monthlyReports.js";
import { isAdminTelegramUser, isAllowedTelegramUser } from "./permissions.js";
import { buildInfoAgentsContext, normalizeAgentName, targetAggregationForScope, targetReachPercent } from "./targets.js";

const DASHBOARD_GROUP_FIELD_MAP = {
  desk: "office",
  office: "office",
  country: "country",
  brand: "brand",
  campaign: "campaign",
  subCampaign: "subCampaign",
  placement: "placement",
  teamLeader: "teamLeader",
  agent: "agentNames",
};

const FILTER_TO_FIELD = {
  desk: "office",
  country: "country",
  brand: "brand",
  campaign: "campaign",
  subCampaign: "subCampaign",
  placement: "placement",
  status: "status",
  teamLeader: "teamLeader",
  agent: "agentNames",
};

const SPECIFIC_DIMENSIONS = [
  { key: "date", label: "Date", type: "date" },
  { key: "hour", label: "Hour", type: "hour" },
  { key: "desk", label: "Desk", type: "text", fieldKey: "office" },
  { key: "teamLeader", label: "Team Leader", type: "text", fieldKey: "teamLeader" },
  { key: "agent", label: "Agent", type: "text", fieldKey: "agentNames" },
  { key: "status", label: "Working Status", type: "text", fieldKey: "status" },
  { key: "country", label: "Country", type: "text", fieldKey: "country" },
  { key: "brand", label: "Brand", type: "text", fieldKey: "brand" },
  { key: "campaign", label: "Campaign", type: "text", fieldKey: "campaign" },
  { key: "subCampaign", label: "Sub Campaign", type: "text", fieldKey: "subCampaign" },
  { key: "placement", label: "Placement", type: "text", fieldKey: "placement" },
];

const SPECIFIC_METRICS = [
  { key: "leads", label: "Leads", type: "number" },
  { key: "leadShare", label: "Lead Share", type: "percent" },
  { key: "agentCount", label: "Number of Agents", type: "number" },
  { key: "avgLeadByAgent", label: "Avg Lead by Agent", type: "number" },
  { key: "avgLeadByAgentDaily", label: "Avg Lead by Agent Daily", type: "number" },
  { key: "ftd", label: "FTD", type: "number" },
  { key: "avgFtdByAgent", label: "Desk Avg FTD per Agent", type: "number" },
  { key: "avgFtdByAgentDaily", label: "Desk Avg FTD per Agent Daily", type: "number" },
  { key: "agentAvgFtdPerWorkedMonth", label: "Agent Avg FTD per Worked Month", type: "number" },
  { key: "avgFtdByDeskLongTerm", label: "Desk Avg FTD per Desk By Long Term", type: "number" },
  { key: "ftdBenchmarkRate", label: "Benchmark Rate", type: "percent" },
  { key: "ftdTarget", label: "FTD Target", type: "number" },
  { key: "ftdTargetReach", label: "FTD Target Reach", type: "percent" },
  { key: "cr", label: "CR", type: "percent" },
  { key: "crTarget", label: "CR Target", type: "percent" },
  { key: "crTargetReach", label: "CR Target Reach", type: "percent" },
  { key: "selfs", label: "Selfs", type: "number" },
  { key: "lateFtd", label: "Late FTD", type: "number" },
  { key: "ftdTargetByCr", label: "FTD Target by CR", type: "number" },
  { key: "missingFtd", label: "Missing FTD", type: "number" },
];

const SPECIFIC_DIMENSION_BY_KEY = new Map(SPECIFIC_DIMENSIONS.map((item) => [item.key, item]));
const SPECIFIC_METRIC_BY_KEY = new Map(SPECIFIC_METRICS.map((item) => [item.key, item]));
const OFFICE_AGENT_ROSTER_SPREADSHEET_ID = "1Zd3jiQH7PsRope1qo_-bfeYkcCEbUR9pppPcAGy9hgk";
const OFFICE_AGENT_ROSTER_COLUMNS = ["Agent", "Working Status", "Desk", "Team Leader", "Starting Date"];
const EXCLUDED_AGENT_PREFIXES = ["trself"];

function buildPermissionFilters(authorityScope, telegramUser) {
  if (!authorityScope || authorityScope.unrestricted || isAdminTelegramUser(telegramUser)) {
    return {};
  }
  return authorityScope.filters || {};
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const normalized = String(value || "").trim();
  return normalized ? [normalized] : [];
}

function isExcludedNormalizedAgent(normalizedAgent = "") {
  const normalized = String(normalizedAgent || "").trim();
  if (!normalized) {
    return false;
  }
  return EXCLUDED_AGENT_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `));
}

function filterExcludedAgentRows(rows = [], tabConfig) {
  const agentField = getFieldName(tabConfig, "agentNames");
  return rows.filter((row) => {
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    return !isExcludedNormalizedAgent(normalizedAgent);
  });
}

function allowByRole(telegramUser, authorityScope) {
  return isAllowedTelegramUser(telegramUser) || Boolean(authorityScope?.allowed);
}

function collectOfficeScopedMonthRecords(officeMap, officeScope = "") {
  if (!officeScope) {
    return [];
  }
  if (Array.isArray(officeMap?.byOffice?.[officeScope])) {
    return officeMap.byOffice[officeScope];
  }
  const normalizedScope = normalizeText(officeScope);
  const matchedOffice = Object.keys(officeMap?.byOffice || {}).find((name) => normalizeText(name) === normalizedScope);
  return matchedOffice ? officeMap.byOffice[matchedOffice] : [];
}

function mergedMonthRecords(officeMap) {
  const byKey = new Map();
  for (const record of listMonthFiles({ includeInactive: false })) {
    byKey.set(String(record.key), record);
  }
  for (const records of Object.values(officeMap?.byOffice || {})) {
    for (const record of records || []) {
      const key = String(record?.key || "");
      if (!key || byKey.has(key)) {
        continue;
      }
      byKey.set(key, {
        ...record,
        active: record.active !== false,
      });
    }
  }
  return [...byKey.values()]
    .filter((record) => record.active !== false)
    .sort((left, right) => String(right.key || "").localeCompare(String(left.key || "")));
}

function resolveMonthRecord(monthKey, officeScope, officeMap, now = new Date()) {
  const scopedRecords = collectOfficeScopedMonthRecords(officeMap, officeScope);
  if (monthKey) {
    const normalizedMonthKey = String(monthKey || "").trim();
    const scopedMatch = scopedRecords.find((record) => String(record.key || "") === normalizedMonthKey);
    if (scopedMatch) {
      return scopedMatch;
    }
    return getMonthFile(normalizedMonthKey, { includeInactive: false });
  }
  if (scopedRecords.length) {
    return [...scopedRecords].sort((left, right) => String(right.key || "").localeCompare(String(left.key || "")))[0] || null;
  }
  return getMonthFile(currentMonthKey(now), { includeInactive: false }) || listMonthFiles({ includeInactive: false })[0] || null;
}

function normalizeOfficeScopeOptions(officeMap = {}, permissionFilters = {}) {
  const allOffices = Array.isArray(officeMap?.offices) ? officeMap.offices : [];
  const allowedOffices = normalizeStringList(permissionFilters.office).map(normalizeText);
  if (!allowedOffices.length) {
    return allOffices.sort((left, right) => left.localeCompare(right));
  }
  const allowedSet = new Set(allowedOffices);
  return allOffices
    .filter((office) => allowedSet.has(normalizeText(office)))
    .sort((left, right) => left.localeCompare(right));
}

function mapRowsWithScope(rows = [], officeScope = "") {
  const scopeName = String(officeScope || "").trim();
  return rows.map((row) => ({
    ...row,
    __scopeOfficeName: scopeName || String(row.__scopeOfficeName || "").trim(),
  }));
}

function mapRowsWithMonthSource(rows = [], monthRecord = {}) {
  const monthKey = String(monthRecord?.key || "").trim();
  const monthLabel = String(monthRecord?.month_label || "").trim();
  return rows.map((row) => ({
    ...row,
    __sourceMonthKey: monthKey || String(row.__sourceMonthKey || "").trim(),
    __sourceMonthLabel: monthLabel || String(row.__sourceMonthLabel || "").trim(),
  }));
}

function rosterTabNameForOffice(officeScope = "") {
  const normalized = normalizeText(officeScope);
  if (!normalized) {
    return "";
  }
  if (normalized.includes("turkey") || normalized.includes("turkiye")) {
    return "Turkiye";
  }
  if (normalized.includes("argentina")) {
    return "Argentina";
  }
  if (normalized.includes("pakistan")) {
    return "Pakistan";
  }
  if (normalized.includes("dubai") || normalized.includes("uae") || normalized.includes("united arab emirates")) {
    return "Dubai";
  }
  return "";
}

function officeAgentRosterTabConfig(tabName = "") {
  const safeTabName = String(tabName || "").trim();
  return {
    key: "officeAgentRoster",
    name: safeTabName,
    range: `'${safeTabName.replace(/'/g, "''")}'!A:E`,
    columns: OFFICE_AGENT_ROSTER_COLUMNS,
    fields: {
      workingStatus: "Working Status",
      agentName: "Agent",
      office: "Desk",
      teamLeader: "Team Leader",
    },
  };
}

async function readOfficeAgentRosterRows(officeScope = "") {
  const tabName = rosterTabNameForOffice(officeScope);
  if (!tabName) {
    return [];
  }
  try {
    const rows = await readSheetRows("officeAgentRoster", {
      tabConfig: officeAgentRosterTabConfig(tabName),
      spreadsheetId: OFFICE_AGENT_ROSTER_SPREADSHEET_ID,
    });
    return mapRowsWithScope(rows, officeScope);
  } catch {
    return [];
  }
}

function rosterWorkingStatusValue(value = "") {
  return normalizeWorkingStatusValue(value) === "working" ? "Working" : "Not Working";
}

function filterOfficeAgentRosterRowsByPermission(rows = [], permissionFilters = {}) {
  const allowedDesks = normalizeStringList(permissionFilters.office || permissionFilters.desk).map((item) => normalizeText(item));
  const allowedTeamLeaders = normalizeStringList(permissionFilters.teamLeader).map((item) => normalizeText(item));
  const allowedAgents = normalizeStringList(permissionFilters.agent).map((item) => normalizeAgentName(item));
  return rows.filter((row) => {
    const normalizedDesk = normalizeText(row?.Desk || row?.Office || "");
    const normalizedTeamLeader = normalizeText(row?.["Team Leader"] || "");
    const normalizedAgent = normalizeAgentName(row?.Agent || row?.["Agent Name"] || "");
    if (allowedDesks.length && !allowedDesks.includes(normalizedDesk)) {
      return false;
    }
    if (allowedTeamLeaders.length && !allowedTeamLeaders.includes(normalizedTeamLeader)) {
      return false;
    }
    if (allowedAgents.length && !allowedAgents.includes(normalizedAgent)) {
      return false;
    }
    return true;
  });
}

function mergedInfoRowsFromRoster(rosterRows = [], targetByAgent = new Map()) {
  const rows = [];
  for (const row of rosterRows) {
    const agentName = String(row?.Agent || row?.["Agent Name"] || "").trim();
    if (!agentName) {
      continue;
    }
    const normalizedAgent = normalizeAgentName(agentName);
    if (isExcludedNormalizedAgent(normalizedAgent)) {
      continue;
    }
    rows.push({
      "Working Status": rosterWorkingStatusValue(row?.["Working Status"] || row?.Status || ""),
      "Agent Name": agentName,
      "Agent Target": targetByAgent.get(normalizedAgent) || 0,
      Office: String(row?.Desk || row?.Office || "").trim(),
      "Team Leader": String(row?.["Team Leader"] || "").trim(),
      "Starting Date": String(row?.["Starting Date"] || row?.["Start Date"] || "").trim(),
    });
  }
  return rows;
}

function normalizeWorkingStatusValue(value = "") {
  const normalized = normalizeText(value);
  if (normalized === "working" || normalized === "active") {
    return "working";
  }
  if (
    !normalized ||
    normalized === "not working" ||
    normalized === "not_working" ||
    normalized === "not active" ||
    normalized === "inactive" ||
    normalized === "left"
  ) {
    return "not_working";
  }
  return "";
}

function isSpreadsheetErrorValue(value = "") {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("#n/a") ||
    normalized.startsWith("#value!") ||
    normalized.startsWith("#ref!") ||
    normalized.includes("vlookup") ||
    normalized.includes("did not find value")
  );
}

function cleanSpreadsheetText(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return isSpreadsheetErrorValue(raw) ? "" : raw;
}

function collectStatusByAgent(infoRows = [], tabConfig, allowedAgents = new Set()) {
  const map = new Map();
  const agentField = getFieldName(tabConfig, "agentName");
  const statusField = getFieldName(tabConfig, "workingStatus");
  for (const row of infoRows) {
    const normalizedAgent = normalizeAgentName(
      getRowValue(row, agentField) ||
        getRowValue(row, "Agent") ||
        getRowValue(row, "Agent Name") ||
        getRowValue(row, "AGENT NAMES"),
    );
    if (!normalizedAgent) {
      continue;
    }
    if (allowedAgents.size && !allowedAgents.has(normalizedAgent)) {
      continue;
    }
    const status = normalizeWorkingStatusValue(getRowValue(row, statusField) || getRowValue(row, "Working Status"));
    if (!status) {
      continue;
    }
    map.set(normalizedAgent, status);
  }
  return map;
}

function collectStatusByAgentFromRows(rows = [], tabConfig, allowedAgents = new Set()) {
  const map = new Map();
  const agentField = getFieldName(tabConfig, "agentNames");
  const statusField = getFieldName(tabConfig, "status");
  const brandField = getFieldName(tabConfig, "brand");
  for (const row of rows) {
    const normalizedAgent = normalizeAgentName(
      getRowValue(row, agentField) ||
        getRowValue(row, "Agent") ||
        getRowValue(row, "Agent Name") ||
        getRowValue(row, "AGENT NAMES"),
    );
    if (!normalizedAgent) {
      continue;
    }
    if (allowedAgents.size && !allowedAgents.has(normalizedAgent)) {
      continue;
    }
    const rawCandidates = [
      getRowValue(row, "Working Status"),
      getRowValue(row, "Status"),
      getRowValue(row, statusField),
      getRowValue(row, brandField),
      getRowValue(row, "Brand"),
      row?.A,
    ];
    let status = "";
    for (const candidate of rawCandidates) {
      const normalizedStatus = normalizeWorkingStatusValue(candidate);
      if (normalizedStatus) {
        status = normalizedStatus;
        break;
      }
    }
    if (!status) {
      const hasWorkingStatusColumn = Object.keys(row || {}).some(
        (key) => normalizeText(key) === "working status",
      );
      if (!hasWorkingStatusColumn) {
        continue;
      }
      // In rows that explicitly provide "Working Status", blank values are not working.
      status = "not_working";
    }
    const existing = map.get(normalizedAgent);
    if (existing === "working") {
      continue;
    }
    if (status === "working") {
      map.set(normalizedAgent, "working");
    } else if (!existing) {
      map.set(normalizedAgent, "not_working");
    }
  }
  return map;
}

function normalizedStartDateValue(value) {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return "";
  }
  const year = parsed.getUTCFullYear();
  if (year < 1990 || year > 2100) {
    return "";
  }
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${year}`;
}

function preferEarlierDateString(current = "", next = "") {
  const currentValue = String(current || "").trim();
  const nextValue = String(next || "").trim();
  if (!currentValue) {
    return nextValue;
  }
  if (!nextValue) {
    return currentValue;
  }
  const currentDate = parseDateValue(currentValue);
  const nextDate = parseDateValue(nextValue);
  if (!currentDate || !nextDate) {
    return currentValue || nextValue;
  }
  return nextDate.getTime() < currentDate.getTime() ? nextValue : currentValue;
}

function collectAgentStartDateMap(infoRows = [], tabConfig, allowedAgents = new Set()) {
  const map = new Map();
  const agentField = getFieldName(tabConfig, "agentName");
  for (const row of infoRows) {
    const normalizedAgent = normalizeAgentName(
      getRowValue(row, agentField) ||
        getRowValue(row, "Agent") ||
        getRowValue(row, "Agent Name") ||
        getRowValue(row, "AGENT NAMES"),
    );
    if (!normalizedAgent) {
      continue;
    }
    if (allowedAgents.size && !allowedAgents.has(normalizedAgent)) {
      continue;
    }
    const explicitStartDate = [
      getRowValue(row, "Starting Date"),
      getRowValue(row, "Start Date"),
      getRowValue(row, "Job Entry"),
      row?.L,
      row?.AP,
    ]
      .map((value) => normalizedStartDateValue(value))
      .find(Boolean);
    const fallbackStartDate =
      explicitStartDate ||
      Object.values(row)
        .map((value) => normalizedStartDateValue(value))
        .filter(Boolean)
        .pop() ||
      "";
    if (!fallbackStartDate) {
      continue;
    }
    map.set(normalizedAgent, preferEarlierDateString(map.get(normalizedAgent) || "", fallbackStartDate));
  }
  return map;
}

function mergeInfoContexts(contexts = []) {
  const mergedRows = [];
  for (const context of contexts) {
    for (const record of context?.records || []) {
      mergedRows.push({
        "Working Status": record.working_status === "working" ? "Working" : "Not Working",
        "Agent Name": record.agent_name || "",
        "Agent Target": record.target || 0,
        Office: record.office || "",
        "Team Leader": record.team_leader || "",
        "Starting Date": record.start_date || "",
      });
    }
  }
  const mergedContext = buildInfoAgentsContext(mergedRows);
  for (const context of contexts) {
    const startDateMap = context?.startDateByAgent;
    if (!startDateMap || typeof startDateMap.entries !== "function") {
      continue;
    }
    for (const [normalizedAgent, startDate] of startDateMap.entries()) {
      const preferredDate = preferEarlierDateString(
        mergedContext.startDateByAgent.get(normalizedAgent) || "",
        startDate,
      );
      if (!preferredDate) {
        continue;
      }
      mergedContext.startDateByAgent.set(normalizedAgent, preferredDate);
      const byAgentRecord = mergedContext.byAgent.get(normalizedAgent);
      if (byAgentRecord) {
        byAgentRecord.start_date = preferEarlierDateString(byAgentRecord.start_date || "", preferredDate);
      }
    }
  }
  return mergedContext;
}

function deriveLatestStatusByAgent(monthData = []) {
  const latestKey = monthData.reduce((max, item) => {
    const key = String(item?.monthRecord?.key || "");
    if (!key) {
      return max;
    }
    return !max || key > max ? key : max;
  }, "");
  const map = new Map();
  if (!latestKey) {
    return map;
  }
  for (const item of monthData) {
    if (String(item?.monthRecord?.key || "") !== latestKey) {
      continue;
    }
    const itemStatusMap = item?.statusByAgent;
    if (itemStatusMap && typeof itemStatusMap.entries === "function") {
      for (const [normalizedAgent, status] of itemStatusMap.entries()) {
        map.set(normalizedAgent, status);
      }
      continue;
    }
    for (const record of item?.infoContext?.records || []) {
      map.set(record.normalized_name, normalizeWorkingStatusValue(record.working_status));
    }
  }
  return map;
}

function filterInfoRowsByAllowedAgents(infoRows = [], tabConfig, allowedAgents = new Set()) {
  if (!allowedAgents.size) {
    return [];
  }
  const agentField = getFieldName(tabConfig, "agentName");
  return infoRows.filter((row) => {
    const normalized = normalizeAgentName(getRowValue(row, agentField));
    return normalized && allowedAgents.has(normalized);
  });
}

function queryFilterObject(query = {}, options = {}) {
  const include = options.include || null;
  const canInclude = (key) => !include || include.has(key);
  const normalizedDesk = parseCsvSelection(query.desk);
  const normalizedCountry = parseCsvSelection(query.country);
  const normalizedBrand = parseCsvSelection(query.brand);
  const normalizedCampaign = parseCsvSelection(query.campaign);
  const normalizedSubCampaign = parseCsvSelection(query.subCampaign);
  const normalizedPlacement = parseCsvSelection(query.placement);
  const normalizedStatus = parseCsvSelection(query.status);
  const normalizedTeamLeader = parseCsvSelection(query.teamLeader);
  const normalizedAgent = parseCsvSelection(query.agent);
  const selectedDate = parseCsvSelection(query.date);
  const selectedHour = parseCsvSelection(query.hour);
  const normalizedDate = selectedDate.length === 1 ? selectedDate[0] : "";
  const normalizedHour = selectedHour.length === 1 ? selectedHour[0] : "";
  const resolvedHour = Number.parseInt(normalizedHour.split(":")[0], 10);
  return {
    ...(canInclude("desk") && normalizedDesk.length ? { office: normalizedDesk } : {}),
    ...(canInclude("country") && normalizedCountry.length ? { country: normalizedCountry } : {}),
    ...(canInclude("brand") && normalizedBrand.length ? { brand: normalizedBrand } : {}),
    ...(canInclude("campaign") && normalizedCampaign.length ? { campaign: normalizedCampaign } : {}),
    ...(canInclude("subCampaign") && normalizedSubCampaign.length ? { subCampaign: normalizedSubCampaign } : {}),
    ...(canInclude("placement") && normalizedPlacement.length ? { placement: normalizedPlacement } : {}),
    ...(canInclude("status") && normalizedStatus.length ? { status: normalizedStatus } : {}),
    ...(canInclude("teamLeader") && normalizedTeamLeader.length ? { teamLeader: normalizedTeamLeader } : {}),
    ...(canInclude("agent") && normalizedAgent.length ? { agent: normalizedAgent, agentField: "agentNames" } : {}),
    ...(canInclude("date") && normalizedDate
      ? { date: { type: "range", start: normalizedDate, end: normalizedDate }, dateField: "leadDate" }
      : {}),
    ...(canInclude("hour") && Number.isFinite(resolvedHour)
      ? { hourRange: { start: resolvedHour, end: resolvedHour }, dateField: "created" }
      : {}),
  };
}

function applyDashboardFilters(rows, tabConfig, query, now = new Date(), options = {}) {
  const include = options.includeFields ? new Set(options.includeFields) : null;
  const canInclude = (key) => !include || include.has(key);
  let filtered = filteredRows(rows, tabConfig, queryFilterObject(query, { include }), now);
  const selectedDates = parseCsvSelection(query.date);
  const selectedHours = parseCsvSelection(query.hour);

  if (canInclude("date") && selectedDates.length > 1) {
    const selectedDateSet = new Set(selectedDates);
    const leadDateField = getFieldName(tabConfig, "leadDate");
    const createdField = getFieldName(tabConfig, "created");
    filtered = filtered.filter((row) => {
      const parsed = parseDateValue(getRowValue(row, leadDateField) || getRowValue(row, createdField));
      if (!parsed) {
        return false;
      }
      const year = String(parsed.getUTCFullYear());
      const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
      const day = String(parsed.getUTCDate()).padStart(2, "0");
      return selectedDateSet.has(`${year}-${month}-${day}`);
    });
  }

  if (canInclude("hour") && selectedHours.length > 1) {
    const selectedHourSet = new Set(selectedHours);
    const createdField = getFieldName(tabConfig, "created");
    filtered = filtered.filter((row) => {
      const parsed = parseDateValue(getRowValue(row, createdField));
      if (!parsed) {
        return false;
      }
      const hour = String(parsed.getUTCHours()).padStart(2, "0");
      return selectedHourSet.has(`${hour}:00`);
    });
  }

  return filtered;
}

function groupRowsByField(rows = [], tabConfig, fieldKey = "agentNames") {
  const fieldName = getFieldName(tabConfig, fieldKey);
  const grouped = new Map();
  for (const row of rows) {
    const label = String(getRowValue(row, fieldName) || "").trim();
    if (!label) {
      continue;
    }
    if (!grouped.has(label)) {
      grouped.set(label, []);
    }
    grouped.get(label).push(row);
  }
  return grouped;
}

function buildTargetMetrics(rows, tabConfig, infoContext, dateFilter, now = new Date()) {
  const targetAggregation = targetAggregationForScope({
    rows,
    tabConfig,
    infoContext,
    filters: dateFilter ? { date: dateFilter } : {},
    scope: {
      groupField: "agentNames",
      onlyWorkingAgents: true,
    },
    now,
  });
  return {
    ftdTarget: Number(targetAggregation?.includedTarget || 0),
  };
}

function summaryWithTargets(rows, tabConfig, infoContext, dateFilter, now = new Date(), scope = {}) {
  const summary = calculateSummary(rows, tabConfig, dateFilter ? { date: dateFilter } : {}, now);
  const targetAggregation = targetAggregationForScope({
    rows,
    tabConfig,
    infoContext,
    filters: dateFilter ? { date: dateFilter } : {},
    scope: {
      groupField: "agentNames",
      onlyWorkingAgents: true,
      ...scope,
    },
    now,
  });
  const targetMetrics = {
    ftdTarget: Number(targetAggregation?.includedTarget || 0),
  };
  return {
    ...summary,
    ...targetMetrics,
    ftdTargetReach: targetReachPercent(summary.totalFtd, targetMetrics.ftdTarget),
  };
}

function groupTable(rows, tabConfig, infoContext, dateFilter, groupField, now = new Date(), options = {}) {
  const groupedRows = groupRowsByField(rows, tabConfig, groupField);
  const sortBy = options.sortBy || "lead";
  return [...groupedRows.entries()]
    .map(([label, entries]) => {
      const summary = summaryWithTargets(entries, tabConfig, infoContext, dateFilter, now, {
        groupField: "agentNames",
        agent: [label],
      });
      return {
        label,
        totalLeads: summary.totalLeads,
        totalFtd: summary.totalFtd,
        ftdTarget: summary.ftdTarget,
        ftdTargetReach: summary.ftdTargetReach,
        cr: summary.cr,
        crTarget: summary.crTarget,
        crTargetReach: summary.crTargetReach,
        selfs: summary.selfs,
        lateFtd: summary.lateFtd,
      };
    })
    .sort((left, right) => {
      if (sortBy === "ftd") {
        return right.totalFtd - left.totalFtd || right.totalLeads - left.totalLeads || left.label.localeCompare(right.label);
      }
      return right.totalLeads - left.totalLeads || right.totalFtd - left.totalFtd || left.label.localeCompare(right.label);
    });
}

function pivotTableRows(rows, tabConfig, infoContext, dateFilter, now = new Date()) {
  const deskField = getFieldName(tabConfig, "office");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  const agentField = getFieldName(tabConfig, "agentNames");
  const grouped = new Map();
  for (const row of rows) {
    const desk = cleanSpreadsheetText(getRowValue(row, deskField) || row.__scopeOfficeName || "");
    const teamLeader = cleanSpreadsheetText(getRowValue(row, teamLeaderField) || "");
    const agent = cleanSpreadsheetText(getRowValue(row, agentField) || "");
    const key = `${normalizeText(desk)}::${normalizeText(teamLeader)}::${normalizeText(agent)}`;
    if (!key.replace(/[:]/g, "")) {
      continue;
    }
    if (!grouped.has(key)) {
      grouped.set(key, { desk, teamLeader, agent, rows: [] });
    }
    grouped.get(key).rows.push(row);
  }
  return [...grouped.values()]
    .map((entry) => {
      const summary = summaryWithTargets(entry.rows, tabConfig, infoContext, dateFilter, now, {
        groupField: "agentNames",
        agent: [entry.agent],
      });
      return {
        label: entry.agent || entry.teamLeader || entry.desk || "-",
        desk: entry.desk || "-",
        teamLeader: entry.teamLeader || "-",
        agent: entry.agent || "-",
        totalLeads: summary.totalLeads,
        totalFtd: summary.totalFtd,
        ftdTarget: summary.ftdTarget,
        ftdTargetReach: summary.ftdTargetReach,
        cr: summary.cr,
        crTarget: summary.crTarget,
        crTargetReach: summary.crTargetReach,
        selfs: summary.selfs,
        lateFtd: summary.lateFtd,
      };
    })
    .sort(
      (left, right) =>
        left.desk.localeCompare(right.desk) ||
        left.teamLeader.localeCompare(right.teamLeader) ||
        left.agent.localeCompare(right.agent),
    );
}

function buildDashboardStats(rows, tabConfig, infoContext, dateFilter, now = new Date()) {
  const aggregation = targetAggregationForScope({
    rows,
    tabConfig,
    infoContext,
    filters: dateFilter ? { date: dateFilter } : {},
    scope: {
      groupField: "agentNames",
      onlyWorkingAgents: true,
    },
    now,
  });
  const targetAgents = (aggregation?.details || []).filter((item) => Number(item.target || 0) > 0);
  const targetAchievedCount = targetAgents.filter((item) => Number(item.ftd || 0) >= Number(item.target || 0)).length;
  const targetAchievedRate = targetAgents.length > 0 ? (targetAchievedCount / targetAgents.length) * 100 : 0;
  return {
    totalAgent: uniqueValues(rows, tabConfig, "agentNames").length,
    teamLeaderTotal: uniqueValues(rows, tabConfig, "teamLeader").length,
    deskTotal: uniqueValues(rows, tabConfig, "office").length,
    totalTargetAchieved: targetAchievedCount,
    rateOfTargetAchieved: targetAchievedRate,
  };
}

async function readMonthData({ monthRecord, officeScope, tabConfig, infoAgentsTabConfig, permissionFilters }) {
  const rawRows = await readSheetRows("leads", {
    tabConfig,
    spreadsheetId: monthRecord.sheet_id,
  });
  const rowsWithScope = mapRowsWithScope(
    mapRowsWithMonthSource(rawRows, monthRecord),
    officeScope || monthRecord.office_name || "",
  );
  const permissionRowsRaw = filterRowsByPermission(rowsWithScope, tabConfig, permissionFilters || {});
  const permissionRows = filterExcludedAgentRows(permissionRowsRaw, tabConfig);
  let legacyInfoRows = [];
  try {
    legacyInfoRows = await readSheetRows("infoAgents", {
      tabConfig: infoAgentsTabConfig,
      spreadsheetId: monthRecord.sheet_id,
    });
    legacyInfoRows = mapRowsWithScope(legacyInfoRows, officeScope || monthRecord.office_name || "");
  } catch {
    legacyInfoRows = [];
  }
  const leadAgentField = getFieldName(tabConfig, "agentNames");
  const allowedAgents = new Set(
    permissionRows
      .map((row) => normalizeAgentName(getRowValue(row, leadAgentField)))
      .filter(Boolean),
  );
  const legacyInfoRowsByAgentScope = filterInfoRowsByAllowedAgents(legacyInfoRows, infoAgentsTabConfig, allowedAgents);
  const legacyInfoContext = buildInfoAgentsContext(legacyInfoRowsByAgentScope);
  const rosterRowsRaw = await readOfficeAgentRosterRows(officeScope || monthRecord.office_name || "");
  const rosterRows = filterOfficeAgentRosterRowsByPermission(rosterRowsRaw, permissionFilters || {});
  const mergedInfoRows = mergedInfoRowsFromRoster(rosterRows, legacyInfoContext.targetsByAgent);
  const effectiveInfoRowsRaw = mergedInfoRows.length ? mergedInfoRows : legacyInfoRowsByAgentScope;
  const effectiveInfoRows = effectiveInfoRowsRaw.filter((row) => {
    const normalized = normalizeAgentName(getRowValue(row, getFieldName(infoAgentsTabConfig, "agentName")));
    return !isExcludedNormalizedAgent(normalized);
  });
  const infoContext = buildInfoAgentsContext(effectiveInfoRows);
  const mergedAllowedAgents = new Set(
    effectiveInfoRows
      .map((row) => normalizeAgentName(getRowValue(row, getFieldName(infoAgentsTabConfig, "agentName"))))
      .filter(Boolean),
  );
  const effectiveAllowedAgents = mergedAllowedAgents.size ? mergedAllowedAgents : allowedAgents;
  const startDateByAgent = collectAgentStartDateMap(effectiveInfoRows, infoAgentsTabConfig, effectiveAllowedAgents);
  const statusByAgent = collectStatusByAgent(effectiveInfoRows, infoAgentsTabConfig, effectiveAllowedAgents);
  for (const [normalizedAgent, startDate] of startDateByAgent.entries()) {
    infoContext.startDateByAgent.set(
      normalizedAgent,
      preferEarlierDateString(infoContext.startDateByAgent.get(normalizedAgent) || "", startDate),
    );
    const record = infoContext.byAgent.get(normalizedAgent);
    if (record) {
      record.start_date = preferEarlierDateString(record.start_date || "", startDate);
    }
  }
  return {
    monthRecord,
    rows: permissionRows,
    infoContext,
    statusByAgent,
  };
}

function optionValuesByField(rows, tabConfig, query, fieldKey, now = new Date()) {
  const includeFields = Object.keys(FILTER_TO_FIELD).filter((key) => key !== fieldKey);
  const filtered = applyDashboardFilters(rows, tabConfig, query, now, { includeFields });
  return uniqueValues(filtered, tabConfig, FILTER_TO_FIELD[fieldKey]);
}

function optionDateValues(rows, tabConfig, query, now = new Date()) {
  const includeFields = [...Object.keys(FILTER_TO_FIELD), "hour"];
  const filtered = applyDashboardFilters(rows, tabConfig, query, now, { includeFields });
  const leadDateField = getFieldName(tabConfig, "leadDate");
  const createdField = getFieldName(tabConfig, "created");
  const values = new Set();
  for (const row of filtered) {
    const parsed = parseDateValue(getRowValue(row, leadDateField) || getRowValue(row, createdField));
    if (!parsed) {
      continue;
    }
    const year = String(parsed.getUTCFullYear());
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    values.add(`${year}-${month}-${day}`);
  }
  return [...values].sort((left, right) => right.localeCompare(left));
}

function optionHourValues(rows, tabConfig, query, now = new Date()) {
  const includeFields = [...Object.keys(FILTER_TO_FIELD), "date"];
  const filtered = applyDashboardFilters(rows, tabConfig, query, now, { includeFields });
  const createdField = getFieldName(tabConfig, "created");
  const values = new Set();
  for (const row of filtered) {
    const parsed = parseDateValue(getRowValue(row, createdField));
    if (!parsed) {
      continue;
    }
    values.add(`${String(parsed.getUTCHours()).padStart(2, "0")}:00`);
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

function formatMonthOption(record = {}) {
  return {
    key: record.key,
    month_label: record.month_label,
    office_name: record.office_name || "",
  };
}

function baseOptions({
  rows,
  tabConfig,
  query,
  officeMap,
  permissionFilters,
  now,
  monthOptions,
}) {
  return {
    officeScopes: normalizeOfficeScopeOptions(officeMap, permissionFilters),
    desks: optionValuesByField(rows, tabConfig, query, "desk", now),
    countries: optionValuesByField(rows, tabConfig, query, "country", now),
    brands: optionValuesByField(rows, tabConfig, query, "brand", now),
    campaigns: optionValuesByField(rows, tabConfig, query, "campaign", now),
    subCampaigns: optionValuesByField(rows, tabConfig, query, "subCampaign", now),
    placements: optionValuesByField(rows, tabConfig, query, "placement", now),
    statuses: optionValuesByField(rows, tabConfig, query, "status", now),
    teamLeaders: optionValuesByField(rows, tabConfig, query, "teamLeader", now),
    agents: optionValuesByField(rows, tabConfig, query, "agent", now),
    dates: optionDateValues(rows, tabConfig, query, now),
    hours: optionHourValues(rows, tabConfig, query, now),
    months: monthOptions,
  };
}

function fastBaseOptionsFromRows({
  rows,
  tabConfig,
  officeMap,
  permissionFilters,
  monthOptions,
}) {
  const deskField = getFieldName(tabConfig, FILTER_TO_FIELD.desk);
  const countryField = getFieldName(tabConfig, FILTER_TO_FIELD.country);
  const brandField = getFieldName(tabConfig, FILTER_TO_FIELD.brand);
  const campaignField = getFieldName(tabConfig, FILTER_TO_FIELD.campaign);
  const subCampaignField = getFieldName(tabConfig, FILTER_TO_FIELD.subCampaign);
  const placementField = getFieldName(tabConfig, FILTER_TO_FIELD.placement);
  const statusField = getFieldName(tabConfig, FILTER_TO_FIELD.status);
  const teamLeaderField = getFieldName(tabConfig, FILTER_TO_FIELD.teamLeader);
  const agentField = getFieldName(tabConfig, FILTER_TO_FIELD.agent);
  const leadDateField = getFieldName(tabConfig, "leadDate");
  const createdField = getFieldName(tabConfig, "created");
  const sets = {
    desks: new Set(),
    countries: new Set(),
    brands: new Set(),
    campaigns: new Set(),
    subCampaigns: new Set(),
    placements: new Set(),
    statuses: new Set(),
    teamLeaders: new Set(),
    agents: new Set(),
    dates: new Set(),
    hours: new Set(),
  };
  for (const row of rows || []) {
    const values = [
      ["desks", getRowValue(row, deskField)],
      ["countries", getRowValue(row, countryField)],
      ["brands", getRowValue(row, brandField)],
      ["campaigns", getRowValue(row, campaignField)],
      ["subCampaigns", getRowValue(row, subCampaignField)],
      ["placements", getRowValue(row, placementField)],
      ["statuses", getRowValue(row, statusField)],
      ["teamLeaders", getRowValue(row, teamLeaderField)],
      ["agents", getRowValue(row, agentField)],
    ];
    for (const [key, value] of values) {
      const text = String(value || "").trim();
      if (text) {
        sets[key].add(text);
      }
    }
    const parsedDate = parseDateValue(getRowValue(row, leadDateField) || getRowValue(row, createdField));
    if (parsedDate) {
      const year = String(parsedDate.getUTCFullYear());
      const month = String(parsedDate.getUTCMonth() + 1).padStart(2, "0");
      const day = String(parsedDate.getUTCDate()).padStart(2, "0");
      sets.dates.add(`${year}-${month}-${day}`);
    }
    const parsedCreated = parseDateValue(getRowValue(row, createdField));
    if (parsedCreated) {
      sets.hours.add(`${String(parsedCreated.getUTCHours()).padStart(2, "0")}:00`);
    }
  }
  const toSortedList = (set, direction = "asc") =>
    [...set].sort((left, right) => (direction === "desc" ? String(right).localeCompare(String(left)) : String(left).localeCompare(String(right))));
  return {
    officeScopes: normalizeOfficeScopeOptions(officeMap, permissionFilters),
    desks: toSortedList(sets.desks),
    countries: toSortedList(sets.countries),
    brands: toSortedList(sets.brands),
    campaigns: toSortedList(sets.campaigns),
    subCampaigns: toSortedList(sets.subCampaigns),
    placements: toSortedList(sets.placements),
    statuses: toSortedList(sets.statuses),
    teamLeaders: toSortedList(sets.teamLeaders),
    agents: toSortedList(sets.agents),
    dates: toSortedList(sets.dates, "desc"),
    hours: toSortedList(sets.hours),
    months: monthOptions,
  };
}

function rollupSummaryFromRows(rows = []) {
  const totalLeads = rows.reduce((sum, row) => sum + Number(row.totalLeads || 0), 0);
  const totalFtd = rows.reduce((sum, row) => sum + Number(row.totalFtd || 0), 0);
  const ftdTarget = rows.reduce((sum, row) => sum + Number(row.ftdTarget || 0), 0);
  const selfs = rows.reduce((sum, row) => sum + Number(row.selfs || 0), 0);
  const lateFtd = rows.reduce((sum, row) => sum + Number(row.lateFtd || 0), 0);
  const weightedCrTargetNumerator = rows.reduce(
    (sum, row) => sum + Number(row.crTarget || 0) * Number(row.totalLeads || 0),
    0,
  );
  const crTarget = totalLeads > 0 ? weightedCrTargetNumerator / totalLeads : 0;
  const cr = totalLeads > 0 ? (totalFtd / totalLeads) * 100 : 0;
  return {
    totalLeads,
    totalFtd,
    cr,
    crTarget,
    crTargetReach: crTarget > 0 ? (cr / crTarget) * 100 : 0,
    selfs,
    lateFtd,
    ftdTarget,
    ftdTargetReach: targetReachPercent(totalFtd, ftdTarget),
  };
}

const GROUP_BY_TO_DIMENSION = {
  agent: "agent",
  teamLeader: "teamLeader",
  desk: "desk",
  country: "country",
  brand: "brand",
  campaign: "campaign",
  placement: "placement",
};

const DEFAULT_SPECIFIC_DIMENSIONS = ["date", "desk", "teamLeader", "agent"];
const DEFAULT_SPECIFIC_METRICS = [
  "leads",
  "leadShare",
  "agentCount",
  "avgLeadByAgent",
  "avgLeadByAgentDaily",
  "ftd",
  "avgFtdByAgent",
  "avgFtdByAgentDaily",
  "agentAvgFtdPerWorkedMonth",
  "avgFtdByDeskLongTerm",
  "ftdBenchmarkRate",
  "ftdTarget",
  "ftdTargetReach",
  "cr",
  "crTarget",
  "crTargetReach",
];
const DEFAULT_SPECIFIC_TOTAL_DIMENSIONS = [];

function parseCsvSelection(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item || "").split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueSelection(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const normalized = String(item || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function selectedSpecificDimensions(query = {}) {
  const raw = parseCsvSelection(query.rowDimensions);
  const fromQuery = raw.filter((key) => SPECIFIC_DIMENSION_BY_KEY.has(key));
  const selected = fromQuery.length ? fromQuery : DEFAULT_SPECIFIC_DIMENSIONS;
  return uniqueSelection(selected);
}

function selectedSpecificMetrics(query = {}) {
  const raw = parseCsvSelection(query.metricFields);
  const fromQuery = raw.filter((key) => SPECIFIC_METRIC_BY_KEY.has(key));
  return uniqueSelection(fromQuery.length ? fromQuery : DEFAULT_SPECIFIC_METRICS);
}

function selectedSpecificTotalDimensions(query = {}, selectedDimensionKeys = []) {
  const raw = parseCsvSelection(query.totalDimensions);
  const eligibleDimensions =
    selectedDimensionKeys.length > 1 ? selectedDimensionKeys.slice(0, selectedDimensionKeys.length - 1) : [];
  const selectedSet = new Set(eligibleDimensions);
  const fromQuery = raw.filter((key) => selectedSet.has(key) && SPECIFIC_DIMENSION_BY_KEY.has(key));
  return uniqueSelection(fromQuery.length ? fromQuery : DEFAULT_SPECIFIC_TOTAL_DIMENSIONS);
}

function prefixKeyForDimensions(dimensions = [], values = {}, depth = 0) {
  return dimensions
    .slice(0, depth + 1)
    .map((dimension) => normalizeText(values[dimension.key] || "-"))
    .join("::");
}

function formatDateStamp(value) {
  const date = parseDateValue(value);
  if (!date) {
    return "-";
  }
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatHourStamp(value) {
  const date = parseDateValue(value);
  if (!date) {
    return "-";
  }
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${hour}:00`;
}

function formatMonthStamp(value) {
  const date = parseDateValue(value);
  if (!date) {
    return "-";
  }
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function columnDimensionValueForRow(row, tabConfig, dimensionKey = "") {
  const createdField = getFieldName(tabConfig, "created");
  const leadDateField = getFieldName(tabConfig, "leadDate");
  if (dimensionKey === "month") {
    const sourceMonthKey = String(row?.__sourceMonthKey || "").trim();
    if (sourceMonthKey) {
      return sourceMonthKey;
    }
    return formatMonthStamp(getRowValue(row, leadDateField) || getRowValue(row, createdField));
  }
  if (dimensionKey === "date") {
    return formatDateStamp(getRowValue(row, leadDateField) || getRowValue(row, createdField));
  }
  if (dimensionKey === "hour") {
    return formatHourStamp(getRowValue(row, createdField) || getRowValue(row, leadDateField));
  }
  return "-";
}

function dimensionValueForRow(row, tabConfig, dimension) {
  if (!dimension) {
    return "-";
  }
  const createdField = getFieldName(tabConfig, "created");
  const leadDateField = getFieldName(tabConfig, "leadDate");
  if (dimension.key === "date") {
    return formatDateStamp(getRowValue(row, leadDateField) || getRowValue(row, createdField));
  }
  if (dimension.key === "hour") {
    return formatHourStamp(getRowValue(row, createdField) || getRowValue(row, leadDateField));
  }
  const fieldName = getFieldName(tabConfig, dimension.fieldKey || dimension.key);
  const value = cleanSpreadsheetText(getRowValue(row, fieldName) || "");
  return value || "-";
}

function targetScopeFromDimensionValues(values = {}) {
  const scope = {
    groupField: "agentNames",
  };
  if (values.agent && values.agent !== "-") {
    scope.agent = [values.agent];
    return scope;
  }
  if (values.teamLeader && values.teamLeader !== "-") {
    scope.teamLeader = [values.teamLeader];
    return scope;
  }
  if (values.desk && values.desk !== "-") {
    scope.office = [values.desk];
    return scope;
  }
  return scope;
}

function metricValuesFromSummary(summary = {}) {
  const totalLeads = Number(summary.totalLeads || 0);
  const totalFtd = Number(summary.totalFtd || 0);
  const crTarget = Number(summary.crTarget || 0);
  const ftdTargetByCr = totalLeads * (crTarget / 100);
  return {
    leads: totalLeads,
    ftd: totalFtd,
    ftdTarget: Number(summary.ftdTarget || 0),
    ftdTargetReach: Number(summary.ftdTargetReach || 0),
    cr: Number(summary.cr || 0),
    crTarget,
    crTargetReach: Number(summary.crTargetReach || 0),
    selfs: Number(summary.selfs || 0),
    lateFtd: Number(summary.lateFtd || 0),
    ftdTargetByCr,
    missingFtd: ftdTargetByCr - totalFtd,
  };
}

function toIsoDateOrRaw(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "-";
  }
  const parsed = parseDateValue(raw);
  if (!parsed) {
    return raw;
  }
  const year = String(parsed.getUTCFullYear());
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const LONG_TERM_BUCKET_LESS_THAN_2 = "less_than_2_months";
const LONG_TERM_BUCKET_MORE_THAN_2 = "more_than_2_months";
const LONG_TERM_BUCKET_UNKNOWN = "unknown";

function workProfileFromStartDateRaw(startDateRaw = "", now = new Date()) {
  const parsedStartDate = parseDateValue(startDateRaw);
  if (!parsedStartDate) {
    return {
      workStartDate: toIsoDateOrRaw(startDateRaw),
      workDays: "-",
      workMonths: "-",
      workLongTerm: "-",
      longTermBucket: LONG_TERM_BUCKET_UNKNOWN,
      monthsWorked: 0,
      daysWorked: 0,
    };
  }
  const nowDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startDay = new Date(
    Date.UTC(parsedStartDate.getUTCFullYear(), parsedStartDate.getUTCMonth(), parsedStartDate.getUTCDate()),
  );
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((nowDate.getTime() - startDay.getTime()) / dayMs);
  const daysWorked = diffDays >= 0 ? diffDays + 1 : 0;
  const monthsWorked = daysWorked > 0 ? Math.floor(daysWorked / 30) : 0;
  const longTermBucket = monthsWorked > 2 ? LONG_TERM_BUCKET_MORE_THAN_2 : LONG_TERM_BUCKET_LESS_THAN_2;
  return {
    workStartDate: toIsoDateOrRaw(startDateRaw),
    workDays: daysWorked > 0 ? daysWorked : "-",
    workMonths: daysWorked > 0 ? monthsWorked : "-",
    workLongTerm: monthsWorked > 2 ? "MORE THAN 2 MONTHS" : "LESS THAN 2 MONTHS",
    longTermBucket,
    monthsWorked,
    daysWorked,
  };
}

function parseMetricNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/^[']+/, "")
    .replace(/[%]/g, "")
    .replace(",", ".")
    .trim();
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function ftdContributionFromRow(row = {}, tabConfig) {
  const fields = tabConfig.fields || {};
  const metricCandidates = [
    getRowValue(row, fields.ftd),
    getRowValue(row, "FTD"),
    getRowValue(row, "FTD'S"),
    getRowValue(row, "FTDS"),
  ];
  let metricValue = 0;
  for (const candidate of metricCandidates) {
    const parsed = parseMetricNumber(candidate);
    if (parsed !== null) {
      metricValue = parsed;
      break;
    }
  }
  if (metricValue > 0) {
    return metricValue;
  }
  const ftdMaker = String(getRowValue(row, fields.ftdMaker) || "").trim();
  return ftdMaker ? 1 : 0;
}

function buildDeskFtdAverages(rows = [], tabConfig, infoContext, now = new Date()) {
  const deskField = getFieldName(tabConfig, "office");
  const agentField = getFieldName(tabConfig, "agentNames");
  const leadDateField = getFieldName(tabConfig, "leadDate");
  const createdField = getFieldName(tabConfig, "created");
  const grouped = new Map();
  for (const row of rows) {
    const desk = String(getRowValue(row, deskField) || row.__scopeOfficeName || "").trim();
    const normalizedDesk = normalizeText(desk);
    if (!normalizedDesk) {
      continue;
    }
    if (!grouped.has(normalizedDesk)) {
      grouped.set(normalizedDesk, { totalFtd: 0, agents: new Map() });
    }
    const entry = grouped.get(normalizedDesk);
    const rowFtd = ftdContributionFromRow(row, tabConfig);
    entry.totalFtd += rowFtd;
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    if (normalizedAgent) {
      if (!entry.agents.has(normalizedAgent)) {
        entry.agents.set(normalizedAgent, { totalFtd: 0, monthKeys: new Set() });
      }
      const agentEntry = entry.agents.get(normalizedAgent);
      agentEntry.totalFtd += rowFtd;
      const parsedDate = parseDateValue(getRowValue(row, leadDateField) || getRowValue(row, createdField));
      if (parsedDate) {
        const monthKey = `${parsedDate.getUTCFullYear()}-${String(parsedDate.getUTCMonth() + 1).padStart(2, "0")}`;
        agentEntry.monthKeys.add(monthKey);
      }
    }
  }
  const output = new Map();
  for (const [desk, entry] of grouped.entries()) {
    const agentCount = entry.agents.size;
    const byLongTerm = {
      [LONG_TERM_BUCKET_LESS_THAN_2]: { total: 0, count: 0 },
      [LONG_TERM_BUCKET_MORE_THAN_2]: { total: 0, count: 0 },
    };
    for (const [normalizedAgent, agentEntry] of entry.agents.entries()) {
      const activeMonthCount = agentEntry.monthKeys.size || 1;
      const agentMonthlyFtd = Number(agentEntry.totalFtd || 0) / activeMonthCount;
      const startDateRaw =
        infoContext?.startDateByAgent?.get(normalizedAgent) || infoContext?.byAgent?.get(normalizedAgent)?.start_date || "";
      const workProfile = workProfileFromStartDateRaw(startDateRaw, now);
      if (workProfile.longTermBucket === LONG_TERM_BUCKET_LESS_THAN_2) {
        byLongTerm[LONG_TERM_BUCKET_LESS_THAN_2].total += agentMonthlyFtd;
        byLongTerm[LONG_TERM_BUCKET_LESS_THAN_2].count += 1;
      } else if (workProfile.longTermBucket === LONG_TERM_BUCKET_MORE_THAN_2) {
        byLongTerm[LONG_TERM_BUCKET_MORE_THAN_2].total += agentMonthlyFtd;
        byLongTerm[LONG_TERM_BUCKET_MORE_THAN_2].count += 1;
      }
    }
    output.set(desk, {
      avgFtdByAgent: agentCount > 0 ? Number(entry.totalFtd || 0) / agentCount : 0,
      avgFtdByLongTerm: {
        [LONG_TERM_BUCKET_LESS_THAN_2]:
          byLongTerm[LONG_TERM_BUCKET_LESS_THAN_2].count > 0
            ? byLongTerm[LONG_TERM_BUCKET_LESS_THAN_2].total / byLongTerm[LONG_TERM_BUCKET_LESS_THAN_2].count
            : 0,
        [LONG_TERM_BUCKET_MORE_THAN_2]:
          byLongTerm[LONG_TERM_BUCKET_MORE_THAN_2].count > 0
            ? byLongTerm[LONG_TERM_BUCKET_MORE_THAN_2].total / byLongTerm[LONG_TERM_BUCKET_MORE_THAN_2].count
            : 0,
      },
    });
  }
  return output;
}

function metricOutputValue(metric, metricValues = {}) {
  if (!metric) {
    return 0;
  }
  const value = metricValues[metric.key];
  if (metric.type === "number" || metric.type === "percent") {
    return Number(value || 0);
  }
  return String(value ?? "-");
}

function builderExtraMetricValues(rows = [], tabConfig, summary = {}, options = {}) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const deskField = getFieldName(tabConfig, "office");
  const leadDateField = getFieldName(tabConfig, "leadDate");
  const createdField = getFieldName(tabConfig, "created");
  const rowValues = options.rowValues || {};
  const deskFtdAverages = options.deskFtdAverages || new Map();
  const infoContext = options.infoContext || null;
  const now = options.now || new Date();
  const uniqueAgents = new Set();
  const uniqueDates = new Set();
  const uniqueMonths = new Set();
  const monthKeysByAgent = new Map();
  const ftdByAgent = new Map();
  for (const row of rows) {
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    if (normalizedAgent) {
      uniqueAgents.add(normalizedAgent);
      if (!monthKeysByAgent.has(normalizedAgent)) {
        monthKeysByAgent.set(normalizedAgent, new Set());
      }
      ftdByAgent.set(normalizedAgent, (ftdByAgent.get(normalizedAgent) || 0) + ftdContributionFromRow(row, tabConfig));
    }
    const parsedDate = parseDateValue(getRowValue(row, leadDateField) || getRowValue(row, createdField));
    if (parsedDate) {
      const year = String(parsedDate.getUTCFullYear());
      const month = String(parsedDate.getUTCMonth() + 1).padStart(2, "0");
      const day = String(parsedDate.getUTCDate()).padStart(2, "0");
      uniqueDates.add(`${year}-${month}-${day}`);
      uniqueMonths.add(`${year}-${month}`);
      if (normalizedAgent && monthKeysByAgent.has(normalizedAgent)) {
        monthKeysByAgent.get(normalizedAgent).add(`${year}-${month}`);
      }
    }
  }
  const agentCount = uniqueAgents.size;
  const dayCount = uniqueDates.size;
  const totalLeads = Number(summary.totalLeads || 0);
  const totalFtd = Number(summary.totalFtd || 0);
  const avgLeadByAgent = agentCount > 0 ? totalLeads / agentCount : 0;
  const normalizedDeskFromValues = normalizeText(rowValues.desk || "");
  const normalizedDeskFromRows = normalizeText(
    rowValues.desk || getRowValue(rows[0] || {}, deskField) || rows[0]?.__scopeOfficeName || "",
  );
  const normalizedDesk = normalizedDeskFromValues || normalizedDeskFromRows;
  const rowAgent = normalizeAgentName(rowValues.agent || "");
  const rowTeamLeader = normalizeAgentName(rowValues.teamLeader || "");
  const uniqueAgent = rowAgent || (uniqueAgents.size === 1 ? [...uniqueAgents][0] : "");
  let startDateRaw = uniqueAgent
    ? infoContext?.startDateByAgent?.get(uniqueAgent) ||
      infoContext?.byAgent?.get(uniqueAgent)?.start_date ||
      ""
    : "";
  if (!startDateRaw && rowTeamLeader) {
    startDateRaw =
      infoContext?.startDateByAgent?.get(rowTeamLeader) ||
      infoContext?.byAgent?.get(rowTeamLeader)?.start_date ||
      "";
  }
  const workProfile = workProfileFromStartDateRaw(startDateRaw, now);
  const deskAverage =
    deskFtdAverages.get(normalizedDesk)?.avgFtdByAgent ??
    (agentCount > 0 ? totalFtd / agentCount : 0);
  const deskLongTermAverage =
    deskFtdAverages.get(normalizedDesk)?.avgFtdByLongTerm?.[workProfile.longTermBucket] || 0;
  const agentMonthSet = uniqueAgent ? monthKeysByAgent.get(uniqueAgent) : null;
  const agentActiveMonthCount = uniqueAgent ? agentMonthSet?.size || 1 : 0;
  const resolvedAgentFtd =
    uniqueAgent && ftdByAgent.has(uniqueAgent)
      ? Number(ftdByAgent.get(uniqueAgent) || 0)
      : uniqueAgents.size === 1
        ? totalFtd
        : 0;
  const agentAvgFtdByMonth = uniqueAgent && agentActiveMonthCount > 0 ? resolvedAgentFtd / agentActiveMonthCount : 0;
  const benchmarkRate = deskLongTermAverage > 0 ? (agentAvgFtdByMonth / deskLongTermAverage) * 100 : 0;
  return {
    agentCount,
    avgLeadByAgent,
    avgLeadByAgentDaily: dayCount > 0 ? avgLeadByAgent / dayCount : 0,
    avgFtdByAgent: deskAverage,
    avgFtdByAgentDaily: dayCount > 0 ? deskAverage / dayCount : 0,
    agentAvgFtdPerWorkedMonth: agentAvgFtdByMonth,
    avgFtdByDeskLongTerm: deskLongTermAverage,
    ftdBenchmarkRate: benchmarkRate,
  };
}

function workTimeValuesFromRows(rows = [], tabConfig, infoContext, now = new Date(), options = {}) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const uniqueAgents = new Set();
  for (const row of rows) {
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    if (normalizedAgent) {
      uniqueAgents.add(normalizedAgent);
    }
  }
  const rowAgent = normalizeAgentName(options.rowValues?.agent || "");
  const rowTeamLeader = normalizeAgentName(options.rowValues?.teamLeader || "");
  const normalizedAgent = rowAgent || (uniqueAgents.size === 1 ? [...uniqueAgents][0] : "");
  if (!normalizedAgent) {
    return {
      workStartDate: "-",
      workDays: "-",
      workMonths: "-",
      workLongTerm: "-",
      workCurrentStatus: "-",
    };
  }
  let startDateRaw =
    infoContext?.startDateByAgent?.get(normalizedAgent) || infoContext?.byAgent?.get(normalizedAgent)?.start_date || "";
  if (!startDateRaw && rowTeamLeader) {
    startDateRaw =
      infoContext?.startDateByAgent?.get(rowTeamLeader) || infoContext?.byAgent?.get(rowTeamLeader)?.start_date || "";
  }
  const profile = workProfileFromStartDateRaw(startDateRaw, now);
  const latestStatusMap = options.latestStatusByAgent || infoContext?.latestStatusByAgent;
  const statusRaw =
    latestStatusMap?.get(normalizedAgent) ||
    normalizeWorkingStatusValue(infoContext?.byAgent?.get(normalizedAgent)?.working_status || "");
  return {
    workStartDate: profile.workStartDate,
    workDays: profile.workDays,
    workMonths: profile.workMonths,
    workLongTerm: profile.workLongTerm,
    workCurrentStatus: statusRaw === "working" ? "Active" : "Not Working",
  };
}

function specificBuilderTable(rows, tabConfig, infoContext, monthFilter, query = {}, now = new Date()) {
  const dimensionKeys = selectedSpecificDimensions(query);
  const requestedDimensionOrder = parseCsvSelection(query.rowDimensions).filter((key) => SPECIFIC_DIMENSION_BY_KEY.has(key));
  const metricKeys = selectedSpecificMetrics(query);
  const dimensions = dimensionKeys.map((key) => SPECIFIC_DIMENSION_BY_KEY.get(key)).filter(Boolean);
  const selectedDimensionByKey = new Map(dimensions.map((item) => [item.key, item]));
  const groupByDimension = GROUP_BY_TO_DIMENSION[String(query.groupBy || "").trim()];
  const hasExplicitDimensionOrder = requestedDimensionOrder.length > 0;
  const orderedDimensions =
    !hasExplicitDimensionOrder && groupByDimension && selectedDimensionByKey.has(groupByDimension)
      ? [selectedDimensionByKey.get(groupByDimension), ...dimensions.filter((item) => item.key !== groupByDimension)]
      : dimensions;
  const normalizedColumnDimension = String(query.columnDimension || "").trim().toLowerCase();
  const columnDimension = ["month", "date", "hour"].includes(normalizedColumnDimension) ? normalizedColumnDimension : "";
  const includeWorkTime = ["1", "true", "yes", "on"].includes(normalizeText(query.includeWorkTime));
  const workTimeColumns = includeWorkTime
    ? [
        { key: "workStartDate", label: "Start Date", type: "text", kind: "worktime" },
        { key: "workDays", label: "Days", type: "number", kind: "worktime" },
        { key: "workMonths", label: "Months", type: "number", kind: "worktime" },
        { key: "workLongTerm", label: "Long Term", type: "text", kind: "worktime" },
        { key: "workCurrentStatus", label: "Current Status", type: "text", kind: "worktime" },
      ]
    : [];
  const totalDimensionKeys = columnDimension
    ? []
    : selectedSpecificTotalDimensions(
        query,
        orderedDimensions.map((dimension) => dimension.key),
      );
  const totalDimensionSet = new Set(totalDimensionKeys);
  const metrics = metricKeys.map((key) => SPECIFIC_METRIC_BY_KEY.get(key)).filter(Boolean);
  const includeLeadShare = metrics.some((metric) => metric.key === "leadShare");
  const needsTargetAggregation = metrics.some((metric) => metric.key === "ftdTarget" || metric.key === "ftdTargetReach");
  const scopedSummary = (subsetRows, scopeValues = {}) => {
    if (needsTargetAggregation) {
      return summaryWithTargets(
        subsetRows,
        tabConfig,
        infoContext,
        monthFilter,
        now,
        targetScopeFromDimensionValues(scopeValues),
      );
    }
    const baseSummary = calculateSummary(subsetRows, tabConfig, monthFilter ? { date: monthFilter } : {}, now);
    return {
      ...baseSummary,
      ftdTarget: 0,
      ftdTargetReach: 0,
    };
  };
  const deskFtdAverages = buildDeskFtdAverages(rows, tabConfig, infoContext, now);

  if (columnDimension) {
    const rowDimensions = orderedDimensions.filter((dimension) => dimension.key !== columnDimension);
    const effectiveRowDimensions = rowDimensions;
    const grouped = new Map();
    const columnValues = new Set();
    for (const row of rows) {
      const values = {};
      for (const dimension of effectiveRowDimensions) {
        values[dimension.key] = dimensionValueForRow(row, tabConfig, dimension);
      }
      const columnValue = columnDimensionValueForRow(row, tabConfig, columnDimension);
      const groupKey = effectiveRowDimensions.length
        ? effectiveRowDimensions.map((dimension) => normalizeText(values[dimension.key])).join("::")
        : "__all__";
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { values, byColumn: new Map() });
      }
      const entry = grouped.get(groupKey);
      if (!entry.byColumn.has(columnValue)) {
        entry.byColumn.set(columnValue, []);
      }
      entry.byColumn.get(columnValue).push(row);
      columnValues.add(columnValue);
    }

    const orderedColumnValues = [...columnValues].sort((left, right) => String(left || "").localeCompare(String(right || "")));
    const overallSummary = needsTargetAggregation
      ? summaryWithTargets(rows, tabConfig, infoContext, monthFilter, now)
      : calculateSummary(rows, tabConfig, monthFilter ? { date: monthFilter } : {}, now);
    const totalLeadBase = Number(overallSummary.totalLeads || 0);
    const tableRows = [...grouped.values()]
      .map((entry) => {
        const payload = {};
        for (const dimension of effectiveRowDimensions) {
          payload[dimension.key] = entry.values[dimension.key] || "-";
        }
        for (const columnValue of orderedColumnValues) {
          const bucketRows = entry.byColumn.get(columnValue) || [];
          const summary = scopedSummary(bucketRows, entry.values);
          const metricValues = {
            ...metricValuesFromSummary(summary),
            ...builderExtraMetricValues(bucketRows, tabConfig, summary, {
              infoContext,
              rowValues: entry.values,
              deskFtdAverages,
              now,
            }),
          };
          for (const metric of metrics) {
            const key = `${columnDimension}_${columnValue}__${metric.key}`;
            if (metric.key === "leadShare") {
              payload[key] = totalLeadBase > 0 ? (Number(metricValues.leads || 0) / totalLeadBase) * 100 : 0;
            } else {
              payload[key] = metricOutputValue(metric, metricValues);
            }
          }
        }
        if (includeWorkTime) {
          Object.assign(
            payload,
            workTimeValuesFromRows([...entry.byColumn.values()].flat(), tabConfig, infoContext, now, {
              rowValues: entry.values,
              latestStatusByAgent: infoContext?.latestStatusByAgent,
            }),
          );
        }
        return payload;
      })
      .sort((left, right) => {
        for (const dimension of effectiveRowDimensions) {
          const compare = String(left[dimension.key] || "").localeCompare(String(right[dimension.key] || ""));
          if (compare !== 0) {
            return compare;
          }
        }
        return 0;
      });

    return {
      table: tableRows,
      columns: [
        ...effectiveRowDimensions.map((dimension) => ({
          key: dimension.key,
          label: dimension.label,
          type: dimension.type || "text",
          kind: "dimension",
        })),
        ...orderedColumnValues.flatMap((columnValue) =>
          metrics.map((metric) => ({
            key: `${columnDimension}_${columnValue}__${metric.key}`,
            label: `${columnValue} ${metric.label}`,
            type: metric.type || "number",
            kind: "metric",
          })),
        ),
        ...workTimeColumns,
      ],
      selectedDimensions: dimensionKeys,
      selectedMetrics: metricKeys,
      selectedTotalDimensions: [],
      columnDimension,
      columnValues: orderedColumnValues,
      columnMetrics: metrics.map((metric) => ({
        key: metric.key,
        label: metric.label,
        type: metric.type || "number",
      })),
      includeWorkTime,
    };
  }

  const grouped = new Map();
  for (const row of rows) {
    const values = {};
    for (const dimension of orderedDimensions) {
      values[dimension.key] = dimensionValueForRow(row, tabConfig, dimension);
    }
    const key = orderedDimensions.map((dimension) => normalizeText(values[dimension.key])).join("::");
    if (!grouped.has(key)) {
      grouped.set(key, { values, rows: [] });
    }
    grouped.get(key).rows.push(row);
  }

  const detailRows = [...grouped.values()]
    .map((entry) => {
      const summary = scopedSummary(entry.rows, entry.values);
      const metricValues = {
        ...metricValuesFromSummary(summary),
        ...builderExtraMetricValues(entry.rows, tabConfig, summary, {
          infoContext,
          rowValues: entry.values,
          deskFtdAverages,
          now,
        }),
      };
      const payload = {};
      for (const dimension of orderedDimensions) {
        payload[dimension.key] = entry.values[dimension.key] || "-";
      }
      for (const metric of metrics) {
        if (metric.key === "leadShare") {
          continue;
        }
        payload[metric.key] = metricOutputValue(metric, metricValues);
      }
      if (includeWorkTime) {
        Object.assign(
          payload,
          workTimeValuesFromRows(entry.rows, tabConfig, infoContext, now, {
            rowValues: entry.values,
            latestStatusByAgent: infoContext?.latestStatusByAgent,
          }),
        );
      }
      return {
        payload,
        leadBase: Number(metricValues.leads || 0),
        values: entry.values,
        sourceRows: entry.rows,
      };
    })
    .sort((left, right) => {
      for (const dimension of orderedDimensions) {
        const leftValue = String(left.values[dimension.key] || "");
        const rightValue = String(right.values[dimension.key] || "");
        const compare = leftValue.localeCompare(rightValue);
        if (compare !== 0) {
          return compare;
        }
      }
      return 0;
    });

  const totalLeadBase = detailRows.reduce((sum, entry) => sum + Number(entry.leadBase || 0), 0);

  if (includeLeadShare) {
    for (const row of detailRows) {
      row.payload.leadShare = totalLeadBase > 0 ? (Number(row.leadBase || 0) / totalLeadBase) * 100 : 0;
    }
  }

  const subtotalByDimension = new Map();
  if (totalDimensionKeys.length) {
    for (const totalDimensionKey of totalDimensionKeys) {
      const depth = orderedDimensions.findIndex((dimension) => dimension.key === totalDimensionKey);
      if (depth < 0) {
        continue;
      }
      const groupsAtDepth = new Map();
      for (const detailRow of detailRows) {
        const prefixKey = prefixKeyForDimensions(orderedDimensions, detailRow.values, depth);
        if (!groupsAtDepth.has(prefixKey)) {
          const prefixValues = {};
          for (let index = 0; index <= depth; index += 1) {
            const dimension = orderedDimensions[index];
            prefixValues[dimension.key] = detailRow.values[dimension.key] || "-";
          }
          groupsAtDepth.set(prefixKey, {
            values: prefixValues,
            rows: [],
          });
        }
        groupsAtDepth.get(prefixKey).rows.push(...detailRow.sourceRows);
      }

      const subtotalRows = new Map();
      for (const [prefixKey, group] of groupsAtDepth.entries()) {
        const summary = scopedSummary(group.rows, group.values);
        const metricValues = metricValuesFromSummary(summary);
        const extraMetricValues = builderExtraMetricValues(group.rows, tabConfig, summary, {
          infoContext,
          rowValues: group.values,
          deskFtdAverages,
          now,
        });
        const payload = {};
        for (let index = 0; index < orderedDimensions.length; index += 1) {
          const dimension = orderedDimensions[index];
          if (index < depth) {
            payload[dimension.key] = group.values[dimension.key] || "-";
          } else if (index === depth) {
            payload[dimension.key] = `${group.values[dimension.key] || "-"} Total`;
          } else {
            payload[dimension.key] = "-";
          }
        }
        for (const metric of metrics) {
          if (metric.key === "leadShare") {
            continue;
          }
          payload[metric.key] = metricOutputValue(metric, {
            ...metricValues,
            ...extraMetricValues,
          });
        }
        if (includeWorkTime) {
          Object.assign(
            payload,
            workTimeValuesFromRows(group.rows, tabConfig, infoContext, now, {
              rowValues: group.values,
              latestStatusByAgent: infoContext?.latestStatusByAgent,
            }),
          );
        }
        payload.__rowKind = "total";
        payload.__totalDimension = totalDimensionKey;
        if (includeLeadShare) {
          payload.leadShare = totalLeadBase > 0 ? (Number(metricValues.leads || 0) / totalLeadBase) * 100 : 0;
        }
        subtotalRows.set(prefixKey, payload);
      }
      subtotalByDimension.set(totalDimensionKey, subtotalRows);
    }
  }

  const tableRows = [];
  for (let index = 0; index < detailRows.length; index += 1) {
    const currentRow = detailRows[index];
    tableRows.push(currentRow.payload);
    if (!totalDimensionKeys.length) {
      continue;
    }
    const nextRow = detailRows[index + 1] || null;
    for (let depth = orderedDimensions.length - 1; depth >= 0; depth -= 1) {
      const dimension = orderedDimensions[depth];
      if (!totalDimensionSet.has(dimension.key)) {
        continue;
      }
      const currentPrefix = prefixKeyForDimensions(orderedDimensions, currentRow.values, depth);
      const nextPrefix = nextRow ? prefixKeyForDimensions(orderedDimensions, nextRow.values, depth) : "";
      if (nextRow && currentPrefix === nextPrefix) {
        continue;
      }
      const subtotalRow = subtotalByDimension.get(dimension.key)?.get(currentPrefix);
      if (subtotalRow) {
        tableRows.push(subtotalRow);
      }
    }
  }

  return {
    table: tableRows,
    columns: [
      ...orderedDimensions.map((dimension) => ({
        key: dimension.key,
        label: dimension.label,
        type: dimension.type || "text",
        kind: "dimension",
      })),
      ...metrics.map((metric) => ({
        key: metric.key,
        label: metric.label,
        type: metric.type || "number",
        kind: "metric",
      })),
      ...workTimeColumns,
    ],
    selectedDimensions: dimensionKeys,
    selectedMetrics: metricKeys,
    selectedTotalDimensions: totalDimensionKeys,
    columnDimension: "",
    columnValues: [],
    columnMetrics: [],
    includeWorkTime,
  };
}

function specificHourlyTable(rows, tabConfig, monthFilter, now = new Date()) {
  return hourlyDistribution(rows, tabConfig, { date: monthFilter }, "created", "totalFtd", now).map((item) => ({
    label: item.label,
    totalLeads: Number(item.leads || 0),
    totalFtd: Number(item.ftd || 0),
    ftdTarget: 0,
    ftdTargetReach: 0,
    cr: Number(item.cr || 0),
    crTarget: 0,
    crTargetReach: 0,
    selfs: 0,
    lateFtd: 0,
  }));
}

function specificBestAgentsTable(rows, tabConfig, monthFilter, now = new Date()) {
  return groupPerformance(rows, tabConfig, { date: monthFilter }, "agentNames", 30, "totalFtd", now).map((item) => ({
    label: item.label,
    totalLeads: Number(item.summary?.totalLeads || 0),
    totalFtd: Number(item.summary?.totalFtd || 0),
    ftdTarget: 0,
    ftdTargetReach: 0,
    cr: Number(item.summary?.cr || 0),
    crTarget: Number(item.summary?.crTarget || 0),
    crTargetReach: Number(item.summary?.crTargetReach || 0),
    selfs: Number(item.summary?.selfs || 0),
    lateFtd: Number(item.summary?.lateFtd || 0),
  }));
}

function rowMatchesLast4InfoFilters(record = {}, query = {}) {
  const desk = String(record.office || "").trim();
  const teamLeader = String(record.team_leader || "").trim();
  const agent = String(record.agent_name || "").trim();
  const normalizedFilterList = (value) => parseCsvSelection(value).map((item) => normalizeText(item)).filter(Boolean);
  const matchesFilter = (value, expectedRaw) => {
    const expectedValues = normalizedFilterList(expectedRaw);
    if (!expectedValues.length) {
      return true;
    }
    return expectedValues.includes(normalizeText(value));
  };
  if (!matchesFilter(desk, query.desk)) {
    return false;
  }
  if (!matchesFilter(teamLeader, query.teamLeader)) {
    return false;
  }
  if (!matchesFilter(agent, query.agent)) {
    return false;
  }
  return true;
}

function buildLast4AgentMatrix(monthData = [], tabConfig, query = {}, now = new Date(), options = {}) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const deskField = getFieldName(tabConfig, "office");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  const latestStatusByAgent = options.latestStatusByAgent || deriveLatestStatusByAgent(monthData);
  const months = [...monthData]
    .map((item) => ({
      key: item.monthRecord.key,
      label: item.monthRecord.month_label,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const byAgent = new Map();
  const parseMonthRankFromDate = (value = "") => {
    const parsed = parseDateValue(value);
    if (!parsed) {
      return null;
    }
    return parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
  };
  const formatIsoDate = (value = "") => {
    const raw = String(value || "").trim();
    const parsed = parseDateValue(value);
    if (!parsed) {
      return raw;
    }
    const year = String(parsed.getUTCFullYear());
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const latestMonthRank = months.length
    ? months.reduce((max, month) => {
        const [yearRaw, monthRaw] = String(month.key || "").split("-");
        const year = Number(yearRaw);
        const index = Number(monthRaw) - 1;
        if (!Number.isFinite(year) || !Number.isFinite(index) || index < 0 || index > 11) {
          return max;
        }
        const rank = year * 12 + index;
        return rank > max ? rank : max;
      }, -Infinity)
    : -Infinity;
  const ensureAgent = (normalizedAgent, payload = {}) => {
    if (!normalizedAgent) {
      return null;
    }
    if (!byAgent.has(normalizedAgent)) {
      byAgent.set(normalizedAgent, {
        key: normalizedAgent,
        desk: "",
        teamLeader: "",
        agent: payload.agent || normalizedAgent,
        startDate: "",
        currentStatus: "Not Working",
        months: {},
      });
    }
    const current = byAgent.get(normalizedAgent);
    if (payload.desk && !current.desk) {
      current.desk = payload.desk;
    }
    if (payload.teamLeader && !current.teamLeader) {
      current.teamLeader = payload.teamLeader;
    }
    if (payload.agent && current.agent === current.key) {
      current.agent = payload.agent;
    }
    if (payload.startDate) {
      if (!current.startDate) {
        current.startDate = payload.startDate;
      } else {
        const currentRank = parseMonthRankFromDate(current.startDate);
        const payloadRank = parseMonthRankFromDate(payload.startDate);
        if (payloadRank !== null && (currentRank === null || payloadRank < currentRank)) {
          current.startDate = payload.startDate;
        }
      }
    }
    if (payload.currentStatus) {
      current.currentStatus = payload.currentStatus;
    }
    return current;
  };

  for (const item of monthData) {
    const monthKey = item.monthRecord.key;
    const monthFilter = monthFilterFromKey(monthKey);
    const filteredRows = applyDashboardFilters(item.rows, tabConfig, query, now);
    const rowsByAgent = new Map();
    for (const row of filteredRows) {
      const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
      if (!normalizedAgent) {
        continue;
      }
      const infoRecord = item.infoContext?.byAgent?.get(normalizedAgent);
      let desk = cleanSpreadsheetText(getRowValue(row, deskField) || row.__scopeOfficeName || "");
      let teamLeader = cleanSpreadsheetText(getRowValue(row, teamLeaderField) || "");
      let agent = cleanSpreadsheetText(getRowValue(row, agentField) || "") || normalizedAgent;
      if (!desk) {
        desk = cleanSpreadsheetText(infoRecord?.office || "");
      }
      if (!teamLeader) {
        teamLeader = cleanSpreadsheetText(infoRecord?.team_leader || "");
      }
      if (!agent) {
        agent = cleanSpreadsheetText(infoRecord?.agent_name || "") || normalizedAgent;
      }
      let startDate = item.infoContext?.startDateByAgent?.get(normalizedAgent) || "";
      if (!startDate) {
        const normalizedTeamLeader = normalizeAgentName(teamLeader);
        startDate = item.infoContext?.startDateByAgent?.get(normalizedTeamLeader) || "";
      }
      ensureAgent(normalizedAgent, { desk, teamLeader, agent, startDate });
      if (!rowsByAgent.has(normalizedAgent)) {
        rowsByAgent.set(normalizedAgent, []);
      }
      rowsByAgent.get(normalizedAgent).push(row);
    }

    for (const record of item.infoContext?.records || []) {
      if (record?.working_status !== "working") {
        continue;
      }
      if (!rowMatchesLast4InfoFilters(record, query)) {
        continue;
      }
      ensureAgent(record.normalized_name, {
        desk: record.office,
        teamLeader: record.team_leader,
        agent: record.agent_name,
        startDate: record.start_date,
      });
      if (!rowsByAgent.has(record.normalized_name)) {
        rowsByAgent.set(record.normalized_name, []);
      }
    }

    for (const [normalizedAgent, entry] of byAgent.entries()) {
      const agentRows = rowsByAgent.get(normalizedAgent) || [];
      const summary = summaryWithTargets(agentRows, tabConfig, item.infoContext, monthFilter, now, {
        groupField: "agentNames",
        agent: [normalizedAgent],
      });
      entry.months[monthKey] = {
        target: summary.ftdTarget,
        ftd: summary.totalFtd,
        cr: summary.cr,
        crTarget: summary.crTarget,
        crTargetReach: summary.crTargetReach,
        ftdTargetReach: summary.ftdTargetReach,
        selves: summary.selfs,
        lateFtd: summary.lateFtd,
      };
    }
  }

  const rows = [...byAgent.values()].sort(
    (left, right) =>
      left.desk.localeCompare(right.desk) ||
      left.teamLeader.localeCompare(right.teamLeader) ||
      left.agent.localeCompare(right.agent),
  );
  for (const row of rows) {
    const formattedStartDate = formatIsoDate(row.startDate);
    const startRank = parseMonthRankFromDate(row.startDate);
    const monthsWorked =
      Number.isFinite(startRank) && Number.isFinite(latestMonthRank) && latestMonthRank >= startRank
        ? latestMonthRank - startRank + 1
        : 0;
    row.startDate = formattedStartDate || "-";
    row.monthsWorked = monthsWorked > 0 ? monthsWorked : "-";
    const normalizedStatus = normalizeWorkingStatusValue(latestStatusByAgent.get(row.key) || "");
    row.currentStatus = normalizedStatus === "working" ? "Active" : "Not Working";
  }
  return {
    months,
    rows,
  };
}

export async function resolveDashboardAccess(telegramUser) {
  const authorityScope = await resolveAuthorityScopeForUser(telegramUser);
  if (!allowByRole(telegramUser, authorityScope)) {
    return {
      authorized: false,
      authorityScope,
      permissionFilters: {},
      telegramUser,
    };
  }
  return {
    authorized: true,
    authorityScope,
    permissionFilters: buildPermissionFilters(authorityScope, telegramUser),
    telegramUser,
  };
}

export async function dashboardBootstrap(accessContext, options = {}) {
  const now = options.now || new Date();
  const officeMap = await getOfficeMonthMap().catch(() => ({
    offices: [],
    byOffice: {},
  }));
  const months = mergedMonthRecords(officeMap);
  const month = resolveMonthRecord("", "", officeMap, now);
  return {
    months: months.map(formatMonthOption),
    defaultMonthKey: month?.key || months[0]?.key || "",
    officeScopes: normalizeOfficeScopeOptions(officeMap, accessContext.permissionFilters),
  };
}

export async function loadDashboardReport(accessContext, query = {}, options = {}) {
  const now = options.now || new Date();
  const tabConfig = options.tabConfig || getTabConfig("leads");
  const infoAgentsTabConfig = options.infoAgentsTabConfig || getTabConfig("infoAgents");
  const reportMode = String(query.reportMode || "monthly").trim().toLowerCase();
  const specificType = String(query.specificType || "builder").trim().toLowerCase();
  const officeMap = await getOfficeMonthMap().catch(() => ({
    offices: [],
    byOffice: {},
  }));
  const requestedOfficeScopes = parseCsvSelection(query.officeScope);
  const allowedOfficeScopes = normalizeOfficeScopeOptions(officeMap, accessContext.permissionFilters);
  if (requestedOfficeScopes.length && requestedOfficeScopes.some((office) => !allowedOfficeScopes.includes(office))) {
    throw new Error("Please select only allowed offices.");
  }
  const selectedOfficeScopes = (requestedOfficeScopes.length ? requestedOfficeScopes : allowedOfficeScopes.slice(0, 1)).filter(
    (office) => allowedOfficeScopes.includes(office),
  );
  if (!selectedOfficeScopes.length) {
    throw new Error("Please select an allowed office to continue.");
  }
  const primaryOfficeScope = selectedOfficeScopes[0];
  const officeScope = selectedOfficeScopes.join(",");
  const requestedGroupField = DASHBOARD_GROUP_FIELD_MAP[String(query.groupBy || "").trim()] || "agentNames";
  const rawMonthRecords = mergedMonthRecords(officeMap);
  const scopedMonthRecords = selectedOfficeScopes
    .flatMap((office) =>
      collectOfficeScopedMonthRecords(officeMap, office).map((record) => ({
        ...record,
        office_name: office,
      })),
    )
    .filter((record) => record.active !== false)
    .sort((left, right) => String(right.key || "").localeCompare(String(left.key || "")));
  const monthOptionsSource = scopedMonthRecords.length ? scopedMonthRecords : rawMonthRecords;
  const monthOptionsByKey = new Map();
  for (const record of monthOptionsSource) {
    const key = String(record.key || "");
    if (!key || monthOptionsByKey.has(key)) {
      continue;
    }
    monthOptionsByKey.set(key, record);
  }
  const monthOptions = [...monthOptionsByKey.values()].map(formatMonthOption);
  const requestedMonthKeys = parseCsvSelection(query.monthKey);
  const fallbackMonthKey =
    monthOptions[0]?.key || resolveMonthRecord("", primaryOfficeScope, officeMap, now)?.key || "";
  const selectedMonthKeys = uniqueSelection((requestedMonthKeys.length ? requestedMonthKeys : [fallbackMonthKey]).filter(Boolean));

  const monthRecord = resolveMonthRecord(selectedMonthKeys[0], primaryOfficeScope, officeMap, now);
  if (!monthRecord?.sheet_id) {
    throw new Error("No active month mapping found.");
  }

  const singleMonth = await readMonthData({
    monthRecord,
    officeScope: primaryOfficeScope,
    tabConfig,
    infoAgentsTabConfig,
    permissionFilters: accessContext.permissionFilters || {},
  });
  const monthFilter = monthFilterFromKey(monthRecord.key);
  const modeRows = applyDashboardFilters(singleMonth.rows, tabConfig, query, now);

  if (reportMode === "last4") {
    const primaryScopedMonthRecords = collectOfficeScopedMonthRecords(officeMap, primaryOfficeScope)
      .filter((record) => record.active !== false)
      .sort((left, right) => String(right.key || "").localeCompare(String(left.key || "")));
    const scopedMonths = primaryScopedMonthRecords.slice(0, 4);
    const monthsForMode = scopedMonths.length ? scopedMonths : rawMonthRecords.slice(0, 4);
    const monthData = await Promise.all(
      monthsForMode.map((monthItem) =>
        readMonthData({
          monthRecord: monthItem,
          officeScope: primaryOfficeScope,
          tabConfig,
          infoAgentsTabConfig,
          permissionFilters: accessContext.permissionFilters || {},
        }),
      ),
    );
    const latestStatusByAgent = deriveLatestStatusByAgent(monthData);

    const rowsByMonth = monthData.map(({ monthRecord: itemMonth, rows, infoContext }) => {
      const filteredMonthRows = applyDashboardFilters(rows, tabConfig, query, now);
      const thisMonthFilter = monthFilterFromKey(itemMonth.key);
      const summary = summaryWithTargets(filteredMonthRows, tabConfig, infoContext, thisMonthFilter, now);
      return {
        label: itemMonth.month_label,
        monthKey: itemMonth.key,
        totalLeads: summary.totalLeads,
        totalFtd: summary.totalFtd,
        ftdTarget: summary.ftdTarget,
        ftdTargetReach: summary.ftdTargetReach,
        cr: summary.cr,
        crTarget: summary.crTarget,
        crTargetReach: summary.crTargetReach,
        selfs: summary.selfs,
        lateFtd: summary.lateFtd,
      };
    });
    const matrix = buildLast4AgentMatrix(monthData, tabConfig, query, now, {
      latestStatusByAgent,
    });

    const summary = rollupSummaryFromRows(rowsByMonth);
    return {
      reportMode: "last4",
      specificType: "",
      tableType: "last4_matrix",
      month: {
        key: monthRecord.key,
        label: monthRecord.month_label,
        sheet_id: monthRecord.sheet_id,
        office_name: primaryOfficeScope,
      },
      summary,
      table: matrix.rows,
      monthBlocks: matrix.months,
      tableTitle: "Last 4 Months Agent Matrix",
      stats: buildDashboardStats(modeRows, tabConfig, singleMonth.infoContext, monthFilter, now),
      filters: {
        officeScope,
        date: String(query.date || "").trim(),
        hour: String(query.hour || "").trim(),
        desk: String(query.desk || "").trim(),
        country: String(query.country || "").trim(),
        brand: String(query.brand || "").trim(),
        campaign: String(query.campaign || "").trim(),
        subCampaign: String(query.subCampaign || "").trim(),
        placement: String(query.placement || "").trim(),
        status: String(query.status || "").trim(),
        teamLeader: String(query.teamLeader || "").trim(),
        agent: String(query.agent || "").trim(),
        groupBy: requestedGroupField,
        totalDimensions: String(query.totalDimensions || "").trim(),
        columnDimension: String(query.columnDimension || "").trim(),
        includeWorkTime: String(query.includeWorkTime || "").trim(),
      },
      options: {
        ...baseOptions({
          rows: singleMonth.rows,
          tabConfig,
          query,
          officeMap,
          permissionFilters: accessContext.permissionFilters || {},
          now,
          monthOptions,
        }),
      },
    };
  }

  const selectedMonthRecords = selectedOfficeScopes
    .flatMap((office) => {
      const officeRecords = collectOfficeScopedMonthRecords(officeMap, office)
        .filter((record) => record.active !== false)
        .sort((left, right) => String(right.key || "").localeCompare(String(left.key || "")));
      const effectiveMonthKeys = selectedMonthKeys.length ? selectedMonthKeys : [officeRecords[0]?.key].filter(Boolean);
      return effectiveMonthKeys
        .map((monthKey) => {
          const matched = officeRecords.find((record) => String(record.key || "") === String(monthKey || ""));
          return matched
            ? {
                ...matched,
                office_name: office,
              }
            : null;
        })
        .filter(Boolean);
    })
    .filter(Boolean);
  if (!selectedMonthRecords.length) {
    throw new Error("No active month mapping found for selected office/month.");
  }
  const selectedMonthData = await Promise.all(
    selectedMonthRecords.map((record) =>
      readMonthData({
        monthRecord: record,
        officeScope: record.office_name || primaryOfficeScope,
        tabConfig,
        infoAgentsTabConfig,
        permissionFilters: accessContext.permissionFilters || {},
      }),
    ),
  );
  const combinedRows = selectedMonthData.flatMap((item) => item.rows || []);
  const combinedInfoContext = mergeInfoContexts(selectedMonthData.map((item) => item.infoContext));
  combinedInfoContext.latestStatusByAgent = deriveLatestStatusByAgent(selectedMonthData);
  const combinedMonthFilter = selectedMonthKeys.length === 1 ? monthFilterFromKey(selectedMonthKeys[0]) : null;
  const modeRowsCombined = applyDashboardFilters(combinedRows, tabConfig, query, now);

  const summary = summaryWithTargets(modeRowsCombined, tabConfig, combinedInfoContext, combinedMonthFilter, now);
  let table = pivotTableRows(modeRowsCombined, tabConfig, combinedInfoContext, combinedMonthFilter, now);
  let tableType = "pivot";
  let tableTitle = "Pivot CRM Table";
  let builder = null;

  if (reportMode === "specific") {
    builder = specificBuilderTable(modeRowsCombined, tabConfig, combinedInfoContext, combinedMonthFilter, query, now);
    table = builder.table;
    tableType = "builder";
    tableTitle = "Specific Report Builder";
  } else if (requestedGroupField !== "agentNames") {
    table = groupTable(modeRowsCombined, tabConfig, combinedInfoContext, combinedMonthFilter, requestedGroupField, now);
    tableType = "simple";
    tableTitle = `Grouped by ${String(query.groupBy || "Agent")}`;
  }

  const selectedMonthLabel =
    selectedMonthKeys.length === 1
      ? monthOptions.find((item) => item.key === selectedMonthKeys[0])?.month_label || monthRecord.month_label
      : `${selectedMonthKeys.length} Months`;
  const selectedOfficeLabel = selectedOfficeScopes.length === 1 ? selectedOfficeScopes[0] : `${selectedOfficeScopes.length} Offices`;
  const useFastOptions = reportMode === "specific" && selectedMonthRecords.length > 2;

  return {
    reportMode: reportMode === "specific" ? "specific" : "monthly",
    specificType: reportMode === "specific" ? "builder" : "",
    tableType,
    month: {
      key: selectedMonthKeys.join(",") || monthRecord.key,
      label: selectedMonthLabel,
      sheet_id: selectedMonthRecords[0]?.monthRecord?.sheet_id || selectedMonthRecords[0]?.sheet_id || monthRecord.sheet_id,
      office_name: selectedOfficeLabel,
    },
    summary: {
      totalLeads: summary.totalLeads,
      totalFtd: summary.totalFtd,
      cr: summary.cr,
      crTarget: summary.crTarget,
      crTargetReach: summary.crTargetReach,
      selfs: summary.selfs,
      lateFtd: summary.lateFtd,
      ftdTarget: summary.ftdTarget,
      ftdTargetReach: summary.ftdTargetReach,
    },
    table,
    tableTitle,
    builder,
    stats: buildDashboardStats(modeRowsCombined, tabConfig, combinedInfoContext, combinedMonthFilter, now),
    filters: {
      officeScope,
      date: String(query.date || "").trim(),
      hour: String(query.hour || "").trim(),
      desk: String(query.desk || "").trim(),
      country: String(query.country || "").trim(),
      brand: String(query.brand || "").trim(),
      campaign: String(query.campaign || "").trim(),
      subCampaign: String(query.subCampaign || "").trim(),
      placement: String(query.placement || "").trim(),
      status: String(query.status || "").trim(),
      teamLeader: String(query.teamLeader || "").trim(),
      agent: String(query.agent || "").trim(),
      groupBy: requestedGroupField,
      totalDimensions: String(query.totalDimensions || "").trim(),
      columnDimension: String(query.columnDimension || "").trim(),
      includeWorkTime: String(query.includeWorkTime || "").trim(),
    },
    options: {
      ...(useFastOptions
        ? fastBaseOptionsFromRows({
            rows: modeRowsCombined,
            tabConfig,
            officeMap,
            permissionFilters: accessContext.permissionFilters || {},
            monthOptions,
          })
        : baseOptions({
            rows: combinedRows,
            tabConfig,
            query,
            officeMap,
            permissionFilters: accessContext.permissionFilters || {},
            now,
            monthOptions,
          })),
      builderDimensions: SPECIFIC_DIMENSIONS.map((item) => ({ key: item.key, label: item.label, type: item.type })),
      builderMetrics: SPECIFIC_METRICS.map((item) => ({ key: item.key, label: item.label, type: item.type })),
      builderColumnDimensions: [
        { key: "month", label: "Months", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "hour", label: "Hour", type: "hour" },
      ],
    },
  };
}
