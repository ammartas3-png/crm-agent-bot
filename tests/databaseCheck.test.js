import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDatabaseCheckSummary,
  parseStatusKeywordInput,
  rootStartKeyboard,
} from "../lib/databaseCheck.js";

test("rootStartKeyboard exposes two sections", () => {
  const keyboard = rootStartKeyboard();
  const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
  assert.deepEqual(labels, ["Results from Months Table", "Database Check"]);
});

test("parseStatusKeywordInput parses status and keyword", () => {
  const parsed = parseStatusKeywordInput("Call Again | tomorrow");
  assert.deepEqual(parsed, { status: "Call Again", keyword: "tomorrow" });
  assert.equal(parseStatusKeywordInput("invalid"), null);
});

test("formatDatabaseCheckSummary renders all counters", () => {
  const text = formatDatabaseCheckSummary(
    {
      totalRows: 10,
      skippedCorrect: 6,
      statusChanges: 2,
      manualChecks: 1,
      appointmentChecks: 1,
    },
    4,
  );
  assert.match(text, /Total rows checked: 10/);
  assert.match(text, /Rows in output: 4/);
});
