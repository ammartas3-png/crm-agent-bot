import assert from "node:assert/strict";
import test from "node:test";

import { compareBuilderValues, sortBuilderRows } from "../lib/pivotSort.js";

const FTD = { key: "ftd", label: "FTD", type: "number", kind: "metric" };

function order(rows) {
  return rows.map((row) => [row.desk, row.teamLeader, row.agent, row.ftd, row.__rowKind].filter((v) => v !== undefined));
}

test("compareBuilderValues compares numbers numerically and text naturally", () => {
  assert.ok(compareBuilderValues(2, 10, "number") < 0);
  assert.ok(compareBuilderValues("Agent 10", "Agent 2", "text") > 0);
});

test("returns rows untouched when no active column is selected", () => {
  const rows = [{ desk: "B" }, { desk: "A" }];
  const result = sortBuilderRows(rows, { activeColumn: null, selectedDimensions: ["desk", "agent"] });
  assert.deepEqual(result, rows);
});

test("flat-sorts when there is no real hierarchy (single dimension)", () => {
  const rows = [
    { desk: "A", ftd: 5 },
    { desk: "B", ftd: 20 },
    { desk: "C", ftd: 12 },
  ];
  const result = sortBuilderRows(rows, {
    activeColumn: FTD,
    direction: "desc",
    selectedDimensions: ["desk"],
  });
  assert.deepEqual(result.map((r) => r.desk), ["B", "C", "A"]);
});

test("sorting a metric preserves Desk > Team Leader > Agent hierarchy", () => {
  const rows = [
    { desk: "DeskA", teamLeader: "TL1", agent: "a1", ftd: 5 },
    { desk: "DeskA", teamLeader: "TL1", agent: "a2", ftd: 10 },
    { desk: "DeskA", teamLeader: "TL2", agent: "a3", ftd: 3 },
    { desk: "DeskB", teamLeader: "TL3", agent: "a4", ftd: 100 },
  ];

  const result = sortBuilderRows(rows, {
    activeColumn: FTD,
    direction: "desc",
    selectedDimensions: ["desk", "teamLeader", "agent"],
  });

  // DeskB (100) outranks DeskA (18) at the top level; inside DeskA, TL1 (15)
  // outranks TL2 (3); inside TL1, a2 (10) outranks a1 (5).
  assert.deepEqual(order(result), [
    ["DeskB", "TL3", "a4", 100],
    ["DeskA", "TL1", "a2", 10],
    ["DeskA", "TL1", "a1", 5],
    ["DeskA", "TL2", "a3", 3],
  ]);
});

test("does not globally reorder children across different parents", () => {
  // a3 has the smallest ftd but must stay under DeskA, never float next to a4.
  const rows = [
    { desk: "DeskA", teamLeader: "TL1", agent: "a1", ftd: 5 },
    { desk: "DeskA", teamLeader: "TL2", agent: "a3", ftd: 3 },
    { desk: "DeskB", teamLeader: "TL3", agent: "a4", ftd: 100 },
  ];
  const result = sortBuilderRows(rows, {
    activeColumn: FTD,
    direction: "asc",
    selectedDimensions: ["desk", "teamLeader", "agent"],
  });
  // Every DeskA row stays contiguous regardless of metric direction.
  const desks = result.map((r) => r.desk);
  const firstB = desks.indexOf("DeskB");
  const lastB = desks.lastIndexOf("DeskB");
  assert.equal(firstB, lastB, "DeskB rows must be contiguous");
});

test("sorting does not duplicate groups", () => {
  const rows = [
    { desk: "DeskA", teamLeader: "TL1", agent: "a1", ftd: 5 },
    { desk: "DeskA", teamLeader: "TL1", agent: "a2", ftd: 10 },
    { desk: "DeskB", teamLeader: "TL2", agent: "a3", ftd: 7 },
  ];
  const result = sortBuilderRows(rows, {
    activeColumn: FTD,
    direction: "desc",
    selectedDimensions: ["desk", "teamLeader", "agent"],
  });
  assert.equal(result.length, rows.length);
  const agents = result.map((r) => r.agent).sort();
  assert.deepEqual(agents, ["a1", "a2", "a3"]);
});

test("subtotal rows stay attached to their parent group and order groups", () => {
  const rows = [
    { desk: "DeskA", agent: "a1", ftd: 5 },
    { desk: "DeskA", agent: "a2", ftd: 10 },
    { desk: "DeskB", agent: "a3", ftd: 3 },
    { desk: "DeskA Total", agent: "-", ftd: 15, __rowKind: "total", __totalDimension: "desk" },
    { desk: "DeskB Total", agent: "-", ftd: 3, __rowKind: "total", __totalDimension: "desk" },
  ];

  const result = sortBuilderRows(rows, {
    activeColumn: FTD,
    direction: "desc",
    selectedDimensions: ["desk", "agent"],
    selectedTotalDimensions: ["desk"],
  });

  // DeskA (subtotal 15) before DeskB (subtotal 3); each subtotal sits with its
  // own group and there is exactly one of each.
  assert.deepEqual(
    result.map((r) => [r.desk, r.ftd, r.__rowKind || "detail"]),
    [
      ["DeskA Total", 15, "total"],
      ["DeskA", 10, "detail"],
      ["DeskA", 5, "detail"],
      ["DeskB Total", 3, "total"],
      ["DeskB", 3, "detail"],
    ],
  );
});

test("equal metric values keep a stable, deterministic order", () => {
  const rows = [
    { desk: "DeskA", teamLeader: "TL1", agent: "first", ftd: 4 },
    { desk: "DeskA", teamLeader: "TL1", agent: "second", ftd: 4 },
    { desk: "DeskA", teamLeader: "TL1", agent: "third", ftd: 4 },
  ];
  const result = sortBuilderRows(rows, {
    activeColumn: FTD,
    direction: "desc",
    selectedDimensions: ["desk", "teamLeader", "agent"],
  });
  assert.deepEqual(result.map((r) => r.agent), ["first", "second", "third"]);
});

test("sorting by a dimension column orders that level alphabetically", () => {
  const rows = [
    { desk: "Bravo", teamLeader: "TL1", agent: "a1", ftd: 1 },
    { desk: "Alpha", teamLeader: "TL2", agent: "a2", ftd: 99 },
  ];
  const result = sortBuilderRows(rows, {
    activeColumn: { key: "desk", label: "Desk", type: "text", kind: "dimension" },
    direction: "asc",
    selectedDimensions: ["desk", "teamLeader", "agent"],
  });
  assert.deepEqual(result.map((r) => r.desk), ["Alpha", "Bravo"]);
});
