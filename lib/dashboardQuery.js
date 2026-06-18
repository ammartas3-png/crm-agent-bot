export const DASHBOARD_QUERY_KEYS = [
  "monthKey",
  "officeScope",
  "reportMode",
  "specificType",
  "date",
  "hour",
  "desk",
  "country",
  "brand",
  "campaign",
  "subCampaign",
  "placement",
  "status",
  "teamLeader",
  "agent",
  "groupBy",
  "rowDimensions",
  "metricFields",
  "totalDimensions",
  "columnDimension",
  "includeColumnGrandTotal",
  "agentProductivityPlanMode",
  "last4QuickMode",
  "includeWorkTime",
  "hideNotWorking",
  "comparisonMode",
  "comparisonSelections",
  "benchmarkMode",
  "page",
  "rowLimit",
];

export function dashboardQueryParams(searchParams) {
  const params = {};
  for (const key of DASHBOARD_QUERY_KEYS) {
    params[key] = String(searchParams.get(key) || "").trim();
  }
  return params;
}

export function dashboardQueryFromString(value = "") {
  return dashboardQueryParams(new URLSearchParams(String(value || "")));
}

export function dashboardQueryFromObject(input = {}) {
  const params = new URLSearchParams();
  for (const key of DASHBOARD_QUERY_KEYS) {
    const value = input?.[key];
    if (value === undefined || value === null) {
      continue;
    }
    const normalized = String(value).trim();
    if (!normalized) {
      continue;
    }
    params.set(key, normalized);
  }
  return dashboardQueryParams(params);
}
