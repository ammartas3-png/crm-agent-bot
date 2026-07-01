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

function asEnabled(value = "") {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function toMetricNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
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
  const expectedDimensions = ["country", "campaign", "placement", "subCampaign", "teamLeader", "agent"];
  const expectedMetrics = ["leads", "ftd", "cr", "crTargetReach"];
  const dimensionsMatch =
    rowDimensions.length === expectedDimensions.length &&
    expectedDimensions.every((dimension) => rowDimensions.includes(dimension));
  const metricsMatch =
    metricFields.length === expectedMetrics.length &&
    expectedMetrics.every((metric) => metricFields.includes(metric));
  return dimensionsMatch && metricsMatch && !String(query.columnDimension || "").trim();
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
    baseCompare = toMetricNumber(left[sortKey]) - toMetricNumber(right[sortKey]);
  }
  if (baseCompare === 0) {
    baseCompare = String(left.label || "").localeCompare(String(right.label || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }
  return sortDirection === "asc" ? baseCompare : -baseCompare;
}

export function buildComparisonTables(rows = [], selections = {}, sortByTable = {}) {
  const cleanRows = Array.isArray(rows) ? rows.filter((row) => row && row.__rowKind !== "total") : [];

  return COMPARISON_TABLE_DIMENSIONS.map((dimension) => {
    const filteredRows = cleanRows.filter((row) =>
      COMPARISON_TABLE_DIMENSIONS.every((dimensionItem) => {
        if (dimensionItem.key === dimension.key) {
          return true;
        }
        const selectedValue = String(selections?.[dimensionItem.key] || "").trim();
        if (!selectedValue) {
          return true;
        }
        const rowValue = String(row?.[dimensionItem.key] || "").trim();
        return rowValue === selectedValue;
      }),
    );

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
      const leads = toMetricNumber(row?.leads);
      const ftd = toMetricNumber(row?.ftd);
      const crTarget = toMetricNumber(row?.crTarget);
      const crTargetReach = toMetricNumber(row?.crTargetReach);
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

export function comparisonSheetName(label = "") {
  return String(label || "")
    .trim()
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 31);
}
