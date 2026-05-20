import assert from "node:assert/strict";
import test from "node:test";

import {
  agentTarget,
  buildAgentTargetsMap,
  collectAgentNames,
  formatOptionalPercent,
  formatTarget,
  summarizeTarget,
  targetReachPercent,
} from "../lib/targets.js";

const tabConfig = {
  fields: {
    agentNames: "AGENT NAMES",
  },
};

test("buildAgentTargetsMap matches names case-insensitively and trims spaces", () => {
  const map = buildAgentTargetsMap([
    { "Agent Name": " Ahmet ", "Agent Target": "15" },
    { "Agent Name": "MAX", "Agent Target": "" },
  ]);

  assert.equal(agentTarget(map, "ahmet"), 15);
  assert.equal(agentTarget(map, "max"), 0);
});

test("summarizeTarget sums unique agents", () => {
  const map = buildAgentTargetsMap([
    { "Agent Name": "Ahmet", "Agent Target": "15" },
    { "Agent Name": "Max", "Agent Target": "20" },
  ]);

  assert.equal(summarizeTarget(["Ahmet", " ahmet ", "Max"], map), 35);
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
