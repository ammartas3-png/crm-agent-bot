import { google } from "googleapis";

import {
  DEFAULT_GOOGLE_SERVICE_ACCOUNT_EMAIL,
  getTabConfig,
  sheetsConfig,
} from "../config/sheetsConfig.js";

const READ_ROWS_CACHE_TTL_MS = 2 * 60 * 1000;
const READ_ROWS_CACHE_MAX = 120;
const readRowsCache = new Map();
const readRowsInflight = new Map();
const sheetsClientIdMap = new WeakMap();
let nextSheetsClientId = 1;

const PRIVATE_KEY_ENV_NAMES = [
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_PRIVATE_KEY_BASE64",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_CREDENTIALS_JSON",
];

function cleanEnvValue(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function normalizePrivateKey(value) {
  const cleaned = cleanEnvValue(value);
  if (!cleaned) {
    return "";
  }
  return cleaned.replace(/\\n/g, "\n").trim();
}

function parseServiceAccountJson(value) {
  const cleaned = cleanEnvValue(value);
  if (!cleaned) {
    return {};
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      email: parsed.client_email || "",
      privateKey: normalizePrivateKey(parsed.private_key || ""),
    };
  } catch {
    return {};
  }
}

function getPrivateKeyFromBase64(value) {
  const cleaned = cleanEnvValue(value);
  if (!cleaned) {
    return "";
  }
  try {
    return normalizePrivateKey(Buffer.from(cleaned, "base64").toString("utf8"));
  } catch {
    return "";
  }
}

export function getGoogleCredentialConfig(env = process.env) {
  const serviceAccountJson = parseServiceAccountJson(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const credentialsJson = parseServiceAccountJson(env.GOOGLE_CREDENTIALS_JSON);
  const jsonCredentials = serviceAccountJson.privateKey ? serviceAccountJson : credentialsJson;
  const privateKey =
    normalizePrivateKey(env.GOOGLE_PRIVATE_KEY) ||
    normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) ||
    getPrivateKeyFromBase64(env.GOOGLE_PRIVATE_KEY_BASE64) ||
    jsonCredentials.privateKey ||
    "";
  const email =
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    jsonCredentials.email ||
    sheetsConfig.serviceAccountEmail ||
    DEFAULT_GOOGLE_SERVICE_ACCOUNT_EMAIL;

  let privateKeySource = "";
  if (normalizePrivateKey(env.GOOGLE_PRIVATE_KEY)) {
    privateKeySource = "GOOGLE_PRIVATE_KEY";
  } else if (normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)) {
    privateKeySource = "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY";
  } else if (getPrivateKeyFromBase64(env.GOOGLE_PRIVATE_KEY_BASE64)) {
    privateKeySource = "GOOGLE_PRIVATE_KEY_BASE64";
  } else if (jsonCredentials.privateKey) {
    privateKeySource = serviceAccountJson.privateKey
      ? "GOOGLE_SERVICE_ACCOUNT_JSON"
      : "GOOGLE_CREDENTIALS_JSON";
  }

  return {
    email,
    privateKey,
    privateKeySource,
    acceptedPrivateKeyEnvNames: PRIVATE_KEY_ENV_NAMES,
  };
}

export function getSheetsAuth() {
  const { email, privateKey, acceptedPrivateKeyEnvNames } = getGoogleCredentialConfig();

  if (!privateKey) {
    throw new Error(
      `Google Sheets credentials are not configured. Set one of: ${acceptedPrivateKeyEnvNames.join(", ")}.`,
    );
  }

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export function getSheetsClient(auth = getSheetsAuth()) {
  return google.sheets({ version: "v4", auth });
}

function pruneReadRowsCache() {
  if (readRowsCache.size <= READ_ROWS_CACHE_MAX) {
    return;
  }
  const oldest = [...readRowsCache.entries()].sort(
    (left, right) => Number(left[1]?.ts || 0) - Number(right[1]?.ts || 0),
  );
  while (readRowsCache.size > READ_ROWS_CACHE_MAX && oldest.length) {
    const [key] = oldest.shift();
    readRowsCache.delete(key);
  }
}

function readRowsCacheKeyWithClient(spreadsheetId, range, columns = [], clientId = "default") {
  return JSON.stringify({
    clientId: String(clientId || "default"),
    spreadsheetId: String(spreadsheetId || ""),
    range: String(range || ""),
    columns: Array.isArray(columns) ? columns : [],
  });
}

function cacheIdForSheetsClient(client) {
  if (!client || (typeof client !== "object" && typeof client !== "function")) {
    return "default";
  }
  if (!sheetsClientIdMap.has(client)) {
    sheetsClientIdMap.set(client, nextSheetsClientId++);
  }
  return String(sheetsClientIdMap.get(client));
}

export function clearReadSheetRowsCache() {
  readRowsCache.clear();
  readRowsInflight.clear();
}

function normalizeHeader(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US");
}

function parseNumberLike(value) {
  const cleaned = String(value ?? "")
    .replace(/^[']+/, "")
    .replace("%", "")
    .replace(",", ".")
    .trim();
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateLike(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number") {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
  }
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const dmyMatch = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countMatchesAtIndex(rows, index, matcher) {
  if (index < 0) {
    return 0;
  }
  return rows.reduce((count, row) => {
    return matcher(row[index]) ? count + 1 : count;
  }, 0);
}

function inferHeaderlessColumns(dataRows, expectedColumns = []) {
  const normalized = expectedColumns.map((column) => normalizeHeader(column));
  const departmentIndex = normalized.indexOf("department");
  const ftdIndex = normalized.indexOf("ftd");
  const crTargetIndex = normalized.indexOf("cr target");
  const ftdDateIndex = normalized.indexOf("ftd date");
  const leadDateIndex = normalized.indexOf("lead date");
  const createdIndex = normalized.indexOf("created");
  if (departmentIndex < 0 || ftdIndex <= 0 || createdIndex < 0) {
    return expectedColumns;
  }

  const sampleRows = dataRows.slice(0, 25);
  const numericOnExpectedFtd = countMatchesAtIndex(
    sampleRows,
    ftdIndex,
    (value) => parseNumberLike(value) !== null,
  );
  const numericOnShiftedFtd = countMatchesAtIndex(
    sampleRows,
    ftdIndex - 1,
    (value) => parseNumberLike(value) !== null,
  );
  const numericOnExpectedCrTarget =
    crTargetIndex >= 0
      ? countMatchesAtIndex(sampleRows, crTargetIndex, (value) => parseNumberLike(value) !== null)
      : 0;
  const numericOnShiftedCrTarget =
    crTargetIndex > 0
      ? countMatchesAtIndex(sampleRows, crTargetIndex - 1, (value) => parseNumberLike(value) !== null)
      : 0;
  const dateOnExpectedFtdDate =
    ftdDateIndex >= 0 ? countMatchesAtIndex(sampleRows, ftdDateIndex, (value) => parseDateLike(value) !== null) : 0;
  const dateOnShiftedFtdDate =
    ftdDateIndex > 0 ? countMatchesAtIndex(sampleRows, ftdDateIndex - 1, (value) => parseDateLike(value) !== null) : 0;
  const dateOnExpectedLeadDate =
    leadDateIndex >= 0
      ? countMatchesAtIndex(sampleRows, leadDateIndex, (value) => parseDateLike(value) !== null)
      : 0;
  const dateOnShiftedLeadDate =
    leadDateIndex > 0 ? countMatchesAtIndex(sampleRows, leadDateIndex - 1, (value) => parseDateLike(value) !== null) : 0;
  const dateOnExpectedCreated = countMatchesAtIndex(
    sampleRows,
    createdIndex,
    (value) => parseDateLike(value) !== null,
  );
  const dateOnShiftedCreated = countMatchesAtIndex(
    sampleRows,
    createdIndex - 1,
    (value) => parseDateLike(value) !== null,
  );
  const expectedShapeScore =
    numericOnExpectedFtd + numericOnExpectedCrTarget + dateOnExpectedFtdDate + dateOnExpectedLeadDate;
  const shiftedShapeScore =
    numericOnShiftedFtd + numericOnShiftedCrTarget + dateOnShiftedFtdDate + dateOnShiftedLeadDate;

  const looksShiftedWithoutDepartment =
    shiftedShapeScore >= expectedShapeScore + 1 &&
    shiftedShapeScore >= 1 &&
    dateOnExpectedCreated >= dateOnShiftedCreated;

  if (!looksShiftedWithoutDepartment) {
    return expectedColumns;
  }

  const adjusted = [];
  let removedDepartment = false;
  for (const column of expectedColumns) {
    if (!removedDepartment && normalizeHeader(column) === "department") {
      removedDepartment = true;
      continue;
    }
    adjusted.push(column);
  }
  return adjusted;
}

export function rowsToObjects(values = [], expectedColumns = []) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const headerRow = values[0] || [];
  const headers = headerRow.map((header) => String(header || "").trim());
  const expectedHeaderNames = new Set(
    expectedColumns
      .filter(Boolean)
      .map((header) => String(header).trim().toLocaleLowerCase("en-US")),
  );
  const headerMatchesConfig = headers.some((header) =>
    expectedHeaderNames.has(header.toLocaleLowerCase("en-US")),
  );
  const usableHeaders = headerMatchesConfig
    ? headers.map((header, index) => {
        const normalizedHeader = String(header || "").trim();
        if (normalizedHeader) {
          return normalizedHeader;
        }
        return String(expectedColumns[index] || "").trim();
      })
    : inferHeaderlessColumns(values, expectedColumns);
  const dataRows = headerMatchesConfig ? values.slice(1) : values;

  return dataRows.map((row) => {
    const item = {};
    usableHeaders.forEach((header, index) => {
      if (!header) {
        return;
      }
      item[header] = row[index] ?? "";
    });
    return item;
  });
}

export async function readSheetRows(tabKey, options = {}) {
  const tabConfig = options.tabConfig || getTabConfig(tabKey);
  const spreadsheetId =
    options.spreadsheetId || sheetsConfig.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured.");
  }

  const sheets = options.sheetsClient || getSheetsClient();
  const range = tabConfig.range || `'${String(tabConfig.name || "").trim().replace(/'/g, "''")}'!A:Y`;
  const cacheTtlMs = Number.isFinite(Number(options.cacheTtlMs))
    ? Math.max(0, Number(options.cacheTtlMs))
    : READ_ROWS_CACHE_TTL_MS;
  const bypassCache = Boolean(options.bypassCache) || cacheTtlMs === 0;
  const cacheClientId = options.sheetsClient ? cacheIdForSheetsClient(options.sheetsClient) : "default";
  const cacheKey = readRowsCacheKeyWithClient(spreadsheetId, range, tabConfig.columns || [], cacheClientId);
  if (!bypassCache) {
    const cached = readRowsCache.get(cacheKey);
    if (cached && Date.now() - Number(cached.ts || 0) < cacheTtlMs) {
      return cached.rows;
    }
    if (readRowsInflight.has(cacheKey)) {
      return readRowsInflight.get(cacheKey);
    }
  }

  const pending = sheets.spreadsheets.values
    .get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    })
    .then((response) => rowsToObjects(response.data.values || [], tabConfig.columns));

  if (!bypassCache) {
    readRowsInflight.set(cacheKey, pending);
  }
  const rows = await pending.finally(() => {
    if (!bypassCache && readRowsInflight.get(cacheKey) === pending) {
      readRowsInflight.delete(cacheKey);
    }
  });
  if (!bypassCache) {
    readRowsCache.set(cacheKey, { ts: Date.now(), rows });
    pruneReadRowsCache();
  }
  return rows;
}
