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
  { key: "ftd", label: "FTD", type: "number" },
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
  const normalizedDate = String(query.date || "").trim();
  const normalizedHour = String(query.hour || "").trim();
  const resolvedHour = Number.parseInt(normalizedHour.split(":")[0], 10);
  const normalizedCountry = parseCsvSelection(query.country);
  const normalizedTeamLeader = parseCsvSelection(query.teamLeader);
  const normalizedAgent = parseCsvSelection(query.agent);
  return {
    ...(canInclude("desk") && query.desk ? { office: query.desk } : {}),
    ...(canInclude("country") && normalizedCountry.length ? { country: normalizedCountry } : {}),
    ...(canInclude("brand") && query.brand ? { brand: query.brand } : {}),
    ...(canInclude("campaign") && query.campaign ? { campaign: query.campaign } : {}),
    ...(canInclude("subCampaign") && query.subCampaign ? { subCampaign: query.subCampaign } : {}),
    ...(canInclude("placement") && query.placement ? { placement: query.placement } : {}),
    ...(canInclude("status") && query.status ? { status: query.status } : {}),
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
  return filteredRows(rows, tabConfig, queryFilterObject(query, { include }), now);
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
    const desk = String(getRowValue(row, deskField) || row.__scopeOfficeName || "").trim();
    const teamLeader = String(getRowValue(row, teamLeaderField) || "").trim();
    const agent = String(getRowValue(row, agentField) || "").trim();
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
  const rowsWithScope = mapRowsWithScope(rawRows, officeScope || monthRecord.office_name || "");
  const permissionRows = filterRowsByPermission(rowsWithScope, tabConfig, permissionFilters || {});
  let infoRows = [];
  try {
    infoRows = await readSheetRows("infoAgents", {
      tabConfig: infoAgentsTabConfig,
      spreadsheetId: monthRecord.sheet_id,
    });
    infoRows = mapRowsWithScope(infoRows, officeScope || monthRecord.office_name || "");
  } catch {
    infoRows = [];
  }
  const leadAgentField = getFieldName(tabConfig, "agentNames");
  const allowedAgents = new Set(
    permissionRows
      .map((row) => normalizeAgentName(getRowValue(row, leadAgentField)))
      .filter(Boolean),
  );
  const infoContext = buildInfoAgentsContext(filterInfoRowsByAllowedAgents(infoRows, infoAgentsTabConfig, allowedAgents));
  return {
    monthRecord,
    rows: permissionRows,
    infoContext,
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
const DEFAULT_SPECIFIC_METRICS = ["leads", "leadShare", "ftd", "ftdTarget", "ftdTargetReach", "cr", "crTarget", "crTargetReach"];
const DEFAULT_SPECIFIC_TOTAL_DIMENSIONS = [];

function parseCsvSelection(value) {
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
  const value = String(getRowValue(row, fieldName) || "").trim();
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
  const totalDimensionKeys = selectedSpecificTotalDimensions(
    query,
    orderedDimensions.map((dimension) => dimension.key),
  );
  const totalDimensionSet = new Set(totalDimensionKeys);
  const metrics = metricKeys.map((key) => SPECIFIC_METRIC_BY_KEY.get(key)).filter(Boolean);
  const includeLeadShare = metrics.some((metric) => metric.key === "leadShare");
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
      const summary = summaryWithTargets(
        entry.rows,
        tabConfig,
        infoContext,
        monthFilter,
        now,
        targetScopeFromDimensionValues(entry.values),
      );
      const metricValues = metricValuesFromSummary(summary);
      const payload = {};
      for (const dimension of orderedDimensions) {
        payload[dimension.key] = entry.values[dimension.key] || "-";
      }
      for (const metric of metrics) {
        if (metric.key === "leadShare") {
          continue;
        }
        payload[metric.key] = Number(metricValues[metric.key] || 0);
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
        const summary = summaryWithTargets(
          group.rows,
          tabConfig,
          infoContext,
          monthFilter,
          now,
          targetScopeFromDimensionValues(group.values),
        );
        const metricValues = metricValuesFromSummary(summary);
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
          payload[metric.key] = Number(metricValues[metric.key] || 0);
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
    ],
    selectedDimensions: dimensionKeys,
    selectedMetrics: metricKeys,
    selectedTotalDimensions: totalDimensionKeys,
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

function buildLast4AgentMatrix(monthData = [], tabConfig, query = {}, now = new Date()) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const deskField = getFieldName(tabConfig, "office");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
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
    const parsed = parseDateValue(value);
    if (!parsed) {
      return "";
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
      const desk = String(getRowValue(row, deskField) || row.__scopeOfficeName || "").trim();
      const teamLeader = String(getRowValue(row, teamLeaderField) || "").trim();
      const agent = String(getRowValue(row, agentField) || "").trim() || normalizedAgent;
      ensureAgent(normalizedAgent, { desk, teamLeader, agent });
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
  const officeScope = String(query.officeScope || "").trim();
  const allowedOfficeScopes = normalizeOfficeScopeOptions(officeMap, accessContext.permissionFilters);
  if (!officeScope || !allowedOfficeScopes.includes(officeScope)) {
    throw new Error("Please select an allowed office to continue.");
  }

  const monthRecord = resolveMonthRecord(query.monthKey, officeScope, officeMap, now);
  if (!monthRecord?.sheet_id) {
    throw new Error("No active month mapping found.");
  }

  const singleMonth = await readMonthData({
    monthRecord,
    officeScope,
    tabConfig,
    infoAgentsTabConfig,
    permissionFilters: accessContext.permissionFilters || {},
  });
  const monthFilter = monthFilterFromKey(monthRecord.key);
  const modeRows = applyDashboardFilters(singleMonth.rows, tabConfig, query, now);
  const requestedGroupField = DASHBOARD_GROUP_FIELD_MAP[String(query.groupBy || "").trim()] || "agentNames";
  const rawMonthRecords = mergedMonthRecords(officeMap);
  const scopedMonthRecords = collectOfficeScopedMonthRecords(officeMap, officeScope)
    .filter((record) => record.active !== false)
    .sort((left, right) => String(right.key || "").localeCompare(String(left.key || "")));
  const monthOptions = (scopedMonthRecords.length ? scopedMonthRecords : rawMonthRecords).map(formatMonthOption);

  if (reportMode === "last4") {
    const scopedMonths = scopedMonthRecords.slice(0, 4);
    const monthsForMode = scopedMonths.length ? scopedMonths : rawMonthRecords.slice(0, 4);
    const monthData = await Promise.all(
      monthsForMode.map((monthItem) =>
        readMonthData({
          monthRecord: monthItem,
          officeScope,
          tabConfig,
          infoAgentsTabConfig,
          permissionFilters: accessContext.permissionFilters || {},
        }),
      ),
    );

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
    const matrix = buildLast4AgentMatrix(monthData, tabConfig, query, now);

    const summary = rollupSummaryFromRows(rowsByMonth);
    return {
      reportMode: "last4",
      specificType: "",
      tableType: "last4_matrix",
      month: {
        key: monthRecord.key,
        label: monthRecord.month_label,
        sheet_id: monthRecord.sheet_id,
        office_name: officeScope,
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

  const summary = summaryWithTargets(modeRows, tabConfig, singleMonth.infoContext, monthFilter, now);
  let table = pivotTableRows(modeRows, tabConfig, singleMonth.infoContext, monthFilter, now);
  let tableType = "pivot";
  let tableTitle = "Pivot CRM Table";
  let builder = null;

  if (reportMode === "specific") {
    builder = specificBuilderTable(modeRows, tabConfig, singleMonth.infoContext, monthFilter, query, now);
    table = builder.table;
    tableType = "builder";
    tableTitle = "Specific Report Builder";
  } else if (requestedGroupField !== "agentNames") {
    table = groupTable(modeRows, tabConfig, singleMonth.infoContext, monthFilter, requestedGroupField, now);
    tableType = "simple";
    tableTitle = `Grouped by ${String(query.groupBy || "Agent")}`;
  }

  return {
    reportMode: reportMode === "specific" ? "specific" : "monthly",
    specificType: reportMode === "specific" ? "builder" : "",
    tableType,
    month: {
      key: monthRecord.key,
      label: monthRecord.month_label,
      sheet_id: monthRecord.sheet_id,
      office_name: monthRecord.office_name || officeScope || "",
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
      builderDimensions: SPECIFIC_DIMENSIONS.map((item) => ({ key: item.key, label: item.label, type: item.type })),
      builderMetrics: SPECIFIC_METRICS.map((item) => ({ key: item.key, label: item.label, type: item.type })),
    },
  };
}
