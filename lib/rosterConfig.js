import { normalizeText } from "./calculations.js";

// The roster + desk-language workbook is a single FIXED spreadsheet (not the
// per-office monthly files). It holds agent roster tabs (one per country) and a
// "Language" tab used for desk benchmarks. These are shared by the dashboard,
// the bot, and the n8n sync, so the config lives here to avoid importing the
// large dashboardService module from the ingest path.
export const OFFICE_AGENT_ROSTER_SPREADSHEET_ID =
  process.env.OFFICE_AGENT_ROSTER_SPREADSHEET_ID ||
  "1Zd3jiQH7PsRope1qo_-bfeYkcCEbUR9pppPcAGy9hgk";

export const OFFICE_AGENT_ROSTER_COLUMNS = [
  "Agent",
  "Working Status",
  "Desk",
  "Team Leader",
  "Starting Date",
  "Old Name",
  "Working Month /Fired Date",
];

export const OFFICE_DESK_LANGUAGE_COLUMNS = [
  "Desk",
  "Lang",
  "LESS THAN 2 MONTHS",
  "MORE THAN 2 MONTHS",
];

export const ROSTER_TAB_NAMES = ["Turkiye", "Argentina", "Pakistan", "Dubai"];

export function rosterTabNameForOffice(officeScope = "") {
  const normalized = normalizeText(officeScope);
  if (!normalized) {
    return "";
  }
  if (normalized.includes("turkey") || normalized.includes("turkiye")) {
    return "Turkiye";
  }
  if (normalized.includes("argentina")) {
    return "Argentina";
  }
  if (normalized.includes("pakistan")) {
    return "Pakistan";
  }
  if (
    normalized.includes("dubai") ||
    normalized.includes("uae") ||
    normalized.includes("united arab emirates")
  ) {
    return "Dubai";
  }
  return "";
}

export function officeAgentRosterTabConfig(tabName = "") {
  const safeTabName = String(tabName || "").trim();
  return {
    key: "officeAgentRoster",
    name: safeTabName,
    range: `'${safeTabName.replace(/'/g, "''")}'!A:G`,
    columns: OFFICE_AGENT_ROSTER_COLUMNS,
    fields: {
      workingStatus: "Working Status",
      agentName: "Agent",
      office: "Desk",
      teamLeader: "Team Leader",
      oldName: "Old Name",
      firedDate: "Working Month /Fired Date",
    },
  };
}

export function officeDeskLanguageTabConfig() {
  const safeTabName = "Language";
  return {
    key: "officeDeskLanguage",
    name: safeTabName,
    range: `'${safeTabName.replace(/'/g, "''")}'!A:D`,
    columns: OFFICE_DESK_LANGUAGE_COLUMNS,
    fields: {
      desk: "Desk",
      lang: "Lang",
      lessThanTwoMonths: "LESS THAN 2 MONTHS",
      moreThanMonths: "MORE THAN 2 MONTHS",
    },
  };
}

// Stable Redis source keys for the auxiliary (non-month) sheets.
export function rosterSourceKey(tabName = "") {
  return `__roster__:${String(tabName || "").trim().toLowerCase()}`;
}

export const DESK_LANGUAGE_SOURCE_KEY = "__desklanguage__";
