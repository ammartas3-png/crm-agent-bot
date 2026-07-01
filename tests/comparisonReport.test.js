import assert from "node:assert/strict";
import test from "node:test";

import {
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
