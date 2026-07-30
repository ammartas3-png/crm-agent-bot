import assert from "node:assert/strict";
import test from "node:test";

import { deskCodeFromDepartment, buildLeadSplitterReport } from "../lib/dashboardService.js";

const tabConfig = {
  fields: {
    department: "Department",
    country: "Country",
    agentNames: "AGENT NAMES",
    firstCallAgent: "First Call Agent",
    ftd: "FTD",
  },
};

test("deskCodeFromDepartment reads the leading capitals after the second slash", () => {
  assert.equal(deskCodeFromDepartment("HQ / CY1 / GE-TR"), "GE");
  assert.equal(deskCodeFromDepartment("HQ / TR1 / FR"), "FR");
  assert.equal(deskCodeFromDepartment("HQ / CY1 / FR-TR1"), "FR");
  assert.equal(deskCodeFromDepartment("HQ / TN1 / EN-AE"), "EN");
  assert.equal(deskCodeFromDepartment("HQ / AE / VN"), "VN");
  assert.equal(deskCodeFromDepartment("HQ / AE2 / JP"), "JP");
  // ENAF stays ENAF (leading run of capitals, not just the first two).
  assert.equal(deskCodeFromDepartment("HQ / TR1 / ENAF"), "ENAF");
  assert.equal(deskCodeFromDepartment("HQ / TR1 / ENAF-IB"), "ENAF");
  // Missing second slash / empty -> no code.
  assert.equal(deskCodeFromDepartment("HQ / TR1"), "");
  assert.equal(deskCodeFromDepartment(""), "");
});

test("buildLeadSplitterReport groups Desk > Country > Agent with subtotals and desk totals", () => {
  const rows = [
    { Department: "HQ / TR1 / GE", Country: "Germany", "AGENT NAMES": "Agent A", FTD: "1" },
    { Department: "HQ / TR1 / GE", Country: "Germany", "AGENT NAMES": "Agent A", FTD: "" },
    { Department: "HQ / CY1 / GE-TR", Country: "Germany", "AGENT NAMES": "Agent B", FTD: "1" },
    { Department: "HQ / CY1 / AR-TR", Country: "Oman", "AGENT NAMES": "Agent C", FTD: "0" },
    // AGENT NAMES empty -> falls back to First Call Agent.
    { Department: "HQ / CY1 / AR-TR", Country: "Oman", "AGENT NAMES": "", "First Call Agent": "Agent D", FTD: "1" },
  ];
  const report = buildLeadSplitterReport(rows, tabConfig);

  assert.deepEqual(report.summary, { leads: 5, ftd: 3, cr: (3 / 5) * 100 });

  // Desks are alphabetical: AR before GE.
  const kinds = report.rows.map((row) => `${row.kind}:${row.desk}`);
  assert.deepEqual(kinds, [
    "agent:AR",
    "agent:AR",
    "countryTotal:AR",
    "deskTotal:AR",
    "agent:GE",
    "agent:GE",
    "countryTotal:GE",
    "deskTotal:GE",
  ]);
  assert.equal(report.rows[2].label, "Oman Total");
  assert.equal(report.rows[3].label, "AR Total");
  assert.equal(report.rows[6].label, "Germany Total");
  assert.equal(report.rows[7].label, "GE Total");

  const arTotal = report.rows.find((row) => row.kind === "deskTotal" && row.desk === "AR");
  assert.equal(arTotal.leads, 2);
  assert.equal(arTotal.ftd, 1);
  assert.equal(arTotal.cr, 50);

  const geCountry = report.rows.find((row) => row.kind === "countryTotal" && row.desk === "GE");
  assert.equal(geCountry.leads, 3);
  assert.equal(geCountry.ftd, 2); // only cells equal to 1 count as FTD

  const agentA = report.rows.find((row) => row.kind === "agent" && row.agent === "Agent A");
  assert.equal(agentA.leads, 2);
  assert.equal(agentA.ftd, 1);
  assert.equal(agentA.cr, 50);

  // First Call Agent fallback populated the agent name.
  assert.ok(report.rows.some((row) => row.kind === "agent" && row.agent === "Agent D"));
});

test("buildLeadSplitterReport buckets rows without a parseable desk under Other", () => {
  const rows = [{ Department: "no slashes here", Country: "Nowhere", "AGENT NAMES": "Agent X", FTD: "1" }];
  const report = buildLeadSplitterReport(rows, tabConfig);
  assert.ok(report.rows.some((row) => row.kind === "agent" && row.desk === "Other" && row.agent === "Agent X"));
});
