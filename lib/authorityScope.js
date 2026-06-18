import { getRowValue, normalizeText } from "./calculations.js";
import { readCachedJson, writeCachedJson } from "./dashboardRedisCache.js";
import { dashboardPerfLog, isGoogle429Error, safeCacheKeyPart } from "./dashboardPerf.js";
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
const PENDING_TOKENS = new Set([
  "pending",
  "awaiting",
  "waiting",
  "onay bekliyor",
  "beklemede",
  "sifir",
  "sıfır",
  "0",
  "zero",
  "no access",
  "yetki yok",
]);
const DENIED_TOKENS = new Set(["denied", "rejected", "reddedildi", "deny"]);
const CACHE_TTL_MS = (() => {
  const parsed = Number(process.env.AUTHORITY_SCOPE_CACHE_TTL_MS || 60 * 1000);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60 * 1000;
})();
const STATIC_CACHE_TTL_SECONDS = 30 * 60;
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
  let pending = false;
  let denied = false;
  let role = "";
  for (const token of parseList(authorityText)) {
    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
      continue;
    }
    if (ALL_TOKENS.has(normalizedToken) || ADMIN_TOKENS.has(normalizedToken)) {
      unrestricted = true;
      role = normalizedToken;
      continue;
    }
    if (PENDING_TOKENS.has(normalizedToken)) {
      pending = true;
      role = "pending";
      continue;
    }
    if (DENIED_TOKENS.has(normalizedToken)) {
      denied = true;
      role = "denied";
      continue;
    }
    if (
      ["crm", "manager", "managers", "desk manager", "deskmanager", "desk_manager", "team leader", "teamleader", "team_leader"].includes(
        normalizedToken,
      )
    ) {
      role = normalizedToken.replace("_", " ");
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
    pending,
    denied,
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
      pending: false,
      denied: false,
      filters: {},
      matchedRows: 0,
    };
  }
  // When multiple rows exist for the same user, latest row overrides older rows.
  const effectiveRows = [matchedRows[matchedRows.length - 1]];
  const officeSet = new Set();
  const deskSet = new Set();
  const teamLeaderSet = new Set();
  const agentSet = new Set();
  let unrestricted = false;
  let pending = false;
  let denied = false;
  let role = "";

  for (const row of effectiveRows) {
    const offices = parseList(getRowValue(row, "Office"));
    const desks = parseList(getRowValue(row, "Desk"));
    const teams = parseList(getRowValue(row, "Team"));
    const authority = parseAuthorityColumn(getRowValue(row, "Authority"));
    if (authority.unrestricted) {
      unrestricted = true;
    }
    if (authority.pending) {
      pending = true;
    }
    if (authority.denied) {
      denied = true;
    }
    if (authority.role) {
      role = authority.role;
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
    mergeScopeSets(teamLeaderSet, teams);
    mergeScopeSets(teamLeaderSet, authority.filters.teamLeader);
    mergeScopeSets(agentSet, authority.filters.agent);
  }

  if (unrestricted) {
    return {
      allowed: true,
      unrestricted: true,
      pending: false,
      denied: false,
      filters: {},
      matchedRows: matchedRows.length,
    };
  }

  if (pending) {
    return {
      allowed: false,
      unrestricted: false,
      pending: true,
      denied: false,
      filters: {},
      matchedRows: matchedRows.length,
    };
  }

  if (denied) {
    return {
      allowed: false,
      unrestricted: false,
      pending: false,
      denied: true,
      filters: {},
      matchedRows: matchedRows.length,
    };
  }

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
    const shouldApplyTeam =
      !role || ["manager", "desk manager", "deskmanager", "desk_manager", "team leader", "teamleader", "team_leader"].includes(role);
    if (shouldApplyTeam) {
      filters.teamLeader = [...teamLeaderSet].sort((left, right) => left.localeCompare(right));
    }
  }
  if (agentSet.size) {
    filters.agent = [...agentSet].sort((left, right) => left.localeCompare(right));
    filters.agentField = "agentNames";
  }

  return {
    allowed: true,
    unrestricted: false,
    pending: false,
    denied: false,
    filters,
    matchedRows: matchedRows.length,
  };
}

export async function resolveAuthorityScopeForUser(telegramUser, options = {}) {
  const principals = telegramUserPrincipals(telegramUser);
  if (!principals.length) {
    return { allowed: false, unrestricted: false, pending: false, denied: false, filters: {}, matchedRows: 0 };
  }
  if (isAdminTelegramUser(telegramUser)) {
    return { allowed: true, unrestricted: true, pending: false, denied: false, filters: {}, matchedRows: 0 };
  }
  const key = cacheKeyForPrincipals(principals);
  const cached = scopeCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  const spreadsheetId = options.spreadsheetId || process.env.BOT_AUTHORITY_SPREADSHEET_ID || AUTHORITY_SPREADSHEET_ID_FALLBACK;
  if (!spreadsheetId) {
    return { allowed: false, unrestricted: false, pending: false, denied: false, filters: {}, matchedRows: 0 };
  }
  const readRows = options.readRows || readSheetRows;
  try {
    const staticKey = `sheets:authority-users:${safeCacheKeyPart(spreadsheetId)}`;
    let rows = await readCachedJson(staticKey, {
      cacheScope: "sheet-static",
      cacheLabel: "authorityUsers",
    });
    if (!Array.isArray(rows)) {
      rows = await readRows("botAuthority", {
        tabConfig: AUTHORITY_TAB_CONFIG,
        spreadsheetId,
      });
      dashboardPerfLog("SHEET_NAME", { sheet: AUTHORITY_SHEET_NAME_FALLBACK });
      dashboardPerfLog("ROWS_LOADED", { sheet: AUTHORITY_SHEET_NAME_FALLBACK, rows: Array.isArray(rows) ? rows.length : 0 });
      await writeCachedJson(staticKey, rows, STATIC_CACHE_TTL_SECONDS, {
        cacheScope: "sheet-static",
        cacheLabel: "authorityUsers",
      });
    }
    const scope = computeAuthorityScopeFromRows(rows, telegramUser);
    scopeCache.set(key, { timestamp: Date.now(), value: scope });
    return scope;
  } catch (error) {
    if (isGoogle429Error(error)) {
      dashboardPerfLog("GOOGLE_SHEETS_429", { sheet: AUTHORITY_SHEET_NAME_FALLBACK });
    }
    return { allowed: false, unrestricted: false, pending: false, denied: false, filters: {}, matchedRows: 0 };
  }
}

export function clearAuthorityScopeCache() {
  scopeCache.clear();
}
