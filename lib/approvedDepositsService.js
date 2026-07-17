import { readSheetValues, getSheetTitles } from "./googleSheets.js";
import { normalizeText } from "./calculations.js";
import { parseKycText } from "./kycTextParser.js";

export const APPROVED_DEPOSITS_SPREADSHEET_ID =
  process.env.APPROVED_DEPOSITS_SPREADSHEET_ID || "1aODXtjBqEEqfee8W0mpqRZ2SOv3r3Yv4fbDlk1tYSVw";

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
const CATEGORY_KEYS = ["Native", "English", "Other"];
const DEFAULT_COUNTRIES = ["Bangladesh", "India", "Indonesia", "Philippines", "Thailand", "Vietnam"];

function titleCase(value = "") {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function normalizeHeader(value = "") {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
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
    const hasCountry = normalized.includes("listofcountrys") || normalized.includes("listofcountries");
    if (hasKyc && (hasCid || hasCountry)) {
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

function parseDateParts(value = "", fallbackMonthIndex = 0, fallbackYear = new Date().getUTCFullYear()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      iso: value.toISOString().slice(0, 10),
      year: value.getUTCFullYear(),
      monthIndex: value.getUTCMonth(),
    };
  }
  const text = String(value || "").trim();
  const dmy = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (dmy) {
    const [, day, month, year] = dmy;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return {
      iso: date.toISOString().slice(0, 10),
      year: Number(year),
      monthIndex: Number(month) - 1,
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
  const value = valueAt(row, headerMap, ["listofcountrys", "listofcountries", "country"]);
  return titleCase(value) || "Unknown";
}

function rowObject(row = [], headerMap, meta) {
  const country = rowCountry(row, headerMap);
  const date = valueAt(row, headerMap, ["ftddate", "date", "approveddate", "registrationdate"]);
  const dateParts = parseDateParts(date, meta.index, new Date().getUTCFullYear());
  const month = {
    key: `${dateParts.year}-${String(meta.index + 1).padStart(2, "0")}`,
    label: monthLabel(meta, dateParts.year),
    index: meta.index,
    tabTitle: meta.title,
  };
  const kycText = String(valueAt(row, headerMap, ["kyc"]) || "");
  const parsed = parseKycText(kycText, { country });
  return {
    cid: String(valueAt(row, headerMap, ["cid", "customerid", "id"]) || "").trim(),
    ftdDate: dateParts.iso,
    registrationDate: String(valueAt(row, headerMap, ["registrationdate"]) || "").trim(),
    department: String(valueAt(row, headerMap, ["departmentoffice", "department", "office"]) || "").trim(),
    country,
    agent: String(valueAt(row, headerMap, ["agents", "agent"]) || "").trim(),
    brand: String(valueAt(row, headerMap, ["brand"]) || "").trim(),
    aff: String(valueAt(row, headerMap, ["aff", "placement"]) || "").trim(),
    kycText,
    secPsw: String(valueAt(row, headerMap, ["secpsw"]) || "").trim(),
    bonus: String(valueAt(row, headerMap, ["bonus"]) || "").trim(),
    amount: parsed.amount,
    language: parsed.language || "Unknown",
    languageCategory: parsed.languageCategory,
    month,
    monthKey: month.key,
  };
}

function applyFilters(rows = [], filters = {}) {
  const language = String(filters.language || "").trim();
  const country = String(filters.country || "").trim();
  const month = String(filters.month || "").trim();
  return rows.filter((row) => {
    if (language && language !== "All" && row.languageCategory !== language) {
      return false;
    }
    if (country && country !== "All" && row.country !== country) {
      return false;
    }
    if (month && month !== "All" && row.monthKey !== month) {
      return false;
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

export async function loadApprovedDepositsReport(query = {}, options = {}) {
  const spreadsheetId = options.spreadsheetId || APPROVED_DEPOSITS_SPREADSHEET_ID;
  const readValues = options.readValues || readSheetValues;
  const titles = Array.isArray(options.sheetTitles) ? options.sheetTitles : await getSheetTitles(spreadsheetId);
  const validTabs = validApprovedDepositTabTitles(titles);
  const rows = [];
  const skippedTabs = titles.filter((title) => !validTabs.includes(title));

  for (const title of validTabs) {
    const meta = tabMeta(title);
    const values = await readValues(spreadsheetId, `${quotedSheetName(title)}!A:L`, { bypassCache: true });
    const headerRowIndex = findHeaderRow(values);
    if (headerRowIndex < 0) {
      skippedTabs.push(title);
      continue;
    }
    const headerMap = headerMapFromRow(values[headerRowIndex]);
    for (const row of values.slice(headerRowIndex + 1)) {
      const record = rowObject(row, headerMap, meta);
      if (!record.cid && !record.kycText && !record.country) {
        continue;
      }
      rows.push(record);
    }
  }

  const filteredRows = applyFilters(rows, query);
  const aggregate = aggregateRows(filteredRows);
  const allAggregate = aggregateRows(rows);
  const countries = [
    ...new Set([...DEFAULT_COUNTRIES, ...rows.map((row) => row.country).filter(Boolean)]),
  ].sort((left, right) => left.localeCompare(right));

  return {
    generatedAt: new Date().toISOString(),
    spreadsheetId,
    sourceTabs: validTabs,
    skippedTabs,
    categories: CATEGORY_KEYS,
    filters: {
      language: String(query.language || "All").trim() || "All",
      country: String(query.country || "All").trim() || "All",
      month: String(query.month || "All").trim() || "All",
    },
    options: {
      languages: ["All", ...CATEGORY_KEYS],
      countries: ["All", ...countries],
      months: [
        { key: "All", label: "All" },
        ...allAggregate.months.map((month) => ({ key: month.key, label: month.label })),
      ],
    },
    rows: filteredRows,
    allRowCount: rows.length,
    ...aggregate,
  };
}

