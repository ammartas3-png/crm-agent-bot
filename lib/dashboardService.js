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
  placement: "placement",
  teamLeader: "teamLeader",
  agent: "agentNames",
};

const FILTER_TO_FIELD = {
  desk: "office",
  country: "country",
  brand: "brand",
  campaign: "campaign",
  placement: "placement",
  status: "status",
  teamLeader: "teamLeader",
  agent: "agentNames",
};

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
  return {
    ...(canInclude("desk") && query.desk ? { office: query.desk } : {}),
    ...(canInclude("country") && query.country ? { country: query.country } : {}),
    ...(canInclude("brand") && query.brand ? { brand: query.brand } : {}),
    ...(canInclude("campaign") && query.campaign ? { campaign: query.campaign } : {}),
    ...(canInclude("placement") && query.placement ? { placement: query.placement } : {}),
    ...(canInclude("status") && query.status ? { status: query.status } : {}),
    ...(canInclude("teamLeader") && query.teamLeader ? { teamLeader: query.teamLeader } : {}),
    ...(canInclude("agent") && query.agent ? { agent: query.agent, agentField: "agentNames" } : {}),
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
      const summary = summaryWithTargets(entry.rows, tabConfig, infoContext, dateFilter, now);
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
    placements: optionValuesByField(rows, tabConfig, query, "placement", now),
    statuses: optionValuesByField(rows, tabConfig, query, "status", now),
    teamLeaders: optionValuesByField(rows, tabConfig, query, "teamLeader", now),
    agents: optionValuesByField(rows, tabConfig, query, "agent", now),
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
  if (query.desk && normalizeText(query.desk) !== normalizeText(desk)) {
    return false;
  }
  if (query.teamLeader && normalizeText(query.teamLeader) !== normalizeText(teamLeader)) {
    return false;
  }
  if (query.agent && normalizeText(query.agent) !== normalizeText(agent)) {
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
  const specificType = String(query.specificType || "hourly").trim().toLowerCase();
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
        desk: String(query.desk || "").trim(),
        country: String(query.country || "").trim(),
        brand: String(query.brand || "").trim(),
        campaign: String(query.campaign || "").trim(),
        placement: String(query.placement || "").trim(),
        status: String(query.status || "").trim(),
        teamLeader: String(query.teamLeader || "").trim(),
        agent: String(query.agent || "").trim(),
        groupBy: requestedGroupField,
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

  if (reportMode === "specific") {
    if (specificType === "best_agents") {
      table = specificBestAgentsTable(modeRows, tabConfig, monthFilter, now);
      tableTitle = "Specific Report: Best Agents";
      tableType = "simple";
    } else {
      table = specificHourlyTable(modeRows, tabConfig, monthFilter, now);
      tableTitle = "Specific Report: Hourly FTD";
      tableType = "simple";
    }
  } else if (requestedGroupField !== "agentNames") {
    table = groupTable(modeRows, tabConfig, singleMonth.infoContext, monthFilter, requestedGroupField, now);
    tableType = "simple";
    tableTitle = `Grouped by ${String(query.groupBy || "Agent")}`;
  }

  return {
    reportMode: reportMode === "specific" ? "specific" : "monthly",
    specificType: reportMode === "specific" ? specificType : "",
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
    stats: buildDashboardStats(modeRows, tabConfig, singleMonth.infoContext, monthFilter, now),
    filters: {
      officeScope,
      desk: String(query.desk || "").trim(),
      country: String(query.country || "").trim(),
      brand: String(query.brand || "").trim(),
      campaign: String(query.campaign || "").trim(),
      placement: String(query.placement || "").trim(),
      status: String(query.status || "").trim(),
      teamLeader: String(query.teamLeader || "").trim(),
      agent: String(query.agent || "").trim(),
      groupBy: requestedGroupField,
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
