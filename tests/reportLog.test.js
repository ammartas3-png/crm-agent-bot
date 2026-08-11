import assert from "node:assert/strict";
import test from "node:test";

import { buildRow, reportLabel } from "../lib/reportLog.js";

test("reportLabel derives the report name from query flags", () => {
  assert.equal(reportLabel({ trafficPriority: "1" }), "Traffic Distribution");
  assert.equal(reportLabel({ leadSplitter: "1" }), "LeadSplitter");
  assert.equal(reportLabel({ comparisonMode: "1" }), "Comparison Report");
  assert.equal(reportLabel({ agentProductivityPlanMode: "1" }), "Agent Productivity vs Plan");
  assert.equal(reportLabel({ last4QuickMode: "1" }), "Last 4 Months");
  assert.equal(reportLabel({ reportMode: "specific", rowDimensions: "country", columnDimension: "date" }), "Report Builder (date columns)");
  assert.equal(reportLabel({ reportMode: "specific", rowDimensions: "desk" }), "Report Builder");
});

test("buildRow produces the 11-column activity row", () => {
  const user = { first_name: "Ada", last_name: "Lovelace", username: "ada", id: 42 };
  const params = {
    officeScope: "Turkiye Office",
    monthKey: "2026-08",
    rowDimensions: "desk,agent",
    metricFields: "leads,ftd",
    country: "United States",
    agent: "John Doe",
    trafficPriority: "1",
  };
  const row = buildRow(user, params, "export");
  assert.equal(row.length, 11);
  assert.ok(!Number.isNaN(Date.parse(row[0])), "timestamp is a valid ISO date");
  assert.equal(row[1], "Ada Lovelace");
  assert.equal(row[2], "@ada");
  assert.equal(row[3], "42");
  assert.equal(row[4], "Turkiye Office");
  assert.equal(row[5], "2026-08");
  assert.equal(row[6], "Traffic Distribution");
  assert.equal(row[7], "desk, agent");
  assert.equal(row[8], "leads, ftd");
  assert.ok(row[9].includes("Country: United States"));
  assert.ok(row[9].includes("Agent: John Doe"));
  assert.equal(row[10], "export");
});

test("buildRow handles a missing user gracefully", () => {
  const row = buildRow(null, {}, "view");
  assert.equal(row[1], "Unknown");
  assert.equal(row[2], "");
  assert.equal(row[10], "view");
});
