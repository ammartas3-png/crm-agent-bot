import { google } from "googleapis";

import { getGoogleCredentialConfig } from "./googleSheets.js";

export const RULE_SPREADSHEET_ID = "1yUuJspdeCRkCzo_ps0zY3cEv08lJMWBt0UiIFyRfQTI";
export const RULE_SHEET_NAME = "Sheet2";

export const ALLOWED_STATUSES = [
  "In Progress",
  "No Answer 1-5",
  "No Answer 5 UP",
  "Call Again",
  "Potential",
  "Recall",
  "No Interest",
  "Decline",
  "Denied Registration",
  "No Language",
  "Under 18",
  "Wrong Number or Email",
  "Duplicate",
  "DNC",
  "Invalid Country",
];

const ALLOWED_STATUS_BY_KEY = new Map(
  ALLOWED_STATUSES.map((status) => [normalizeKey(status), status]),
);

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-US");
}

function parseBooleanCell(value) {
  const normalized = normalizeKey(value);
  if (!normalized) {
    return true;
  }
  if (["0", "false", "no", "inactive", "disabled"].includes(normalized)) {
    return false;
  }
  return true;
}

function parsePriority(value) {
  const number = Number(String(value ?? "").trim());
  return Number.isFinite(number) ? number : null;
}

function parseKeywordList(value) {
  return String(value || "")
    .split(/[\n,;|]/g)
    .map((item) => normalizeKey(item))
    .filter(Boolean);
}

function toKeywordCell(keywords) {
  return [...new Set(keywords.map(normalizeKey).filter(Boolean))].join(", ");
}

function detectColumns(headers = []) {
  const normalizedHeaders = headers.map((header) => normalizeKey(header));
  const indexByPattern = (patterns, fallback, options = {}) => {
    const index = normalizedHeaders.findIndex((header, idx) => {
      if (options.exclude?.includes(idx)) {
        return false;
      }
      return patterns.some((pattern) => header.includes(pattern));
    });
    return index >= 0 ? index : fallback;
  };

  const status = indexByPattern(["status"], 0);
  const negative = indexByPattern(["negative"], 2);
  const positive = indexByPattern(["positive", "keyword"], 1, { exclude: [negative] });
  const safePositiveFallback = (() => {
    const header1 = normalizedHeaders[1] || "";
    if (header1.includes("rule") && normalizedHeaders[2] && negative !== 2) {
      return 2;
    }
    return 1;
  })();

  return {
    status,
    positive:
      normalizedHeaders[positive]?.includes("negative") || positive === negative
        ? safePositiveFallback
        : positive,
    negative,
    priority: indexByPattern(["priority"], 3),
    active: indexByPattern(["active"], 4),
  };
}

function toColumnA1(index) {
  let value = index + 1;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

function canonicalStatusName(value) {
  const key = normalizeKey(value);
  return ALLOWED_STATUS_BY_KEY.get(key) || null;
}

function ruleFromRow(row = [], columns, rowNumber) {
  const status = canonicalStatusName(row[columns.status]);
  if (!status) {
    return null;
  }
  return {
    status,
    positiveKeywords: parseKeywordList(row[columns.positive]),
    negativeKeywords: parseKeywordList(row[columns.negative]),
    priority: parsePriority(row[columns.priority]),
    active: parseBooleanCell(row[columns.active]),
    rowNumber,
  };
}

function createWriteClient() {
  const { email, privateKey } = getGoogleCredentialConfig();
  if (!privateKey) {
    throw new Error("Google credentials are not configured for rule sheet updates.");
  }
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function readRuleSheet(options = {}) {
  const sheets = options.sheetsClient || createWriteClient();
  const spreadsheetId = options.spreadsheetId || RULE_SPREADSHEET_ID;
  const sheetName = options.sheetName || RULE_SHEET_NAME;
  const range = `'${sheetName}'!A:Z`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const values = response.data.values || [];
  const headers = values[0] || [];
  const columns = detectColumns(headers);
  const rules = values
    .slice(1)
    .map((row, index) => ruleFromRow(row, columns, index + 2))
    .filter(Boolean);
  return { rules, headers, columns, values, spreadsheetId, sheetName, sheets };
}

export async function listRulesFromSheet(options = {}) {
  const { rules } = await readRuleSheet(options);
  return rules;
}

export async function listActiveRules(options = {}) {
  const rules = await listRulesFromSheet(options);
  return rules.filter((rule) => rule.active);
}

export function formatRulesSummary(rules = []) {
  if (!rules.length) {
    return "No rules found in Sheet2.";
  }
  return [
    "Sheet2 Rules",
    ...rules.map(
      (rule) =>
        `- ${rule.status} [${rule.active ? "Active" : "Inactive"}] +(${rule.positiveKeywords.length}) -(${rule.negativeKeywords.length})`,
    ),
  ].join("\n");
}

async function upsertKeyword({ status, keyword, keywordType, action, options = {} }) {
  const canonicalStatus = canonicalStatusName(status);
  if (!canonicalStatus) {
    throw new Error(`Invalid status. Allowed statuses only.`);
  }
  const normalizedKeyword = normalizeKey(keyword);
  if (!normalizedKeyword) {
    throw new Error("Keyword is required.");
  }
  if (!["positive", "negative"].includes(keywordType)) {
    throw new Error("Unknown keyword type.");
  }
  if (!["add", "remove"].includes(action)) {
    throw new Error("Unknown keyword action.");
  }

  const context = await readRuleSheet(options);
  const { rules, columns, sheetName, spreadsheetId, sheets } = context;
  let targetRule = rules.find((rule) => rule.status === canonicalStatus);

  if (!targetRule && action === "remove") {
    return { status: canonicalStatus, changed: false, keywords: [] };
  }

  if (!targetRule && action === "add") {
    const appendValues = new Array(Math.max(columns.negative, columns.positive, columns.status) + 1).fill("");
    appendValues[columns.status] = canonicalStatus;
    appendValues[keywordType === "positive" ? columns.positive : columns.negative] = normalizedKeyword;
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetName}'!A:Z`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [appendValues] },
    });
    return { status: canonicalStatus, changed: true, keywords: [normalizedKeyword] };
  }

  const currentKeywords =
    keywordType === "positive"
      ? [...targetRule.positiveKeywords]
      : [...targetRule.negativeKeywords];
  let nextKeywords = currentKeywords;
  if (action === "add") {
    if (!currentKeywords.includes(normalizedKeyword)) {
      nextKeywords = [...currentKeywords, normalizedKeyword];
    }
  } else {
    nextKeywords = currentKeywords.filter((item) => item !== normalizedKeyword);
  }

  if (toKeywordCell(nextKeywords) === toKeywordCell(currentKeywords)) {
    return { status: canonicalStatus, changed: false, keywords: nextKeywords };
  }

  const columnIndex = keywordType === "positive" ? columns.positive : columns.negative;
  const range = `'${sheetName}'!${toColumnA1(columnIndex)}${targetRule.rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[toKeywordCell(nextKeywords)]],
    },
  });
  return { status: canonicalStatus, changed: true, keywords: nextKeywords };
}

export async function addPositiveKeyword(status, keyword, options = {}) {
  return upsertKeyword({ status, keyword, keywordType: "positive", action: "add", options });
}

export async function removePositiveKeyword(status, keyword, options = {}) {
  return upsertKeyword({ status, keyword, keywordType: "positive", action: "remove", options });
}

export async function addNegativeKeyword(status, keyword, options = {}) {
  return upsertKeyword({ status, keyword, keywordType: "negative", action: "add", options });
}

export async function removeNegativeKeyword(status, keyword, options = {}) {
  return upsertKeyword({ status, keyword, keywordType: "negative", action: "remove", options });
}
