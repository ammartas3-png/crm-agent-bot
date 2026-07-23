import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKycFtdRowsFromFtdSheet,
  combineKycFtdRowsBySourceMonth,
  ftdObjectsFromRawValues,
  kycFtdCountFromRows,
} from "../lib/dashboardService.js";
import { calculateSummary } from "../lib/calculations.js";
import { getTabConfig } from "../config/sheetsConfig.js";

const tabConfig = getTabConfig("leads");
const ftdTabConfig = getTabConfig("ftd");

test("KYC FTD counts FTD sheet rows by roster-mapped agent", () => {
  const rosterProfileMap = new Map([
    [
      "mehmet ki",
      {
        agentName: "Mehmet Kılıç",
        desk: "AE Indonesia",
        teamLeader: "Murat K",
      },
    ],
  ]);
  const ftdRows = [
    {
      "FTD Date": "01.07.2026",
      CID: "ACC100",
      Agents: "Mehmet Ki",
    },
    {
      "FTD Date": "02.07.2026",
      CID: "ACC101",
      Agents: "Mehmet Ki",
    },
    {
      "FTD Date": "03.07.2026",
      CID: "ACC102",
      Agents: "Mehmet Ki",
    },
  ];
  const kycRows = buildKycFtdRowsFromFtdSheet(ftdRows, ftdTabConfig, tabConfig, rosterProfileMap, {
    officeScope: "Dubai Office",
  });
  assert.equal(kycRows.length, 3);
  assert.equal(kycRows[0]["AGENT NAMES"], "Mehmet Kılıç");
  assert.equal(kycRows[0].Desk, "AE Indonesia");
  assert.equal(kycRows[0]["Team Leader"], "Murat K");

  const total = kycFtdCountFromRows([], tabConfig, { kycFtdRows: kycRows });
  assert.equal(total, 3);

  const scoped = kycFtdCountFromRows([], tabConfig, {
    kycFtdRows: kycRows,
    scope: { agent: ["Mehmet Kılıç"] },
  });
  assert.equal(scoped, 3);
});

test("KYC FTD uses Leads profile for desk and team when roster is missing", () => {
  const leadsProfileMap = new Map([
    [
      "abdulrahim fe",
      {
        agentName: "Abdulrahim Fe",
        desk: "Turkey Africa",
        teamLeader: "Epere Aw",
      },
    ],
  ]);
  const kycRows = buildKycFtdRowsFromFtdSheet(
    [
      {
        "FTD Date": "01.07.2026",
        CID: "ACC200",
        Agents: "Abdulrahim Fe",
      },
    ],
    ftdTabConfig,
    tabConfig,
    new Map(),
    { leadsProfileMap },
  );
  assert.equal(kycRows[0].Desk, "Turkey Africa");
  assert.equal(kycRows[0]["Team Leader"], "Epere Aw");
  assert.equal(
    kycFtdCountFromRows([], tabConfig, {
      kycFtdRows: kycRows,
      dateFilter: { type: "month", month: 6, year: 2026 },
      scope: { agent: ["Abdulrahim Fe"] },
      now: new Date("2026-07-15T12:00:00Z"),
    }),
    1,
  );
});

test("KYC FTD counts every Agents column match like COUNTIF on FTD sheet column D", () => {
  const ftdRows = Array.from({ length: 13 }, (_, index) => ({
    "FTD Date": "01.07.2026",
    CID: `ACC3979${index}`,
    Agents: "Abdulrahim Fe",
    TEAM: "Epere Aw",
  }));
  const kycRows = buildKycFtdRowsFromFtdSheet(ftdRows, ftdTabConfig, tabConfig, new Map(), {
    leadsProfileMap: new Map([
      [
        "abdulrahim fe",
        {
          agentName: "Abdulrahim Fe",
          desk: "Turkey Africa",
          teamLeader: "Epere Aw",
        },
      ],
    ]),
  });
  assert.equal(kycRows.length, 13);
  assert.equal(
    kycFtdCountFromRows([], tabConfig, {
      kycFtdRows: kycRows,
      scope: { agent: ["Abdulrahim Fe"] },
    }),
    13,
  );
});

test("KYC FTD can exceed FTD when FTD sheet has extra pending rows", () => {
  const rosterProfileMap = new Map([
    [
      "mehmet ki",
      {
        agentName: "Mehmet Kılıç",
        desk: "AE Indonesia",
        teamLeader: "Murat K",
      },
    ],
  ]);
  const kycRows = buildKycFtdRowsFromFtdSheet(
    Array.from({ length: 33 }, (_, index) => ({
      "FTD Date": "01.07.2026",
      CID: `ACC${index + 1}`,
      Agents: "Mehmet Ki",
    })),
    ftdTabConfig,
    tabConfig,
    rosterProfileMap,
  );
  const leadRows = Array.from({ length: 32 }, (_, index) => ({
    ID: `LEAD${index + 1}`,
    "AGENT NAMES": "Mehmet Kılıç",
    Desk: "AE Indonesia",
    "Team Leader": "Murat K",
    FTD: "1",
    "FTD MAKER": "Closer",
    "FTD DATE": "01.07.2026",
  }));
  const ftdTotal = calculateSummary(leadRows, tabConfig, {}, new Date("2026-07-15T12:00:00Z")).totalFtd;
  const kycTotal = kycFtdCountFromRows([], tabConfig, {
    kycFtdRows: kycRows,
    scope: { agent: ["Mehmet Kılıç"] },
  });
  assert.equal(ftdTotal, 32);
  assert.equal(kycTotal, 33);
});

test("ftdObjectsFromRawValues reads FTD Date and Agents positionally despite duplicate headers", () => {
  // Mirrors the real office FTD sheets: IMPORTRANGE repeats "FTD Date", "CID"
  // and the agent header several times. Header-based mapping collapses those
  // duplicates onto the LAST (empty) column, which used to blank FTD Date and
  // the agent, zeroing out KYC FTD.
  const rawValues = [
    [
      "FTD Date",
      "CID",
      "LIST OF COUNRTYS",
      "Agents",
      "AFF",
      "RegistrationDate",
      "TEAM",
      "BRAND",
      "Cheker",
      "FTD Date",
      "AGENTS",
      "FTD Date",
      "CID",
    ],
    ["01.07.2026", "ACC100", "Saint Lucia", "Oluwasgun Oy", "996-FR", "16.06.2026", "Murat K", "Fintana", 1, "", "Epere Aw", "", ""],
    ["03.07.2026", "ACC101", "Nigeria", "Astrolan No", "996-FR", "01.07.2026", "Yosr S", "Fintana", 1, "", "AE Self", "", ""],
    ["06.07.2026", "ACC102", "Ghana", "Gloire Ki", "Porche", "01.07.2026", "Murat K", "Fintana", 1, "", "", "", ""],
  ];
  const rows = ftdObjectsFromRawValues(rawValues);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]["FTD Date"], "01.07.2026");
  assert.equal(rows[0]["CID"], "ACC100");
  assert.equal(rows[0]["Agents"], "Oluwasgun Oy");

  const kycRows = buildKycFtdRowsFromFtdSheet(rows, ftdTabConfig, tabConfig, new Map());
  assert.equal(kycRows.length, 3);
  assert.equal(kycRows[0]["AGENT NAMES"], "Oluwasgun Oy");
  assert.equal(kycRows[0].__sourceMonthKey, "2026-07");
  assert.equal(kycFtdCountFromRows([], tabConfig, { kycFtdRows: kycRows }), 3);
});

test("ftdObjectsFromRawValues resolves the primary agent column when it is uppercase", () => {
  // Argentina/Pakistan style: the primary agent header (column D) is uppercase
  // "AGENTS" and appears again later, so header mapping kept the wrong column.
  const rawValues = [
    ["FTD Date", "CID", "LIST OF COUNRTYS", "AGENTS", "BRAND", "Registration Date", "TEAM", "Cheker", "COUNRTY", "FTD DATE", "AGENTS"],
    ["01.07.2026", "ACC200", "Brazil", "Pedro Qu", "Fintana", "24.06.2026", "Rafaela Da", 1, "Paraguay", "1/7/2026", ""],
    ["02.07.2026", "ACC201", "Colombia", "Marana Ha", "Fintana", "26.06.2026", "Tifany Ma", 1, "Colombia", "2/7/2026", ""],
  ];
  const rows = ftdObjectsFromRawValues(rawValues);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["Agents"], "Pedro Qu");
  const kycRows = buildKycFtdRowsFromFtdSheet(rows, ftdTabConfig, tabConfig, new Map());
  assert.equal(kycRows.length, 2);
  assert.equal(kycRows[0]["AGENT NAMES"], "Pedro Qu");
});

test("combineKycFtdRowsBySourceMonth attributes each row to its own month", () => {
  const juneRows = buildKycFtdRowsFromFtdSheet(
    [
      { "FTD Date": "10.06.2026", CID: "ACC1", Agents: "Mehmet Ki" },
      { "FTD Date": "12.06.2026", CID: "ACC2", Agents: "Mehmet Ki" },
      // A stray July-dated row echoed inside the June spreadsheet's FTD tab.
      { "FTD Date": "02.07.2026", CID: "ACC3", Agents: "Mehmet Ki" },
    ],
    ftdTabConfig,
    tabConfig,
    new Map(),
  );
  const julyRows = buildKycFtdRowsFromFtdSheet(
    [
      { "FTD Date": "02.07.2026", CID: "ACC3", Agents: "Mehmet Ki" },
      { "FTD Date": "05.07.2026", CID: "ACC4", Agents: "Mehmet Ki" },
    ],
    ftdTabConfig,
    tabConfig,
    new Map(),
  );
  const combined = combineKycFtdRowsBySourceMonth([
    { monthRecord: { key: "2026-06" }, kycFtdRows: juneRows },
    { monthRecord: { key: "2026-07" }, kycFtdRows: julyRows },
  ]);
  // June contributes its two June rows; the stray July row inside June is
  // dropped, and July contributes its two July rows -> 4 total, no double count.
  assert.equal(combined.length, 4);
  const total = kycFtdCountFromRows([], tabConfig, { kycFtdRows: combined });
  assert.equal(total, 4);
});

test("combineKycFtdRowsBySourceMonth de-duplicates a shared spreadsheet across months", () => {
  // Same FTD tab (spanning June + July) read once per month record because the
  // office-month map points both month columns at the same spreadsheet.
  const sharedRows = buildKycFtdRowsFromFtdSheet(
    [
      { "FTD Date": "10.06.2026", CID: "ACC1", Agents: "Mehmet Ki" },
      { "FTD Date": "05.07.2026", CID: "ACC2", Agents: "Mehmet Ki" },
    ],
    ftdTabConfig,
    tabConfig,
    new Map(),
  );
  const combined = combineKycFtdRowsBySourceMonth([
    { monthRecord: { key: "2026-06" }, kycFtdRows: sharedRows },
    { monthRecord: { key: "2026-07" }, kycFtdRows: sharedRows },
  ]);
  assert.equal(combined.length, 2);
  assert.equal(kycFtdCountFromRows([], tabConfig, { kycFtdRows: combined }), 2);
});
