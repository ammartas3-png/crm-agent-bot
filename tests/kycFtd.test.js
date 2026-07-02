import assert from "node:assert/strict";
import test from "node:test";

import {
  agentNameFromFtdRow,
  attachKycFtdMapsToInfoContext,
  buildKycFtdCountByAgent,
  kycFtdCountFromRows,
} from "../lib/kycFtd.js";

const leadsTabConfig = {
  fields: {
    agentNames: "AGENT NAMES",
  },
};

const ftdTabConfig = {
  agentColumn: "AGENTS",
  fields: {
    agent: "AGENTS",
    customerId: "CID",
    country: "LIST OF COUNTRYS",
  },
};

test("agentNameFromFtdRow reads AGENTS column D", () => {
  assert.equal(agentNameFromFtdRow({ AGENTS: "  Ali Veli  " }, ftdTabConfig), "Ali Veli");
  assert.equal(agentNameFromFtdRow({ AGENTS: "#N/A" }, ftdTabConfig), "");
});

test("buildKycFtdCountByAgent counts FTD rows per agent", () => {
  const ftdRows = [
    { AGENTS: "Ali Veli", CID: "1001", "LIST OF COUNTRYS": "TR" },
    { AGENTS: "Ali Veli", CID: "1002", "LIST OF COUNTRYS": "TR" },
    { AGENTS: "Mehmet", CID: "2001", "LIST OF COUNTRYS": "PK" },
    { AGENTS: "", CID: "3001", "LIST OF COUNTRYS": "DE" },
  ];
  const counts = buildKycFtdCountByAgent(ftdRows, ftdTabConfig);
  assert.equal(counts.get("ali veli"), 2);
  assert.equal(counts.get("mehmet"), 1);
});

test("kycFtdCountFromRows matches lead agents to FTD agent counts", () => {
  const leadRows = [
    { "AGENT NAMES": "Ali Veli", __sourceMonthKey: "2026-03" },
    { "AGENT NAMES": "Ali Veli", __sourceMonthKey: "2026-03" },
    { "AGENT NAMES": "Mehmet", __sourceMonthKey: "2026-03" },
    { "AGENT NAMES": "Other Agent", __sourceMonthKey: "2026-03" },
  ];
  const infoContext = {
    kycFtdCountByAgent: new Map([
      ["ali veli", 2],
      ["mehmet", 1],
    ]),
  };
  assert.equal(kycFtdCountFromRows(leadRows, leadsTabConfig, infoContext), 3);
});

test("kycFtdCountFromRows uses month-specific FTD maps when available", () => {
  const leadRows = [
    { "AGENT NAMES": "Ali Veli", __sourceMonthKey: "2026-03" },
    { "AGENT NAMES": "Ali Veli", __sourceMonthKey: "2026-04" },
  ];
  const infoContext = {
    kycFtdCountByAgentByMonthKey: new Map([
      ["2026-03", new Map([["ali veli", 5]])],
      ["2026-04", new Map([["ali veli", 2]])],
    ]),
    kycFtdCountByAgent: new Map([["ali veli", 99]]),
  };
  assert.equal(kycFtdCountFromRows(leadRows, leadsTabConfig, infoContext), 7);
});

test("attachKycFtdMapsToInfoContext builds month map from month data", () => {
  const infoContext = {};
  attachKycFtdMapsToInfoContext(infoContext, [
    {
      monthRecord: { key: "2026-03" },
      kycFtdCountByAgent: new Map([["ali veli", 3]]),
    },
    {
      monthRecord: { key: "2026-04" },
      kycFtdCountByAgent: new Map([["mehmet", 1]]),
    },
  ]);
  assert.equal(infoContext.kycFtdCountByAgentByMonthKey.get("2026-03").get("ali veli"), 3);
  assert.equal(infoContext.kycFtdCountByAgentByMonthKey.get("2026-04").get("mehmet"), 1);
});
