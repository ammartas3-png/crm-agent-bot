import assert from "node:assert/strict";
import test from "node:test";

import { sortBuilderRows } from "../lib/pivotSort.js";

function assertContiguousByKey(rows = [], key = "") {
  const closed = new Set();
  let current = null;
  for (const row of rows) {
    const value = String(row?.[key] || "-");
    if (value === current) {
      continue;
    }
    if (closed.has(value)) {
      throw new Error(`group "${value}" is split in multiple blocks`);
    }
    if (current !== null) {
      closed.add(current);
    }
    current = value;
  }
}

test("sortBuilderRows keeps traffic hierarchy contiguous for metric sorting", () => {
  const rows = [
    { country: "UK", campaign: "C1", subCampaign: "S1", placement: "P1", ftd: 2 },
    { country: "TR", campaign: "C1", subCampaign: "S1", placement: "P1", ftd: 11 },
    { country: "TR", campaign: "C2", subCampaign: "S1", placement: "P1", ftd: 4 },
    { country: "UK", campaign: "C1", subCampaign: "S2", placement: "P1", ftd: 3 },
    { country: "TR", campaign: "C1", subCampaign: "S2", placement: "P1", ftd: 7 },
    { country: "TR", campaign: "C1", subCampaign: "S1", placement: "P2", ftd: 9 },
  ];
  const sorted = sortBuilderRows(rows, {
    hierarchyKeys: ["country", "campaign", "subCampaign", "placement"],
    activeColumnKey: "ftd",
    activeColumnType: "number",
    direction: "desc",
  });

  assert.deepEqual(
    sorted.map((row) => `${row.country}/${row.campaign}/${row.subCampaign}/${row.placement}`),
    ["TR/C1/S1/P1", "TR/C1/S1/P2", "TR/C1/S2/P1", "TR/C2/S1/P1", "UK/C1/S2/P1", "UK/C1/S1/P1"],
  );
  assertContiguousByKey(sorted, "country");
});

test("sortBuilderRows applies date->hour hierarchy in daily trend", () => {
  const rows = [
    { date: "2026-06-21", hour: "09:00", leads: 5 },
    { date: "2026-06-22", hour: "09:00", leads: 1 },
    { date: "2026-06-21", hour: "08:00", leads: 20 },
    { date: "2026-06-22", hour: "08:00", leads: 18 },
  ];
  const sorted = sortBuilderRows(rows, {
    hierarchyKeys: ["date", "hour"],
    activeColumnKey: "leads",
    activeColumnType: "number",
    direction: "desc",
  });

  assert.deepEqual(
    sorted.map((row) => `${row.date} ${row.hour}`),
    ["2026-06-21 08:00", "2026-06-21 09:00", "2026-06-22 08:00", "2026-06-22 09:00"],
  );
  assertContiguousByKey(sorted, "date");
});

test("sortBuilderRows falls back to flat sorting when no hierarchy exists", () => {
  const rows = [
    { label: "C", leads: 3 },
    { label: "A", leads: 1 },
    { label: "B", leads: 2 },
  ];
  const sorted = sortBuilderRows(rows, {
    hierarchyKeys: [],
    activeColumnKey: "label",
    activeColumnType: "text",
    direction: "asc",
  });
  assert.deepEqual(
    sorted.map((row) => row.label),
    ["A", "B", "C"],
  );
});
