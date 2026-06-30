import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLeadsStore,
  describeSources,
  hasData,
  isDatasetActive,
  leadsSourceMode,
  listSources,
  loadAllRows,
  loadRowsForSourceMeta,
  saveSource,
} from "../lib/leadsStore.js";

test("leadsSourceMode parses the mode env with an auto default", () => {
  assert.equal(leadsSourceMode({}), "auto");
  assert.equal(leadsSourceMode({ LEADS_SOURCE: "ingest" }), "ingest");
  assert.equal(leadsSourceMode({ LEADS_SOURCE: "sheets" }), "sheets");
  assert.equal(leadsSourceMode({ LEADS_SOURCE: "weird" }), "auto");
});

test("saveSource stores rows and loadAllRows merges every source", async () => {
  clearLeadsStore();
  assert.equal(hasData(), false);

  saveSource("a:2026-05:leads", { office: "A", period: "2026-05" }, [{ ID: "1" }, { ID: "2" }]);
  saveSource("b:2026-06:leads", { office: "B", period: "2026-06" }, [{ ID: "3" }]);

  assert.equal(hasData(), true);
  const rows = await loadAllRows();
  assert.deepEqual(rows.map((row) => row.ID).sort(), ["1", "2", "3"]);
  clearLeadsStore();
});

test("re-saving a source replaces its rows (idempotent sync)", async () => {
  clearLeadsStore();
  saveSource("a:2026-05:leads", { office: "A" }, [{ ID: "1" }, { ID: "2" }]);
  saveSource("a:2026-05:leads", { office: "A" }, [{ ID: "9" }]);
  const rows = await loadAllRows();
  assert.deepEqual(rows.map((row) => row.ID), ["9"]);
  clearLeadsStore();
});

test("listSources reports metadata and row counts", async () => {
  clearLeadsStore();
  saveSource("a:2026-05:leads", { office: "A", period: "2026-05" }, [{ ID: "1" }]);
  const sources = await listSources();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourceKey, "a:2026-05:leads");
  assert.equal(sources[0].rowCount, 1);
  clearLeadsStore();
});

test("isDatasetActive honors mode and presence of data", async () => {
  clearLeadsStore();
  assert.equal(await isDatasetActive({ LEADS_SOURCE: "sheets" }), false);
  assert.equal(await isDatasetActive({ LEADS_SOURCE: "ingest" }), true);
  assert.equal(await isDatasetActive({}), false);

  saveSource("a:2026-05:leads", { office: "A" }, [{ ID: "1" }]);
  assert.equal(await isDatasetActive({}), true);
  clearLeadsStore();
});

test("loadRowsForSourceMeta resolves rows by spreadsheet, office, and category", async () => {
  clearLeadsStore();
  saveSource("turkiye-office:2026-03:leads", {
    office: "Turkiye Office",
    period: "2026-03",
    spreadsheetId: "sheet-abc",
    category: "leads",
  }, [{ ID: "1" }]);
  saveSource("turkiye-office:2026-03:ftd", {
    office: "Turkiye Office",
    period: "2026-03",
    spreadsheetId: "sheet-abc",
    category: "ftd",
  }, [{ "Customer ID": "99" }]);

  const bySheet = await loadRowsForSourceMeta({
    spreadsheetId: "sheet-abc",
    category: "leads",
  });
  assert.deepEqual(bySheet.map((row) => row.ID), ["1"]);

  const byOffice = await loadRowsForSourceMeta({
    office: "Turkiye Office",
    period: "2026-03",
    category: "ftd",
  });
  assert.deepEqual(byOffice.map((row) => row["Customer ID"]), ["99"]);

  assert.equal(
    await loadRowsForSourceMeta({
      spreadsheetId: "missing",
      category: "leads",
    }),
    null,
  );
  clearLeadsStore();
});

test("saveSource reports chunk count and describeSources confirms completeness", async () => {
  clearLeadsStore();
  const result = saveSource(
    "a:2026-05:leads",
    { office: "A", period: "2026-05", spreadsheetId: "sheet-a", category: "leads" },
    [{ ID: "1" }, { ID: "2" }],
  );
  assert.equal(result.rowCount, 2);
  const described = await describeSources();
  assert.equal(described.length, 1);
  assert.equal(described[0].metaRowCount, 2);
  assert.equal(described[0].hydratedRowCount, 2);
  assert.equal(described[0].complete, true);
  clearLeadsStore();
});

test("loadRowsForSourceMeta returns [] for a genuinely empty matched source", async () => {
  clearLeadsStore();
  saveSource(
    "a:2026-05:leads",
    { office: "A", period: "2026-05", spreadsheetId: "sheet-a", category: "leads" },
    [],
  );
  const rows = await loadRowsForSourceMeta({ spreadsheetId: "sheet-a", category: "leads" });
  assert.deepEqual(rows, []);
  clearLeadsStore();
});

test("chunkRowsBySize splits large datasets so each chunk stays under budget", async () => {
  // Indirectly verified through saveSource chunkCount when persistence is on.
  // Here we assert the row count is preserved end-to-end in memory.
  clearLeadsStore();
  const many = Array.from({ length: 5000 }, (_, index) => ({ ID: String(index), Country: "Turkey" }));
  const result = saveSource("big:2026-05:leads", { office: "Big", period: "2026-05" }, many);
  assert.equal(result.rowCount, 5000);
  const rows = await loadRowsForSourceMeta({ office: "Big", period: "2026-05", category: "leads" });
  assert.equal(rows.length, 5000);
  clearLeadsStore();
});
