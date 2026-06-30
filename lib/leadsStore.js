import {
  isPersistenceEnabled,
  storeMGet,
  storeSet,
  storeSetAdd,
  storeSetMembers,
} from "./store.js";

// SQL-less dataset store for ingested sheet rows.
//
// Data volume is small, so each synced sheet (a "source") is kept as a JSON
// array. The in-memory Map is the synchronous source of truth for a warm
// instance; when Redis/KV is configured the data is mirrored there and
// re-hydrated after a cold start (same pattern as sessions/approvals).

const SOURCE_INDEX_KEY = "crm:leads:sources";
const DATA_PREFIX = "crm:leads:src:";
const META_PREFIX = "crm:leads:meta:";
const VALUE_LIMIT = 900_000; // stay under typical KV payload limits

const memorySources = new Map();
let hydrated = false;

function dataKey(sourceKey) {
  return `${DATA_PREFIX}${sourceKey}`;
}

function metaKey(sourceKey) {
  return `${META_PREFIX}${sourceKey}`;
}

export function clearLeadsStore() {
  memorySources.clear();
  hydrated = false;
}

export function hasData() {
  return memorySources.size > 0;
}

export function leadsSourceMode(env = process.env) {
  const mode = String(env.LEADS_SOURCE || "auto").trim().toLowerCase();
  return mode === "ingest" || mode === "sheets" ? mode : "auto";
}

export function saveSource(sourceKey, meta = {}, rows = []) {
  if (!sourceKey) {
    throw new Error("saveSource requires a sourceKey.");
  }
  const record = {
    meta: { ...meta, sourceKey, rowCount: rows.length, updatedAt: Date.now() },
    rows,
  };
  memorySources.set(sourceKey, record);
  hydrated = true;

  if (isPersistenceEnabled()) {
    const serialized = JSON.stringify(rows);
    if (serialized.length <= VALUE_LIMIT) {
      storeSet(dataKey(sourceKey), serialized);
    } else {
      console.error(`Source ${sourceKey} exceeds KV value limit; kept in memory only.`);
    }
    storeSet(metaKey(sourceKey), JSON.stringify(record.meta));
    storeSetAdd(SOURCE_INDEX_KEY, sourceKey);
  }

  return { sourceKey, rowCount: rows.length };
}

async function hydrateFromKv() {
  if (!isPersistenceEnabled()) {
    return;
  }
  const sourceKeys = await storeSetMembers(SOURCE_INDEX_KEY);
  if (sourceKeys.length === 0) {
    return;
  }
  const [dataValues, metaValues] = await Promise.all([
    storeMGet(sourceKeys.map(dataKey)),
    storeMGet(sourceKeys.map(metaKey)),
  ]);

  sourceKeys.forEach((sourceKey, index) => {
    if (memorySources.has(sourceKey)) {
      return;
    }
    let rows = [];
    try {
      rows = dataValues[index] ? JSON.parse(dataValues[index]) : [];
    } catch {
      rows = [];
    }
    let meta = { sourceKey };
    try {
      meta = metaValues[index] ? JSON.parse(metaValues[index]) : meta;
    } catch {
      meta = { sourceKey };
    }
    memorySources.set(sourceKey, { meta, rows: Array.isArray(rows) ? rows : [] });
  });
}

// Loads (and hydrates from KV on a cold start) all rows across every source.
export async function loadAllRows() {
  if (!hydrated && memorySources.size === 0) {
    await hydrateFromKv();
    hydrated = true;
  }
  const all = [];
  for (const { rows } of memorySources.values()) {
    for (const row of rows) {
      all.push(row);
    }
  }
  return all;
}

export async function listSources() {
  if (!hydrated && memorySources.size === 0) {
    await hydrateFromKv();
    hydrated = true;
  }
  return [...memorySources.values()]
    .map(({ meta }) => meta)
    .sort((left, right) => String(right.period || "").localeCompare(String(left.period || "")));
}

function normSpreadsheetId(value) {
  return String(value || "").trim();
}

function normOffice(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US");
}

function normCategory(value) {
  return String(value || "leads").trim().toLowerCase();
}

async function ensureHydrated() {
  if (!hydrated && memorySources.size === 0) {
    await hydrateFromKv();
    hydrated = true;
  }
}

// Returns ingested rows for a spreadsheet/office/month when n8n (or POST
// /api/sources) has synced them into Redis. Returns null when no matching
// source exists so callers can fall back to live Google Sheets.
export async function loadRowsForSourceMeta({
  spreadsheetId = "",
  office = "",
  period = "",
  category = "leads",
} = {}) {
  await ensureHydrated();
  const wantedCategory = normCategory(category);
  const wantedSpreadsheetId = normSpreadsheetId(spreadsheetId);
  const wantedOffice = normOffice(office);
  const wantedPeriod = String(period || "").trim();

  for (const { meta, rows } of memorySources.values()) {
    const metaCategory = normCategory(meta.category);
    if (metaCategory !== wantedCategory) {
      continue;
    }
    if (
      wantedSpreadsheetId &&
      normSpreadsheetId(meta.spreadsheetId) &&
      normSpreadsheetId(meta.spreadsheetId) === wantedSpreadsheetId
    ) {
      return rows;
    }
    if (
      wantedOffice &&
      wantedPeriod &&
      normOffice(meta.office) === wantedOffice &&
      String(meta.period || "").trim() === wantedPeriod
    ) {
      return rows;
    }
  }
  return null;
}

// Whether ingested data should be used instead of reading Google Sheets live.
export async function isDatasetActive(env = process.env) {
  const mode = leadsSourceMode(env);
  if (mode === "sheets") {
    return false;
  }
  if (mode === "ingest") {
    return true;
  }
  if (memorySources.size > 0) {
    return true;
  }
  if (isPersistenceEnabled()) {
    await hydrateFromKv();
    hydrated = true;
    return memorySources.size > 0;
  }
  return false;
}
