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

function sumField(items, field) {
  return items.reduce((total, item) => total + (Number(item?.[field]) || 0), 0);
}

function mergeSummaries(summaries = []) {
  const totalLeads = sumField(summaries, "totalLeads");
  const totalFtd = sumField(summaries, "totalFtd");
  const validLeads = sumField(summaries, "validLeads");
  const lateFtd = sumField(summaries, "lateFtd");
  const rawLeadCount = sumField(summaries, "rawLeadCount");
  const differentMonth = sumField(summaries, "differentMonth");
  // crTarget is averaged per source; weight by that source's leads to merge.
  const weighted = summaries.reduce(
    (total, summary) => total + (Number(summary?.crTarget) || 0) * (Number(summary?.totalLeads) || 0),
    0,
  );
  const cr = totalLeads > 0 ? round2((totalFtd / totalLeads) * 100) : 0;
  const crTarget = totalLeads > 0 ? round2(weighted / totalLeads) : 0;
  const crTargetReach = crTarget > 0 ? round2((cr / crTarget) * 100) : 0;
  return {
    totalLeads,
    validLeads,
    totalFtd,
    lateFtd,
    cr,
    crTarget,
    crTargetReach,
    rawLeadCount,
    differentMonth,
  };
}

function mergeGroupLists(lists = [], sortKey = "totalFtd", limit = 10) {
  const map = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      const current = map.get(item.label) || {
        label: item.label,
        totalFtd: 0,
        validLeads: 0,
        totalLeads: 0,
      };
      current.totalFtd += Number(item.totalFtd) || 0;
      current.validLeads += Number(item.validLeads) || 0;
      current.totalLeads += Number(item.totalLeads) || 0;
      map.set(item.label, current);
    }
  }
  const merged = [...map.values()].map((item) => ({
    ...item,
    cr: item.totalLeads > 0 ? round2((item.totalFtd / item.totalLeads) * 100) : 0,
  }));
  merged.sort((left, right) =>
    sortKey === "cr"
      ? right.cr - left.cr || right.totalFtd - left.totalFtd
      : right.totalFtd - left.totalFtd || right.cr - left.cr,
  );
  return merged.slice(0, limit);
}

function mergeStatus(lists = []) {
  const map = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      map.set(item.label, (map.get(item.label) || 0) + (Number(item.value) || 0));
    }
  }
  const total = [...map.values()].reduce((sum, value) => sum + value, 0);
  return [...map.entries()]
    .map(([label, value]) => ({
      label,
      value,
      percentage: total > 0 ? round2((value / total) * 100) : 0,
    }))
    .sort((left, right) => right.value - left.value);
}

function mergeHourly(lists = []) {
  const map = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      const current = map.get(item.hour) || { hour: item.hour, leads: 0, ftd: 0 };
      current.leads += Number(item.leads) || 0;
      current.ftd += Number(item.ftd) || 0;
      map.set(item.hour, current);
    }
  }
  return [...map.values()]
    .map((item) => ({
      ...item,
      cr: item.leads > 0 ? round2((item.ftd / item.leads) * 100) : 0,
    }))
    .sort((left, right) => String(left.hour).localeCompare(String(right.hour)));
}

// Combines several precomputed per-source dashboards into one aggregate (e.g.
// 6 months for an office, or all offices). Approximate for quick lists since
// each source only stored its top entries.
export function mergeDashboards(dashboards = []) {
  const valid = dashboards.filter(Boolean);
  if (valid.length === 0) {
    return null;
  }
  if (valid.length === 1) {
    return valid[0];
  }
  const quicks = valid.map((dashboard) => dashboard.quick || {});
  return {
    rowCount: sumField(valid, "rowCount"),
    columns: valid[0]?.columns || [],
    merged: valid.length,
    summary: mergeSummaries(valid.map((dashboard) => dashboard.summary || {})),
    quick: {
      topAgentsByFtd: mergeGroupLists(quicks.map((q) => q.topAgentsByFtd), "totalFtd"),
      topAgentsByCr: mergeGroupLists(quicks.map((q) => q.topAgentsByCr), "cr"),
      topTeamLeaders: mergeGroupLists(quicks.map((q) => q.topTeamLeaders), "totalFtd"),
      topCampaigns: mergeGroupLists(quicks.map((q) => q.topCampaigns), "totalFtd"),
      topCountries: mergeGroupLists(quicks.map((q) => q.topCountries), "cr"),
      statusDistribution: mergeStatus(quicks.map((q) => q.statusDistribution)),
      hourly: mergeHourly(quicks.map((q) => q.hourly)),
    },
  };
}
