// Team Roster report: a headcount snapshot of an office's agent roster grouped
// by Team Leader, with each agent's language resolved from the Desk -> Lang map
// in the roster workbook's "Language" tab. It produces the on-screen team blocks
// plus two summary tables (by language and by team) with "Including TL" and
// "Not Including TL" counts, mirroring the manual "All Office Agents" sheet.
//
// Pure and dependency-light so it can be unit-tested without Google Sheets.
import { normalizeText } from "./calculations.js";
import { normalizeAgentName } from "./targets.js";

// Full language name (or existing short code) -> canonical abbreviation. Keeps
// every language as a compact code (EN, ENAF, AR, ...) so the summary shows one
// code per row and never a two-language label.
const LANGUAGE_ABBREVIATIONS = {
  english: "EN",
  en: "EN",
  "english africa": "ENAF",
  "english afr": "ENAF",
  "en afr": "ENAF",
  enaf: "ENAF",
  africa: "ENAF",
  african: "ENAF",
  arabic: "AR",
  ar: "AR",
  french: "FR",
  fr: "FR",
  indian: "IN",
  india: "IN",
  in: "IN",
  german: "GER",
  ger: "GER",
  de: "GER",
  japanese: "JP",
  japan: "JP",
  jp: "JP",
  portuguese: "PT",
  portugese: "PT",
  pt: "PT",
  spanish: "SP",
  spain: "SP",
  sp: "SP",
  es: "SP",
  indonesia: "ID",
  indonesian: "ID",
  id: "ID",
  malaysia: "MY",
  malay: "MY",
  my: "MY",
  philippines: "PH",
  philippine: "PH",
  filipino: "PH",
  ph: "PH",
};

// Reduce a raw Lang value to a single abbreviation. A compound value such as
// "Indonesia, Malaysia" or "EN / AR" is collapsed to its first token so a single
// agent never lands in a two-language row.
export function abbreviateLanguage(raw = "") {
  const firstToken = String(raw || "").split(/[,/;|]+/)[0].trim();
  if (!firstToken) {
    return "";
  }
  const key = normalizeText(firstToken);
  return LANGUAGE_ABBREVIATIONS[key] || firstToken.toUpperCase();
}

// Desk (normalized) -> abbreviated language code ("EN", "ENAF", "AR", ...). The
// first non-empty Lang value wins for a given desk.
export function buildDeskLanguageLabelMap(languageRows = []) {
  const map = new Map();
  for (const row of languageRows || []) {
    const desk = String(row?.Desk ?? row?.desk ?? "").trim();
    const lang = abbreviateLanguage(row?.Lang ?? row?.lang ?? "");
    const key = normalizeText(desk);
    if (!key || !lang || map.has(key)) {
      continue;
    }
    map.set(key, lang);
  }
  return map;
}

// Roster sheets use different active markers per office ("Working" in Turkiye,
// "Active" in Argentina, ...). Treat both as active.
function isWorkingStatusValue(value = "") {
  const normalized = normalizeText(value);
  return normalized === "working" || normalized === "active";
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

// The "Working Month / Fired Date" column holds either a tenure-in-months number
// (still active) or an actual exit/fired date. Read it (the header often carries
// a newline) and treat only a real date as an exit date.
function rosterFiredDateValue(row) {
  const direct = rosterFieldValue(
    row,
    "Working Month\n/Fired Date",
    "Working Month /Fired Date",
    "Working Month/Fired Date",
    "Fired Date",
    "firedDate",
  );
  if (direct) {
    return direct;
  }
  for (const key of Object.keys(row || {})) {
    if (/fired|working month/i.test(key)) {
      const value = String(row[key] ?? "").trim();
      if (value) {
        return value;
      }
    }
  }
  return "";
}

function looksLikeExitDate(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return false;
  }
  // A real date (e.g. 20/08/2026 or 15.03.2026); a plain month count like "7" is not.
  return /\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}/.test(trimmed);
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
    const isWorking = isWorkingStatusValue(workingStatusRaw);
    const hasExitDate = looksLikeExitDate(rosterFiredDateValue(row));
    const language = desk ? deskLangMap.get(normalizeText(desk)) || "" : "";
    parsed.push({
      agent: agentName,
      normalizedAgent,
      desk,
      teamLeader,
      language,
      workingStatus: workingStatusRaw,
      isWorking,
      hasExitDate,
    });
    if (teamLeader) {
      teamLeaderNames.add(normalizeAgentName(teamLeader));
    }
  }
  const isTeamLeaderAgent = (normalizedAgent) => teamLeaderNames.has(normalizedAgent);

  // Anyone with a real exit/fired date has left, so drop them even if their
  // status still reads Active (e.g. Axel Di, Active but fired on 20/08/2026).
  const stillHere = parsed.filter((row) => !row.hasExitDate);
  const rows = workingOnly ? stillHere.filter((row) => row.isWorking) : stillHere;

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
