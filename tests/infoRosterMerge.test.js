import assert from "node:assert/strict";
import test from "node:test";

import { mergedInfoRowsFromRoster } from "../lib/dashboardService.js";
import { normalizeAgentName } from "../lib/targets.js";

const rosterRows = [
  { Agent: "Hayat Ha", "Working Status": "Not Working", Desk: "D1", "Team Leader": "Tanty Ar" },
  { Agent: "Deden Ma", "Working Status": "Working", Desk: "D1", "Team Leader": "Tanty Ar" },
  { Agent: "Roster Only", "Working Status": "Working", Desk: "D1", "Team Leader": "Tanty Ar" },
];
const targetByAgent = new Map([
  [normalizeAgentName("Hayat Ha"), 20],
  [normalizeAgentName("Deden Ma"), 10],
]);

test("month Info Agents status overrides roster status (working wins)", () => {
  const monthStatus = new Map([
    [normalizeAgentName("Hayat Ha"), "working"],
    [normalizeAgentName("Deden Ma"), "working"],
  ]);
  const rows = mergedInfoRowsFromRoster(rosterRows, targetByAgent, monthStatus);
  const hayat = rows.find((row) => row["Agent Name"] === "Hayat Ha");
  // Roster said Not Working, but the month's Info Agents says Working -> Working,
  // so her target is retained and will count.
  assert.equal(hayat["Working Status"], "Working");
  assert.equal(hayat["Agent Target"], 20);
});

test("month Info Agents not_working overrides roster working", () => {
  const monthStatus = new Map([[normalizeAgentName("Deden Ma"), "not_working"]]);
  const rows = mergedInfoRowsFromRoster(rosterRows, targetByAgent, monthStatus);
  const deden = rows.find((row) => row["Agent Name"] === "Deden Ma");
  assert.equal(deden["Working Status"], "Not Working");
});

test("falls back to roster status when month has no explicit status", () => {
  const rows = mergedInfoRowsFromRoster(rosterRows, targetByAgent, new Map());
  const rosterOnly = rows.find((row) => row["Agent Name"] === "Roster Only");
  assert.equal(rosterOnly["Working Status"], "Working");
  const hayat = rows.find((row) => row["Agent Name"] === "Hayat Ha");
  assert.equal(hayat["Working Status"], "Not Working");
});
