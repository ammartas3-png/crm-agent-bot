import assert from "node:assert/strict";
import test from "node:test";

import {
  agentTarget,
  buildAgentTargetsMap,
  buildInfoAgentsContext,
  canonicalAgentName,
  collectAgentNames,
  formatOptionalPercent,
  formatTarget,
  infoAgentsLabelsForGroup,
  normalizeAgentName,
  summarizeTarget,
  targetForOffice,
  targetForTeamLeader,
  targetAggregationForScope,
  targetReachPercent,
} from "../lib/targets.js";
import { buildDashboardStats } from "../lib/dashboardService.js";

test("targetAggregationForScope reports rawTarget for not-working agents even when includedTarget is 0", () => {
  const ctx = buildInfoAgentsContext([
    { "Working Status": "Not Working", "Agent Name": "Emmanuel Al", "Agent Target": 10, Office: "Turkey English", "Team Leader": "Oussema Me" },
    { "Working Status": "Working", "Agent Name": "Heela An", "Agent Target": 15, Office: "Turkey English", "Team Leader": "Oussema Me" },
  ]);
  const notWorking = targetAggregationForScope({
    rows: [],
    tabConfig: { fields: { agentNames: "AGENT NAMES" } },
    infoContext: ctx,
    filters: {},
    scope: { groupField: "agentNames", onlyWorkingAgents: true, agent: ["Emmanuel Al"] },
  });
  // Raw assigned target is shown (10) while the achievement-gated includedTarget
  // stays 0 (not working, no FTD).
  assert.equal(notWorking.rawTarget, 10);
  assert.equal(notWorking.includedTarget, 0);

  const working = targetAggregationForScope({
    rows: [],
    tabConfig: { fields: { agentNames: "AGENT NAMES" } },
    infoContext: ctx,
    filters: {},
    scope: { groupField: "agentNames", onlyWorkingAgents: true, agent: ["Heela An"] },
  });
  assert.equal(working.rawTarget, 15);
  assert.equal(working.includedTarget, 15);
});

const tabConfig = {
  fields: {
    agentNames: "AGENT NAMES",
  },
};

const infoRows = [
  {
    "Working Status": "Working",
    "Agent Name": " Ahmet ",
    "Agent Target": "15",
    Office: "Istanbul",
    "Team Leader": "Leader One",
  },
  {
    "Working Status": "Working",
    "Agent Name": "MAX",
    "Agent Target": "",
    Office: "Istanbul",
    "Team Leader": "Leader One",
  },
  {
    "Working Status": "Not Working",
    "Agent Name": "Old Agent",
    "Agent Target": "100",
    Office: "Berlin",
    "Team Leader": "Leader Two",
  },
];

test("buildAgentTargetsMap includes working agents and normalizes names", () => {
  const map = buildAgentTargetsMap(infoRows);
  assert.equal(agentTarget(map, "  ahmet  "), 15);
  assert.equal(agentTarget(map, "max"), 0);
  assert.equal(agentTarget(map, "old agent"), 100);
});

test("info context drives membership and target aggregation", () => {
  const context = buildInfoAgentsContext(infoRows);
  assert.deepEqual(infoAgentsLabelsForGroup(context, "office"), ["Istanbul"]);
  assert.deepEqual(infoAgentsLabelsForGroup(context, "teamLeader", { office: "istanbul" }), ["Leader One"]);
  assert.equal(targetForOffice(context, "Istanbul"), 15);
  assert.equal(targetForTeamLeader(context, "Leader One"), 15);
  assert.equal(targetForOffice(context, "Berlin"), 100);
  assert.equal(context.duplicateNormalizedAgents.length, 0);
});

test("office-filtered team leader and agent lists do not fall back to all", () => {
  const context = buildInfoAgentsContext(infoRows);
  assert.deepEqual(infoAgentsLabelsForGroup(context, "teamLeader", { office: "argentina office" }), []);
  assert.deepEqual(infoAgentsLabelsForGroup(context, "agentNames", { office: "argentina office" }), []);
});

test("summarizeTarget sums unique agents", () => {
  const map = buildAgentTargetsMap(infoRows);
  assert.equal(summarizeTarget(["Ahmet", " ahmet ", "Max"], map), 15);
});

test("target formatting handles missing targets", () => {
  assert.equal(targetReachPercent(10, 0), null);
  assert.equal(formatTarget(0), "-");
  assert.equal(formatOptionalPercent(null), "-");
});

test("collectAgentNames reads agent field values", () => {
  const names = collectAgentNames([{ "AGENT NAMES": "Ahmet" }, { "AGENT NAMES": "Max" }], tabConfig);
  assert.deepEqual(names, ["Ahmet", "Max"]);
});

test("agent normalization does not apply hardcoded alias mapping", () => {
  assert.equal(normalizeAgentName("Asli Gu"), "asli gu");
  assert.equal(normalizeAgentName(" annalena   gu "), "annalena gu");
  assert.equal(canonicalAgentName("Asli Gu"), "Asli Gu");
});

test("info agent context supports Active status and Desk column", () => {
  const context = buildInfoAgentsContext([
    {
      "Working Status": "Active",
      Agent: "Rizwan Kh",
      "TARGET'S": "12",
      Desk: "Indian Team - TR",
      "Team Leader": "Asad kh",
    },
    {
      "Working Status": "Not Active",
      Agent: "Archived Agent",
      "TARGET'S": "30",
      Desk: "Indian Team - TR",
      "Team Leader": "Asad kh",
    },
  ]);
  assert.deepEqual(infoAgentsLabelsForGroup(context, "office"), ["Indian Team - TR"]);
  assert.equal(targetForOffice(context, "Indian Team - TR"), 42);
});

test("info agent context reads start date from L-style column fallback", () => {
  const context = buildInfoAgentsContext([
    {
      "Working Status": "Working",
      Agent: "Asad kh",
      Desk: "Indian Team - TR",
      "Team Leader": "Asad kh",
      L: "25/09/2023",
    },
  ]);
  const record = context.byAgent.get(normalizeAgentName("Asad kh"));
  assert.equal(record?.start_date, "25/09/2023");
});

test("info agent context keeps start date map for rows with blank status", () => {
  const context = buildInfoAgentsContext([
    {
      "Working Status": "",
      Agent: "Asad kh",
      Desk: "Indian Team - TR",
      "Team Leader": "Asad kh",
      L: "25/09/2023",
    },
  ]);
  assert.equal(context.byAgent.get(normalizeAgentName("Asad kh")), undefined);
  assert.equal(context.startDateByAgent.get(normalizeAgentName("Asad kh")), "25/09/2023");
});

test("info agent context keeps earliest valid start date for duplicate agent rows", () => {
  const context = buildInfoAgentsContext([
    {
      "Working Status": "Working",
      Agent: "Asad kh",
      Desk: "Indian Team - TR",
      "Team Leader": "Asad kh",
      "Starting Date": "03/01/2024",
    },
    {
      "Working Status": "Working",
      Agent: "Asad kh",
      Desk: "Indian Team - TR",
      "Team Leader": "Asad kh",
      "Starting Date": "25/09/2023",
    },
  ]);
  const record = context.byAgent.get(normalizeAgentName("Asad kh"));
  assert.equal(record?.start_date, "25/09/2023");
});

test("targetAggregationForScope can force row-only targets for bucketed summaries", () => {
  const rows = [
    {
      "AGENT NAMES": "A Agent",
      "Agent Target": "10",
      "FTD MAKER": "x",
      Created: "2026-04-03T08:00:00Z",
      __sourceMonthKey: "2026-04",
    },
    {
      "AGENT NAMES": "A Agent",
      "Agent Target": "30",
      "FTD MAKER": "x",
      Created: "2026-06-04T08:00:00Z",
      __sourceMonthKey: "2026-06",
    },
  ];
  const infoContext = buildInfoAgentsContext([
    {
      "Working Status": "Working",
      "Agent Name": "A Agent",
      "Agent Target": "30",
      Office: "Desk A",
      "Team Leader": "TL A",
    },
  ]);
  const aprilRows = rows.filter((row) => row.__sourceMonthKey === "2026-04");
  const april = targetAggregationForScope({
    rows: aprilRows,
    tabConfig: {
      fields: {
        agentNames: "AGENT NAMES",
        ftdMaker: "FTD MAKER",
        created: "Created",
      },
    },
    infoContext,
    scope: {
      groupField: "agentNames",
      agent: ["A Agent"],
      preferRowTargets: true,
    },
  });
  const total = targetAggregationForScope({
    rows,
    tabConfig: {
      fields: {
        agentNames: "AGENT NAMES",
        ftdMaker: "FTD MAKER",
        created: "Created",
      },
    },
    infoContext,
    scope: {
      groupField: "agentNames",
      agent: ["A Agent"],
      preferRowTargets: true,
    },
  });
  assert.equal(april.includedTarget, 10);
  assert.equal(total.includedTarget, 40);
});

test("targetAggregationForScope can force info-context targets for scoped rows", () => {
  const rows = [
    {
      "AGENT NAMES": "A Agent",
      "Agent Target": "10",
      "FTD MAKER": "x",
      Created: "2026-04-03T08:00:00Z",
      __sourceMonthKey: "2026-04",
    },
  ];
  const infoContext = buildInfoAgentsContext([
    {
      "Working Status": "Working",
      "Agent Name": "A Agent",
      "Agent Target": "22",
      Office: "Desk A",
      "Team Leader": "TL A",
    },
  ]);
  const aggregation = targetAggregationForScope({
    rows,
    tabConfig: {
      fields: {
        agentNames: "AGENT NAMES",
        ftdMaker: "FTD MAKER",
        created: "Created",
      },
    },
    infoContext,
    scope: {
      groupField: "agentNames",
      agent: ["A Agent"],
      restrictToRows: true,
      preferInfoTargets: true,
    },
  });
  assert.equal(aggregation.includedTarget, 22);
});

test("targetAggregationForScope reads dynamic non-CR target columns", () => {
  const rows = [
    {
      "AGENT NAMES": "B Agent",
      "Monthly Target": "14",
      "CR TARGET": "10%",
      "FTD MAKER": "x",
      Created: "2026-05-03T08:00:00Z",
      __sourceMonthKey: "2026-05",
    },
  ];
  const infoContext = buildInfoAgentsContext([
    {
      "Working Status": "Working",
      "Agent Name": "B Agent",
      "Agent Target": "99",
      Office: "Desk A",
      "Team Leader": "TL A",
    },
  ]);
  const aggregation = targetAggregationForScope({
    rows,
    tabConfig: {
      fields: {
        agentNames: "AGENT NAMES",
        ftdMaker: "FTD MAKER",
        created: "Created",
      },
    },
    infoContext,
    scope: {
      groupField: "agentNames",
      agent: ["B Agent"],
      preferRowTargets: true,
    },
  });
  assert.equal(aggregation.includedTarget, 14);
});

test("buildDashboardStats target-achieved rate reflects only the agents in view", () => {
  // Info sheet has 3 working agents with targets, but the filtered rows only
  // contain one of them (Ahmet, who hit target). The rate must be over the
  // agents on screen (1/1 = 100%), not the whole office (1/3), which used to
  // produce a nonsensical value for filtered/scoped teams.
  const tabConfig = {
    fields: {
      id: "ID",
      agentNames: "AGENT NAMES",
      teamLeader: "Team Leader",
      office: "Desk",
      ftd: "FTD",
      ftdMaker: "FTD MAKER",
      created: "Created",
      ftdDate: "FTD DATE",
    },
  };
  const infoContext = buildInfoAgentsContext([
    { "Working Status": "Working", "Agent Name": "Ahmet", "Agent Target": "10", Office: "Turkey English", "Team Leader": "Housse" },
    { "Working Status": "Working", "Agent Name": "Mehmet", "Agent Target": "10", Office: "Turkey Africa", "Team Leader": "Epere" },
    { "Working Status": "Working", "Agent Name": "Ayse", "Agent Target": "10", Office: "Turkey Africa", "Team Leader": "Epere" },
  ]);
  const rows = Array.from({ length: 12 }, (_, index) => ({
    ID: `L${index + 1}`,
    "AGENT NAMES": "Ahmet",
    "Team Leader": "Housse",
    Desk: "Turkey English",
    FTD: "1",
    "FTD MAKER": "Closer",
    Created: "2026-07-05T08:00:00Z",
    "FTD DATE": "2026-07-05",
  }));
  const stats = buildDashboardStats(rows, tabConfig, infoContext, null, new Date("2026-07-20T12:00:00Z"));
  assert.equal(stats.totalAgent, 1);
  assert.equal(stats.agentsWithTarget, 1);
  assert.equal(stats.totalTargetAchieved, 1);
  assert.equal(stats.rateOfTargetAchieved, 100);
});

test("buildDashboardStats rate excludes left-without-target agents but keeps last-7-day leavers", () => {
  const tabConfig = {
    fields: {
      id: "ID",
      agentNames: "AGENT NAMES",
      teamLeader: "Team Leader",
      office: "Desk",
      ftd: "FTD",
      ftdMaker: "FTD MAKER",
      created: "Created",
      ftdDate: "FTD DATE",
    },
  };
  const info = buildInfoAgentsContext([
    { "Working Status": "Working", "Agent Name": "Agent A", "Agent Target": "1", Office: "D1", "Team Leader": "TL" },
    { "Working Status": "Not Working", "Agent Name": "Agent B", "Agent Target": "1", Office: "D1", "Team Leader": "TL" },
    { "Working Status": "Not Working", "Agent Name": "Agent C", "Agent Target": "1", Office: "D1", "Team Leader": "TL" },
    { "Working Status": "Not Working", "Agent Name": "Agent D", "Agent Target": "1", Office: "D1", "Team Leader": "TL" },
  ]);
  const keyOf = (name) => info.records.find((record) => record.agent_name === name)?.normalized_name;
  info.endDateByAgent = new Map([
    [keyOf("Agent C"), "2026-08-10"], // left mid-month, no target -> excluded
    [keyOf("Agent D"), "2026-08-28"], // left in the last 7 days -> included
  ]);
  const rows = [
    { ID: "a1", "AGENT NAMES": "Agent A", "Team Leader": "TL", Desk: "D1", FTD: "1", "FTD MAKER": "Agent A", Created: "2026-08-05", "FTD DATE": "2026-08-05" },
    { ID: "b1", "AGENT NAMES": "Agent B", "Team Leader": "TL", Desk: "D1", FTD: "1", "FTD MAKER": "Agent B", Created: "2026-08-05", "FTD DATE": "2026-08-05" },
    { ID: "c1", "AGENT NAMES": "Agent C", "Team Leader": "TL", Desk: "D1", "Lead Date": "2026-08-05" },
    { ID: "d1", "AGENT NAMES": "Agent D", "Team Leader": "TL", Desk: "D1", "Lead Date": "2026-08-05" },
  ];
  const monthFilter = { type: "month", month: 7, year: 2026 };
  const stats = buildDashboardStats(rows, tabConfig, info, monthFilter, new Date("2026-08-31T12:00:00Z"));
  assert.equal(stats.totalAgent, 4, "all four agents counted");
  assert.equal(stats.activeAgent, 1, "only Agent A is working");
  // Denominator: A (working), B (reached target then left), D (left last 7 days) = 3; C excluded.
  assert.equal(stats.agentsWithTarget, 3);
  // Achieved: A and B reached target = 2.
  assert.equal(stats.totalTargetAchieved, 2);
  assert.equal(Math.round(stats.rateOfTargetAchieved), 67);
});

test("buildDashboardStats excludes team leaders from agent and target counts", () => {
  const tabConfig = {
    fields: {
      id: "ID",
      agentNames: "AGENT NAMES",
      teamLeader: "Team Leader",
      office: "Desk",
      ftd: "FTD",
      ftdMaker: "FTD MAKER",
      created: "Created",
      ftdDate: "FTD DATE",
    },
  };
  // Housse is a team leader who also shows up as an "agent" in the data.
  const infoContext = buildInfoAgentsContext([
    { "Working Status": "Working", "Agent Name": "Ahmet", "Agent Target": "10", Office: "Turkey English", "Team Leader": "Housse" },
    { "Working Status": "Working", "Agent Name": "Housse", "Agent Target": "10", Office: "Turkey English", "Team Leader": "Housse" },
  ]);
  const rows = [
    ...Array.from({ length: 12 }, (_, index) => ({
      ID: `A${index + 1}`,
      "AGENT NAMES": "Ahmet",
      "Team Leader": "Housse",
      Desk: "Turkey English",
      FTD: "1",
      "FTD MAKER": "Closer",
      Created: "2026-07-05T08:00:00Z",
      "FTD DATE": "2026-07-05",
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      ID: `H${index + 1}`,
      "AGENT NAMES": "Housse",
      "Team Leader": "Housse",
      Desk: "Turkey English",
      FTD: "1",
      "FTD MAKER": "Closer",
      Created: "2026-07-05T08:00:00Z",
      "FTD DATE": "2026-07-05",
    })),
  ];
  const stats = buildDashboardStats(rows, tabConfig, infoContext, null, new Date("2026-07-20T12:00:00Z"));
  // Only Ahmet counts; Housse (team leader) is excluded from every agent metric.
  assert.equal(stats.totalAgent, 1);
  assert.equal(stats.agentsWithTarget, 1);
  assert.equal(stats.totalTargetAchieved, 1);
  assert.equal(stats.rateOfTargetAchieved, 100);
});

test("buildDashboardStats counts an agent promoted to team leader in a later month", () => {
  const tabConfig = {
    fields: {
      id: "ID",
      agentNames: "AGENT NAMES",
      teamLeader: "Team Leader",
      office: "Desk",
      ftd: "FTD",
      ftdMaker: "FTD MAKER",
      created: "Created",
      ftdDate: "FTD DATE",
    },
  };
  // Current roster: "Promoted" now leads their own team (someone lists Promoted
  // as their Team Leader), so infoContext.teamLeaders includes "Promoted".
  const infoContext = buildInfoAgentsContext([
    { "Working Status": "Working", "Agent Name": "Feras", "Agent Target": "10", Office: "Turkey Arabic", "Team Leader": "Feras" },
    { "Working Status": "Working", "Agent Name": "Promoted", "Agent Target": "10", Office: "Turkey Arabic", "Team Leader": "Feras" },
    { "Working Status": "Working", "Agent Name": "New Agent", "Agent Target": "10", Office: "Turkey Arabic", "Team Leader": "Promoted" },
  ]);
  // The reported month's rows: Promoted was still a regular agent under Feras.
  const rows = [
    ...Array.from({ length: 8 }, (_, index) => ({
      ID: `F${index + 1}`,
      "AGENT NAMES": "Feras",
      "Team Leader": "Feras",
      Desk: "Turkey Arabic",
      FTD: "1",
      "FTD MAKER": "Closer",
      Created: "2026-08-05T08:00:00Z",
      "FTD DATE": "2026-08-05",
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      ID: `P${index + 1}`,
      "AGENT NAMES": "Promoted",
      "Team Leader": "Feras",
      Desk: "Turkey Arabic",
      FTD: "1",
      "FTD MAKER": "Closer",
      Created: "2026-08-05T08:00:00Z",
      "FTD DATE": "2026-08-05",
    })),
  ];
  const stats = buildDashboardStats(rows, tabConfig, infoContext, null, new Date("2026-08-20T12:00:00Z"));
  // Feras is the month's team leader (excluded). Promoted was an agent this month
  // and must still count even though they lead a team in the current roster.
  assert.equal(stats.totalAgent, 1);
  assert.equal(stats.agentsWithTarget, 1);
});
