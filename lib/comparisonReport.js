import { calculateSummary, getFieldName, getRowValue } from "./calculations.js";

export const COMPARISON_TABLE_DIMENSIONS = [
  { key: "country", label: "Country" },
  { key: "teamLeader", label: "Team Leader" },
  { key: "agent", label: "Agent" },
  { key: "campaign", label: "Campaign" },
  { key: "placement", label: "Placement" },
  { key: "subCampaign", label: "Sub-Campaign" },
];

export const COMPARISON_DEFAULT_SORT = { key: "leads", direction: "desc" };

export const COMPARISON_COLUMNS = [
  { key: "label", label: "Name", type: "text" },
  { key: "leads", label: "Leads", type: "number" },
  { key: "ftd", label: "FTD", type: "number" },
  { key: "cr", label: "CR", type: "percent" },
  { key: "crTargetReach", label: "CR Reach", type: "percent" },
];

const COMPARISON_DIMENSION_FIELD_KEYS = {
  country: "country",
  campaign: "campaign",
  placement: "placement",
  subCampaign: "subCampaign",
  teamLeader: "teamLeader",
  agent: "agentNames",
};

const COMPARISON_ROW_DIMENSIONS = ["country", "campaign", "placement", "subCampaign", "teamLeader", "agent"];
const COMPARISON_METRICS = ["leads", "ftd", "cr", "crTargetReach"];

function asEnabled(value = "") {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function isComparisonReportQuery(query = {}) {
  if (asEnabled(query.comparisonMode)) {
    return true;
  }
  const rowDimensions = String(query.rowDimensions || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const metricFields = String(query.metricFields || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const dimensionsMatch =
    rowDimensions.length === COMPARISON_ROW_DIMENSIONS.length &&
    COMPARISON_ROW_DIMENSIONS.every((dimension) => rowDimensions.includes(dimension));
  const metricsMatch =
    metricFields.length >= COMPARISON_METRICS.length &&
    COMPARISON_METRICS.every((metric) => metricFields.includes(metric));
  return dimensionsMatch && metricsMatch && !String(query.columnDimension || "").trim();
}

function dimensionValueForComparisonRow(row = {}, tabConfig = {}, dimensionKey = "") {
  const fieldKey = COMPARISON_DIMENSION_FIELD_KEYS[dimensionKey] || dimensionKey;
  const fieldName = getFieldName(tabConfig, fieldKey);
  const value = String(getRowValue(row, fieldName) || "").trim();
  return value || "-";
}

function rowMatchesSelections(row = {}, tabConfig = {}, selections = {}, skipDimensionKey = "") {
  return COMPARISON_TABLE_DIMENSIONS.every((dimension) => {
    if (dimension.key === skipDimensionKey) {
      return true;
    }
    const selectedValue = String(selections?.[dimension.key] || "").trim();
    if (!selectedValue) {
      return true;
    }
    return dimensionValueForComparisonRow(row, tabConfig, dimension.key) === selectedValue;
  });
}

function compareComparisonRows(left, right, sortState = COMPARISON_DEFAULT_SORT) {
  const sortKey = sortState.key || "leads";
  const sortDirection = sortState.direction === "asc" ? "asc" : "desc";
  let baseCompare = 0;
  if (sortKey === "label") {
    baseCompare = String(left.label || "").localeCompare(String(right.label || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  } else {
    baseCompare = Number(left[sortKey] || 0) - Number(right[sortKey] || 0);
  }
  if (baseCompare === 0) {
    baseCompare = String(left.label || "").localeCompare(String(right.label || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }
  return sortDirection === "asc" ? baseCompare : -baseCompare;
}

function rowMatchesDetailSelections(row = {}, selections = {}, skipDimensionKey = "") {
  return COMPARISON_TABLE_DIMENSIONS.every((dimension) => {
    if (dimension.key === skipDimensionKey) {
      return true;
    }
    const selectedValue = String(selections?.[dimension.key] || "").trim();
    if (!selectedValue) {
      return true;
    }
    return String(row?.[dimension.key] || "").trim() === selectedValue;
  });
}

export function buildComparisonDetailRows(rows = [], tabConfig = {}, monthFilter = null, now = new Date()) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const filters = monthFilter ? { date: monthFilter } : {};
  const grouped = new Map();

  for (const row of sourceRows) {
    const values = Object.fromEntries(
      COMPARISON_TABLE_DIMENSIONS.map((dimension) => [
        dimension.key,
        dimensionValueForComparisonRow(row, tabConfig, dimension.key),
      ]),
    );
    if (COMPARISON_TABLE_DIMENSIONS.some((dimension) => !values[dimension.key] || values[dimension.key] === "-")) {
      continue;
    }
    const key = COMPARISON_TABLE_DIMENSIONS.map((dimension) => values[dimension.key]).join("::");
    if (!grouped.has(key)) {
      grouped.set(key, { values, rows: [] });
    }
    grouped.get(key).rows.push(row);
  }

  return [...grouped.values()].map(({ values, rows: groupRows }) => {
    const summary = calculateSummary(groupRows, tabConfig, filters, now);
    return {
      ...values,
      leads: Number(summary.totalLeads || 0),
      ftd: Number(summary.totalFtd || 0),
      cr: Number(summary.cr || 0),
      crTarget: Number(summary.crTarget || 0),
      crTargetReach: Number(summary.crTargetReach || 0),
    };
  });
}

export function buildComparisonTablesFromDetailRows(detailRows = [], selections = {}, sortByTable = {}) {
  const sourceRows = Array.isArray(detailRows) ? detailRows : [];

  return COMPARISON_TABLE_DIMENSIONS.map((dimension) => {
    const filteredRows = sourceRows.filter((row) => rowMatchesDetailSelections(row, selections, dimension.key));
    const grouped = new Map();

    for (const row of filteredRows) {
      const label = String(row?.[dimension.key] || "").trim();
      if (!label || label === "-") {
        continue;
      }
      if (!grouped.has(label)) {
        grouped.set(label, { label, leads: 0, ftd: 0, targetBase: 0 });
      }
      const bucket = grouped.get(label);
      const leads = Number(row.leads || 0);
      const ftd = Number(row.ftd || 0);
      const crTarget = Number(row.crTarget || 0);
      const crTargetReach = Number(row.crTargetReach || 0);
      bucket.leads += leads;
      bucket.ftd += ftd;
      if (crTarget > 0) {
        bucket.targetBase += leads * (crTarget / 100);
      } else if (crTargetReach > 0 && ftd > 0) {
        bucket.targetBase += ftd / (crTargetReach / 100);
      }
    }

    const sortState = sortByTable?.[dimension.key] || COMPARISON_DEFAULT_SORT;
    const data = [...grouped.values()]
      .map((item) => ({
        label: item.label,
        leads: item.leads,
        ftd: item.ftd,
        cr: item.leads > 0 ? (item.ftd / item.leads) * 100 : 0,
        crTargetReach: item.targetBase > 0 ? (item.ftd / item.targetBase) * 100 : 0,
      }))
      .sort((left, right) => compareComparisonRows(left, right, sortState));

    return {
      ...dimension,
      rows: data,
      sort: sortState,
    };
  });
}

export function buildComparisonTablesFromRows(
  rows = [],
  tabConfig = {},
  monthFilter = null,
  now = new Date(),
  selections = {},
  sortByTable = {},
) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const filters = monthFilter ? { date: monthFilter } : {};

  return COMPARISON_TABLE_DIMENSIONS.map((dimension) => {
    const filteredRows = sourceRows.filter((row) => rowMatchesSelections(row, tabConfig, selections, dimension.key));
    const grouped = new Map();
    for (const row of filteredRows) {
      const label = dimensionValueForComparisonRow(row, tabConfig, dimension.key);
      if (!label || label === "-") {
        continue;
      }
      if (!grouped.has(label)) {
        grouped.set(label, []);
      }
      grouped.get(label).push(row);
    }

    const sortState = sortByTable?.[dimension.key] || COMPARISON_DEFAULT_SORT;
    const data = [...grouped.entries()]
      .map(([label, groupRows]) => {
        const summary = calculateSummary(groupRows, tabConfig, filters, now);
        return {
          label,
          leads: Number(summary.totalLeads || 0),
          ftd: Number(summary.totalFtd || 0),
          cr: Number(summary.cr || 0),
          crTargetReach: Number(summary.crTargetReach || 0),
        };
      })
      .sort((left, right) => compareComparisonRows(left, right, sortState));

    return {
      ...dimension,
      rows: data,
      sort: sortState,
    };
  });
}

export function parseComparisonSelections(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function comparisonSheetName(label = "") {
  return String(label || "")
    .trim()
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 31);
}
