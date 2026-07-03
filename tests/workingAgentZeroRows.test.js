import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkingAgentZeroRows, uniqueValuesIncludingSyntheticAgents } from "../lib/dashboardService.js";
import { getTabConfig } from "../config/sheetsConfig.js";
import { normalizeAgentName } from "../lib/targets.js";

const tabConfig = getTabConfig("leads");

function infoRecord(name, { status = "working", office = "Turkiye Office", teamLeader = "TL1", target = 5 } = {}) {
  return {
    agent_name: name,
    normalized_name: normalizeAgentName(name),
    office,
    team_leader: teamLeader,
    working_status: status,
    target,
  };
}

test("injects zero rows for working agents with no leads", () => {
  const selectedMonthData = [
    {
      monthRecord: { key: "2026-07", month_label: "July 2026", office_name: "Turkiye Office" },
      infoContext: {
        records: [
          infoRecord("Lina Ch"),
          infoRecord("Meriem Me"),
          infoRecord("Busy Agent"),
        ],
      },
    },
  ];
  const existingRows = [
    {
      "AGENT NAMES": "Busy Agent",
      __sourceMonthKey: "2026-07",
    },
  ];
  const rows = buildWorkingAgentZeroRows({
    selectedMonthData,
    existingRows,
    tabConfig,
    query: {},
    selectedOfficeScopes: ["Turkiye Office"],
  });
  const names = rows.map((row) => row["AGENT NAMES"]).sort();
  assert.deepEqual(names, ["Lina Ch", "Meriem Me"]);
  for (const row of rows) {
    assert.equal(row.__syntheticWorkingAgent, true);
    assert.equal(row.__sourceMonthKey, "2026-07");
    assert.equal(row.Leads, 0);
  }
});

test("skips not-working agents and already-present agents", () => {
  const selectedMonthData = [
    {
      monthRecord: { key: "2026-07", month_label: "July 2026", office_name: "Turkiye Office" },
      infoContext: {
        records: [
          infoRecord("Working One"),
          infoRecord("Left One", { status: "not_working" }),
        ],
      },
    },
  ];
  const rows = buildWorkingAgentZeroRows({
    selectedMonthData,
    existingRows: [],
    tabConfig,
    query: {},
    selectedOfficeScopes: ["Turkiye Office"],
  });
  assert.deepEqual(rows.map((row) => row["AGENT NAMES"]), ["Working One"]);
});

test("does not inject when activity filters are applied", () => {
  const selectedMonthData = [
    {
      monthRecord: { key: "2026-07", month_label: "July 2026", office_name: "Turkiye Office" },
      infoContext: { records: [infoRecord("Lina Ch")] },
    },
  ];
  const rows = buildWorkingAgentZeroRows({
    selectedMonthData,
    existingRows: [],
    tabConfig,
    query: { country: "Turkey" },
    selectedOfficeScopes: ["Turkiye Office"],
  });
  assert.deepEqual(rows, []);
});

test("respects team leader and agent filters", () => {
  const selectedMonthData = [
    {
      monthRecord: { key: "2026-07", month_label: "July 2026", office_name: "Turkiye Office" },
      infoContext: {
        records: [
          infoRecord("Lina Ch", { teamLeader: "TL1" }),
          infoRecord("Other Agent", { teamLeader: "TL2" }),
        ],
      },
    },
  ];
  const rows = buildWorkingAgentZeroRows({
    selectedMonthData,
    existingRows: [],
    tabConfig,
    query: { teamLeader: "TL1" },
    selectedOfficeScopes: ["Turkiye Office"],
  });
  assert.deepEqual(rows.map((row) => row["AGENT NAMES"]), ["Lina Ch"]);
});

test("injects per-month for last4 (agent working across months)", () => {
  const makeMonth = (key, label) => ({
    monthRecord: { key, month_label: label, office_name: "Turkiye Office" },
    infoContext: { records: [infoRecord("Lina Ch")] },
  });
  const rows = buildWorkingAgentZeroRows({
    selectedMonthData: [makeMonth("2026-06", "June 2026"), makeMonth("2026-07", "July 2026")],
    existingRows: [],
    tabConfig,
    query: {},
    selectedOfficeScopes: ["Turkiye Office"],
  });
  const monthKeys = rows.map((row) => row.__sourceMonthKey).sort();
  assert.deepEqual(monthKeys, ["2026-06", "2026-07"]);
});

test("agent/desk/team-leader counts include synthetic zero-activity rows", () => {
  // Two real lead rows (agents with an id) + two synthetic working-agent rows
  // that carry no id. The summary cards must count all four agents so the
  // "Total Agent" card matches the rows shown in the results table.
  const rows = [
    { ID: "1", "AGENT NAMES": "Alda Ga", Desk: "Turkey ENG / MY / IND", "Team Leader": "Tanty Ar" },
    { ID: "2", "AGENT NAMES": "Anna Ak", Desk: "Turkey ENG / MY / IND", "Team Leader": "Tanty Ar" },
    {
      "AGENT NAMES": "Deden Ma",
      Desk: "Turkey ENG / MY / IND",
      "Team Leader": "Tanty Ar",
      Leads: 0,
      __syntheticWorkingAgent: true,
    },
    {
      "AGENT NAMES": "Rissa Za",
      Desk: "Turkey ENG / MY / IND",
      "Team Leader": "Tanty Ar",
      Leads: 0,
      __syntheticWorkingAgent: true,
    },
  ];
  assert.equal(uniqueValuesIncludingSyntheticAgents(rows, tabConfig, "agentNames"), 4);
  assert.equal(uniqueValuesIncludingSyntheticAgents(rows, tabConfig, "teamLeader"), 1);
  assert.equal(uniqueValuesIncludingSyntheticAgents(rows, tabConfig, "office"), 1);
});

test("count still ignores rows that have neither an id nor the synthetic flag", () => {
  const rows = [
    { ID: "1", "AGENT NAMES": "Alda Ga" },
    { "AGENT NAMES": "Ghost Row" },
  ];
  assert.equal(uniqueValuesIncludingSyntheticAgents(rows, tabConfig, "agentNames"), 1);
});

test("treats Argentina 'active' status as working via records", () => {
  // buildWorkingAgentZeroRows relies on already-normalized working_status.
  // Argentina rosters use "active", which the info context normalizes to
  // "working" before this stage; simulate that normalized record here.
  const rows = buildWorkingAgentZeroRows({
    selectedMonthData: [
      {
        monthRecord: { key: "2026-07", month_label: "July 2026", office_name: "Argentina Office" },
        infoContext: { records: [infoRecord("Agus Ar", { office: "Argentina Office" })] },
      },
    ],
    existingRows: [],
    tabConfig,
    query: {},
    selectedOfficeScopes: ["Argentina Office"],
  });
  assert.deepEqual(rows.map((row) => row["AGENT NAMES"]), ["Agus Ar"]);
});
