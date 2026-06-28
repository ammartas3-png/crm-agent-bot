import assert from "node:assert/strict";
import test from "node:test";

import { listRulesFromSheet, listStatusHintsFromSheet } from "../lib/ruleSheetService.js";

function mockSheetsClient(values) {
  return {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values } }),
      },
    },
  };
}

test("reads keyword column when header is 'Keyword' and skips Rules column", async () => {
  const values = [
    [
      "Statuses",
      "Rules",
      "Keyword",
      "Negative Keyword",
      "Rule Type",
      "Priority",
      "Active",
      "Country",
      "Required Action",
      "Appointment Required",
    ],
    [
      "Call Again",
      "Use when callback is requested",
      "call back, call tomorrow",
      "not interested",
      "keyword",
      "1",
      "TRUE",
      "ALL",
      "follow_up",
      "TRUE",
    ],
  ];

  const rules = await listRulesFromSheet({
    sheetsClient: mockSheetsClient(values),
    spreadsheetId: "sheet",
    sheetName: "Sheet2",
  });

  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].positiveKeywords, ["call back", "call tomorrow"]);
  assert.deepEqual(rules[0].negativeKeywords, ["not interested"]);
  assert.equal(rules[0].priority, 1);
  assert.equal(rules[0].active, true);
});

test("reads positive keyword column in legacy positive/negative format", async () => {
  const values = [
    ["Status", "Positive Keywords", "Negative Keywords", "Priority", "Active"],
    ["No Interest", "not interested", "call back", "2", "TRUE"],
  ];

  const rules = await listRulesFromSheet({
    sheetsClient: mockSheetsClient(values),
    spreadsheetId: "sheet",
    sheetName: "Sheet2",
  });

  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].positiveKeywords, ["not interested"]);
  assert.deepEqual(rules[0].negativeKeywords, ["call back"]);
});

test("reads Sheet1 status hints from plain A/B rows without header", async () => {
  const values = [
    ["Call Again", "Use when client asks callback or later call"],
    ["Recall", "Use if client says dont call or never call"],
  ];

  const hints = await listStatusHintsFromSheet({
    sheetsClient: mockSheetsClient(values),
    spreadsheetId: "sheet",
    sheetName: "Sheet1",
  });

  assert.equal(hints.length, 2);
  assert.equal(hints[0].status, "Call Again");
  assert.equal(hints[1].status, "Recall");
});

test("reads Sheet1 status hints when first row is header", async () => {
  const values = [
    ["Status", "Description"],
    ["No Interest", "Use when client says not interested"],
  ];

  const hints = await listStatusHintsFromSheet({
    sheetsClient: mockSheetsClient(values),
    spreadsheetId: "sheet",
    sheetName: "Sheet1",
  });

  assert.equal(hints.length, 1);
  assert.equal(hints[0].status, "No Interest");
  assert.equal(hints[0].description, "Use when client says not interested");
});
