const DASHBOARD_QUERY_KEYS = [
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
  "benchmarkMode",
  "benchmarkHydrate",
  "benchmarkSheetOnly",
  "includeKycFtd",
  "debugDiagnostics",
  "page",
  "rowLimit",
  "monitor",
];

function normalizeScalar(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item || "").split(","))
      .map((item) => item.trim())
      .filter(Boolean)
      .join(",");
  }
  if (typeof value === "boolean") {
    return value ? "1" : "";
  }
  return String(value || "").trim();
}

export function knownDashboardQueryKeys() {
  return [...DASHBOARD_QUERY_KEYS];
}

export function parseDashboardQueryFromSearchParams(searchParams) {
  const source = searchParams && typeof searchParams.get === "function" ? searchParams : new URLSearchParams();
  const query = {};
  for (const key of DASHBOARD_QUERY_KEYS) {
    query[key] = normalizeScalar(source.get(key));
  }
  return query;
}

export function normalizeDashboardQueryPayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const query = {};
  for (const key of DASHBOARD_QUERY_KEYS) {
    query[key] = normalizeScalar(source[key]);
  }
  return query;
}

export function isEnabledFlag(value = "", fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}
