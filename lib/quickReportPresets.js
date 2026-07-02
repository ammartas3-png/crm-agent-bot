const QUICK_PRESET_ROW_DIMENSIONS = ["desk", "teamLeader", "agent"];
const QUICK_PRESET_MONTHLY_METRICS = [
  "leads",
  "kycFtd",
  "ftd",
  "ftdTarget",
  "ftdTargetReach",
  "cr",
  "crTarget",
  "crTargetReach",
  "lateFtd",
  "lateFtdRate",
];
const QUICK_PRESET_LAST4_METRICS = ["ftd", "ftdTarget", "ftdTargetReach", "cr", "crTarget", "crTargetReach"];
const QUICK_PRESET_TRAFFIC_ROW_DIMENSIONS = ["desk", "country", "campaign", "subCampaign", "placement"];
const QUICK_PRESET_TRAFFIC_METRICS = [
  "leadShare",
  "agentCount",
  "avgLeadByAgent",
  "ftd",
  "cr",
  "crTargetReach",
  "missingFtd",
];
const QUICK_PRESET_BENCHMARK_METRICS = ["ftd", "agentAvgFtdPerWorkedMonth", "avgFtdByDeskLongTerm", "ftdBenchmarkRate"];
const QUICK_PRESET_COUNTRY_DAILY_ROW_DIMENSIONS = ["country"];
const QUICK_PRESET_COUNTRY_DAILY_METRICS = ["cr", "leads", "ftd", "crTarget", "crTargetReach", "missingFtd"];
const QUICK_PRESET_DESK_COUNTRY_CR_ROW_DIMENSIONS = ["desk", "country"];
const QUICK_PRESET_DESK_COUNTRY_CR_METRICS = ["ftd", "crTargetReach", "cr"];
const QUICK_PRESET_COUNTRY_CAMPAIGN_CR_ROW_DIMENSIONS = ["hour", "country"];
const QUICK_PRESET_COUNTRY_CAMPAIGN_CR_METRICS = ["leads", "ftd", "cr", "crTarget", "crTargetReach"];
const QUICK_PRESET_STATUS_ROW_DIMENSIONS = ["status"];
const QUICK_PRESET_STATUS_METRICS = ["leadShare", "leads", "ftd", "cr", "crTarget", "crTargetReach"];
const QUICK_PRESET_COMPARISON_ROW_DIMENSIONS = ["country", "campaign", "placement", "subCampaign", "teamLeader", "agent"];
const QUICK_PRESET_COMPARISON_METRICS = ["leads", "ftd", "cr", "crTargetReach"];
const QUICK_PRESET_AGENT_PRODUCTIVITY_ROW_DIMENSIONS = ["country"];
const QUICK_PRESET_AGENT_PRODUCTIVITY_METRICS = [
  "leads",
  "ftd",
  "cr",
  "crTargetReach",
  "crTarget",
  "ftdTarget",
  "agentCount",
];

export const QUICK_REPORT_PRESET_KEYS = [
  "monthly",
  "last4",
  "traffic",
  "country-daily",
  "benchmark",
  "desk-country-cr",
  "country-campaign-hourly-cr",
  "status-watch",
  "comparison-report",
  "agent-productivity-plan",
];

export const QUICK_REPORT_PRESET_LABELS = {
  monthly: "Monthly Quick",
  last4: "Last 4 Months Quick",
  traffic: "Traffic Reports",
  "country-daily": "Country Daily Watch",
  benchmark: "Benchmark Report",
  "desk-country-cr": "Desk Country Daily CR Watch",
  "country-campaign-hourly-cr": "Country Campaign Hourly CR Watch",
  "status-watch": "Status Performance Watch",
  "comparison-report": "Comparison Report",
  "agent-productivity-plan": "Agent Productivity vs Plan Report",
};

function clearedTopFilters() {
  return {
    date: "",
    hour: "",
    desk: "",
    country: "",
    brand: "",
    campaign: "",
    subCampaign: "",
    placement: "",
    status: "",
    teamLeader: "",
    agent: "",
  };
}

export function buildQuickReportQuery({
  office = "",
  monthKeys = [],
  preset = "monthly",
} = {}) {
  const defaultMonth = monthKeys[0] || "";
  const base = {
    officeScope: office,
    reportMode: "specific",
    specificType: "builder",
    benchmarkMode: "0",
    agentProductivityPlanMode: "0",
    last4QuickMode: "0",
    columnDimension: "",
    includeColumnGrandTotal: "0",
    includeWorkTime: "0",
    hideNotWorking: "0",
    groupBy: "agent",
    totalDimensions: "",
    ...clearedTopFilters(),
  };

  if (preset === "monthly") {
    return {
      ...base,
      monthKey: defaultMonth,
      includeWorkTime: "1",
      hideNotWorking: "1",
      rowDimensions: QUICK_PRESET_ROW_DIMENSIONS.join(","),
      metricFields: QUICK_PRESET_MONTHLY_METRICS.join(","),
    };
  }
  if (preset === "last4") {
    return {
      ...base,
      monthKey: monthKeys.slice(0, 4).join(","),
      columnDimension: "month",
      last4QuickMode: "1",
      includeWorkTime: "1",
      hideNotWorking: "1",
      rowDimensions: QUICK_PRESET_ROW_DIMENSIONS.join(","),
      metricFields: QUICK_PRESET_LAST4_METRICS.join(","),
    };
  }
  if (preset === "traffic") {
    return {
      ...base,
      monthKey: defaultMonth,
      rowDimensions: QUICK_PRESET_TRAFFIC_ROW_DIMENSIONS.join(","),
      metricFields: QUICK_PRESET_TRAFFIC_METRICS.join(","),
    };
  }
  if (preset === "country-daily") {
    return {
      ...base,
      monthKey: defaultMonth,
      rowDimensions: QUICK_PRESET_COUNTRY_DAILY_ROW_DIMENSIONS.join(","),
      metricFields: QUICK_PRESET_COUNTRY_DAILY_METRICS.join(","),
    };
  }
  if (preset === "benchmark") {
    return {
      ...base,
      monthKey: monthKeys.join(","),
      includeWorkTime: "1",
      benchmarkMode: "1",
      rowDimensions: QUICK_PRESET_ROW_DIMENSIONS.join(","),
      metricFields: QUICK_PRESET_BENCHMARK_METRICS.join(","),
    };
  }
  if (preset === "desk-country-cr") {
    return {
      ...base,
      monthKey: defaultMonth,
      columnDimension: "date",
      rowDimensions: QUICK_PRESET_DESK_COUNTRY_CR_ROW_DIMENSIONS.join(","),
      metricFields: QUICK_PRESET_DESK_COUNTRY_CR_METRICS.join(","),
    };
  }
  if (preset === "country-campaign-hourly-cr") {
    return {
      ...base,
      monthKey: defaultMonth,
      rowDimensions: QUICK_PRESET_COUNTRY_CAMPAIGN_CR_ROW_DIMENSIONS.join(","),
      metricFields: QUICK_PRESET_COUNTRY_CAMPAIGN_CR_METRICS.join(","),
    };
  }
  if (preset === "status-watch") {
    return {
      ...base,
      monthKey: defaultMonth,
      rowDimensions: QUICK_PRESET_STATUS_ROW_DIMENSIONS.join(","),
      metricFields: QUICK_PRESET_STATUS_METRICS.join(","),
    };
  }
  if (preset === "comparison-report") {
    return {
      ...base,
      monthKey: defaultMonth,
      rowDimensions: QUICK_PRESET_COMPARISON_ROW_DIMENSIONS.join(","),
      metricFields: QUICK_PRESET_COMPARISON_METRICS.join(","),
    };
  }
  if (preset === "agent-productivity-plan") {
    return {
      ...base,
      monthKey: monthKeys.join(","),
      columnDimension: "month",
      agentProductivityPlanMode: "1",
      rowDimensions: QUICK_PRESET_AGENT_PRODUCTIVITY_ROW_DIMENSIONS.join(","),
      metricFields: QUICK_PRESET_AGENT_PRODUCTIVITY_METRICS.join(","),
    };
  }
  throw new Error(`Unknown quick preset: ${preset}`);
}
