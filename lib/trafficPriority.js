// Traffic Priority — shared, dependency-free helpers.
//
// This module holds the *pure* logic used by both the server (report builder +
// XLSX export) and the client dashboard panel, so the ranking / allocation
// algorithm lives in exactly one place. It only ever receives the plain data
// structure produced by buildTrafficPriorityReport (in dashboardService.js) and
// never touches Google Sheets, Redis or the DOM.

// Trailing window used to score agent performance (leads by lead date, FTD by
// FTD date), the recency window that decides whether an agent is "cold" and gets
// traffic blocked, and the minimum leads a (country + campaign) segment needs
// before we trust its own CR instead of falling back to the country baseline.
export const TRAFFIC_WINDOW_DAYS = 60;
export const TRAFFIC_BLOCK_WINDOW_DAYS = 7;
export const TRAFFIC_MIN_SEGMENT_LEADS = 10;
export const TRAFFIC_DEFAULT_COUNT = 20;

function safeAgents(agents) {
  return Array.isArray(agents) ? agents : [];
}

// Resolve which agent pool + scoring basis should drive the priority list for a
// given (country, campaign) selection, applying the fallback rule:
//   - a campaign with >= minSegmentLeads leads uses its own agents/CR,
//   - a thinner campaign falls back to the whole country's agents/CR (so strong
//     agents who simply have not touched a brand-new AFF still rank on top),
//     tagging which agents actually have leads in the selected campaign,
//   - no campaign selected uses the country baseline,
//   - an unknown country yields an empty list.
export function resolveTrafficRanking(data, selection = {}) {
  const countries = Array.isArray(data?.countries) ? data.countries : [];
  const minSegmentLeads = Number(data?.minSegmentLeads) || TRAFFIC_MIN_SEGMENT_LEADS;
  const country = String(selection?.country || "").trim();
  const campaign = String(selection?.campaign || "").trim();

  if (!country) {
    return { basis: "none", agents: [], country: "", campaign: "", segmentLeads: 0 };
  }
  const countryEntry = countries.find((entry) => entry.country === country);
  if (!countryEntry) {
    return { basis: "none", agents: [], country, campaign: "", segmentLeads: 0 };
  }

  if (campaign) {
    const segment = safeAgents(countryEntry.campaigns).find((entry) => entry.campaign === campaign);
    const segmentLeads = Number(segment?.leads) || 0;
    if (segment && segmentLeads >= minSegmentLeads) {
      return {
        basis: "segment",
        agents: safeAgents(segment.agents),
        country,
        campaign,
        segmentLeads,
      };
    }
    const inCampaign = new Set(safeAgents(segment?.agents).map((agent) => agent.agent));
    const agents = safeAgents(countryEntry.agents).map((agent) => ({
      ...agent,
      inSelectedCampaign: inCampaign.has(agent.agent),
    }));
    return { basis: "country-fallback", agents, country, campaign, segmentLeads };
  }

  return { basis: "country", agents: safeAgents(countryEntry.agents), country, campaign: "", segmentLeads: 0 };
}

// Turn a scored agent list into a weighted round-robin call sequence (D'Hondt /
// highest-averages). Higher CR ⇒ picked more often, but spread across the list
// instead of clustered. Blocked agents (no FTD in the recency window) never
// receive traffic. When every active agent scores 0 CR, weights are equal.
export function allocationSequence(agents, count) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  const active = safeAgents(agents).filter((agent) => !agent.blocked);
  const result = { sequence: [], counts: {}, shares: {} };
  if (!total || !active.length) {
    return result;
  }

  const anyPositive = active.some((agent) => Number(agent.cr) > 0);
  const pool = active.map((agent) => ({
    agent: agent.agent,
    weight: anyPositive ? Math.max(Number(agent.cr) || 0, 0) : 1,
    assigned: 0,
  }));

  for (let step = 0; step < total; step += 1) {
    let best = null;
    for (const entry of pool) {
      if (entry.weight <= 0) {
        continue;
      }
      const score = entry.weight / (entry.assigned + 1);
      if (
        !best ||
        score > best.score + 1e-9 ||
        (Math.abs(score - best.score) <= 1e-9 && entry.weight > best.entry.weight)
      ) {
        best = { entry, score };
      }
    }
    if (!best) {
      break;
    }
    best.entry.assigned += 1;
    result.sequence.push(best.entry.agent);
  }

  const assignedTotal = result.sequence.length || 1;
  for (const entry of pool) {
    if (entry.assigned > 0) {
      result.counts[entry.agent] = entry.assigned;
      result.shares[entry.agent] = (entry.assigned / assignedTotal) * 100;
    }
  }
  return result;
}
