import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCR,
  calculateFtdCount,
  calculateLateFtdCount,
  calculateSummary,
  calculateValidLeads,
  filterRowsByPermission,
  getFtdRowsByDateRange,
  getLeadRowsByDateRange,
  getRowValue,
  normalizeText,
  permissionFilterDebug,
  rowMatchesFilters,
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

test("row filters support multi-select arrays", () => {
  const officeConfig = {
    fields: {
      id: "ID",
      office: "Office",
      teamLeader: "Team Leader",
      campaign: "Campaign",
    },
  };
  const row = {
    ID: "1",
    Office: "Arabic",
    "Team Leader": "Leader A",
    Campaign: "Honda",
  };
  assert.equal(
    rowMatchesFilters(
      row,
      officeConfig,
      {
        office: ["English", "Arabic"],
        teamLeader: ["Leader X", "Leader A"],
      },
      NOW,
    ),
    true,
  );
  assert.equal(
    rowMatchesFilters(
      row,
      officeConfig,
      {
        office: ["English", "German"],
      },
      NOW,
    ),
    false,
  );
});

test("row filters treat Desk as Office-compatible field", () => {
  const deskConfig = {
    fields: {
      id: "ID",
      office: "Desk",
      desk: "Desk",
      country: "Country",
    },
  };
  const row = {
    ID: "9",
    Desk: "Indian Team - TR",
    Country: "Pakistan",
  };
  assert.equal(
    rowMatchesFilters(
      row,
      deskConfig,
      {
        office: ["Indian Team - TR"],
      },
      NOW,
    ),
    true,
  );
  assert.equal(
    rowMatchesFilters(
      row,
      deskConfig,
      {
        officeContains: ["pakistan"],
      },
      NOW,
    ),
    true,
  );
});

test("normalizeText collapses spacing and hidden unicode characters", () => {
  const first = normalizeText(" Turkey  French ");
  const second = normalizeText("turkey french");
  const third = normalizeText("Turkey\u00A0French");
  const fourth = normalizeText("Turkey\u200BFrench");
  assert.equal(first, "turkey french");
  assert.equal(second, "turkey french");
  assert.equal(third, "turkey french");
  assert.equal(fourth, "turkey french");
});

test("permission filters use normalized dataset values from explicit leads fields", () => {
  const permissiveTabConfig = {
    fields: {
      id: "ID",
      office: "Desk",
      desk: "Desk",
      teamLeader: "Team Leader",
      agentNames: "AGENT NAMES",
      country: "Country",
    },
  };
  const dataset = [
    {
      ID: "A-1",
      Office: "Turkey French",
      Desk: "TR Desk 1",
      "Team Leader": "Rafik B",
      "AGENT NAMES": "Agent One",
      Country: "Turkey",
    },
    {
      ID: "A-2",
      Office: "Turkey German",
      Desk: "TR Desk 2",
      "Team Leader": "Rafik B",
      "AGENT NAMES": "Agent Two",
      Country: "Turkey",
    },
  ];
  const rows = filterRowsByPermission(dataset, permissiveTabConfig, {
    office: [" turkey  french "],
    desk: ["TR Desk 1"],
    teamLeader: [" rafik b "],
  });
  assert.deepEqual(rows.map((row) => row.ID), ["A-1"]);
});

test("permission debug identifies unmatched allowed values", () => {
  const permissiveTabConfig = {
    fields: {
      id: "ID",
      office: "Office",
      desk: "Desk",
      teamLeader: "Team Leader",
      agentNames: "AGENT NAMES",
      country: "Country",
    },
  };
  const dataset = [
    {
      ID: "B-1",
      Office: "Turkey French",
      Desk: "TR Desk 1",
      "Team Leader": "Leader A",
      "AGENT NAMES": "Agent A",
      Country: "Turkey",
    },
  ];
  const debug = permissionFilterDebug(dataset, permissiveTabConfig, {
    office: ["Turkey French", "Pakistan Office"],
  });
  assert.deepEqual(debug.matchedByField.office, ["turkey french"]);
  assert.deepEqual(debug.unmatchedByField.office, ["pakistan office"]);
});

test("getRowValue resolves AGENT NAMES from First Call Agent column", () => {
  const row = {
    "First Call Agent": "Annalena Gu",
  };
  assert.equal(getRowValue(row, "AGENT NAMES"), "Annalena Gu");
});

test("lead date filtering falls back to Created when Lead Date is missing", () => {
  const localRows = [
    {
      ID: "L-1",
      Created: "12/05/2026 10:00:00",
      "FTD DATE": "",
      "FTD MAKER": "",
    },
  ];
  const leadRows = getLeadRowsByDateRange(
    localRows,
    tabConfig,
    {
      date: { type: "today" },
    },
    NOW,
  );
  assert.equal(leadRows.length, 1);
});

test("ftd date filtering falls back to Created when FTD DATE is missing", () => {
  const localRows = [
    {
      ID: "F-1",
      Created: "12/05/2026 11:00:00",
      "FTD DATE": "",
      "FTD MAKER": "",
      FTD: "1",
    },
  ];
  const ftdRows = getFtdRowsByDateRange(
    localRows,
    tabConfig,
    {
      date: { type: "today" },
    },
    NOW,
  );
  assert.equal(ftdRows.length, 1);
});

test("ftd count falls back to FTD flag when FTD MAKER is empty", () => {
  const localRows = [
    { FTD: "1", "FTD MAKER": "" },
    { FTD: "0", "FTD MAKER": "" },
    { FTD: "", "FTD MAKER": "Closer X" },
  ];
  const localTabConfig = {
    fields: {
      ftd: "FTD",
      ftdMaker: "FTD MAKER",
    },
  };
  assert.equal(calculateFtdCount(localRows, localTabConfig), 2);
});

test("summary-layout rows without ID are treated as valid report rows", () => {
  const summaryConfig = {
    fields: {
      id: "ID",
      office: "Desk",
      teamLeader: "Team Leader",
      agentNames: "Agent",
      ftd: "FTD",
      crTarget: "CR TARGET",
      lateFtdPlus30Day: "Late FTD",
    },
  };
  const summaryRows = [
    {
      "Working Status": "Working",
      Agent: "Mehmet Ki",
      Desk: "Indian Team - TR",
      Leads: "691",
      FTD: "96",
      "CR TARGET": "18.73%",
      "Late FTD": "5",
    },
  ];
  const metrics = calculateSummary(summaryRows, summaryConfig, { office: "Indian Team - TR" }, NOW);
  assert.equal(metrics.totalLeads, 691);
  assert.equal(metrics.totalFtd, 96);
  assert.equal(metrics.lateFtd, 5);
});
