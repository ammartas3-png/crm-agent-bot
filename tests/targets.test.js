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
