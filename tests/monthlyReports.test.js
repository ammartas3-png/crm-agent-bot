import assert from "node:assert/strict";
import test from "node:test";

import {
  getMonthFile,
  isPastMonthKey,
  monthFilterFromKey,
  parseMonthKey,
  upsertMonthFile,
} from "../lib/monthlyReports.js";

test("upsertMonthFile stores month mapping and normalizes sheet URL", () => {
  const record = upsertMonthFile(
    "May 2026",
    "https://docs.google.com/spreadsheets/d/abc123xyz456/edit#gid=0",
  );
  assert.equal(record.key, "2026-05");
  assert.equal(record.spreadsheetId, "abc123xyz456");
  assert.equal(getMonthFile("2026-05")?.spreadsheetId, "abc123xyz456");
});

test("month parsing and historical checks work", () => {
  assert.equal(parseMonthKey("2026-04")?.label, "April 2026");
  assert.equal(isPastMonthKey("2026-04", new Date("2026-05-10T00:00:00Z")), true);
});

test("monthFilterFromKey returns month/year filter", () => {
  assert.deepEqual(monthFilterFromKey("2026-05"), { type: "month", month: 4, year: 2026 });
});
