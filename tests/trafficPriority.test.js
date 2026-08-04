import assert from "node:assert/strict";
import test from "node:test";

import { buildTrafficPriorityReport } from "../lib/dashboardService.js";
import { allocationSequence, buildDistributionAudit, resolveTrafficRanking } from "../lib/trafficPriority.js";

const tabConfig = {
  fields: {
    id: "ID",
    country: "Country",
    campaign: "Campaign",
    agentNames: "AGENT NAMES",
    firstCallAgent: "First Call Agent",
    teamLeader: "Team Leader",
    leadDate: "Lead Date",
    created: "Created",
    ftd: "FTD",
    ftdMaker: "FTD MAKER",
    ftdDate: "FTD DATE",
    crTarget: "CR TARGET",
  },
};

const NOW = new Date("2026-03-01T00:00:00Z");
const IN_WINDOW = "2026-02-10"; // within 60 days, outside 7 days
const RECENT_FTD = "2026-02-26"; // within 7 days
const OLD_FTD = "2026-01-15"; // within 60 days, outside 7 days
const OUT_OF_WINDOW = "2025-10-01"; // older than 60 days

let leadId = 0;
const lead = (fields) => ({ ID: `L${(leadId += 1)}`, "Lead Date": IN_WINDOW, ...fields });
const ftdLead = (fields) => lead({ "FTD MAKER": "x", "FTD DATE": RECENT_FTD, FTD: "1", ...fields });

function repeat(count, factory) {
  return Array.from({ length: count }, (_unused, index) => factory(index));
}

test("allocationSequence spreads picks by CR weight and skips blocked agents", () => {
  const agents = [
    { agent: "A", cr: 50, blocked: false },
    { agent: "B", cr: 16.67, blocked: false },
    { agent: "C", cr: 90, blocked: true },
  ];
  const result = allocationSequence(agents, 4);
  assert.equal(result.sequence.length, 4);
  assert.equal(result.counts.A, 3);
  assert.equal(result.counts.B, 1);
  assert.equal(result.counts.C, undefined, "blocked agent never receives traffic");
  // First pick goes to the strongest active agent.
  assert.equal(result.sequence[0], "A");
});

test("allocationSequence falls back to equal weights when every CR is zero", () => {
  const agents = [
    { agent: "A", cr: 0, blocked: false },
    { agent: "B", cr: 0, blocked: false },
  ];
  const result = allocationSequence(agents, 4);
  assert.equal(result.counts.A, 2);
  assert.equal(result.counts.B, 2);
});

test("resolveTrafficRanking uses segment CR when the AFF has enough leads", () => {
  const data = {
    minSegmentLeads: 10,
    countries: [
      {
        country: "Germany",
        agents: [{ agent: "A" }, { agent: "B" }],
        campaigns: [{ campaign: "Big", leads: 12, agents: [{ agent: "A" }, { agent: "B" }] }],
      },
    ],
  };
  const ranking = resolveTrafficRanking(data, { country: "Germany", campaign: "Big" });
  assert.equal(ranking.basis, "segment");
  assert.equal(ranking.agents.length, 2);
});

test("resolveTrafficRanking falls back to country pool for a thin AFF and tags campaign agents", () => {
  const data = {
    minSegmentLeads: 10,
    countries: [
      {
        country: "Germany",
        agents: [{ agent: "A" }, { agent: "B" }],
        campaigns: [{ campaign: "New", leads: 3, agents: [{ agent: "B" }] }],
      },
    ],
  };
  const ranking = resolveTrafficRanking(data, { country: "Germany", campaign: "New" });
  assert.equal(ranking.basis, "country-fallback");
  assert.equal(ranking.agents.length, 2);
  const byName = Object.fromEntries(ranking.agents.map((agent) => [agent.agent, agent.inSelectedCampaign]));
  assert.equal(byName.A, false, "strong agent absent from the new AFF still ranks");
  assert.equal(byName.B, true);
});

test("buildDistributionAudit compares actual vs expected using the prior window", () => {
  const countryEntry = {
    agents: [
      {
        agent: "A",
        teamLeader: "TL1",
        blocked: false,
        leadsByDay: { "2026-07-10": 10, "2026-08-01": 5 },
        ftdByDay: { "2026-07-11": 5 },
      },
      {
        agent: "B",
        teamLeader: "TL1",
        blocked: false,
        leadsByDay: { "2026-07-10": 10, "2026-08-01": 5 },
        ftdByDay: { "2026-07-11": 1 },
      },
      {
        agent: "C",
        teamLeader: "TL2",
        blocked: true,
        leadsByDay: { "2026-08-01": 3 },
        ftdByDay: {},
      },
    ],
  };
  const audit = buildDistributionAudit(countryEntry, "2026-08-01", { windowDays: 60 });
  assert.equal(audit.totalActual, 13, "5 + 5 + 3 leads that day");

  const byAgent = Object.fromEntries(audit.rows.map((row) => [row.agent, row]));
  assert.equal(Math.round(byAgent.A.priorCr), 50);
  assert.equal(Math.round(byAgent.B.priorCr), 10);
  // A has higher prior CR so should have been given more than B; A got 5 (under),
  // B got 5 (over). Blocked C gets no expectation.
  assert.ok(byAgent.A.expected > byAgent.B.expected);
  assert.ok(byAgent.A.diff < 0, "A under-served");
  assert.ok(byAgent.B.diff > 0, "B over-served");
  assert.equal(byAgent.C.expected, 0, "blocked agent has no expectation");
  // Rows sorted by diff ascending -> most under-served first.
  assert.equal(audit.rows[0].agent, "A");
});

test("buildTrafficPriorityReport day picker excludes future and ancient typo dates", () => {
  leadId = 0;
  const rows = [
    lead({ Country: "X", Campaign: "C", "AGENT NAMES": "A", "Lead Date": "2026-02-10" }),
    lead({ Country: "X", Campaign: "C", "AGENT NAMES": "A", "Lead Date": "2027-07-15" }), // future typo
    lead({ Country: "X", Campaign: "C", "AGENT NAMES": "A", "Lead Date": "0206-07-28" }), // ancient typo
  ];
  const report = buildTrafficPriorityReport(rows, tabConfig, { now: NOW });
  assert.ok(report.days.includes("2026-02-10"), "valid recent day is offered");
  assert.ok(!report.days.includes("2027-07-15"), "future day is not offered");
  assert.ok(!report.days.some((day) => day.startsWith("0206")), "ancient typo day is not offered");
});

test("buildTrafficPriorityReport groups country/campaign/agent and flags cold agents", () => {
  leadId = 0;
  const rows = [
    // Agent A - Germany / Big: 6 leads, 3 recent FTD (CR 50%, active).
    ...repeat(3, () => ftdLead({ Country: "Germany", Campaign: "Big", "AGENT NAMES": "Agent A", "Team Leader": "TL1" })),
    ...repeat(3, () => lead({ Country: "Germany", Campaign: "Big", "AGENT NAMES": "Agent A", "Team Leader": "TL1" })),
    // Agent B - Germany / Big: 6 leads, 1 recent FTD.
    ...repeat(1, () => ftdLead({ Country: "Germany", Campaign: "Big", "AGENT NAMES": "Agent B", "Team Leader": "TL1" })),
    ...repeat(5, () => lead({ Country: "Germany", Campaign: "Big", "AGENT NAMES": "Agent B", "Team Leader": "TL1" })),
    // Agent B - Germany / New: 3 leads (thin AFF), 1 recent FTD.
    ...repeat(1, () => ftdLead({ Country: "Germany", Campaign: "New", "AGENT NAMES": "Agent B", "Team Leader": "TL1" })),
    ...repeat(2, () => lead({ Country: "Germany", Campaign: "New", "AGENT NAMES": "Agent B", "Team Leader": "TL1" })),
    // Agent C - Germany / Big: 4 leads, 1 FTD but only an OLD one -> blocked.
    ...repeat(1, () => ftdLead({ Country: "Germany", Campaign: "Big", "AGENT NAMES": "Agent C", "Team Leader": "TL2", "FTD DATE": OLD_FTD })),
    ...repeat(3, () => lead({ Country: "Germany", Campaign: "Big", "AGENT NAMES": "Agent C", "Team Leader": "TL2" })),
    // Out-of-window lead: excluded from grouping entirely.
    lead({ Country: "Germany", Campaign: "Big", "AGENT NAMES": "Agent A", "Lead Date": OUT_OF_WINDOW }),
  ];

  const report = buildTrafficPriorityReport(rows, tabConfig, { now: NOW });
  assert.equal(report.windowDays, 60);
  assert.equal(report.blockWindowDays, 7);

  const germany = report.countries.find((entry) => entry.country === "Germany");
  assert.ok(germany, "Germany present");
  assert.equal(germany.leads, 19, "out-of-window lead excluded (6+6+3+4)");

  const big = germany.campaigns.find((entry) => entry.campaign === "Big");
  const fresh = germany.campaigns.find((entry) => entry.campaign === "New");
  assert.equal(big.leads, 16, "Big = A6 + B6 + C4");
  assert.equal(fresh.leads, 3, "New AFF is thin (< 10)");

  const agentC = germany.agents.find((entry) => entry.agent === "Agent C");
  const agentA = germany.agents.find((entry) => entry.agent === "Agent A");
  assert.equal(agentC.blocked, true, "no FTD in last 7 days -> blocked");
  assert.equal(agentA.blocked, false);
  assert.equal(Math.round(agentA.cr), 50);

  // Segment ranking + allocation excludes the blocked agent.
  const ranking = resolveTrafficRanking(report, { country: "Germany", campaign: "Big" });
  assert.equal(ranking.basis, "segment");
  const allocation = allocationSequence(ranking.agents, 4);
  assert.equal(allocation.counts["Agent C"], undefined);
  assert.equal(allocation.counts["Agent A"], 3);
  assert.equal(allocation.counts["Agent B"], 1);
});
