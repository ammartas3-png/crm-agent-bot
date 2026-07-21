import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKycFtdRowsFromFtdSheet,
  filterKycFtdRowsForPermission,
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

test("KYC FTD counts FTD sheet rows for month file when FTD date is missing", () => {
  const kycRows = buildKycFtdRowsFromFtdSheet(
    [
      {
        CID: "ACC500",
        Agents: "Abdulrahim Fe",
      },
    ],
    ftdTabConfig,
    tabConfig,
    new Map(),
    {
      monthKey: "2026-07",
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
    },
  );
  assert.equal(kycRows.length, 1);
  assert.equal(kycRows[0].__sourceMonthKey, "2026-07");
  assert.equal(
    kycFtdCountFromRows([], tabConfig, {
      kycFtdRows: kycRows,
      dateFilter: { type: "month", month: 6, year: 2026 },
      scope: { agent: ["Abdulrahim Fe"] },
    }),
    1,
  );
});

test("KYC FTD maps FTD tab columns A-J including LIST OF COUNTRYS and TEAM desk fallback", () => {
  const ftdRows = [
    {
      "FTD Date": "01.07.2026",
      CID: "ACC376216",
      "LIST OF COUNTRYS": "Saint Lucia",
      Agents: "Mehmet Ki",
      AFF: "996-FR",
      RegistrationDate: "30.06.2026",
      TEAM: "Murat K",
      BRAND: "Fintana",
      Cheker: "1",
    },
    {
      "FTD Date": "01.07.2026",
      CID: "ACC382021",
      "LIST OF COUNTRYS": "Singapore",
      Agents: "Mehmet Ki",
      AFF: "Bentley-SG",
      RegistrationDate: "01.07.2026",
      TEAM: "Murat K",
      BRAND: "Spova",
      Cheker: "1",
    },
  ];
  const kycRows = buildKycFtdRowsFromFtdSheet(ftdRows, ftdTabConfig, tabConfig, new Map(), {
    monthKey: "2026-07",
    leadsProfileMap: new Map([
      [
        "mehmet ki",
        {
          agentName: "Mehmet Kılıç",
          desk: "AE Indonesia",
          teamLeader: "Murat K",
        },
      ],
    ]),
  });
  assert.equal(kycRows.length, 2);
  assert.equal(kycRows[0].Country, "Saint Lucia");
  assert.equal(kycRows[0].Brand, "Fintana");
  assert.equal(kycRows[0].Campaign, "996-FR");
  assert.equal(kycRows[0]["Team Leader"], "Murat K");
  assert.equal(kycRows[0].Desk, "AE Indonesia");
  assert.equal(kycRows[0].ID, "ACC376216");
  assert.equal(
    kycFtdCountFromRows([], tabConfig, {
      kycFtdRows: kycRows,
      dateFilter: { type: "month", month: 6, year: 2026 },
      scope: { agent: ["Mehmet Kılıç"] },
    }),
    2,
  );
});

test("KYC FTD permission merge keeps every FTD-sheet row without CID", () => {
  const kycRows = buildKycFtdRowsFromFtdSheet(
    Array.from({ length: 13 }, () => ({
      Agents: "Abdulrahim Fe",
    })),
    ftdTabConfig,
    tabConfig,
    new Map(),
    {
      monthKey: "2026-07",
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
    },
  );
  const filtered = filterKycFtdRowsForPermission(
    kycRows,
    tabConfig,
    { desk: ["Turkey Africa"] },
    new Set(["abdulrahim fe"]),
  );
  assert.equal(filtered.length, 13);
  assert.equal(
    kycFtdCountFromRows([], tabConfig, {
      kycFtdRows: filtered,
      dateFilter: { type: "month", month: 6, year: 2026 },
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
