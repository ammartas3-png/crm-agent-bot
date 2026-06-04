import { getTabConfig } from "../config/sheetsConfig.js";
import {
  calculateSummary,
  filterRowsByPermission,
  filteredRows,
  getFieldName,
  getRowValue,
  normalizeText,
  uniqueValues,
} from "./calculations.js";
import { resolveAuthorityScopeForUser } from "./authorityScope.js";
import { readSheetRows } from "./googleSheets.js";
import { getOfficeMonthMap } from "./officeMappings.js";
import { currentMonthKey, getMonthFile, listMonthFiles, monthFilterFromKey } from "./monthlyReports.js";
import { isAdminTelegramUser, isAllowedTelegramUser } from "./permissions.js";

const DASHBOARD_GROUP_FIELD_MAP = {
  desk: "office",
  office: "office",
  country: "country",
  brand: "campaign",
  teamLeader: "teamLeader",
  agent: "agentNames",
  campaign: "campaign",
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

function parseBrandField(rows = []) {
  const sample = rows.find((row) => row && typeof row === "object");
  if (!sample) {
    return "";
  }
  const entries = Object.keys(sample);
  const matched = entries.find((key) => normalizeText(key) === "brand");
  return matched || "";
}

function rowsForBrandFilter(rows = [], brandField = "", selectedBrand = "") {
  const normalizedSelectedBrand = normalizeText(selectedBrand);
  if (!brandField || !normalizedSelectedBrand) {
    return rows;
  }
  return rows.filter((row) => normalizeText(getRowValue(row, brandField)) === normalizedSelectedBrand);
}

function uniqueStringValues(rows = [], fieldName = "") {
  if (!fieldName) {
    return [];
  }
  return [...new Set(rows.map((row) => String(getRowValue(row, fieldName) || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
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

function mapRowsWithScope(rows = [], officeScope = "") {
  const scopeName = String(officeScope || "").trim();
  return rows.map((row) => ({
    ...row,
    __scopeOfficeName: scopeName || String(row.__scopeOfficeName || "").trim(),
  }));
}

function queryFilterObject(query = {}) {
  return {
    ...(query.desk ? { office: query.desk } : {}),
    ...(query.country ? { country: query.country } : {}),
    ...(query.teamLeader ? { teamLeader: query.teamLeader } : {}),
    ...(query.agent ? { agent: query.agent, agentField: "agentNames" } : {}),
    ...(query.campaign ? { campaign: query.campaign } : {}),
  };
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
    months,
    defaultMonthKey: month?.key || months[0]?.key || "",
    officeScopes: normalizeOfficeScopeOptions(officeMap, accessContext.permissionFilters),
  };
}

export async function loadDashboardReport(accessContext, query = {}, options = {}) {
  const now = options.now || new Date();
  const tabConfig = options.tabConfig || getTabConfig("leads");
  const officeMap = await getOfficeMonthMap().catch(() => ({
    offices: [],
    byOffice: {},
  }));
  const officeScope = String(query.officeScope || "").trim();
  const allowedOfficeScopes = normalizeOfficeScopeOptions(officeMap, accessContext.permissionFilters);
  if (officeScope && allowedOfficeScopes.length && !allowedOfficeScopes.includes(officeScope)) {
    throw new Error("Selected office is outside your access scope.");
  }
  const monthRecord = resolveMonthRecord(query.monthKey, officeScope, officeMap, now);
  if (!monthRecord?.sheet_id) {
    throw new Error("No active month mapping found.");
  }
  const rawRows = await readSheetRows("leads", {
    tabConfig,
    spreadsheetId: monthRecord.sheet_id,
  });
  const rowsWithScope = mapRowsWithScope(rawRows, officeScope || monthRecord.office_name || "");
  const permissionRows = filterRowsByPermission(rowsWithScope, tabConfig, accessContext.permissionFilters || {});
  const standardFilters = queryFilterObject(query);
  const filteredStandardRows = filteredRows(permissionRows, tabConfig, standardFilters, now);
  const brandField = parseBrandField(filteredStandardRows.length ? filteredStandardRows : permissionRows);
  const rowsAfterBrand = rowsForBrandFilter(filteredStandardRows, brandField, query.brand);
  const dateFilter = monthFilterFromKey(monthRecord.key);
  const summary = calculateSummary(rowsAfterBrand, tabConfig, { date: dateFilter }, now);

  const requestedGroupField = DASHBOARD_GROUP_FIELD_MAP[String(query.groupBy || "").trim()] || "agentNames";
  const groupRows = groupRowsByField(rowsAfterBrand, tabConfig, requestedGroupField);
  const grouped = [...groupRows.entries()]
    .map(([label, entries]) => {
      const groupSummary = calculateSummary(entries, tabConfig, { date: dateFilter }, now);
      return {
        label,
        totalLeads: groupSummary.totalLeads,
        totalFtd: groupSummary.totalFtd,
        cr: groupSummary.cr,
        crTarget: groupSummary.crTarget,
        crTargetReach: groupSummary.crTargetReach,
        selfs: groupSummary.selfs,
        lateFtd: groupSummary.lateFtd,
      };
    })
    .sort(
      (left, right) =>
        right.totalLeads - left.totalLeads ||
        right.totalFtd - left.totalFtd ||
        right.cr - left.cr ||
        left.label.localeCompare(right.label),
    );

  const optionsRows = filterRowsByPermission(rowsWithScope, tabConfig, accessContext.permissionFilters || {});
  return {
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
    },
    table: grouped,
    filters: {
      officeScope: officeScope || "",
      desk: String(query.desk || "").trim(),
      country: String(query.country || "").trim(),
      brand: String(query.brand || "").trim(),
      teamLeader: String(query.teamLeader || "").trim(),
      agent: String(query.agent || "").trim(),
      groupBy: requestedGroupField,
    },
    options: {
      officeScopes: normalizeOfficeScopeOptions(officeMap, accessContext.permissionFilters),
      desks: uniqueValues(optionsRows, tabConfig, "office"),
      countries: uniqueValues(optionsRows, tabConfig, "country"),
      teamLeaders: uniqueValues(optionsRows, tabConfig, "teamLeader"),
      agents: uniqueValues(optionsRows, tabConfig, "agentNames"),
      campaigns: uniqueValues(optionsRows, tabConfig, "campaign"),
      brands: brandField ? uniqueStringValues(optionsRows, brandField) : [],
      months: mergedMonthRecords(officeMap).map((record) => ({
        key: record.key,
        month_label: record.month_label,
        office_name: record.office_name || "",
      })),
    },
  };
}
