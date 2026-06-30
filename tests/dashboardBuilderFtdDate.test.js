import test from "node:test";
import assert from "node:assert/strict";

import { specificBuilderTable } from "../lib/dashboardService.js";
import { calculateFtdCount, getFtdRowsByDateRange } from "../lib/calculations.js";
import { buildInfoAgentsContext } from "../lib/targets.js";
import { getTabConfig } from "../config/sheetsConfig.js";

const tabConfig = getTabConfig("leads");
const infoContext = buildInfoAgentsContext([]);
const NOW = new Date("2026-06-30T00:00:00Z");
const JUNE_2026 = { type: "month", month: 5, year: 2026 };

function leadRow({ id, desk = "Desk A", leadDate, ftdDate = "", ftd = "" }) {
  const row = {
    ID: id,
    Desk: desk,
    "AGENT NAMES": `agent-${id}`,
    "Lead Date": leadDate,
    Created: leadDate,
  };
  if (ftd) {
    row.FTD = ftd;
    row["FTD MAKER"] = `maker-${id}`;
  }
  if (ftdDate) {
    row["FTD DATE"] = ftdDate;
  }
  return row;
}

// Lead registered on the 28th but the FTD happens on the 29th -> the FTD must be
// attributed to the 29th, not to the lead's day (28th). Lead registered on the 29th
// has no FTD. Lead on the 28th that also converts on the 28th stays on the 28th.
const rows = [
  leadRow({ id: "A", leadDate: "28/06/2026 02:15:00", ftd: "1", ftdDate: "29/06/2026 03:00:00" }),
  leadRow({ id: "B", leadDate: "29/06/2026 09:00:00" }),
  leadRow({ id: "C", leadDate: "28/06/2026 10:00:00", ftd: "1", ftdDate: "28/06/2026 23:30:00" }),
];

function buildByDate() {
  const result = specificBuilderTable(rows, tabConfig, infoContext, JUNE_2026, {
    rowDimensions: "date",
    metricFields: "leads,ftd",
  }, NOW);
  const byDate = new Map();
  for (const row of result.table) {
    byDate.set(row.date, row);
  }
  return byDate;
}

test("FTDs are bucketed by FTD DATE, not by the lead's registration day", () => {
  const byDate = buildByDate();

  const day28 = byDate.get("2026-06-28");
  const day29 = byDate.get("2026-06-29");
  assert.ok(day28, "expected a row for 2026-06-28");
  assert.ok(day29, "expected a row for 2026-06-29");

  // Leads stay on their registration day.
  assert.equal(day28.leads, 2, "28th should have leads A and C");
  assert.equal(day29.leads, 1, "29th should have lead B");

  // FTDs land on the FTD day: C converted on the 28th, A converted on the 29th.
  assert.equal(day28.ftd, 1, "28th FTD is C only (A converted on the 29th)");
  assert.equal(day29.ftd, 1, "29th FTD is A (an older lead converting that day)");
});

test("event splitting never double-counts leads or FTDs across date buckets", () => {
  const byDate = buildByDate();
  const totalLeads = [...byDate.values()].reduce((sum, row) => sum + Number(row.leads || 0), 0);
  const totalFtd = [...byDate.values()].reduce((sum, row) => sum + Number(row.ftd || 0), 0);
  assert.equal(totalLeads, 3, "three distinct leads in total");
  assert.equal(totalFtd, 2, "two distinct FTDs in total");
});

test("reports without a date/hour dimension keep lead-row attribution unchanged", () => {
  const result = specificBuilderTable(rows, tabConfig, infoContext, JUNE_2026, {
    rowDimensions: "desk",
    metricFields: "leads,ftd",
  }, NOW);
  assert.equal(result.table.length, 1, "single desk group");
  const desk = result.table[0];
  assert.equal(desk.leads, 3, "all three leads under the desk");
  assert.equal(desk.ftd, 2, "both FTDs under the desk");
});

test("day windows attribute a late converter strictly to its FTD DATE day", () => {
  // Lead registered on June 28, converted on July 1 (a plausible later conversion).
  const lateConverter = [
    leadRow({ id: "L", leadDate: "28/06/2026 12:00:00", ftd: "1", ftdDate: "01/07/2026 08:00:00" }),
  ];

  const onLeadDay = getFtdRowsByDateRange(
    lateConverter,
    tabConfig,
    { date: { type: "range", start: "2026-06-28", end: "2026-06-28" } },
    NOW,
  );
  assert.equal(calculateFtdCount(onLeadDay, tabConfig), 0, "FTD must not land on the lead's day");

  const onFtdDay = getFtdRowsByDateRange(
    lateConverter,
    tabConfig,
    { date: { type: "range", start: "2026-07-01", end: "2026-07-01" } },
    NOW,
  );
  assert.equal(calculateFtdCount(onFtdDay, tabConfig), 1, "FTD lands on its FTD DATE day");
});

test("month windows still include late converters (monthly totals unchanged)", () => {
  // Same late converter: its lead is in June, so the June sheet's monthly total keeps it.
  const lateConverter = [
    leadRow({ id: "L", leadDate: "28/06/2026 12:00:00", ftd: "1", ftdDate: "01/07/2026 08:00:00" }),
  ];
  const juneRows = getFtdRowsByDateRange(
    lateConverter,
    tabConfig,
    { date: { type: "month", month: 5, year: 2026 } },
    NOW,
  );
  assert.equal(calculateFtdCount(juneRows, tabConfig), 1, "monthly FTD still counts the late converter");
});

test("FTD DATE attribution also applies when date is a column dimension", () => {
  const result = specificBuilderTable(rows, tabConfig, infoContext, JUNE_2026, {
    rowDimensions: "desk",
    metricFields: "leads,ftd",
    columnDimension: "date",
  }, NOW);
  assert.equal(result.table.length, 1, "single desk row");
  const desk = result.table[0];
  assert.equal(desk["date_2026-06-28__ftd"], 1, "28th column FTD is C only");
  assert.equal(desk["date_2026-06-29__ftd"], 1, "29th column FTD is A");
  assert.equal(desk["date_2026-06-28__leads"], 2, "28th column leads A and C");
  assert.equal(desk["date_2026-06-29__leads"], 1, "29th column lead B");
});
