import assert from "node:assert/strict";
import test from "node:test";

import { specificBuilderTable } from "../lib/dashboardService.js";
import { buildInfoAgentsContext } from "../lib/targets.js";
import { getTabConfig } from "../config/sheetsConfig.js";

const tabConfig = getTabConfig("leads");
const infoContext = buildInfoAgentsContext([]);
const NOW = new Date("2026-07-15T12:00:00Z");

let leadId = 0;
const lead = (fields) => ({ ID: `L${(leadId += 1)}`, "Lead Date": "2026-07-01", ...fields });
const rows = [
  lead({ Country: "United States", "AGENT NAMES": "Agent A", FTD: "1", "FTD MAKER": "Closer" }),
  lead({ Country: "United States", "AGENT NAMES": "Agent B", "Lead Date": "2026-07-02" }),
  lead({ Country: "Canada", "AGENT NAMES": "Agent C", FTD: "1", "FTD MAKER": "Closer" }),
];

test("flat builder table appends a Grand Total row (counts summed, CR recomputed)", () => {
  const result = specificBuilderTable(
    rows,
    tabConfig,
    infoContext,
    null,
    { rowDimensions: "country", metricFields: "leads,ftd,cr" },
    NOW,
  );
  const grand = result.grandTotalRow;
  assert.ok(grand, "grandTotalRow present");
  assert.equal(grand.__rowKind, "grandTotal");
  assert.equal(grand.country, "Grand Total");
  assert.equal(grand.leads, 3, "leads summed");
  assert.equal(grand.ftd, 2, "ftd summed");
  // Overall CR must be recomputed (2/3), not the mean of per-country CRs (75%).
  assert.equal(Math.round(grand.cr), 67);
});

test("flat builder Grand Total FTD Target counts only agents in the filtered view", () => {
  // Office roster has 3 working agents (target 10 each = 30), but the filtered
  // report only contains Agent A. The Grand Total FTD Target must be 10 (the
  // visible agent), not 30 (the whole office) — otherwise FTD Target Reach is
  // nonsensical for a filtered report.
  const scopedInfo = buildInfoAgentsContext([
    { "Working Status": "Working", "Agent Name": "Agent A", "Agent Target": "10", Office: "Turkey English", "Team Leader": "TL1" },
    { "Working Status": "Working", "Agent Name": "Agent B", "Agent Target": "10", Office: "Turkey English", "Team Leader": "TL1" },
    { "Working Status": "Working", "Agent Name": "Agent C", "Agent Target": "10", Office: "Turkey English", "Team Leader": "TL1" },
  ]);
  const filteredRows = [
    {
      ID: "x1",
      "Lead Date": "2026-07-01",
      Country: "United States",
      "AGENT NAMES": "Agent A",
      "Team Leader": "TL1",
      Desk: "Turkey English",
      FTD: "1",
      "FTD MAKER": "Closer",
      "FTD DATE": "2026-07-01",
    },
  ];
  const result = specificBuilderTable(
    filteredRows,
    tabConfig,
    scopedInfo,
    null,
    { rowDimensions: "agent", metricFields: "ftd,ftdTarget,ftdTargetReach" },
    NOW,
  );
  const grand = result.grandTotalRow;
  assert.ok(grand, "grandTotalRow present");
  assert.equal(grand.ftd, 1, "ftd summed");
  assert.equal(grand.ftdTarget, 10, "FTD Target restricted to the visible agent, not the whole office");
});

test("flat builder Grand Total KYC FTD counts only agents in the filtered view", () => {
  const leadsRows = [
    {
      ID: "l1",
      "Lead Date": "2026-07-01",
      Country: "United States",
      "AGENT NAMES": "Agent A",
      FTD: "1",
      "FTD MAKER": "Closer",
      "FTD DATE": "2026-07-01",
    },
  ];
  // KYC FTD dataset also has an agent (Agent Z) who is not in the filtered leads.
  const kycRows = [
    { "AGENT NAMES": "Agent A", __kycFtd: 1, "FTD DATE": "2026-07-01" },
    { "AGENT NAMES": "Agent Z", __kycFtd: 1, "FTD DATE": "2026-07-01" },
    { "AGENT NAMES": "Agent Z", __kycFtd: 1, "FTD DATE": "2026-07-02" },
  ];
  const result = specificBuilderTable(
    leadsRows,
    tabConfig,
    infoContext,
    null,
    { rowDimensions: "agent", metricFields: "kycFtd,ftd" },
    NOW,
    { kycFtdRows: kycRows },
  );
  const grand = result.grandTotalRow;
  assert.ok(grand, "grandTotalRow present");
  assert.equal(grand.kycFtd, 1, "KYC FTD restricted to the visible agent, not the whole office");
});

test("date columns are restricted to the selected month (no stray other-month columns)", () => {
  const augustRows = [
    { ID: "a1", "Lead Date": "2026-08-05", Country: "United States", "AGENT NAMES": "Agent A" },
    { ID: "a2", "Lead Date": "2026-08-06", Country: "United States", "AGENT NAMES": "Agent A" },
    // Stray lead mistakenly dated in July inside the August sheet.
    { ID: "a3", "Lead Date": "2026-07-31", Country: "Switzerland", "AGENT NAMES": "Agent B" },
  ];
  const augustFilter = { type: "month", month: 7, year: 2026 }; // month is 0-indexed (August)
  const result = specificBuilderTable(
    augustRows,
    tabConfig,
    infoContext,
    augustFilter,
    { rowDimensions: "country", columnDimension: "date", metricFields: "leads" },
    new Date("2026-08-15T12:00:00Z"),
  );
  assert.ok(result.columnValues.length > 0, "has date columns");
  assert.ok(
    result.columnValues.every((value) => String(value).startsWith("2026-08")),
    "only August date columns appear",
  );
  assert.ok(!result.columnValues.includes("2026-07-31"), "stray July column dropped");
});

test("mid-month transfer splits the target by FTD made per team (target 10 -> 3 old / 7 new)", () => {
  // Agent A transferred teams mid-July. Their assigned target is 10. They made 3
  // FTD in the old team and 2 FTD in the new (latest) team. The expected split is:
  //   - old (non-latest) team FTD Target = FTD they made there = 3
  //   - new (latest) team FTD Target = total (10) - other teams' FTD (3) = 7
  // This also guards the argument order of the per-team FTD calculation: it must
  // receive the leads tabConfig (so FTD is counted for the reported month), not
  // the month filter in the tabConfig slot.
  const julyFilter = { type: "month", month: 6, year: 2026 }; // 0-indexed -> July
  const transferInfo = buildInfoAgentsContext([
    {
      "Working Status": "Working",
      "Agent Name": "Agent A",
      "Agent Target": "10",
      Office: "New Desk",
      "Team Leader": "TL New",
    },
  ]);
  const ftdLead = (desk, tl, leadDate, ftdDate) => ({
    ID: `T${(leadId += 1)}`,
    "Lead Date": leadDate,
    Country: "United States",
    "AGENT NAMES": "Agent A",
    Desk: desk,
    "Team Leader": tl,
    FTD: "1",
    "FTD MAKER": "Closer",
    "FTD DATE": ftdDate,
  });
  const transferRows = [
    // Old team: 3 FTD, earlier in the month.
    ftdLead("Old Desk", "TL Old", "2026-07-05", "2026-07-10"),
    ftdLead("Old Desk", "TL Old", "2026-07-05", "2026-07-11"),
    ftdLead("Old Desk", "TL Old", "2026-07-05", "2026-07-12"),
    // New (latest, later lead date) team: 2 FTD.
    ftdLead("New Desk", "TL New", "2026-07-25", "2026-07-26"),
    ftdLead("New Desk", "TL New", "2026-07-25", "2026-07-27"),
  ];
  const result = specificBuilderTable(
    transferRows,
    tabConfig,
    transferInfo,
    julyFilter,
    { rowDimensions: "desk,teamLeader,agent", metricFields: "ftd,ftdTarget,ftdTargetReach" },
    NOW,
  );
  const agentRows = result.table.filter(
    (row) => row.__rowKind !== "grandTotal" && row.agent === "Agent A",
  );
  const oldRow = agentRows.find((row) => row.desk === "Old Desk");
  const newRow = agentRows.find((row) => row.desk === "New Desk");
  assert.ok(oldRow && newRow, "both team rows present for the transferred agent");
  assert.equal(oldRow.__transferAgent, true, "old-team row flagged as transfer");
  assert.equal(newRow.__transferAgent, true, "new-team row flagged as transfer");
  assert.equal(oldRow.ftdTarget, 3, "old team target = FTD made there");
  assert.equal(newRow.ftdTarget, 7, "latest team target = total (10) - other teams' FTD (3)");
});

test("column-pivot builder table Grand Total sums each column", () => {
  const result = specificBuilderTable(
    rows,
    tabConfig,
    infoContext,
    null,
    { rowDimensions: "country", columnDimension: "date", metricFields: "ftd" },
    NOW,
  );
  const grand = result.grandTotalRow;
  assert.ok(grand, "grandTotalRow present");
  assert.equal(grand.__rowKind, "grandTotal");
  assert.equal(grand.country, "Grand Total");
  const metricColumns = result.columns.filter((column) => column.kind === "metric");
  assert.ok(metricColumns.length >= 1, "has per-date metric columns");
  const sum = metricColumns.reduce((total, column) => total + Number(grand[column.key] || 0), 0);
  assert.equal(sum, 2, "grand total across date columns equals total FTD");
});
