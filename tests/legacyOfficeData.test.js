import assert from "node:assert/strict";
import test from "node:test";

import {
  isLegacyOffice,
  legacyMonthKeys,
  legacyMonthKeysInWindow,
  legacyMonthRecordsForOffice,
  legacyOfficeNameFor,
  officeMonthRecordsWithLegacy,
  resolveLast4MonthKeysForOffice,
} from "../lib/legacyOfficeData.js";

test("legacyOfficeNameFor maps AR/AE office variants", () => {
  assert.equal(legacyOfficeNameFor("Argentina Office"), "Argentina Office");
  assert.equal(legacyOfficeNameFor("argentina"), "Argentina Office");
  assert.equal(legacyOfficeNameFor("aragantin"), "Argentina Office");
  assert.equal(legacyOfficeNameFor("Dubai Office"), "Dubai Office");
  assert.equal(legacyOfficeNameFor("United Arab Emirates"), "Dubai Office");
  assert.equal(legacyOfficeNameFor("Turkiye Office"), "");
  assert.equal(legacyOfficeNameFor(""), "");
});

test("isLegacyOffice only matches AR/AE", () => {
  assert.equal(isLegacyOffice("Argentina Office"), true);
  assert.equal(isLegacyOffice("Dubai Office"), true);
  assert.equal(isLegacyOffice("Pakistan Office"), false);
  assert.equal(isLegacyOffice("Turkiye Office"), false);
});

test("legacyMonthKeys are the first three months of 2026", () => {
  assert.deepEqual(legacyMonthKeys(), ["2026-01", "2026-02", "2026-03"]);
});

test("legacyMonthRecordsForOffice returns flagged synthetic records", () => {
  const records = legacyMonthRecordsForOffice("Argentina Office");
  assert.equal(records.length, 3);
  for (const record of records) {
    assert.equal(record.legacy, true);
    assert.equal(record.sheet_id, "");
    assert.equal(record.office_name, "Argentina Office");
  }
  assert.deepEqual(records.map((r) => r.key), ["2026-01", "2026-02", "2026-03"]);
  assert.deepEqual(legacyMonthRecordsForOffice("Turkiye Office"), []);
});

test("resolveLast4MonthKeysForOffice merges Dubai live months with legacy Jan-Mar", () => {
  assert.deepEqual(resolveLast4MonthKeysForOffice("Dubai Office", ["2026-06", "2026-05", "2026-04"]), [
    "2026-06",
    "2026-05",
    "2026-04",
    "2026-03",
  ]);
});

test("resolveLast4MonthKeysForOffice merges Argentina live months with legacy Jan-Mar", () => {
  assert.deepEqual(resolveLast4MonthKeysForOffice("Argentina Office", ["2026-06", "2026-05", "2026-04"]), [
    "2026-06",
    "2026-05",
    "2026-04",
    "2026-03",
  ]);
  assert.deepEqual(resolveLast4MonthKeysForOffice("Argentina", ["2026-05", "2026-04"]), [
    "2026-05",
    "2026-04",
    "2026-03",
    "2026-02",
  ]);
});

test("resolveLast4MonthKeysForOffice ignores legacy months for non-legacy offices", () => {
  assert.deepEqual(resolveLast4MonthKeysForOffice("Turkiye Office", ["2026-06", "2026-05", "2026-04", "2026-03"]), [
    "2026-06",
    "2026-05",
    "2026-04",
    "2026-03",
  ]);
});

test("officeMonthRecordsWithLegacy appends synthetic legacy months for Dubai", () => {
  const live = [
    {
      key: "2026-06",
      month_label: "June 2026",
      sheet_id: "sheet-june",
      active: true,
    },
  ];
  const records = officeMonthRecordsWithLegacy("Dubai Office", live);
  assert.equal(records.length, 4);
  assert.equal(records[0].key, "2026-06");
  assert.equal(records[1].key, "2026-03");
  assert.equal(records[1].legacy, true);
});

test("officeMonthRecordsWithLegacy appends synthetic legacy months for Argentina", () => {
  const live = [
    {
      key: "2026-05",
      month_label: "May 2026",
      sheet_id: "sheet-may",
      active: true,
    },
  ];
  const records = officeMonthRecordsWithLegacy("Argentina Office", live);
  assert.equal(records.length, 4);
  assert.equal(records[0].key, "2026-05");
  assert.equal(records[1].key, "2026-03");
  assert.equal(records[1].legacy, true);
  assert.equal(records[3].key, "2026-01");
  assert.equal(records[3].legacy, true);
});

test("legacyMonthKeysInWindow returns only legacy keys from a last4 window", () => {
  assert.deepEqual(legacyMonthKeysInWindow(["2026-06", "2026-05", "2026-04", "2026-03"]), ["2026-03"]);
});
