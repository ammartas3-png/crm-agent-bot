import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { handleMenuCallback, handleMenuText, isGreeting, mainMenuKeyboard, startMenu } from "../lib/menu.js";
import { upsertMonthFile } from "../lib/monthlyReports.js";
import { setSession } from "../lib/session.js";

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
    placement: "Placement",
    subCampaign: "Sub-Campaign",
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
    "Sub-Campaign": "Sub A1",
    Placement: "Placement A1",
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
    "Sub-Campaign": "Sub A2",
    Placement: "Placement A2",
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
    "Sub-Campaign": "Sub B1",
    Placement: "Placement B1",
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
  "Sub-Campaign": `Sub P${idx + 1}`,
  Placement: `Placement P${idx + 1}`,
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

async function selectMonthAndTotalDate(userId, options = {}) {
  const started = await startMenu(userId, options);
  const monthCallback = started.replyMarkup.inline_keyboard[0][0].callback_data;
  await handleMenuCallback(userId, monthCallback, { tabConfig, infoAgentsTabConfig, readRows, now: NOW });
  await handleMenuCallback(userId, "date:month", { tabConfig, infoAgentsTabConfig, readRows, now: NOW });
}

test("isGreeting opens the menu for hello, start and /start", () => {
  assert.equal(isGreeting("hello"), true);
  assert.equal(isGreeting("start"), true);
  assert.equal(isGreeting("/start"), true);
});

test("mainMenuKeyboard follows required hierarchy order", () => {
  const keyboard = mainMenuKeyboard();
  const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
  assert.deepEqual(labels.slice(0, 5), ["Office", "Team Leader", "Agent", "Country", "Campaign"]);
});

test("office drilldown shows summary and child hierarchy", async () => {
  await selectMonthAndTotalDate(100, { telegramUser: { id: 100, username: "regular" } });

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

  const teamLeaderPick = teamLeaderList.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("drill:pick:"));
  assert.ok(teamLeaderPick);
  const teamLeaderDetail = await handleMenuCallback(100, teamLeaderPick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.equal(
    teamLeaderDetail.replyMarkup.inline_keyboard.flat().some((button) => button.text === "View Agents"),
    true,
  );
  const viewAgents = await handleMenuCallback(100, "drill:next:agentNames", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(viewAgents.text, /Agents/);
});

test("agent flow leads to detailed metrics and back buttons", async () => {
  await selectMonthAndTotalDate(101);

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

test("team leader detail supports countries to sub-campaign drilldown", async () => {
  await selectMonthAndTotalDate(119);
  const officeRoot = await handleMenuCallback(119, "report:office", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const officePick = officeRoot.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("drill:pick:"));
  assert.ok(officePick);
  const teamLeaderList = await handleMenuCallback(119, officePick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const leaderPick = teamLeaderList.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("drill:pick:"));
  assert.ok(leaderPick);

  const leaderDetail = await handleMenuCallback(119, leaderPick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const leaderButtons = leaderDetail.replyMarkup.inline_keyboard.flat().map((button) => button.text);
  assert.equal(leaderButtons.includes("View Agents"), true);
  assert.equal(leaderButtons.includes("View Countries"), true);

  const countryList = await handleMenuCallback(119, "drill:next:country", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(countryList.text, /Country/);
  const countryPick = countryList.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("drill:pick:"));
  assert.ok(countryPick);

  const countryDetail = await handleMenuCallback(119, countryPick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.equal(
    countryDetail.replyMarkup.inline_keyboard.flat().some((button) => button.text === "View Campaigns"),
    true,
  );

  const campaignList = await handleMenuCallback(119, "drill:next:campaign", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const campaignPick = campaignList.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("drill:pick:"));
  assert.ok(campaignPick);

  const campaignDetail = await handleMenuCallback(119, campaignPick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.equal(
    campaignDetail.replyMarkup.inline_keyboard.flat().some((button) => button.text === "View Placements"),
    true,
  );

  const placementList = await handleMenuCallback(119, "drill:next:placement", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const placementPick = placementList.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("drill:pick:"));
  assert.ok(placementPick);

  const placementDetail = await handleMenuCallback(119, placementPick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.equal(
    placementDetail.replyMarkup.inline_keyboard.flat().some((button) => button.text === "View Sub-Campaigns"),
    true,
  );
});

test("working agents without leads still appear in team leader drilldown", async () => {
  await selectMonthAndTotalDate(103);

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
  await startMenu(102);
  await handleMenuCallback(102, "month:2026-06", { tabConfig, infoAgentsTabConfig, readRows, now: NOW });
  await handleMenuCallback(102, "date:month", { tabConfig, infoAgentsTabConfig, readRows, now: NOW });
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

test("month selection now asks date filter before report filters", async () => {
  const started = await startMenu(104);
  const monthCallback = started.replyMarkup.inline_keyboard[0][0].callback_data;
  const dateMenu = await handleMenuCallback(104, monthCallback, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(dateMenu.text, /Select date filter/i);
  const labels = dateMenu.replyMarkup.inline_keyboard.flat().map((button) => button.text);
  assert.equal(labels.includes("Total Month"), true);
  assert.equal(labels.includes("Custom Date Range"), true);
});

test("multi-month selection supports selecting two months", async () => {
  const started = await startMenu(122);
  const multiButton = started.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data === "month:multi");
  assert.ok(multiButton);
  const multiView = await handleMenuCallback(122, "month:multi", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(multiView.text, /Select one or more months/i);
  const monthToggles = multiView.replyMarkup.inline_keyboard
    .flat()
    .filter((button) => button.callback_data?.startsWith("monthMulti:toggle:"));
  assert.equal(monthToggles.length >= 2, true);
  await handleMenuCallback(122, monthToggles[0].callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  await handleMenuCallback(122, monthToggles[1].callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const done = await handleMenuCallback(122, "monthMulti:done", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(done.text, /Selected Months/i);
  const labels = done.replyMarkup.inline_keyboard.flat().map((button) => button.text);
  assert.equal(labels.includes("Office"), true);
  assert.equal(labels.includes("Team Leader"), true);
  assert.equal(labels.includes("Country"), false);
});

test("specific reports include hourly and country comparison", async () => {
  await selectMonthAndTotalDate(105);
  const specificMenu = await handleMenuCallback(105, "special:open", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(specificMenu.text, /Specific Reports/);
  const labels = specificMenu.replyMarkup.inline_keyboard.flat().map((button) => button.text);
  assert.equal(labels.includes("Hourly Leads"), true);
  assert.equal(labels.includes("Country Comparison"), true);

  const hourly = await handleMenuCallback(105, "special:hourly", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const hourlyLabels = hourly.replyMarkup.inline_keyboard.flat().map((button) => button.text);
  assert.equal(hourlyLabels.includes("Hourly Date: Total Month"), true);
  assert.equal(hourlyLabels.includes("Hourly Date: Custom Range"), true);
});

test("report view can export as excel document payload", async () => {
  await selectMonthAndTotalDate(112);
  await handleMenuCallback(112, "report:office", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const exportResponse = await handleMenuCallback(112, "export:current", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.equal(exportResponse.suppressTextResponse, true);
  assert.ok(Buffer.isBuffer(exportResponse.documentBuffer));
  assert.match(exportResponse.documentFilename, /\.xlsx$/i);
  const workbook = XLSX.read(exportResponse.documentBuffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
  const headerCandidates = [rows[1] || [], rows[2] || []];
  const headerText = headerCandidates.flat().join(" | ");
  assert.equal(/Lead/.test(headerText), true);
  assert.equal(/FTD/.test(headerText), true);
  assert.equal(/CR Target Reach/.test(headerText), true);
});

test("office and team leader support multi-select for export filters", async () => {
  await selectMonthAndTotalDate(121);
  const officeRoot = await handleMenuCallback(121, "report:office", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.equal(
    officeRoot.replyMarkup.inline_keyboard.flat().some((button) => button.text === "Select Multiple"),
    true,
  );
  const officeMulti = await handleMenuCallback(121, "drill:multiStart", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const officeToggleButtons = officeMulti.replyMarkup.inline_keyboard
    .flat()
    .filter((button) => button.callback_data?.startsWith("drill:multiToggle:"));
  assert.equal(officeToggleButtons.length >= 2, true);
  await handleMenuCallback(121, officeToggleButtons[0].callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  await handleMenuCallback(121, officeToggleButtons[1].callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const teamLeaderList = await handleMenuCallback(121, "drill:multiDone", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(teamLeaderList.text, /Team Leaders in selected Offices/);
  assert.equal(
    teamLeaderList.replyMarkup.inline_keyboard.flat().some((button) => button.text === "Select Multiple"),
    true,
  );
  const leaderMulti = await handleMenuCallback(121, "drill:multiStart", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const leaderToggle = leaderMulti.replyMarkup.inline_keyboard
    .flat()
    .find((button) => /Leader 1/i.test(button.text) && button.callback_data?.startsWith("drill:multiToggle:"));
  assert.ok(leaderToggle);
  await handleMenuCallback(121, leaderToggle.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const filteredTeamLeader = await handleMenuCallback(121, "drill:multiDone", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(filteredTeamLeader.text, /Leader 1/);
  assert.doesNotMatch(filteredTeamLeader.text, /Leader 2/);

  const exportResponse = await handleMenuCallback(121, "export:current", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const workbook = XLSX.read(exportResponse.documentBuffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
  const filterLine = matrix
    .slice(0, 6)
    .map((row) => String((row || [])[0] || ""))
    .find((line) => /Office:\s*|Team Leader:\s*/i.test(line)) || "";
  assert.equal(/Office:\s*/i.test(filterLine), true);
  assert.equal(/Team Leader:\s*Leader 1/i.test(filterLine), true);
  const headerRow = matrix.find((row) => row.includes("Lead"));
  assert.ok(headerRow);
  assert.equal(headerRow.includes("Office"), true);
  assert.equal(headerRow.includes("Team Leader"), true);
  const flattened = matrix.flat().map((cell) => String(cell || ""));
  assert.equal(flattened.some((cell) => cell === "Summary (all records)"), false);
  assert.equal(flattened.some((cell) => cell === "Total"), true);
});

test("campaign export includes selected campaign values in columns", async () => {
  await selectMonthAndTotalDate(120);
  const officeRoot = await handleMenuCallback(120, "report:office", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const officePick = officeRoot.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("drill:pick:"));
  assert.ok(officePick);
  const teamLeaderList = await handleMenuCallback(120, officePick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const leaderPick = teamLeaderList.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("drill:pick:"));
  assert.ok(leaderPick);
  await handleMenuCallback(120, leaderPick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const countryList = await handleMenuCallback(120, "drill:next:country", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const countryPick = countryList.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("drill:pick:"));
  assert.ok(countryPick);
  await handleMenuCallback(120, countryPick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  await handleMenuCallback(120, "drill:next:campaign", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });

  const exportResponse = await handleMenuCallback(120, "export:current", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const workbook = XLSX.read(exportResponse.documentBuffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
  const headerIndex = matrix.findIndex((row) => row.includes("Country") || row.includes("Campaign"));
  assert.ok(headerIndex >= 0);
  const dimensionColIndex = matrix[headerIndex].findIndex(
    (value) => value === "Country" || value === "Campaign",
  );
  assert.ok(dimensionColIndex >= 0);
  const hasDimensionValue = matrix
    .slice(headerIndex + 1)
    .some((row) => String(row[dimensionColIndex] || "").trim() !== "");
  assert.equal(hasDimensionValue, true);
  const filterLine = String((matrix[1] || [])[0] || "");
  assert.equal(/Country:\s*Turkey|Country:\s*Germany/i.test(filterLine), true);
});

test("last 4 months sends ALL excel directly and shows office export option", async () => {
  const response = await handleMenuCallback(108, "month:last4", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(response.text, /Period: Last 4 Months/i);
  assert.match(response.text, /ALL Excel sent/i);
  assert.ok(Buffer.isBuffer(response.documentBuffer));
  assert.match(response.documentFilename, /last4-all-.*\.xlsx$/i);
  const labels = response.replyMarkup.inline_keyboard.flat().map((button) => button.text);
  assert.equal(labels.includes("Specific Office Excel"), true);
  assert.equal(labels.includes("Send ALL Excel Again"), true);
});

test("last 4 months report uses compact target metrics and month breakdown", async () => {
  await handleMenuCallback(109, "month:last4", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const office = await handleMenuCallback(109, "report:office", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(office.text, /Target/);
  assert.match(office.text, /FTD/);
  assert.match(office.text, /CR Target Reach/);
  assert.match(office.text, /FTD Target Reach/);
  assert.match(office.text, /\|\s*May\s*\|/);
  assert.doesNotMatch(office.text, /Selfs/);
  assert.doesNotMatch(office.text, /Late FTD/);
});

test("last 4 months maps historical agents using current month info agents", async () => {
  const movingRows = [
    {
      ID: "M-1",
      Created: "12/04/2026 10:00:00",
      "Lead Date": "12/04/2026",
      Country: "Turkey",
      Campaign: "Campaign Move",
      Office: "OldOffice",
      "Team Leader": "OldLeader",
      "AGENT NAMES": "Mover",
      Status: "Potential",
      FTD: "1",
      "FTD MAKER": "Closer Move",
      "FTD DATE": "12/04/2026 11:00:00",
      "CR TARGET": "10%",
      Selfs: "0",
    },
  ];
  const currentInfoRows = [
    {
      "Working Status": "Working",
      "Agent Name": "Mover",
      "Agent Target": "20",
      Office: "NewOffice",
      "Team Leader": "NewLeader",
    },
  ];
  const readRowsLast3 = async (tabKey, options = {}) => {
    if (tabKey === "infoAgents") {
      return currentInfoRows;
    }
    if (tabKey === "leads") {
      return movingRows.map((row, index) => ({ ...row, ID: `${row.ID}-${options.spreadsheetId}-${index}` }));
    }
    return [];
  };
  await handleMenuCallback(110, "month:last4", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsLast3,
    now: NOW,
  });
  const office = await handleMenuCallback(110, "report:office", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsLast3,
    now: NOW,
  });
  assert.match(office.text, /NewOffice/);
  assert.doesNotMatch(office.text, /OldOffice/);
});

test("last 4 months uses month-specific targets in monthly breakdown", async () => {
  const leadTemplate = {
    Created: "12/04/2026 10:00:00",
    "Lead Date": "12/04/2026",
    Country: "Turkey",
    Campaign: "Campaign Move",
    Office: "OldOffice",
    "Team Leader": "OldLeader",
    "AGENT NAMES": "Mover",
    Status: "Potential",
    FTD: "1",
    "FTD MAKER": "Closer Move",
    "FTD DATE": "12/04/2026 11:00:00",
    "CR TARGET": "10%",
    Selfs: "0",
  };
  const bySheetTarget = {
    "1tbdyjZ-lJLZby9azuDysIw2ewnhP7wSMuX2mzD_bfME": 30, // April
    "1z-O1vy_vaFjU5Ys-P2VW4AMAXOEQ0nSzEjjOakDegsA": 20, // March
    "1R303xCVpamBTSkbH2QyT0JHCBPctayeYV9rERML6R5s": 10, // February
  };
  const readRowsByMonthTarget = async (tabKey, options = {}) => {
    const target = bySheetTarget[options.spreadsheetId] ?? 40; // current month (May) default
    if (tabKey === "infoAgents") {
      return [
        {
          "Working Status": "Working",
          "Agent Name": "Mover",
          "Agent Target": String(target),
          Office: "NewOffice",
          "Team Leader": "NewLeader",
        },
      ];
    }
    if (tabKey === "leads") {
      return [{ ...leadTemplate, ID: `T-${options.spreadsheetId}` }];
    }
    return [];
  };

  await handleMenuCallback(111, "month:last4", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsByMonthTarget,
    now: NOW,
  });
  const agent = await handleMenuCallback(111, "report:agent", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsByMonthTarget,
    now: NOW,
  });
  assert.match(agent.text, /\|\s*May\s*\|\s*Target 40/);
  assert.match(agent.text, /\|\s*April\s*\|\s*Target 30/);
  assert.match(agent.text, /\|\s*March\s*\|\s*Target 20/);
  assert.match(agent.text, /\|\s*February\s*\|\s*Target 10/);
});

test("last 4 months excludes agents not working in current info agents", async () => {
  const readRowsExcludeNonWorking = async (tabKey, options = {}) => {
    if (tabKey === "infoAgents") {
      if (options.spreadsheetId === "sheet-current") {
        return [
          {
            "Working Status": "Working",
            "Agent Name": "Working Agent",
            "Agent Target": "20",
            Office: "Office A",
            "Team Leader": "Leader A",
          },
          {
            "Working Status": "Not Working",
            "Agent Name": "Old Agent",
            "Agent Target": "10",
            Office: "Office Z",
            "Team Leader": "Leader Z",
          },
        ];
      }
      return [
        {
          "Working Status": "Working",
          "Agent Name": "Working Agent",
          "Agent Target": "20",
          Office: "Office A",
          "Team Leader": "Leader A",
        },
      ];
    }
    if (tabKey === "leads") {
      return [
        {
          ID: `W-${options.spreadsheetId}`,
          Created: "12/05/2026 10:00:00",
          "Lead Date": "12/05/2026",
          Country: "Turkey",
          Campaign: "Campaign X",
          Office: "OldOffice",
          "Team Leader": "OldLeader",
          "AGENT NAMES": "Working Agent",
          Status: "Potential",
          FTD: "1",
          "FTD MAKER": "Closer",
          "FTD DATE": "12/05/2026 10:30:00",
          "CR TARGET": "10%",
          Selfs: "0",
        },
        {
          ID: `O-${options.spreadsheetId}`,
          Created: "12/05/2026 11:00:00",
          "Lead Date": "12/05/2026",
          Country: "Turkey",
          Campaign: "Campaign X",
          Office: "Office Z",
          "Team Leader": "Leader Z",
          "AGENT NAMES": "Old Agent",
          Status: "Potential",
          FTD: "1",
          "FTD MAKER": "Closer",
          "FTD DATE": "12/05/2026 11:30:00",
          "CR TARGET": "10%",
          Selfs: "0",
        },
      ];
    }
    return [];
  };

  upsertMonthFile("May 2026", "sheet-current");
  await handleMenuCallback(114, "month:last4", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsExcludeNonWorking,
    now: NOW,
  });
  const agentList = await handleMenuCallback(114, "report:agent", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsExcludeNonWorking,
    now: NOW,
  });
  assert.match(agentList.text, /Working Agent/);
  assert.doesNotMatch(agentList.text, /Old Agent/);
});

test("last 4 months resolves renamed agents by Agent ID mapping", async () => {
  upsertMonthFile("May 2026", "sheet-current-id-rename");
  const readRowsByAgentId = async (tabKey, options = {}) => {
    if (tabKey === "infoAgents") {
      if (options.spreadsheetId === "sheet-current-id-rename") {
        return [
          {
            "Working Status": "Working",
            "Agent Name": "Annalena Gu",
            "Agent Target": "25",
            Office: "Turkey French",
            "Team Leader": "Yosr S",
          },
        ];
      }
      return [
        {
          "Working Status": "Working",
          "Agent Name": "Asli Gu",
          "Agent Target": "25",
          Office: "Turkey French",
          "Team Leader": "Yosr S",
        },
      ];
    }
    if (tabKey === "agentDirectory") {
      if (options.spreadsheetId === "sheet-current-id-rename") {
        return [{ "Agent Name": "Annalena Gu", "Agent ID": "THR1465" }];
      }
      return [{ "Agent Name": "Asli Gu", "Agent ID": "THR1465" }];
    }
    if (tabKey === "leads") {
      return [
        {
          ID: `R-${options.spreadsheetId}`,
          Created: "12/05/2026 11:00:00",
          "Lead Date": "12/05/2026",
          Country: "Turkey",
          Campaign: "Campaign R",
          Office: "Turkey French",
          "Team Leader": "Yosr S",
          "AGENT NAMES": "Asli Gu",
          "Agent ID": "THR1465",
          Status: "Potential",
          FTD: "1",
          "FTD MAKER": "Closer",
          "FTD DATE": "12/05/2026 11:30:00",
          "CR TARGET": "10%",
          Selfs: "0",
        },
      ];
    }
    return [];
  };

  await handleMenuCallback(115, "month:last4", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsByAgentId,
    now: NOW,
  });
  const agentList = await handleMenuCallback(115, "report:agent", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsByAgentId,
    now: NOW,
  });
  assert.match(agentList.text, /Annalena Gu/);
  assert.match(agentList.text, /FTD 4/);
  assert.doesNotMatch(agentList.text, /Asli Gu/);
});

test("last 4 months reuses first found Agent ID name for older months", async () => {
  upsertMonthFile("February 2026", "sheet-id-feb");
  upsertMonthFile("March 2026", "sheet-id-mar");
  upsertMonthFile("April 2026", "sheet-id-apr");
  upsertMonthFile("May 2026", "sheet-id-may");

  const readRowsAgentIdCarry = async (tabKey, options = {}) => {
    if (tabKey === "infoAgents") {
      if (options.spreadsheetId === "sheet-id-may") {
        return [
          {
            "Working Status": "Working",
            "Agent Name": "Annalena Gu",
            "Agent Target": "25",
            Office: "Turkey French",
            "Team Leader": "Yosr S",
          },
        ];
      }
      return [];
    }
    if (tabKey === "agentDirectory") {
      if (options.spreadsheetId === "sheet-id-apr") {
        return [{ "Agent Name": "Annalena Gu", "Agent ID": "THR1465" }];
      }
      return [];
    }
    if (tabKey === "leads") {
      const agentName = options.spreadsheetId === "sheet-id-may" ? "Annalena Gu" : "Legacy Name";
      return [
        {
          ID: `R2-${options.spreadsheetId}`,
          Created: "12/05/2026 11:00:00",
          "Lead Date": "12/05/2026",
          Country: "Turkey",
          Campaign: "Campaign R",
          Office: "Turkey French",
          "Team Leader": "Yosr S",
          "AGENT NAMES": agentName,
          "Agent ID": "THR1465",
          Status: "Potential",
          FTD: "1",
          "FTD MAKER": "Closer",
          "FTD DATE": "12/05/2026 11:30:00",
          "CR TARGET": "10%",
          Selfs: "0",
        },
      ];
    }
    return [];
  };

  setSession(116, {
    monthKey: "2026-05",
    monthLabel: "Last 4 Months (February 2026 - May 2026)",
    spreadsheetId: "sheet-id-may",
    last3Mode: true,
    last3MonthKeys: ["2026-02", "2026-03", "2026-04", "2026-05"],
    dateFilter: null,
    dateFilterLabel: "Last 4 Months",
    dateFilterKey: "last4",
    step: "select_report_type",
  });

  const agentList = await handleMenuCallback(116, "report:agent", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsAgentIdCarry,
    now: NOW,
  });
  assert.match(agentList.text, /Annalena Gu/);
  assert.match(agentList.text, /FTD 4/);
  assert.doesNotMatch(agentList.text, /Legacy Name/);
});

test("single month reports show Annalena for Asli alias", async () => {
  upsertMonthFile("May 2026", "sheet-alias-single");
  const readRowsAliasSingle = async (tabKey, options = {}) => {
    if (tabKey === "infoAgents") {
      return [
        {
          "Working Status": "Working",
          "Agent Name": "Asli Gu",
          "Agent Target": "25",
          Office: "Turkey French",
          "Team Leader": "Yosr S",
        },
      ];
    }
    if (tabKey === "leads") {
      return [
        {
          ID: `A-${options.spreadsheetId}`,
          Created: "12/05/2026 11:00:00",
          "Lead Date": "12/05/2026",
          Country: "Turkey",
          Campaign: "Campaign Alias",
          Office: "Turkey French",
          "Team Leader": "Yosr S",
          "AGENT NAMES": "Asli Gu",
          "Agent ID": "THR1465",
          Status: "Potential",
          FTD: "1",
          "FTD MAKER": "Closer",
          "FTD DATE": "12/05/2026 11:30:00",
          "CR TARGET": "10%",
          Selfs: "0",
        },
      ];
    }
    return [];
  };
  await startMenu(117);
  await handleMenuCallback(117, "month:2026-05", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsAliasSingle,
    now: NOW,
  });
  await handleMenuCallback(117, "date:month", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsAliasSingle,
    now: NOW,
  });
  const agentReport = await handleMenuCallback(117, "report:agent", {
    tabConfig,
    infoAgentsTabConfig,
    readRows: readRowsAliasSingle,
    now: NOW,
  });
  assert.match(agentReport.text, /Annalena Gu/);
  assert.doesNotMatch(agentReport.text, /Asli Gu/);
});

test("last 4 months all excel export returns document payload", async () => {
  await handleMenuCallback(113, "month:last4", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const response = await handleMenuCallback(113, "export:last4all", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(response.text, /All Excel export sent/i);
  assert.ok(Buffer.isBuffer(response.documentBuffer));
  assert.match(response.documentFilename, /last4-all-.*\.xlsx$/i);
});

test("last 4 months office-specific excel export returns filtered payload", async () => {
  await handleMenuCallback(118, "month:last4", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const officeList = await handleMenuCallback(118, "last4:officeList:0", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(officeList.text, /Select office/i);
  const officePick = officeList.replyMarkup.inline_keyboard
    .flat()
    .find((button) => button.callback_data?.startsWith("last4:officePick:"));
  assert.ok(officePick);
  const officeExport = await handleMenuCallback(118, officePick.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(officeExport.text, /Office Excel sent/i);
  assert.ok(Buffer.isBuffer(officeExport.documentBuffer));
  assert.match(officeExport.documentFilename, /last4-.*\.xlsx$/i);
});

test("hourly report accepts custom date range", async () => {
  await selectMonthAndTotalDate(106);
  await handleMenuCallback(106, "special:hourly", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const prompt = await handleMenuCallback(106, "special:hourlyDate:custom", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(prompt.text, /DD\/MM\/YYYY - DD\/MM\/YYYY/);

  const ranged = await handleMenuText(106, "12/05/2026 - 12/05/2026", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(ranged.text, /Custom \(12\/05\/2026 - 12\/05\/2026\)/);
});

test("country comparison displays CR target reach ranking details", async () => {
  await startMenu(107);
  await handleMenuCallback(107, "month:2026-05", { tabConfig, infoAgentsTabConfig, readRows, now: NOW });
  await handleMenuCallback(107, "date:month", { tabConfig, infoAgentsTabConfig, readRows, now: NOW });
  const selector = await handleMenuCallback(107, "special:compareCountry", {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  const turkey = selector.replyMarkup.inline_keyboard.flat().find((button) => button.text === "Turkey");
  assert.ok(turkey);
  const comparison = await handleMenuCallback(107, turkey.callback_data, {
    tabConfig,
    infoAgentsTabConfig,
    readRows,
    now: NOW,
  });
  assert.match(comparison.text, /Top Agents/);
  assert.match(comparison.text, /CR Target Reach/);
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
