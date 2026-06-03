const MONTHS = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const COLUMN_ALIAS_GROUPS = {
  office: ["office", "desk"],
  desk: ["desk", "office"],
  department: ["department", "desk", "office"],
  "agent name": ["agent name", "agent", "agent names", "first call agent"],
  "agent names": ["agent names", "agent name", "agent", "first call agent"],
  agent: ["agent", "agent name", "agent names", "first call agent"],
  "first call agent": ["first call agent", "agent", "agent name", "agent names"],
};

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, " ")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/i̇/g, "i");
}

function normalizedList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => normalizeText(item)).filter(Boolean))];
  }
  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
}

function directRowValue(row, columnName) {
  if (!columnName) {
    return "";
  }
  if (Object.prototype.hasOwnProperty.call(row, columnName)) {
    return row[columnName];
  }
  const normalizedColumn = normalizeText(columnName);
  const foundKey = Object.keys(row).find((key) => normalizeText(key) === normalizedColumn);
  return foundKey ? row[foundKey] : "";
}

function rawPermissionValue(row, tabConfig, fieldKey) {
  if (fieldKey === "office") {
    return (
      directRowValue(row, "Office") ||
      row.__scopeOfficeName ||
      ""
    );
  }
  if (fieldKey === "desk") {
    return (
      directRowValue(row, "Desk") ||
      directRowValue(row, getFieldName(tabConfig, "desk")) ||
      directRowValue(row, "Department") ||
      directRowValue(row, getFieldName(tabConfig, "department")) ||
      ""
    );
  }
  if (fieldKey === "teamLeader") {
    return directRowValue(row, "Team Leader") || directRowValue(row, getFieldName(tabConfig, "teamLeader")) || "";
  }
  if (fieldKey === "agent") {
    return (
      directRowValue(row, "AGENT NAMES") ||
      directRowValue(row, getFieldName(tabConfig, "agentNames")) ||
      directRowValue(row, "First Call Agent") ||
      directRowValue(row, getFieldName(tabConfig, "firstCallAgent")) ||
      ""
    );
  }
  if (fieldKey === "country") {
    return directRowValue(row, "Country") || directRowValue(row, getFieldName(tabConfig, "country")) || "";
  }
  return "";
}

export function normalizedPermissionValue(row, tabConfig, fieldKey) {
  return normalizeText(rawPermissionValue(row, tabConfig, fieldKey));
}

function permissionFilterValues(permissionFilters = {}, fieldKey) {
  if (fieldKey === "desk") {
    return normalizedList([
      ...(Array.isArray(permissionFilters.desk) ? permissionFilters.desk : []),
      ...(Array.isArray(permissionFilters.officeOrDepartment) ? permissionFilters.officeOrDepartment : []),
      ...(Array.isArray(permissionFilters.department) ? permissionFilters.department : []),
    ]);
  }
  return normalizedList(permissionFilters[fieldKey]);
}

function hasAnyPermissionFilter(permissionFilters = {}) {
  return ["office", "desk", "teamLeader", "agent", "country"].some(
    (key) => permissionFilterValues(permissionFilters, key).length > 0,
  );
}

export function rowMatchesPermissionFilters(row, tabConfig, permissionFilters = {}) {
  if (!hasAnyPermissionFilter(permissionFilters)) {
    return true;
  }
  const officeValues = permissionFilterValues(permissionFilters, "office");
  const deskValues = permissionFilterValues(permissionFilters, "desk");
  const teamLeaderValues = permissionFilterValues(permissionFilters, "teamLeader");
  const agentValues = permissionFilterValues(permissionFilters, "agent");
  const countryValues = permissionFilterValues(permissionFilters, "country");
  const office = normalizedPermissionValue(row, tabConfig, "office");
  const desk = normalizedPermissionValue(row, tabConfig, "desk");
  const teamLeader = normalizedPermissionValue(row, tabConfig, "teamLeader");
  const agent = normalizedPermissionValue(row, tabConfig, "agent");
  const country = normalizedPermissionValue(row, tabConfig, "country");

  if (officeValues.length > 0 && !officeValues.includes(office)) {
    return false;
  }
  if (deskValues.length > 0 && !deskValues.includes(desk)) {
    return false;
  }
  if (teamLeaderValues.length > 0 && !teamLeaderValues.includes(teamLeader)) {
    return false;
  }
  if (agentValues.length > 0 && !agentValues.includes(agent)) {
    return false;
  }
  if (countryValues.length > 0 && !countryValues.includes(country)) {
    return false;
  }
  return true;
}

export function filterRowsByPermission(rows = [], tabConfig, permissionFilters = {}) {
  if (!hasAnyPermissionFilter(permissionFilters)) {
    return rows;
  }
  return rows.filter((row) => rowMatchesPermissionFilters(row, tabConfig, permissionFilters));
}

export function permissionFilterDebug(rows = [], tabConfig, permissionFilters = {}) {
  const fields = ["office", "desk", "teamLeader", "agent", "country"];
  const normalizedFilters = Object.fromEntries(fields.map((field) => [field, permissionFilterValues(permissionFilters, field)]));
  const availableByField = {};
  const matchedByField = {};
  const unmatchedByField = {};
  for (const field of fields) {
    const available = [...new Set(rows.map((row) => normalizedPermissionValue(row, tabConfig, field)).filter(Boolean))].sort(
      (left, right) => left.localeCompare(right),
    );
    availableByField[field] = available;
    const selected = normalizedFilters[field] || [];
    matchedByField[field] = selected.filter((value) => available.includes(value));
    unmatchedByField[field] = selected.filter((value) => !available.includes(value));
  }
  let remaining = [...rows];
  const steps = [];
  let culprit = "";
  for (const field of fields) {
    const selected = normalizedFilters[field] || [];
    if (!selected.length) {
      continue;
    }
    const before = remaining.length;
    remaining = remaining.filter((row) => rowMatchesPermissionFilters(row, tabConfig, { [field]: selected }));
    const after = remaining.length;
    steps.push({ field, before, after, selected });
    if (!culprit && before > 0 && after === 0) {
      culprit = field;
    }
  }
  return {
    rowsBeforePermission: rows.length,
    rowsAfterPermission: remaining.length,
    normalizedFilters,
    availableByField,
    matchedByField,
    unmatchedByField,
    steps,
    culpritField: culprit,
  };
}

export function getRowValue(row, columnName) {
  if (!columnName) {
    return "";
  }

  if (Object.prototype.hasOwnProperty.call(row, columnName)) {
    return row[columnName];
  }

  const normalizedColumn = normalizeText(columnName);
  const foundKey = Object.keys(row).find((key) => normalizeText(key) === normalizedColumn);
  if (foundKey) {
    return row[foundKey];
  }
  const aliases = COLUMN_ALIAS_GROUPS[normalizedColumn] || [];
  if (!aliases.length) {
    return "";
  }
  const aliasedKey = Object.keys(row).find((key) => aliases.includes(normalizeText(key)));
  return aliasedKey ? row[aliasedKey] : "";
}

export function getFieldName(tabConfig, fieldKey) {
  return tabConfig.fields?.[fieldKey] || tabConfig[`${fieldKey}Column`] || fieldKey;
}

export function parseDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number") {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
  }

  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const dmyMatch = text.match(
    /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dmyMatch) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = dmyMatch;
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ),
    );
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sameUtcDate(left, right) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

export function parseMonth(text) {
  const normalized = normalizeText(text);
  const found = Object.entries(MONTHS).find(([name]) =>
    new RegExp(`\\b${name}\\b`, "i").test(normalized),
  );
  return found ? found[1] : null;
}

export function dateMatches(value, filter, now = new Date()) {
  if (!filter) {
    return true;
  }

  const date = parseDateValue(value);
  if (!date) {
    return false;
  }

  if (filter.type === "today") {
    return sameUtcDate(date, now);
  }

  if (filter.type === "month") {
    const year = filter.year || now.getUTCFullYear();
    return date.getUTCFullYear() === year && date.getUTCMonth() === filter.month;
  }

  if (filter.type === "range") {
    const start = filter.start ? parseDateValue(filter.start) : null;
    const end = filter.end ? parseDateValue(filter.end) : null;
    if (start && date < start) {
      return false;
    }
    if (end) {
      const endOfDay = new Date(end);
      endOfDay.setUTCHours(23, 59, 59, 999);
      if (date > endOfDay) {
        return false;
      }
    }
    return true;
  }

  return true;
}

export function createDateRangeFilter(key, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!key || key === "all") {
    return null;
  }

  if (key === "today") {
    return { label: "Today", filter: { type: "today" } };
  }

  if (key === "yesterday") {
    const yesterday = new Date(today.getTime() - DAY_MS);
    return {
      label: "Yesterday",
      filter: {
        type: "range",
        start: yesterday.toISOString().slice(0, 10),
        end: yesterday.toISOString().slice(0, 10),
      },
    };
  }

  if (key === "thisMonth") {
    return {
      label: "This Month",
      filter: { type: "month", month: now.getUTCMonth(), year: now.getUTCFullYear() },
    };
  }

  if (key === "lastMonth") {
    const month = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
    const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    return {
      label: "Last Month",
      filter: { type: "month", month, year },
    };
  }

  return null;
}

export function rowMatchesFilters(row, tabConfig, filters = {}, now = new Date()) {
  const summaryRow = isSummaryMetricsRow(row, tabConfig);
  const normalizedFilterValues = (value) => {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeText(item)).filter(Boolean);
    }
    const normalized = normalizeText(value);
    return normalized ? [normalized] : [];
  };
  const matchesExactField = (fieldKey, filterValue) => {
    const expectedValues = normalizedFilterValues(filterValue);
    if (!expectedValues.length) {
      return true;
    }
    const rowValue = normalizeText(getRowValue(row, getFieldName(tabConfig, fieldKey)));
    return expectedValues.includes(rowValue);
  };
  const matchesContainsField = (fieldKey, filterValue) => {
    const expectedValues = normalizedFilterValues(filterValue);
    if (!expectedValues.length) {
      return true;
    }
    const rowValue = normalizeText(
      getRowValue(row, getFieldName(tabConfig, fieldKey)) ||
        getRowValue(row, getFieldName(tabConfig, "firstCallAgent")),
    );
    return expectedValues.some((expected) => rowValue.includes(expected));
  };
  const matchesContainsExactField = (fieldKey, filterValue) => {
    const expectedValues = normalizedFilterValues(filterValue);
    if (!expectedValues.length) {
      return true;
    }
    const rowValue = normalizeText(getRowValue(row, getFieldName(tabConfig, fieldKey)));
    return expectedValues.some((expected) => rowValue.includes(expected));
  };
  const matchesExactAnyField = (fieldKeys = [], filterValue) => {
    const expectedValues = normalizedFilterValues(filterValue);
    if (!expectedValues.length) {
      return true;
    }
    return fieldKeys.some((fieldKey) => {
      const rowValue = normalizeText(getRowValue(row, getFieldName(tabConfig, fieldKey)));
      return expectedValues.includes(rowValue);
    });
  };
  const matchesContainsAnyField = (fieldKeys = [], filterValue) => {
    const expectedValues = normalizedFilterValues(filterValue);
    if (!expectedValues.length) {
      return true;
    }
    const rowValues = fieldKeys.map((fieldKey) => normalizeText(getRowValue(row, getFieldName(tabConfig, fieldKey))));
    return expectedValues.some((expected) => rowValues.some((rowValue) => rowValue.includes(expected)));
  };
  const scopeOfficeValue = normalizeText(row.__scopeOfficeName || "");
  const matchesOfficeScope = (filterValue) => {
    const expectedValues = normalizedFilterValues(filterValue);
    if (!expectedValues.length) {
      return true;
    }
    const rowOffice = normalizeText(getRowValue(row, "Office") || getRowValue(row, getFieldName(tabConfig, "office")));
    return expectedValues.includes(scopeOfficeValue) || expectedValues.includes(rowOffice);
  };
  const matchesOfficeScopeContains = (filterValue) => {
    const expectedValues = normalizedFilterValues(filterValue);
    if (!expectedValues.length) {
      return true;
    }
    const rowValues = [
      scopeOfficeValue,
      normalizeText(getRowValue(row, getFieldName(tabConfig, "office"))),
      normalizeText(getRowValue(row, getFieldName(tabConfig, "desk"))),
      normalizeText(getRowValue(row, getFieldName(tabConfig, "department"))),
      normalizeText(getRowValue(row, getFieldName(tabConfig, "country"))),
    ];
    return expectedValues.some((expected) => rowValues.some((rowValue) => rowValue.includes(expected)));
  };
  const dateValueForField = (dateFieldKey = "created") => {
    if (dateFieldKey === "ftdDate") {
      const explicitFtdDate = getRowValue(row, getFieldName(tabConfig, "ftdDate"));
      if (isPresent(explicitFtdDate)) {
        return explicitFtdDate;
      }
      const hasFtdSignal =
        isPresent(getRowValue(row, getFieldName(tabConfig, "ftdMaker"))) ||
        isFtd(getRowValue(row, getFieldName(tabConfig, "ftd")));
      if (!hasFtdSignal) {
        return "";
      }
      for (const fieldKey of ["created", "leadDate"]) {
        const value = getRowValue(row, getFieldName(tabConfig, fieldKey));
        if (isPresent(value)) {
          return value;
        }
      }
      return "";
    }
    const candidateFieldKeys = [dateFieldKey];
    if (dateFieldKey === "leadDate") {
      candidateFieldKeys.push("created");
    } else if (dateFieldKey === "created") {
      candidateFieldKeys.push("leadDate");
    }
    for (const fieldKey of candidateFieldKeys) {
      const columnName = getFieldName(tabConfig, fieldKey);
      const value = getRowValue(row, columnName);
      if (isPresent(value)) {
        return value;
      }
    }
    return "";
  };

  if (!isPresent(getRowValue(row, getFieldName(tabConfig, "id"))) && !summaryRow) {
    return false;
  }

  if (!matchesExactField("country", filters.country)) {
    return false;
  }

  if (!matchesOfficeScope(filters.office)) {
    return false;
  }
  if (!matchesOfficeScopeContains(filters.officeContains)) {
    return false;
  }

  if (!matchesExactField("teamLeader", filters.teamLeader)) {
    return false;
  }

  if (!matchesExactField("department", filters.department)) {
    return false;
  }
  if (Array.isArray(filters.officeOrDepartment) && filters.officeOrDepartment.length > 0) {
    const expectedValues = filters.officeOrDepartment.map((item) => normalizeText(item)).filter(Boolean);
    const rowOffice = normalizeText(getRowValue(row, getFieldName(tabConfig, "office")));
    const rowDesk = normalizeText(getRowValue(row, getFieldName(tabConfig, "desk")));
    const rowDepartment = normalizeText(getRowValue(row, getFieldName(tabConfig, "department")));
    if (!expectedValues.includes(rowOffice) && !expectedValues.includes(rowDesk) && !expectedValues.includes(rowDepartment)) {
      return false;
    }
  }
  if (Array.isArray(filters.desk) && filters.desk.length > 0) {
    const expectedValues = filters.desk.map((item) => normalizeText(item)).filter(Boolean);
    const rowDesk = normalizeText(
      getRowValue(row, "Desk") ||
        getRowValue(row, getFieldName(tabConfig, "desk")) ||
        getRowValue(row, "Department") ||
        getRowValue(row, getFieldName(tabConfig, "department")),
    );
    if (!expectedValues.includes(rowDesk)) {
      return false;
    }
  }

  if (!matchesContainsField(filters.agentField || "agentNames", filters.agent)) {
    return false;
  }

  if (!matchesExactField("brand", filters.brand)) {
    return false;
  }

  if (!matchesExactField("campaign", filters.campaign)) {
    return false;
  }

  if (!matchesExactField("placement", filters.placement)) {
    return false;
  }

  if (!matchesExactField("subCampaign", filters.subCampaign)) {
    return false;
  }

  if (!matchesExactField("status", filters.status)) {
    return false;
  }

  if (filters.date) {
    const dateValue = dateValueForField(filters.dateField || "created");
    if (!isPresent(dateValue)) {
      if (!summaryRow) {
        return false;
      }
    } else if (!dateMatches(dateValue, filters.date, now)) {
      return false;
    }
  }

  if (filters.hourRange) {
    const dateValue = dateValueForField(filters.dateField || "created");
    const date = parseDateValue(dateValue);
    if (!date) {
      return false;
    }
    const hour = date.getUTCHours();
    const startHour = Number(filters.hourRange.start);
    const endHour = Number(filters.hourRange.end);
    if (Number.isFinite(startHour) && hour < startHour) {
      return false;
    }
    if (Number.isFinite(endHour) && hour > endHour) {
      return false;
    }
  }

  return true;
}

export function withoutDateFilters(filters = {}) {
  const { date, dateField, hourRange, ...rest } = filters;
  return rest;
}

export function onlyDateFilters(filters = {}) {
  return {
    ...(filters.date ? { date: filters.date } : {}),
    ...(filters.hourRange ? { hourRange: filters.hourRange } : {}),
  };
}

export function getLeadRowsByDateRange(rows, tabConfig, filters = {}, now = new Date()) {
  return filteredRows(
    rows,
    tabConfig,
    {
      ...withoutDateFilters(filters),
      ...(filters.date ? { date: filters.date, dateField: "leadDate" } : {}),
      ...(filters.hourRange ? { hourRange: filters.hourRange, dateField: "created" } : {}),
    },
    now,
  );
}

export function getFtdRowsByDateRange(rows, tabConfig, filters = {}, now = new Date()) {
  return filteredRows(
    rows,
    tabConfig,
    {
      ...withoutDateFilters(filters),
      ...(filters.date ? { date: filters.date, dateField: "ftdDate" } : {}),
      ...(filters.hourRange ? { hourRange: filters.hourRange, dateField: "ftdDate" } : {}),
    },
    now,
  );
}

export function countRows(rows, tabConfig, filters = {}, now = new Date()) {
  return rows.filter((row) => rowMatchesFilters(row, tabConfig, filters, now)).length;
}

export function sumRows(rows, tabConfig, filters = {}, now = new Date()) {
  return rows
    .filter((row) => rowMatchesFilters(row, tabConfig, filters, now))
    .reduce((total, row) => {
      const rawAmount = getRowValue(row, tabConfig.amountColumn);
      const amount = Number(rawAmount);
      return Number.isFinite(amount) ? total + amount : total;
    }, 0);
}

export function calculateMetric(metric, rows, tabConfig, filters = {}, now = new Date()) {
  if (metric.key === "totalLeads") {
    return calculateSummary(rows, tabConfig, filters, now).totalLeads;
  }
  if (metric.key === "totalFtd" || metric.key === "ftdCount") {
    return calculateSummary(rows, tabConfig, filters, now).totalFtd;
  }
  if (metric.key === "cr") {
    return calculateSummary(rows, tabConfig, filters, now).cr;
  }
  if (metric.key === "crTargetReach") {
    return calculateSummary(rows, tabConfig, filters, now).crTargetReach;
  }
  if (metric.key === "lateFtd") {
    return calculateSummary(rows, tabConfig, filters, now).lateFtd;
  }

  if (metric.operation === "sum") {
    return sumRows(rows, tabConfig, filters, now);
  }

  return countRows(rows, tabConfig, filters, now);
}

export function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function isFtd(value) {
  const normalized = String(value ?? "")
    .replace(/^[']+/, "")
    .replace(",", ".")
    .trim()
    .toLocaleLowerCase("en-US");
  if (normalized === "1" || normalized === "1.0" || normalized === "true" || normalized === "yes") {
    return true;
  }
  return Number(normalized) === 1;
}

export function isDifferentMonth(value) {
  return isPresent(value);
}

function normalizedFlag(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function parseNumberValue(value) {
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

function leadMetricValue(row, tabConfig) {
  const fields = tabConfig.fields || {};
  const candidates = [getRowValue(row, fields.leads), getRowValue(row, "Leads"), getRowValue(row, "Lead")];
  for (const candidate of candidates) {
    const parsed = parseNumberValue(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return 0;
}

function ftdMetricValue(row, tabConfig) {
  const fields = tabConfig.fields || {};
  const candidates = [
    getRowValue(row, fields.ftd),
    getRowValue(row, "FTD"),
    getRowValue(row, "FTD'S"),
    getRowValue(row, "FTDS"),
  ];
  for (const candidate of candidates) {
    const parsed = parseNumberValue(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return 0;
}

function lateFtdMetricValue(row, tabConfig) {
  const fields = tabConfig.fields || {};
  const candidates = [getRowValue(row, fields.lateFtdPlus30Day), getRowValue(row, "Late FTD")];
  for (const candidate of candidates) {
    const parsed = parseNumberValue(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return 0;
}

function isSummaryMetricsRow(row, tabConfig) {
  const fields = tabConfig.fields || {};
  if (isPresent(getRowValue(row, fields.id))) {
    return false;
  }
  const agentName =
    getRowValue(row, fields.agentNames) ||
    getRowValue(row, "AGENT NAMES") ||
    getRowValue(row, "Agent") ||
    getRowValue(row, "Agent Name") ||
    "";
  const office = getRowValue(row, fields.office) || getRowValue(row, "Office") || getRowValue(row, "Desk") || "";
  const workingStatus = getRowValue(row, fields.workingStatus) || getRowValue(row, "Working Status") || "";
  const normalizedAgent = normalizeText(agentName);
  const normalizedOffice = normalizeText(office);
  const normalizedStatus = normalizeText(workingStatus);
  const headerLike =
    ["agent", "agent name", "agent names"].includes(normalizedAgent) ||
    normalizedOffice === "office" ||
    normalizedOffice === "desk" ||
    normalizedStatus === "working status";
  if (headerLike) {
    return false;
  }
  return (
    isPresent(agentName) ||
    isPresent(office) ||
    leadMetricValue(row, tabConfig) > 0 ||
    ftdMetricValue(row, tabConfig) > 0
  );
}

export function isFlagOne(value) {
  const normalized = normalizedFlag(value);
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function daysBetween(startValue, endValue) {
  const start = parseDateValue(startValue);
  const end = parseDateValue(endValue);
  if (!start || !end) {
    return null;
  }
  return (end.getTime() - start.getTime()) / DAY_MS;
}

export function toPercentNumber(value) {
  if (!isPresent(value)) {
    return null;
  }

  const cleaned = String(value).replace("%", "").replace(",", ".").trim();
  const number = Number(cleaned);
  if (!Number.isFinite(number)) {
    return null;
  }
  return number <= 1 ? number * 100 : number;
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "0.00%";
  }
  return `${value.toFixed(2)}%`;
}

export function filteredRows(rows, tabConfig, filters = {}, now = new Date()) {
  return rows.filter((row) => rowMatchesFilters(row, tabConfig, filters, now));
}

export function calculateValidLeads(leadRows, tabConfig) {
  const summaryRows = leadRows.filter((row) => isSummaryMetricsRow(row, tabConfig));
  if (summaryRows.length && summaryRows.length === leadRows.length) {
    const totalLeads = summaryRows.reduce((sum, row) => sum + leadMetricValue(row, tabConfig), 0);
    return {
      rawLeadCount: totalLeads,
      differentMonthCount: 0,
      totalLeads,
      differentMonthLeads: 0,
      validLeads: totalLeads,
    };
  }
  const fields = tabConfig.fields || {};
  const rawLeadCount = leadRows.length;
  const differentMonthLeads = leadRows.filter((row) =>
    isDifferentMonth(getRowValue(row, fields.differentMonth)),
  ).length;
  const totalLeads = Math.max(rawLeadCount - differentMonthLeads, 0);

  return {
    rawLeadCount,
    differentMonthCount: differentMonthLeads,
    totalLeads,
    differentMonthLeads,
    validLeads: totalLeads,
  };
}

export function calculateFtdCount(ftdRows, tabConfig) {
  const fields = tabConfig.fields || {};
  return ftdRows.reduce((sum, row) => {
    if (isSummaryMetricsRow(row, tabConfig)) {
      return sum + ftdMetricValue(row, tabConfig);
    }
    if (isPresent(getRowValue(row, fields.ftdMaker))) {
      return sum + 1;
    }
    if (isFtd(getRowValue(row, fields.ftd))) {
      return sum + 1;
    }
    return sum;
  }, 0);
}

export function calculateCR(totalFtd, totalLeads) {
  return totalLeads > 0 ? (totalFtd / totalLeads) * 100 : 0;
}

export function calculateLateFtdCount(ftdRows, tabConfig) {
  const fields = tabConfig.fields || {};
  const flagField = fields.lateFtdPlus30Day;
  const hasFlagColumn =
    flagField &&
    ftdRows.some((row) =>
      Object.keys(row).some((key) => normalizeText(key) === normalizeText(flagField)),
    );

  return ftdRows.reduce((sum, row) => {
    if (isSummaryMetricsRow(row, tabConfig)) {
      return sum + lateFtdMetricValue(row, tabConfig);
    }
    if (!isPresent(getRowValue(row, fields.ftdMaker))) {
      return sum;
    }
    if (hasFlagColumn) {
      return sum + (isFlagOne(getRowValue(row, flagField)) ? 1 : 0);
    }
    const days = daysBetween(getRowValue(row, fields.created), getRowValue(row, fields.ftdDate));
    return sum + (days !== null && days > 30 ? 1 : 0);
  }, 0);
}

export function calculateSelfsCount(leadRows, tabConfig) {
  const fields = tabConfig.fields || {};
  return leadRows.reduce((sum, row) => {
    const parsed = parseNumberValue(getRowValue(row, fields.selfsIndicator));
    if (parsed !== null) {
      return sum + parsed;
    }
    return sum + (Number(getRowValue(row, fields.selfsIndicator)) === 1 ? 1 : 0);
  }, 0);
}

export function calculateSummary(rows, tabConfig, filters = {}, now = new Date()) {
  const contextRows = filteredRows(rows, tabConfig, withoutDateFilters(filters), now);
  const leadRows = getLeadRowsByDateRange(rows, tabConfig, filters, now);
  const ftdRows = getFtdRowsByDateRange(rows, tabConfig, filters, now);
  const fields = tabConfig.fields || {};

  const { rawLeadCount, differentMonthCount, totalLeads, differentMonthLeads, validLeads } = calculateValidLeads(
    leadRows,
    tabConfig,
  );
  const totalFtd = calculateFtdCount(ftdRows, tabConfig);
  const cr = calculateCR(totalFtd, totalLeads);

  const targets = leadRows
    .map((row) => toPercentNumber(getRowValue(row, fields.crTarget)))
    .filter((value) => value !== null);
  const crTarget =
    targets.length > 0 ? targets.reduce((total, value) => total + value, 0) / targets.length : 0;
  const crTargetReach = crTarget > 0 ? (cr / crTarget) * 100 : 0;

  const lateFtd = calculateLateFtdCount(ftdRows, tabConfig);
  const selfs = calculateSelfsCount(leadRows, tabConfig);

  return {
    rawLeadCount,
    differentMonthCount,
    totalLeads,
    differentMonthLeads,
    validLeads,
    totalFtd,
    cr,
    crTarget,
    crTargetReach,
    selfs,
    lateFtd,
    leadRowsByLeadDate: leadRows.length,
    ftdRowsByFtdDate: ftdRows.length,
    rows: leadRows,
    leadRows,
    ftdRows,
    contextRows,
  };
}

export function statusDistribution(rows, tabConfig, filters = {}, now = new Date()) {
  const statusField = getFieldName(tabConfig, "status");
  const counts = new Map();
  for (const row of filteredRows(rows, tabConfig, withoutDateFilters(filters), now)) {
    const status = String(getRowValue(row, statusField) || "Unknown").trim() || "Unknown";
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return [...counts.entries()]
    .map(([label, value]) => ({
      label,
      value,
      percentage: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

export function topPerformers(
  rows,
  tabConfig,
  filters = {},
  fieldKey = "agentNames",
  metricKey = "totalFtd",
  limit = Number.POSITIVE_INFINITY,
  now = new Date(),
) {
  const fieldName = getFieldName(tabConfig, fieldKey);
  const groups = new Map();
  for (const row of filteredRows(rows, tabConfig, withoutDateFilters(filters), now)) {
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
    .map(([label, groupRows]) => ({
      label,
      summary: calculateSummary(groupRows, tabConfig, onlyDateFilters(filters), now),
    }))
    .map((item) => ({
      label: item.label,
      value:
        metricKey === "validLeads"
          ? item.summary.validLeads
          : metricKey === "totalLeads"
            ? item.summary.totalLeads
            : item.summary.totalFtd,
      cr: item.summary.cr,
      totalFtd: item.summary.totalFtd,
      validLeads: item.summary.validLeads,
    }))
    .sort((left, right) => right.value - left.value || right.cr - left.cr)
    .slice(0, Number.isFinite(limit) ? limit : undefined);
}

export function hourlyDistribution(
  rows,
  tabConfig,
  filters = {},
  dateFieldKey = "created",
  metricKey = "totalFtd",
  now = new Date(),
) {
  const dateField = getFieldName(tabConfig, dateFieldKey);
  const buckets = new Map();
  for (const row of filteredRows(
    rows,
    tabConfig,
    {
      ...withoutDateFilters(filters),
      ...(filters.date ? { date: filters.date, dateField: dateFieldKey } : {}),
      ...(filters.hourRange ? { hourRange: filters.hourRange, dateField: dateFieldKey } : {}),
    },
    now,
  )) {
    const date = parseDateValue(getRowValue(row, dateField));
    if (!date) {
      continue;
    }
    const hour = date.getUTCHours();
    if (!buckets.has(hour)) {
      buckets.set(hour, []);
    }
    buckets.get(hour).push(row);
  }
  return [...buckets.entries()]
    .map(([hour, bucketRows]) => {
      const summary = calculateSummary(bucketRows, tabConfig, onlyDateFilters(filters), now);
      return {
        label: `${String(hour).padStart(2, "0")}:00`,
        value: metricKey === "totalLeads" ? summary.totalLeads : summary.totalFtd,
        leads: summary.validLeads,
        ftd: summary.totalFtd,
        cr: summary.cr,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function uniqueValues(rows, tabConfig, fieldKey, limit = Number.POSITIVE_INFINITY) {
  const fieldName = getFieldName(tabConfig, fieldKey);
  const idField = getFieldName(tabConfig, "id");
  const values = new Set();
  for (const row of rows) {
    if (!isPresent(getRowValue(row, idField))) {
      continue;
    }
    const value = String(getRowValue(row, fieldName) || "").trim();
    if (value) {
      values.add(value);
    }
  }
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  return Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;
}

export function groupPerformance(
  rows,
  tabConfig,
  filters = {},
  fieldKey,
  limit = Number.POSITIVE_INFINITY,
  sortBy = "totalFtd",
  now = new Date(),
  options = {},
) {
  const fieldName = getFieldName(tabConfig, fieldKey);
  const groups = new Map();
  for (const row of filteredRows(rows, tabConfig, withoutDateFilters(filters), now)) {
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
    .map(([label, groupRows]) => ({
      label,
      summary: calculateSummary(groupRows, tabConfig, onlyDateFilters(filters), now),
    }))
    .filter((item) =>
      options.minValidLeads ? item.summary.validLeads >= options.minValidLeads : true,
    )
    .sort((left, right) => {
      if (sortBy === "cr") {
        return right.summary.cr - left.summary.cr || right.summary.totalFtd - left.summary.totalFtd;
      }
      return right.summary.totalFtd - left.summary.totalFtd || right.summary.cr - left.summary.cr;
    })
    .slice(0, Number.isFinite(limit) ? limit : undefined);
}

export function generateReport({ rows, tabConfig, groupField, selectedValue, dateRange, now = new Date() }) {
  const filters = {};
  if (groupField && selectedValue) {
    filters[groupField] = selectedValue;
  }
  if (dateRange?.filter) {
    filters.date = dateRange.filter;
  }

  return {
    filters,
    dateRangeLabel: dateRange?.label || "All Data",
    summary: calculateSummary(rows, tabConfig, filters, now),
  };
}
