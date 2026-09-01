// Team Roster report: a headcount snapshot of an office's agent roster grouped
// by Team Leader, with each agent's language resolved from the Desk -> Lang map
// in the roster workbook's "Language" tab. It produces the on-screen team blocks
// plus two summary tables (by language and by team) with "Including TL" and
// "Not Including TL" counts, mirroring the manual "All Office Agents" sheet.
//
// Pure and dependency-light so it can be unit-tested without Google Sheets.
import { normalizeText } from "./calculations.js";
import { normalizeAgentName } from "./targets.js";

// Desk (normalized) -> raw language label ("EN", "EN AFR", "AR", ...). The first
// non-empty Lang value wins for a given desk.
export function buildDeskLanguageLabelMap(languageRows = []) {
  const map = new Map();
  for (const row of languageRows || []) {
    const desk = String(row?.Desk ?? row?.desk ?? "").trim();
    const lang = String(row?.Lang ?? row?.lang ?? "").trim();
    const key = normalizeText(desk);
    if (!key || !lang || map.has(key)) {
      continue;
    }
    map.set(key, lang);
  }
  return map;
}

function rosterFieldValue(row, ...names) {
  for (const name of names) {
    if (row && Object.prototype.hasOwnProperty.call(row, name)) {
      const value = String(row[name] ?? "").trim();
      if (value) {
        return value;
      }
    }
  }
  return "";
}

export function buildTeamRosterReport(rosterRows = [], options = {}) {
  const deskLangMap = options.deskLangMap instanceof Map ? options.deskLangMap : new Map();
  // workingFilter: "working" keeps only Working agents; anything else keeps all.
  const workingOnly = String(options.workingFilter || "all").toLowerCase() === "working";

  const teamLeaderNames = new Set();
  const parsed = [];
  for (const row of rosterRows || []) {
    const agentName = rosterFieldValue(row, "Agent", "Agent Name", "agent");
    const normalizedAgent = normalizeAgentName(agentName);
    if (!agentName || !normalizedAgent) {
      continue;
    }
    const desk = rosterFieldValue(row, "Desk", "desk", "Office");
    const teamLeader = rosterFieldValue(row, "Team Leader", "teamLeader");
    const workingStatusRaw = rosterFieldValue(row, "Working Status", "workingStatus");
    const isWorking = normalizeText(workingStatusRaw) === "working";
    const language = desk ? deskLangMap.get(normalizeText(desk)) || "" : "";
    parsed.push({
      agent: agentName,
      normalizedAgent,
      desk,
      teamLeader,
      language,
      workingStatus: workingStatusRaw,
      isWorking,
    });
    if (teamLeader) {
      teamLeaderNames.add(normalizeAgentName(teamLeader));
    }
  }
  const isTeamLeaderAgent = (normalizedAgent) => teamLeaderNames.has(normalizedAgent);

  const rows = workingOnly ? parsed.filter((row) => row.isWorking) : parsed;

  // Teams grouped by Team Leader, preserving first-seen order.
  const teamOrder = [];
  const teamMap = new Map();
  for (const row of rows) {
    const key = normalizeAgentName(row.teamLeader) || "__none__";
    if (!teamMap.has(key)) {
      teamMap.set(key, { teamLeader: row.teamLeader || "—", agents: [] });
      teamOrder.push(key);
    }
    teamMap.get(key).agents.push({
      agent: row.agent,
      language: row.language,
      workingStatus: row.workingStatus,
      isTeamLeader: isTeamLeaderAgent(row.normalizedAgent),
    });
  }
  const teams = teamOrder.map((key) => {
    const entry = teamMap.get(key);
    const inclTL = entry.agents.length;
    const exclTL = entry.agents.filter((agent) => !agent.isTeamLeader).length;
    return { teamLeader: entry.teamLeader, agents: entry.agents, count: inclTL, countExclTL: exclTL };
  });

  // Summary by language.
  const langOrder = [];
  const langMap = new Map();
  for (const row of rows) {
    const label = row.language || "";
    const key = label || "__none__";
    if (!langMap.has(key)) {
      langMap.set(key, { language: label, inclTL: 0, exclTL: 0 });
      langOrder.push(key);
    }
    const entry = langMap.get(key);
    entry.inclTL += 1;
    if (!isTeamLeaderAgent(row.normalizedAgent)) {
      entry.exclTL += 1;
    }
  }
  const byLanguage = langOrder
    .map((key) => langMap.get(key))
    .sort((left, right) => right.inclTL - left.inclTL || String(left.language).localeCompare(String(right.language)));

  // Summary by team (same order as the team blocks).
  const byTeam = teams.map((team) => ({ team: team.teamLeader, inclTL: team.count, exclTL: team.countExclTL }));

  const totalInclTL = rows.length;
  const totalExclTL = rows.filter((row) => !isTeamLeaderAgent(row.normalizedAgent)).length;

  return {
    teams,
    byLanguage,
    byTeam,
    totals: { inclTL: totalInclTL, exclTL: totalExclTL },
  };
}
