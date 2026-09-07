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

function selectedCountryList(selection = {}) {
  if (Array.isArray(selection?.countries) && selection.countries.length) {
    return selection.countries.map((value) => String(value || "").trim()).filter(Boolean);
  }
  const single = String(selection?.country || "").trim();
  return single ? [single] : [];
}

// Merge the country-level agent rows across several countries into one list:
// leads and FTD are summed, CR is recomputed from those totals (not averaged),
// and the per-day maps are merged so the audit still works. `blocked` is a
// global per-agent flag, so it is identical across countries.
export function mergeAgentsAcrossCountries(countryEntries = []) {
  const map = new Map();
  for (const entry of countryEntries) {
    for (const agent of safeAgents(entry?.agents)) {
      const key = agent.agent;
      if (!map.has(key)) {
        map.set(key, {
          agent: agent.agent,
          teamLeader: agent.teamLeader || "",
          leads: 0,
          ftd: 0,
          blocked: Boolean(agent.blocked),
          ftd7d: Number(agent.ftd7d) || 0,
          leadsByDay: {},
          ftdByDay: {},
        });
      }
      const acc = map.get(key);
      acc.leads += Number(agent.leads) || 0;
      acc.ftd += Number(agent.ftd) || 0;
      if (!acc.teamLeader && agent.teamLeader) {
        acc.teamLeader = agent.teamLeader;
      }
      for (const [day, value] of Object.entries(agent.leadsByDay || {})) {
        acc.leadsByDay[day] = (acc.leadsByDay[day] || 0) + (Number(value) || 0);
      }
      for (const [day, value] of Object.entries(agent.ftdByDay || {})) {
        acc.ftdByDay[day] = (acc.ftdByDay[day] || 0) + (Number(value) || 0);
      }
    }
  }
  return [...map.values()]
    .map((agent) => ({ ...agent, cr: agent.leads > 0 ? (agent.ftd / agent.leads) * 100 : 0 }))
    .sort(
      (left, right) =>
        Number(left.blocked) - Number(right.blocked) ||
        right.cr - left.cr ||
        right.leads - left.leads ||
        String(left.agent).localeCompare(String(right.agent)),
    );
}

// Returns a single country entry (with merged agents + day maps) for the
// selected countries, so the Distribution Check audit can run across a
// multi-country selection.
export function mergeCountryEntries(data, countries = []) {
  const all = Array.isArray(data?.countries) ? data.countries : [];
  const entries = countries.map((name) => all.find((entry) => entry.country === name)).filter(Boolean);
  if (entries.length <= 1) {
    return entries[0] || { agents: [] };
  }
  return { agents: mergeAgentsAcrossCountries(entries) };
}

// Resolve which agent pool + scoring basis should drive the priority list for a
// given selection (one or more countries, optional campaign), applying:
//   - a single country + campaign with >= minSegmentLeads leads uses that
//     campaign's agents/CR,
//   - a thinner campaign falls back to the whole country's agents/CR (tagging
//     which agents actually have leads in the campaign),
//   - one country, no campaign uses that country's baseline,
//   - multiple countries merge the country-level agents (summed leads/FTD, CR
//     recomputed); campaign selection does not apply,
//   - an empty / unknown selection yields an empty list.
export function resolveTrafficRanking(data, selection = {}) {
  const countries = Array.isArray(data?.countries) ? data.countries : [];
  const minSegmentLeads = Number(data?.minSegmentLeads) || TRAFFIC_MIN_SEGMENT_LEADS;
  const selectedCountries = selectedCountryList(selection);
  const campaign = String(selection?.campaign || "").trim();

  if (!selectedCountries.length) {
    return { basis: "none", agents: [], countries: [], campaign: "", segmentLeads: 0 };
  }

  // Single country + campaign → per-campaign ranking with country fallback.
  if (selectedCountries.length === 1 && campaign) {
    const country = selectedCountries[0];
    const countryEntry = countries.find((entry) => entry.country === country);
    if (!countryEntry) {
      return { basis: "none", agents: [], countries: [country], campaign: "", segmentLeads: 0 };
    }
    const segment = safeAgents(countryEntry.campaigns).find((entry) => entry.campaign === campaign);
    const segmentLeads = Number(segment?.leads) || 0;
    if (segment && segmentLeads >= minSegmentLeads) {
      return { basis: "segment", agents: safeAgents(segment.agents), countries: [country], campaign, segmentLeads };
    }
    const inCampaign = new Set(safeAgents(segment?.agents).map((agent) => agent.agent));
    const agents = safeAgents(countryEntry.agents).map((agent) => ({
      ...agent,
      inSelectedCampaign: inCampaign.has(agent.agent),
    }));
    return { basis: "country-fallback", agents, countries: [country], campaign, segmentLeads };
  }

  const entries = selectedCountries.map((name) => countries.find((entry) => entry.country === name)).filter(Boolean);
  if (!entries.length) {
    return { basis: "none", agents: [], countries: selectedCountries, campaign: "", segmentLeads: 0 };
  }
  if (entries.length === 1) {
    return { basis: "country", agents: safeAgents(entries[0].agents), countries: [entries[0].country], campaign: "", segmentLeads: 0 };
  }
  return {
    basis: "multi-country",
    agents: mergeAgentsAcrossCountries(entries),
    countries: entries.map((entry) => entry.country),
    campaign: "",
    segmentLeads: 0,
  };
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

// Distribution Check (audit): for one chosen day, compare each agent's ACTUAL
// leads that day against what a performance-based split would have given them,
// using the CR of the `windowDays` days BEFORE that day (no look-ahead). The
// expected count = (agent prior-CR weight / total weight) x that day's total
// leads; positive diff = over-served, negative = under-served. Blocked agents
// (no recent FTD) are given no expectation. Consumes the per-(country,agent)
// leadsByDay / ftdByDay maps produced by buildTrafficPriorityReport.
export function buildDistributionAudit(countryEntry, day, options = {}) {
  const windowDays = Number(options.windowDays) || TRAFFIC_WINDOW_DAYS;
  const agents = Array.isArray(countryEntry?.agents) ? countryEntry.agents : [];
  const dayString = String(day || "").trim();
  if (!dayString || !agents.length) {
    return { day: dayString, totalActual: 0, rows: [] };
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const anchor = new Date(`${dayString}T00:00:00Z`).getTime();
  const priorEnd = anchor - dayMs; // the day before the audited day
  const priorStart = anchor - windowDays * dayMs;
  const inPrior = (dateStr) => {
    const time = new Date(`${dateStr}T00:00:00Z`).getTime();
    return time >= priorStart && time <= priorEnd;
  };
  const sumInPrior = (map) => {
    let sum = 0;
    for (const [dateStr, value] of Object.entries(map || {})) {
      if (inPrior(dateStr)) {
        sum += Number(value) || 0;
      }
    }
    return sum;
  };

  const base = agents.map((agent) => {
    const priorLeads = sumInPrior(agent.leadsByDay);
    const priorFtd = sumInPrior(agent.ftdByDay);
    const priorCr = priorLeads > 0 ? (priorFtd / priorLeads) * 100 : 0;
    const actual = Number((agent.leadsByDay || {})[dayString] || 0);
    return {
      agent: agent.agent,
      teamLeader: agent.teamLeader || "",
      blocked: Boolean(agent.blocked),
      priorLeads,
      priorFtd,
      priorCr,
      actual,
    };
  });
  const totalActual = base.reduce((sum, item) => sum + item.actual, 0);
  const active = base.filter((item) => !item.blocked);
  const anyPositive = active.some((item) => item.priorCr > 0);
  const totalWeight = active.reduce((sum, item) => sum + (anyPositive ? item.priorCr : 1), 0);

  const rows = base
    .map((item) => {
      const weight = item.blocked ? 0 : anyPositive ? item.priorCr : 1;
      const expected = !item.blocked && totalWeight > 0 ? (weight / totalWeight) * totalActual : 0;
      return { ...item, expected, diff: item.actual - expected };
    })
    .sort((left, right) => left.diff - right.diff || String(left.agent).localeCompare(String(right.agent)));

  return { day: dayString, totalActual, rows };
}
