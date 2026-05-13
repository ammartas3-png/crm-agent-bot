import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCR,
  calculateFtdCount,
  calculateSummary,
  calculateValidLeads,
  getFtdRowsByDateRange,
  getLeadRowsByDateRange,
} from "../lib/calculations.js";

const NOW = new Date("2026-05-12T12:00:00Z");

const tabConfig = {
  fields: {
    id: "ID",
    country: "Country",
    leadDate: "Lead Date",
    ftdDate: "FTD DATE",
    ftdMaker: "FTD MAKER",
    differentMonth: "Diffrent Month",
    crTarget: "CR TARGET",
    lateFtdDifference: "LATE FTD Difrrence",
  },
};

const rows = [
  {
    ID: "1",
    Country: "Cote D'Ivoire",
    "Lead Date": "11/05/2026",
    "FTD DATE": "12/05/2026 10:00:00",
    "FTD MAKER": "Closer A",
    "CR TARGET": "10%",
  },
  {
    ID: "2",
    Country: "Cote D'Ivoire",
    "Lead Date": "12/05/2026",
    "FTD DATE": "",
    "FTD MAKER": "",
    "Diffrent Month": "1",
    "CR TARGET": "0.10",
  },
  {
    ID: "3",
    Country: "Cote D'Ivoire",
    "Lead Date": "12/05/2026",
    "FTD DATE": "",
    "FTD MAKER": "",
    "CR TARGET": "10",
  },
  {
    ID: "3",
    Country: "Cote D'Ivoire",
    "Lead Date": "12/05/2026",
    "FTD DATE": "",
    "FTD MAKER": "",
    "CR TARGET": "10",
  },
  {
    ID: "4",
    Country: "Germany",
    "Lead Date": "12/05/2026",
    "FTD DATE": "12/05/2026 12:00:00",
    "FTD MAKER": "Closer B",
    "CR TARGET": "20%",
  },
];

test("lead rows use Lead Date and FTD rows use FTD DATE independently", () => {
  const filters = {
    country: "Cote D'Ivoire",
    date: { type: "today" },
  };

  const leadRows = getLeadRowsByDateRange(rows, tabConfig, filters, NOW);
  const ftdRows = getFtdRowsByDateRange(rows, tabConfig, filters, NOW);

  assert.deepEqual(leadRows.map((row) => row.ID), ["2", "3", "3"]);
  assert.deepEqual(ftdRows.map((row) => row.ID), ["1"]);
});

test("summary counts unique Lead Date IDs and FTD by FTD DATE independently", () => {
  const summary = calculateSummary(
    rows,
    tabConfig,
    {
      country: "Cote D'Ivoire",
      date: { type: "today" },
    },
    NOW,
  );

  assert.equal(summary.leadRowsByLeadDate, 3);
  assert.equal(summary.ftdRowsByFtdDate, 1);
  assert.equal(summary.totalLeads, 2);
  assert.equal(summary.differentMonthLeads, 1);
  assert.equal(summary.validLeads, 1);
  assert.equal(summary.totalFtd, 1);
  assert.equal(summary.cr, 50);
  assert.equal(summary.crTarget, 10);
  assert.equal(summary.crTargetReach, 500);
});

test("calculation helper functions handle zero denominators", () => {
  assert.deepEqual(calculateValidLeads([], tabConfig), {
    totalLeads: 0,
    differentMonthLeads: 0,
    validLeads: 0,
  });
  assert.equal(calculateFtdCount([], tabConfig), 0);
  assert.equal(calculateCR(5, 0), 0);
});
