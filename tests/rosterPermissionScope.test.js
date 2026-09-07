import assert from "node:assert/strict";
import test from "node:test";

import { filterOfficeAgentRosterRowsByAllowedAgents } from "../lib/dashboardService.js";

// Regression: office-scoped (non-admin) users must still resolve each permitted
// agent's roster attributes (working status, start date, desk). Previously the
// roster was filtered by its granular Desk column, so an office-scoped user
// ("Dubai Office") matched none of the roster desks ("AE Thailand") and every
// agent fell back to "Not Working". Now the roster is gated by the permitted
// agents instead.
const roster = [
  { Agent: "Tatsanin Ke", "Working Status": "Working", Desk: "AE Thailand", "Team Leader": "Brandon Al", "Starting Date": "13.01.2025" },
  { Agent: "Thida Ra", "Working Status": "Working", Desk: "AE Thailand", "Team Leader": "Brandon Al", "Starting Date": "01.03.2025" },
  { Agent: "Brandon Al", "Working Status": "Working", Desk: "AE Thailand", "Team Leader": "Brandon Al", "Starting Date": "01.01.2025" },
  { Agent: "Someone Else", "Working Status": "Working", Desk: "AE Vietnam", "Team Leader": "Other Tl", "Starting Date": "01.01.2025" },
];

test("roster rows are kept for permitted agents (regardless of granular desk)", () => {
  const allowedAgents = new Set(["tatsanin ke", "thida ra", "brandon al"]);
  const kept = filterOfficeAgentRosterRowsByAllowedAgents(roster, allowedAgents);
  const agents = kept.map((row) => row.Agent).sort();
  // Permitted agents kept even though their desk ("AE Thailand") is not the
  // office-level scope; the unpermitted "Someone Else" is dropped.
  assert.deepEqual(agents, ["Brandon Al", "Tatsanin Ke", "Thida Ra"]);
});

test("empty permitted-agent set yields no roster rows", () => {
  assert.deepEqual(filterOfficeAgentRosterRowsByAllowedAgents(roster, new Set()), []);
});
