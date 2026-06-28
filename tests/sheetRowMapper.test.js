import assert from "node:assert/strict";
import test from "node:test";

import { derivePeriod, prepareRowsForStore } from "../lib/sheetRowMapper.js";

const tabConfig = {
  fields: {
    id: "ID",
    created: "Created",
    leadDate: "Lead Date",
    ftdDate: "FTD DATE",
    country: "Country",
    office: "Office",
  },
};

test("derivePeriod returns YYYY-MM from the first parseable value", () => {
  assert.equal(derivePeriod("", "12/05/2026 10:00:00"), "2026-05");
  assert.equal(derivePeriod("not-a-date"), null);
});

test("prepareRowsForStore drops rows without an ID and keeps the row shape", () => {
  const rows = [
    { ID: "1", Country: "Turkey" },
    { ID: "", Country: "X" },
    { Country: "Y" },
    { ID: "2", Country: "Germany" },
  ];
  const prepared = prepareRowsForStore(rows, tabConfig, {});
  assert.deepEqual(prepared, [
    { ID: "1", Country: "Turkey" },
    { ID: "2", Country: "Germany" },
  ]);
});

test("prepareRowsForStore backfills Office from meta only when missing", () => {
  const rows = [
    { ID: "1", Office: "" },
    { ID: "2", Office: "Ankara" },
  ];
  const prepared = prepareRowsForStore(rows, tabConfig, { office: "Istanbul" });
  assert.equal(prepared[0].Office, "Istanbul");
  assert.equal(prepared[1].Office, "Ankara");
});
