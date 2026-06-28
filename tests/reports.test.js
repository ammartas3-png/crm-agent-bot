import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboard, mergeDashboards } from "../lib/reports.js";

const NOW = new Date("2026-05-15T12:00:00Z");

const tabConfig = {
  columns: ["ID", "Country", "AGENT NAMES", "FTD MAKER"],
  fields: {
    id: "ID",
    created: "Created",
    leadDate: "Lead Date",
    ftdDate: "FTD DATE",
    ftdMaker: "FTD MAKER",
    country: "Country",
    agentNames: "AGENT NAMES",
    campaign: "Campaign",
    teamLeader: "Team Leader",
    status: "Status",
    crTarget: "CR TARGET",
    differentMonth: "Diffrent Month",
    lateFtdPlus30Day: "LATE FTD +30 Day",
  },
};

const rows = [
  {
    ID: "1",
    Country: "Turkey",
    "AGENT NAMES": "Ahmet",
    "Lead Date": "10/05/2026",
    "FTD DATE": "12/05/2026 10:00:00",
    "FTD MAKER": "Closer",
    "CR TARGET": "10%",
    Status: "Deposit",
    Campaign: "A",
    "Team Leader": "L1",
  },
  {
    ID: "2",
    Country: "Germany",
    "AGENT NAMES": "Max",
    "Lead Date": "11/05/2026",
    "FTD DATE": "",
    "FTD MAKER": "",
    "CR TARGET": "20%",
    Status: "Potential",
    Campaign: "B",
    "Team Leader": "L2",
  },
];

test("buildDashboard returns summary metrics, quick reports and columns", () => {
  const dashboard = buildDashboard(rows, tabConfig, {}, NOW, { limit: 5 });

  assert.equal(dashboard.rowCount, 2);
  assert.deepEqual(dashboard.columns, ["ID", "Country", "AGENT NAMES", "FTD MAKER"]);

  assert.equal(dashboard.summary.totalLeads, 2);
  assert.equal(dashboard.summary.totalFtd, 1);
  assert.equal(dashboard.summary.cr, 50);

  assert.ok(Array.isArray(dashboard.quick.topAgentsByFtd));
  assert.equal(dashboard.quick.topAgentsByFtd[0].label, "Ahmet");
  assert.equal(dashboard.quick.topAgentsByFtd[0].totalFtd, 1);
  assert.ok(dashboard.quick.statusDistribution.length >= 1);
  assert.ok(Array.isArray(dashboard.quick.hourly));
});

function fakeDashboard({ leads, ftd, crTarget, agent }) {
  return {
    rowCount: leads,
    columns: ["ID"],
    summary: {
      totalLeads: leads,
      validLeads: leads,
      totalFtd: ftd,
      lateFtd: 0,
      cr: leads > 0 ? Math.round((ftd / leads) * 10000) / 100 : 0,
      crTarget,
      crTargetReach: 0,
      rawLeadCount: leads,
      differentMonth: 0,
    },
    quick: {
      topAgentsByFtd: [{ label: agent, totalFtd: ftd, validLeads: leads, totalLeads: leads, cr: 0 }],
      topAgentsByCr: [],
      topTeamLeaders: [],
      topCampaigns: [],
      topCountries: [],
      statusDistribution: [{ label: "Deposit", value: ftd, percentage: 0 }],
      hourly: [{ hour: "10:00", leads, ftd, cr: 0 }],
    },
  };
}

test("mergeDashboards sums summaries and merges quick lists", () => {
  const a = fakeDashboard({ leads: 100, ftd: 10, crTarget: 10, agent: "Ahmet" });
  const b = fakeDashboard({ leads: 300, ftd: 60, crTarget: 20, agent: "Ahmet" });

  const merged = mergeDashboards([a, b]);
  assert.equal(merged.summary.totalLeads, 400);
  assert.equal(merged.summary.totalFtd, 70);
  assert.equal(merged.summary.cr, 17.5); // 70/400
  // crTarget weighted by leads: (10*100 + 20*300)/400 = 17.5
  assert.equal(merged.summary.crTarget, 17.5);
  // Ahmet appears in both -> merged totalFtd 70
  assert.equal(merged.quick.topAgentsByFtd[0].label, "Ahmet");
  assert.equal(merged.quick.topAgentsByFtd[0].totalFtd, 70);
  assert.equal(merged.quick.hourly[0].ftd, 70);
});

test("mergeDashboards returns the single dashboard unchanged", () => {
  const a = fakeDashboard({ leads: 100, ftd: 10, crTarget: 10, agent: "X" });
  assert.equal(mergeDashboards([a]), a);
  assert.equal(mergeDashboards([]), null);
});
