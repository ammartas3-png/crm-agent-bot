import assert from "node:assert/strict";
import test from "node:test";

import { answerQuery, parseQuery } from "../lib/queryRouter.js";

const NOW = new Date("2026-05-12T10:00:00Z");

const tabConfigs = {
  leads: {
    fields: {
      brand: "Brand",
      id: "ID",
      created: "Created",
      leadDate: "Lead Date",
      status: "Status",
      country: "Country",
      campaign: "Campaign",
      firstCallAgent: "First Call Agent",
      teamLeader: "Team Leader",
      ftdMaker: "FTD MAKER",
      office: "Office",
      crTarget: "CR TARGET",
      ftdDate: "FTD DATE",
      lateFtdDifference: "LATE FTD Difrrence",
      differentMonth: "Diffrent Month",
      agentNames: "AGENT NAMES",
    },
  },
  ftd: {
    dateColumn: "Date",
    countryColumn: "Country",
    agentColumn: "Agent",
    statusColumn: null,
    amountColumn: "Amount",
  },
  transactions: {
    dateColumn: "Date",
    countryColumn: "Country",
    agentColumn: null,
    statusColumn: "Type",
    amountColumn: "Amount",
  },
};

const data = {
  leads: [
    {
      Brand: "BrandA",
      ID: "1",
      Created: "12/05/2026 10:15:00",
      "Lead Date": "12/05/2026",
      Country: "Turkey",
      Campaign: "Campaign A",
      "First Call Agent": "Ahmet",
      "Team Leader": "Leader 1",
      Status: "Potential",
      "FTD MAKER": "Closer 1",
      Office: "Istanbul",
      "CR TARGET": "10%",
      "FTD DATE": "12/05/2026 11:00:00",
      "LATE FTD Difrrence": "",
      "Diffrent Month": "",
      "AGENT NAMES": "Ahmet",
    },
    {
      Brand: "BrandA",
      ID: "2",
      Created: "02/05/2026 12:20:00",
      "Lead Date": "02/05/2026",
      Country: "Turkey",
      Campaign: "Campaign A",
      "First Call Agent": "Ayse",
      "Team Leader": "Leader 1",
      Status: "Potential",
      Office: "Istanbul",
      "CR TARGET": "10%",
      "LATE FTD Difrrence": "2h",
      "Diffrent Month": "",
      "AGENT NAMES": "Ayse",
    },
    {
      Brand: "BrandB",
      ID: "3",
      Created: "02/04/2026 09:00:00",
      "Lead Date": "02/04/2026",
      Country: "Germany",
      Campaign: "Campaign B",
      "First Call Agent": "Ahmet",
      "Team Leader": "Leader 2",
      Status: "Potential",
      "FTD MAKER": "Closer 2",
      Office: "Berlin",
      "CR TARGET": "20%",
      "FTD DATE": "12/05/2026 14:00:00",
      "Diffrent Month": "yes",
      "AGENT NAMES": "Ahmet",
    },
  ],
  ftd: [
    { Date: "2026-05-12", Country: "Turkey", Agent: "Ahmet", Amount: 100 },
    { Date: "2026-05-11", Country: "Germany", Agent: "Max", Amount: 200 },
  ],
  transactions: [
    { Date: "2026-05-12", Country: "Turkey", Type: "Deposit", Amount: 100 },
    { Date: "2026-05-12", Country: "Turkey", Type: "Withdrawal", Amount: 40 },
  ],
};

function answer(text) {
  return answerQuery(text, {
    now: NOW,
    getTabConfig: (tabKey) => tabConfigs[tabKey],
    readRows: async (tabKey) => data[tabKey],
  });
}

test("parseQuery routes FTD questions to the CRM leads tab", () => {
  const parsed = parseQuery("How many FTD today?", NOW);

  assert.equal(parsed.type, "metric");
  assert.equal(parsed.tabKey, "leads");
  assert.equal(parsed.metric.key, "totalFtd");
  assert.deepEqual(parsed.filters.date, { type: "today" });
});

test("answerQuery calculates FTD today count", async () => {
  assert.equal(await answer("How many FTD today?"), "Total FTD (today): 2");
});

test("answerQuery calculates country leads", async () => {
  assert.equal(await answer("Germany total leads?"), "leads (Germany): 0");
});

test("answerQuery calculates agent total calls", async () => {
  assert.equal(await answer("Ahmet total calls?"), "total calls (Ahmet): 1");
});

test("answerQuery applies month and country filters", async () => {
  assert.equal(await answer("May Turkey leads count?"), "leads (May, Turkey): 2");
});

test("answerQuery calculates country CR", async () => {
  assert.equal(await answer("Germany CR this month"), "CR (May, Germany): 0.00%");
});

test("answerQuery lists top agents by FTD", async () => {
  const response = await answer("Show top agents by FTD");

  assert.match(response, /^Top Agents by FTD/);
  assert.match(response, /Ahmet: 2/);
});

test("answerQuery lists FTD by hour", async () => {
  const response = await answer("Show FTD by hour");

  assert.match(response, /^FTD by Hour/);
  assert.match(response, /10:00: 1/);
});
