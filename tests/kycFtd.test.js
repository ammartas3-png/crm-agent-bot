import assert from "node:assert/strict";
import test from "node:test";

import { buildKycFtdRowsFromFtdSheet, kycFtdCountFromRows } from "../lib/dashboardService.js";
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
