import { quickReportLabel } from "./activityLogService.js";

export function dashboardActivityFromQuery(query = {}, options = {}) {
  const activityQuickPreset = String(
    options.activityQuickPreset || query.activityQuickPreset || query.quickPreset || "",
  ).trim();
  const reportMode = String(query.reportMode || "").trim();
  const specificType = String(query.specificType || "").trim();
  const officeScope = String(query.officeScope || "").trim();
  const monthKey = String(query.monthKey || "").trim();
  const metricFields = String(query.metricFields || "").trim();
  const rowDimensions = String(query.rowDimensions || "").trim();
  const page = String(options.page || query.page || "").trim();

  let action = String(options.action || "").trim();
  if (!action) {
    if (page === "approved-deposits") {
      action = "approved_deposits";
    } else if (activityQuickPreset) {
      action = "quick_report";
    } else {
      action = "report";
    }
  }

  const details = {
    reportMode,
    specificType,
    rowDimensions,
    last4QuickMode: query.last4QuickMode || "",
    benchmarkMode: query.benchmarkMode || "",
    agentProductivityPlanMode: query.agentProductivityPlanMode || "",
    desk: query.desk || "",
    country: query.country || "",
    campaign: query.campaign || "",
    status: query.status || "",
    teamLeader: query.teamLeader || "",
    agent: query.agent || "",
    language: query.language || "",
    brand: query.brand || "",
    method: query.method || "",
    department: query.department || "",
    ftd: query.ftd || "",
    office: query.office || "",
  };

  return {
    action,
    activityQuickPreset,
    quickReport: quickReportLabel(activityQuickPreset) || page || "",
    office: officeScope || query.office || "",
    month: monthKey,
    metrics: metricFields,
    details,
  };
}
