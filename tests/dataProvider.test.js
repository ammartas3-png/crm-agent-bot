import assert from "node:assert/strict";
import test from "node:test";

import { loadLeadRows, readDashboardSheetRows } from "../lib/dataProvider.js";
import { clearLeadsStore, saveSource } from "../lib/leadsStore.js";

test("loadLeadRows falls back to Google Sheets when no dataset is ingested", async () => {
  clearLeadsStore();
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

test("loadLeadRows serves ingested rows across all sources when present", async () => {
  clearLeadsStore();
  saveSource("istanbul:2026-05:leads", { office: "Istanbul" }, [{ ID: "1" }, { ID: "2" }]);
  saveSource("ankara:2026-05:leads", { office: "Ankara" }, [{ ID: "3" }]);

  // The sheets client should never be called when ingested data exists.
  const rows = await loadLeadRows("leads", {
    tabConfig: { name: "Leads", columns: ["ID"] },
    sheetsClient: {
      spreadsheets: {
        values: {
          get: async () => {
            throw new Error("should not read Google Sheets when dataset is active");
          },
        },
      },
    },
  });

  assert.deepEqual(
    rows.map((row) => row.ID).sort(),
    ["1", "2", "3"],
  );
  clearLeadsStore();
});

test("readDashboardSheetRows serves ingested rows for a spreadsheet when present", async () => {
  clearLeadsStore();
  saveSource(
    "istanbul:2026-05:leads",
    { office: "Istanbul", period: "2026-05", spreadsheetId: "sheet-1", category: "leads" },
    [{ ID: "7" }],
  );

  const rows = await readDashboardSheetRows("leads", {
    spreadsheetId: "sheet-1",
    office: "Istanbul",
    period: "2026-05",
    tabConfig: { name: "Leads", columns: ["ID"] },
    sheetsClient: {
      spreadsheets: {
        values: {
          get: async () => {
            throw new Error("should not read Google Sheets when ingested rows exist");
          },
        },
      },
    },
  });

  assert.deepEqual(rows.map((row) => row.ID), ["7"]);
  clearLeadsStore();
});
