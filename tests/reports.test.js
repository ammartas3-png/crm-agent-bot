import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboard } from "../lib/reports.js";

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
