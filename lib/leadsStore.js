import { createHash } from "node:crypto";

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
// How many chunk keys to fetch per MGET. Reading every source's chunks in one
// giant MGET overflows the KV REST response limit when the dataset is large
// (hundreds of thousands of rows), so we read in small batches and only for the
// source actually requested.
const MGET_BATCH = 4;

// sourceKey -> { meta, rows: Array | null }. rows === null means metadata is
// hydrated but the row data has not been loaded from KV yet (lazy).
const memorySources = new Map();
let metaHydrated = false;

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
  metaHydrated = false;
}

export function hasData() {
  return memorySources.size > 0;
}

async function mgetBatched(keys = [], batchSize = MGET_BATCH) {
  const out = [];
  for (let index = 0; index < keys.length; index += batchSize) {
    const slice = keys.slice(index, index + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const values = await storeMGet(slice);
    for (let position = 0; position < slice.length; position += 1) {
      out.push(Array.isArray(values) ? values[position] : null);
    }
  }
  return out;
}

function chunkKeysForMeta(sourceKey, meta = {}) {
  const chunkCount = Number(meta.chunkCount);
  if (Number.isFinite(chunkCount) && chunkCount > 0) {
    const keys = [];
    for (let chunk = 0; chunk < chunkCount; chunk += 1) {
      keys.push(chunkKey(sourceKey, chunk));
    }
    return keys;
  }
  // Pre-chunking sources used a single value key.
  return [legacyDataKey(sourceKey)];
}

// Loads a single source's rows from KV on demand (batched), caching the result
// in memory. Avoids fetching the whole dataset when only one office-month is
// needed.
async function loadSourceRowsByKey(sourceKey) {
  const entry = memorySources.get(sourceKey);
  if (!entry) {
    return null;
  }
  if (Array.isArray(entry.rows)) {
    return entry.rows;
  }
  if (!isPersistenceEnabled()) {
    entry.rows = [];
    return entry.rows;
  }
  const keys = chunkKeysForMeta(sourceKey, entry.meta || {});
  const values = await mgetBatched(keys);
  let rows = [];
  for (const raw of values) {
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
  entry.rows = rows;
  return rows;
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
  const contentHash = createHash("sha1").update(JSON.stringify(rows)).digest("hex");

  // Skip the (expensive) Redis writes when this source's data is unchanged since
  // the last sync we saw on this instance. n8n re-sends the full dataset on every
  // scheduled run, so most syncs write identical bytes -- this dedupe is the main
  // Redis write-bandwidth saver. Correctness is unaffected: the stored data is
  // already current, and the in-memory copy is refreshed regardless.
  const unchanged =
    isPersistenceEnabled() &&
    Boolean(previous) &&
    previous.meta?.contentHash === contentHash &&
    Number(previous.meta?.rowCount) === rows.length &&
    previousChunkCount > 0;

  const chunks = isPersistenceEnabled() && !unchanged ? chunkRowsBySize(rows) : [];
  const chunkCount = unchanged ? previousChunkCount : chunks.length;
  const record = {
    meta: {
      ...meta,
      sourceKey,
      rowCount: rows.length,
      chunkCount,
      contentHash,
      updatedAt: unchanged ? previous.meta?.updatedAt || Date.now() : Date.now(),
    },
    rows,
  };
  memorySources.set(sourceKey, record);
  metaHydrated = true;

  if (isPersistenceEnabled() && !unchanged) {
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

  return { sourceKey, rowCount: rows.length, chunkCount, skipped: unchanged };
}

// Hydrates ONLY metadata (small) for every source. Row data stays lazy and is
// loaded per-source on demand via loadSourceRowsByKey. This keeps cold starts
// cheap even when the dataset has hundreds of thousands of rows.
async function hydrateMetaFromKv() {
  if (!isPersistenceEnabled()) {
    return;
  }
  const sourceKeys = await storeSetMembers(SOURCE_INDEX_KEY);
  if (sourceKeys.length === 0) {
    return;
  }
  const metaValues = await mgetBatched(sourceKeys.map(metaKey), 25);

  sourceKeys.forEach((sourceKey, index) => {
    if (memorySources.has(sourceKey)) {
      return;
    }
    let meta = { sourceKey };
    try {
      meta = metaValues[index] ? JSON.parse(metaValues[index]) : meta;
    } catch {
      meta = { sourceKey };
    }
    memorySources.set(sourceKey, { meta, rows: null });
  });
}

async function ensureMetaHydrated() {
  if (!metaHydrated && memorySources.size === 0) {
    await hydrateMetaFromKv();
    metaHydrated = true;
  }
}

// Loads all rows across every source (lazy, per-source). Used by the bot/AI
// fallback path; the dashboard uses the per-month lookups below.
export async function loadAllRows() {
  await ensureMetaHydrated();
  const all = [];
  for (const sourceKey of memorySources.keys()) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await loadSourceRowsByKey(sourceKey);
    if (Array.isArray(rows)) {
      for (const row of rows) {
        all.push(row);
      }
    }
  }
  return all;
}

export async function listSources() {
  await ensureMetaHydrated();
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

// Returns ingested rows for a spreadsheet/office/month when n8n (or POST
// /api/sources) has synced them into Redis. Returns null when no matching
// source exists so callers can fall back to live Google Sheets.
export async function loadRowsForSourceMeta({
  spreadsheetId = "",
  office = "",
  period = "",
  category = "leads",
} = {}) {
  await ensureMetaHydrated();
  const wantedCategory = normCategory(category);
  const wantedSpreadsheetId = normSpreadsheetId(spreadsheetId);
  const wantedOffice = normOffice(office);
  const wantedPeriod = String(period || "").trim();

  for (const [sourceKey, { meta }] of memorySources) {
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
      // eslint-disable-next-line no-await-in-loop
      const rows = await loadSourceRowsByKey(sourceKey);
      // Guard against incomplete persistence: meta says the source has rows but
      // none loaded (e.g. chunk write failed). Treat it as a miss so the caller
      // falls back to live Google Sheets instead of rendering all zeros.
      if ((!rows || rows.length === 0) && Number(meta.rowCount) > 0) {
        return null;
      }
      return rows || [];
    }
  }
  return null;
}

// Diagnostic helper: actual loaded rows vs the row count recorded in meta, per
// source. With loadRows=false (default) it stays cheap (meta only). With
// loadRows=true it fetches each source's chunks to verify completeness.
export async function describeSources({ loadRows = false } = {}) {
  await ensureMetaHydrated();
  const out = [];
  for (const [sourceKey, entry] of memorySources) {
    const meta = entry.meta || {};
    let hydratedRowCount = Array.isArray(entry.rows) ? entry.rows.length : null;
    if (loadRows) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await loadSourceRowsByKey(sourceKey);
      hydratedRowCount = Array.isArray(rows) ? rows.length : 0;
    }
    out.push({
      sourceKey: meta.sourceKey,
      office: meta.office || null,
      period: meta.period || null,
      category: meta.category || "leads",
      spreadsheetId: meta.spreadsheetId || null,
      metaRowCount: Number(meta.rowCount || 0),
      hydratedRowCount,
      chunkCount: Number(meta.chunkCount || 0),
      complete:
        hydratedRowCount === null ? null : hydratedRowCount === Number(meta.rowCount || 0),
    });
  }
  return out;
}

// Reads auxiliary (non-month) ingested rows: roster tabs and desk-language.
export async function loadAuxiliarySourceRows({ category = "roster", rosterTab = "" } = {}) {
  await ensureMetaHydrated();
  const wantedCategory = normCategory(category);
  const wantedTab = String(rosterTab || "").trim().toLowerCase();

  for (const [sourceKey, { meta }] of memorySources) {
    if (normCategory(meta.category) !== wantedCategory) {
      continue;
    }
    if (wantedCategory === "roster") {
      if (String(meta.rosterTab || "").trim().toLowerCase() !== wantedTab) {
        continue;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    const rows = await loadSourceRowsByKey(sourceKey);
    if ((!rows || rows.length === 0) && Number(meta.rowCount) > 0) {
      return null;
    }
    return rows || [];
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
    await ensureMetaHydrated();
    return memorySources.size > 0;
  }
  return false;
}
