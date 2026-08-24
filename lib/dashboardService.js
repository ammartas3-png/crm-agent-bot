import { getTabConfig } from "../config/sheetsConfig.js";
import {
  calculateSummary,
  dateMatches,
  filterRowsByPermission,
  filteredRows,
  getFieldName,
  getRowValue,
  groupPerformance,
  hourlyDistribution,
  normalizeText,
  parseDateValue,
  toPercentNumber,
  uniqueValues,
} from "./calculations.js";
import {
  isLegacyOffice,
  legacyAgentsForOfficeMonth,
  legacyMonthKeys,
} from "./legacyOfficeData.js";
import { resolveAuthorityScopeForUser } from "./authorityScope.js";
import { getGoogleCredentialConfig, readSheetRows, readSheetValues, updateSheetValues } from "./googleSheets.js";
import { loadAuxiliaryRows, readDashboardSheetRows, shouldUseIngestForDashboard } from "./dataProvider.js";
import {
  OFFICE_AGENT_ROSTER_SPREADSHEET_ID,
  officeAgentRosterTabConfig,
  officeDeskLanguageTabConfig,
  rosterTabNameForOffice,
} from "./rosterConfig.js";
import { getOfficeMonthMap } from "./officeMappings.js";
import { currentMonthKey, getMonthFile, listMonthFiles, monthFilterFromKey } from "./monthlyReports.js";
import { isAdminTelegramUser, isAllowedTelegramUser } from "./permissions.js";
import { buildInfoAgentsContext, normalizeAgentName, targetAggregationForScope, targetReachPercent } from "./targets.js";
import {
  TRAFFIC_BLOCK_WINDOW_DAYS,
  TRAFFIC_MIN_SEGMENT_LEADS,
  TRAFFIC_WINDOW_DAYS,
  TRAFFIC_DEFAULT_COUNT,
} from "./trafficPriority.js";

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
  { key: "created", label: "Created", type: "text", fieldKey: "created" },
  { key: "id", label: "ID", type: "text", fieldKey: "id" },
  { key: "department", label: "Department", type: "text", fieldKey: "department" },
  { key: "desk", label: "Desk", type: "text", fieldKey: "office" },
  { key: "teamLeader", label: "Team Leader", type: "text", fieldKey: "teamLeader" },
  { key: "agent", label: "Agent", type: "text", fieldKey: "agentNames" },
  { key: "status", label: "Status", type: "text", fieldKey: "status" },
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
  { key: "kycFtd", label: "KYC FTD", type: "number" },
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
  { key: "lateFtdRate", label: "Late FTD / FTD", type: "percent" },
  { key: "ftdTargetByCr", label: "FTD Target by CR", type: "number" },
  { key: "missingFtd", label: "Missing FTD", type: "number" },
];

const SPECIFIC_DIMENSION_BY_KEY = new Map(SPECIFIC_DIMENSIONS.map((item) => [item.key, item]));
const SPECIFIC_METRIC_BY_KEY = new Map(SPECIFIC_METRICS.map((item) => [item.key, item]));
const BUILDER_EXTRA_METRIC_KEYS = new Set([
  "agentCount",
  "avgLeadByAgent",
  "avgLeadByAgentDaily",
  "avgFtdByAgent",
  "avgFtdByAgentDaily",
  "agentAvgFtdPerWorkedMonth",
  "avgFtdByDeskLongTerm",
  "ftdBenchmarkRate",
]);
const COLUMN_GRAND_TOTAL_KEY = "__grand_total__";
const EXCLUDED_AGENT_PREFIXES = ["trself"];
const SELF_AGENT_TOKEN_PATTERN = /(^|[^a-z0-9])self([^a-z0-9]|$)/;
const DESK_LANGUAGE_SPLIT_REGEX = /[,\n\r;|]+/;
const DESK_LANGUAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const REPORT_MAX_SAFE_DURATION_MS = Math.max(
  0,
  Number(process.env.REPORT_MAX_SAFE_DURATION_MS || 8 * 60 * 1000),
);
const REPORT_MAX_RESPONSE_ROWS = 2000;

let deskLanguageMapCache = null;

function isGooglePermissionDeniedError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("caller does not have permission") ||
    message.includes("permission denied") ||
    message.includes("insufficient permissions") ||
    message.includes("403")
  );
}

function reportTooHeavyError(message, stage = "") {
  const error = new Error(message || "Selected report is too heavy to process.");
  error.code = "report_too_heavy";
  error.stage = stage;
  return error;
}

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
  if (SELF_AGENT_TOKEN_PATTERN.test(normalized)) {
    return true;
  }
  return EXCLUDED_AGENT_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `));
}

function filterExcludedAgentRows(rows = [], tabConfig) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  return rows.filter((row) => {
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    const normalizedTeamLeader = normalizeAgentName(getRowValue(row, teamLeaderField));
    if (!normalizedAgent && !normalizedTeamLeader) {
      return false;
    }
    if (isExcludedNormalizedAgent(normalizedAgent)) {
      return false;
    }
    if (!normalizedAgent && isExcludedNormalizedAgent(normalizedTeamLeader)) {
      return false;
    }
    return true;
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

function splitDeskLanguageValues(value = "") {
  return String(value || "")
    .split(DESK_LANGUAGE_SPLIT_REGEX)
    .map((item) => cleanSpreadsheetText(item))
    .filter(Boolean);
}

function buildDeskLanguageMap(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const desk = cleanSpreadsheetText(row?.Desk || row?.desk || "");
    const normalizedDesk = normalizeText(desk);
    if (!normalizedDesk) {
      continue;
    }
    const languages = splitDeskLanguageValues(row?.Lang || row?.lang || "");
    if (!languages.length) {
      continue;
    }
    if (!map.has(normalizedDesk)) {
      map.set(normalizedDesk, new Set());
    }
    const bucket = map.get(normalizedDesk);
    for (const language of languages) {
      const normalizedLanguage = normalizeText(language);
      if (normalizedLanguage) {
        bucket.add(normalizedLanguage);
      }
    }
  }
  return map;
}

function selectDeskLongTermBenchmarkValues(entry = {}) {
  const lessThanTwoMonthsRaw = Number(entry?.avgFtdByLongTerm?.[LONG_TERM_BUCKET_LESS_THAN_2] || 0);
  const moreThanTwoMonthsRaw = Number(entry?.avgFtdByLongTerm?.[LONG_TERM_BUCKET_MORE_THAN_2] || 0);
  const fallbackAverage = Number(entry?.avgFtdByAgent || 0);
  const lessThanTwoMonths = lessThanTwoMonthsRaw > 0 ? lessThanTwoMonthsRaw : moreThanTwoMonthsRaw > 0 ? moreThanTwoMonthsRaw : fallbackAverage;
  const moreThanTwoMonths = moreThanTwoMonthsRaw > 0 ? moreThanTwoMonthsRaw : lessThanTwoMonthsRaw > 0 ? lessThanTwoMonthsRaw : fallbackAverage;
  return {
    lessThanTwoMonths: lessThanTwoMonths > 0 ? lessThanTwoMonths : 0,
    moreThanTwoMonths: moreThanTwoMonths > 0 ? moreThanTwoMonths : 0,
  };
}

const DESK_LANGUAGE_LESS_THAN_COLUMN_KEYS = new Set([
  "lessthan2months",
  "lessthan2month",
  "lessthanmonths",
  "lessthanmonth",
  "lessthantwomonths",
]);

const DESK_LANGUAGE_MORE_THAN_COLUMN_KEYS = new Set([
  "morethan2months",
  "morethan2month",
  "morethanmonths",
  "morethanmonth",
  "morethantwomonths",
]);

function normalizeDeskLanguageColumnKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function readDeskLanguageBenchmarkCell(row = {}, columnKeySet = new Set(), fallbackProperty = "") {
  const fallbackValue = row?.[fallbackProperty];
  if (fallbackValue !== undefined && fallbackValue !== null && String(fallbackValue).trim() !== "") {
    return fallbackValue;
  }
  for (const [key, value] of Object.entries(row || {})) {
    if (!columnKeySet.has(normalizeDeskLanguageColumnKey(key))) {
      continue;
    }
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function resolveLongTermBenchmarkFromCache(entry = null, longTermBucket = LONG_TERM_BUCKET_UNKNOWN) {
  if (typeof entry === "number") {
    return Number.isFinite(entry) ? Number(entry) : 0;
  }
  if (!entry || typeof entry !== "object") {
    return 0;
  }
  const lessThanTwoMonths = Number(entry.lessThanTwoMonths || 0);
  const moreThanTwoMonths = Number(entry.moreThanTwoMonths || 0);
  if (longTermBucket === LONG_TERM_BUCKET_MORE_THAN_2) {
    return moreThanTwoMonths > 0 ? moreThanTwoMonths : lessThanTwoMonths;
  }
  if (longTermBucket === LONG_TERM_BUCKET_LESS_THAN_2) {
    return lessThanTwoMonths > 0 ? lessThanTwoMonths : moreThanTwoMonths;
  }
  return moreThanTwoMonths > 0 ? moreThanTwoMonths : lessThanTwoMonths;
}

function buildDeskBenchmarkCache(rows = [], deskLanguageMap = new Map()) {
  const mergeBenchmarkValues = (previous = {}, incoming = {}) => {
    const prevLess = Number(previous?.lessThanTwoMonths || 0);
    const prevMore = Number(previous?.moreThanTwoMonths || 0);
    const nextLess = Number(incoming?.lessThanTwoMonths || 0);
    const nextMore = Number(incoming?.moreThanTwoMonths || 0);
    return {
      lessThanTwoMonths: nextLess > 0 ? (prevLess > 0 ? (prevLess + nextLess) / 2 : nextLess) : prevLess,
      moreThanTwoMonths: nextMore > 0 ? (prevMore > 0 ? (prevMore + nextMore) / 2 : nextMore) : prevMore,
    };
  };
  const map = new Map();
  for (const row of rows || []) {
    const lessThanTwoMonths = parseMetricNumber(
      readDeskLanguageBenchmarkCell(row, DESK_LANGUAGE_LESS_THAN_COLUMN_KEYS, "lessThanTwoMonths"),
    );
    const moreThanTwoMonths = parseMetricNumber(
      readDeskLanguageBenchmarkCell(row, DESK_LANGUAGE_MORE_THAN_COLUMN_KEYS, "moreThanMonths"),
    );
    const legacyBenchmark = parseMetricNumber(row?.Benchmark);
    const normalizedLessThanTwoMonths =
      lessThanTwoMonths !== null && lessThanTwoMonths > 0
        ? lessThanTwoMonths
        : moreThanTwoMonths !== null && moreThanTwoMonths > 0
          ? moreThanTwoMonths
          : legacyBenchmark;
    const normalizedMoreThanTwoMonths =
      moreThanTwoMonths !== null && moreThanTwoMonths > 0
        ? moreThanTwoMonths
        : lessThanTwoMonths !== null && lessThanTwoMonths > 0
          ? lessThanTwoMonths
          : legacyBenchmark;
    if (
      (normalizedLessThanTwoMonths === null || normalizedLessThanTwoMonths <= 0) &&
      (normalizedMoreThanTwoMonths === null || normalizedMoreThanTwoMonths <= 0)
    ) {
      continue;
    }
    const desk = cleanSpreadsheetText(row?.Desk || row?.desk || "");
    const language = cleanSpreadsheetText(row?.Lang || row?.lang || "");
    const benchmarkKey = resolveDeskLanguageBenchmarkKey({
      desk,
      country: language,
      deskLanguageMap,
    });
    if (!benchmarkKey) {
      continue;
    }
    const benchmarkValues = {
      lessThanTwoMonths: normalizedLessThanTwoMonths !== null && normalizedLessThanTwoMonths > 0
        ? normalizedLessThanTwoMonths
        : 0,
      moreThanTwoMonths: normalizedMoreThanTwoMonths !== null && normalizedMoreThanTwoMonths > 0
        ? normalizedMoreThanTwoMonths
        : 0,
    };
    map.set(benchmarkKey, mergeBenchmarkValues(map.get(benchmarkKey), benchmarkValues));
    const normalizedDesk = normalizeText(desk);
    if (normalizedDesk) {
      const deskKey = `desk:${normalizedDesk}`;
      map.set(deskKey, mergeBenchmarkValues(map.get(deskKey), benchmarkValues));
    }
  }
  return map;
}

async function readOfficeDeskLanguageSnapshot(options = {}) {
  const nowMs = Date.now();
  const forceRefresh = Boolean(options.forceRefresh);
  if (!forceRefresh && deskLanguageMapCache && nowMs - deskLanguageMapCache.timestamp < DESK_LANGUAGE_CACHE_TTL_MS) {
    return deskLanguageMapCache.value;
  }
  try {
    let rows = null;
    if (!forceRefresh && (await shouldUseIngestForDashboard())) {
      rows = await loadAuxiliaryRows({ category: "deskLanguage" });
    }
    if (rows === null) {
      rows = await readSheetRows("officeDeskLanguage", {
        tabConfig: officeDeskLanguageTabConfig(),
        spreadsheetId: OFFICE_AGENT_ROSTER_SPREADSHEET_ID,
        bypassCache: forceRefresh,
        cacheTtlMs: forceRefresh ? 0 : undefined,
      });
    }
    const deskLanguageMap = buildDeskLanguageMap(rows);
    const benchmarkCache = buildDeskBenchmarkCache(rows, deskLanguageMap);
    const snapshot = {
      rows,
      deskLanguageMap,
      benchmarkCache,
    };
    deskLanguageMapCache = {
      timestamp: nowMs,
      value: snapshot,
    };
    return snapshot;
  } catch {
    // Do NOT cache the empty fallback: a single transient Sheets failure would
    // otherwise pin benchmarks to 0.00% for the whole TTL even after Sheets
    // recovers. Returning without caching lets the next request retry.
    return {
      rows: [],
      deskLanguageMap: new Map(),
      benchmarkCache: new Map(),
    };
  }
}

async function readOfficeDeskLanguageMap() {
  const snapshot = await readOfficeDeskLanguageSnapshot();
  return snapshot.deskLanguageMap instanceof Map ? snapshot.deskLanguageMap : new Map();
}

function benchmarkValueForCell(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }
  return Number(numeric.toFixed(4));
}

function buildScopedMonthRecords(officeMap, officeScopes = [], selectedMonthKeys = []) {
  const uniqueMonthRecords = new Map();
  for (const office of officeScopes) {
    const officeRecords = collectOfficeScopedMonthRecords(officeMap, office).filter((record) => record.active !== false);
    const effectiveMonthKeys = selectedMonthKeys.length ? selectedMonthKeys : officeRecords.map((record) => String(record?.key || "").trim());
    for (const monthKey of effectiveMonthKeys) {
      const normalizedMonthKey = String(monthKey || "").trim();
      if (!normalizedMonthKey) {
        continue;
      }
      const matched = officeRecords.find((record) => String(record?.key || "") === normalizedMonthKey);
      if (!matched) {
        continue;
      }
      const uniqueKey = `${normalizeText(office)}::${normalizedMonthKey}`;
      if (!uniqueMonthRecords.has(uniqueKey)) {
        uniqueMonthRecords.set(uniqueKey, {
          ...matched,
          office_name: office,
        });
      }
    }
  }
  return [...uniqueMonthRecords.values()];
}

function buildInfoContextFromRosterRows(rosterRows = [], infoAgentsTabConfig) {
  const mergedInfoRows = mergedInfoRowsFromRoster(rosterRows, new Map());
  const filteredInfoRows = mergedInfoRows.filter((row) => {
    const normalized = normalizeAgentName(getRowValue(row, getFieldName(infoAgentsTabConfig, "agentName")));
    return !isExcludedNormalizedAgent(normalized);
  });
  const infoContext = buildInfoAgentsContext(filteredInfoRows);
  const allowedAgents = new Set(
    filteredInfoRows
      .map((row) => normalizeAgentName(getRowValue(row, getFieldName(infoAgentsTabConfig, "agentName"))))
      .filter(Boolean),
  );
  infoContext.endDateByAgent = collectAgentEndDateMap(filteredInfoRows, infoAgentsTabConfig, allowedAgents);
  return infoContext;
}

async function readLeadsRowsForBenchmarkBaseline({
  monthRecord,
  officeScope,
  tabConfig,
  officeRosterRows,
  onProgress = null,
}) {
  if (typeof onProgress === "function") {
    onProgress({
      step: "Loading Google Sheets",
      tab: "Leads",
      office: String(officeScope || monthRecord?.office_name || "").trim(),
      monthKey: String(monthRecord?.key || "").trim(),
      monthLabel: String(monthRecord?.month_label || monthRecord?.key || "").trim(),
      sheetId: String(monthRecord?.sheet_id || "").trim(),
    });
  }
  let rawRows = [];
  try {
    rawRows = await readDashboardSheetRows("leads", {
      tabConfig,
      spreadsheetId: monthRecord.sheet_id,
      office: officeScope || monthRecord.office_name || "",
      period: monthRecord.key || monthRecord.period || "",
    });
  } catch (error) {
    if (isGooglePermissionDeniedError(error)) {
      const serviceAccountEmail = getGoogleCredentialConfig().email;
      const officeLabel = String(officeScope || monthRecord.office_name || "").trim() || "selected office";
      const monthLabel = String(monthRecord.month_label || monthRecord.key || "").trim() || "selected month";
      throw new Error(
        `Google Sheet access denied for ${monthLabel} (${officeLabel}). ` +
          `Share that spreadsheet with ${serviceAccountEmail} and try again.`,
      );
    }
    throw error;
  }
  const rowsWithScope = mapRowsWithScope(
    mapRowsWithMonthSource(rawRows, monthRecord),
    officeScope || monthRecord.office_name || "",
  );
  const rosterProfileMap = rosterAgentProfileMapFromRows(Array.isArray(officeRosterRows) ? officeRosterRows : []);
  const aliasedRows = remapLeadRowsByRosterProfile(rowsWithScope, tabConfig, rosterProfileMap);
  return filterExcludedAgentRows(aliasedRows, tabConfig);
}

async function loadBenchmarkBaselineDataset({
  officeMap,
  officeScopes = [],
  selectedMonthKeys = [],
  tabConfig,
  infoAgentsTabConfig,
  rosterRowsByOffice,
  resolveOfficeRosterRows,
  onProgress = null,
}) {
  if (!officeScopes.length) {
    return {
      rows: [],
      infoContext: buildInfoContextFromRosterRows([], infoAgentsTabConfig),
      monthRecords: [],
    };
  }
  await Promise.all(officeScopes.map((office) => resolveOfficeRosterRows(office)));
  const monthRecords = buildScopedMonthRecords(officeMap, officeScopes, selectedMonthKeys);
  const monthRows = await Promise.all(
    monthRecords.map((record) =>
      readLeadsRowsForBenchmarkBaseline({
        monthRecord: record,
        officeScope: record.office_name,
        tabConfig,
        officeRosterRows: rosterRowsByOffice.get(record.office_name) || [],
        onProgress,
      }),
    ),
  );
  const rows = monthRows.flatMap((item) => item || []);
  const rosterRows = officeScopes.flatMap((office) => rosterRowsByOffice.get(office) || []);
  const infoContext = buildInfoContextFromRosterRows(rosterRows, infoAgentsTabConfig);
  return {
    rows,
    infoContext,
    monthRecords,
  };
}

export async function refreshOfficeDeskLanguageBenchmarks(options = {}) {
  const now = options.now || new Date();
  const tabConfig = options.tabConfig || getTabConfig("leads");
  const infoAgentsTabConfig = options.infoAgentsTabConfig || getTabConfig("infoAgents");
  const officeMap = await getOfficeMonthMap().catch(() => ({
    offices: [],
    byOffice: {},
  }));
  const offices = normalizeOfficeScopeOptions(officeMap, {});
  if (!offices.length) {
    throw new Error("No office mappings found for benchmark refresh.");
  }
  const rosterRowsByOffice = new Map();
  const resolveOfficeRosterRows = async (office = "") => {
    const normalizedOffice = String(office || "").trim();
    if (!normalizedOffice) {
      return [];
    }
    if (!rosterRowsByOffice.has(normalizedOffice)) {
      rosterRowsByOffice.set(normalizedOffice, await readOfficeAgentRosterRows(normalizedOffice));
    }
    return rosterRowsByOffice.get(normalizedOffice) || [];
  };
  const baselineDataset = await loadBenchmarkBaselineDataset({
    officeMap,
    officeScopes: offices,
    selectedMonthKeys: [],
    tabConfig,
    infoAgentsTabConfig,
    rosterRowsByOffice,
    resolveOfficeRosterRows,
  });
  const monthRecords = baselineDataset.monthRecords || [];
  if (!monthRecords.length) {
    throw new Error("No active month records found for benchmark refresh.");
  }
  const allRows = baselineDataset.rows || [];
  const mergedInfoContext = baselineDataset.infoContext;
  const languageSnapshot = await readOfficeDeskLanguageSnapshot({ forceRefresh: true });
  const languageRows = Array.isArray(languageSnapshot.rows) ? languageSnapshot.rows : [];
  const deskLanguageMap = languageSnapshot.deskLanguageMap instanceof Map ? languageSnapshot.deskLanguageMap : new Map();
  const deskAverages = buildDeskFtdAverages(allRows, tabConfig, mergedInfoContext, now, deskLanguageMap);
  const outputRows = languageRows.map((row) => {
    const desk = cleanSpreadsheetText(row?.Desk || row?.desk || "");
    const language = cleanSpreadsheetText(row?.Lang || row?.lang || "");
    const benchmarkKey = resolveDeskLanguageBenchmarkKey({
      desk,
      country: language,
      deskLanguageMap,
    });
    const benchmarkEntry = benchmarkKey ? deskAverages.get(benchmarkKey) : null;
    const benchmarkValues = selectDeskLongTermBenchmarkValues(benchmarkEntry || {});
    return [
      desk,
      language,
      benchmarkValueForCell(benchmarkValues.lessThanTwoMonths),
      benchmarkValueForCell(benchmarkValues.moreThanTwoMonths),
    ];
  });
  await updateSheetValues({
    spreadsheetId: OFFICE_AGENT_ROSTER_SPREADSHEET_ID,
    range: `'Language'!A:D`,
    values: [["Desk", "Lang", "LESS THAN 2 MONTHS", "MORE THAN 2 MONTHS"], ...outputRows],
    valueInputOption: "USER_ENTERED",
  });
  deskLanguageMapCache = null;
  return {
    officeCount: offices.length,
    monthCount: monthRecords.length,
    rowCount: allRows.length,
    updatedRows: outputRows.length,
  };
}

async function readOfficeAgentRosterRows(officeScope = "") {
  const tabName = rosterTabNameForOffice(officeScope);
  if (!tabName) {
    return [];
  }
  try {
    let rows = null;
    if (await shouldUseIngestForDashboard()) {
      rows = await loadAuxiliaryRows({ category: "roster", rosterTab: tabName });
    }
    if (rows === null) {
      rows = await readSheetRows("officeAgentRoster", {
        tabConfig: officeAgentRosterTabConfig(tabName),
        spreadsheetId: OFFICE_AGENT_ROSTER_SPREADSHEET_ID,
      });
    }
    return mapRowsWithScope(rows, officeScope);
  } catch {
    return [];
  }
}

function rosterWorkingStatusValue(value = "") {
  return normalizeWorkingStatusValue(value) === "working" ? "Working" : "Not Working";
}

// The roster is a per-agent attribute lookup (working status, start date, desk,
// team leader). For a permission-scoped user it must be gated by the agents the
// user is ALREADY allowed to see (derived from their permission-filtered leads),
// NOT by the roster's own granular Desk column. Filtering by desk broke
// office-scoped users: their scope ("Dubai Office") never matches the roster's
// granular desks ("AE Thailand"), so the whole roster — and thus every agent's
// working status / start date / benchmark — dropped, making everyone show as
// "Not Working". Gating by the permitted agents resolves those attributes for
// exactly the agents the user can see, with no data leak.
export function filterOfficeAgentRosterRowsByAllowedAgents(rows = [], allowedAgents = new Set()) {
  if (!allowedAgents || allowedAgents.size === 0) {
    return [];
  }
  return rows.filter((row) => {
    const normalizedAgent = normalizeAgentName(row?.Agent || row?.["Agent Name"] || "");
    return Boolean(normalizedAgent) && allowedAgents.has(normalizedAgent);
  });
}

function rosterAgentProfileMapFromRows(rows = []) {
  const profileMap = new Map();
  for (const row of rows) {
    const canonicalAgent = cleanSpreadsheetText(row?.Agent || row?.["Agent Name"] || "");
    const oldName = cleanSpreadsheetText(row?.["Old Name"] || row?.["Old name"] || row?.["OldName"] || "");
    const desk = cleanSpreadsheetText(row?.Desk || row?.Office || "");
    const teamLeader = cleanSpreadsheetText(row?.["Team Leader"] || "");
    const normalizedCanonical = normalizeAgentName(canonicalAgent);
    if (!normalizedCanonical) {
      continue;
    }
    if (isExcludedNormalizedAgent(normalizedCanonical)) {
      continue;
    }
    const profile = {
      agentName: canonicalAgent,
      desk,
      teamLeader,
    };
    profileMap.set(normalizedCanonical, profile);
    if (oldName) {
      const normalizedOld = normalizeAgentName(oldName);
      if (normalizedOld && !isExcludedNormalizedAgent(normalizedOld)) {
        profileMap.set(normalizedOld, profile);
      }
    }
  }
  return profileMap;
}

function remapLeadRowsByRosterProfile(rows = [], tabConfig, profileMap = new Map()) {
  if (!profileMap || typeof profileMap.get !== "function" || profileMap.size === 0) {
    return rows;
  }
  const agentField = getFieldName(tabConfig, "agentNames");
  const deskField = getFieldName(tabConfig, "office");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  return rows.map((row) => {
    const rawAgent = cleanSpreadsheetText(getRowValue(row, agentField) || "");
    if (!rawAgent) {
      return row;
    }
    const profile = profileMap.get(normalizeAgentName(rawAgent));
    if (!profile) {
      return row;
    }
    const currentDesk = cleanSpreadsheetText(getRowValue(row, deskField) || "");
    const currentTeamLeader = cleanSpreadsheetText(getRowValue(row, teamLeaderField) || "");
    const nextAgent = profile.agentName || rawAgent;
    const nextDesk = currentDesk || profile.desk || "";
    const nextTeamLeader = currentTeamLeader || profile.teamLeader || "";
    if (nextAgent === rawAgent && nextDesk === currentDesk && nextTeamLeader === currentTeamLeader) {
      return row;
    }
    return {
      ...row,
      [agentField]: nextAgent,
      [deskField]: nextDesk,
      [teamLeaderField]: nextTeamLeader,
    };
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
      "Working Month /Fired Date": String(rosterFiredDateRaw(row)).trim(),
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

function rosterFiredDateRaw(row = {}) {
  const direct =
    row?.["Working Month /Fired Date"] ||
    row?.["Working Month/Fired Date"] ||
    row?.["Fired Date"] ||
    row?.["Exit Date"] ||
    "";
  if (String(direct || "").trim()) {
    return direct;
  }
  const dynamicKey = Object.keys(row || {}).find((key) => {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) {
      return false;
    }
    return (
      normalizedKey.includes("fired date") ||
      normalizedKey.includes("exit date") ||
      (normalizedKey.includes("working month") && normalizedKey.includes("fired"))
    );
  });
  return dynamicKey ? row?.[dynamicKey] || "" : "";
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

function normalizedDateValue(value) {
  const parseStrictDate = (candidate) => {
    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
      return candidate;
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      if (candidate < 20000 || candidate > 90000) {
        return null;
      }
      return parseDateValue(candidate);
    }
    const raw = String(candidate || "").trim();
    if (!raw) {
      return null;
    }
    if (/^\d+$/.test(raw)) {
      const asNumber = Number(raw);
      if (!Number.isFinite(asNumber) || asNumber < 20000 || asNumber > 90000) {
        return null;
      }
      return parseDateValue(asNumber);
    }
    const looksLikeDate =
      /^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(raw) ||
      /^\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(raw);
    if (!looksLikeDate) {
      return null;
    }
    return parseDateValue(raw);
  };
  const parsed = parseStrictDate(value);
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

function normalizedStartDateValue(value) {
  return normalizedDateValue(value);
}

function normalizedEndDateValue(value) {
  return normalizedDateValue(value);
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

function preferLaterDateString(current = "", next = "") {
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
    return nextValue || currentValue;
  }
  return nextDate.getTime() > currentDate.getTime() ? nextValue : currentValue;
}

function collectAgentEndDateMap(infoRows = [], tabConfig, allowedAgents = new Set()) {
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
    const endDate = [
      rosterFiredDateRaw(row),
      getRowValue(row, "Working Month /Fired Date"),
      getRowValue(row, "Working Month/Fired Date"),
      getRowValue(row, "Fired Date"),
      getRowValue(row, "Exit Date"),
    ]
      .map((value) => normalizedEndDateValue(value))
      .find(Boolean);
    if (!endDate) {
      continue;
    }
    map.set(normalizedAgent, preferLaterDateString(map.get(normalizedAgent) || "", endDate));
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
  mergedContext.endDateByAgent = new Map();
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
    const endDateMap = context?.endDateByAgent;
    if (endDateMap && typeof endDateMap.entries === "function") {
      for (const [normalizedAgent, endDate] of endDateMap.entries()) {
        const preferredEndDate = preferLaterDateString(
          mergedContext.endDateByAgent.get(normalizedAgent) || "",
          endDate,
        );
        if (preferredEndDate) {
          mergedContext.endDateByAgent.set(normalizedAgent, preferredEndDate);
        }
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

function summaryWithTargets(rows, tabConfig, infoContext, dateFilter, now = new Date(), scope = {}, kycFtdRows = []) {
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
    kycFtd: kycFtdCountFromRows(rows, tabConfig, {
      kycFtdRows,
      dateFilter,
      scope,
      now,
    }),
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

export function buildDashboardStats(rows, tabConfig, infoContext, dateFilter, now = new Date()) {
  const aggregation = targetAggregationForScope({
    rows,
    tabConfig,
    infoContext,
    filters: dateFilter ? { date: dateFilter } : {},
    scope: {
      groupField: "agentNames",
      onlyWorkingAgents: true,
      // Restrict the target-achieved population to the agents actually in the
      // filtered/scoped view. Without this the rate was computed over every
      // working agent in the whole office while only the visible agents had
      // FTD, so a filtered team showed a nonsensical rate (e.g. 1 of 179 =
      // 0.56% instead of 1 of the agents on screen).
      restrictToRows: true,
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

// LeadSplitter desk rule: take the segment after the second "/" in the
// Department cell and read its leading run of capital letters. So
// "HQ / CY1 / GE-TR" -> "GE", "HQ / TR1 / ENAF" -> "ENAF", "HQ / AE / VN" -> "VN".
export function deskCodeFromDepartment(department = "") {
  const text = String(department || "");
  const firstSlash = text.indexOf("/");
  if (firstSlash < 0) {
    return "";
  }
  const secondSlash = text.indexOf("/", firstSlash + 1);
  if (secondSlash < 0) {
    return "";
  }
  const segment = text.slice(secondSlash + 1).trim();
  const match = segment.match(/^[A-Z]+/);
  return match ? match[0] : "";
}

// Builds the LeadSplitter grouped report: Desk -> Country -> Agent with a
// Country subtotal row and a Desk total row, plus a grand-total summary. Desk is
// derived from the Department field. Leads / FTD / CR / CR Target / CR Target
// Reach are computed with the SAME standard logic as every other report
// (calculateSummary): valid leads, FTD-maker/FTD-date based FTD, and the
// weighted CR target. Only the presentation (Desk split) is bespoke. Rows whose
// Department has no desk code are excluded entirely (no "Other" bucket).
export function buildLeadSplitterReport(rows = [], tabConfig, options = {}) {
  const now = options.now || new Date();
  const summaryFilters = options.dateFilter ? { date: options.dateFilter } : {};
  const departmentField = getFieldName(tabConfig, "department");
  const countryField = getFieldName(tabConfig, "country");
  const agentField = getFieldName(tabConfig, "agentNames");
  const firstCallAgentField = getFieldName(tabConfig, "firstCallAgent");

  const deskMap = new Map();
  const includedRows = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const desk = deskCodeFromDepartment(getRowValue(row, departmentField));
    if (!desk) {
      continue;
    }
    const country = cleanSpreadsheetText(getRowValue(row, countryField)) || "Unknown";
    const agent =
      cleanSpreadsheetText(getRowValue(row, agentField)) ||
      cleanSpreadsheetText(getRowValue(row, firstCallAgentField)) ||
      "Unknown";
    if (!deskMap.has(desk)) {
      deskMap.set(desk, new Map());
    }
    const countryMap = deskMap.get(desk);
    if (!countryMap.has(country)) {
      countryMap.set(country, new Map());
    }
    const agentMap = countryMap.get(country);
    if (!agentMap.has(agent)) {
      agentMap.set(agent, []);
    }
    agentMap.get(agent).push(row);
    includedRows.push(row);
  }

  const metricsFromRows = (groupRows) => {
    const summary = calculateSummary(groupRows, tabConfig, summaryFilters, now);
    return {
      leads: Number(summary.totalLeads || 0),
      ftd: Number(summary.totalFtd || 0),
      cr: Number(summary.cr || 0),
      crTarget: Number(summary.crTarget || 0),
      crTargetReach: Number(summary.crTargetReach || 0),
    };
  };

  const outRows = [];
  const desks = [...deskMap.keys()].sort((left, right) => left.localeCompare(right));
  for (const desk of desks) {
    const countryMap = deskMap.get(desk);
    const deskRows = [];
    const countries = [...countryMap.entries()].map(([country, agentMap]) => {
      const agents = [...agentMap.entries()]
        .map(([agent, agentRows]) => ({ agent, rows: agentRows, ...metricsFromRows(agentRows) }))
        // Agents sorted by CR Target Reach (desc); ties fall back to Leads (desc).
        .sort(
          (left, right) =>
            right.crTargetReach - left.crTargetReach ||
            right.leads - left.leads ||
            String(left.agent).localeCompare(String(right.agent)),
        );
      const countryRows = [].concat(...[...agentMap.values()]);
      return { country, agents, rows: countryRows, metrics: metricsFromRows(countryRows) };
    });
    countries.sort(
      (left, right) => right.metrics.leads - left.metrics.leads || String(left.country).localeCompare(String(right.country)),
    );
    for (const entry of countries) {
      for (const agent of entry.agents) {
        outRows.push({
          kind: "agent",
          desk,
          country: entry.country,
          agent: agent.agent,
          leads: agent.leads,
          ftd: agent.ftd,
          cr: agent.cr,
          crTarget: agent.crTarget,
          crTargetReach: agent.crTargetReach,
        });
      }
      outRows.push({ kind: "countryTotal", desk, country: entry.country, label: `${entry.country} Total`, ...entry.metrics });
      deskRows.push(...entry.rows);
    }
    outRows.push({ kind: "deskTotal", desk, country: "", label: `${desk} Total`, ...metricsFromRows(deskRows) });
  }

  return {
    rows: outRows,
    summary: metricsFromRows(includedRows),
  };
}

// Builds the Traffic Priority data set: Country -> Campaign (AFF) -> Agent, each
// scored over a trailing 60-day window (leads by lead date, FTD by FTD date, CR
// = FTD/Leads via the standard calculateSummary). It also flags agents with no
// FTD in the last 7 days ("cold" -> traffic blocked) and exposes both the
// per-(country,campaign) segment agents and the country-level agents so the
// client/exporter can apply the "<10 segment leads -> fall back to country"
// rule. All ranking / allocation is done by lib/trafficPriority.js on top of
// this structure. Presentation only — no rows are dropped except those whose
// lead date is outside the 60-day window.
export function buildTrafficPriorityReport(rows = [], tabConfig, options = {}) {
  const now = options.now || new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const isoDay = (date) => new Date(date).toISOString().slice(0, 10);
  const windowFilter = {
    date: { type: "range", start: isoDay(now.getTime() - TRAFFIC_WINDOW_DAYS * dayMs), end: isoDay(now) },
  };
  const blockFilter = {
    date: { type: "range", start: isoDay(now.getTime() - TRAFFIC_BLOCK_WINDOW_DAYS * dayMs), end: isoDay(now) },
  };

  const countryField = getFieldName(tabConfig, "country");
  const campaignField = getFieldName(tabConfig, "campaign");
  const agentField = getFieldName(tabConfig, "agentNames");
  const firstCallAgentField = getFieldName(tabConfig, "firstCallAgent");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  const leadDateField = getFieldName(tabConfig, "leadDate");
  const createdField = getFieldName(tabConfig, "created");

  const allRows = Array.isArray(rows) ? rows : [];
  const agentOf = (row) =>
    cleanSpreadsheetText(getRowValue(row, agentField)) ||
    cleanSpreadsheetText(getRowValue(row, firstCallAgentField)) ||
    "Unknown";

  // Recency (block) status is a global per-agent signal: an agent with no FTD in
  // the last 7 days anywhere is cold, regardless of country/campaign. Compute it
  // from every row (not only the in-window-lead rows) so an FTD on an older lead
  // still counts as recent activity.
  const agentAllRows = new Map();
  for (const row of allRows) {
    const agent = agentOf(row);
    if (!agentAllRows.has(agent)) {
      agentAllRows.set(agent, []);
    }
    agentAllRows.get(agent).push(row);
  }
  const agentBlock = new Map();
  for (const [agent, agentRows] of agentAllRows) {
    const recent = calculateSummary(agentRows, tabConfig, blockFilter, now);
    const ftd7d = Number(recent.totalFtd || 0);
    agentBlock.set(agent, { ftd7d, blocked: ftd7d === 0 });
  }

  // Per-day lead / FTD counts per (country, agent) across ALL loaded rows (not
  // just the 60-day window). Powers the "Distribution Check" audit: for a chosen
  // day it lets the client compare each agent's actual leads that day against the
  // performance-based expectation using the 60 days *before* that day.
  const ftdField = getFieldName(tabConfig, "ftd");
  const ftdMakerField = getFieldName(tabConfig, "ftdMaker");
  const ftdDateField = getFieldName(tabConfig, "ftdDate");
  const dayKey = (raw) => {
    const parsed = parseDateValue(raw);
    return parsed ? parsed.toISOString().slice(0, 10) : "";
  };
  const rowIsFtd = (row) => {
    const ftdValue = Number(String(getRowValue(row, ftdField) || "").replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(ftdValue) && ftdValue > 0) {
      return true;
    }
    return String(getRowValue(row, ftdMakerField) || "").trim() !== "";
  };
  // The day picker only offers real, recent, past days. Future or wildly old
  // dates (data-entry typos like "15.07.2027" or "28.07.0206") must never appear
  // as a selectable audit day.
  const todayKey = isoDay(now);
  const earliestDayKey = isoDay(now.getTime() - 400 * dayMs);
  const isSelectableDay = (dayString) => dayString >= earliestDayKey && dayString <= todayKey;
  const dailyByCountryAgent = new Map();
  const daysSet = new Set();
  for (const row of allRows) {
    const country = cleanSpreadsheetText(getRowValue(row, countryField)) || "Unknown";
    const agent = agentOf(row);
    const leadDay = dayKey(getRowValue(row, leadDateField) || getRowValue(row, createdField));
    if (!dailyByCountryAgent.has(country)) {
      dailyByCountryAgent.set(country, new Map());
    }
    const agentDaily = dailyByCountryAgent.get(country);
    if (!agentDaily.has(agent)) {
      agentDaily.set(agent, { leadsByDay: {}, ftdByDay: {} });
    }
    const record = agentDaily.get(agent);
    if (leadDay) {
      record.leadsByDay[leadDay] = (record.leadsByDay[leadDay] || 0) + 1;
      if (isSelectableDay(leadDay)) {
        daysSet.add(leadDay);
      }
    }
    if (rowIsFtd(row)) {
      const ftdDay = dayKey(getRowValue(row, ftdDateField));
      if (ftdDay) {
        record.ftdByDay[ftdDay] = (record.ftdByDay[ftdDay] || 0) + 1;
      }
    }
  }
  const days = [...daysSet].sort((left, right) => right.localeCompare(left));

  // Group only rows whose lead date falls inside the 60-day window — those are
  // the agents/countries/campaigns eligible for traffic right now.
  const countryMap = new Map();
  for (const row of allRows) {
    const leadRaw = getRowValue(row, leadDateField) || getRowValue(row, createdField);
    if (!dateMatches(leadRaw, windowFilter.date, now)) {
      continue;
    }
    const country = cleanSpreadsheetText(getRowValue(row, countryField)) || "Unknown";
    const campaign = cleanSpreadsheetText(getRowValue(row, campaignField)) || "Unknown";
    const agent = agentOf(row);
    if (!countryMap.has(country)) {
      countryMap.set(country, { rows: [], agents: new Map(), campaigns: new Map() });
    }
    const countryEntry = countryMap.get(country);
    countryEntry.rows.push(row);
    if (!countryEntry.agents.has(agent)) {
      countryEntry.agents.set(agent, []);
    }
    countryEntry.agents.get(agent).push(row);
    if (!countryEntry.campaigns.has(campaign)) {
      countryEntry.campaigns.set(campaign, { rows: [], agents: new Map() });
    }
    const campaignEntry = countryEntry.campaigns.get(campaign);
    campaignEntry.rows.push(row);
    if (!campaignEntry.agents.has(agent)) {
      campaignEntry.agents.set(agent, []);
    }
    campaignEntry.agents.get(agent).push(row);
  }

  const metricsFromRows = (groupRows) => {
    const summary = calculateSummary(groupRows, tabConfig, windowFilter, now);
    return {
      leads: Number(summary.totalLeads || 0),
      ftd: Number(summary.totalFtd || 0),
      cr: Number(summary.cr || 0),
    };
  };
  const teamLeaderOf = (groupRows) => {
    for (const row of groupRows) {
      const tl = cleanSpreadsheetText(getRowValue(row, teamLeaderField));
      if (tl) {
        return tl;
      }
    }
    return "";
  };
  const agentEntry = (agent, agentRows) => {
    const block = agentBlock.get(agent) || { ftd7d: 0, blocked: true };
    return {
      agent,
      teamLeader: teamLeaderOf(agentRows),
      ...metricsFromRows(agentRows),
      ftd7d: block.ftd7d,
      blocked: block.blocked,
    };
  };
  // Active (unblocked) agents first, then by CR desc, then leads desc.
  const sortAgents = (list) =>
    list.sort(
      (left, right) =>
        Number(left.blocked) - Number(right.blocked) ||
        right.cr - left.cr ||
        right.leads - left.leads ||
        String(left.agent).localeCompare(String(right.agent)),
    );

  const countries = [...countryMap.entries()]
    .map(([country, entry]) => {
      const agentDaily = dailyByCountryAgent.get(country) || new Map();
      const agents = sortAgents(
        [...entry.agents.entries()].map(([agent, agentRows]) => {
          const daily = agentDaily.get(agent) || { leadsByDay: {}, ftdByDay: {} };
          return { ...agentEntry(agent, agentRows), leadsByDay: daily.leadsByDay, ftdByDay: daily.ftdByDay };
        }),
      );
      const campaigns = [...entry.campaigns.entries()]
        .map(([campaign, campaignEntry]) => ({
          campaign,
          ...metricsFromRows(campaignEntry.rows),
          agents: sortAgents(
            [...campaignEntry.agents.entries()].map(([agent, agentRows]) => agentEntry(agent, agentRows)),
          ),
        }))
        .sort((left, right) => right.leads - left.leads || String(left.campaign).localeCompare(String(right.campaign)));
      return { country, ...metricsFromRows(entry.rows), agents, campaigns };
    })
    .sort((left, right) => right.leads - left.leads || String(left.country).localeCompare(String(right.country)));

  return {
    windowDays: TRAFFIC_WINDOW_DAYS,
    blockWindowDays: TRAFFIC_BLOCK_WINDOW_DAYS,
    minSegmentLeads: TRAFFIC_MIN_SEGMENT_LEADS,
    defaultCount: TRAFFIC_DEFAULT_COUNT,
    generatedAt: now.toISOString(),
    days,
    countries,
  };
}

async function readMonthData({
  monthRecord,
  officeScope,
  tabConfig,
  ftdTabConfig,
  infoAgentsTabConfig,
  permissionFilters,
  officeRosterRows,
  skipPermissionFilters = false,
  includeLegacyInfoTargets = true,
  includeKycFtd = true,
  onProgress = null,
}) {
  const reportProgress = typeof onProgress === "function" ? onProgress : null;
  const notifyProgress = (tab = "", extra = {}) => {
    if (!reportProgress) {
      return;
    }
    reportProgress({
      step: "Loading Google Sheets",
      tab,
      office: String(officeScope || monthRecord?.office_name || "").trim(),
      monthKey: String(monthRecord?.key || "").trim(),
      monthLabel: String(monthRecord?.month_label || monthRecord?.key || "").trim(),
      sheetId: String(monthRecord?.sheet_id || "").trim(),
      ...extra,
    });
  };
  const rosterRowsRawPromise = Array.isArray(officeRosterRows)
    ? Promise.resolve(officeRosterRows)
    : (() => {
        notifyProgress("Roster");
        return readOfficeAgentRosterRows(officeScope || monthRecord.office_name || "");
      })();
  const monthScope = {
    spreadsheetId: monthRecord.sheet_id,
    office: officeScope || monthRecord.office_name || "",
    period: monthRecord.key || monthRecord.period || "",
  };
  const legacyInfoRowsPromise = includeLegacyInfoTargets
    ? (() => {
        notifyProgress("Info Agents");
        return readDashboardSheetRows("infoAgents", {
          tabConfig: infoAgentsTabConfig,
          ...monthScope,
        })
          .then((rows) => mapRowsWithScope(rows, officeScope || monthRecord.office_name || ""))
          .catch(() => []);
      })()
    : Promise.resolve([]);
  const ftdRowsPromise = includeKycFtd
    ? (() => {
        notifyProgress("FTD");
        return readFtdRowsForKyc(ftdTabConfig, monthScope);
      })()
    : Promise.resolve([]);
  let rawRows = [];
  notifyProgress("Leads");
  try {
    rawRows = await readDashboardSheetRows("leads", {
      tabConfig,
      ...monthScope,
    });
  } catch (error) {
    if (isGooglePermissionDeniedError(error)) {
      const serviceAccountEmail = getGoogleCredentialConfig().email;
      const officeLabel = String(officeScope || monthRecord.office_name || "").trim() || "selected office";
      const monthLabel = String(monthRecord.month_label || monthRecord.key || "").trim() || "selected month";
      throw new Error(
        `Google Sheet access denied for ${monthLabel} (${officeLabel}). ` +
          `Share that spreadsheet with ${serviceAccountEmail} and try again.`,
      );
    }
    throw error;
  }
  const rowsWithScope = mapRowsWithScope(
    mapRowsWithMonthSource(rawRows, monthRecord),
    officeScope || monthRecord.office_name || "",
  );
  const [rosterRowsRaw, legacyInfoRows, ftdRowsRaw] = await Promise.all([
    rosterRowsRawPromise,
    legacyInfoRowsPromise,
    ftdRowsPromise,
  ]);
  const rosterProfileMap = rosterAgentProfileMapFromRows(rosterRowsRaw);
  const permissionRowsRaw = skipPermissionFilters
    ? rowsWithScope
    : filterRowsByPermission(rowsWithScope, tabConfig, permissionFilters || {});
  const permissionRowsAliased = remapLeadRowsByRosterProfile(permissionRowsRaw, tabConfig, rosterProfileMap);
  const leadsProfileMap = buildAgentProfileMapFromLeadsRows(permissionRowsAliased, tabConfig);
  const kycFtdRowsBuilt = includeKycFtd
    ? buildKycFtdRowsFromFtdSheet(ftdRowsRaw, ftdTabConfig, tabConfig, rosterProfileMap, {
        officeScope: officeScope || monthRecord.office_name || "",
        monthPeriod: monthRecord.key || monthRecord.period || "",
        leadsProfileMap,
      })
    : [];
  const leadAgentField = getFieldName(tabConfig, "agentNames");
  const allowedAgentsPreview = new Set(
    permissionRowsAliased
      .map((row) => normalizeAgentName(getRowValue(row, leadAgentField)))
      .filter(Boolean),
  );
  const kycFtdRowsPermissionFiltered = skipPermissionFilters
    ? kycFtdRowsBuilt
    : filterKycFtdRowsForPermission(kycFtdRowsBuilt, tabConfig, permissionFilters || {}, allowedAgentsPreview);
  const kycFtdRows = filterExcludedAgentRows(kycFtdRowsPermissionFiltered, tabConfig);
  const permissionRows = filterExcludedAgentRows(permissionRowsAliased, tabConfig);
  const allowedAgents = new Set(
    permissionRows
      .map((row) => normalizeAgentName(getRowValue(row, leadAgentField)))
      .filter(Boolean),
  );
  const legacyInfoRowsByAgentScope = filterInfoRowsByAllowedAgents(legacyInfoRows, infoAgentsTabConfig, allowedAgents);
  const legacyInfoContext = buildInfoAgentsContext(legacyInfoRowsByAgentScope);
  const rosterRows = skipPermissionFilters
    ? rosterRowsRaw
    : filterOfficeAgentRosterRowsByAllowedAgents(rosterRowsRaw, allowedAgents);
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
  const endDateByAgent = collectAgentEndDateMap(effectiveInfoRows, infoAgentsTabConfig, effectiveAllowedAgents);
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
  infoContext.endDateByAgent = new Map();
  for (const [normalizedAgent, endDate] of endDateByAgent.entries()) {
    infoContext.endDateByAgent.set(
      normalizedAgent,
      preferLaterDateString(infoContext.endDateByAgent.get(normalizedAgent) || "", endDate),
    );
  }
  return {
    monthRecord,
    rows: permissionRows,
    kycFtdRows,
    infoContext,
    statusByAgent,
  };
}

function optionValuesByField(rows, tabConfig, query, fieldKey, now = new Date()) {
  const includeFields = Object.keys(FILTER_TO_FIELD).filter((key) => key !== fieldKey);
  const filtered = applyDashboardFilters(rows, tabConfig, query, now, { includeFields });
  const values = uniqueValues(filtered, tabConfig, FILTER_TO_FIELD[fieldKey]);
  if (fieldKey === "agent" || fieldKey === "teamLeader") {
    return values.filter((value) => !isExcludedNormalizedAgent(normalizeAgentName(value)));
  }
  return values;
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

function monthOptionsFromRecords(records = []) {
  const byKey = new Map();
  for (const record of records || []) {
    const key = String(record?.key || "").trim();
    if (!key) {
      continue;
    }
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        month_label: String(record?.month_label || key),
        officeNames: new Set(),
      });
    }
    const entry = byKey.get(key);
    const officeName = String(record?.office_name || "").trim();
    if (officeName) {
      entry.officeNames.add(officeName);
    }
  }
  return [...byKey.values()].map((entry) => {
    const officeNames = [...entry.officeNames].sort((left, right) => left.localeCompare(right));
    return {
      key: entry.key,
      month_label: entry.month_label,
      office_name: officeNames.length === 1 ? officeNames[0] : "",
      office_names: officeNames,
      office_count: officeNames.length,
    };
  });
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
  const kycFtd = rows.reduce((sum, row) => sum + Number(row.kycFtd || 0), 0);
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
    kycFtd,
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
  "kycFtd",
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

function groupKeyValueForDimension(dimension, value = "") {
  const raw = String(value || "-").trim() || "-";
  if (dimension?.key === "agent") {
    const normalizedAgent = normalizeAgentName(raw);
    return normalizedAgent || normalizeText(raw);
  }
  return normalizeText(raw);
}

function prefixKeyForDimensions(dimensions = [], values = {}, depth = 0) {
  return dimensions
    .slice(0, depth + 1)
    .map((dimension) => groupKeyValueForDimension(dimension, values[dimension.key] || "-"))
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

// Week-of-month bucket: days 1–7 => W1, 8–14 => W2, ... Encodes the month too
// (e.g. "2026-08-W2") so weeks sort and group under their month.
function formatWeekStamp(value) {
  const date = parseDateValue(value);
  if (!date) {
    return "-";
  }
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const week = Math.floor((date.getUTCDate() - 1) / 7) + 1;
  return `${year}-${month}-W${week}`;
}

// Separator for a two-level (nested) column value, e.g. "2026-08\u0001W2".
const COLUMN_LEVEL_SEPARATOR = "\u0001";

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
  if (dimensionKey === "week") {
    return formatWeekStamp(getRowValue(row, leadDateField) || getRowValue(row, createdField));
  }
  if (dimensionKey === "date") {
    return formatDateStamp(getRowValue(row, leadDateField) || getRowValue(row, createdField));
  }
  if (dimensionKey === "hour") {
    return formatHourStamp(getRowValue(row, createdField) || getRowValue(row, leadDateField));
  }
  return "-";
}

// Coarse -> fine ordering for column dimensions. A secondary column dimension
// must be strictly finer than the primary (Month > Week > Date > Hour).
const COLUMN_DIMENSION_ORDER = ["month", "week", "date", "hour"];

function columnCompositeValueForRow(row, tabConfig, primaryDim, secondaryDim) {
  const primary = columnDimensionValueForRow(row, tabConfig, primaryDim);
  if (!secondaryDim) {
    return primary;
  }
  const secondary = columnDimensionValueForRow(row, tabConfig, secondaryDim);
  return `${primary}${COLUMN_LEVEL_SEPARATOR}${secondary}`;
}

// Human label for a single column part.
function columnPartLabel(dim, rawValue, { short = false } = {}) {
  const value = String(rawValue || "").trim();
  if (!value || value === "-") {
    return "-";
  }
  if (dim === "month") {
    const matched = value.match(/^(\d{4})-(\d{2})$/);
    if (matched) {
      const date = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, 1));
      return date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) + " " + matched[1];
    }
    return value;
  }
  if (dim === "week") {
    const matched = value.match(/^(\d{4})-(\d{2})-W(\d)$/);
    if (matched) {
      if (short) {
        return `W${matched[3]}`;
      }
      const date = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, 1));
      return `${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${matched[1]} · W${matched[3]}`;
    }
    return value;
  }
  if (dim === "date") {
    const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (matched) {
      const date = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])));
      return short
        ? `${matched[3]} ${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}`
        : `${matched[3]} ${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${matched[1]}`;
    }
    return value;
  }
  return value;
}

// Human label for a (possibly composite) column value.
function columnValueLabel(columnValue, primaryDim, secondaryDim) {
  if (columnValue === COLUMN_GRAND_TOTAL_KEY) {
    return "Grand Total";
  }
  if (!secondaryDim) {
    return columnPartLabel(primaryDim, columnValue);
  }
  const [primary, secondary] = String(columnValue || "").split(COLUMN_LEVEL_SEPARATOR);
  return `${columnPartLabel(primaryDim, primary)} · ${columnPartLabel(secondaryDim, secondary, { short: true })}`;
}

function rowMonthKeyForOrdering(row, tabConfig) {
  const sourceMonthKey = String(row?.__sourceMonthKey || "").trim();
  if (sourceMonthKey) {
    return sourceMonthKey;
  }
  const leadDateField = getFieldName(tabConfig, "leadDate");
  const createdField = getFieldName(tabConfig, "created");
  const parsed = parseDateValue(getRowValue(row, leadDateField) || getRowValue(row, createdField));
  if (!parsed) {
    return "";
  }
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
}

function rowTimestampForOrdering(row, tabConfig) {
  const leadDateField = getFieldName(tabConfig, "leadDate");
  const createdField = getFieldName(tabConfig, "created");
  const parsed = parseDateValue(getRowValue(row, createdField) || getRowValue(row, leadDateField));
  return parsed ? parsed.getTime() : -Infinity;
}

function buildLatestAgentHierarchyByMonth(rows = [], tabConfig) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const deskField = getFieldName(tabConfig, "office");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  const latestByAgent = new Map();
  for (const row of rows || []) {
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    if (!normalizedAgent) {
      continue;
    }
    const monthKey = rowMonthKeyForOrdering(row, tabConfig);
    const timestamp = rowTimestampForOrdering(row, tabConfig);
    const desk = cleanSpreadsheetText(getRowValue(row, deskField) || row?.__scopeOfficeName || "");
    const teamLeader = cleanSpreadsheetText(getRowValue(row, teamLeaderField) || "");
    const agent = cleanSpreadsheetText(getRowValue(row, agentField) || "");
    const current = latestByAgent.get(normalizedAgent);
    if (!current) {
      latestByAgent.set(normalizedAgent, {
        monthKey,
        timestamp,
        desk,
        teamLeader,
        agent,
      });
      continue;
    }
    const currentMonth = String(current.monthKey || "");
    const nextMonth = String(monthKey || "");
    const monthCompare = nextMonth.localeCompare(currentMonth);
    if (monthCompare > 0 || (monthCompare === 0 && timestamp >= Number(current.timestamp || -Infinity))) {
      latestByAgent.set(normalizedAgent, {
        monthKey,
        timestamp,
        desk: desk || current.desk || "",
        teamLeader: teamLeader || current.teamLeader || "",
        agent: agent || current.agent || "",
      });
    }
  }
  return latestByAgent;
}

function dimensionValueForRow(row, tabConfig, dimension, options = {}) {
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
  const latestHierarchyByAgent =
    options?.latestHierarchyByAgent instanceof Map ? options.latestHierarchyByAgent : null;
  if (latestHierarchyByAgent && (dimension.key === "desk" || dimension.key === "teamLeader" || dimension.key === "agent")) {
    const agentField = getFieldName(tabConfig, "agentNames");
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    const latestHierarchy = normalizedAgent ? latestHierarchyByAgent.get(normalizedAgent) : null;
    if (dimension.key === "desk") {
      return latestHierarchy?.desk || "-";
    }
    if (dimension.key === "teamLeader") {
      return latestHierarchy?.teamLeader || "-";
    }
    if (dimension.key === "agent") {
      return latestHierarchy?.agent || cleanSpreadsheetText(getRowValue(row, agentField) || "") || "-";
    }
  }
  const fieldName = getFieldName(tabConfig, dimension.fieldKey || dimension.key);
  const value = cleanSpreadsheetText(getRowValue(row, fieldName) || "");
  if ((dimension.key === "agent" || dimension.key === "teamLeader") && isExcludedNormalizedAgent(normalizeAgentName(value))) {
    return "-";
  }
  return value || "-";
}

function rowHasMeaningfulDimensionValue(values = {}, dimensions = []) {
  if (!Array.isArray(dimensions) || !dimensions.length) {
    return true;
  }
  return dimensions.some((dimension) => {
    const raw = String(values?.[dimension.key] || "").trim();
    return raw && raw !== "-";
  });
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
  const lateFtd = Number(summary.lateFtd || 0);
  const ftdTargetByCr = totalLeads * (crTarget / 100);
  return {
    leads: totalLeads,
    ftd: totalFtd,
    kycFtd: Number(summary.kycFtd || 0),
    ftdTarget: Number(summary.ftdTarget || 0),
    ftdTargetReach: Number(summary.ftdTargetReach || 0),
    cr: Number(summary.cr || 0),
    crTarget,
    crTargetReach: Number(summary.crTargetReach || 0),
    selfs: Number(summary.selfs || 0),
    lateFtd,
    lateFtdRate: totalFtd > 0 ? (lateFtd / totalFtd) * 100 : 0,
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

function workProfileFromStartDateRaw(startDateRaw = "", now = new Date(), endDateRaw = "") {
  const parsedStartDate = parseDateValue(startDateRaw);
  const parsedEndDate = parseDateValue(endDateRaw);
  const hasValidEndDate =
    Boolean(parsedEndDate) &&
    Number.isFinite(parsedEndDate?.getUTCFullYear?.()) &&
    parsedEndDate.getUTCFullYear() >= 1990 &&
    parsedEndDate.getUTCFullYear() <= 2100;
  const workExitDate = hasValidEndDate ? toIsoDateOrRaw(endDateRaw) : "-";
  if (!parsedStartDate) {
    return {
      workStartDate: toIsoDateOrRaw(startDateRaw),
      workExitDate,
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
  const endDayRaw = hasValidEndDate
    ? new Date(Date.UTC(parsedEndDate.getUTCFullYear(), parsedEndDate.getUTCMonth(), parsedEndDate.getUTCDate()))
    : null;
  const effectiveEndDay = endDayRaw
    ? endDayRaw.getTime() < nowDate.getTime()
      ? endDayRaw
      : nowDate
    : nowDate;
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((effectiveEndDay.getTime() - startDay.getTime()) / dayMs);
  const daysWorked = diffDays >= 0 ? diffDays + 1 : 0;
  const monthsWorked = daysWorked > 0 ? Math.floor(daysWorked / 30) : 0;
  const longTermBucket = monthsWorked > 2 ? LONG_TERM_BUCKET_MORE_THAN_2 : LONG_TERM_BUCKET_LESS_THAN_2;
  return {
    workStartDate: toIsoDateOrRaw(startDateRaw),
    workExitDate,
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

function normalizeCustomerIdToken(value = "") {
  let text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (/^-?\d+(\.0+)?$/.test(text)) {
    text = text.replace(/\.0+$/, "");
  }
  return text.replace(/\s+/g, "").toLocaleUpperCase("en-US");
}

function buildAgentProfileMapFromLeadsRows(rows = [], tabConfig) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const deskField = getFieldName(tabConfig, "office");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  const profileMap = new Map();
  for (const row of rows || []) {
    const rawAgent = cleanSpreadsheetText(getRowValue(row, agentField) || "");
    const normalizedAgent = normalizeAgentName(rawAgent);
    if (!normalizedAgent || isExcludedNormalizedAgent(normalizedAgent)) {
      continue;
    }
    const desk = cleanSpreadsheetText(getRowValue(row, deskField) || row.__scopeOfficeName || "");
    const teamLeader = cleanSpreadsheetText(getRowValue(row, teamLeaderField) || "");
    const current = profileMap.get(normalizedAgent);
    profileMap.set(normalizedAgent, {
      agentName: rawAgent || current?.agentName || "",
      desk: desk || current?.desk || "",
      teamLeader: teamLeader || current?.teamLeader || "",
    });
  }
  return profileMap;
}

function filterKycFtdRowsForPermission(kycFtdRows = [], tabConfig, permissionFilters = {}, allowedAgents = new Set()) {
  if (!Array.isArray(kycFtdRows) || !kycFtdRows.length) {
    return [];
  }
  const agentField = getFieldName(tabConfig, "agentNames");
  const permissionFiltered = filterRowsByPermission(kycFtdRows, tabConfig, permissionFilters || {});
  if (permissionFiltered.length > 0) {
    return permissionFiltered;
  }
  if (!allowedAgents.size) {
    return permissionFiltered;
  }
  return kycFtdRows.filter((row) => allowedAgents.has(normalizeAgentName(getRowValue(row, agentField))));
}

function resolveFtdSheetValue(row = {}, tabConfig = {}, fieldKey = "", fallbacks = []) {
  const fields = tabConfig?.fields || {};
  const candidates = [
    fields[fieldKey],
    tabConfig?.[`${fieldKey}Column`],
    ...fallbacks,
  ];
  for (const candidate of candidates) {
    const value = getRowValue(row, candidate);
    if (String(value || "").trim()) {
      return value;
    }
  }
  const normalizedFieldKey = normalizeText(fieldKey);
  for (const key of Object.keys(row || {})) {
    const normalizedKey = normalizeText(key);
    if (
      normalizedFieldKey === "agent" &&
      (normalizedKey === "agents" || normalizedKey === "agent" || normalizedKey === "agent names")
    ) {
      const value = String(row[key] || "").trim();
      if (value) {
        return value;
      }
    }
    if (
      normalizedFieldKey === "customerid" &&
      (normalizedKey === "cid" || normalizedKey === "customer id" || normalizedKey === "id")
    ) {
      const value = String(row[key] || "").trim();
      if (value) {
        return value;
      }
    }
    if (
      normalizedFieldKey === "date" &&
      (normalizedKey === "ftd date" || normalizedKey === "date")
    ) {
      const value = String(row[key] || "").trim();
      if (value) {
        return value;
      }
    }
  }
  return "";
}

// Canonical positional layout of every office FTD sheet. The sheets are built
// with IMPORTRANGE and frequently repeat header names ("FTD Date", "CID",
// "Agents"/"AGENTS" all appear more than once). Header-based mapping collapses
// those duplicates onto the LAST (usually empty) column, which silently blanks
// the FTD Date and — for offices whose primary agent header is uppercase — the
// Agents value too, zeroing out KYC FTD. Columns A–D are identical across every
// office, so we map by position instead of by (ambiguous) header name.
const FTD_POSITIONAL_COLUMNS = [
  "FTD Date",
  "CID",
  "LIST OF COUNTRY'S",
  "Agents",
  "AFF",
  "RegistrationDate",
  "TEAM",
];

function isFtdHeaderRow(row = []) {
  const cells = Array.isArray(row) ? row : [];
  return cells.some((cell) => {
    const normalized = normalizeText(cell);
    return normalized === "cid" || normalized === "ftd date" || normalized === "agents";
  });
}

export function ftdObjectsFromRawValues(values = []) {
  const rows = Array.isArray(values) ? values : [];
  const output = [];
  for (const row of rows) {
    if (!Array.isArray(row) || !row.length) {
      continue;
    }
    if (isFtdHeaderRow(row)) {
      continue;
    }
    const record = {};
    FTD_POSITIONAL_COLUMNS.forEach((column, index) => {
      record[column] = row[index] ?? "";
    });
    output.push(record);
  }
  return output;
}

async function readFtdRowsForKyc(ftdTabConfig, monthScope = {}) {
  const tabName = String(ftdTabConfig?.name || "FTD").trim() || "FTD";
  const range = `'${tabName.replace(/'/g, "''")}'!A:Z`;
  try {
    const values = await readSheetValues(monthScope.spreadsheetId, range, { bypassCache: true });
    return ftdObjectsFromRawValues(values);
  } catch (error) {
    console.error("[kyc-ftd] live FTD sheet read failed", {
      spreadsheetId: monthScope.spreadsheetId,
      message: error?.message || String(error),
    });
    return [];
  }
}

export function buildKycFtdRowsFromFtdSheet(ftdRows = [], ftdTabConfig = {}, tabConfig = {}, rosterProfileMap = new Map(), options = {}) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const deskField = getFieldName(tabConfig, "office");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  const idField = getFieldName(tabConfig, "id");
  const leadDateField = getFieldName(tabConfig, "leadDate");
  const createdField = getFieldName(tabConfig, "created");
  const ftdDateField = getFieldName(tabConfig, "ftdDate");
  const ftdMakerField = getFieldName(tabConfig, "ftdMaker");
  const officeScope = String(options.officeScope || "").trim();
  // The tab's own year (from its month key, e.g. "2026-07") is used to repair
  // implausible year typos in FTD-date cells.
  const tabYearMatch = String(options.monthPeriod || "").match(/^(\d{4})-\d{2}/);
  const tabYear = tabYearMatch ? Number(tabYearMatch[1]) : 0;
  const leadsProfileMap =
    options.leadsProfileMap instanceof Map ? options.leadsProfileMap : new Map();
  const output = [];
  for (const row of ftdRows || []) {
    const rowValues = Object.values(row || {});
    const rawAgent = cleanSpreadsheetText(
      resolveFtdSheetValue(row, ftdTabConfig, "agent", ["Agents", "Agent", "AGENT"]) || String(rowValues[3] || ""),
    );
    if (!rawAgent || isSheetErrorValue(rawAgent)) {
      continue;
    }
    const normalizedAgent = normalizeAgentName(rawAgent);
    if (!normalizedAgent || isExcludedNormalizedAgent(normalizedAgent)) {
      continue;
    }
    const rosterProfile = rosterProfileMap?.get?.(normalizedAgent);
    const leadsProfile = leadsProfileMap.get(normalizedAgent);
    const profile = rosterProfile || leadsProfile;
    const agentName = profile?.agentName || rawAgent;
    const desk = profile?.desk || "";
    const teamLeader =
      profile?.teamLeader ||
      cleanSpreadsheetText(resolveFtdSheetValue(row, ftdTabConfig, "team", ["TEAM", "Team Leader", "Team"]) || "");
    const customerId = normalizeCustomerIdToken(
      resolveFtdSheetValue(row, ftdTabConfig, "customerId", ["CID", "Customer ID", "ID"]) ||
        String(rowValues[1] || ""),
    );
    const ftdDateRaw =
      resolveFtdSheetValue(row, ftdTabConfig, "date", ["FTD Date", "Date"]) || String(rowValues[0] || "");
    const parsedFtdDate = parseDateValue(ftdDateRaw);
    // Repair obvious year typos in the source sheet (e.g. "28.07.0206" instead of
    // "28.07.2026"). Each FTD tab is a specific office+month spreadsheet, so a row
    // whose parsed year is implausible almost certainly belongs to the tab's year;
    // keep its day/month and fix only the year. Without this the row's month key
    // (e.g. "206-07") never matches the tab and the FTD silently drops from KYC.
    let effectiveFtdDate = parsedFtdDate;
    let ftdDateValue = parsedFtdDate ? ftdDateRaw : "";
    if (parsedFtdDate && tabYear) {
      const parsedYear = parsedFtdDate.getUTCFullYear();
      if (parsedYear < 2000 || parsedYear > tabYear + 1) {
        effectiveFtdDate = new Date(
          Date.UTC(tabYear, parsedFtdDate.getUTCMonth(), parsedFtdDate.getUTCDate()),
        );
        ftdDateValue = `${String(effectiveFtdDate.getUTCDate()).padStart(2, "0")}.${String(
          effectiveFtdDate.getUTCMonth() + 1,
        ).padStart(2, "0")}.${effectiveFtdDate.getUTCFullYear()}`;
      }
    }
    const monthKey = effectiveFtdDate
      ? `${effectiveFtdDate.getUTCFullYear()}-${String(effectiveFtdDate.getUTCMonth() + 1).padStart(2, "0")}`
      : "";
    output.push({
      __kycFtd: 1,
      __kycFtdSource: "ftd-sheet",
      __rawFtdAgent: rawAgent,
      __scopeOfficeName: officeScope,
      __sourceMonthKey: monthKey,
      [agentField]: agentName,
      [deskField]: desk,
      [teamLeaderField]: teamLeader,
      [idField]: customerId,
      [leadDateField]: ftdDateValue,
      [createdField]: ftdDateValue,
      [ftdDateField]: ftdDateValue,
      [ftdMakerField]: "kyc",
    });
  }
  return output;
}

function isSheetErrorValue(value = "") {
  const text = String(value || "").trim();
  return text.startsWith("#") || /did not find value/i.test(text);
}

function countKycFtdRows(rows = []) {
  return (rows || []).filter((row) => Number(row?.__kycFtd || 0) > 0).length;
}

function kycFtdRowsForScope(kycFtdRows = [], tabConfig, dateFilter = "", scope = {}, now = new Date()) {
  let filtered = Array.isArray(kycFtdRows) ? kycFtdRows : [];
  if (dateFilter && typeof dateFilter === "object" && dateFilter.type) {
    const ftdDateField = getFieldName(tabConfig, "ftdDate");
    filtered = filtered.filter((row) => {
      const dateValue = getRowValue(row, ftdDateField) || getRowValue(row, getFieldName(tabConfig, "leadDate"));
      return dateMatches(dateValue, dateFilter, now);
    });
  } else {
    const dateValue =
      typeof dateFilter === "object" ? String(dateFilter?.date || "").trim() : String(dateFilter || "").trim();
    if (dateValue) {
      filtered = filteredRows(filtered, tabConfig, { date: dateValue, dateField: "ftdDate" }, now);
    }
  }
  const agentField = getFieldName(tabConfig, "agentNames");
  const deskField = getFieldName(tabConfig, "office");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  if (Array.isArray(scope.agent) && scope.agent.length) {
    const allowed = new Set(scope.agent.map((item) => normalizeAgentName(item)).filter(Boolean));
    filtered = filtered.filter((row) => {
      const agentValue = normalizeAgentName(getRowValue(row, agentField));
      const rawValue = normalizeAgentName(row?.__rawFtdAgent || "");
      return allowed.has(agentValue) || allowed.has(rawValue);
    });
  } else if (Array.isArray(scope.teamLeader) && scope.teamLeader.length) {
    const allowed = new Set(scope.teamLeader.map((item) => normalizeText(item)).filter(Boolean));
    filtered = filtered.filter((row) => allowed.has(normalizeText(getRowValue(row, teamLeaderField))));
  } else if (Array.isArray(scope.office) && scope.office.length) {
    const allowed = new Set(scope.office.map((item) => normalizeText(item)).filter(Boolean));
    filtered = filtered.filter((row) => allowed.has(normalizeText(getRowValue(row, deskField))));
  }
  return filtered;
}

export function kycFtdCountFromRows(rows = [], tabConfig, options = {}) {
  const kycFtdRows = Array.isArray(options.kycFtdRows) ? options.kycFtdRows : rows;
  const scopedRows = kycFtdRowsForScope(
    kycFtdRows,
    tabConfig,
    options.dateFilter || options.monthFilter || "",
    options.scope || {},
    options.now || new Date(),
  );
  return countKycFtdRows(scopedRows);
}

// Merges the per-month KYC FTD row sets into a single list, attributing each
// FTD-sheet row to the month it actually belongs to (by its parsed FTD Date).
// Every office/month combination is a separate spreadsheet, and a month tab's
// FTD sheet can echo rows from adjacent months (or the same spreadsheet can back
// more than one month record). Without this attribution the combined multi-month
// total double-counts those rows and no longer equals the sum of the individual
// months. Rows whose FTD Date does not resolve to their own month are dropped,
// exactly as a single-month date filter already drops them.
export function combineKycFtdRowsBySourceMonth(monthDataItems = []) {
  const items = Array.isArray(monthDataItems) ? monthDataItems : [];
  const combined = [];
  for (const item of items) {
    const monthKey = String(item?.monthRecord?.key || "").trim();
    const rows = Array.isArray(item?.kycFtdRows) ? item.kycFtdRows : [];
    if (!monthKey) {
      combined.push(...rows);
      continue;
    }
    for (const row of rows) {
      if (String(row?.__sourceMonthKey || "").trim() === monthKey) {
        combined.push(row);
      }
    }
  }
  return combined;
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

function hasMeaningfulValue(value = "") {
  const text = String(value || "").trim();
  return Boolean(text) && text !== "-";
}

function tokenizeForDeskLanguage(value = "") {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
}

function countryMatchesDeskLanguage(country = "", language = "") {
  const countryTokens = tokenizeForDeskLanguage(country);
  const languageTokens = tokenizeForDeskLanguage(language);
  if (!countryTokens.length || !languageTokens.length) {
    return false;
  }
  for (const countryToken of countryTokens) {
    for (const languageToken of languageTokens) {
      if (countryToken === languageToken) {
        return true;
      }
      if (countryToken.length >= 5 && languageToken.length >= 5) {
        if (countryToken.slice(0, 5) === languageToken.slice(0, 5)) {
          return true;
        }
      }
      if (countryToken.length >= 5 && languageToken.includes(countryToken)) {
        return true;
      }
      if (languageToken.length >= 5 && countryToken.includes(languageToken)) {
        return true;
      }
    }
  }
  return false;
}

function resolveDeskLanguageBenchmarkKey({ desk = "", country = "", deskLanguageMap = new Map() } = {}) {
  const normalizedDesk = normalizeText(desk);
  if (!normalizedDesk) {
    return "";
  }
  const languageSet = deskLanguageMap?.get?.(normalizedDesk);
  if (!languageSet || !languageSet.size) {
    return `desk:${normalizedDesk}`;
  }
  const languageValues = [...languageSet];
  if (languageValues.length === 1) {
    return `lang:${languageValues[0]}`;
  }
  const normalizedCountry = normalizeText(country);
  if (normalizedCountry) {
    const matchedLanguage = languageValues.find((language) => countryMatchesDeskLanguage(normalizedCountry, language));
    if (matchedLanguage) {
      return `lang:${matchedLanguage}`;
    }
  }
  return `desk:${normalizedDesk}`;
}

function inferCountryForBuilderScope(rowValues = {}, rows = [], tabConfig) {
  const fromValues = String(rowValues?.country || "").trim();
  if (hasMeaningfulValue(fromValues)) {
    return fromValues;
  }
  const countryField = getFieldName(tabConfig, "country");
  const countries = new Set();
  for (const row of rows || []) {
    const country = cleanSpreadsheetText(getRowValue(row, countryField) || "");
    if (country) {
      countries.add(country);
    }
  }
  if (countries.size === 1) {
    return [...countries][0];
  }
  return "";
}

function buildDeskFtdAverages(rows = [], tabConfig, infoContext, now = new Date(), deskLanguageMap = new Map()) {
  const deskField = getFieldName(tabConfig, "office");
  const agentField = getFieldName(tabConfig, "agentNames");
  const countryField = getFieldName(tabConfig, "country");
  const leadDateField = getFieldName(tabConfig, "leadDate");
  const createdField = getFieldName(tabConfig, "created");
  const grouped = new Map();
  for (const row of rows) {
    const desk = String(getRowValue(row, deskField) || row.__scopeOfficeName || "").trim();
    const country = cleanSpreadsheetText(getRowValue(row, countryField) || "");
    const benchmarkKey = resolveDeskLanguageBenchmarkKey({
      desk,
      country,
      deskLanguageMap,
    });
    if (!benchmarkKey) {
      continue;
    }
    if (!grouped.has(benchmarkKey)) {
      grouped.set(benchmarkKey, { totalFtd: 0, agents: new Map() });
    }
    const entry = grouped.get(benchmarkKey);
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
  for (const [benchmarkKey, entry] of grouped.entries()) {
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
      const endDateRaw = infoContext?.endDateByAgent?.get(normalizedAgent) || "";
      const workProfile = workProfileFromStartDateRaw(startDateRaw, now, endDateRaw);
      if (workProfile.longTermBucket === LONG_TERM_BUCKET_LESS_THAN_2) {
        byLongTerm[LONG_TERM_BUCKET_LESS_THAN_2].total += agentMonthlyFtd;
        byLongTerm[LONG_TERM_BUCKET_LESS_THAN_2].count += 1;
      } else if (workProfile.longTermBucket === LONG_TERM_BUCKET_MORE_THAN_2) {
        byLongTerm[LONG_TERM_BUCKET_MORE_THAN_2].total += agentMonthlyFtd;
        byLongTerm[LONG_TERM_BUCKET_MORE_THAN_2].count += 1;
      }
    }
    output.set(benchmarkKey, {
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

function targetScopeFromRows(rows = [], tabConfig) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const agents = [...new Set(rows.map((row) => normalizeAgentName(getRowValue(row, agentField))).filter(Boolean))];
  return {
    groupField: "agentNames",
    restrictToRows: true,
    agent: agents,
  };
}

function builderExtraMetricValues(rows = [], tabConfig, summary = {}, options = {}) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const deskField = getFieldName(tabConfig, "office");
  const leadDateField = getFieldName(tabConfig, "leadDate");
  const createdField = getFieldName(tabConfig, "created");
  const rowValues = options.rowValues || {};
  const deskFtdAverages = options.deskFtdAverages || new Map();
  const deskLanguageMap = options.deskLanguageMap || new Map();
  const deskBenchmarkCache = options.deskBenchmarkCache || new Map();
  const useOfficeSheetBenchmarksOnly = Boolean(options.useOfficeSheetBenchmarksOnly);
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
  const deskFromValues = cleanSpreadsheetText(rowValues.desk || "");
  const deskFromRows = cleanSpreadsheetText(getRowValue(rows[0] || {}, deskField) || rows[0]?.__scopeOfficeName || "");
  const resolvedDesk = deskFromValues || deskFromRows;
  const resolvedCountry = inferCountryForBuilderScope(rowValues, rows, tabConfig);
  const benchmarkKey = resolveDeskLanguageBenchmarkKey({
    desk: resolvedDesk,
    country: resolvedCountry,
    deskLanguageMap,
  });
  const deskBenchmarkKey = resolvedDesk ? `desk:${normalizeText(resolvedDesk)}` : "";
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
  const endDateRaw = uniqueAgent ? infoContext?.endDateByAgent?.get(uniqueAgent) || "" : "";
  const workProfile = workProfileFromStartDateRaw(startDateRaw, now, endDateRaw);
  const deskAverage =
    deskFtdAverages.get(benchmarkKey)?.avgFtdByAgent ??
    (agentCount > 0 ? totalFtd / agentCount : 0);
  const benchmarkCacheEntry =
    deskBenchmarkCache.get(benchmarkKey) || (deskBenchmarkKey ? deskBenchmarkCache.get(deskBenchmarkKey) : null);
  const cachedLongTermBenchmark = resolveLongTermBenchmarkFromCache(benchmarkCacheEntry, workProfile.longTermBucket);
  const deskLongTermAverage =
    cachedLongTermBenchmark > 0
      ? cachedLongTermBenchmark
      : useOfficeSheetBenchmarksOnly
        ? 0
        : deskFtdAverages.get(benchmarkKey)?.avgFtdByLongTerm?.[workProfile.longTermBucket] || 0;
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
      workExitDate: "-",
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
  const endDateRaw = infoContext?.endDateByAgent?.get(normalizedAgent) || "";
  const profile = workProfileFromStartDateRaw(startDateRaw, now, endDateRaw);
  const latestStatusMap = options.latestStatusByAgent || infoContext?.latestStatusByAgent;
  const statusRaw =
    latestStatusMap?.get(normalizedAgent) ||
    normalizeWorkingStatusValue(infoContext?.byAgent?.get(normalizedAgent)?.working_status || "");
  return {
    workStartDate: profile.workStartDate,
    workExitDate: profile.workExitDate,
    workDays: profile.workDays,
    workMonths: profile.workMonths,
    workLongTerm: profile.workLongTerm,
    workCurrentStatus: statusRaw === "working" ? "Active" : "Not Working",
  };
}

function shouldHideNotWorkingFromQuery(query = {}) {
  return ["1", "true", "yes", "on"].includes(normalizeText(query.hideNotWorking));
}

export function filterOutNotWorkingRows(rows = [], tabConfig, infoContext = {}) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const latestStatusByAgent = infoContext?.latestStatusByAgent;
  const byAgent = infoContext?.byAgent;
  // "Hide Not Working" can only hide agents whose status we actually resolved.
  // When NO working-status data is available at all (e.g. an office without a
  // roster whose Info-Agents lookup came back empty for a permission-scoped
  // request), treating every agent as "not working" wrongly wipes the whole
  // report for that user while admins still see data. In that case, skip the
  // filter and show the rows rather than hiding everything.
  const hasResolvedStatus =
    (latestStatusByAgent && typeof latestStatusByAgent.size === "number" && latestStatusByAgent.size > 0) ||
    (byAgent &&
      typeof byAgent.values === "function" &&
      [...byAgent.values()].some((record) => normalizeWorkingStatusValue(record?.working_status)));
  if (!hasResolvedStatus) {
    return rows;
  }
  return rows.filter((row) => {
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    if (!normalizedAgent) {
      return true;
    }
    const latestStatusRaw =
      latestStatusByAgent?.get?.(normalizedAgent) ||
      byAgent?.get?.(normalizedAgent)?.working_status ||
      "";
    const normalizedStatus = normalizeWorkingStatusValue(latestStatusRaw);
    return normalizedStatus !== "not_working";
  });
}

export function specificBuilderTable(rows, tabConfig, infoContext, monthFilter, query = {}, now = new Date(), options = {}) {
  const legacyOverrides = options.legacyOverrides instanceof Map ? options.legacyOverrides : null;
  const perfCollector = options.perfCollector && typeof options.perfCollector === "object" ? options.perfCollector : null;
  const kycFtdRows = Array.isArray(options.kycFtdRows) ? options.kycFtdRows : [];
  const agentHrCodeByAgent = options.agentHrCodeByAgent instanceof Map ? options.agentHrCodeByAgent : null;
  const shouldAbort = typeof options.shouldAbort === "function" ? options.shouldAbort : () => false;
  const progressCallback = typeof options.onProgress === "function" ? options.onProgress : null;
  const ensureWithinBudget = (stage) => {
    if (shouldAbort(stage)) {
      throw reportTooHeavyError(
        "Selected report is too heavy. Please reduce dimensions, metrics, or date range and try again.",
        stage,
      );
    }
  };
  const emitBuilderProgress = (step, progress, processed = 0) => {
    if (!progressCallback) {
      return;
    }
    progressCallback({
      step,
      progress,
      rowsProcessed: processed,
    });
  };
  const dimensionKeys = selectedSpecificDimensions(query);
  // Show an "HR Code" text column next to Agent when a directory map is supplied
  // (currently only the Turkey office) and the report groups by agent.
  // HR Code is off by default and opt-in (Turkey only): shown when the caller
  // sets showHrCode and the agent directory map is available.
  const hrCodeRequested = ["1", "true", "yes", "on"].includes(normalizeText(query.showHrCode));
  const includeHrCode =
    hrCodeRequested && dimensionKeys.includes("agent") && Boolean(agentHrCodeByAgent) && agentHrCodeByAgent.size > 0;
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
  const columnDimension = COLUMN_DIMENSION_ORDER.includes(normalizedColumnDimension) ? normalizedColumnDimension : "";
  const normalizedColumnDimension2 = String(query.columnDimension2 || "").trim().toLowerCase();
  // Secondary column dimension is optional and must be strictly finer than the
  // primary (Month > Week > Date > Hour). Otherwise it is ignored, so behaviour
  // with no/invalid secondary is identical to the single-level pivot.
  const columnDimension2 =
    columnDimension &&
    COLUMN_DIMENSION_ORDER.includes(normalizedColumnDimension2) &&
    COLUMN_DIMENSION_ORDER.indexOf(normalizedColumnDimension2) > COLUMN_DIMENSION_ORDER.indexOf(columnDimension)
      ? normalizedColumnDimension2
      : "";
  const includeColumnGrandTotal =
    columnDimension && ["1", "true", "yes", "on"].includes(normalizeText(query.includeColumnGrandTotal));
  const includeWorkTime = ["1", "true", "yes", "on"].includes(normalizeText(query.includeWorkTime));
  const workTimeColumns = includeWorkTime
    ? [
        { key: "workStartDate", label: "Start Date", type: "text", kind: "worktime" },
        { key: "workDays", label: "Days", type: "number", kind: "worktime" },
        { key: "workMonths", label: "Months", type: "number", kind: "worktime" },
        { key: "workLongTerm", label: "Long Term", type: "text", kind: "worktime" },
        { key: "workCurrentStatus", label: "Current Status", type: "text", kind: "worktime" },
        { key: "workExitDate", label: "Exit Date", type: "text", kind: "worktime" },
      ]
    : [];
  let totalDimensionKeys = columnDimension
    ? []
    : selectedSpecificTotalDimensions(
        query,
        orderedDimensions.map((dimension) => dimension.key),
      );
  let totalDimensionSet = new Set(totalDimensionKeys);
  const metrics = metricKeys.map((key) => SPECIFIC_METRIC_BY_KEY.get(key)).filter(Boolean);
  const includeLeadShare = metrics.some((metric) => metric.key === "leadShare");
  const needsTargetAggregation = metrics.some((metric) => metric.key === "ftdTarget" || metric.key === "ftdTargetReach");
  const needsBuilderExtraMetrics = metrics.some((metric) => BUILDER_EXTRA_METRIC_KEYS.has(metric.key));
  const deskLanguageMap = options.deskLanguageMap instanceof Map ? options.deskLanguageMap : new Map();
  const deskBenchmarkCache = options.deskBenchmarkCache instanceof Map ? options.deskBenchmarkCache : new Map();
  const benchmarkRowsBase = Array.isArray(options.benchmarkRowsOverride) ? options.benchmarkRowsOverride : rows;
  const benchmarkInfoContext = options.benchmarkInfoContextOverride || infoContext;
  const useOfficeSheetBenchmarksOnly = Boolean(options.useOfficeSheetBenchmarksOnly);
  const needsDeskAverageBaseline = metrics.some((metric) => metric.key === "avgFtdByAgent" || metric.key === "avgFtdByAgentDaily");
  const needsLongTermBaseline = metrics.some(
    (metric) => metric.key === "avgFtdByDeskLongTerm" || metric.key === "ftdBenchmarkRate",
  );
  const needsDeskFtdAverages =
    needsDeskAverageBaseline || (needsLongTermBaseline && !useOfficeSheetBenchmarksOnly && deskBenchmarkCache.size === 0);
  const useLatestAgentHierarchy = Boolean(options.useLatestAgentHierarchy);
  const latestHierarchyByAgent =
    useLatestAgentHierarchy && dimensionKeys.includes("agent") ? buildLatestAgentHierarchyByMonth(rows, tabConfig) : null;
  const isOnlyFtdTargetMetric = metrics.length === 1 && metrics[0]?.key === "ftdTarget";
  const scopedSummary = (subsetRows, scopeValues = {}, scopeOverrides = {}, infoContextOverride = null) => {
    const activeInfoContext = infoContextOverride || infoContext;
    if (needsTargetAggregation) {
      if (isOnlyFtdTargetMetric) {
        const targetAggregation = targetAggregationForScope({
          rows: subsetRows,
          tabConfig,
          infoContext: activeInfoContext,
          filters: monthFilter ? { date: monthFilter } : {},
          scope: {
            groupField: "agentNames",
            onlyWorkingAgents: true,
            ...targetScopeFromDimensionValues(scopeValues),
            ...scopeOverrides,
          },
          now,
        });
        return {
          totalLeads: 0,
          totalFtd: 0,
          kycFtd: kycFtdCountFromRows(subsetRows, tabConfig, {
            kycFtdRows,
            dateFilter: monthFilter,
            scope: {
              ...targetScopeFromDimensionValues(scopeValues),
              ...scopeOverrides,
            },
            now,
          }),
          ftdTarget: Number(targetAggregation?.includedTarget || 0),
          ftdTargetReach: 0,
          cr: 0,
          crTarget: 0,
          crTargetReach: 0,
          selfs: 0,
          lateFtd: 0,
        };
      }
      return summaryWithTargets(
        subsetRows,
        tabConfig,
        activeInfoContext,
        monthFilter,
        now,
        {
          ...targetScopeFromDimensionValues(scopeValues),
          ...scopeOverrides,
        },
        kycFtdRows,
      );
    }
    const baseSummary = calculateSummary(subsetRows, tabConfig, monthFilter ? { date: monthFilter } : {}, now);
    return {
      ...baseSummary,
      kycFtd: kycFtdCountFromRows(subsetRows, tabConfig, {
        kycFtdRows,
        dateFilter: monthFilter,
        scope: {
          ...targetScopeFromDimensionValues(scopeValues),
          ...scopeOverrides,
        },
        now,
      }),
      ftdTarget: 0,
      ftdTargetReach: 0,
    };
  };
  const deskFtdAverages = needsDeskFtdAverages
    ? buildDeskFtdAverages(benchmarkRowsBase, tabConfig, benchmarkInfoContext, now, deskLanguageMap)
    : new Map();

  if (columnDimension) {
    const infoContextByMonthKey =
      options.infoContextByMonthKey instanceof Map ? options.infoContextByMonthKey : new Map();
    const rowDimensions = orderedDimensions.filter((dimension) => dimension.key !== columnDimension);
    const effectiveRowDimensions = rowDimensions;
    const grouped = new Map();
    const globalByColumn = new Map();
    const columnValues = new Set();
    let groupedScanCount = 0;
    const groupingStartedAt = Date.now();
    emitBuilderProgress("Grouping Data", 55, 0);
    for (const row of rows) {
      groupedScanCount += 1;
      if (groupedScanCount % 500 === 0) {
        ensureWithinBudget("specific_builder_grouping_column");
        emitBuilderProgress("Grouping Data", 55, groupedScanCount);
      }
      const values = {};
      for (const dimension of effectiveRowDimensions) {
        values[dimension.key] = dimensionValueForRow(row, tabConfig, dimension, {
          latestHierarchyByAgent,
        });
      }
      if (!rowHasMeaningfulDimensionValue(values, effectiveRowDimensions)) {
        continue;
      }
      const columnValue = columnCompositeValueForRow(row, tabConfig, columnDimension, columnDimension2);
      const groupKey = effectiveRowDimensions.length
        ? effectiveRowDimensions.map((dimension) => groupKeyValueForDimension(dimension, values[dimension.key])).join("::")
        : "__all__";
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { values, byColumn: new Map() });
      }
      const entry = grouped.get(groupKey);
      if (!entry.byColumn.has(columnValue)) {
        entry.byColumn.set(columnValue, []);
      }
      entry.byColumn.get(columnValue).push(row);
      if (!globalByColumn.has(columnValue)) {
        globalByColumn.set(columnValue, []);
      }
      globalByColumn.get(columnValue).push(row);
      columnValues.add(columnValue);
    }
    if (perfCollector) {
      perfCollector.groupingMs = (perfCollector.groupingMs || 0) + (Date.now() - groupingStartedAt);
    }

    const orderedColumnValuesRaw = [...columnValues].sort((left, right) => String(left || "").localeCompare(String(right || "")));
    // For a single selected month, a "Date" column must only show days within
    // that month. A stray out-of-month lead date (e.g. one lead mistakenly dated
    // in the previous month inside this month's sheet) otherwise creates an empty
    // column — the reason an August report showed July date columns. This also
    // covers a "Date" sub-column inside a Month/Week primary.
    const dateLevelIndex = columnDimension === "date" ? 0 : columnDimension2 === "date" ? 1 : -1;
    const orderedColumnValues =
      dateLevelIndex >= 0 && monthFilter && monthFilter.type === "month"
        ? orderedColumnValuesRaw.filter((columnValue) => {
            const parts = columnDimension2 ? String(columnValue).split(COLUMN_LEVEL_SEPARATOR) : [columnValue];
            const datePart = parts[dateLevelIndex];
            return datePart == null || dateMatches(datePart, monthFilter, now);
          })
        : orderedColumnValuesRaw;
    const columnValuesWithGrandTotal = includeColumnGrandTotal && orderedColumnValues.length
      ? [...orderedColumnValues, COLUMN_GRAND_TOTAL_KEY]
      : orderedColumnValues;
    const totalLeadBase = includeLeadShare
      ? Number(
          (
            needsTargetAggregation
              ? summaryWithTargets(rows, tabConfig, infoContext, monthFilter, now, targetScopeFromRows(rows, tabConfig))
              : calculateSummary(rows, tabConfig, monthFilter ? { date: monthFilter } : {}, now)
          ).totalLeads || 0,
        )
      : 0;
    let groupedEntries = [...grouped.values()];
    const MAX_COLUMN_GROUPS = 1500;
    if (groupedEntries.length > MAX_COLUMN_GROUPS) {
      groupedEntries = groupedEntries.slice(0, MAX_COLUMN_GROUPS);
    }
    const metricCalcStartedAt = Date.now();
    emitBuilderProgress("Calculating Metrics", 75, groupedEntries.length);
    const buildColumnEntryPayload = (entry) => {
        const payload = {};
        for (const dimension of effectiveRowDimensions) {
          payload[dimension.key] = entry.values[dimension.key] || "-";
        }
        const targetScopeOverridesForColumn =
          columnDimension === "month" && !columnDimension2 ? { restrictToRows: true, preferInfoTargets: true } : {};
        const allEntryRows = [];
        for (const rowsForColumn of entry.byColumn.values()) {
          allEntryRows.push(...rowsForColumn);
        }
        const monthSummaryByColumn =
          columnDimension === "month" && !columnDimension2 && needsTargetAggregation ? new Map() : null;
        let grandTargetFromMonths = 0;
        if (monthSummaryByColumn) {
          for (const monthKey of orderedColumnValues) {
            const monthRows = entry.byColumn.get(monthKey) || [];
            const monthInfoContext = infoContextByMonthKey.get(monthKey) || infoContext;
            const monthSummary = scopedSummary(monthRows, entry.values, targetScopeOverridesForColumn, monthInfoContext);
            monthSummaryByColumn.set(monthKey, monthSummary);
            grandTargetFromMonths += Number(monthSummary.ftdTarget || 0);
          }
        }
        for (const columnValue of columnValuesWithGrandTotal) {
          const bucketRows =
            columnValue === COLUMN_GRAND_TOTAL_KEY
              ? allEntryRows
              : entry.byColumn.get(columnValue) || [];
          let summary = null;
          if (monthSummaryByColumn && columnValue !== COLUMN_GRAND_TOTAL_KEY) {
            summary = monthSummaryByColumn.get(columnValue) || null;
          }
          if (!summary && monthSummaryByColumn && columnValue === COLUMN_GRAND_TOTAL_KEY) {
            const grandBaseSummary = calculateSummary(
              allEntryRows,
              tabConfig,
              monthFilter ? { date: monthFilter } : {},
              now,
            );
            summary = {
              ...grandBaseSummary,
              ftdTarget: grandTargetFromMonths,
              ftdTargetReach: targetReachPercent(Number(grandBaseSummary.totalFtd || 0), grandTargetFromMonths),
            };
          }
          if (!summary) {
            const bucketInfoContext =
              columnDimension === "month" && !columnDimension2 && columnValue !== COLUMN_GRAND_TOTAL_KEY
                ? infoContextByMonthKey.get(columnValue) || infoContext
                : infoContext;
            summary = scopedSummary(
              bucketRows,
              entry.values,
              targetScopeOverridesForColumn,
              bucketInfoContext,
            );
          }
          const metricValues = {
            ...metricValuesFromSummary(summary),
            ...(needsBuilderExtraMetrics
              ? builderExtraMetricValues(bucketRows, tabConfig, summary, {
                  infoContext,
                  rowValues: entry.values,
                  deskFtdAverages,
                  deskLanguageMap,
                  deskBenchmarkCache,
                  useOfficeSheetBenchmarksOnly,
                  now,
                })
              : {}),
          };
          // Legacy AR/AE old-data: force exact FTD/TARGET/CR/CR-target for the
          // Jan–Mar columns (the sheet is the source of truth there).
          if (legacyOverrides && columnDimension === "month" && !columnDimension2 && columnValue !== COLUMN_GRAND_TOTAL_KEY) {
            const legacyAgent = normalizeAgentName(entry.values.agent || "");
            const override = legacyAgent ? legacyOverrides.get(`${legacyAgent}::${columnValue}`) : null;
            if (override) {
              metricValues.ftd = override.ftd;
              metricValues.ftdTarget = override.ftdTarget;
              metricValues.cr = override.cr;
              metricValues.crTarget = override.crTarget;
              metricValues.ftdTargetReach = targetReachPercent(override.ftd, override.ftdTarget);
              metricValues.crTargetReach = override.crTarget > 0 ? (override.cr / override.crTarget) * 100 : 0;
              metricValues.leads = 0;
            }
          }
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
            workTimeValuesFromRows(allEntryRows, tabConfig, infoContext, now, {
              rowValues: entry.values,
              latestStatusByAgent: infoContext?.latestStatusByAgent,
            }),
          );
        }
        return payload;
    };
    const tableRows = groupedEntries
      .map(buildColumnEntryPayload)
      .sort((left, right) => {
        for (const dimension of effectiveRowDimensions) {
          const compare = String(left[dimension.key] || "").localeCompare(String(right[dimension.key] || ""));
          if (compare !== 0) {
            return compare;
          }
        }
        return 0;
      });
    // Grand Total row: aggregate the whole (unpaginated) row set per column so
    // counts are summed and rates are recomputed correctly.
    const grandTotalColumnRow = buildColumnEntryPayload({ values: {}, byColumn: globalByColumn });
    grandTotalColumnRow.__rowKind = "grandTotal";
    if (effectiveRowDimensions[0]) {
      grandTotalColumnRow[effectiveRowDimensions[0].key] = "Grand Total";
    }
    if (perfCollector) {
      perfCollector.metricCalculationMs = (perfCollector.metricCalculationMs || 0) + (Date.now() - metricCalcStartedAt);
    }

    const formattingStartedAt = Date.now();
    emitBuilderProgress("Building Table", 90, tableRows.length);
    const result = {
      table: tableRows,
      columns: [
        ...effectiveRowDimensions.map((dimension) => ({
          key: dimension.key,
          label: dimension.label,
          type: dimension.type || "text",
          kind: "dimension",
        })),
        ...columnValuesWithGrandTotal.flatMap((columnValue) =>
          metrics.map((metric) => ({
            key: `${columnDimension}_${columnValue}__${metric.key}`,
            label: `${columnValueLabel(columnValue, columnDimension, columnDimension2)} ${metric.label}`,
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
      columnDimension2,
      columnValues: columnValuesWithGrandTotal,
      columnValueLabels: Object.fromEntries(
        columnValuesWithGrandTotal.map((columnValue) => [
          columnValue,
          columnValueLabel(columnValue, columnDimension, columnDimension2),
        ]),
      ),
      columnMetrics: metrics.map((metric) => ({
        key: metric.key,
        label: metric.label,
        type: metric.type || "number",
      })),
      grandTotalRow: grandTotalColumnRow,
      includeColumnGrandTotal,
      includeWorkTime,
    };
    if (perfCollector) {
      perfCollector.responseFormattingMs = (perfCollector.responseFormattingMs || 0) + (Date.now() - formattingStartedAt);
    }
    return result;
  }

  const grouped = new Map();
  let nonColumnGroupingCount = 0;
  const nonColumnGroupingStartedAt = Date.now();
  emitBuilderProgress("Grouping Data", 55, 0);
  for (const row of rows) {
    nonColumnGroupingCount += 1;
    if (nonColumnGroupingCount % 500 === 0) {
      ensureWithinBudget("specific_builder_grouping_flat");
      emitBuilderProgress("Grouping Data", 55, nonColumnGroupingCount);
    }
    const values = {};
    for (const dimension of orderedDimensions) {
      values[dimension.key] = dimensionValueForRow(row, tabConfig, dimension, {
        latestHierarchyByAgent,
      });
    }
    if (!rowHasMeaningfulDimensionValue(values, orderedDimensions)) {
      continue;
    }
    const key = orderedDimensions.map((dimension) => groupKeyValueForDimension(dimension, values[dimension.key])).join("::");
    if (!grouped.has(key)) {
      grouped.set(key, { values, rows: [] });
    }
    grouped.get(key).rows.push(row);
  }
  if (perfCollector) {
    perfCollector.groupingMs = (perfCollector.groupingMs || 0) + (Date.now() - nonColumnGroupingStartedAt);
  }

  let groupedEntries = [...grouped.values()];
  // Comparison reports re-aggregate the leaf rows client-side by each single
  // dimension, so they need every group -- an arbitrary cap silently drops
  // whole teams/agents/countries from the comparison tables. When the caller
  // asks for full detail we lift the cap; otherwise we still keep the highest
  // volume groups (not an arbitrary sheet-order slice) so truncation never
  // hides the biggest teams.
  const wantsFullDetail = ["1", "true", "yes", "on"].includes(normalizeText(query.comparisonMode));
  const MAX_GROUPS = wantsFullDetail ? 50000 : 1600;
  if (groupedEntries.length > MAX_GROUPS) {
    groupedEntries = [...groupedEntries]
      .sort((left, right) => (right.rows?.length || 0) - (left.rows?.length || 0))
      .slice(0, MAX_GROUPS);
  }
  if (totalDimensionKeys.length && groupedEntries.length > 500) {
    totalDimensionKeys = [];
    totalDimensionSet = new Set();
  }

  const flatMetricCalcStartedAt = Date.now();
  emitBuilderProgress("Calculating Metrics", 75, groupedEntries.length);
  let detailRows = groupedEntries
    .map((entry) => {
      const summary = scopedSummary(entry.rows, entry.values);
      const metricValues = {
        ...metricValuesFromSummary(summary),
        ...(needsBuilderExtraMetrics
          ? builderExtraMetricValues(entry.rows, tabConfig, summary, {
              infoContext,
              rowValues: entry.values,
              deskFtdAverages,
              deskLanguageMap,
              deskBenchmarkCache,
              useOfficeSheetBenchmarksOnly,
              now,
            })
          : {}),
      };
      const payload = {};
      for (const dimension of orderedDimensions) {
        payload[dimension.key] = entry.values[dimension.key] || "-";
      }
      if (includeHrCode) {
        payload.hrCode = agentHrCodeByAgent.get(normalizeAgentName(entry.values.agent)) || "";
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

  // Prevent timeout on very broad builder queries with deep subtotal expansion.
  if (totalDimensionKeys.length) {
    const disableTotals = rows.length > 20000 || detailRows.length > 1500;
    const reduceTotals = !disableTotals && totalDimensionKeys.length > 1 && detailRows.length > 700;
    if (disableTotals) {
      totalDimensionKeys = [];
    } else if (reduceTotals) {
      totalDimensionKeys = totalDimensionKeys.slice(0, 1);
    }
    totalDimensionSet = new Set(totalDimensionKeys);
  }

  const MAX_DETAIL_ROWS = wantsFullDetail ? 50000 : 5000;
  if (detailRows.length > MAX_DETAIL_ROWS) {
    detailRows = detailRows.slice(0, MAX_DETAIL_ROWS);
  }

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
        ensureWithinBudget("specific_builder_subtotals");
        emitBuilderProgress("Calculating Metrics", 78, group.rows.length);
        const summary = scopedSummary(group.rows, group.values);
        const metricValues = metricValuesFromSummary(summary);
        const extraMetricValues = needsBuilderExtraMetrics
          ? builderExtraMetricValues(group.rows, tabConfig, summary, {
              infoContext,
              rowValues: group.values,
              deskFtdAverages,
              deskLanguageMap,
              deskBenchmarkCache,
              useOfficeSheetBenchmarksOnly,
              now,
            })
          : {};
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
  if (perfCollector) {
    perfCollector.metricCalculationMs = (perfCollector.metricCalculationMs || 0) + (Date.now() - flatMetricCalcStartedAt);
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

  // Grand Total row over the whole (unpaginated) row set: counts summed, rates
  // recomputed via the standard summary path.
  const grandTotalFlatSummary = scopedSummary(rows, {});
  const grandTotalFlatMetricValues = {
    ...metricValuesFromSummary(grandTotalFlatSummary),
    ...(needsBuilderExtraMetrics
      ? builderExtraMetricValues(rows, tabConfig, grandTotalFlatSummary, {
          infoContext,
          rowValues: {},
          deskFtdAverages,
          deskLanguageMap,
          deskBenchmarkCache,
          useOfficeSheetBenchmarksOnly,
          now,
        })
      : {}),
  };
  const grandTotalFlatRow = {};
  for (const dimension of orderedDimensions) {
    grandTotalFlatRow[dimension.key] = "";
  }
  if (orderedDimensions[0]) {
    grandTotalFlatRow[orderedDimensions[0].key] = "Grand Total";
  }
  for (const metric of metrics) {
    if (metric.key === "leadShare") {
      grandTotalFlatRow[metric.key] = Number(grandTotalFlatSummary.totalLeads || 0) > 0 ? 100 : 0;
      continue;
    }
    grandTotalFlatRow[metric.key] = metricOutputValue(metric, grandTotalFlatMetricValues);
  }
  grandTotalFlatRow.__rowKind = "grandTotal";

  const formattingStartedAt = Date.now();
  emitBuilderProgress("Building Table", 90, tableRows.length);
  const result = {
    table: tableRows,
    columns: [
      ...orderedDimensions.flatMap((dimension) => {
        const column = {
          key: dimension.key,
          label: dimension.label,
          type: dimension.type || "text",
          kind: "dimension",
        };
        if (includeHrCode && dimension.key === "agent") {
          return [column, { key: "hrCode", label: "HR Code", type: "text", kind: "attribute" }];
        }
        return [column];
      }),
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
    grandTotalRow: grandTotalFlatRow,
    includeColumnGrandTotal: false,
    includeWorkTime,
  };
  if (perfCollector) {
    perfCollector.responseFormattingMs = (perfCollector.responseFormattingMs || 0) + (Date.now() - formattingStartedAt);
  }
  return result;
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
        agent: [entry.agent || normalizedAgent],
      }, item.kycFtdRows || []);
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
  const finalRows = shouldHideNotWorkingFromQuery(query)
    ? rows.filter((row) => String(row.currentStatus || "").toLowerCase() === "active")
    : rows;
  return {
    months,
    rows: finalRows,
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

export async function resolveTelegramOfficeContext(telegramUser) {
  const accessContext = await resolveDashboardAccess(telegramUser);
  const officeMap = await getOfficeMonthMap().catch(() => ({
    offices: [],
    byOffice: {},
  }));
  if (!accessContext?.authorized) {
    return {
      accessContext,
      officeMap,
      allowedOffices: [],
    };
  }
  return {
    accessContext,
    officeMap,
    allowedOffices: normalizeOfficeScopeOptions(officeMap, accessContext.permissionFilters),
  };
}

export function officeMonthRecordsForOffice(officeMap = {}, officeName = "") {
  return collectOfficeScopedMonthRecords(officeMap, officeName).map((record) => ({
    ...record,
    office_name: String(officeName || record?.office_name || "").trim(),
  }));
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

// Whether the current request is one of the two reports allowed to use the
// legacy AR/AE old-data sheet (Benchmark or Last-4-Months). Everything else
// must never see this data.
function legacyReportEligible(reportMode, query, benchmarkMode) {
  if (reportMode !== "specific") {
    return false;
  }
  const isLast4 = ["1", "true", "yes", "on"].includes(normalizeText(query.last4QuickMode));
  return Boolean(benchmarkMode || isLast4);
}

// Per-agent CR target taken from the live months in ascending key order
// (April -> May -> June), per the requirement to reuse a recent month's target.
function buildCrTargetByAgent(selectedMonthData, tabConfig) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const crTargetField = getFieldName(tabConfig, "crTarget");
  const map = new Map();
  const ordered = [...selectedMonthData]
    .filter((item) => item?.monthRecord && !item.monthRecord.legacy)
    .sort((left, right) => String(left.monthRecord.key || "").localeCompare(String(right.monthRecord.key || "")));
  for (const item of ordered) {
    for (const row of item.rows || []) {
      const agent = normalizeAgentName(getRowValue(row, agentField));
      if (!agent || map.has(agent)) {
        continue;
      }
      const crTarget = toPercentNumber(getRowValue(row, crTargetField));
      if (crTarget !== null && crTarget > 0) {
        map.set(agent, crTarget);
      }
    }
  }
  return map;
}

function buildTeamLeaderByAgent(selectedMonthData, tabConfig) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  const map = new Map();
  for (const item of selectedMonthData) {
    for (const row of item.rows || []) {
      const agent = normalizeAgentName(getRowValue(row, agentField));
      if (!agent || map.has(agent)) {
        continue;
      }
      const teamLeader = String(getRowValue(row, teamLeaderField) || "").trim();
      if (teamLeader) {
        map.set(agent, teamLeader);
      }
    }
  }
  return map;
}

// Builds synthetic summary-metrics rows + an exact-value override map for the
// legacy AR/AE Jan–Mar data, scoped to the requested offices and month window.
async function buildLegacyAugmentation({
  benchmarkMode,
  isLast4,
  selectedOfficeScopes,
  selectedMonthData,
  liveMonthKeys,
  tabConfig,
}) {
  const offices = selectedOfficeScopes.filter((office) => isLegacyOffice(office));
  if (!offices.length) {
    return { rows: [], overrides: new Map() };
  }
  const crTargetByAgent = buildCrTargetByAgent(selectedMonthData, tabConfig);
  const teamLeaderByAgent = buildTeamLeaderByAgent(selectedMonthData, tabConfig);
  const allLegacyKeys = legacyMonthKeys();

  const fields = tabConfig.fields || {};
  const agentField = fields.agentNames || "AGENT NAMES";
  const officeField = fields.office || "Desk";
  const teamLeaderField = fields.teamLeader || "Team Leader";
  const ftdField = fields.ftd || "FTD";
  const crTargetField = fields.crTarget || "CR TARGET";
  const leadDateField = fields.leadDate || "Lead Date";
  const createdField = fields.created || "Created";

  const rows = [];
  const overrides = new Map();

  for (const office of offices) {
    // Last-4 window: include only the legacy months that fall within the 4 most
    // recent months once combined with the office's live months. Benchmark: all.
    let monthKeysToInclude = allLegacyKeys;
    if (isLast4 && !benchmarkMode) {
      const combined = [...new Set([...(liveMonthKeys || []), ...allLegacyKeys])]
        .sort()
        .reverse()
        .slice(0, 4);
      monthKeysToInclude = allLegacyKeys.filter((key) => combined.includes(key));
    }
    for (const monthKey of monthKeysToInclude) {
      // eslint-disable-next-line no-await-in-loop
      const legacy = await legacyAgentsForOfficeMonth(office, monthKey);
      if (!legacy) {
        continue;
      }
      const [year, month] = String(monthKey).split("-");
      const dateStr = `01/${month}/${year}`;
      const monthLabel = `${monthKey}`;
      for (const aggregate of legacy.agents) {
        const normAgent = normalizeAgentName(aggregate.agent);
        const crTarget = crTargetByAgent.get(normAgent) ?? 0;
        const leads = aggregate.cr > 0 ? aggregate.ftd / (aggregate.cr / 100) : 0;
        rows.push({
          [agentField]: aggregate.agent,
          [officeField]: office,
          [teamLeaderField]: teamLeaderByAgent.get(normAgent) || "",
          "Leads": leads,
          [ftdField]: aggregate.ftd,
          TARGET: aggregate.ftdTarget,
          [crTargetField]: crTarget,
          [leadDateField]: dateStr,
          [createdField]: dateStr,
          __sourceMonthKey: monthKey,
          __sourceMonthLabel: monthLabel,
          __scopeOfficeName: office,
          __legacyAggregate: true,
        });
        overrides.set(`${normAgent}::${monthKey}`, {
          ftd: aggregate.ftd,
          ftdTarget: aggregate.ftdTarget,
          cr: aggregate.cr,
          crTarget,
        });
      }
    }
  }
  return { rows, overrides };
}

// Reads the office "Agent ID" directory tab (A = agent name, B = HR code) and
// returns a normalized-name -> HR code map. Currently limited to the Turkey
// office; other offices return an empty map (no extra reads). Failures are
// swallowed so the report never breaks if the tab is missing.
async function loadAgentHrCodeMap(selectedMonthRecords = []) {
  const records = Array.isArray(selectedMonthRecords) ? selectedMonthRecords : [];
  const turkeyRecord = records.find((record) => {
    const office = normalizeText(record?.office_name || "");
    return (office.includes("turkiye") || office.includes("turkey")) && record?.sheet_id;
  });
  if (!turkeyRecord) {
    return new Map();
  }
  const directoryConfig = getTabConfig("agentDirectory");
  const nameField = getFieldName(directoryConfig, "agentName");
  const idField = getFieldName(directoryConfig, "agentId");
  const map = new Map();
  try {
    const rows = await readSheetRows("agentDirectory", {
      tabConfig: directoryConfig,
      spreadsheetId: turkeyRecord.sheet_id,
    });
    for (const row of rows || []) {
      const name = normalizeAgentName(getRowValue(row, nameField));
      const code = cleanSpreadsheetText(getRowValue(row, idField));
      if (name && code) {
        map.set(name, code);
      }
    }
  } catch {
    return new Map();
  }
  return map;
}

const DEFAULT_REPORT_CACHE_TTL_MS = 120000;
const REPORT_CACHE_MAX_ENTRIES = 200;
const reportResponseCache = new Map();

function reportCacheTtlMs() {
  const parsed = Number.parseInt(process.env.DASHBOARD_REPORT_CACHE_TTL_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_REPORT_CACHE_TTL_MS;
}

// Query params that change HOW a report is delivered/labelled but NOT the
// computed report object. They must be excluded from the cache key so that the
// live dashboard view (SSE, monitor=1) and the XLSX export (which adds
// reportName/sourceUrl and the traffic-priority selection) reuse the SAME cached
// report — otherwise the on-screen numbers and the downloaded file could drift
// apart when the underlying data changes between the two requests.
const CACHE_IRRELEVANT_QUERY_KEYS = new Set([
  "monitor",
  "reportName",
  "sourceUrl",
  "debugDiagnostics",
  "tpCountry",
  "tpCountries",
  "tpCampaign",
  "tpCount",
  "tpExclude",
]);

export function reportCacheKey(accessContext, query) {
  const scope = accessContext?.authorityScope?.unrestricted
    ? "all"
    : JSON.stringify(accessContext?.permissionFilters || {});
  const admin = Boolean(accessContext?.authorityScope?.admin);
  // Stable, presentation-agnostic key: sorted keys, empty values dropped, and
  // delivery-only params ignored.
  const normalizedQuery = {};
  for (const key of Object.keys(query || {}).sort()) {
    if (CACHE_IRRELEVANT_QUERY_KEYS.has(key)) {
      continue;
    }
    const value = query[key];
    if (value === "" || value === null || value === undefined) {
      continue;
    }
    normalizedQuery[key] = value;
  }
  return JSON.stringify({ scope, admin, query: normalizedQuery });
}

// Short-lived cache for computed report responses. The dashboard (SSE), the
// XLSX export and the Telegram quick reports all funnel through here, so caching
// the result for a couple of minutes lets repeated identical views skip the full
// Redis dataset read + recompute -- the main lever for Upstash READ bandwidth.
// Keyed by the caller's authority scope so restricted users never see a broader
// scope's cached result. Bypassed when custom sheet readers are injected (tests)
// so it never interferes with deterministic test fixtures.
export async function loadDashboardReport(accessContext, query = {}, options = {}) {
  const ttl = reportCacheTtlMs();
  const cacheable =
    ttl > 0 &&
    Boolean(accessContext) &&
    !options.readValues &&
    !options.getSheetTitles &&
    !options.readRows &&
    !options.kycSources;
  if (!cacheable) {
    return loadDashboardReportUncached(accessContext, query, options);
  }
  const key = reportCacheKey(accessContext, query);
  const cached = reportResponseCache.get(key);
  if (cached && Date.now() - cached.ts < ttl) {
    return cached.value;
  }
  const value = await loadDashboardReportUncached(accessContext, query, options);
  reportResponseCache.set(key, { ts: Date.now(), value });
  if (reportResponseCache.size > REPORT_CACHE_MAX_ENTRIES) {
    const oldest = [...reportResponseCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    while (reportResponseCache.size > REPORT_CACHE_MAX_ENTRIES && oldest.length) {
      reportResponseCache.delete(oldest.shift()[0]);
    }
  }
  return value;
}

async function loadDashboardReportUncached(accessContext, query = {}, options = {}) {
  const now = options.now || new Date();
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const progressHandler = typeof options.onProgress === "function" ? options.onProgress : null;
  const diagnosticsEnabled =
    ["1", "true", "yes", "on"].includes(normalizeText(query.debugDiagnostics)) || process.env.NODE_ENV !== "production";
  const stageTimings = [];
  const perfTimings = {
    googleSheetsFetchMs: 0,
    filteringMs: 0,
    groupingMs: 0,
    metricCalculationMs: 0,
    responseFormattingMs: 0,
  };
  const markStage = (name) => {
    if (diagnosticsEnabled) {
      const elapsedMs = Date.now() - startedAt;
      stageTimings.push({ name, elapsedMs });
      console.info(`[dashboard-report] ${name} ${elapsedMs}ms`);
    }
  };
  const addPerfTiming = (key, startedMs) => {
    const elapsed = Date.now() - Number(startedMs || Date.now());
    if (Object.prototype.hasOwnProperty.call(perfTimings, key)) {
      perfTimings[key] += elapsed;
    }
  };
  const assertWithinBudget = (stage) => {
    if (Date.now() - startedAt > REPORT_MAX_SAFE_DURATION_MS) {
      throw reportTooHeavyError(
        "Selected report is too heavy to process in one request. Please reduce dimensions/metrics or date range.",
        stage,
      );
    }
  };
  let totalRowsLoaded = 0;
  let rowsAfterFiltering = 0;
  let rowsProcessed = 0;
  let sheetProgressEvents = 0;
  const emitProgress = (step, progress, extra = {}) => {
    if (!progressHandler) {
      return;
    }
    progressHandler({
      startTime: startedAtIso,
      elapsedMs: Date.now() - startedAt,
      step,
      progress,
      totalRowsLoaded,
      rowsAfterFiltering,
      rowsProcessed,
      ...extra,
    });
  };
  const emitSheetProgress = (details = {}) => {
    sheetProgressEvents += 1;
    const progress = Math.min(45, 5 + sheetProgressEvents * 4);
    emitProgress("Loading Google Sheets", progress, {
      currentTab: details?.tab || "",
      currentSheet:
        details?.monthLabel && details?.office
          ? `${details.monthLabel} (${details.office})`
          : details?.sheetId || "",
    });
  };
  emitProgress("Loading Google Sheets", 5);
  const tabConfig = options.tabConfig || getTabConfig("leads");
  const ftdTabConfig = options.ftdTabConfig || getTabConfig("ftd");
  const infoAgentsTabConfig = options.infoAgentsTabConfig || getTabConfig("infoAgents");
  const reportMode = String(query.reportMode || "monthly").trim().toLowerCase();
  const specificType = String(query.specificType || "builder").trim().toLowerCase();
  const specificMetricKeys = reportMode === "specific" ? selectedSpecificMetrics(query) : [];
  const useOfficeSheetBenchmarksOnly = !["0", "false", "no", "off"].includes(
    normalizeText(query.benchmarkSheetOnly || process.env.BENCHMARK_SHEET_ONLY || "1"),
  );
  const isLeadSplitterMode = ["1", "true", "yes", "on"].includes(normalizeText(query.leadSplitter));
  const isTrafficPriorityMode = ["1", "true", "yes", "on"].includes(normalizeText(query.trafficPriority));
  const includeKycFtd =
    !isLeadSplitterMode &&
    !isTrafficPriorityMode &&
    (reportMode !== "specific" ||
      specificMetricKeys.includes("kycFtd") ||
      ["1", "true", "yes", "on"].includes(normalizeText(query.includeKycFtd)));
  const needsLegacyInfoTargets =
    reportMode !== "specific" || specificMetricKeys.includes("ftdTarget") || specificMetricKeys.includes("ftdTargetReach");
  const officeMap = await getOfficeMonthMap().catch(() => ({
    offices: [],
    byOffice: {},
  }));
  markStage("office_map_loaded");
  const requestedOfficeScopes = parseCsvSelection(query.officeScope);
  const allowedOfficeScopes = normalizeOfficeScopeOptions(officeMap, accessContext.permissionFilters);
  const benchmarkMode = ["1", "true", "yes", "on"].includes(normalizeText(query.benchmarkMode));
  const allowedOfficeScopeSet = new Set(allowedOfficeScopes.map((office) => normalizeText(office)));
  if (
    requestedOfficeScopes.length &&
    requestedOfficeScopes.some((office) => !allowedOfficeScopeSet.has(normalizeText(office)))
  ) {
    throw new Error("Please select only allowed offices.");
  }
  const selectedOfficeScopes = (requestedOfficeScopes.length ? requestedOfficeScopes : allowedOfficeScopes.slice(0, 1)).filter(
    (office) => allowedOfficeScopeSet.has(normalizeText(office)),
  );
  if (!selectedOfficeScopes.length) {
    throw new Error("Please select an allowed office to continue.");
  }
  const primaryOfficeScope = selectedOfficeScopes[0];
  const rosterRowsByOffice = new Map();
  const rosterRowsPromiseByOffice = new Map();
  const resolveOfficeRosterRows = async (officeName = "") => {
    const office = String(officeName || "").trim();
    if (!office) {
      return [];
    }
    if (rosterRowsByOffice.has(office)) {
      return rosterRowsByOffice.get(office);
    }
    if (!rosterRowsPromiseByOffice.has(office)) {
      rosterRowsPromiseByOffice.set(
        office,
        readOfficeAgentRosterRows(office)
          .then((rows) => {
            const result = Array.isArray(rows) ? rows : [];
            rosterRowsByOffice.set(office, result);
            return result;
          })
          .catch(() => {
            rosterRowsByOffice.set(office, []);
            return [];
          }),
      );
    }
    return rosterRowsPromiseByOffice.get(office);
  };
  const monthDataRequestCache = new Map();
  const readMonthDataCached = (params = {}) => {
    const cacheKey = JSON.stringify({
      officeScope: String(params?.officeScope || ""),
      monthKey: String(params?.monthRecord?.key || ""),
      sheetId: String(params?.monthRecord?.sheet_id || ""),
      skipPermissionFilters: Boolean(params?.skipPermissionFilters),
      includeLegacyInfoTargets: Boolean(params?.includeLegacyInfoTargets),
      includeKycFtd: Boolean(params?.includeKycFtd),
      permissionFilters: params?.skipPermissionFilters ? "unscoped" : JSON.stringify(params?.permissionFilters || {}),
    });
    if (!monthDataRequestCache.has(cacheKey)) {
      monthDataRequestCache.set(cacheKey, readMonthData(params));
    }
    return monthDataRequestCache.get(cacheKey);
  };
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
  const monthOptions = monthOptionsFromRecords(monthOptionsSource);
  const requestedMonthKeys = parseCsvSelection(query.monthKey);
  const fallbackMonthKey =
    monthOptions[0]?.key || resolveMonthRecord("", primaryOfficeScope, officeMap, now)?.key || "";
  const selectedMonthKeys = uniqueSelection((requestedMonthKeys.length ? requestedMonthKeys : [fallbackMonthKey]).filter(Boolean));

  const monthRecord = resolveMonthRecord(selectedMonthKeys[0], primaryOfficeScope, officeMap, now);
  if (!monthRecord?.sheet_id) {
    throw new Error("No active month mapping found.");
  }

  if (reportMode === "last4") {
    const last4FetchStartedAt = Date.now();
    const singleMonth = await readMonthDataCached({
      monthRecord,
      officeScope: primaryOfficeScope,
      tabConfig,
      ftdTabConfig,
      infoAgentsTabConfig,
      permissionFilters: accessContext.permissionFilters || {},
      officeRosterRows: await resolveOfficeRosterRows(primaryOfficeScope),
      includeLegacyInfoTargets: needsLegacyInfoTargets,
      includeKycFtd,
      onProgress: emitSheetProgress,
    });
    const monthFilter = monthFilterFromKey(monthRecord.key);
    const shouldHideNotWorking = shouldHideNotWorkingFromQuery(query);
    let modeRows = applyDashboardFilters(singleMonth.rows, tabConfig, query, now);
    const primaryScopedMonthRecords = collectOfficeScopedMonthRecords(officeMap, primaryOfficeScope)
      .filter((record) => record.active !== false)
      .sort((left, right) => String(right.key || "").localeCompare(String(left.key || "")));
    const scopedMonths = primaryScopedMonthRecords.slice(0, 4);
    const monthsForMode = scopedMonths.length ? scopedMonths : rawMonthRecords.slice(0, 4);
    const monthData = await Promise.all(
      monthsForMode.map((monthItem) => {
        if (String(monthItem?.key || "") === String(singleMonth?.monthRecord?.key || "")) {
          return singleMonth;
        }
        return readMonthDataCached({
          monthRecord: monthItem,
          officeScope: primaryOfficeScope,
          tabConfig,
          ftdTabConfig,
          infoAgentsTabConfig,
          permissionFilters: accessContext.permissionFilters || {},
          officeRosterRows: rosterRowsByOffice.get(primaryOfficeScope) || [],
          includeLegacyInfoTargets: needsLegacyInfoTargets,
          onProgress: emitSheetProgress,
        });
      }),
    );
    addPerfTiming("googleSheetsFetchMs", last4FetchStartedAt);
    assertWithinBudget("last4_fetch");
    totalRowsLoaded = monthData.reduce((sum, item) => sum + Number(item?.rows?.length || 0), 0);
    emitProgress("Applying Filters", 30);
    markStage("last4_month_data_loaded");
    const latestStatusByAgent = deriveLatestStatusByAgent(monthData);
    if (shouldHideNotWorking) {
      modeRows = filterOutNotWorkingRows(modeRows, tabConfig, {
        ...singleMonth.infoContext,
        latestStatusByAgent,
      });
    }

    const last4FilteringStartedAt = Date.now();
    const rowsByMonth = monthData.map(({ monthRecord: itemMonth, rows, infoContext, kycFtdRows = [] }) => {
      const filteredMonthRowsRaw = applyDashboardFilters(rows, tabConfig, query, now);
      const filteredMonthRows = shouldHideNotWorking
        ? filterOutNotWorkingRows(filteredMonthRowsRaw, tabConfig, {
            ...infoContext,
            latestStatusByAgent,
          })
        : filteredMonthRowsRaw;
      const thisMonthFilter = monthFilterFromKey(itemMonth.key);
      const summary = summaryWithTargets(
        filteredMonthRows,
        tabConfig,
        infoContext,
        thisMonthFilter,
        now,
        targetScopeFromRows(filteredMonthRows, tabConfig),
        kycFtdRows,
      );
      return {
        label: itemMonth.month_label,
        monthKey: itemMonth.key,
        totalLeads: summary.totalLeads,
        totalFtd: summary.totalFtd,
        kycFtd: summary.kycFtd,
        ftdTarget: summary.ftdTarget,
        ftdTargetReach: summary.ftdTargetReach,
        cr: summary.cr,
        crTarget: summary.crTarget,
        crTargetReach: summary.crTargetReach,
        selfs: summary.selfs,
        lateFtd: summary.lateFtd,
      };
    });
    addPerfTiming("filteringMs", last4FilteringStartedAt);
    rowsAfterFiltering = rowsByMonth.reduce((sum, item) => sum + Number(item?.totalLeads || 0), 0);
    rowsProcessed = rowsAfterFiltering;
    emitProgress("Calculating Metrics", 70);
    const matrix = buildLast4AgentMatrix(monthData, tabConfig, query, now, {
      latestStatusByAgent,
    });

    const summary = rollupSummaryFromRows(rowsByMonth);
    markStage("last4_summary_built");
    const last4OptionsStartedAt = Date.now();
    const last4Options = baseOptions({
      rows: singleMonth.rows,
      tabConfig,
      query,
      officeMap,
      permissionFilters: accessContext.permissionFilters || {},
      now,
      monthOptions,
    });
    addPerfTiming("responseFormattingMs", last4OptionsStartedAt);
    emitProgress("Building Table", 85);
    emitProgress("Returning Results", 100);
    console.info("[dashboard-report-timings]", JSON.stringify({ ...perfTimings, totalElapsedMs: Date.now() - startedAt }));
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
        includeColumnGrandTotal: String(query.includeColumnGrandTotal || "").trim(),
        agentProductivityPlanMode: String(query.agentProductivityPlanMode || "").trim(),
        includeWorkTime: String(query.includeWorkTime || "").trim(),
        hideNotWorking: String(query.hideNotWorking || "").trim(),
        benchmarkMode: String(query.benchmarkMode || "").trim(),
      },
      options: {
        ...last4Options,
      },
      diagnostics: diagnosticsEnabled
        ? {
            elapsedMs: Date.now() - startedAt,
            stages: stageTimings,
            timings: perfTimings,
          }
        : undefined,
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
  const selectedMonthOffices = [
    ...new Set(selectedMonthRecords.map((record) => record.office_name || primaryOfficeScope).filter(Boolean)),
  ];
  await Promise.all(selectedMonthOffices.map((office) => resolveOfficeRosterRows(office)));
  const permissionFilters = accessContext.permissionFilters || {};
  const unrestrictedOfficeScopes = normalizeOfficeScopeOptions(officeMap, {});
  const hasOfficeRestrictions = unrestrictedOfficeScopes.some((office) => !allowedOfficeScopeSet.has(normalizeText(office)));
  const hasScopedDimensionRestrictions = ["desk", "teamLeader", "agent"].some(
    (key) => normalizeStringList(permissionFilters[key]).length > 0,
  );
  const hasPermissionRestrictions = hasOfficeRestrictions || hasScopedDimensionRestrictions;
  let deskLanguageSnapshot =
    reportMode === "specific"
      ? await readOfficeDeskLanguageSnapshot()
      : { deskLanguageMap: new Map(), benchmarkCache: new Map() };
  let deskBenchmarkCache =
    deskLanguageSnapshot?.benchmarkCache instanceof Map ? deskLanguageSnapshot.benchmarkCache : new Map();
  const benchmarkHydrateRequested = ["1", "true", "yes", "on"].includes(normalizeText(query.benchmarkHydrate));
  const shouldHydrateBenchmarkCacheNow =
    reportMode === "specific" &&
    benchmarkMode &&
    !useOfficeSheetBenchmarksOnly &&
    deskBenchmarkCache.size === 0 &&
    benchmarkHydrateRequested;
  if (shouldHydrateBenchmarkCacheNow) {
    try {
      await refreshOfficeDeskLanguageBenchmarks({
        now,
        tabConfig,
        infoAgentsTabConfig,
      });
      deskLanguageSnapshot = await readOfficeDeskLanguageSnapshot({ forceRefresh: true });
      deskBenchmarkCache =
        deskLanguageSnapshot?.benchmarkCache instanceof Map ? deskLanguageSnapshot.benchmarkCache : new Map();
    } catch {
      // Fallback to existing on-demand benchmark calculation path below.
    }
  }
  const shouldLoadUnscopedSelectedMonthData =
    reportMode === "specific" &&
    benchmarkMode &&
    hasPermissionRestrictions &&
    !useOfficeSheetBenchmarksOnly &&
    deskBenchmarkCache.size === 0;
  const selectedFetchStartedAt = Date.now();
  const selectedMonthDataRaw = await Promise.all(
    selectedMonthRecords.map((record) =>
      readMonthDataCached({
        monthRecord: record,
        officeScope: record.office_name || primaryOfficeScope,
        tabConfig,
        ftdTabConfig,
        infoAgentsTabConfig,
        permissionFilters,
        officeRosterRows:
          rosterRowsByOffice.get(record.office_name || primaryOfficeScope) ||
          [],
        skipPermissionFilters: shouldLoadUnscopedSelectedMonthData,
        includeLegacyInfoTargets: needsLegacyInfoTargets,
        includeKycFtd,
        onProgress: emitSheetProgress,
      }),
    ),
  );
  addPerfTiming("googleSheetsFetchMs", selectedFetchStartedAt);
  assertWithinBudget("selected_month_fetch");
  totalRowsLoaded = selectedMonthDataRaw.reduce((sum, item) => sum + Number(item?.rows?.length || 0), 0);
  emitProgress("Applying Filters", 30);
  markStage("selected_month_data_loaded");
  const selectedMonthData = shouldLoadUnscopedSelectedMonthData
    ? selectedMonthDataRaw.map((item) => {
        const scopedRows = filterExcludedAgentRows(filterRowsByPermission(item?.rows || [], tabConfig, permissionFilters), tabConfig);
        const leadAgentField = getFieldName(tabConfig, "agentNames");
        const scopedAgents = new Set(
          scopedRows
            .map((row) => normalizeAgentName(getRowValue(row, leadAgentField)))
            .filter(Boolean),
        );
        const scopedInfoRecords = (item?.infoContext?.records || []).filter(
          (record) => scopedAgents.has(record?.normalized_name),
        );
        const scopedStartDateByAgent = new Map();
        const scopedEndDateByAgent = new Map();
        for (const normalizedAgent of scopedAgents) {
          const startDate = item?.infoContext?.startDateByAgent?.get(normalizedAgent) || "";
          if (startDate) {
            scopedStartDateByAgent.set(normalizedAgent, startDate);
          }
          const endDate = item?.infoContext?.endDateByAgent?.get(normalizedAgent) || "";
          if (endDate) {
            scopedEndDateByAgent.set(normalizedAgent, endDate);
          }
        }
        const scopedInfoContext = mergeInfoContexts([
          {
            records: scopedInfoRecords,
            startDateByAgent: scopedStartDateByAgent,
            endDateByAgent: scopedEndDateByAgent,
          },
        ]);
        const scopedStatusByAgent = new Map(
          scopedInfoContext.records.map((record) => [record.normalized_name, normalizeWorkingStatusValue(record.working_status)]),
        );
        return {
          ...item,
          rows: scopedRows,
          infoContext: scopedInfoContext,
          statusByAgent: scopedStatusByAgent,
        };
      })
    : selectedMonthDataRaw;
  const combinedRows = selectedMonthData.flatMap((item) => item.rows || []);
  const combinedKycFtdRows = combineKycFtdRowsBySourceMonth(selectedMonthData);
  const agentHrCodeByAgent = await loadAgentHrCodeMap(selectedMonthRecords).catch(() => new Map());
  const combinedInfoContext = mergeInfoContexts(selectedMonthData.map((item) => item.infoContext));
  combinedInfoContext.latestStatusByAgent = deriveLatestStatusByAgent(selectedMonthData);
  let benchmarkRowsOverride = null;
  let benchmarkInfoContextOverride = null;
  if (
    reportMode === "specific" &&
    benchmarkMode &&
    hasPermissionRestrictions &&
    !useOfficeSheetBenchmarksOnly &&
    deskBenchmarkCache.size === 0
  ) {
    const benchmarkOfficeScopes = unrestrictedOfficeScopes.length ? unrestrictedOfficeScopes : selectedOfficeScopes;
    const benchmarkFetchStartedAt = Date.now();
    const benchmarkDataset = await loadBenchmarkBaselineDataset({
      officeMap,
      officeScopes: benchmarkOfficeScopes,
      selectedMonthKeys,
      tabConfig,
      infoAgentsTabConfig,
      rosterRowsByOffice,
      resolveOfficeRosterRows,
      onProgress: emitSheetProgress,
    });
    if (benchmarkDataset.rows.length) {
      benchmarkRowsOverride = benchmarkDataset.rows;
      benchmarkInfoContextOverride = benchmarkDataset.infoContext;
    }
    addPerfTiming("googleSheetsFetchMs", benchmarkFetchStartedAt);
    assertWithinBudget("benchmark_baseline_fetch");
  }
  markStage("benchmark_baseline_prepared");
  const combinedMonthFilter = selectedMonthKeys.length === 1 ? monthFilterFromKey(selectedMonthKeys[0]) : null;
  const filteringStartedAt = Date.now();
  let modeRowsCombined = applyDashboardFilters(combinedRows, tabConfig, query, now);
  if (reportMode === "specific" && shouldHideNotWorkingFromQuery(query)) {
    modeRowsCombined = filterOutNotWorkingRows(modeRowsCombined, tabConfig, combinedInfoContext);
  }
  addPerfTiming("filteringMs", filteringStartedAt);
  assertWithinBudget("filtering");

  // Legacy AR/AE old-data (Jan–Mar): only for Benchmark and Last-4 reports. The
  // synthetic rows are appended AFTER filtering so the not-working filter never
  // drops historical agents, and they never reach any other report.
  let legacyOverrides = null;
  if (legacyReportEligible(reportMode, query, benchmarkMode)) {
    const isLast4 = ["1", "true", "yes", "on"].includes(normalizeText(query.last4QuickMode));
    const liveMonthKeys = [
      ...new Set(
        selectedMonthData
          .map((item) => String(item?.monthRecord?.key || ""))
          .filter(Boolean),
      ),
    ];
    const legacyAugmentation = await buildLegacyAugmentation({
      benchmarkMode,
      isLast4,
      selectedOfficeScopes,
      selectedMonthData,
      liveMonthKeys,
      tabConfig,
    });
    if (legacyAugmentation.rows.length) {
      // Legacy synthetic rows are only office-scoped. Apply the caller's
      // sub-office restrictions (team leader / agent) so a scoped user never
      // sees legacy agents from outside their own team. Desk/country are left
      // out on purpose: legacy aggregates carry the office name as their desk
      // and have no country, so filtering on those would wrongly drop the
      // caller's own legitimate legacy rows.
      let legacyRows = legacyAugmentation.rows;
      const scopedLegacyFilters = {};
      if (normalizeStringList(permissionFilters.teamLeader).length) {
        scopedLegacyFilters.teamLeader = permissionFilters.teamLeader;
      }
      if (normalizeStringList(permissionFilters.agent).length) {
        scopedLegacyFilters.agent = permissionFilters.agent;
      }
      if (Object.keys(scopedLegacyFilters).length) {
        legacyRows = filterRowsByPermission(legacyRows, tabConfig, scopedLegacyFilters);
      }
      if (legacyRows.length) {
        modeRowsCombined = modeRowsCombined.concat(legacyRows);
        legacyOverrides = legacyAugmentation.overrides;
      }
    }
  }

  rowsAfterFiltering = modeRowsCombined.length;
  rowsProcessed = rowsAfterFiltering;
  emitProgress("Grouping Data", 55);

  let summary = summaryWithTargets(
    modeRowsCombined,
    tabConfig,
    combinedInfoContext,
    combinedMonthFilter,
    now,
    targetScopeFromRows(modeRowsCombined, tabConfig),
    combinedKycFtdRows,
  );
  let table = [];
  let tableType = "pivot";
  let tableTitle = "Pivot CRM Table";
  let builder = null;
  let deskLanguageMap = deskLanguageSnapshot?.deskLanguageMap instanceof Map ? deskLanguageSnapshot.deskLanguageMap : new Map();

  if (isTrafficPriorityMode) {
    // Traffic Distribution renders only from the trafficPriority payload, so
    // skip the (potentially huge) builder table / per-month target passes.
    table = [];
    tableType = "trafficpriority";
    tableTitle = "Traffic Distribution";
  } else if (reportMode === "specific") {
    const filteredRowsByMonthKey = new Map();
    for (const row of modeRowsCombined) {
      const monthKey = String(row?.__sourceMonthKey || "").trim();
      if (!monthKey) {
        continue;
      }
      if (!filteredRowsByMonthKey.has(monthKey)) {
        filteredRowsByMonthKey.set(monthKey, []);
      }
      filteredRowsByMonthKey.get(monthKey).push(row);
    }
    const summaryTargetFromMonths = selectedMonthData.reduce((sum, item) => {
      const monthKey = String(item?.monthRecord?.key || "").trim();
      if (!monthKey) {
        return sum;
      }
      const monthRows = filteredRowsByMonthKey.get(monthKey) || [];
      if (!monthRows.length) {
        return sum;
      }
      const monthSummary = summaryWithTargets(
        monthRows,
        tabConfig,
        item?.infoContext || combinedInfoContext,
        monthFilterFromKey(monthKey),
        now,
        {
          ...targetScopeFromRows(monthRows, tabConfig),
          restrictToRows: true,
          preferInfoTargets: true,
        },
        (item?.kycFtdRows || []).filter((row) => {
          const rowMonthKey = String(row?.__sourceMonthKey || "").trim();
          return !rowMonthKey || rowMonthKey === monthKey;
        }),
      );
      return sum + Number(monthSummary.ftdTarget || 0);
    }, 0);
    summary = {
      ...summary,
      ftdTarget: summaryTargetFromMonths,
      ftdTargetReach: targetReachPercent(summary.totalFtd, summaryTargetFromMonths),
    };
    const selectedDimensionsForComplexity = selectedSpecificDimensions(query).length;
    const selectedMetricsForComplexity = selectedSpecificMetrics(query).length;
    const complexityScore =
      Number(modeRowsCombined.length || 0) *
      Math.max(1, selectedDimensionsForComplexity) *
      Math.max(1, selectedMetricsForComplexity);
    if (complexityScore > 10_000_000) {
      throw reportTooHeavyError(
        "Selected report is too heavy. Please reduce dimensions, metrics, or month range.",
        "complexity_guard",
      );
    }
    const infoContextByMonthKey = new Map(
      selectedMonthData
        .map((item) => [String(item?.monthRecord?.key || ""), item?.infoContext || null])
        .filter(([monthKey, context]) => monthKey && context),
    );
    const builderPerfCollector = diagnosticsEnabled ? {} : null;
    const builderStartedAt = Date.now();
    builder = specificBuilderTable(modeRowsCombined, tabConfig, combinedInfoContext, combinedMonthFilter, query, now, {
      infoContextByMonthKey,
      deskLanguageMap,
      deskBenchmarkCache,
      useOfficeSheetBenchmarksOnly,
      useLatestAgentHierarchy: selectedMonthKeys.length > 1,
      benchmarkRowsOverride,
      benchmarkInfoContextOverride,
      legacyOverrides,
      perfCollector: builderPerfCollector,
      kycFtdRows: combinedKycFtdRows,
      agentHrCodeByAgent,
      shouldAbort: () => Date.now() - startedAt > REPORT_MAX_SAFE_DURATION_MS,
      onProgress: (info = {}) => {
        const processed = Number(info.rowsProcessed || 0);
        if (processed > rowsProcessed) {
          rowsProcessed = processed;
        }
        if (info.step) {
          emitProgress(info.step, info.progress || 60);
        }
      },
    });
    if (builderPerfCollector) {
      perfTimings.groupingMs += Number(builderPerfCollector.groupingMs || 0);
      perfTimings.metricCalculationMs += Number(builderPerfCollector.metricCalculationMs || 0);
      perfTimings.responseFormattingMs += Number(builderPerfCollector.responseFormattingMs || 0);
    } else {
      addPerfTiming("groupingMs", builderStartedAt);
    }
    table = builder.table;
    tableType = "builder";
    tableTitle = "Specific Report Builder";
    rowsProcessed = Math.max(rowsProcessed, Number(builder?.table?.length || 0));
    emitProgress("Building Table", 85);
    markStage("specific_builder_built");
  } else if (requestedGroupField !== "agentNames") {
    const groupedStartedAt = Date.now();
    table = groupTable(modeRowsCombined, tabConfig, combinedInfoContext, combinedMonthFilter, requestedGroupField, now);
    addPerfTiming("groupingMs", groupedStartedAt);
    addPerfTiming("metricCalculationMs", groupedStartedAt);
    tableType = "simple";
    tableTitle = `Grouped by ${String(query.groupBy || "Agent")}`;
    rowsProcessed = Math.max(rowsProcessed, Number(table?.length || 0));
    emitProgress("Calculating Metrics", 75);
    emitProgress("Building Table", 85);
    markStage("group_table_built");
  } else {
    const pivotStartedAt = Date.now();
    table = pivotTableRows(modeRowsCombined, tabConfig, combinedInfoContext, combinedMonthFilter, now);
    addPerfTiming("groupingMs", pivotStartedAt);
    addPerfTiming("metricCalculationMs", pivotStartedAt);
    tableType = "pivot";
    tableTitle = "Pivot CRM Table";
    rowsProcessed = Math.max(rowsProcessed, Number(table?.length || 0));
    emitProgress("Calculating Metrics", 75);
    emitProgress("Building Table", 85);
    markStage("pivot_table_built");
  }
  const parsedPage = Number.parseInt(String(query.page || "1"), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const parsedRowLimit = Number.parseInt(String(query.rowLimit || ""), 10);
  const totalRows = Array.isArray(table) ? table.length : 0;
  // Comparison reports aggregate every leaf row on the client, so paginating the
  // response would drop teams/agents from the comparison tables. Return the full
  // set for that mode; all other reports keep the normal response cap.
  const wantsFullRows = ["1", "true", "yes", "on"].includes(normalizeText(query.comparisonMode));
  const rowLimit = wantsFullRows
    ? Math.max(totalRows, 1)
    : Number.isFinite(parsedRowLimit) && parsedRowLimit > 0
      ? Math.min(parsedRowLimit, 5000)
      : REPORT_MAX_RESPONSE_ROWS;
  const offset = Math.max(0, (page - 1) * rowLimit);
  const paginatedTable = Array.isArray(table) ? table.slice(offset, offset + rowLimit) : table;
  const pagination = {
    page,
    rowLimit,
    totalRows,
    totalPages: totalRows > 0 ? Math.ceil(totalRows / rowLimit) : 0,
    truncated: totalRows > offset + rowLimit,
  };
  table = paginatedTable;
  assertWithinBudget("table_pagination");
  emitProgress("Returning Results", 95);

  const selectedMonthLabel =
    selectedMonthKeys.length === 1
      ? monthOptions.find((item) => item.key === selectedMonthKeys[0])?.month_label || monthRecord.month_label
      : `${selectedMonthKeys.length} Months`;
  const selectedOfficeLabel = selectedOfficeScopes.length === 1 ? selectedOfficeScopes[0] : `${selectedOfficeScopes.length} Offices`;
  const useFastOptions =
    reportMode === "specific" || selectedMonthRecords.length > 2 || combinedRows.length > 5000;
  markStage("options_preparing");
  const optionsStartedAt = Date.now();
  const reportOptions = useFastOptions
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
      });
  addPerfTiming("responseFormattingMs", optionsStartedAt);
  assertWithinBudget("response_formatting");
  emitProgress("Returning Results", 100);
  console.info("[dashboard-report-timings]", JSON.stringify({ ...perfTimings, totalElapsedMs: Date.now() - startedAt }));

  const leadSplitterReport = isLeadSplitterMode
    ? buildLeadSplitterReport(modeRowsCombined, tabConfig, { now, dateFilter: combinedMonthFilter })
    : null;
  const trafficPriorityReport = isTrafficPriorityMode
    ? buildTrafficPriorityReport(modeRowsCombined, tabConfig, { now })
    : null;

  return {
    reportMode: reportMode === "specific" ? "specific" : "monthly",
    specificType: reportMode === "specific" ? "builder" : "",
    tableType: isTrafficPriorityMode ? "trafficpriority" : isLeadSplitterMode ? "leadsplitter" : tableType,
    leadSplitter: leadSplitterReport,
    trafficPriority: trafficPriorityReport,
    month: {
      key: selectedMonthKeys.join(",") || monthRecord.key,
      label: selectedMonthLabel,
      sheet_id: selectedMonthRecords[0]?.monthRecord?.sheet_id || selectedMonthRecords[0]?.sheet_id || monthRecord.sheet_id,
      office_name: selectedOfficeLabel,
    },
    summary: {
      totalLeads: summary.totalLeads,
      totalFtd: summary.totalFtd,
      kycFtd: summary.kycFtd,
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
    pagination,
    builder,
    stats: isTrafficPriorityMode
      ? {}
      : buildDashboardStats(modeRowsCombined, tabConfig, combinedInfoContext, combinedMonthFilter, now),
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
      includeColumnGrandTotal: String(query.includeColumnGrandTotal || "").trim(),
      agentProductivityPlanMode: String(query.agentProductivityPlanMode || "").trim(),
      includeWorkTime: String(query.includeWorkTime || "").trim(),
      hideNotWorking: String(query.hideNotWorking || "").trim(),
      benchmarkMode: String(query.benchmarkMode || "").trim(),
    },
    options: {
      ...reportOptions,
      builderDimensions: SPECIFIC_DIMENSIONS.map((item) => ({ key: item.key, label: item.label, type: item.type })),
      builderMetrics: SPECIFIC_METRICS.map((item) => ({ key: item.key, label: item.label, type: item.type })),
      builderColumnDimensions: [
        { key: "month", label: "Months", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "hour", label: "Hour", type: "hour" },
      ],
    },
    diagnostics: diagnosticsEnabled
      ? {
          elapsedMs: Date.now() - startedAt,
          stages: stageTimings,
          timings: perfTimings,
          kycFtdSourceRows: combinedKycFtdRows.length,
          kycFtdSummaryTotal: Number(summary.kycFtd || 0),
        }
      : undefined,
  };
}
