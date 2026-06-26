import assert from "node:assert/strict";
import test from "node:test";

import {
  dateFilterToRange,
  loadLeadRows,
  scopeFromFilters,
} from "../lib/dataProvider.js";

const NOW = new Date("2026-05-15T12:00:00Z");

test("dateFilterToRange maps bot date filters to coarse ranges", () => {
  assert.deepEqual(dateFilterToRange({ type: "today" }, NOW), {
    dateStart: "2026-05-15",
    dateEnd: "2026-05-15",
  });
  assert.deepEqual(dateFilterToRange({ type: "month", month: 4, year: 2026 }, NOW), {
    dateStart: "2026-05-01",
    dateEnd: "2026-05-31",
  });
  assert.deepEqual(
    dateFilterToRange({ type: "range", start: "01/05/2026", end: "10/05/2026" }, NOW),
    { dateStart: "01/05/2026", dateEnd: "10/05/2026" },
  );
  assert.deepEqual(dateFilterToRange(null, NOW), {});
});

test("scopeFromFilters only derives a scope from a date filter", () => {
  assert.deepEqual(scopeFromFilters({ country: "Turkey" }, NOW), {});
  assert.deepEqual(scopeFromFilters({ date: { type: "today" } }, NOW), {
    dateStart: "2026-05-15",
    dateEnd: "2026-05-15",
  });
});

test("loadLeadRows falls back to Google Sheets when the database is disabled", async () => {
  // DATABASE_URL is unset in tests, so this should hit the Sheets path. An
  // injected sheets client keeps the read offline and deterministic.
  const rows = await loadLeadRows("leads", {
    spreadsheetId: "test-id",
    cache: false,
    tabConfig: { name: "Leads", range: "'Leads'!A:Y", columns: ["ID"] },
    sheetsClient: {
      spreadsheets: {
        values: {
          get: async () => ({ data: { values: [["1"], ["2"]] } }),
        },
      },
    },
  });

  assert.deepEqual(rows, [{ ID: "1" }, { ID: "2" }]);
});
