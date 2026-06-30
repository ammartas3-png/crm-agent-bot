import {
  isPersistenceEnabled,
  storeDelete,
  storeMGet,
  storeSet,
  storeSetAdd,
  storeSetMembers,
} from "./store.js";

// SQL-less dataset store for ingested sheet rows.
//
// Each synced sheet (a "source") is kept as a JSON array. The in-memory Map is
// the synchronous source of truth for a warm instance; when Redis/KV is
// configured the data is mirrored there and re-hydrated after a cold start
// (same pattern as sessions/approvals).
//
// Rows are stored in SIZE-BOUNDED CHUNKS so a large office-month never exceeds
// the KV REST payload limit. Previously a source bigger than ~900 KB was kept
// in memory only and never written to Redis, so a different serverless instance
// (e.g. the one serving the dashboard) hydrated an empty array and reported
// zeros. Chunking guarantees every row reaches Redis.

const SOURCE_INDEX_KEY = "crm:leads:sources";
const DATA_PREFIX = "crm:leads:src:";
const META_PREFIX = "crm:leads:meta:";
// Per-chunk serialized JSON budget. Stays well under typical KV REST limits
// (Upstash ~1 MB request) while leaving headroom for the command envelope.
const CHUNK_BUDGET = 700_000;
// Best-effort deletion of stale chunk keys when a re-sync produces fewer chunks.
const STALE_CHUNK_CLEANUP = 16;

const memorySources = new Map();
let hydrated = false;

// Legacy single-value key (pre-chunking). Read for backward compatibility.
function legacyDataKey(sourceKey) {
  return `${DATA_PREFIX}${sourceKey}`;
}

function chunkKey(sourceKey, chunkIndex) {
  return `${DATA_PREFIX}${sourceKey}:${chunkIndex}`;
}

function metaKey(sourceKey) {
  return `${META_PREFIX}${sourceKey}`;
}

// Splits rows into chunks whose serialized JSON stays under the budget so each
// KV write fits within the payload limit.
function chunkRowsBySize(rows = [], budget = CHUNK_BUDGET) {
  const chunks = [];
  let current = [];
  let currentSize = 2; // account for the enclosing [] brackets
  for (const row of rows) {
    const rowSize = JSON.stringify(row).length + 1; // +1 for the comma
    if (current.length > 0 && currentSize + rowSize > budget) {
      chunks.push(current);
      current = [];
      currentSize = 2;
    }
    current.push(row);
    currentSize += rowSize;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
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
  const previous = memorySources.get(sourceKey);
  const previousChunkCount = Number(previous?.meta?.chunkCount || 0);

  const chunks = isPersistenceEnabled() ? chunkRowsBySize(rows) : [];
  const record = {
    meta: {
      ...meta,
      sourceKey,
      rowCount: rows.length,
      chunkCount: chunks.length,
      updatedAt: Date.now(),
    },
    rows,
  };
  memorySources.set(sourceKey, record);
  hydrated = true;

  if (isPersistenceEnabled()) {
    chunks.forEach((chunk, index) => {
      storeSet(chunkKey(sourceKey, index), JSON.stringify(chunk));
    });
    // Remove stale chunk keys from a previous, larger sync so reads do not pick
    // up leftover data. Best-effort: clears up to a small buffer beyond the old
    // count without an extra round-trip.
    const cleanupUntil = Math.max(previousChunkCount, chunks.length + STALE_CHUNK_CLEANUP);
    for (let index = chunks.length; index < cleanupUntil; index += 1) {
      storeDelete(chunkKey(sourceKey, index));
    }
    // Clear the legacy single-value key if this source was written pre-chunking.
    storeDelete(legacyDataKey(sourceKey));
    storeSet(metaKey(sourceKey), JSON.stringify(record.meta));
    storeSetAdd(SOURCE_INDEX_KEY, sourceKey);
  }

  return { sourceKey, rowCount: rows.length, chunkCount: chunks.length };
}

async function hydrateFromKv() {
  if (!isPersistenceEnabled()) {
    return;
  }
  const sourceKeys = await storeSetMembers(SOURCE_INDEX_KEY);
  if (sourceKeys.length === 0) {
    return;
  }
  const metaValues = await storeMGet(sourceKeys.map(metaKey));

  // Resolve each source's chunk keys from its meta (chunkCount). Sources written
  // before chunking fall back to the legacy single-value key.
  const plans = sourceKeys.map((sourceKey, index) => {
    let meta = { sourceKey };
    try {
      meta = metaValues[index] ? JSON.parse(metaValues[index]) : meta;
    } catch {
      meta = { sourceKey };
    }
    const chunkCount = Number(meta.chunkCount);
    const keys = [];
    if (Number.isFinite(chunkCount) && chunkCount > 0) {
      for (let chunk = 0; chunk < chunkCount; chunk += 1) {
        keys.push(chunkKey(sourceKey, chunk));
      }
    } else {
      keys.push(legacyDataKey(sourceKey));
    }
    return { sourceKey, meta, keys };
  });

  const allChunkKeys = [];
  for (const plan of plans) {
    plan.offset = allChunkKeys.length;
    allChunkKeys.push(...plan.keys);
  }
  const chunkValues = allChunkKeys.length ? await storeMGet(allChunkKeys) : [];

  for (const plan of plans) {
    if (memorySources.has(plan.sourceKey)) {
      continue;
    }
    let rows = [];
    for (let position = 0; position < plan.keys.length; position += 1) {
      const raw = chunkValues[plan.offset + position];
      if (!raw) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          rows = rows.length === 0 ? parsed : rows.concat(parsed);
        }
      } catch {
        // skip malformed chunk
      }
    }
    memorySources.set(plan.sourceKey, { meta: plan.meta, rows });
  }
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
    const matchesSpreadsheet =
      wantedSpreadsheetId &&
      normSpreadsheetId(meta.spreadsheetId) &&
      normSpreadsheetId(meta.spreadsheetId) === wantedSpreadsheetId;
    const matchesOfficePeriod =
      wantedOffice &&
      wantedPeriod &&
      normOffice(meta.office) === wantedOffice &&
      String(meta.period || "").trim() === wantedPeriod;
    if (matchesSpreadsheet || matchesOfficePeriod) {
      // Guard against incomplete persistence: meta says the source has rows but
      // none hydrated (e.g. chunk write failed on another instance). Treat it as
      // a miss so the caller falls back to live Google Sheets instead of
      // returning an empty dataset that would render as all zeros.
      if (rows.length === 0 && Number(meta.rowCount) > 0) {
        return null;
      }
      return rows;
    }
  }
  return null;
}

// Diagnostic helper: actual hydrated rows vs the row count recorded in meta,
// per source. Surfaces sources whose row data did not make it into Redis.
export async function describeSources() {
  await ensureHydrated();
  return [...memorySources.values()].map(({ meta, rows }) => ({
    sourceKey: meta.sourceKey,
    office: meta.office || null,
    period: meta.period || null,
    category: meta.category || "leads",
    spreadsheetId: meta.spreadsheetId || null,
    metaRowCount: Number(meta.rowCount || 0),
    hydratedRowCount: rows.length,
    chunkCount: Number(meta.chunkCount || 0),
    complete: rows.length === Number(meta.rowCount || 0),
  }));
}

// Reads auxiliary (non-month) ingested rows: roster tabs and desk-language.
// Roster sources are matched by their tab name (Turkiye/Argentina/...) stored in
// meta.rosterTab. Returns null when no matching source is present (so the caller
// can fall back to live Google Sheets); returns [] only for a genuinely empty,
// fully-synced source.
export async function loadAuxiliarySourceRows({ category = "roster", rosterTab = "" } = {}) {
  await ensureHydrated();
  const wantedCategory = normCategory(category);
  const wantedTab = String(rosterTab || "").trim().toLowerCase();

  for (const { meta, rows } of memorySources.values()) {
    if (normCategory(meta.category) !== wantedCategory) {
      continue;
    }
    if (wantedCategory === "roster") {
      if (String(meta.rosterTab || "").trim().toLowerCase() !== wantedTab) {
        continue;
      }
    }
    if (rows.length === 0 && Number(meta.rowCount) > 0) {
      return null;
    }
    return rows;
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
