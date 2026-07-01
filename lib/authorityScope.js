import { getRowValue, normalizeText } from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import { isAdminTelegramUser, normalizePrincipal, telegramUserPrincipals } from "./permissions.js";

const AUTHORITY_SPREADSHEET_ID_FALLBACK = "1mwnrhktfXR_E7R15-4uDDk4FG9euG27U5XhrbztsLBc";
const AUTHORITY_SHEET_NAME_FALLBACK = process.env.BOT_AUTHORITY_SHEET_NAME || "users";
const AUTHORITY_COLUMNS = [
  "User Name",
  "User Telegram",
  "User Telegram ID",
  "Office",
  "Desk",
  "Team",
  "Authority",
];
const AUTHORITY_TAB_CONFIG = {
  range: process.env.BOT_AUTHORITY_RANGE || `'${AUTHORITY_SHEET_NAME_FALLBACK.replace(/'/g, "''")}'!A:G`,
  columns: AUTHORITY_COLUMNS,
};
const LIST_SEPARATOR_REGEX = /[,\n\r;|]+/;
const ALL_TOKENS = new Set(["all", "*", "any", "full", "hepsi", "tum", "tumu", "tümü"]);
const ADMIN_TOKENS = new Set(["admin", "owner", "superadmin"]);
const MANAGER_TOKENS = new Set(["manager", "managers"]);
const CACHE_TTL_MS = 10 * 60 * 1000;
const scopeCache = new Map();

function cacheKeyForPrincipals(principals = []) {
  return principals.slice().sort((left, right) => left.localeCompare(right)).join("|");
}

function parseList(value = "") {
  return String(value || "")
    .split(LIST_SEPARATOR_REGEX)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function isAllValue(value = "") {
  const normalized = normalizeText(value);
  return ALL_TOKENS.has(normalized);
}

function normalizeTelegramId(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (/^\d+(\.0+)?$/.test(text)) {
    return text.replace(/\.0+$/, "");
  }
  return text;
}

function normalizeAuthorityRole(authorityText = "") {
  for (const token of parseList(authorityText).map((item) => normalizeText(item))) {
    if (!token) {
      continue;
    }
    if (ALL_TOKENS.has(token) || ADMIN_TOKENS.has(token)) {
      return "all";
    }
    if (MANAGER_TOKENS.has(token)) {
      return "manager";
    }
    if (token === "crm") {
      return "crm";
    }
    if (["desk manager", "deskmanager", "desk_manager"].includes(token)) {
      return "desk manager";
    }
    if (["team leader", "teamleader", "team_leader"].includes(token)) {
      return "team leader";
    }
  }
  return "";
}

function parseAuthorityColumn(authorityText = "") {
  const filters = {
    office: [],
    desk: [],
    teamLeader: [],
    agent: [],
  };
  let role = normalizeAuthorityRole(authorityText);
  for (const token of parseList(authorityText)) {
    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
      continue;
    }
    if (
      ALL_TOKENS.has(normalizedToken) ||
      ADMIN_TOKENS.has(normalizedToken) ||
      MANAGER_TOKENS.has(normalizedToken) ||
      ["crm", "desk manager", "deskmanager", "desk_manager", "team leader", "teamleader", "team_leader"].includes(
        normalizedToken,
      )
    ) {
      continue;
    }
    const officeMatch = token.match(/^(?:office|ofis)\s*[:=]\s*(.+)$/i);
    if (officeMatch) {
      filters.office.push(...parseList(officeMatch[1]));
      continue;
    }
    const deskMatch = token.match(/^(?:desk|department|departman)\s*[:=]\s*(.+)$/i);
    if (deskMatch) {
      filters.desk.push(...parseList(deskMatch[1]));
      continue;
    }
    const teamMatch = token.match(/^(?:team\s*leader|teamleader|team|tl|takim|takım)\s*[:=]\s*(.+)$/i);
    if (teamMatch) {
      filters.teamLeader.push(...parseList(teamMatch[1]));
      continue;
    }
    const agentMatch = token.match(/^(?:agent|kullanici|kullanıcı|user)\s*[:=]\s*(.+)$/i);
    if (agentMatch) {
      filters.agent.push(...parseList(agentMatch[1]));
      continue;
    }
    // Backward compatibility: plain token in Authority is treated as Team scope.
    filters.teamLeader.push(token);
  }
  return {
    role,
    filters,
  };
}

function mergeScopeSets(base, nextValues = []) {
  for (const value of nextValues) {
    const trimmed = String(value || "").trim();
    if (trimmed && !isAllValue(trimmed)) {
      base.add(trimmed);
    }
  }
}

function buildFiltersFromSets(officeSet, deskSet, teamLeaderSet, agentSet) {
  const filters = {};
  if (officeSet.size) {
    filters.office = [...officeSet].sort((left, right) => left.localeCompare(right));
  }
  if (deskSet.size) {
    const desks = [...deskSet].sort((left, right) => left.localeCompare(right));
    filters.desk = desks;
    filters.officeOrDepartment = desks;
  }
  if (teamLeaderSet.size) {
    filters.teamLeader = [...teamLeaderSet].sort((left, right) => left.localeCompare(right));
  }
  if (agentSet.size) {
    filters.agent = [...agentSet].sort((left, right) => left.localeCompare(right));
    filters.agentField = "agentNames";
  }
  return filters;
}

function rowPrincipals(row = {}) {
  const principals = new Set();
  const username = normalizePrincipal(getRowValue(row, "User Telegram"));
  const telegramId = normalizePrincipal(normalizeTelegramId(getRowValue(row, "User Telegram ID")));
  const userName = normalizePrincipal(getRowValue(row, "User Name"));
  if (username) {
    principals.add(username);
  }
  if (telegramId) {
    principals.add(telegramId);
  }
  if (userName) {
    principals.add(userName);
  }
  return principals;
}

function rowMatchesUser(row = {}, userPrincipals = []) {
  if (!userPrincipals.length) {
    return false;
  }
  const principals = rowPrincipals(row);
  return userPrincipals.some((principal) => principals.has(principal));
}

export function dashboardLoginUrl(env = process.env) {
  const raw = String(env.PUBLIC_APP_URL || env.VERCEL_URL || "").trim().replace(/\/+$/, "");
  if (!raw) {
    return "/dashboard";
  }
  if (/^https?:\/\//i.test(raw)) {
    return `${raw}/dashboard`;
  }
  return `https://${raw}/dashboard`;
}

export function managerDashboardWelcomeText(env = process.env) {
  const url = dashboardLoginUrl(env);
  return [
    "Your account has Manager authority.",
    "Open the CRM Dashboard and sign in with Telegram to view your scoped data.",
    "",
    `Dashboard: ${url}`,
    "",
    "Bot Excel reports are only available to users with ALL authority.",
  ].join("\n");
}

export function computeAuthorityScopeFromRows(rows = [], telegramUser) {
  const userPrincipals = telegramUserPrincipals(telegramUser);
  const matchedRows = rows.filter((row) => rowMatchesUser(row, userPrincipals));
  if (!matchedRows.length) {
    return {
      allowed: false,
      canUseBot: false,
      canUseDashboard: false,
      unrestricted: false,
      authorityRole: "",
      filters: {},
      matchedRows: 0,
    };
  }
  const officeSet = new Set();
  const deskSet = new Set();
  const teamLeaderSet = new Set();
  const agentSet = new Set();
  let authorityRole = "";

  for (const row of matchedRows) {
    const offices = parseList(getRowValue(row, "Office"));
    const desks = parseList(getRowValue(row, "Desk"));
    const teams = parseList(getRowValue(row, "Team"));
    const authority = parseAuthorityColumn(getRowValue(row, "Authority"));
    if (authority.role) {
      authorityRole = authority.role;
    }
    mergeScopeSets(officeSet, offices);
    mergeScopeSets(deskSet, desks);
    mergeScopeSets(teamLeaderSet, teams);
    mergeScopeSets(officeSet, authority.filters.office);
    mergeScopeSets(deskSet, authority.filters.desk);
    mergeScopeSets(teamLeaderSet, authority.filters.teamLeader);
    mergeScopeSets(agentSet, authority.filters.agent);
  }

  const canUseBot = authorityRole === "all";
  const canUseDashboard = authorityRole === "all" || authorityRole === "manager";
  const filters = buildFiltersFromSets(officeSet, deskSet, teamLeaderSet, agentSet);

  return {
    allowed: canUseBot || canUseDashboard,
    canUseBot,
    canUseDashboard,
    unrestricted: false,
    authorityRole,
    filters,
    matchedRows: matchedRows.length,
  };
}

export async function resolveAuthorityScopeForUser(telegramUser, options = {}) {
  const principals = telegramUserPrincipals(telegramUser);
  if (!principals.length) {
    return {
      allowed: false,
      canUseBot: false,
      canUseDashboard: false,
      unrestricted: false,
      authorityRole: "",
      filters: {},
      matchedRows: 0,
    };
  }
  // Configured admins always have ALL authority, independent of the Bot
  // Authority sheet (and even if that sheet cannot be read).
  if (isAdminTelegramUser(telegramUser)) {
    return {
      allowed: true,
      canUseBot: true,
      canUseDashboard: true,
      unrestricted: true,
      authorityRole: "admin",
      filters: {},
      matchedRows: 0,
      admin: true,
    };
  }
  const key = cacheKeyForPrincipals(principals);
  const cached = scopeCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  const spreadsheetId = options.spreadsheetId || process.env.BOT_AUTHORITY_SPREADSHEET_ID || AUTHORITY_SPREADSHEET_ID_FALLBACK;
  if (!spreadsheetId) {
    return {
      allowed: false,
      canUseBot: false,
      canUseDashboard: false,
      unrestricted: false,
      authorityRole: "",
      filters: {},
      matchedRows: 0,
    };
  }
  const readRows = options.readRows || readSheetRows;
  try {
    const rows = await readRows("botAuthority", {
      tabConfig: AUTHORITY_TAB_CONFIG,
      spreadsheetId,
    });
    const scope = computeAuthorityScopeFromRows(rows, telegramUser);
    scopeCache.set(key, { timestamp: Date.now(), value: scope });
    return scope;
  } catch {
    return {
      allowed: false,
      canUseBot: false,
      canUseDashboard: false,
      unrestricted: false,
      authorityRole: "",
      filters: {},
      matchedRows: 0,
    };
  }
}

export function clearAuthorityScopeCache() {
  scopeCache.clear();
}
