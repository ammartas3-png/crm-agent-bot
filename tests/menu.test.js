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
    ftd: "FTD",
    ftdMaker: "FTD MAKER",
    ftdDate: "FTD DATE",
    selfsIndicator: "Selfs",
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
    workingStatus: "Working Status",
    agentName: "Agent Name",
    agentTarget: "Agent Target",
    office: "Office",
    teamLeader: "Team Leader",
  },
};

const leadRows = [
  {
    ID: "1",
    Created: "12/05/2026 10:00:00",
    "Lead Date": "12/05/2026",
    Country: "Turkey",
    Campaign: "Campaign A",
    Office: "Istanbul",
    "Team Leader": "Leader 1",
    "AGENT NAMES": "Ahmet",
    Status: "Potential",
    FTD: "1",
    "FTD MAKER": "Closer 1",
    "FTD DATE": "12/05/2026 10:30:00",
    "CR TARGET": "10%",
    Selfs: "1",
    "LATE FTD +30 Day": "1",
  },
  {
    ID: "2",
    Created: "12/05/2026 11:00:00",
    "Lead Date": "12/05/2026",
    Country: "Turkey",
    Campaign: "Campaign A",
    Office: "Istanbul",
    "Team Leader": "Leader 1",
    "AGENT NAMES": "Max",
    Status: "Call Again",
    FTD: "0",
    "FTD MAKER": "",
    "CR TARGET": "20%",
    Selfs: "0",
  },
  {
    ID: "3",
    Created: "12/05/2026 11:10:00",
    "Lead Date": "12/05/2026",
    Country: "Germany",
    Campaign: "Campaign B",
    Office: "Berlin",
    "Team Leader": "Leader 2",
    "AGENT NAMES": "Mia",
    Status: "Potential",
    FTD: "1",
    "FTD MAKER": "Closer 2",
    "FTD DATE": "12/05/2026 12:00:00",
    "CR TARGET": "15%",
    Selfs: "1",
  },
];

const paginatedOfficeRows = Array.from({ length: 20 }).map((_, idx) => ({
  ID: `P-${idx + 1}`,
  Created: "12/05/2026 10:00:00",
  "Lead Date": "12/05/2026",
  Country: "Turkey",
  Campaign: "Campaign P",
  Office: `Office ${String(idx + 1).padStart(2, "0")}`,
  "Team Leader": `Leader ${idx + 1}`,
  "AGENT NAMES": `Agent ${idx + 1}`,
  Status: "Potential",
  FTD: idx % 2 === 0 ? "1" : "0",
  "FTD MAKER": idx % 2 === 0 ? `Closer ${idx + 1}` : "",
  "FTD DATE": idx % 2 === 0 ? "12/05/2026 10:30:00" : "",
  "CR TARGET": "10%",
  Selfs: idx % 3 === 0 ? "1" : "0",
}));

const infoAgentsRows = [
  {
    "Working Status": "Working",
    "Agent Name": "Ahmet",
    "Agent Target": "10",
    Office: "Istanbul",
    "Team Leader": "Leader 1",
  },
  {
    "Working Status": "Working",
    "Agent Name": "Max",
    "Agent Target": "20",
    Office: "Istanbul",
    "Team Leader": "Leader 1",
  },
  {
    "Working Status": "Working",
    "Agent Name": "Mia",
    "Agent Target": "30",
    Office: "Berlin",
    "Team Leader": "Leader 2",
  },
  {
    "Working Status": "Working",
    "Agent Name": "Zero Lead Agent",
    "Agent Target": "25",
    Office: "Berlin",
    "Team Leader": "Leader 2",
  },
  {
    "Working Status": "Left",
    "Agent Name": "Left Agent",
    "Agent Target": "100",
    Office: "Madrid",
    "Team Leader": "Leader X",
  },
];

const readRows = async (tabKey, options = {}) => {
  if (tabKey === "infoAgents") {
    return infoAgentsRows;
  }
  if (options.spreadsheetId === "pagination-sheet") {
    return paginatedOfficeRows;
  }
  return leadRows;
};

test("isGreeting opens the menu for hello and /start", () => {
  assert.equal(isGreeting("hello"), true);
  assert.equal(isGreeting("/start"), true);
});

test("mainMenuKeyboard follows required hierarchy order", () => {
  const keyboard = mainMenuKeyboard();
  const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
  assert.deepEqual(labels.slice(0, 5), ["Office", "Team Leader", "Agent", "Country", "Campaign"]);
});

test("office drilldown shows summary and child hierarchy", async () => {
  const started = await startMenu(100, { telegramUser: { id: 100, username: "regular" } });
  const monthCallback = started.replyMarkup.inline_keyboard[0][0].callback_data;
  await handleMenuCallback(100, monthCallback, { tabConfig, infoAgentsTabConfig, readRows, now: NOW });

  const officeRoot = await handleMenuCallback(100, "report:office", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(officeRoot.text, /Office Results/);
  assert.match(officeRoot.text, /Summary \(all records\)/);
  assert.match(officeRoot.text, /Lead/);
  assert.match(officeRoot.text, /Selfs/);
  assert.match(officeRoot.text, /FTD Target Reach/);

  const firstPick = officeRoot.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("drill:pick:"));
  assert.ok(firstPick);

  const teamLeaderList = await handleMenuCallback(100, firstPick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(teamLeaderList.text, /Team Leaders in/);
  assert.equal(
    teamLeaderList.replyMarkup.inline_keyboard.flat().some((button) => button.text === "Back to previous level"),
    true,
  );
});

test("agent flow leads to detailed metrics and back buttons", async () => {
  const started = await startMenu(101);
  const monthCallback = started.replyMarkup.inline_keyboard[0][0].callback_data;
  await handleMenuCallback(101, monthCallback, { tabConfig, infoAgentsTabConfig, readRows, now: NOW });

  const agentRoot = await handleMenuCallback(101, "report:agent", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const firstAgentPick = agentRoot.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("drill:pick:"));
  assert.ok(firstAgentPick);

  const agentDetail = await handleMenuCallback(101, firstAgentPick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(agentDetail.text, /^Agent:/);
  assert.match(agentDetail.text, /Selfs:/);
  assert.match(agentDetail.text, /FTD Target:/);
  assert.equal(
    agentDetail.replyMarkup.inline_keyboard
      .flat()
      .some((button) => button.text === "Back to Team Leader filter"),
    true,
  );
});

test("working agents without leads still appear in team leader drilldown", async () => {
  const started = await startMenu(103);
  const monthCallback = started.replyMarkup.inline_keyboard[0][0].callback_data;
  await handleMenuCallback(103, monthCallback, { tabConfig, infoAgentsTabConfig, readRows, now: NOW });

  const teamLeaderRoot = await handleMenuCallback(103, "report:teamLeader", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const leaderTwoButton = teamLeaderRoot.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.text === "Leader 2");
  assert.ok(leaderTwoButton);

  const agentsUnderLeader = await handleMenuCallback(103, leaderTwoButton.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(agentsUnderLeader.text, /Zero Lead Agent/);
  assert.match(agentsUnderLeader.text, /Lead 0/);
  assert.match(agentsUnderLeader.text, /FTD 0/);
  assert.match(agentsUnderLeader.text, /Selfs 0/);
});

test("pagination buttons appear when results exceed one page", async () => {
  upsertMonthFile("June 2026", "pagination-sheet");
  const started = await startMenu(102);
  await handleMenuCallback(102, "month:2026-06", { tabConfig, infoAgentsTabConfig, readRows, now: NOW });
  const officeRoot = await handleMenuCallback(102, "report:office", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const labels = officeRoot.replyMarkup.inline_keyboard.flat().map((button) => button.text);
  assert.equal(labels.includes("Next Page"), true);
  assert.equal(labels.includes("Previous Page"), true);
});

test("settings remove and hide/show month management still works for admin", async () => {
  upsertMonthFile("January 2026", "settings-test-sheet");
  const adminUser = { id: 1, username: "antoniotsd" };

  const settingsOpen = await handleMenuCallback(999, "settings:open", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
    telegramUser: adminUser,
  });
  assert.equal(
    settingsOpen.replyMarkup.inline_keyboard.flat().some((button) => button.text === "Remove Month File"),
    true,
  );
  assert.equal(
    settingsOpen.replyMarkup.inline_keyboard.flat().some((button) => button.text === "Hide/Show Month File"),
    true,
  );
});
