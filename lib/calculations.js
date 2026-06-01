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

export function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-US");
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
  return foundKey ? row[foundKey] : "";
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

  if (!isPresent(getRowValue(row, getFieldName(tabConfig, "id")))) {
    return false;
  }

  if (!matchesExactField("country", filters.country)) {
    return false;
  }

  if (!matchesExactField("office", filters.office)) {
    return false;
  }
  if (!matchesContainsExactField("office", filters.officeContains)) {
    return false;
  }

  if (!matchesExactField("teamLeader", filters.teamLeader)) {
    return false;
  }

  if (!matchesExactField("department", filters.department)) {
    return false;
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
    const dateValue = getRowValue(row, getFieldName(tabConfig, filters.dateField || "created"));
    if (!dateMatches(dateValue, filters.date, now)) {
      return false;
    }
  }

  if (filters.hourRange) {
    const dateValue = getRowValue(row, getFieldName(tabConfig, filters.dateField || "created"));
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
  return Number(String(value ?? "").replace(",", ".").trim()) === 1;
}

export function isDifferentMonth(value) {
  return isPresent(value);
}

function normalizedFlag(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
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
  return ftdRows.filter((row) => isPresent(getRowValue(row, fields.ftdMaker))).length;
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

  return ftdRows.filter((row) => {
    if (!isPresent(getRowValue(row, fields.ftdMaker))) {
      return false;
    }
    if (hasFlagColumn) {
      return isFlagOne(getRowValue(row, flagField));
    }
    const days = daysBetween(getRowValue(row, fields.created), getRowValue(row, fields.ftdDate));
    return days !== null && days > 30;
  }).length;
}

export function calculateSelfsCount(leadRows, tabConfig) {
  const fields = tabConfig.fields || {};
  return leadRows.filter((row) => Number(getRowValue(row, fields.selfsIndicator)) === 1).length;
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
