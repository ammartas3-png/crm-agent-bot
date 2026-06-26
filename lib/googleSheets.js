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

const DEFAULT_SHEET_CACHE_TTL_MS = 60_000;
const sheetCache = new Map();

function getSheetCacheTtlMs(env = process.env) {
  const raw = Number(env.GOOGLE_SHEETS_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return DEFAULT_SHEET_CACHE_TTL_MS;
}

export function clearSheetCache() {
  sheetCache.clear();
}

export async function readSheetRows(tabKey, options = {}) {
  const tabConfig = options.tabConfig || getTabConfig(tabKey);
  const spreadsheetId =
    options.spreadsheetId || sheetsConfig.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured.");
  }

  const range = tabConfig.range || `'${String(tabConfig.name || "").trim().replace(/'/g, "''")}'!A:Y`;

  // The guided menu reads the whole sheet on every button press, so a short
  // in-memory TTL cache removes repeated Google Sheets round-trips. Callers can
  // opt out with `cache: false` (e.g. to force a fresh read).
  const useCache = options.cache !== false;
  const ttlMs = getSheetCacheTtlMs();
  const cacheKey = `${spreadsheetId}|${range}`;

  if (useCache && ttlMs > 0) {
    const cached = sheetCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttlMs) {
      return cached.rows;
    }
  }

  const sheets = options.sheetsClient || getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const rows = rowsToObjects(response.data.values || [], tabConfig.columns);

  if (useCache && ttlMs > 0) {
    sheetCache.set(cacheKey, { rows, timestamp: Date.now() });
  }

  return rows;
}
