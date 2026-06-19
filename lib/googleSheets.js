import { google } from "googleapis";

import {
  DEFAULT_GOOGLE_SERVICE_ACCOUNT_EMAIL,
  getTabConfig,
  sheetsConfig,
} from "../config/sheetsConfig.js";

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

// Reuse a single JWT auth client across invocations so we do not re-create it
// (and re-mint an OAuth access token) on every sheet read. The cached client is
// keyed by the credential signature so rotated credentials are picked up.
let cachedAuth = null;
let cachedAuthSignature = "";
let cachedSheetsClient = null;

export function getSheetsAuth() {
  const { email, privateKey, acceptedPrivateKeyEnvNames } = getGoogleCredentialConfig();

  if (!privateKey) {
    throw new Error(
      `Google Sheets credentials are not configured. Set one of: ${acceptedPrivateKeyEnvNames.join(", ")}.`,
    );
  }

  const signature = `${email}\u0000${privateKey}`;
  if (cachedAuth && cachedAuthSignature === signature) {
    return cachedAuth;
  }

  cachedAuth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  cachedAuthSignature = signature;
  cachedSheetsClient = null;
  return cachedAuth;
}

export function getSheetsClient(auth) {
  // Only memoize the client built from the shared cached auth. When a caller
  // injects its own auth (e.g. tests) we always return a fresh client.
  if (auth) {
    return google.sheets({ version: "v4", auth });
  }

  const resolvedAuth = getSheetsAuth();
  if (cachedSheetsClient) {
    return cachedSheetsClient;
  }
  cachedSheetsClient = google.sheets({ version: "v4", auth: resolvedAuth });
  return cachedSheetsClient;
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
  const usableHeaders = headerMatchesConfig ? headers : expectedColumns;
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

const DEFAULT_SHEETS_CACHE_TTL_MS = 30000;

// Short-lived in-memory cache of sheet rows. A single Telegram conversation
// triggers several full-sheet reads (report -> date -> breakdown), and each one
// is an expensive network round-trip. Caching by spreadsheetId + range collapses
// those repeated reads while keeping data fresh within the TTL.
const sheetRowsCache = new Map();
const inflightReads = new Map();

function getSheetsCacheTtlMs() {
  const raw = process.env.SHEETS_CACHE_TTL_MS;
  if (raw === undefined || raw === "") {
    return DEFAULT_SHEETS_CACHE_TTL_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SHEETS_CACHE_TTL_MS;
}

export function clearSheetsCache() {
  sheetRowsCache.clear();
  inflightReads.clear();
}

export async function readSheetRows(tabKey, options = {}) {
  const tabConfig = options.tabConfig || getTabConfig(tabKey);
  const spreadsheetId =
    options.spreadsheetId || sheetsConfig.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured.");
  }

  const range = tabConfig.range || `'${String(tabConfig.name || "").trim().replace(/'/g, "''")}'!A:Y`;

  // Callers that inject their own client (tests) or explicitly opt out skip the
  // cache so they always observe their own data source.
  const ttlMs = getSheetsCacheTtlMs();
  const useCache = !options.sheetsClient && options.cache !== false && ttlMs > 0;
  const cacheKey = `${spreadsheetId}\u0000${range}`;

  if (useCache) {
    const cached = sheetRowsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rows;
    }
    const pending = inflightReads.get(cacheKey);
    if (pending) {
      return pending;
    }
  }

  const fetchRows = async () => {
    const sheets = options.sheetsClient || getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    return rowsToObjects(response.data.values || [], tabConfig.columns);
  };

  if (!useCache) {
    return fetchRows();
  }

  const readPromise = fetchRows();
  inflightReads.set(cacheKey, readPromise);
  try {
    const rows = await readPromise;
    sheetRowsCache.set(cacheKey, { rows, expiresAt: Date.now() + ttlMs });
    return rows;
  } finally {
    inflightReads.delete(cacheKey);
  }
}
