import assert from "node:assert/strict";
import test from "node:test";

import { handleMenuCallback, isGreeting, startMenu } from "../lib/menu.js";
import { upsertMonthFile } from "../lib/monthlyReports.js";

// The Telegram bot uses the "simple" quick-report flow:
//   /start -> Select office -> Select quick report -> (Select month ->) Excel.
// These tests cover that navigation. The Excel export itself reads the month's
// Google Sheet and is covered by the workbook/monthly-report unit tests.

const NOW = new Date("2026-05-12T12:00:00Z");
const ADMIN = { id: 1240141730, username: "antoniotsd" };

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
    crTarget: "CR TARGET",
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
    Office: "Istanbul",
    "Team Leader": "Leader 1",
    "AGENT NAMES": "Ahmet",
    Status: "Potential",
    FTD: "1",
    "FTD MAKER": "Closer 1",
    "FTD DATE": "12/05/2026 10:30:00",
    "CR TARGET": "10%",
  },
];

const infoAgentsRows = [
  { "Working Status": "Working", "Agent Name": "Ahmet", "Agent Target": "10", Office: "Istanbul", "Team Leader": "Leader 1" },
];

const readRows = async (tabKey) => (tabKey === "infoAgents" ? infoAgentsRows : leadRows);

const opts = { tabConfig, infoAgentsTabConfig, readRows, now: NOW, telegramUser: ADMIN };

upsertMonthFile("May 2026", "sheet-may-test");

function buttons(response) {
  return (response?.replyMarkup?.inline_keyboard || []).flat();
}

async function openOfficeReports(userId) {
  const started = await startMenu(userId, opts);
  const officeButton = buttons(started).find((button) => button.callback_data?.startsWith("simple:office:"));
  assert.ok(officeButton, "startMenu should list at least one office");
  return handleMenuCallback(userId, officeButton.callback_data, opts);
}

test("isGreeting opens the menu for hello, start and /start", () => {
  assert.equal(isGreeting("hello"), true);
  assert.equal(isGreeting("start"), true);
  assert.equal(isGreeting("/start"), true);
});

test("startMenu asks the user to select an office", async () => {
  const started = await startMenu(101, opts);
  assert.match(started.text, /Select office/i);
  const officeButtons = buttons(started).filter((button) => button.callback_data?.startsWith("simple:office:"));
  assert.ok(officeButtons.length > 0);
});

test("selecting an office lists the quick reports", async () => {
  const reportList = await openOfficeReports(102);
  assert.match(reportList.text, /Select quick report/i);
  const labels = buttons(reportList).map((button) => button.text);
  assert.ok(labels.includes("Monthly Quick"));
  assert.ok(labels.includes("Last 4 Months Quick"));
  assert.ok(labels.includes("Benchmark Report"));
  // Navigation back to office selection is available.
  assert.ok(buttons(reportList).some((button) => button.callback_data === "simple:office:list"));
});

test("a single-month report asks which month to use", async () => {
  await openOfficeReports(103);
  const monthStep = await handleMenuCallback(103, "simple:report:monthly", opts);
  assert.match(monthStep.text, /Select report month/i);
  const monthButtons = buttons(monthStep).filter((button) =>
    button.callback_data?.startsWith("simple:month:monthly:"),
  );
  assert.ok(monthButtons.length > 0, "should list selectable months");
  // Back navigation to the report list and office list is offered.
  assert.ok(buttons(monthStep).some((button) => button.callback_data === "simple:report:list"));
  assert.ok(buttons(monthStep).some((button) => button.callback_data === "simple:office:list"));
});

test("Change Office returns to the office selection", async () => {
  await openOfficeReports(104);
  const backToOffices = await handleMenuCallback(104, "simple:office:list", opts);
  assert.match(backToOffices.text, /Select office/i);
  assert.ok(buttons(backToOffices).some((button) => button.callback_data?.startsWith("simple:office:")));
});

test("Back to Reports returns to the quick report list", async () => {
  await openOfficeReports(105);
  await handleMenuCallback(105, "simple:report:monthly", opts);
  const backToReports = await handleMenuCallback(105, "simple:report:list", opts);
  assert.match(backToReports.text, /Select quick report/i);
});

test("an outdated (non-simple) callback shows the reselect hint", async () => {
  await openOfficeReports(106);
  const stale = await handleMenuCallback(106, "report:office", opts);
  assert.match(stale.text, /select office and quick report again/i);
});

test("a disallowed authority scope blocks bot reports", async () => {
  const blocked = await handleMenuCallback(107, "simple:report:list", {
    ...opts,
    telegramUser: { id: 5, username: "restricted" },
    authorityScope: { allowed: false, unrestricted: false, filters: {} },
  });
  assert.match(blocked.text, /ALL authority/i);
});
