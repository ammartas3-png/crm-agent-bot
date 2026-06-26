import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCR,
  calculateFtdCount,
  calculateLateFtdCount,
  calculateSummary,
  calculateValidLeads,
  getFtdRowsByDateRange,
  getLeadRowsByDateRange,
  parseDateValue,
  uniqueValues,
  uniqueValuesForFields,
} from "../lib/calculations.js";

const NOW = new Date("2026-05-12T12:00:00Z");

const tabConfig = {
  fields: {
    id: "ID",
    country: "Country",
    leadDate: "Lead Date",
    ftdDate: "FTD DATE",
    ftdMaker: "FTD MAKER",
    created: "Created",
    differentMonth: "Diffrent Month",
    crTarget: "CR TARGET",
    lateFtdDifference: "LATE FTD Difrrence",
    lateFtdPlus30Day: "LATE FTD +30 Day",
  },
};

const rows = [
  {
    ID: "1",
    Country: "Cote D'Ivoire",
    Created: "01/04/2026",
    "Lead Date": "11/05/2026",
    "FTD DATE": "12/05/2026 10:00:00",
    "FTD MAKER": "Closer A",
    "CR TARGET": "10%",
    "LATE FTD Difrrence": "41",
    "LATE FTD +30 Day": "1",
  },
  {
    ID: "2",
    Country: "Cote D'Ivoire",
    Created: "12/05/2026",
    "Lead Date": "12/05/2026",
    "FTD DATE": "",
    "FTD MAKER": "",
    "Diffrent Month": "1",
    "CR TARGET": "0.10",
  },
  {
    ID: "3",
    Country: "Cote D'Ivoire",
    Created: "12/05/2026",
    "Lead Date": "12/05/2026",
    "FTD DATE": "",
    "FTD MAKER": "",
    "CR TARGET": "10",
  },
  {
    ID: "3",
    Country: "Cote D'Ivoire",
    Created: "12/05/2026",
    "Lead Date": "12/05/2026",
    "FTD DATE": "",
    "FTD MAKER": "",
    "CR TARGET": "10",
  },
  {
    ID: "4",
    Country: "Germany",
    Created: "01/04/2026",
    "Lead Date": "12/05/2026",
    "FTD DATE": "12/05/2026 12:00:00",
    "FTD MAKER": "Closer B",
    "CR TARGET": "20%",
    "LATE FTD Difrrence": "41",
    "LATE FTD +30 Day": "",
  },
  {
    ID: "5",
    Country: "Cote D'Ivoire",
    Created: "01/05/2026",
    "Lead Date": "10/05/2026",
    "FTD DATE": "12/05/2026 15:00:00",
    "FTD MAKER": "Closer C",
    "CR TARGET": "10%",
    "LATE FTD Difrrence": "11",
    "LATE FTD +30 Day": "0",
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
  assert.deepEqual(ftdRows.map((row) => row.ID), ["1", "5"]);
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
  assert.equal(summary.ftdRowsByFtdDate, 2);
  assert.equal(summary.rawLeadCount, 3);
  assert.equal(summary.totalLeads, 2);
  assert.equal(summary.differentMonthLeads, 1);
  assert.equal(summary.differentMonthCount, 1);
  assert.equal(summary.validLeads, 2);
  assert.equal(summary.totalFtd, 2);
  assert.equal(summary.lateFtd, 1);
  assert.equal(summary.cr, 100);
  assert.equal(summary.crTarget, 10);
  assert.equal(summary.crTargetReach, 1000);
});

test("late FTD uses +30 day flag when present instead of difference text", () => {
  const ftdRows = getFtdRowsByDateRange(
    rows,
    tabConfig,
    {
      country: "Cote D'Ivoire",
      date: { type: "today" },
    },
    NOW,
  );

  assert.equal(calculateLateFtdCount(ftdRows, tabConfig), 1);
});

test("late FTD falls back to Created vs FTD DATE when flag column is missing", () => {
  const fallbackConfig = {
    fields: {
      id: "ID",
      created: "Created",
      ftdDate: "FTD DATE",
      ftdMaker: "FTD MAKER",
    },
  };

  assert.equal(calculateLateFtdCount([rows[0], rows[5]], fallbackConfig), 1);
});

test("uniqueValuesForFields returns the same values as uniqueValues in one pass", () => {
  const fieldKeys = ["country"];
  const combined = uniqueValuesForFields(rows, tabConfig, fieldKeys, 500);
  assert.deepEqual(combined.country, uniqueValues(rows, tabConfig, "country", 500));
  assert.deepEqual(combined.country, ["Cote D'Ivoire", "Germany"]);
});

test("parseDateValue memoization returns consistent results for repeated input", () => {
  const first = parseDateValue("12/05/2026 10:00:00");
  const second = parseDateValue("12/05/2026 10:00:00");
  assert.equal(first.getTime(), second.getTime());
  assert.equal(first.getTime(), Date.UTC(2026, 4, 12, 10, 0, 0));
  assert.equal(parseDateValue(""), null);
  assert.equal(parseDateValue("not-a-date"), null);
});

test("calculation helper functions handle zero denominators", () => {
  assert.deepEqual(calculateValidLeads([], tabConfig), {
    rawLeadCount: 0,
    differentMonthCount: 0,
    totalLeads: 0,
    differentMonthLeads: 0,
    validLeads: 0,
  });
  assert.equal(calculateFtdCount([], tabConfig), 0);
  assert.equal(calculateCR(5, 0), 0);
});
