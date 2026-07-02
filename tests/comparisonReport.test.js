import assert from "node:assert/strict";
import test from "node:test";

import {
  buildComparisonDetailRows,
  buildComparisonTablesFromDetailRows,
  buildComparisonTablesFromRows,
  isComparisonReportQuery,
  parseComparisonSelections,
} from "../lib/comparisonReport.js";

const tabConfig = {
  fields: {
    country: "Country",
    campaign: "Campaign",
    placement: "Placement",
    subCampaign: "Sub Campaign",
    teamLeader: "Team Leader",
    agentNames: "Agent",
    crTarget: "CR TARGET",
    status: "Status",
    created: "Created",
    id: "ID",
  },
};

test("isComparisonReportQuery detects comparison preset shape", () => {
  assert.equal(
    isComparisonReportQuery({
      comparisonMode: "1",
    }),
    true,
  );
  assert.equal(
    isComparisonReportQuery({
      rowDimensions: "country,campaign,placement,subCampaign,teamLeader,agent",
      metricFields: "leads,ftd,cr,crTarget,crTargetReach",
    }),
    true,
  );
});

test("buildComparisonTablesFromRows aggregates all rows without builder truncation", () => {
  const rows = [];
  for (let index = 0; index < 1800; index += 1) {
    rows.push({
      Country: index % 2 === 0 ? "India" : "Japan",
      Campaign: `Campaign ${index % 5}`,
      Placement: "Google",
      "Sub Campaign": "Brand",
      "Team Leader": `Leader ${index % 20}`,
      Agent: `Agent ${index}`,
      "CR TARGET": 8,
      Status: "Working",
      Created: "2026-06-15",
    });
  }

  const tables = buildComparisonTablesFromRows(rows, tabConfig, { type: "month", month: 5, year: 2026 });
  const countryTable = tables.find((table) => table.key === "country");
  const agentTable = tables.find((table) => table.key === "agent");
  assert.equal(countryTable.rows.length, 2);
  assert.equal(agentTable.rows.length, 1800);
});

test("parseComparisonSelections accepts JSON object payloads", () => {
  assert.deepEqual(parseComparisonSelections('{"country":"India"}'), { country: "India" });
  assert.deepEqual(parseComparisonSelections(""), {});
});

test("buildComparisonDetailRows and client-side filtering stay in sync", () => {
  const rows = [
    {
      ID: "1",
      Country: "India",
      Campaign: "Alpha",
      Placement: "Google",
      "Sub Campaign": "Brand",
      "Team Leader": "Leader A",
      Agent: "Agent 1",
      "CR TARGET": 8,
      Status: "Working",
      Created: "2026-06-15",
    },
    {
      ID: "2",
      Country: "India",
      Campaign: "Beta",
      Placement: "Google",
      "Sub Campaign": "Brand",
      "Team Leader": "Leader A",
      Agent: "Agent 2",
      "CR TARGET": 8,
      Status: "Working",
      Created: "2026-06-15",
    },
    {
      ID: "3",
      Country: "Japan",
      Campaign: "Alpha",
      Placement: "Google",
      "Sub Campaign": "Brand",
      "Team Leader": "Leader B",
      Agent: "Agent 3",
      "CR TARGET": 8,
      Status: "Working",
      Created: "2026-06-15",
    },
  ];
  const monthFilter = { type: "month", month: 5, year: 2026 };
  const detailRows = buildComparisonDetailRows(rows, tabConfig, monthFilter);
  assert.equal(detailRows.length, 3);

  const unfiltered = buildComparisonTablesFromDetailRows(detailRows);
  const countryTable = unfiltered.find((table) => table.key === "country");
  assert.equal(countryTable.rows.length, 2);

  const filtered = buildComparisonTablesFromDetailRows(detailRows, { country: "India" });
  const campaignTable = filtered.find((table) => table.key === "campaign");
  assert.equal(campaignTable.rows.length, 2);
  assert.equal(campaignTable.rows.find((row) => row.label === "Alpha")?.leads, 1);
  assert.equal(campaignTable.rows.find((row) => row.label === "Beta")?.leads, 1);
  const agentTable = filtered.find((table) => table.key === "agent");
  assert.equal(agentTable.rows.length, 2);
  assert.ok(agentTable.rows.some((row) => row.label === "Agent 1"));
  assert.ok(agentTable.rows.some((row) => row.label === "Agent 2"));
  assert.equal(filtered.find((table) => table.key === "country")?.rows.find((row) => row.label === "India")?.leads, 2);
});
