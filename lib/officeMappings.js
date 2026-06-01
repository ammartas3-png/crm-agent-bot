import { google } from "googleapis";

import { normalizeText } from "./calculations.js";
import { getGoogleCredentialConfig } from "./googleSheets.js";

const ACCESS_SPREADSHEET_ID_FALLBACK = "1mwnrhktfXR_E7R15-4uDDk4FG9euG27U5XhrbztsLBc";
const OFFICES_SHEET_NAME_FALLBACK = "Offices";
const CACHE_TTL_MS = 60 * 1000;

const PREFERRED_COUNTRIES = ["Turkey", "Pakistan", "Argentina", "United Arab Emirates"];
const MONTH_INDEX_BY_NAME = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const COUNTRY_MATCHERS = [
  { label: "Turkey", patterns: ["turkey", "turkiye", "türkiye"] },
  { label: "Pakistan", patterns: ["pakistan"] },
  { label: "Argentina", patterns: ["argentina", "aragantin"] },
  { label: "United Arab Emirates", patterns: ["united arab emirates", "uae", "emirates", "dubai"] },
];

let cache = null;

function spreadsheetId() {
  return process.env.BOT_AUTHORITY_SPREADSHEET_ID || ACCESS_SPREADSHEET_ID_FALLBACK;
}

function officesSheetName() {
  return process.env.BOT_OFFICES_SHEET_NAME || OFFICES_SHEET_NAME_FALLBACK;
}

function quoteSheetName(name) {
  return `'${String(name || "").trim().replace(/'/g, "''")}'`;
}

function normalizeSpreadsheetId(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return urlMatch ? urlMatch[1] : text;
}

function officeCountryFromName(office = "") {
  const normalizedOffice = normalizeText(office);
  if (!normalizedOffice) {
    return "";
  }
  const matched = COUNTRY_MATCHERS.find((entry) =>
    entry.patterns.some((pattern) => normalizedOffice.includes(pattern)),
  );
  return matched?.label || office;
}

function matcherPatternsForCountry(country = "") {
  const normalizedCountry = normalizeText(country);
  const matched = COUNTRY_MATCHERS.find((entry) => normalizeText(entry.label) === normalizedCountry);
  if (matched) {
    return [...matched.patterns];
  }
  return normalizedCountry ? [normalizedCountry] : [];
}

function parseMonthHeader(headerValue = "") {
  const text = String(headerValue || "").trim();
  if (!text) {
    return null;
  }
  const match = text.match(/^([A-Za-z]+)\s+(\d{2,4})$/);
  if (!match) {
    return null;
  }
  const monthIndex = MONTH_INDEX_BY_NAME[normalizeText(match[1])];
  if (!Number.isInteger(monthIndex)) {
    return null;
  }
  const rawYear = Number(match[2]);
  if (!Number.isInteger(rawYear)) {
    return null;
  }
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  return {
    key,
    month: monthIndex,
    year,
    month_label: `${MONTH_LABELS[monthIndex]} ${year}`,
  };
}

function officesSheetsClient() {
  const { email, privateKey, acceptedPrivateKeyEnvNames } = getGoogleCredentialConfig();
  if (!privateKey) {
    throw new Error(
      `Google Sheets credentials are not configured. Set one of: ${acceptedPrivateKeyEnvNames.join(", ")}.`,
    );
  }
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

function buildOfficeMonthMap(values = []) {
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) {
    return { countries: [], byCountry: {} };
  }
  const header = rows[0] || [];
  const monthColumns = header
    .map((cell, index) => ({ parsed: parseMonthHeader(cell), index }))
    .filter((item) => item.index > 0 && item.parsed);
  const byCountry = {};
  const officesByCountry = {};
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const officeName = String(row[0] || "").trim();
    if (!officeName) {
      continue;
    }
    const country = officeCountryFromName(officeName);
    if (!country) {
      continue;
    }
    if (!byCountry[country]) {
      byCountry[country] = new Map();
    }
    if (!officesByCountry[country]) {
      officesByCountry[country] = new Set();
    }
    officesByCountry[country].add(officeName);
    for (const { parsed, index } of monthColumns) {
      const id = normalizeSpreadsheetId(row[index]);
      if (!id) {
        continue;
      }
      if (!byCountry[country].has(parsed.key)) {
        byCountry[country].set(parsed.key, {
          ...parsed,
          sheet_id: id,
          active: true,
        });
      }
    }
  }
  const countries = [...new Set([...PREFERRED_COUNTRIES, ...Object.keys(byCountry)])];
  const byCountryArrays = {};
  const officesByCountryArrays = {};
  for (const country of Object.keys(byCountry)) {
    byCountryArrays[country] = [...byCountry[country].values()].sort((left, right) => right.key.localeCompare(left.key));
    officesByCountryArrays[country] = [...(officesByCountry[country] || new Set())].sort((left, right) =>
      left.localeCompare(right),
    );
  }
  return { countries, byCountry: byCountryArrays, officesByCountry: officesByCountryArrays };
}

async function loadOfficeMonthMap() {
  const sheets = officesSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${quoteSheetName(officesSheetName())}!A:Z`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return buildOfficeMonthMap(response.data.values || []);
}

export async function getOfficeMonthMap(options = {}) {
  const bypassCache = Boolean(options.bypassCache);
  if (!bypassCache && cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.value;
  }
  try {
    const value = await loadOfficeMonthMap();
    cache = { timestamp: Date.now(), value };
    return value;
  } catch {
    const fallback = {
      countries: [...PREFERRED_COUNTRIES],
      byCountry: {},
      officesByCountry: {},
    };
    cache = { timestamp: Date.now(), value: fallback };
    return fallback;
  }
}

export async function listOfficeCountries(options = {}) {
  const map = await getOfficeMonthMap(options);
  return map.countries || [];
}

export async function listOfficeMonthFiles(country, options = {}) {
  const map = await getOfficeMonthMap(options);
  return map.byCountry?.[country] || [];
}

export async function listOfficeNamesByCountry(country, options = {}) {
  const map = await getOfficeMonthMap(options);
  return map.officesByCountry?.[country] || [];
}

export function officeCountryPatterns(country = "") {
  return matcherPatternsForCountry(country);
}

export function clearOfficeMonthMapCache() {
  cache = null;
}

export { officeCountryFromName };
