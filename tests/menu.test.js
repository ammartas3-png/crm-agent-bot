import assert from "node:assert/strict";
import test from "node:test";

import {
  handleMenuCallback,
  handleMenuText,
  isGreeting,
  mainMenuKeyboard,
  startMenu,
} from "../lib/menu.js";

const tabConfig = {
  fields: {
    id: "ID",
    created: "Created",
    leadDate: "Lead Date",
    status: "Status",
    country: "Country",
    ftdMaker: "FTD MAKER",
    ftdDate: "FTD DATE",
    crTarget: "CR TARGET",
    lateFtdDifference: "LATE FTD Difrrence",
    lateFtdPlus30Day: "LATE FTD +30 Day",
    differentMonth: "Diffrent Month",
    agentNames: "AGENT NAMES",
    campaign: "Campaign",
    teamLeader: "Team Leader",
  },
};

const rows = [
  {
    ID: "1",
    Created: "12/05/2026 10:00:00",
    "Lead Date": "12/05/2026",
    Country: "Turkey",
    Campaign: "Campaign A",
    "Team Leader": "Leader 1",
    Status: "Potential",
    "FTD MAKER": "Closer 1",
    "FTD DATE": "12/05/2026 10:30:00",
    "CR TARGET": "10%",
    "LATE FTD +30 Day": "1",
    "AGENT NAMES": "Ahmet",
  },
  {
    ID: "2",
    Created: "12/05/2026 11:00:00",
    "Lead Date": "11/05/2026",
    Country: "Germany",
    Campaign: "Campaign B",
    "Team Leader": "Leader 2",
    Status: "Call Again",
    "FTD MAKER": "",
    "CR TARGET": "20%",
    "Diffrent Month": "yes",
    "AGENT NAMES": "Max",
  },
];

const readRows = async () => rows;

test("isGreeting opens the menu for hello and /start", () => {
  assert.equal(isGreeting("hello"), true);
  assert.equal(isGreeting("/start"), true);
});

test("mainMenuKeyboard contains country and agent buttons", () => {
  const keyboard = mainMenuKeyboard();
  const labels = keyboard.inline_keyboard.flat().map((button) => button.text);

  assert.equal(labels.includes("Report by Country"), true);
  assert.equal(labels.includes("Report by Agent"), true);
});

test("guided country flow lists sheet countries and calculates metric", async () => {
  const started = await startMenu(123);
  assert.equal(started.text, "Select a report type:");

  const countryStep = await handleMenuCallback(123, "report:country", { tabConfig, readRows });
  assert.equal(countryStep.text, "Select country:");
  assert.equal(
    countryStep.replyMarkup.inline_keyboard.flat().some((button) => button.text === "Turkey"),
    true,
  );

  const selected = await handleMenuCallback(123, "value:1", { tabConfig, readRows });
  assert.match(selected.text, /Country: Turkey|Country: Germany/);
  assert.match(selected.text, /Select date range/);

  const answer = await handleMenuCallback(123, "date:all", { tabConfig, readRows });
  assert.match(answer.text, /Total Leads: 1/);
  assert.doesNotMatch(answer.text, /Valid Leads:/);
  assert.match(answer.text, /CR Target Reach:/);
  assert.doesNotMatch(answer.text, /leadRowsByLeadDate:/);
  assert.doesNotMatch(answer.text, /ftdRowsByFtdDate:/);
  assert.doesNotMatch(answer.text, /rawLeadCount:/);
});

test("post-report breakdown callbacks use the last selected report", async () => {
  await handleMenuCallback(456, "report:country", { tabConfig, readRows });
  await handleMenuCallback(456, "value:1", { tabConfig, readRows });
  await handleMenuCallback(456, "date:all", { tabConfig, readRows });

  const breakdown = await handleMenuCallback(456, "breakdown:campaignBreakdown", {
    tabConfig,
    readRows,
  });
  assert.match(breakdown.text, /Campaign Breakdown/);
});

test("custom date range text completes report generation", async () => {
  await handleMenuCallback(789, "report:country", { tabConfig, readRows });
  await handleMenuCallback(789, "value:1", { tabConfig, readRows });
  const prompt = await handleMenuCallback(789, "date:custom", { tabConfig, readRows });
  assert.match(prompt.text, /DD\/MM\/YYYY/);

  const answer = await handleMenuText(789, "01/05/2026 - 31/05/2026", { tabConfig, readRows });
  assert.match(answer.text, /Date Range: 01\/05\/2026 - 31\/05\/2026/);
});
