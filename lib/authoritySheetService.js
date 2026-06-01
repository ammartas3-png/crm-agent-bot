import { google } from "googleapis";

import { normalizeText } from "./calculations.js";
import { getGoogleCredentialConfig } from "./googleSheets.js";
import { normalizePrincipal } from "./permissions.js";

const AUTHORITY_SPREADSHEET_ID_FALLBACK = "1mwnrhktfXR_E7R15-4uDDk4FG9euG27U5XhrbztsLBc";
const AUTHORITY_SHEET_NAME_FALLBACK = "Bot Authority";
const AUTHORITY_HEADERS = ["User Name", "User Telegram", "User Telegram ID", "Office", "Desk", "Team", "Authority"];

function authoritySpreadsheetId() {
  return process.env.BOT_AUTHORITY_SPREADSHEET_ID || AUTHORITY_SPREADSHEET_ID_FALLBACK;
}

function authoritySheetName() {
  return process.env.BOT_AUTHORITY_SHEET_NAME || AUTHORITY_SHEET_NAME_FALLBACK;
}

function quoteSheetName(name) {
  return `'${String(name || "").trim().replace(/'/g, "''")}'`;
}

function authorityRange(range = "A:G") {
  return `${quoteSheetName(authoritySheetName())}!${range}`;
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

function userNameForRow(user = {}) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (fullName) {
    return fullName;
  }
  return user.username ? `@${user.username}` : normalizeTelegramId(user.id);
}

function compactUnique(values = []) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function composeTeamCell(teams = []) {
  const normalized = compactUnique(teams);
  if (!normalized.length) {
    return "all";
  }
  return normalized.join(", ");
}

function composeAuthorityCell(role = "crm") {
  const normalized = normalizeText(role);
  if (!normalized) {
    return "CRM";
  }
  if (["all", "full", "admin", "owner", "superadmin"].includes(normalized)) {
    return "all";
  }
  if (normalized === "crm") {
    return "CRM";
  }
  if (normalized === "manager" || normalized === "managers") {
    return "Manager";
  }
  if (normalized === "desk manager" || normalized === "deskmanager" || normalized === "desk_manager") {
    return "Desk Manager";
  }
  if (["team leader", "team_leader", "teamleader"].includes(normalized)) {
    return "Team Leader";
  }
  return normalized;
}

function composeScopeCell(values = []) {
  const normalized = compactUnique(values);
  if (!normalized.length) {
    return "all";
  }
  return normalized.join(", ");
}

function authoritySheetsClient() {
  const { email, privateKey, acceptedPrivateKeyEnvNames } = getGoogleCredentialConfig();
  if (!privateKey) {
    throw new Error(
      `Google Sheets credentials are not configured. Set one of: ${acceptedPrivateKeyEnvNames.join(", ")}.`,
    );
  }
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function headerIndex(header = [], candidates = []) {
  const normalizedCandidates = new Set(candidates.map((item) => normalizeText(item)));
  return header.findIndex((cell) => normalizedCandidates.has(normalizeText(cell)));
}

function looksLikeAuthority(value = "") {
  const normalized = normalizeText(value);
  return (
    !!normalized &&
    (normalized === "all" ||
      normalized === "crm" ||
      normalized === "manager" ||
      normalized === "desk manager" ||
      normalized === "deskmanager" ||
      normalized === "team leader" ||
      normalized === "teamleader" ||
      normalized === "team_leader" ||
      normalized.startsWith("team leader:") ||
      normalized.startsWith("office:") ||
      normalized.startsWith("desk:"))
  );
}

function parseAuthorityRows(values = []) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  const header = (values[0] || []).map((item) => String(item || "").trim());
  const indexMap = {
    userName: headerIndex(header, ["User Name"]),
    telegramUsername: headerIndex(header, ["User Telegram"]),
    telegramId: headerIndex(header, ["User Telegram ID"]),
    office: headerIndex(header, ["Office"]),
    desk: headerIndex(header, ["Desk"]),
    team: headerIndex(header, ["Team"]),
    authority: headerIndex(header, ["Authority"]),
  };
  const rows = [];
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] || [];
    const getCell = (position, fallback = "") =>
      position >= 0 && Number.isFinite(position) ? String(row[position] || "").trim() : fallback;
    const userName = getCell(indexMap.userName, String(row[0] || "").trim());
    const telegramUsername = getCell(indexMap.telegramUsername, String(row[1] || "").trim());
    const telegramId = normalizeTelegramId(getCell(indexMap.telegramId, row[2] || ""));
    const office = getCell(indexMap.office, String(row[3] || "").trim());
    const desk = getCell(indexMap.desk, String(row[4] || "").trim());
    let team = getCell(indexMap.team, String(row[5] || "").trim());
    let authority = getCell(indexMap.authority, String(row[6] || "").trim());
    // Backward compatibility: old authority sheet schema had no Team column.
    if (indexMap.team < 0 && indexMap.authority >= 0) {
      authority = getCell(indexMap.authority, authority);
      team = "";
    } else if (indexMap.authority < 0 && indexMap.team >= 0) {
      authority = team;
      team = "";
    } else if (!authority && team && looksLikeAuthority(team)) {
      authority = team;
      team = "";
    }
    if (!userName && !telegramUsername && !telegramId) {
      continue;
    }
    rows.push({
      rowNumber: index + 1,
      userName,
      telegramUsername,
      telegramId,
      office,
      desk,
      team,
      authority,
    });
  }
  return rows;
}

function rowMatchesPrincipal(row, principal) {
  const normalized = normalizePrincipal(principal);
  if (!normalized) {
    return false;
  }
  const rowCandidates = [
    normalizePrincipal(row.telegramId),
    normalizePrincipal(row.telegramUsername),
    normalizePrincipal(row.userName),
  ].filter(Boolean);
  return rowCandidates.includes(normalized);
}

function rowMatchesTelegramUser(row, user = {}) {
  const idPrincipal = normalizePrincipal(normalizeTelegramId(user.id));
  const usernamePrincipal = normalizePrincipal(user.username);
  const rowId = normalizePrincipal(row.telegramId);
  const rowUsername = normalizePrincipal(row.telegramUsername);
  return (idPrincipal && rowId === idPrincipal) || (usernamePrincipal && rowUsername === usernamePrincipal);
}

export async function readAuthorityRows() {
  const spreadsheetId = authoritySpreadsheetId();
  const sheets = authoritySheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: authorityRange("A:G"),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return parseAuthorityRows(response.data.values || []);
}

export async function upsertAuthorityUserScope({
  user,
  offices = [],
  desks = [],
  teams = [],
  authorityRole = "crm",
} = {}) {
  const spreadsheetId = authoritySpreadsheetId();
  const sheets = authoritySheetsClient();
  const existingRows = await readAuthorityRows();
  const existing = existingRows.find((row) => rowMatchesTelegramUser(row, user));
  const rowValues = [
    userNameForRow(user),
    user?.username ? `@${user.username}` : "",
    normalizeTelegramId(user?.id),
    composeScopeCell(offices),
    composeScopeCell(desks),
    composeTeamCell(teams),
    composeAuthorityCell(authorityRole),
  ];

  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: authorityRange(`A${existing.rowNumber}:G${existing.rowNumber}`),
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [rowValues],
      },
    });
    return { mode: "update", rowNumber: existing.rowNumber };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: authorityRange("A:G"),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowValues],
    },
  });
  return { mode: "append" };
}

export async function removeAuthorityRowByNumber(rowNumber) {
  const numeric = Number(rowNumber);
  if (!Number.isFinite(numeric) || numeric < 2) {
    return { removed: false };
  }
  const spreadsheetId = authoritySpreadsheetId();
  const sheets = authoritySheetsClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: authorityRange(`A${numeric}:G${numeric}`),
  });
  return { removed: true, rowNumber: numeric };
}

export async function removeAuthorityUserByPrincipal(principal) {
  const rows = await readAuthorityRows();
  const matched = rows.filter((row) => rowMatchesPrincipal(row, principal));
  if (!matched.length) {
    return { removed: false, removedRows: [] };
  }
  const removedRows = [];
  for (const row of matched) {
    const removed = await removeAuthorityRowByNumber(row.rowNumber);
    if (removed.removed) {
      removedRows.push(row);
    }
  }
  return { removed: removedRows.length > 0, removedRows };
}

export function summarizeAuthorityRow(row = {}) {
  const idPart = row.telegramId ? `ID ${row.telegramId}` : "";
  const usernamePart = row.telegramUsername || "";
  const label = [usernamePart, idPart].filter(Boolean).join(" | ");
  const scope = [
    `Office: ${row.office || "all"}`,
    `Desk: ${row.desk || "all"}`,
    `Team: ${row.team || "all"}`,
    `Authority: ${row.authority || "all"}`,
  ];
  return `${label || row.userName || "Unknown"}\n${scope.join(" | ")}`;
}

export function authorityRowDisplayLabel(row = {}) {
  const username = row.telegramUsername || "";
  const id = row.telegramId || "";
  const scope = [];
  if (row.office && normalizeText(row.office) !== "all") {
    scope.push(`O:${row.office}`);
  }
  if (row.desk && normalizeText(row.desk) !== "all") {
    scope.push(`D:${row.desk}`);
  }
  if (row.team && normalizeText(row.team) !== "all") {
    scope.push(`T:${row.team}`);
  }
  const identity = [username, id ? `#${id}` : ""].filter(Boolean).join(" ");
  const scopeText = scope.length ? ` (${scope.join(" | ")})` : "";
  return `${identity || row.userName || "Unknown"}${scopeText}`.slice(0, 64);
}

export function ensureAuthorityHeader(values = []) {
  if (!Array.isArray(values) || !values.length) {
    return [AUTHORITY_HEADERS];
  }
  const header = (values[0] || []).map((cell) => String(cell || "").trim());
  const isExpected = AUTHORITY_HEADERS.every((item, index) => normalizeText(header[index]) === normalizeText(item));
  if (isExpected) {
    return values;
  }
  return [AUTHORITY_HEADERS, ...values.slice(1)];
}
