import assert from "node:assert/strict";
import test from "node:test";

import { buildTargetResultReport } from "../lib/dashboardService.js";
import { normalizeAgentName } from "../lib/targets.js";

const builderTable = (rows) => ({ table: rows });

test("buildTargetResultReport drops no-target agents and not-reached team leaders", () => {
  const builder = builderTable([
    { desk: "D1", teamLeader: "Feras Ha", agent: "Agent A", ftdTarget: 10, ftd: 12, ftdTargetReach: 120 },
    { desk: "D1", teamLeader: "Feras Ha", agent: "Agent B", ftdTarget: 10, ftd: 5, ftdTargetReach: 50 },
    { desk: "D1", teamLeader: "Feras Ha", agent: "Agent C", ftdTarget: 0, ftd: 3, ftdTargetReach: 0 },
    { desk: "D2", teamLeader: "Mohamed Ra", agent: "Feras Ha", ftdTarget: 20, ftd: 10, ftdTargetReach: 50 },
    { desk: "D2", teamLeader: "Mohamed Ra", agent: "Mohamed Ra", ftdTarget: 20, ftd: 25, ftdTargetReach: 125 },
    { __rowKind: "total", agent: "TOTAL", ftdTarget: 60, ftd: 52, ftdTargetReach: 86 },
  ]);
  const infoContext = { teamLeaders: ["Feras Ha", "Mohamed Ra"] };

  const result = buildTargetResultReport(builder, infoContext);

  // Agent C removed (no target); Feras Ha removed (team leader, reach < 100);
  // total row ignored.
  assert.deepEqual(
    result.rows.map((row) => row.agent),
    ["Mohamed Ra", "Agent A", "Agent B"],
  );
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.reached, 2);
  assert.equal(result.summary.notReached, 1);
  assert.equal(Math.round(result.summary.rate), 67);
});

test("buildTargetResultReport keeps a team leader who reached target", () => {
  const builder = builderTable([
    { desk: "D1", teamLeader: "TL One", agent: "TL One", ftdTarget: 5, ftd: 6, ftdTargetReach: 120 },
  ]);
  const result = buildTargetResultReport(builder, { teamLeaders: ["TL One"] });
  assert.equal(result.rows.length, 1);
  assert.equal(result.summary.reached, 1);
});

test("buildTargetResultReport excludes not-working agents who did not reach target", () => {
  const builder = builderTable([
    { desk: "D1", teamLeader: "TL One", agent: "Agent D", ftdTarget: 10, ftd: 12, ftdTargetReach: 120 },
    { desk: "D1", teamLeader: "TL One", agent: "Agent E", ftdTarget: 10, ftd: 4, ftdTargetReach: 40 },
    { desk: "D1", teamLeader: "TL One", agent: "Agent F", ftdTarget: 10, ftd: 3, ftdTargetReach: 30 },
  ]);
  const latestStatusByAgent = new Map([
    [normalizeAgentName("Agent D"), "not_working"],
    [normalizeAgentName("Agent E"), "not_working"],
    [normalizeAgentName("Agent F"), "working"],
  ]);
  const result = buildTargetResultReport(builder, { teamLeaders: [], latestStatusByAgent });

  // Agent E excluded (not working + reach < 100). Agent D kept (not working but
  // reached). Agent F kept (working, even though reach < 100).
  assert.deepEqual(
    result.rows.map((row) => row.agent),
    ["Agent D", "Agent F"],
  );
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.reached, 1);
});

test("buildTargetResultReport handles empty input", () => {
  const result = buildTargetResultReport({ table: [] }, { teamLeaders: [] });
  assert.deepEqual(result.rows, []);
  assert.equal(result.summary.total, 0);
  assert.equal(result.summary.rate, 0);
});
