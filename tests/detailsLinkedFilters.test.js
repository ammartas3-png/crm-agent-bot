import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLinkedFiltersToReport,
  normalizeDateValue,
  relevantLinkedFilters,
  rowMatchesLinkedFilters,
} from "../lib/detailsLinkedFilters.js";

function columns(keys) {
  return keys.map((key) => ({ key, label: key, type: key === "ftd" || key === "leads" ? "number" : "text", kind: "dimension" }));
}

// A Daily Trend report is aggregated by date only.
const trendReport = {
  builder: { columns: columns(["date", "leads", "ftd"]) },
  table: [
    { date: "2026-06-18", leads: 5, ftd: 1 },
    { date: "2026-06-17", leads: 2, ftd: 0 },
  ],
};

// A Leads / Traffic style report aggregated by country + campaign.
const leadsReport = {
  builder: { columns: columns(["country", "campaign", "leads", "ftd"]) },
  table: [
    { country: "DE", campaign: "Alpha", leads: 3, ftd: 1 },
    { country: "DE", campaign: "Beta", leads: 4, ftd: 0 },
    { country: "TR", campaign: "Alpha", leads: 9, ftd: 2 },
  ],
};

test("relevantLinkedFilters keeps only keys that are columns of the report", () => {
  const effective = relevantLinkedFilters(leadsReport, { country: ["DE"], date: ["2026-06-18"], hour: ["12:00"] });
  assert.deepEqual(Object.keys(effective), ["country"]);
});

test("selecting a country does NOT empty a table without a country dimension", () => {
  // Selecting country=DE in Traffic must leave the Daily Trend table intact.
  const result = applyLinkedFiltersToReport(trendReport, { country: ["DE"], campaign: ["Alpha"] });
  assert.equal(result.table.length, 2, "Daily Trend rows must be preserved");
  assert.deepEqual(result.table, trendReport.table);
});

test("selecting a country filters a table that has a country dimension", () => {
  const result = applyLinkedFiltersToReport(leadsReport, { country: ["DE"] });
  assert.deepEqual(
    result.table.map((row) => `${row.country}/${row.campaign}`),
    ["DE/Alpha", "DE/Beta"],
  );
});

test("multiple shared dimensions narrow to the exact combination", () => {
  const result = applyLinkedFiltersToReport(leadsReport, { country: ["DE"], campaign: ["Alpha"] });
  assert.deepEqual(result.table.map((row) => `${row.country}/${row.campaign}`), ["DE/Alpha"]);
});

test("selecting a date filters a date table and is ignored by a country table", () => {
  const trendFiltered = applyLinkedFiltersToReport(trendReport, { date: ["2026-06-18"] });
  assert.deepEqual(trendFiltered.table.map((row) => row.date), ["2026-06-18"]);

  // The same date selection must not blank out the country-only leads table.
  const leadsUntouched = applyLinkedFiltersToReport(leadsReport, { date: ["2026-06-18"] });
  assert.equal(leadsUntouched.table.length, leadsReport.table.length);
});

test("empty linked filters return the report unchanged", () => {
  assert.equal(applyLinkedFiltersToReport(leadsReport, {}), leadsReport);
});

test("total/subtotal rows stay attached after filtering", () => {
  const report = {
    builder: { columns: columns(["country", "leads", "ftd"]) },
    table: [
      { country: "DE", leads: 3, ftd: 1 },
      { country: "TR", leads: 9, ftd: 2 },
      { country: "DE Total", leads: 3, ftd: 1, __rowKind: "total" },
    ],
  };
  const result = applyLinkedFiltersToReport(report, { country: ["DE"] });
  assert.deepEqual(
    result.table.map((row) => [row.country, row.__rowKind || "detail"]),
    [
      ["DE", "detail"],
      ["DE Total", "total"],
    ],
  );
});

test("rowMatchesLinkedFilters normalizes date formats", () => {
  assert.equal(normalizeDateValue("18/06/2026"), "2026-06-18");
  assert.ok(rowMatchesLinkedFilters({ date: "18/06/2026" }, { date: ["2026-06-18"] }));
  assert.ok(!rowMatchesLinkedFilters({ date: "2026-06-17" }, { date: ["2026-06-18"] }));
});
