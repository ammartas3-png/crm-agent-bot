import assert from "node:assert/strict";
import test from "node:test";

import {
  isLegacyOffice,
  legacyMonthKeys,
  legacyMonthRecordsForOffice,
  legacyOfficeNameFor,
} from "../lib/legacyOfficeData.js";

test("legacyOfficeNameFor maps AR/AE office variants", () => {
  assert.equal(legacyOfficeNameFor("Argentina Office"), "Argentina Office");
  assert.equal(legacyOfficeNameFor("argentina"), "Argentina Office");
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
