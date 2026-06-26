import assert from "node:assert/strict";
import test from "node:test";

import {
  derivePeriod,
  mapSheetRowToRecord,
  mapSheetRowsToRecords,
} from "../lib/sheetRowMapper.js";

const tabConfig = {
  fields: {
    id: "ID",
    created: "Created",
    leadDate: "Lead Date",
    ftdDate: "FTD DATE",
    country: "Country",
    office: "Office",
    ftdMaker: "FTD MAKER",
  },
};

test("derivePeriod returns YYYY-MM from the first parseable value", () => {
  assert.equal(derivePeriod("", "12/05/2026 10:00:00"), "2026-05");
  assert.equal(derivePeriod("not-a-date"), null);
});

test("mapSheetRowToRecord extracts index columns and preserves the full row", () => {
  const row = {
    ID: " 42 ",
    Country: "Turkey",
    Office: "Istanbul",
    "Lead Date": "11/05/2026",
    "FTD DATE": "12/05/2026 10:00:00",
    Created: "01/05/2026",
    "FTD MAKER": "Closer A",
  };

  const record = mapSheetRowToRecord(row, tabConfig, { sourceKey: "istanbul:2026-05:leads" });

  assert.equal(record.sourceKey, "istanbul:2026-05:leads");
  assert.equal(record.leadId, "42");
  assert.equal(record.country, "Turkey");
  assert.equal(record.office, "Istanbul");
  assert.equal(record.period, "2026-05");
  assert.equal(record.leadDate, new Date(Date.UTC(2026, 4, 11)).toISOString());
  assert.equal(record.ftdDate, new Date(Date.UTC(2026, 4, 12, 10, 0, 0)).toISOString());
  assert.equal(record.data, row);
});

test("meta office and period override the sheet values", () => {
  const row = { ID: "1", Office: "Sheet Office", "Lead Date": "11/05/2026" };
  const record = mapSheetRowToRecord(row, tabConfig, { office: "HQ", period: "2026-01" });
  assert.equal(record.office, "HQ");
  assert.equal(record.period, "2026-01");
});

test("mapSheetRowsToRecords drops rows without an ID", () => {
  const rows = [{ ID: "1" }, { ID: "" }, { Country: "X" }, { ID: "2" }];
  const records = mapSheetRowsToRecords(rows, tabConfig, { sourceKey: "s" });
  assert.deepEqual(records.map((record) => record.leadId), ["1", "2"]);
});
