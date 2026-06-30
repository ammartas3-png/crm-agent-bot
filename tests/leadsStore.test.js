import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLeadsStore,
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
