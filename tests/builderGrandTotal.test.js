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
