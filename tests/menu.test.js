import assert from "node:assert/strict";
import test from "node:test";

import { handleMenuCallback, isGreeting, mainMenuKeyboard, startMenu } from "../lib/menu.js";
import { upsertMonthFile } from "../lib/monthlyReports.js";

const NOW = new Date("2026-05-12T12:00:00Z");

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
    office: "Office",
    department: "Department",
  },
};

const infoAgentsTabConfig = {
  fields: {
    agentName: "Agent Name",
    agentTarget: "Agent Target",
  },
};

const leadsRows = [
  {
    ID: "1",
    Created: "12/05/2026 10:00:00",
    "Lead Date": "12/05/2026",
    Country: "Turkey",
    Campaign: "Campaign A",
    Department: "Retention",
    Office: "Istanbul",
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
    Department: "Retention",
    Office: "Istanbul",
    "Team Leader": "Leader 1",
    Status: "Call Again",
    "FTD MAKER": "",
    "CR TARGET": "20%",
    "Diffrent Month": "yes",
    "AGENT NAMES": "Max",
  },
];

const infoAgentsRows = [
  { "Agent Name": " ahmet ", "Agent Target": "10" },
  { "Agent Name": "Max", "Agent Target": "20" },
];

const historicalRows = [
  {
    ID: "7",
    Created: "04/04/2026 10:00:00",
    "Lead Date": "04/04/2026",
    Country: "Turkey",
    Campaign: "Campaign A",
    Department: "Retention",
    Office: "Istanbul",
    "Team Leader": "Leader Old",
    Status: "Potential",
    "FTD MAKER": "Closer X",
    "FTD DATE": "05/04/2026 10:30:00",
    "CR TARGET": "10%",
    "AGENT NAMES": "Ahmet",
  },
];

const readRows = async (tabKey, options = {}) => {
  if (options.spreadsheetId === "historical-sheet") {
    return tabKey === "infoAgents" ? infoAgentsRows : historicalRows;
  }
  return tabKey === "infoAgents" ? infoAgentsRows : leadsRows;
};

test("isGreeting opens the menu for hello and /start", () => {
  assert.equal(isGreeting("hello"), true);
  assert.equal(isGreeting("/start"), true);
});

test("mainMenuKeyboard contains required report filters", () => {
  const keyboard = mainMenuKeyboard();
  const labels = keyboard.inline_keyboard.flat().map((button) => button.text);

  assert.equal(labels.includes("Office"), true);
  assert.equal(labels.includes("Desk"), true);
  assert.equal(labels.includes("Team Leader"), true);
  assert.equal(labels.includes("Agent"), true);
  assert.equal(labels.includes("Country"), true);
  assert.equal(labels.includes("Total Results"), true);
});

test("month-first flow includes target metrics in agent report", async () => {
  const started = await startMenu(123, { telegramUser: { id: 123, username: "regular" } });
  assert.equal(started.text, "Select report month:");
  const firstMonthCallback = started.replyMarkup.inline_keyboard[0][0].callback_data;

  const monthStep = await handleMenuCallback(123, firstMonthCallback, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
    telegramUser: { id: 123, username: "regular" },
  });
  assert.match(monthStep.text, /Select report filter/);

  const agentStep = await handleMenuCallback(123, "report:agent", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(agentStep.text, /Select agent/);

  await handleMenuCallback(123, "value:0", { tabConfig, infoAgentsTabConfig, readRows, now: NOW });
  const answer = await handleMenuCallback(123, "date:all", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(answer.text, /Target:/);
  assert.match(answer.text, /FTD:/);
  assert.match(answer.text, /Target Reach %:/);
});

test("team leader report includes summed target metrics", async () => {
  const started = await startMenu(456);
  const firstMonthCallback = started.replyMarkup.inline_keyboard[0][0].callback_data;
  await handleMenuCallback(456, firstMonthCallback, { tabConfig, infoAgentsTabConfig, readRows, now: NOW });
  await handleMenuCallback(456, "report:teamLeader", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  await handleMenuCallback(456, "value:0", { tabConfig, infoAgentsTabConfig, readRows, now: NOW });
  const answer = await handleMenuCallback(456, "date:all", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(answer.text, /Team Leader Target:/);
  assert.match(answer.text, /FTD Target Reach %:/);
});

test("historical month only returns summary totals", async () => {
  upsertMonthFile("April 2026", "historical-sheet");
  const started = await startMenu(789);
  const historicalMonthButton = started.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data === "month:2026-04");
  assert.ok(historicalMonthButton);
  await handleMenuCallback(789, "month:2026-04", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const officeSummary = await handleMenuCallback(789, "report:office", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(officeSummary.text, /Office Totals — April 2026/);

  const breakdown = await handleMenuCallback(789, "breakdown:campaignBreakdown", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(breakdown.text, /disabled for past months/);
});
