import assert from "node:assert/strict";
import test from "node:test";

import {
  currentMonthKey,
  filterReportMonthRecords,
  getMonthFile,
  isPastMonthKey,
  listMonthFiles,
  monthFilterFromKey,
  parseMonthKey,
  removeMonthFile,
  setMonthFileActive,
  upsertMonthFile,
} from "../lib/monthlyReports.js";

test("built-in 2026 month mappings are available", () => {
  assert.equal(getMonthFile("2026-01")?.sheet_id, "1Gf6f2xs8jRL6MMNwLMM4is-mdMBMCR_k4EW0LcvnD01k");
  assert.equal(getMonthFile("2026-02")?.sheet_id, "1R303xCVpamBTSkbH2QyT0JHCBPctayeYV9rERML6R5s");
  assert.equal(getMonthFile("2026-03")?.sheet_id, "1z-O1vy_vaFjU5Ys-P2VW4AMAXOEQ0nSzEjjOakDegsA");
  assert.equal(getMonthFile("2026-04")?.sheet_id, "1tbdyjZ-lJLZby9azuDysIw2ewnhP7wSMuX2mzD_bfME");
  assert.equal(getMonthFile("2026-06")?.sheet_id, "1sry1psAKWFWGWnE47aQYR2uC0k0Wj7-0RUD8sn5XOAM");
});

test("upsertMonthFile stores required structure fields and normalizes sheet URL", () => {
  const record = upsertMonthFile(
    "May 2026",
    "https://docs.google.com/spreadsheets/d/abc123xyz456/edit#gid=0",
  );
  assert.equal(record.key, "2026-05");
  assert.equal(record.month_label, "May 2026");
  assert.equal(record.sheet_id, "abc123xyz456");
  assert.equal(record.active, true);
  assert.ok(record.created_at);
  assert.ok(record.updated_at);
  assert.equal(getMonthFile("2026-05")?.sheet_id, "abc123xyz456");
});

test("month parsing and historical checks work", () => {
  assert.equal(parseMonthKey("2026-04")?.month_label, "April 2026");
  assert.equal(isPastMonthKey("2026-04", new Date("2026-05-10T00:00:00Z")), true);
});

test("monthFilterFromKey returns month/year filter", () => {
  assert.deepEqual(monthFilterFromKey("2026-05"), { type: "month", month: 4, year: 2026 });
});

test("setMonthFileActive hides month from active listing", () => {
  upsertMonthFile("March 2026", "sheet-march");
  const hidden = setMonthFileActive("2026-03", false);
  assert.equal(hidden.active, false);
  assert.equal(listMonthFiles().some((item) => item.key === "2026-03"), false);
  assert.equal(listMonthFiles({ includeInactive: true }).some((item) => item.key === "2026-03"), true);
});

test("removeMonthFile deletes mapping completely", () => {
  upsertMonthFile("February 2026", "sheet-feb");
  assert.equal(removeMonthFile("2026-02"), true);
  assert.equal(getMonthFile("2026-02"), null);
  upsertMonthFile("February 2026", "1R303xCVpamBTSkbH2QyT0JHCBPctayeYV9rERML6R5s");
});

test("filterReportMonthRecords excludes future months and unmapped current month", () => {
  const now = new Date("2026-07-01T12:00:00Z");
  const records = [
    { key: "2026-06", month_label: "June 2026", sheet_id: "sheet-june", active: true },
    { key: "2026-07", month_label: "July 2026", sheet_id: "sheet-july-seed", active: true },
    { key: "2026-08", month_label: "August 2026", sheet_id: "sheet-aug", active: true },
  ];
  const filtered = filterReportMonthRecords(records, now, {
    explicitOfficeMonthKeys: new Set(["2026-06"]),
  });
  assert.deepEqual(
    filtered.map((record) => record.key),
    ["2026-06"],
  );
  assert.equal(currentMonthKey(now), "2026-07");
});

test("filterReportMonthRecords keeps current month when explicitly mapped in Offices tab", () => {
  const now = new Date("2026-07-01T12:00:00Z");
  const records = [
    { key: "2026-06", month_label: "June 2026", sheet_id: "sheet-june", active: true },
    { key: "2026-07", month_label: "July 2026", sheet_id: "sheet-july", active: true },
  ];
  const filtered = filterReportMonthRecords(records, now, {
    explicitOfficeMonthKeys: new Set(["2026-06", "2026-07"]),
  });
  assert.deepEqual(
    filtered.map((record) => record.key),
    ["2026-07", "2026-06"],
  );
});
