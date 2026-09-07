import assert from "node:assert/strict";
import test from "node:test";

import { filterOutNotWorkingRows } from "../lib/dashboardService.js";
import { getTabConfig } from "../config/sheetsConfig.js";

const tabConfig = getTabConfig("leads");
const rows = [
  { "AGENT NAMES": "Aya Dk" },
  { "AGENT NAMES": "Marie Sa" },
  { "AGENT NAMES": "David To" },
];

test("hide-not-working keeps everyone when NO working status resolved (no wipe)", () => {
  // Empty info context = status could not be resolved (e.g. roster-less office
  // read came back empty for a scoped user). Must NOT wipe the report.
  const kept = filterOutNotWorkingRows(rows, tabConfig, {});
  assert.equal(kept.length, 3);
  const keptEmptyMaps = filterOutNotWorkingRows(rows, tabConfig, {
    latestStatusByAgent: new Map(),
    byAgent: new Map(),
  });
  assert.equal(keptEmptyMaps.length, 3);
});

test("hide-not-working hides not-working agents when status data is present", () => {
  const latestStatusByAgent = new Map([
    ["aya dk", "working"],
    ["marie sa", "not_working"],
    // David To intentionally absent from the map.
  ]);
  const kept = filterOutNotWorkingRows(rows, tabConfig, { latestStatusByAgent });
  const names = kept.map((row) => row["AGENT NAMES"]).sort();
  // Once we DO have status data, the established behaviour applies: only working
  // agents are kept (Marie explicit not-working and David unknown are removed).
  assert.deepEqual(names, ["Aya Dk"]);
});
