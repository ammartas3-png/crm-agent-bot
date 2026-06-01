import { getRowValue, normalizeText } from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import { normalizePrincipal, telegramUserPrincipals } from "./permissions.js";

const AUTHORITY_SPREADSHEET_ID_FALLBACK = "1mwnrhktfXR_E7R15-4uDDk4FG9euG27U5XhrbztsLBc";
const AUTHORITY_COLUMNS = [
  "User Name",
  "User Telegram",
  "User Telegram ID",
  "Office",
  "Desk",
  "Authority",
];
const AUTHORITY_TAB_CONFIG = {
  range: process.env.BOT_AUTHORITY_RANGE || "A:F",
  columns: AUTHORITY_COLUMNS,
};
const LIST_SEPARATOR_REGEX = /[,\n\r;|]+/;
const ALL_TOKENS = new Set(["all", "*", "any", "full", "hepsi", "tum", "tumu", "tümü"]);
const ADMIN_TOKENS = new Set(["admin", "owner", "superadmin"]);
const CACHE_TTL_MS = 60 * 1000;
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

function parseAuthorityColumn(authorityText = "") {
  const filters = {
    office: [],
    desk: [],
    teamLeader: [],
    agent: [],
  };
  let unrestricted = false;
  for (const token of parseList(authorityText)) {
    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
      continue;
    }
    if (ALL_TOKENS.has(normalizedToken) || ADMIN_TOKENS.has(normalizedToken)) {
      unrestricted = true;
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
    // Fallback: plain token in Authority is treated as Team Leader scope.
    filters.teamLeader.push(token);
  }
  return {
    unrestricted,
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

export function computeAuthorityScopeFromRows(rows = [], telegramUser) {
  const userPrincipals = telegramUserPrincipals(telegramUser);
  const matchedRows = rows.filter((row) => rowMatchesUser(row, userPrincipals));
  if (!matchedRows.length) {
    return {
      allowed: false,
      unrestricted: false,
      filters: {},
      matchedRows: 0,
    };
  }
  const officeSet = new Set();
  const deskSet = new Set();
  const teamLeaderSet = new Set();
  const agentSet = new Set();
  let unrestricted = false;

  for (const row of matchedRows) {
    const offices = parseList(getRowValue(row, "Office"));
    const desks = parseList(getRowValue(row, "Desk"));
    const authority = parseAuthorityColumn(getRowValue(row, "Authority"));
    if (authority.unrestricted) {
      unrestricted = true;
    }
    if (!offices.length && !desks.length && !authority.unrestricted) {
      const noExplicitAuthorityFilters =
        authority.filters.office.length === 0 &&
        authority.filters.desk.length === 0 &&
        authority.filters.teamLeader.length === 0 &&
        authority.filters.agent.length === 0;
      if (noExplicitAuthorityFilters) {
        unrestricted = true;
      }
    }
    mergeScopeSets(officeSet, offices);
    mergeScopeSets(deskSet, desks);
    mergeScopeSets(officeSet, authority.filters.office);
    mergeScopeSets(deskSet, authority.filters.desk);
    mergeScopeSets(teamLeaderSet, authority.filters.teamLeader);
    mergeScopeSets(agentSet, authority.filters.agent);
  }

  if (unrestricted) {
    return {
      allowed: true,
      unrestricted: true,
      filters: {},
      matchedRows: matchedRows.length,
    };
  }

  const filters = {};
  if (officeSet.size) {
    filters.office = [...officeSet].sort((left, right) => left.localeCompare(right));
  }
  if (deskSet.size) {
    filters.department = [...deskSet].sort((left, right) => left.localeCompare(right));
  }
  if (teamLeaderSet.size) {
    filters.teamLeader = [...teamLeaderSet].sort((left, right) => left.localeCompare(right));
  }
  if (agentSet.size) {
    filters.agent = [...agentSet].sort((left, right) => left.localeCompare(right));
    filters.agentField = "agentNames";
  }

  return {
    allowed: true,
    unrestricted: false,
    filters,
    matchedRows: matchedRows.length,
  };
}

export async function resolveAuthorityScopeForUser(telegramUser, options = {}) {
  const principals = telegramUserPrincipals(telegramUser);
  if (!principals.length) {
    return { allowed: false, unrestricted: false, filters: {}, matchedRows: 0 };
  }
  const key = cacheKeyForPrincipals(principals);
  const cached = scopeCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  const spreadsheetId = options.spreadsheetId || process.env.BOT_AUTHORITY_SPREADSHEET_ID || AUTHORITY_SPREADSHEET_ID_FALLBACK;
  if (!spreadsheetId) {
    return { allowed: false, unrestricted: false, filters: {}, matchedRows: 0 };
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
    return { allowed: false, unrestricted: false, filters: {}, matchedRows: 0 };
  }
}

export function clearAuthorityScopeCache() {
  scopeCache.clear();
}
