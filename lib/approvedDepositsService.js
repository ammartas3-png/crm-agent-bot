import { readSheetValues, getSheetTitles } from "./googleSheets.js";
import { normalizeText } from "./calculations.js";
import { categorizeKycLanguages, parseKycLanguage, parseKycLanguageParts } from "./kycTextParser.js";

export const APPROVED_DEPOSITS_KYC_SPREADSHEET_ID =
  process.env.APPROVED_DEPOSITS_SPREADSHEET_ID || "1aODXtjBqEEqfee8W0mpqRZ2SOv3r3Yv4fbDlk1tYSVw";
export const APPROVED_DEPOSITS_AMOUNT_SPREADSHEET_ID =
  process.env.APPROVED_DEPOSITS_AMOUNT_SPREADSHEET_ID || "1iv63qIOhoWnFbs9xXkdWi87Sna_BnjHCD3t8w0LqLU8";

export const DEFAULT_APPROVED_DEPOSITS_KYC_SOURCES = [
  { office: "Tunisia", spreadsheetId: "1k_IIL2iUQPdUfs0yClfwYIHCAQxyWVlLPfqc8rznRkg" },
  { office: "Argentina", spreadsheetId: "1U6CfkXB0LSkEHbGgzn8eIFv20JTOh0gstRZqA018OkU" },
  { office: "Dubai", spreadsheetId: "1OXhk7XLh-qqWgib1yblfiVmKvWPKM13sVk8joILJGHI" },
  { office: "Pakistan", spreadsheetId: "1rbsNu97EXCxfs4uqUvM5-hmv_I7KwJs2AEBjQsMGGtU" },
  { office: "Turkiye", spreadsheetId: "1aODXtjBqEEqfee8W0mpqRZ2SOv3r3Yv4fbDlk1tYSVw" },
];

const MONTHS = [
  { key: "january", title: "JANUARY", label: "Jan" },
  { key: "february", title: "FEBRUARY", label: "Feb" },
  { key: "march", title: "MARCH", label: "Mar" },
  { key: "april", title: "APRIL", label: "Apr" },
  { key: "may", title: "MAY", label: "May" },
  { key: "june", title: "JUNE", label: "Jun" },
  { key: "july", title: "JULY", label: "Jul" },
];
const MONTH_BY_NORMALIZED_TITLE = new Map(MONTHS.map((month, index) => [normalizeText(month.title), { ...month, index }]));
const CATEGORY_KEYS = ["Native", "English", "English & Native", "Other"];
const DEFAULT_COUNTRIES = ["Bangladesh", "India", "Indonesia", "Philippines", "Thailand", "Vietnam"];
const AMOUNT_FILTER_KEYS = ["status", "brand", "campaign", "method", "cashier", "department", "ftd"];
const KYC_COUNTRY_HEADER_ALIASES = [
  "listofcounrtys",
  "listofcountrys",
  "listofcountries",
  "listofcountry",
  "listofcounrty",
  "listofcountrie",
  "counrtys",
  "countrys",
  "countries",
  "country",
];
const AMOUNT_COLUMN_ALIASES = {
  accId: ["accid", "accountid", "id", "cid"],
  department: ["originaldepartment", "departmentoffice", "department", "office"],
  status: ["status"],
  amount: ["usdamount", "amount", "depositamount"],
  cashier: ["cashier"],
  method: ["method"],
  clearedBy: ["clearedby"],
  created: ["created"],
  ftd: ["ftd"],
  country: ["country"],
  campaign: ["campaign"],
  approved: ["approved", "approveddate"],
  brand: ["brand"],
};

function titleCase(value = "") {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function normalizeHeader(value = "") {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function isKycCountryHeader(header = "") {
  if (!header) {
    return false;
  }
  if (KYC_COUNTRY_HEADER_ALIASES.includes(header)) {
    return true;
  }
  // Tolerate common misspellings such as "COUNRTYS" (R/T swapped) by
  // treating any "list of ..." header that mentions a country-like token.
  return header.startsWith("listof") && /co(?:un|nu)r?t?r?y?s?$/.test(header);
}

function isMonthTab(title = "") {
  const normalized = normalizeText(title);
  return !normalized.includes("self") && MONTH_BY_NORMALIZED_TITLE.has(normalized);
}

function tabMeta(title = "") {
  const normalized = normalizeText(title);
  const month = MONTH_BY_NORMALIZED_TITLE.get(normalized);
  return month ? { ...month, title: String(title || month.title).trim() } : null;
}

function quotedSheetName(sheetName = "") {
  return `'${String(sheetName || "").trim().replace(/'/g, "''")}'`;
}

function findHeaderRow(values = []) {
  for (let index = 0; index < Math.min(values.length, 12); index += 1) {
    const normalized = (values[index] || []).map(normalizeHeader);
    const hasKyc = normalized.includes("kyc");
    const hasCid = normalized.includes("cid") || normalized.includes("customerid");
    const hasCountry = normalized.some((header) => isKycCountryHeader(header));
    if (hasKyc && (hasCid || hasCountry)) {
      return index;
    }
  }
  return -1;
}

function findAmountHeaderRow(values = []) {
  for (let index = 0; index < Math.min(values.length, 12); index += 1) {
    const normalized = (values[index] || []).map(normalizeHeader);
    const hasAccId = normalized.includes("accid") || normalized.includes("accountid");
    const hasAmount = normalized.includes("usdamount") || normalized.includes("amount");
    const hasApproved = normalized.includes("approved");
    if (hasAccId && hasAmount && hasApproved) {
      return index;
    }
  }
  return -1;
}

function headerMapFromRow(row = []) {
  const output = new Map();
  row.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !output.has(key)) {
      output.set(key, index);
    }
  });
  return output;
}

function valueAt(row = [], headerMap, aliases = []) {
  for (const alias of aliases) {
    const index = headerMap.get(alias);
    if (Number.isInteger(index)) {
      return row[index] ?? "";
    }
  }
  return "";
}

export function normalizeApprovedDepositAccId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const upper = raw.toLocaleUpperCase("en-US");
  const accMatch = upper.match(/ACC\D*(\d+)/);
  if (accMatch) {
    return `ACC${accMatch[1]}`;
  }
  const digits = upper.replace(/[^\d]/g, "");
  return digits ? `ACC${digits}` : "";
}

export function normalizeApprovedDepositCountry(value = "") {
  return titleCase(value) || "Unknown";
}

export function kycLanguageLookupKey(accId = "", country = "") {
  const normalizedAccId = normalizeApprovedDepositAccId(accId);
  const normalizedCountry = normalizeText(normalizeApprovedDepositCountry(country));
  if (!normalizedAccId) {
    return "";
  }
  return `${normalizedAccId}|${normalizedCountry || "unknown"}`;
}

export function createKycLanguageIndex() {
  return {
    byOffice: new Map(),
  };
}

function getOfficeLanguageIndex(index, office = "") {
  const officeKey = String(office || "").trim();
  if (!officeKey) {
    return createOfficeLanguageIndex();
  }
  if (!index.byOffice.has(officeKey)) {
    index.byOffice.set(officeKey, createOfficeLanguageIndex());
  }
  return index.byOffice.get(officeKey);
}

function createOfficeLanguageIndex() {
  return {
    byAccIdAndCountry: new Map(),
    byAccId: new Map(),
  };
}

function lookupInOfficeLanguageIndex(officeIndex, { accId = "", country = "" } = {}) {
  const normalizedAccId = normalizeApprovedDepositAccId(accId);
  if (!normalizedAccId) {
    return null;
  }
  const normalizedCountry = normalizeApprovedDepositCountry(country);
  const exact = officeIndex.byAccIdAndCountry.get(kycLanguageLookupKey(normalizedAccId, normalizedCountry));
  if (exact) {
    return exact;
  }
  const candidates = officeIndex.byAccId.get(normalizedAccId) || [];
  if (candidates.length === 1) {
    return candidates[0];
  }
  return null;
}

export function addKycLanguageRecord(index, record = {}) {
  const office = String(record.office || "").trim();
  if (!office || !record.cid || !record.language) {
    return;
  }
  const country = normalizeApprovedDepositCountry(record.country);
  const key = kycLanguageLookupKey(record.cid, country);
  const normalizedRecord = {
    ...record,
    cid: normalizeApprovedDepositAccId(record.cid),
    country,
    office,
    languages: Array.isArray(record.languages) ? record.languages : parseKycLanguageParts(record.language),
    language: record.language || (Array.isArray(record.languages) ? record.languages.join(" & ") : ""),
  };
  const officeIndex = getOfficeLanguageIndex(index, office);
  if (!officeIndex.byAccIdAndCountry.has(key)) {
    officeIndex.byAccIdAndCountry.set(key, normalizedRecord);
  }
  const accId = normalizedRecord.cid;
  const candidates = officeIndex.byAccId.get(accId) || [];
  if (!candidates.some((item) => kycLanguageLookupKey(item.cid, item.country) === key)) {
    candidates.push(normalizedRecord);
    officeIndex.byAccId.set(accId, candidates);
  }
}

export function lookupKycLanguageRecord(index, { accId = "", country = "", office = "", offices = [] } = {}) {
  const normalizedAccId = normalizeApprovedDepositAccId(accId);
  if (!normalizedAccId) {
    return null;
  }
  const normalizedCountry = normalizeApprovedDepositCountry(country);
  const officeList = [
    ...new Set(
      [
        ...String(office || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        ...(Array.isArray(offices) ? offices : []),
      ].filter(Boolean),
    ),
  ];

  if (officeList.length === 1) {
    const match = lookupInOfficeLanguageIndex(getOfficeLanguageIndex(index, officeList[0]), {
      accId: normalizedAccId,
      country: normalizedCountry,
    });
    return match ? { ...match, office: officeList[0] } : null;
  }

  const searchableOffices = officeList.length
    ? officeList
    : [...index.byOffice.keys()];
  const matches = [];
  for (const officeName of searchableOffices) {
    const match = lookupInOfficeLanguageIndex(getOfficeLanguageIndex(index, officeName), {
      accId: normalizedAccId,
      country: normalizedCountry,
    });
    if (match) {
      matches.push({ ...match, office: officeName });
    }
  }
  if (matches.length === 1) {
    return matches[0];
  }
  return null;
}

export function resolveApprovedDepositsKycSources(options = {}) {
  if (Array.isArray(options.kycSources) && options.kycSources.length) {
    return options.kycSources
      .map((source) => ({
        office: String(source?.office || source?.name || "KYC").trim() || "KYC",
        spreadsheetId: String(source?.spreadsheetId || source?.id || "").trim(),
      }))
      .filter((source) => source.spreadsheetId);
  }
  const envList = String(process.env.APPROVED_DEPOSITS_KYC_SPREADSHEET_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (envList.length) {
    return envList.map((spreadsheetId, index) => ({
      office: `KYC ${index + 1}`,
      spreadsheetId,
    }));
  }
  if (options.kycSpreadsheetId || options.spreadsheetId) {
    return [
      {
        office: "KYC",
        spreadsheetId: options.kycSpreadsheetId || options.spreadsheetId,
      },
    ];
  }
  return DEFAULT_APPROVED_DEPOSITS_KYC_SOURCES;
}

function parseAmountCell(value = "") {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  let text = String(value || "")
    .replace(/\s+/g, "")
    .replace(/^[^\d-]+/, "")
    .replace(/[^\d.,-]+$/g, "");
  if (!text) {
    return 0;
  }
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    text = text.replace(new RegExp(`\\${thousandSeparator}`, "g"), "");
    text = text.replace(decimalSeparator, ".");
  } else if (lastComma > -1) {
    const parts = text.split(",");
    const decimals = parts[parts.length - 1] || "";
    text = decimals.length === 2 ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else {
    const parts = text.split(".");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)) {
      text = text.replace(/\./g, "");
    }
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateParts(value = "", fallbackMonthIndex = 0, fallbackYear = new Date().getUTCFullYear()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      iso: value.toISOString().slice(0, 10),
      year: value.getUTCFullYear(),
      monthIndex: value.getUTCMonth(),
    };
  }
  const text = String(value || "").trim();
  const slashDate = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (slashDate) {
    const [, first, second, year] = slashDate;
    const firstNumber = Number(first);
    const secondNumber = Number(second);
    const isMonthDayYear = secondNumber > 12 || (firstNumber <= 12 && secondNumber <= 31);
    const month = isMonthDayYear ? firstNumber : secondNumber;
    const day = isMonthDayYear ? secondNumber : firstNumber;
    const date = new Date(Date.UTC(Number(year), month - 1, day));
    return {
      iso: date.toISOString().slice(0, 10),
      year: Number(year),
      monthIndex: month - 1,
    };
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      iso: parsed.toISOString().slice(0, 10),
      year: parsed.getUTCFullYear(),
      monthIndex: parsed.getUTCMonth(),
    };
  }
  return {
    iso: "",
    year: fallbackYear,
    monthIndex: fallbackMonthIndex,
  };
}

function monthLabel(meta, year) {
  return `${meta.label} ${year}`;
}

function emptyCategoryStats() {
  return Object.fromEntries(
    CATEGORY_KEYS.map((category) => [
      category,
      {
        amount: 0,
        count: 0,
        share: 0,
      },
    ]),
  );
}

function aggregateRows(rows = []) {
  const countryMap = new Map();
  const monthMap = new Map();
  const totals = emptyCategoryStats();
  let totalAmount = 0;
  let totalCount = 0;

  function ensureCountry(country) {
    if (!countryMap.has(country)) {
      countryMap.set(country, {
        country,
        total: emptyCategoryStats(),
        months: {},
      });
    }
    return countryMap.get(country);
  }

  function ensureMonth(monthKey, month) {
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        ...month,
        total: emptyCategoryStats(),
      });
    }
    return monthMap.get(monthKey);
  }

  for (const row of rows) {
    const category = CATEGORY_KEYS.includes(row.languageCategory) ? row.languageCategory : "Other";
    const amount = Number(row.amount || 0);
    const countryBucket = ensureCountry(row.country);
    const monthBucket = ensureMonth(row.monthKey, row.month);
    countryBucket.months[row.monthKey] ||= emptyCategoryStats();

    for (const bucket of [countryBucket.total, countryBucket.months[row.monthKey], monthBucket.total, totals]) {
      bucket[category].amount += amount;
      bucket[category].count += 1;
    }
    totalAmount += amount;
    totalCount += 1;
  }

  const applyShares = (bucket) => {
    const sum = CATEGORY_KEYS.reduce((acc, category) => acc + Number(bucket?.[category]?.amount || 0), 0);
    for (const category of CATEGORY_KEYS) {
      bucket[category].share = sum > 0 ? (Number(bucket[category].amount || 0) / sum) * 100 : 0;
    }
    return bucket;
  };

  for (const category of CATEGORY_KEYS) {
    totals[category].share = totalAmount > 0 ? (Number(totals[category].amount || 0) / totalAmount) * 100 : 0;
  }
  for (const country of countryMap.values()) {
    applyShares(country.total);
    for (const monthStats of Object.values(country.months)) {
      applyShares(monthStats);
    }
  }
  for (const month of monthMap.values()) {
    applyShares(month.total);
  }

  const countries = [...countryMap.values()].sort((left, right) => {
    const leftTotal = CATEGORY_KEYS.reduce((sum, category) => sum + Number(left.total[category].amount || 0), 0);
    const rightTotal = CATEGORY_KEYS.reduce((sum, category) => sum + Number(right.total[category].amount || 0), 0);
    if (rightTotal !== leftTotal) {
      return rightTotal - leftTotal;
    }
    return left.country.localeCompare(right.country);
  });

  return {
    totalAmount,
    totalCount,
    totals,
    countries,
    months: [...monthMap.values()].sort((left, right) => right.index - left.index),
  };
}

function rowCountry(row = [], headerMap) {
  let value = valueAt(row, headerMap, KYC_COUNTRY_HEADER_ALIASES);
  if (!String(value || "").trim()) {
    for (const [header, index] of headerMap.entries()) {
      if (isKycCountryHeader(header)) {
        value = row[index] ?? "";
        if (String(value || "").trim()) {
          break;
        }
      }
    }
  }
  return normalizeApprovedDepositCountry(value);
}

function kycLanguageRecord(row = [], headerMap, office = "") {
  const country = rowCountry(row, headerMap);
  const kycText = String(valueAt(row, headerMap, ["kyc"]) || "");
  const languages = parseKycLanguageParts(kycText);
  const language = languages.join(" & ");
  const cid =
    normalizeApprovedDepositAccId(valueAt(row, headerMap, ["cid", "customerid", "id"])) ||
    normalizeApprovedDepositAccId(kycText);
  return {
    cid,
    country,
    language,
    languages,
    office,
  };
}

function amountRecord(row = [], headerMap, languageIndex = createKycLanguageIndex(), officeScope = []) {
  const approvedValue = valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.approved);
  const dateParts = parseDateParts(approvedValue, new Date().getUTCMonth(), new Date().getUTCFullYear());
  const monthMeta = MONTHS[dateParts.monthIndex] || {
    key: String(dateParts.monthIndex + 1),
    label: String(dateParts.monthIndex + 1).padStart(2, "0"),
  };
  const month = {
    key: `${dateParts.year}-${String(dateParts.monthIndex + 1).padStart(2, "0")}`,
    label: monthLabel(monthMeta, dateParts.year),
    index: dateParts.monthIndex,
    tabTitle: "",
  };
  const accId = normalizeApprovedDepositAccId(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.accId));
  const country = normalizeApprovedDepositCountry(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.country));
  const kycMatch = lookupKycLanguageRecord(languageIndex, { accId, country, offices: officeScope });
  const languages = kycMatch?.languages?.length ? kycMatch.languages : parseKycLanguageParts(kycMatch?.language || "");
  const language = languages.join(" & ") || kycMatch?.language || "";
  return {
    cid: accId,
    accId,
    kycOffice: kycMatch?.office || "",
    approvedAt: String(approvedValue || "").trim(),
    approvedDate: dateParts.iso,
    createdAt: String(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.created) || "").trim(),
    department: String(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.department) || "").trim(),
    status: String(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.status) || "").trim(),
    country,
    campaign: String(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.campaign) || "").trim(),
    brand: String(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.brand) || "").trim(),
    cashier: String(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.cashier) || "").trim(),
    method: String(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.method) || "").trim(),
    clearedBy: String(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.clearedBy) || "").trim(),
    ftd: String(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.ftd) || "").trim(),
    amount: parseAmountCell(valueAt(row, headerMap, AMOUNT_COLUMN_ALIASES.amount)),
    language: language || "Unknown",
    languages,
    languageCategory: categorizeKycLanguages({ country, languages }),
    month,
    monthKey: month.key,
  };
}

function applyFilters(rows = [], filters = {}) {
  const selectedValues = (key) =>
    String(filters[key] || "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item && item !== "All");
  const matchesSelection = (key, value) => {
    const selected = selectedValues(key);
    return selected.length === 0 || selected.includes(String(value || ""));
  };
  return rows.filter((row) => {
    if (!matchesSelection("language", row.languageCategory)) {
      return false;
    }
    if (!matchesSelection("country", row.country)) {
      return false;
    }
    if (!matchesSelection("month", row.monthKey)) {
      return false;
    }
    if (!matchesSelection("office", row.kycOffice)) {
      return false;
    }
    for (const key of AMOUNT_FILTER_KEYS) {
      if (!matchesSelection(key, row[key])) {
        return false;
      }
    }
    return true;
  });
}

export function validApprovedDepositTabTitles(titles = []) {
  return titles.filter(isMonthTab).sort((left, right) => {
    const leftMeta = tabMeta(left);
    const rightMeta = tabMeta(right);
    return Number(leftMeta?.index || 0) - Number(rightMeta?.index || 0);
  });
}

function amountTabTitles(titles = []) {
  const allTab = titles.find((title) => normalizeText(title) === "all");
  if (allTab) {
    return [allTab];
  }
  return titles.filter((title) => !normalizeText(title).includes("self"));
}

function uniqueOptions(rows = [], key = "") {
  return [
    "All",
    ...[...new Set(rows.map((row) => String(row?.[key] || "").trim()).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right),
    ),
  ];
}

async function loadAllKycLanguageMaps({ kycSources = [], readValues, getTitles } = {}) {
  const languageIndex = createKycLanguageIndex();
  const sourceTabs = [];
  const skippedTabs = [];
  const kycOfficeSources = [];

  for (const source of kycSources) {
    const sheetTitles = await getTitles(source.spreadsheetId);
    const officeSource = await loadKycLanguageMap({
      office: source.office,
      spreadsheetId: source.spreadsheetId,
      readValues,
      sheetTitles,
    });
    kycOfficeSources.push({
      office: source.office,
      spreadsheetId: source.spreadsheetId,
      sourceTabs: officeSource.sourceTabs,
      skippedTabs: officeSource.skippedTabs,
      matchedCount: officeSource.matchedCount,
    });
    sourceTabs.push(...officeSource.sourceTabs.map((title) => `${source.office}:${title}`));
    skippedTabs.push(...officeSource.skippedTabs.map((title) => `${source.office}:${title}`));
    for (const record of officeSource.records) {
      addKycLanguageRecord(languageIndex, { ...record, office: source.office });
    }
  }

  return {
    languageIndex,
    sourceTabs,
    skippedTabs,
    kycOfficeSources,
  };
}

async function loadKycLanguageMap({ office = "", spreadsheetId, readValues, sheetTitles } = {}) {
  const validTabs = validApprovedDepositTabTitles(sheetTitles || []);
  const records = [];
  const skippedTabs = (sheetTitles || []).filter((title) => !validTabs.includes(title));

  for (const title of validTabs) {
    const values = await readValues(spreadsheetId, `${quotedSheetName(title)}!A:L`, { bypassCache: true });
    const headerRowIndex = findHeaderRow(values);
    if (headerRowIndex < 0) {
      skippedTabs.push(title);
      continue;
    }
    const headerMap = headerMapFromRow(values[headerRowIndex]);
    for (const row of values.slice(headerRowIndex + 1)) {
      const record = kycLanguageRecord(row, headerMap, office);
      if (record.cid && record.language) {
        records.push(record);
      }
    }
  }

  return {
    records,
    matchedCount: records.length,
    sourceTabs: validTabs,
    skippedTabs,
  };
}

async function loadAmountRows({ spreadsheetId, readValues, sheetTitles, languageIndex, officeScope = [] } = {}) {
  const sourceTabs = amountTabTitles(sheetTitles || []);
  const skippedTabs = (sheetTitles || []).filter((title) => !sourceTabs.includes(title));
  const rows = [];

  for (const title of sourceTabs) {
    const values = await readValues(spreadsheetId, `${quotedSheetName(title)}!A:Z`, { bypassCache: true });
    const headerRowIndex = findAmountHeaderRow(values);
    if (headerRowIndex < 0) {
      skippedTabs.push(title);
      continue;
    }
    const headerMap = headerMapFromRow(values[headerRowIndex]);
    for (const row of values.slice(headerRowIndex + 1)) {
      const record = amountRecord(row, headerMap, languageIndex, officeScope);
      if (!record.accId && !record.amount && !record.country) {
        continue;
      }
      rows.push(record);
    }
  }

  return {
    rows,
    sourceTabs,
    skippedTabs,
  };
}

export async function loadApprovedDepositsReport(query = {}, options = {}) {
  const kycSources = resolveApprovedDepositsKycSources(options);
  const kycSpreadsheetIds = kycSources.map((source) => source.spreadsheetId);
  const kycSpreadsheetId = kycSpreadsheetIds[0] || APPROVED_DEPOSITS_KYC_SPREADSHEET_ID;
  const amountSpreadsheetId = options.amountSpreadsheetId || APPROVED_DEPOSITS_AMOUNT_SPREADSHEET_ID;
  const readValues = options.readValues || readSheetValues;
  const getTitles =
    options.getSheetTitles ||
    (async (spreadsheetId) => {
      if (Array.isArray(options.kycSheetTitles) && spreadsheetId === (options.kycSpreadsheetId || options.spreadsheetId)) {
        return options.kycSheetTitles;
      }
      if (Array.isArray(options.sheetTitles) && spreadsheetId === (options.kycSpreadsheetId || options.spreadsheetId)) {
        return options.sheetTitles;
      }
      return getSheetTitles(spreadsheetId);
    });
  const amountTitles = Array.isArray(options.amountSheetTitles)
    ? options.amountSheetTitles
    : options.getSheetTitles
      ? await options.getSheetTitles(amountSpreadsheetId)
      : await getSheetTitles(amountSpreadsheetId);
  const kycSource = await loadAllKycLanguageMaps({
    kycSources,
    readValues,
    getTitles,
  });
  const officeScope = String(query.office || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item !== "All");
  const amountSource = await loadAmountRows({
    spreadsheetId: amountSpreadsheetId,
    readValues,
    sheetTitles: amountTitles,
    languageIndex: kycSource.languageIndex,
    officeScope,
  });
  const rows = amountSource.rows;

  const filteredRows = applyFilters(rows, query);
  const aggregate = aggregateRows(filteredRows);
  const allAggregate = aggregateRows(rows);
  const countries = [
    ...new Set([...DEFAULT_COUNTRIES, ...rows.map((row) => row.country).filter(Boolean)]),
  ].sort((left, right) => left.localeCompare(right));

  return {
    generatedAt: new Date().toISOString(),
    spreadsheetId: amountSpreadsheetId,
    amountSpreadsheetId,
    kycSpreadsheetId,
    kycSpreadsheetIds,
    kycOfficeSources: kycSource.kycOfficeSources,
    sourceTabs: amountSource.sourceTabs,
    kycSourceTabs: kycSource.sourceTabs,
    skippedTabs: amountSource.skippedTabs,
    kycSkippedTabs: kycSource.skippedTabs,
    categories: CATEGORY_KEYS,
    filters: {
      language: String(query.language || "All").trim() || "All",
      country: String(query.country || "All").trim() || "All",
      month: String(query.month || "All").trim() || "All",
      status: String(query.status || "All").trim() || "All",
      brand: String(query.brand || "All").trim() || "All",
      campaign: String(query.campaign || "All").trim() || "All",
      method: String(query.method || "All").trim() || "All",
      cashier: String(query.cashier || "All").trim() || "All",
      department: String(query.department || "All").trim() || "All",
      ftd: String(query.ftd || "All").trim() || "All",
      office: String(query.office || "All").trim() || "All",
    },
    options: {
      languages: ["All", ...CATEGORY_KEYS],
      offices: ["All", ...kycSources.map((source) => source.office)],
      countries: ["All", ...countries],
      months: [
        { key: "All", label: "All" },
        ...allAggregate.months.map((month) => ({ key: month.key, label: month.label })),
      ],
      statuses: uniqueOptions(rows, "status"),
      brands: uniqueOptions(rows, "brand"),
      campaigns: uniqueOptions(rows, "campaign"),
      methods: uniqueOptions(rows, "method"),
      cashiers: uniqueOptions(rows, "cashier"),
      departments: uniqueOptions(rows, "department"),
      ftdValues: uniqueOptions(rows, "ftd"),
    },
    rows: filteredRows,
    allRowCount: rows.length,
    ...aggregate,
  };
}

