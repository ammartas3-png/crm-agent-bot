import assert from "node:assert/strict";
import test from "node:test";

import { listRulesFromSheet } from "../lib/ruleSheetService.js";

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
