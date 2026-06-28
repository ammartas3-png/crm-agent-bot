import {
  calculateSummary,
  groupPerformance,
  hourlyDistribution,
  statusDistribution,
} from "./calculations.js";

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function compactSummary(summary) {
  return {
    totalLeads: summary.totalLeads,
    validLeads: summary.validLeads,
    totalFtd: summary.totalFtd,
    lateFtd: summary.lateFtd,
    cr: round2(summary.cr),
    crTarget: round2(summary.crTarget),
    crTargetReach: round2(summary.crTargetReach),
    rawLeadCount: summary.rawLeadCount,
    differentMonth: summary.differentMonthCount,
  };
}

function compactGroups(items = []) {
  return items.map((item) => ({
    label: item.label,
    totalFtd: item.summary.totalFtd,
    validLeads: item.summary.validLeads,
    totalLeads: item.summary.totalLeads,
    cr: round2(item.summary.cr),
  }));
}

// Produces the full dashboard payload (summary metrics + quick reports) as JSON,
// reusing the exact KPI calculations the Telegram bot uses.
export function buildDashboard(rows, tabConfig, filters = {}, now = new Date(), options = {}) {
  const limit = options.limit || 10;
  const minValidLeads = options.minValidLeads ?? 20;

  const summary = calculateSummary(rows, tabConfig, filters, now);

  const quick = {
    topAgentsByFtd: compactGroups(
      groupPerformance(rows, tabConfig, filters, "agentNames", limit, "totalFtd", now),
    ),
    topAgentsByCr: compactGroups(
      groupPerformance(rows, tabConfig, filters, "agentNames", limit, "cr", now, {
        minValidLeads,
      }),
    ),
    topTeamLeaders: compactGroups(
      groupPerformance(rows, tabConfig, filters, "teamLeader", limit, "totalFtd", now),
    ),
    topCampaigns: compactGroups(
      groupPerformance(rows, tabConfig, filters, "campaign", limit, "totalFtd", now),
    ),
    topCountries: compactGroups(
      groupPerformance(rows, tabConfig, filters, "country", limit, "cr", now),
    ),
    statusDistribution: statusDistribution(rows, tabConfig, filters, now).map((item) => ({
      label: item.label,
      value: item.value,
      percentage: round2(item.percentage),
    })),
    hourly: hourlyDistribution(rows, tabConfig, filters, "created", "totalFtd", now).map((item) => ({
      hour: item.label,
      leads: item.leads,
      ftd: item.ftd,
      cr: round2(item.cr),
    })),
  };

  const columns = (tabConfig.columns || []).filter(Boolean);

  return {
    rowCount: rows.length,
    columns,
    filters,
    summary: compactSummary(summary),
    quick,
  };
}
