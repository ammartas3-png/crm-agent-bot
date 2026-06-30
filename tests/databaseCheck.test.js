import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDatabaseCheckSummary,
  handleDatabaseCheckCallback,
  parseStatusKeywordInput,
  rootStartKeyboard,
} from "../lib/databaseCheck.js";

test("rootStartKeyboard exposes admin sections", () => {
  const keyboard = rootStartKeyboard({ username: "antoniotsd" });
  const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
  assert.deepEqual(labels, [
    "Results from Months Table",
    "🤖 AI Assistant",
    "Access Requests",
    "Database Check",
  ]);
});

test("rootStartKeyboard hides database check for non-admin", () => {
  const keyboard = rootStartKeyboard({ username: "regular-user" });
  const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
  assert.deepEqual(labels, ["Results from Months Table"]);
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

test("dbcheck admins callback returns admin list text", async () => {
  const response = await handleDatabaseCheckCallback(1, "dbcheck:admins", {
    isAdmin: true,
    telegramUser: { username: "antoniotsd" },
  });
  assert.match(response.text, /Authorized admins:/);
});

test("dbcheck callback is blocked for non-admin", async () => {
  const response = await handleDatabaseCheckCallback(1, "dbcheck:open", {
    isAdmin: false,
    telegramUser: { username: "regular-user" },
  });
  assert.match(response.text, /admins only/i);
});
