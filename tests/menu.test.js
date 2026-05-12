import assert from "node:assert/strict";
import test from "node:test";

import { handleMenuCallback, isGreeting, mainMenuKeyboard, startMenu } from "../lib/menu.js";

const tabConfig = {
  fields: {
    id: "ID",
    created: "Created",
    status: "Status",
    country: "Country",
    ftd: "FTD",
    crTarget: "CR TARGET",
    lateFtdDifference: "LATE FTD Difference",
    agentNames: "AGENT NAMES",
  },
};

const rows = [
  {
    ID: "1",
    Created: "12/05/2026 10:00:00",
    Country: "Turkey",
    Status: "Potential",
    FTD: 1,
    "CR TARGET": "10%",
    "AGENT NAMES": "Ahmet",
  },
  {
    ID: "2",
    Created: "12/05/2026 11:00:00",
    Country: "Germany",
    Status: "Call Again",
    FTD: 0,
    "CR TARGET": "20%",
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

  const countryStep = await handleMenuCallback(123, "dim:country", { tabConfig, readRows });
  assert.equal(countryStep.text, "Select country:");
  assert.equal(
    countryStep.replyMarkup.inline_keyboard.flat().some((button) => button.text === "Turkey"),
    true,
  );

  const selected = await handleMenuCallback(123, "value:1", { tabConfig, readRows });
  assert.match(selected.text, /Country: Turkey|Country: Germany/);

  const answer = await handleMenuCallback(123, "metric:totalLeads", { tabConfig, readRows });
  assert.match(answer.text, /Total Leads: 1/);
});
