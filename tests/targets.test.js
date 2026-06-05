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
  targetReachPercent,
} from "../lib/targets.js";

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

test("agent alias maps Asli Gu to Annalena Gu", () => {
  assert.equal(normalizeAgentName("Asli Gu"), "annalena gu");
  assert.equal(normalizeAgentName(" annalena   gu "), "annalena gu");
  assert.equal(canonicalAgentName("Asli Gu"), "Annalena Gu");
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
